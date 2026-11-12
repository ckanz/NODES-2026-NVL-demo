import {
  Banner,
  Box,
  Flex,
  LoadingSpinner,
  Logo,
  OutlinedButton,
  TextLink,
  Typography,
} from "@neo4j-ndl/react";
import {
  CheckIconOutline,
  ClockIconOutline,
  PencilIconOutline,
  TrashIconOutline,
} from "@neo4j-ndl/react/icons";
import type { Node, Relationship } from "@neo4j-nvl/base";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { GraphPane } from "./components/GraphPane";
import type { GraphPaneHandle, ViewState } from "./components/GraphPane";
import { StatOverlay } from "./components/StatOverlay";
import { TimeMachine } from "./components/TimeMachine";
import {
  formatCount,
  formatGraphSummary,
  formatPercent,
  fractionOf,
} from "./utils/format";
import {
  defaultSlice,
  fetchLabel,
  fetchMissingConnections,
  fetchNeighbours,
  fetchRelationship,
  fetchSchema,
  fetchShortestPath,
  MAX_SLICE,
} from "./data/neo4j";
import type { SchemaGraph, Slice } from "./data/neo4j";
import {
  connectionKey,
  countScene,
  isFullyVisible,
  labelKey,
  mergeGraphs,
  patternKey,
  patternTitle,
  relationshipKey,
  revealed,
  sceneFor,
  visibleInSlices,
  withConnections,
  withKey,
  without,
} from "./data/scene";
import type { DataGraph, GraphData, Item, SceneState } from "./data/scene";
import type { ScribbleResult } from "./interactions/scribble";
import type { Snapshot } from "./hooks/useHistory";
import { useHistory } from "./hooks/useHistory";

// NVL's default min zoom (0.075) is too tight for tens of thousands of nodes, and fit() stops there too.
const DATA_MIN_ZOOM = 0.001;

// Schema nodes are drawn larger than NVL's default so their text overlay has room.
const SCHEMA_NODE_SIZE = 70;
// Schema relationship caption size, as a multiple of NVL's default (6px font).
const SCHEMA_CAPTION_SIZE = 3.5;

const errorMessage = (e: unknown) =>
  e instanceof Error ? e.message : String(e);

const SpinnerFill = () => (
  <Flex alignItems="center" justifyContent="center" style={{ height: "100%" }}>
    <LoadingSpinner size="large" />
  </Flex>
);

