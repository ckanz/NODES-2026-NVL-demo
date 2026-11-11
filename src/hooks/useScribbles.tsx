import type { NVL } from "@neo4j-nvl/base";
import type { RefObject } from "react";
import { useEffect, useRef } from "react";

import { ScribbleInteraction } from "../interactions/ScribbleInteraction";
import type { GraphData } from "../data/graph";
import { analyseScribbles } from "../interactions/scribble";
import type {
  SceneNode,
  ScribbleResult,
  Stroke,
} from "../interactions/scribble";
import { cssPixelsPerUnit, DEFAULT_NODE_SIZE } from "../interactions/viewport";
import type { Point } from "../interactions/viewport";

const LINE_WIDTH_PX = 3;
/** Grid: starting cell size in graph units, the closest the lines may get on screen, and a stronger line every so many cells. */
const GRID_CELL = 50;
const GRID_MIN_PX = 16;
const GRID_MAJOR_EVERY = 4;

type View = { zoom: number; pan: Point; width: number; height: number };

/**
 * Draws the scribbles. Strokes are in graph coordinates, so they stay exactly where they were drawn whatever
 * the zoom and pan. The line itself keeps the same width on screen.
 */
const drawStrokes = (
  canvas: HTMLCanvasElement,
  strokes: Stroke[],
  view: View,
) => {
  const ratio = window.devicePixelRatio;
  const width = Math.round(view.width * ratio);
  const height = Math.round(view.height * ratio);
  // Setting the size clears the canvas, so only do it when it changed.
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return;

  context.clearRect(0, 0, width, height);
  // The color comes from the stylesheet (`color` on the canvas), so it follows the theme.
  context.strokeStyle = getComputedStyle(canvas).color;
  context.lineWidth = LINE_WIDTH_PX * ratio;
  context.lineCap = "round";
  context.lineJoin = "round";

  // Canvas pixels are device pixels, so one graph unit is `zoom` of them.
  const toCanvas = (point: Point) => ({
    x: (point.x - view.pan.x) * view.zoom + width / 2,
    y: (point.y - view.pan.y) * view.zoom + height / 2,
  });
  for (const stroke of strokes) {
    if (stroke.length === 0) continue;
    const first = toCanvas(stroke[0]);
    context.beginPath();
    context.moveTo(first.x, first.y);
    for (const point of stroke.slice(1)) {
      const next = toCanvas(point);
      context.lineTo(next.x, next.y);
    }
    context.stroke();
  }
};

/**
 * Graph paper: sizes and places the grid's CSS background so it moves and zooms with the graph. The cell size
 * doubles or halves to keep the lines a comfortable distance apart on screen at any zoom.
 */
const placeGrid = (grid: HTMLElement, view: View) => {
  const perUnit = cssPixelsPerUnit(view.zoom);
  let cell = GRID_CELL;
  while (cell * perUnit < GRID_MIN_PX) cell *= 2;
  while (cell * perUnit >= GRID_MIN_PX * 2) cell /= 2;
  const minor = cell * perUnit;
  const major = minor * GRID_MAJOR_EVERY;
  // Layer order must match the stylesheet: major, major, minor, minor. A major line runs through graph point (0, 0).
  grid.style.backgroundSize = `${major}px ${major}px, ${major}px ${major}px, ${minor}px ${minor}px, ${minor}px ${minor}px`;
  grid.style.backgroundPosition = `${view.width / 2 - view.pan.x * perUnit}px ${view.height / 2 - view.pan.y * perUnit}px`;
};

type UseScribblesOptions = {
  nvlRef: RefObject<NVL | null>;
  nvlReady: boolean;
  /** Whether this pane can be scribbled on at all. */
  enabled: boolean;
  /** Scribble mode is on right now. */
  active: boolean;
  /** The graph on screen, read when scribble mode ends. */
  dataRef: RefObject<GraphData>;
  onDone: ((result: ScribbleResult) => void) | undefined;
};

/**
 * Scribble mode for one GraphPane: collects strokes while `active`, draws them (and graph paper behind the graph)
 * so they follow pan and zoom, and when `active` goes off, works out what they asked for and reports it.
 * The drawing is always cleared when the mode ends; strokes that meant nothing are reported in the console.
 */
