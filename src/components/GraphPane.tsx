import type { Node, NVL, Relationship } from "@neo4j-nvl/base";
import { InteractiveNvlWrapper } from "@neo4j-nvl/react";
import type { Ref } from "react";
import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

import { renderGraphImage } from "../utils/graphImage";
import { InertialPanInteraction } from "../interactions/InertialPanInteraction";
import { SmoothZoomInteraction } from "../interactions/SmoothZoomInteraction";
import type { GraphData } from "../data/graph";
import type { ScribbleResult } from "../interactions/scribble";
import { DEFAULT_NODE_SIZE } from "../interactions/viewport";
import type { Point } from "../interactions/viewport";
import { useScribbles } from "../hooks/useScribbles";

export type NodePosition = { id: string; x: number; y: number };

/** Where every node was, and the camera. Enough to put a graph back exactly as it was. */
export type ViewState = { positions: NodePosition[]; zoom: number; pan: Point };

/** What the graph looked like at one moment: a picture, plus its view. */
export type GraphSnapshot = ViewState & {
  /** PNG data URL of the whole graph, fitted to the pane's shape whatever the zoom was. */
  image: string;
};

/** What a parent can ask of a GraphPane. */
export type GraphPaneHandle = {
  /** Reads the graph as it is now. Null if NVL has not started. */
  capture: () => GraphSnapshot | null;
  /** Removes the most recent scribble. */
  undoScribble: () => void;
  /** Throws away every scribble without acting on it. */
  discardScribbles: () => void;
};

type GraphPaneProps = {
  /** Gives the parent a way to capture the graph (see GraphPaneHandle). */
  ref?: Ref<GraphPaneHandle>;
  /**
   * Put the graph back as it was: node positions and camera. Applied once, right after NVL starts, and the
   * automatic fit is skipped. The layout then carries on from these positions, so a graph that was settled
   * stays where it was.
   */
  restore?: ViewState | null;
  /** Called once `restore` has been applied. */
  onRestored?: () => void;
  /**
   * Scribble mode. While on, the left mouse button draws on top of the graph instead of dragging nodes (the
   * other buttons pan, the wheel still zooms), and graph paper shows behind it. When it goes off, the
   * scribbles are read and `onScribbleDone` is told what they asked for (see useScribbles).
   * Only a pane given `onScribbleDone` can be scribbled on.
   */
  scribble?: boolean;
  onScribbleDone?: (result: ScribbleResult) => void;
  data: GraphData;
  /** Needed when several NVL instances share a page, so the `__Nvl_*` window hooks can tell them apart. */
  instanceId: string;
  /** Canvas draws captions; WebGL is faster for big graphs but draws none. */
  renderer: "canvas" | "webgl";
  /**
   * Zoom level above which the Canvas renderer takes over from `renderer` (e.g. WebGL, which draws no
   * captions), so labels appear once you are close enough to read them. Switches back slightly below it.
   */
  canvasAboveZoom?: number;
  /**
   * Lowest zoom the graph can be zoomed out to (NVL's default is 0.075). Big graphs spread wider than that
   * allows, and fit() stops at the same limit. Read when NVL is created, so it cannot change later.
   */
  minZoom?: number;
  /** Defaults to force-directed. */
  layout?: "forceDirected" | "hierarchical";
  /**
   * Let NVL select clicked elements itself (default). Turn off to control selection through the
   * `selected` property of the nodes and relationships you pass in.
   */
  selectOnClick?: boolean;
  /** Must already exist when this component mounts, or NVL never starts. */
  minimapContainer?: HTMLElement;
  onNodeClick?: (node: Node) => void;
  onNodeDoubleClick?: (node: Node) => void;
  onRelationshipClick?: (relationship: Relationship) => void;
};

/**
 * One NVL instance with our custom pan and zoom interactions.
 * Changing `data` adds, updates and removes elements in place, and re-fits the view once the layout settles.
 */