export const App = () => {
  const [schema, setSchema] = useState<SchemaGraph | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [items, setItems] = useState<ReadonlyMap<string, Item>>(new Map());
  const [hiddenLabels, setHiddenLabels] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [hiddenNodes, setHiddenNodes] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [hiddenRelationships, setHiddenRelationships] = useState<
    ReadonlySet<string>
  >(new Set());
  const [slices, setSlices] = useState<ReadonlyMap<string, Slice>>(new Map());
  const [loadingKeys, setLoadingKeys] = useState<ReadonlySet<string>>(
    new Set(),
  );

  // In state because NVL may only start once this element exists.
  const [minimapEl, setMinimapEl] = useState<HTMLDivElement | null>(null);
  // Scribble mode: the mouse draws on the graph; drawings are applied when it ends.
  const [scribbling, setScribbling] = useState(false);
  // Node positions and camera to apply after a restore; cleared once applied.
  const [restoreView, setRestoreView] = useState<ViewState | null>(null);
  // Changing this starts a fresh data graph; used by restore.
  const [graphKey, setGraphKey] = useState(0);
  const dataPaneRef = useRef<GraphPaneHandle>(null);

  const sceneState = useMemo<SceneState>(
    () => ({ items, hiddenLabels, hiddenNodes, hiddenRelationships, slices }),
    [items, hiddenLabels, hiddenNodes, hiddenRelationships, slices],
  );
  // Refs so event handlers don't read stale state.
  const sceneStateRef = useRef(sceneState);
  sceneStateRef.current = sceneState;
  const loadingRef = useRef(loadingKeys);
  loadingRef.current = loadingKeys;
  const schemaRef = useRef(schema);
  schemaRef.current = schema;

  const setLoading = useCallback(
    (key: string, loading: boolean) =>
      setLoadingKeys((current) => withKey(current, key, loading)),
    [],
  );
  const removeItem = useCallback(
    (...keys: string[]) =>
      setItems((current) => {
        const next = new Map(current);
        for (const key of keys) next.delete(key);
        return next;
      }),
    [],
  );

  // ---- The data graph --------------------------------------------------------------------------------------
  const scene = useMemo(() => sceneFor(sceneState), [sceneState]);
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const sceneCounts = useMemo(() => countScene(scene), [scene]);
  const slicesOnScreen = useMemo(
    () => visibleInSlices(items, scene),
    [items, scene],
  );
  const sceneCountsRef = useRef(sceneCounts);
  sceneCountsRef.current = sceneCounts;
  // Nodes of a label on screen right now.
  const onScreen = (label: string) =>
    sceneCountsRef.current.labels.get(label) ?? 0;
  const countsRef = useRef({ nodes: 0, relationships: 0 });
  countsRef.current = {
    nodes: scene.nodes.length,
    relationships: scene.relationships.length,
  };

  const history = useHistory({
    getState: () => sceneStateRef.current,
    paneRef: dataPaneRef,
    getCounts: () => countsRef.current,
  });
  const { record, close: closeHistory } = history;

  useEffect(() => {
    let cancelled = false;
    fetchSchema()
      .then((result) => !cancelled && setSchema(result))
      .catch((e: unknown) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  const sliceFor = useCallback(
    (label: string): Slice =>
      sceneStateRef.current.slices.get(label) ??
      defaultSlice(schema?.totals.connected.get(label) ?? 0),
    [schema],
  );

  const showLabels = useCallback(
    (labels: string[]) =>
      setHiddenLabels((current) => without(current, labels)),
    [],
  );

  // Bumped by Clear and restore, so queries started earlier drop their results.
  const generation = useRef(0);
  // Call when a query starts; the returned check is false once Clear or restore happened since.
  const startedNow = () => {
    const started = generation.current;
    return () => started === generation.current;
  };

  // The user asked for this data, so anything in it they had hidden comes back.
  const revealAll = useCallback(
    (data: DataGraph) => {
      setHiddenNodes((current) =>
        without(
          current,
          data.nodes.map((node) => node.id),
        ),
      );
      setHiddenRelationships((current) =>
        without(
          current,
          data.relationships.map((rel) => rel.id),
        ),
      );
      showLabels([...data.nodeInfo.values()].flatMap((info) => info.labels));
    },
    [showLabels],
  );

  // Shows hidden nodes after fetching the relationships they need, so both appear together.
  const showWithConnections = useCallback(
    (loadingKey: string, next: SceneState, apply: () => void) => {
      const currentSchema = schemaRef.current;
      if (!currentSchema) return;
      const stillCurrent = startedNow();
      setLoading(loadingKey, true);
      fetchMissingConnections(next, currentSchema)
        .then((connections) => {
          if (!stillCurrent()) return;
          apply();
          setItems((current) => withConnections(current, connections));
        })
        .catch((e: unknown) => stillCurrent() && setError(errorMessage(e)))
        .finally(() => stillCurrent() && setLoading(loadingKey, false));
    },
    [setLoading],
  );

  // No-op if already loaded or loading. `unhide` labels are shown, and with `reveal` anything hidden in the data.
  // The data is applied together with the relationships selected patterns need for it.
  const addItem = useCallback(
    (
      key: string,
      title: string,
      load: () => Promise<DataGraph>,
      unhide: string[] = [],
      reveal = false,
    ) => {
      const currentSchema = schemaRef.current;
      if (
        !currentSchema ||
        loadingRef.current.has(key) ||
        sceneStateRef.current.items.has(key)
      )
        return;
      const stillCurrent = startedNow();
      setError(null);
      setLoading(key, true);
      load()
        .then(async (data) => {
          if (!stillCurrent()) return;
          const state = sceneStateRef.current;
          let next: SceneState = {
            ...state,
            items: new Map(state.items).set(key, { title, data }),
            hiddenLabels: without(state.hiddenLabels, unhide),
          };
          if (reveal) next = revealed(next, data);
          const connections = await fetchMissingConnections(
            next,
            currentSchema,
          );
          if (!stillCurrent()) return;
          record(`Add ${title}`);
          showLabels(unhide);
          if (reveal) revealAll(data);
          setItems((current) =>
            withConnections(
              new Map(current).set(key, { title, data }),
              connections,
            ),
          );
        })
        .catch((e: unknown) => stillCurrent() && setError(errorMessage(e)))
        .finally(() => stillCurrent() && setLoading(key, false));
    },
    [record, showLabels, revealAll, setLoading],
  );

  const clearAll = useCallback(() => {
    record("Clear");
    generation.current += 1;
    setItems(new Map());
    setLoadingKeys(new Set());
    setHiddenLabels(new Set());
    setHiddenNodes(new Set());
    setHiddenRelationships(new Set());
    setSlices(new Map());
    setError(null);
  }, [record]);

  // ---- Schema clicks ---------------------------------------------------------------------------------------

  // A label on screen is removed with its relationships; otherwise its nodes are added alone, without connections.
  const onSchemaNodeClick = useCallback(
    (node: Node) => {
      const label = schema?.labelById.get(node.id);
      if (!schema || !label) return;
      // Its nodes can stay on screen through another selected label, so a second click shows it again.
      if (
        sceneStateRef.current.hiddenLabels.has(label) &&
        (sceneStateRef.current.items.has(labelKey(label)) ||
          onScreen(label) > 0)
      ) {
        const state = sceneStateRef.current;
        showWithConnections(
          `show:${label}`,
          { ...state, hiddenLabels: without(state.hiddenLabels, [label]) },
          () => {
            record(`Show (:${label})`);
            showLabels([label]);
          },
        );
        return;
      }
      if (onScreen(label) > 0) {
        record(`Remove (:${label})`);
        setHiddenLabels((current) => withKey(current, label, true));
        return;
      }
      // Loaded, but none of it on screen (all dismissed): nothing to add.
      if (sceneStateRef.current.items.has(labelKey(label))) return;
      addItem(
        labelKey(label),
        `(:${label})`,
        () => fetchLabel(label, schema.colorFor, sliceFor(label)),
        [label],
      );
    },
    [schema, addItem, record, showLabels, showWithConnections, sliceFor],
  );

  // Adds or removes a pattern. A partly hidden pattern is shown in full first, so a click never removes
  // something you could not fully see.
  const onSchemaRelationshipClick = useCallback(
    (relationship: Relationship) => {
      const pattern = schema?.relationshipById.get(relationship.id);
      if (!schema || !pattern) return;
      const key = relationshipKey(pattern);
      if (loadingRef.current.has(key)) return;

      const { items: currentItems, hiddenRelationships: dismissed } =
        sceneStateRef.current;
      const loaded = currentItems.get(key);
      if (loaded) {
        const connections = currentItems.get(connectionKey(pattern))?.data;
        const partlyHidden =
          !isFullyVisible(loaded.data, sceneRef.current) ||
          (connections?.relationships.some((rel) => dismissed.has(rel.id)) ??
            false);
        if (partlyHidden) {
          const all = connections
            ? mergeGraphs([loaded.data, connections])
            : loaded.data;
          showWithConnections(key, revealed(sceneStateRef.current, all), () => {
            record(`Show ${loaded.title}`);
            revealAll(all);
          });
        } else {
          record(`Remove ${loaded.title}`);
          removeItem(key, connectionKey(pattern));
        }
        return;
      }
      addItem(
        key,
        patternTitle(pattern),
        () => fetchRelationship(pattern, schema.colorFor),
        [pattern.fromLabel, pattern.toLabel],
      );
    },
    [schema, addItem, record, removeItem, revealAll, showWithConnections],
  );

  // Changes that add nodes fetch their relationships first (see addItem). This only catches two loads that
  // overlapped, where neither could know about the other's nodes. Normally it finds nothing missing.
  useEffect(() => {
    if (!schema) return;
    const stillCurrent = startedNow();
    let cancelled = false;
    fetchMissingConnections(sceneState, schema, scene)
      .then((connections) => {
        if (cancelled || !stillCurrent() || connections.length === 0) return;
        setItems((current) => withConnections(current, connections));
      })
      .catch((e: unknown) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [schema, sceneState, scene]);

  // Only the latest slice request per label may land, so a slow one cannot overwrite a newer one.
  const sliceRequests = useRef(new Map<string, number>());

  // A label shown only as a pattern end becomes its own selection. Only currently visible patterns are
  // followed, so nothing new is selected.
  const changeSlice = useCallback(
    (label: string, slice: Slice) => {
      if (!schema) return;
      record(`Change slice of (:${label})`);
      // Set now so the ring stays where dropped while loading; reverted on failure.
      const previous = sceneStateRef.current.slices.get(label);
      setSlices((current) => new Map(current).set(label, slice));
      const key = labelKey(label);

      const request = (sliceRequests.current.get(key) ?? 0) + 1;
      sliceRequests.current.set(key, request);
      const stillCurrent = startedNow();
      const isLatest = () =>
        sliceRequests.current.get(key) === request && stillCurrent();

      const visiblePatterns = [...schema.relationshipById.values()].filter(
        (pattern) =>
          (pattern.fromLabel === label || pattern.toLabel === label) &&
          (sceneCountsRef.current.patterns.get(patternKey(pattern)) ?? 0) > 0,
      );

      setError(null);
      setLoading(key, true);
      fetchLabel(label, schema.colorFor, slice, visiblePatterns)
        .then(async (data) => {
          if (!isLatest()) return;
          const state = sceneStateRef.current;
          const item = {
            title: state.items.get(key)?.title ?? `(:${label})`,
            data,
          };
          const connections = await fetchMissingConnections(
            { ...state, items: new Map(state.items).set(key, item) },
            schema,
          );
          if (!isLatest()) return;
          setItems((current) =>
            withConnections(new Map(current).set(key, item), connections),
          );
        })
        .catch((e: unknown) => {
          if (!isLatest()) return;
          setError(errorMessage(e));
          // The ring must show what is loaded, not the slice that failed.
          setSlices((current) => {
            const next = new Map(current);
            if (previous) next.set(label, previous);
            else next.delete(label);
            return next;
          });
        })
        .finally(() => isLatest() && setLoading(key, false));
    },
    [schema, record, setLoading],
  );

  // ---- History ---------------------------------------------------------------------------------------------

  const restoreSnapshot = useCallback(
    (snapshot: Snapshot) => {
      // Record the current state so going back can be undone.
      record(`Before going back to "${snapshot.reason}"`);
      generation.current += 1; // drop results of queries still running
      setItems(snapshot.items);
      setHiddenLabels(snapshot.hiddenLabels);
      setHiddenNodes(snapshot.hiddenNodes);
      setHiddenRelationships(snapshot.hiddenRelationships);
      setSlices(snapshot.slices);
      setLoadingKeys(new Set());
      setError(null);
      setRestoreView(snapshot.view);
      setGraphKey((key) => key + 1);
      closeHistory();
    },
    [record, closeHistory],
  );

  // ---- Data graph interactions -----------------------------------------------------------------------------

  // Double-click loads a node's neighbours; again removes them.
  const onDataNodeDoubleClick = useCallback(
    (node: Node) => {
      const currentSchema = schemaRef.current;
      if (!currentSchema) return;
      const key = `expand:${node.id}`;
      const title = `connections of ${node.caption ?? "node"}`;
      if (loadingRef.current.has(key)) return;
      if (sceneStateRef.current.items.has(key)) {
        record(`Collapse ${title}`);
        removeItem(key);
        return;
      }
      addItem(
        key,
        title,
        () => fetchNeighbours(node.id, currentSchema.colorFor),
        [],
        true,
      );
    },
    [record, addItem, removeItem],
  );

  const applyScribbles = useCallback(
    ({ dismissNodes, dismissRelationships, paths }: ScribbleResult) => {
      if (dismissNodes.length > 0 || dismissRelationships.length > 0) {
        const plural = (count: number, noun: string) =>
          `${count} ${noun}${count === 1 ? "" : "s"}`;
        const parts = [
          dismissNodes.length > 0 && plural(dismissNodes.length, "node"),
          dismissRelationships.length > 0 &&
            plural(dismissRelationships.length, "relationship"),
        ].filter(Boolean);
        record(`Dismiss ${parts.join(" and ")}`);
        if (dismissNodes.length > 0)
          setHiddenNodes((current) => new Set([...current, ...dismissNodes]));
        if (dismissRelationships.length > 0)
          setHiddenRelationships(
            (current) => new Set([...current, ...dismissRelationships]),
          );
      }

      const currentSchema = schemaRef.current;
      if (!currentSchema) return;
      const caption = (id: string) =>
        sceneRef.current.nodeById.get(id)?.caption ?? "node";
      for (const { from, to } of paths) {
        addItem(
          // Either way round is the same path.
          `path:${[from, to].sort().join("|")}`,
          `shortest path ${caption(from)} to ${caption(to)}`,
          () => fetchShortestPath(from, to, currentSchema.colorFor),
          [],
          true,
        );
      }
    },
    [record, addItem],
  );

  // ---- Scribble mode ---------------------------------------------------------------------------------------
  const isEmpty = scene.nodes.length === 0;
  // Only with a graph to scribble on and the history closed.
  const canScribble = !isEmpty && !history.nowCard;
  useEffect(() => {
    if (!canScribble) setScribbling(false);
  }, [canScribble]);

  // ---- Schema view -----------------------------------------------------------------------------------------

  // NVL overlays are DOM elements: one stable element per schema node, rendered into via a portal.
  const overlayElements = useRef(new Map<string, HTMLElement>());
  const overlayFor = (id: string): HTMLElement => {
    let element = overlayElements.current.get(id);
    if (!element) {
      element = document.createElement("div");
      element.className = "stat-overlay-host";
      overlayElements.current.set(id, element);
    }
    return element;
  };

  // Highlight schema elements visible in the scene or loading. Nodes use an HTML overlay instead of a caption.
  const schemaView = useMemo<GraphData | null>(() => {
    if (!schema) return null;
    const isLabelOn = (label: string) =>
      onScreen(label) > 0 || loadingKeys.has(labelKey(label));
    return {
      nodes: schema.nodes.map((node) => ({
        ...node,
        caption: undefined,
        size: SCHEMA_NODE_SIZE,
        html: overlayFor(node.id),
        selected: isLabelOn(schema.labelById.get(node.id) ?? ""),
      })),
      relationships: schema.relationships.map((rel) => {
        const pattern = schema.relationshipById.get(rel.id);
        if (!pattern) return rel;
        const inScene = sceneCounts.patterns.get(patternKey(pattern)) ?? 0;
        const total = schema.totals.patterns.get(patternKey(pattern)) ?? 0;
        return {
          ...rel,
          caption: `${pattern.type} \u00b7 ${formatCount(inScene)} \u00b7 ${formatPercent(fractionOf(inScene, total))}`,
          captionSize: SCHEMA_CAPTION_SIZE,
          selected: inScene > 0 || loadingKeys.has(relationshipKey(pattern)),
        };
      }),
    };
  }, [schema, loadingKeys, sceneCounts]);

  // Labels shown only as neighbours have no slice yet, so their ring starts at the visible nodes.
  const ringSliceFor = (label: string): Slice => {
    const connected = schema?.totals.connected.get(label) ?? 0;
    if (items.has(labelKey(label)))
      return slices.get(label) ?? defaultSlice(connected);
    return {
      skip: 0,
      count: Math.min(Math.max(onScreen(label), 1), connected),
    };
  };

  return (
    <div className="app ndl-theme-light">
      <header className="app-header">
        <div className="app-header-half">
          <Logo type="icon" color="color" style={{ height: 24 }} />
          <Typography variant="title-4">Schema</Typography>
          <Typography variant="body-medium" className="text-neutral-text-weak">
            {schema
              ? `${schema.nodes.length} labels, ${schema.relationships.length} relationship patterns`
              : "Loading schema"}
          </Typography>
        </div>
        <div className="app-header-half app-header-data">
          <Typography variant="title-4">Data</Typography>
          <Typography variant="body-medium" className="text-neutral-text-weak">
            {formatGraphSummary(scene.nodes.length, scene.relationships.length)}
            {scene.overCap > 0 &&
              ` (limit reached, ${formatCount(scene.overCap)} not shown)`}
          </Typography>
          {loadingKeys.size > 0 && <LoadingSpinner size="small" />}
          <div className="app-header-actions">
            <OutlinedButton
              variant={scribbling ? "primary" : "neutral"}
              size="small"
              isDisabled={!scribbling && !canScribble}
              leadingVisual={
                scribbling ? <CheckIconOutline /> : <PencilIconOutline />
              }
              onClick={() => setScribbling((on) => !on)}
            >
              {scribbling ? "Done" : "Scribble"}
            </OutlinedButton>
            <OutlinedButton
              variant="neutral"
              size="small"
              isDisabled={
                history.snapshots.length === 0 ||
                scribbling ||
                !!history.nowCard
              }
              leadingVisual={<ClockIconOutline />}
              onClick={history.open}
            >
              {`History (${history.snapshots.length})`}
            </OutlinedButton>
            <OutlinedButton
              variant="neutral"
              size="small"
              isDisabled={
                (isEmpty && loadingKeys.size === 0) || !!history.nowCard
              }
              leadingVisual={<TrashIconOutline />}
              onClick={clearAll}
            >
              Clear
            </OutlinedButton>
          </div>
        </div>
      </header>

      <div className="app-body">
        <section className="pane pane-left">
          <div className="graph-fullscreen">
            {schemaView ? (
              // Selection follows what is loaded, so NVL's select-on-click is off. Canvas renderer for captions.
              <GraphPane
                data={schemaView}
                instanceId="schema"
                renderer="canvas"
                layout="hierarchical"
                selectOnClick={false}
                onNodeClick={onSchemaNodeClick}
                onRelationshipClick={onSchemaRelationshipClick}
              />
            ) : (
              !error && <SpinnerFill />
            )}
          </div>

          {schema &&
            schema.nodes.map((node) => {
              const label = schema.labelById.get(node.id) ?? "";
              const connected = schema.totals.connected.get(label) ?? 0;
              return createPortal(
                <StatOverlay
                  title={label}
                  inScene={onScreen(label)}
                  total={schema.totals.labels.get(label) ?? 0}
                  sliceTotal={connected}
                  nodeSize={SCHEMA_NODE_SIZE}
                  selected={onScreen(label) > 0}
                  slice={ringSliceFor(label)}
                  visibleInSlice={slicesOnScreen.get(label)}
                  maxCount={Math.min(connected, MAX_SLICE)}
                  onSliceChange={(slice) => changeSlice(label, slice)}
                />,
                overlayFor(node.id),
                node.id,
              );
            })}
        </section>

        <section className="pane pane-right">
          <div className="graph-fullscreen">
            {/* Unmounted while empty: NVL's WebGL renderer does not redraw after its last nodes are removed. */}
            {isEmpty ? null : minimapEl ? (
              <GraphPane
                key={graphKey}
                ref={dataPaneRef}
                restore={restoreView}
                onRestored={() => setRestoreView(null)}
                scribble={scribbling}
                onScribbleDone={applyScribbles}
                onNodeDoubleClick={onDataNodeDoubleClick}
                data={scene}
                instanceId="data"
                renderer="webgl"
                canvasAboveZoom={1}
                minZoom={DATA_MIN_ZOOM}
                minimapContainer={minimapEl}
              />
            ) : (
              !error && <SpinnerFill />
            )}
          </div>

          {/* Ignores the mouse, so the graph stays usable underneath. */}
          {loadingKeys.size > 0 && (
            <div className="loading-overlay" role="status" aria-live="polite">
              <div className="loading-scrim" />
              <Flex alignItems="center" gap="12" className="loading-content">
                <LoadingSpinner size="large" />
                <Typography variant="subheading-medium">
                  Loading data
                </Typography>
              </Flex>
            </div>
          )}

          {scribbling && (
            <div className="scribble-hint" role="status">
              <Typography variant="subheading-small">Scribble mode</Typography>
              <Typography
                variant="body-small"
                className="text-neutral-text-weak"
              >
                Draw with the mouse. Cross out a node or relationship to dismiss
                it, draw a line from one node to another for the shortest path,
                or circle some nodes and cross the circle to dismiss them all.
                Right-drag pans, scroll zooms. Click Done to apply.
              </Typography>
            </div>
          )}

          {history.nowCard && (
            <TimeMachine
              snapshots={history.snapshots}
              now={history.nowCard}
              onRestore={restoreSnapshot}
              onClose={history.close}
            />
          )}

          {isEmpty && loadingKeys.size === 0 && !error && (
            <div className="empty-hint">
              <Typography
                variant="body-large"
                className="text-neutral-text-weak"
              >
                Click a label or relationship in the schema to show it here
              </Typography>
            </div>
          )}

          <Box padding="2" borderRadius="xl" className="panel panel-minimap">
            <div ref={setMinimapEl} className="minimap-container" />
          </Box>
        </section>
      </div>

      <footer className="app-footer">
        <Typography variant="body-small" className="text-neutral-text-weak">
          Created with the{" "}
          <TextLink type="external" href="https://neo4j.com/docs/nvl/current/">
            Neo4j Visualization Library
          </TextLink>{" "}
          ·{" "}
          <TextLink
            type="external"
            href="https://github.com/ckanz/NODES-2026-demo"
          >
            Source on GitHub
          </TextLink>
        </Typography>
      </footer>

      {error && (
        <div className="panel-error">
          <Banner variant="danger" isAlert hasIcon>
            <Banner.Header>Something went wrong</Banner.Header>
            <Banner.Description>{error}</Banner.Description>
          </Banner>
        </div>
      )}
    </div>
  );
};