export const useScribbles = ({
  nvlRef,
  nvlReady,
  enabled,
  active,
  dataRef,
  onDone,
}: UseScribblesOptions) => {
  // Strokes live in refs, not state: they change on every mouse move and are drawn by hand on a canvas.
  const strokes = useRef<Stroke[]>([]);
  const currentStroke = useRef<Stroke | null>(null);
  /** Bumped whenever the strokes change, so the draw loop knows to redraw. */
  const version = useRef(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const setStrokes = (next: Stroke[]) => {
    strokes.current = next;
    version.current += 1;
  };

  // Drawing. It takes the left button while active, and does nothing otherwise.
  useEffect(() => {
    const nvl = nvlRef.current;
    if (!nvlReady || !nvl || !enabled) return;
    const interaction = new ScribbleInteraction(nvl, {
      isActive: () => activeRef.current,
      onStrokeStart: (point) => {
        currentStroke.current = [point];
        version.current += 1;
      },
      onStrokePoint: (point) => {
        currentStroke.current?.push(point);
        version.current += 1;
      },
      onStrokeEnd: () => {
        const stroke = currentStroke.current;
        currentStroke.current = null;
        // A press with no movement is not a scribble.
        setStrokes(
          stroke && stroke.length > 1
            ? [...strokes.current, stroke]
            : strokes.current,
        );
      },
    });
    return () => interaction.destroy();
  }, [nvlReady, enabled, nvlRef]);

  // Watch the view every frame and redraw what changed: the strokes when they or the view did, the grid when the
  // view did. This is how both stay in place however the view moves (our zoom and pan, NVL's animated fit, a resize).
  useEffect(() => {
    if (!nvlReady || !enabled) return;
    let frame = 0;
    let drawnStrokes = "";
    let drawnGrid = "";
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const nvl = nvlRef.current;
      const canvas = canvasRef.current;
      if (!nvl || !canvas) return;
      const rect = canvas.getBoundingClientRect();
      const view: View = {
        zoom: nvl.getScale(),
        pan: nvl.getPan(),
        width: rect.width,
        height: rect.height,
      };
      const viewKey = `${view.zoom}|${view.pan.x}|${view.pan.y}|${view.width}|${view.height}|${window.devicePixelRatio}`;

      const grid = gridRef.current;
      if (grid && viewKey !== drawnGrid) {
        drawnGrid = viewKey;
        placeGrid(grid, view);
      } else if (!grid) {
        drawnGrid = "";
      }

      const all = currentStroke.current
        ? [...strokes.current, currentStroke.current]
        : strokes.current;
      const strokesKey =
        all.length === 0 ? "" : `${viewKey}|${version.current}`;
      if (strokesKey === drawnStrokes) return;
      drawnStrokes = strokesKey;
      if (all.length === 0)
        canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
      else drawStrokes(canvas, all, view);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [nvlReady, enabled, nvlRef]);

  // A crosshair while scribbling.
  useEffect(() => {
    const nvl = nvlRef.current;
    if (!nvlReady || !nvl || !enabled) return;
    const container = nvl.getContainer();
    container.style.cursor = active ? "crosshair" : "";
    return () => {
      container.style.cursor = "";
    };
  }, [active, nvlReady, enabled, nvlRef]);

  // Leaving scribble mode: read what was drawn, act on it, and clear the drawing. Strokes that could not be
  // interpreted are reported in the console, so it is clear why nothing happened for them.
  const wasActive = useRef(false);
  useEffect(() => {
    const was = wasActive.current;
    wasActive.current = active;
    if (!was || active) return;

    currentStroke.current = null; // a stroke still being drawn when the mode ended
    const drawn = strokes.current;
    setStrokes([]);
    const nvl = nvlRef.current;
    if (!nvl || drawn.length === 0) return;

    const { nodes, relationships } = dataRef.current;
    const sizes = new Map(
      nodes.map((node) => [node.id, node.size ?? DEFAULT_NODE_SIZE]),
    );
    // One read of the positions, here, only when the user finishes scribbling.
    const sceneNodes: SceneNode[] = nvl
      .getNodePositions()
      .map(({ id, x, y }) => ({
        id,
        x: x ?? 0,
        y: y ?? 0,
        radius: sizes.get(id) ?? DEFAULT_NODE_SIZE,
      }));
    const result = analyseScribbles(
      drawn,
      sceneNodes,
      relationships.map(({ id, from, to }) => ({ id, from, to })),
    );

    const ignored = drawn.length - result.consumed.length;
    if (ignored > 0) {
      console.info(
        `Scribble: ${ignored} of ${drawn.length} stroke${drawn.length === 1 ? "" : "s"} could not be interpreted and ` +
          "were ignored. Cross out a node or relationship to dismiss it, draw from one node to another for the " +
          "shortest path, or circle nodes and cross the circle to dismiss them.",
      );
    }
    if (result.consumed.length > 0) onDoneRef.current?.(result);
  }, [active, nvlRef, dataRef]);

  return {
    /** Drawn over the graph. Render it inside the pane whenever `enabled`. */
    canvas: enabled ? (
      <canvas ref={canvasRef} className="scribble-canvas" aria-hidden="true" />
    ) : null,
    /** Graph paper behind the graph, while active. */
    grid:
      enabled && active ? (
        <div ref={gridRef} className="scribble-grid" aria-hidden="true" />
      ) : null,
    undo: () => setStrokes(strokes.current.slice(0, -1)),
    discard: () => {
      currentStroke.current = null;
      setStrokes([]);
    },
  };
};
