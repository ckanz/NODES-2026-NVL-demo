import type { Node, NVL, Point, Relationship } from "@neo4j-nvl/base";
import { InteractiveNvlWrapper } from "@neo4j-nvl/react";
import type { Ref } from "react";
import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

import { InertialPanInteraction } from "../interactions/InertialPanInteraction";
import { SmoothZoomInteraction } from "../interactions/SmoothZoomInteraction";
import type { GraphData } from "../data/scene";
import type { ScribbleResult } from "../interactions/scribble";
import { useScribbles } from "../hooks/useScribbles";

export type NodePosition = { id: string; x: number; y: number };

/** Node positions and camera: enough to put a graph back exactly as it was. */
export type ViewState = { positions: NodePosition[]; zoom: number; pan: Point };

export type GraphSnapshot = ViewState & {
  // Never changed in place, so keeping it costs nothing.
  graph: GraphData;
};

export type GraphPaneHandle = {
  /** Null if NVL has not started. */
  capture: () => GraphSnapshot | null;
};

type GraphPaneProps = {
  ref?: Ref<GraphPaneHandle>;
  /** Applied once after NVL starts, instead of the automatic fit. The layout carries on from these positions. */
  restore?: ViewState | null;
  onRestored?: () => void;
  /** While on, the left button draws instead of dragging nodes. Needs `onScribbleDone`. */
  scribble?: boolean;
  onScribbleDone?: (result: ScribbleResult) => void;
  data: GraphData;
  /** Needed when several NVL instances share a page. */
  instanceId: string;
  /** WebGL is faster for big graphs but draws no captions. */
  renderer: "canvas" | "webgl";
  /** Zoom level above which Canvas takes over from `renderer`, so captions show when zoomed in. */
  canvasAboveZoom?: number;
  /** Read only when NVL is created. fit() stops at the same limit. */
  minZoom?: number;
  layout?: "forceDirected" | "hierarchical";
  /** Turn off to control selection through the `selected` property of the elements passed in. */
  selectOnClick?: boolean;
  /** Must already exist when this component mounts, or NVL never starts. */
  minimapContainer?: HTMLElement;
  onNodeClick?: (node: Node) => void;
  onNodeDoubleClick?: (node: Node) => void;
  onRelationshipClick?: (relationship: Relationship) => void;
};

// One NVL instance with our own pan and zoom. Re-fits the view once the layout settles after `data` changes.
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

  // Refs, because NVL callbacks and our handlers are created only once.
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

  // From props: nvl.getNodes() would read every position back from the GPU.
  const nodeIds = useMemo(
    () => data.nodes.map((node) => node.id),
    [data.nodes],
  );
  const nodeIdsRef = useRef(nodeIds);
  nodeIdsRef.current = nodeIds;

  // Fit initially and whenever elements are added or removed.
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
      capture: () => {
        const nvl = nvlRef.current;
        if (!nvl) return null;
        const positions = nvl
          .getNodePositions()
          .map(({ id, x, y }) => ({ id, x: x ?? 0, y: y ?? 0 }));
        const pan = nvl.getPan();
        return {
          graph: dataRef.current,
          positions,
          zoom: nvl.getScale(),
          pan: { x: pan.x, y: pan.y },
        };
      },
    }),
    [],
  );

  // Must stay after the needsFit effect, so on mount it runs last and cancels the fit.
  const restored = useRef(false);
  useEffect(() => {
    const nvl = nvlRef.current;
    if (!restore || restored.current || !nvlReady || !nvl) return;
    restored.current = true;
    needsFit.current = false;
    const present = new Set(nodeIdsRef.current);
    // updateLayout=false keeps nodes where they were saved; otherwise the layout restarts hot and moves them.
    nvl.setNodePositions(
      restore.positions.filter((position) => present.has(position.id)),
      false,
    );
    nvl.setZoomAndPan(restore.zoom, restore.pan.x, restore.pan.y);
    onRestoredRef.current?.();
  }, [restore, nvlReady]);

  // Hysteresis stops the renderer flickering at the threshold.
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

  // The wrapper's own pan, zoom and hover handlers stay off: onPan, onZoomAndPan and onHover are never set.
  useEffect(() => {
    const nvl = nvlRef.current;
    if (!nvlReady || !nvl) return;
    const handlers = [
      // While scribbling, any other button pans, even starting on a node.
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
      // fit() and resetZoom() bypass our zoom handler.
      onZoomTransitionDone: () => checkZoomRef.current(),
      // Also fires after dragging a node, so only fit when needsFit, or the view jumps.
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
      // `false` makes the wrapper remove its drag handler.
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