export const GraphPane = ({
  ref,
  restore,
  onRestored,
  scribble = false,
  onScribbleDone,
  data,
  instanceId,
  renderer,
  canvasAboveZoom,
  minZoom,
  layout = "forceDirected",
  selectOnClick = true,
  minimapContainer,
  onNodeClick,
  onNodeDoubleClick,
  onRelationshipClick,
}: GraphPaneProps) => {
  const nvlRef = useRef<NVL>(null);
  const [nvlReady, setNvlReady] = useState(false);

  // Props read from callbacks NVL captured once, or from handlers created once, go through refs.
  const dataRef = useRef(data);
  dataRef.current = data;
  const scribbleRef = useRef(scribble);
  scribbleRef.current = scribble;
  const onNodeClickRef = useRef(onNodeClick);
  onNodeClickRef.current = onNodeClick;
  const onNodeDoubleClickRef = useRef(onNodeDoubleClick);
  onNodeDoubleClickRef.current = onNodeDoubleClick;
  const onRelationshipClickRef = useRef(onRelationshipClick);
  onRelationshipClickRef.current = onRelationshipClick;
  const onRestoredRef = useRef(onRestored);
  onRestoredRef.current = onRestored;

  // Node ids for fit(), taken from props: asking NVL (getNodes) would read every node's position back from the GPU.
  const nodeIds = useMemo(
    () => data.nodes.map((node) => node.id),
    [data.nodes],
  );
  const nodeIdsRef = useRef(nodeIds);
  nodeIdsRef.current = nodeIds;

  // True while a fit is owed: initially, and whenever nodes or relationships are added or removed.
  const needsFit = useRef(true);
  useEffect(() => {
    needsFit.current = true;
  }, [data.nodes.length, data.relationships.length]);

  const canScribble = onScribbleDone !== undefined;
  const scribbles = useScribbles({
    nvlRef,
    nvlReady,
    enabled: canScribble,
    active: scribble,
    dataRef,
    onDone: onScribbleDone,
  });

  useImperativeHandle(
    ref,
    () => ({
      undoScribble: scribbles.undo,
      discardScribbles: scribbles.discard,
      capture: () => {
        const nvl = nvlRef.current;
        if (!nvl) return null;
        const positions = nvl
          .getNodePositions()
          .map(({ id, x, y }) => ({ id, x: x ?? 0, y: y ?? 0 }));
        const pan = nvl.getPan();

        // The picture shows the whole graph, however the camera is set: NVL's own getImageDataUrl only gives the
        // current view, so a snapshot taken while zoomed in would show a few nodes.
        const container = nvl.getContainer();
        const style = getComputedStyle(container);
        const rect = container.getBoundingClientRect();
        const ratio = window.devicePixelRatio;
        const { nodes, relationships } = dataRef.current;
        const nodeById = new Map(nodes.map((node) => [node.id, node]));
        const image = renderGraphImage({
          nodes: positions.map(({ id, x, y }) => ({
            id,
            x,
            y,
            color: nodeById.get(id)?.color,
            radius: nodeById.get(id)?.size ?? DEFAULT_NODE_SIZE,
          })),
          relationships: relationships.map(({ from, to, color }) => ({
            from,
            to,
            color,
          })),
          // Same pixel size as the live canvas, so the picture has the pane's shape and sharpness.
          width: rect.width * ratio,
          height: rect.height * ratio,
          background:
            style.getPropertyValue("--theme-color-neutral-bg-default").trim() ||
            "white",
          relationshipColor:
            style
              .getPropertyValue("--theme-color-neutral-border-strong")
              .trim() || "gray",
          nodeColor:
            style.getPropertyValue("--theme-color-primary-bg-strong").trim() ||
            "gray",
        });

        return {
          image,
          positions,
          zoom: nvl.getScale(),
          pan: { x: pan.x, y: pan.y },
        };
      },
    }),
    // The scribble functions only touch refs, so the first ones stay valid.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Put the graph back as it was. Declared after the effect that asks for a fit, so on mount it runs after it
  // and the last word on fitting is "don't".
  const restored = useRef(false);
  useEffect(() => {
    const nvl = nvlRef.current;
    if (!restore || restored.current || !nvlReady || !nvl) return;
    restored.current = true;
    needsFit.current = false;
    const present = new Set(nodeIdsRef.current);
    // Without updateLayout the layout freezes with the nodes where they were saved. Letting the simulation
    // resume instead restarts it hot on the fresh instance and moves them, sometimes a long way.
    nvl.setNodePositions(
      restore.positions.filter((position) => present.has(position.id)),
      false,
    );
    nvl.setZoomAndPan(restore.zoom, restore.pan.x, restore.pan.y);
    onRestoredRef.current?.();
  }, [restore, nvlReady]);

  // Switch to Canvas when zoomed in past canvasAboveZoom. A little hysteresis stops it flickering at the threshold.
  const [zoomedIn, setZoomedIn] = useState(false);
  const checkZoomRef = useRef(() => {});
  checkZoomRef.current = () => {
    const scale = nvlRef.current?.getScale();
    if (scale === undefined || canvasAboveZoom === undefined) return;
    setZoomedIn((was) =>
      was ? scale > canvasAboveZoom * 0.95 : scale > canvasAboveZoom,
    );
  };
  const activeRenderer =
    canvasAboveZoom !== undefined && zoomedIn ? "canvas" : renderer;

  // Our custom pan and zoom. The wrapper's own pan and zoom handlers stay off because onPan and onZoomAndPan
  // are never enabled below; neither is its hover handler (onHover), so nothing hit-tests on mouse move.
  useEffect(() => {
    const nvl = nvlRef.current;
    if (!nvlReady || !nvl) return;
    const handlers = [
      // While scribbling the left button draws, so any other button pans, even starting on a node.
      new InertialPanInteraction(nvl, {
        excludeNodes: () => !scribbleRef.current,
        anyButton: () => scribbleRef.current,
      }),
      new SmoothZoomInteraction(nvl, { onZoom: () => checkZoomRef.current() }),
    ];
    return () => handlers.forEach((handler) => handler.destroy());
  }, [nvlReady]);

  // nvlCallbacks are captured once by the wrapper, so keep them stable.
  const nvlCallbacks = useMemo(
    () => ({
      onInitialization: () => setNvlReady(true),
      // fit() and resetZoom() animate the zoom without going through our zoom handler.
      onZoomTransitionDone: () => checkZoomRef.current(),
      // onLayoutDone fires after every re-layout, including after dragging a node, and re-fitting
      // then would make the view jump. So only fit when the set of elements changed (needsFit).
      onLayoutDone: () => {
        const ids = nodeIdsRef.current;
        if (!needsFit.current || ids.length === 0) return;
        needsFit.current = false;
        nvlRef.current?.fit(ids);
      },
    }),
    [],
  );

  const nvlOptions = useMemo(
    () => ({
      layout,
      renderer: activeRenderer,
      instanceId,
      minimapContainer,
      minZoom,
    }),
    [layout, activeRenderer, instanceId, minimapContainer, minZoom],
  );

  // interactionOptions replaces the defaults, so pass everything we want.
  const interactionOptions = useMemo(
    () => ({ selectOnClick }),
    [selectOnClick],
  );

  const mouseEventCallbacks = useMemo(
    () => ({
      // Nodes cannot be dragged while scribbling: `false` makes the wrapper remove its drag handler.
      onDrag: !scribble,
      onNodeClick: (node: Node) => onNodeClickRef.current?.(node),
      onNodeDoubleClick: (node: Node) => onNodeDoubleClickRef.current?.(node),
      onRelationshipClick: (relationship: Relationship) =>
        onRelationshipClickRef.current?.(relationship),
    }),
    [scribble],
  );

  return (
    <>
      {scribbles.grid}
      <InteractiveNvlWrapper
        ref={nvlRef}
        nodes={data.nodes}
        rels={data.relationships}
        nvlOptions={nvlOptions}
        nvlCallbacks={nvlCallbacks}
        interactionOptions={interactionOptions}
        mouseEventCallbacks={mouseEventCallbacks}
      />
      {scribbles.canvas}
    </>
  );
};
