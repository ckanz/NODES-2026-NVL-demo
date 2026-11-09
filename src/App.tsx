import {
  Banner,
  Box,
  Flex,
  LoadingSpinner,
  Logo,
  OutlinedButton,
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
import { mergeGraphs, patternKey } from "./data/graph";
import type { DataGraph, GraphData, Pattern } from "./data/graph";
import {
  defaultSlice,
  fetchConnections,
  fetchLabel,
  fetchNeighbours,
  fetchRelationship,
  fetchSchema,
  fetchShortestPath,
  MAX_SLICE,
} from "./data/neo4j";
import type { SchemaGraph, Slice } from "./data/neo4j";
import {
  buildScene,
  connectionRequests,
  countScene,
  countVisible,
  isFullyVisible,
  sameRequest,
} from "./data/scene";
import type { ConnectionRequest } from "./data/scene";
import type { ScribbleResult } from "./interactions/scribble";
import type { Item, SceneState, Snapshot } from "./data/snapshots";
import { useHistory } from "./hooks/useHistory";
import { useScribbleShortcuts } from "./hooks/useScribbleShortcuts";

// Keys of loaded selections (and of their loading state).
const LABEL_KEY_PREFIX = "node:";
const labelKey = (label: string) => `${LABEL_KEY_PREFIX}${label}`;
const relationshipKey = (pattern: Pattern) => `rel:${patternKey(pattern)}`;
/** Every relationship of a selected pattern between the nodes on screen, kept in step with the scene. */
const CONNECTION_KEY_PREFIX = "conn:";
const connectionKey = (pattern: Pattern) =>
  `${CONNECTION_KEY_PREFIX}${patternKey(pattern)}`;

/** How a pattern reads to the user, e.g. in history: (:From)-[:TYPE]->(:To). */
const patternTitle = ({ fromLabel, type, toLabel }: Pattern) =>
  `(:${fromLabel})-[:${type}]->(:${toLabel})`;

/** How long the scene must stay still before a selected pattern's connections are looked up again. */
const CONNECTION_SYNC_DELAY_MS = 150;

// How far the data graph can be zoomed out. NVL's default (0.075) is too tight for tens of thousands of nodes,
// and fit() stops at the same limit.
const DATA_MIN_ZOOM = 0.001;

// Schema nodes are drawn larger than NVL's default so their text overlay has room.
const SCHEMA_NODE_SIZE = 70;
// Relationship captions in the schema, as a multiple of NVL's default (1, a 6px font). Drawn by NVL on the canvas.
const SCHEMA_CAPTION_SIZE = 3.5;

const errorMessage = (e: unknown) =>
  e instanceof Error ? e.message : String(e);

const withKey = <T,>(
  set: ReadonlySet<T>,
  key: T,
  present: boolean,
): ReadonlySet<T> => {
  if (set.has(key) === present) return set;
  const next = new Set(set);
  if (present) next.add(key);
  else next.delete(key);
  return next;
};

const SpinnerFill = () => (
  <Flex alignItems="center" justifyContent="center" style={{ height: "100%" }}>
    <LoadingSpinner size="large" />
  </Flex>
);

export const App = () => {
  const [schema, setSchema] = useState<SchemaGraph | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The scene: what is loaded and what is hidden (see SceneState).
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
  /** Selections whose query is running. */
  const [loadingKeys, setLoadingKeys] = useState<ReadonlySet<string>>(
    new Set(),
  );

  /** The data graph's minimap. Held in state because NVL may only start once this element exists. */
  const [minimapEl, setMinimapEl] = useState<HTMLDivElement | null>(null);
  /** Scribble mode: the mouse draws on the graph, and what was drawn is acted on when it ends. */
  const [scribbling, setScribbling] = useState(false);
  /** Where to put the nodes and camera after a restore. Cleared once applied. */
  const [restoreView, setRestoreView] = useState<ViewState | null>(null);
  /** Changing this starts a fresh data graph, which is how a restore re-creates the scene. */
  const [graphKey, setGraphKey] = useState(0);
  const dataPaneRef = useRef<GraphPaneHandle>(null);

  // Mirrors of state for event handlers, which must not go stale.
  const sceneStateRef = useRef<SceneState>({
    items,
    hiddenLabels,
    hiddenNodes,
    hiddenRelationships,
    slices,
  });
  sceneStateRef.current = {
    items,
    hiddenLabels,
    hiddenNodes,
    hiddenRelationships,
    slices,
  };
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
    (key: string) =>
      setItems((current) => {
        const next = new Map(current);
        next.delete(key);
        return next;
      }),
    [],
  );

  // ---- The data graph --------------------------------------------------------------------------------------
  const scene = useMemo(
    () => buildScene({ items, hiddenLabels, hiddenNodes, hiddenRelationships }),
    [items, hiddenLabels, hiddenNodes, hiddenRelationships],
  );
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const sceneCounts = useMemo(() => countScene(scene), [scene]);
  /** For each label with a slice of its own, how many of that slice's nodes are on screen (for its ring). */
  const visibleInSlices = useMemo(() => {
    const counts = new Map<string, number>();
    for (const [key, item] of items) {
      if (!key.startsWith(LABEL_KEY_PREFIX)) continue;
      const label = key.slice(LABEL_KEY_PREFIX.length);
      counts.set(label, countVisible(item.data, scene, label));
    }
    return counts;
  }, [items, scene]);
  /** How much of each label and pattern is on screen, for click handlers. */
  const sceneCountsRef = useRef(sceneCounts);
  sceneCountsRef.current = sceneCounts;
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

  const showLabels = useCallback((labels: string[]) => {
    setHiddenLabels((current) => {
      if (!labels.some((label) => current.has(label))) return current;
      const next = new Set(current);
      for (const label of labels) next.delete(label);
      return next;
    });
  }, []);

  /** Bumped by "Clear" and by a restore. Queries started before drop their results instead of adding them back. */
  const generation = useRef(0);
  /** The last connection lookup started for each selected pattern (by patternKey). See the sync effect below. */
  const connectionRequestsRef = useRef(new Map<string, ConnectionRequest>());

  /**
   * Load a selection and add it to the scene. Does nothing if it is loaded or already on its way. `unhide`
   * labels are shown again at the same moment the data arrives, and `onArrive` runs then too.
   */
  const addItem = useCallback(
    (
      key: string,
      title: string,
      load: () => Promise<DataGraph>,
      unhide: string[] = [],
      onArrive?: (data: DataGraph) => void,
    ) => {
      if (loadingRef.current.has(key) || sceneStateRef.current.items.has(key))
        return;
      const started = generation.current;
      const stillCurrent = () => started === generation.current;
      setError(null);
      setLoading(key, true);
      load()
        .then((data) => {
          if (!stillCurrent()) return;
          record(`Add ${title}`);
          showLabels(unhide);
          onArrive?.(data);
          setItems((current) => new Map(current).set(key, { title, data }));
        })
        .catch((e: unknown) => stillCurrent() && setError(errorMessage(e)))
        .finally(() => stillCurrent() && setLoading(key, false));
    },
    [record, showLabels, setLoading],
  );

  /** Remove every node and relationship from the data graph and start over. */
  const clearAll = useCallback(() => {
    record("Clear");
    generation.current += 1;
    connectionRequestsRef.current.clear();
    setItems(new Map());
    setLoadingKeys(new Set());
    setHiddenLabels(new Set());
    setHiddenNodes(new Set());
    setHiddenRelationships(new Set());
    setSlices(new Map());
    setError(null);
  }, [record]);

  /**
   * The user asked for this data (a path, a node's connections, a pattern), so anything in it that they had
   * dismissed or hidden comes back with it.
   */
  const revealAll = useCallback(
    (data: DataGraph) => {
      const nodeIds = new Set(data.nodes.map((node) => node.id));
      const relationshipIds = new Set(data.relationships.map((rel) => rel.id));
      setHiddenNodes((current) =>
        data.nodes.some((node) => current.has(node.id))
          ? new Set([...current].filter((id) => !nodeIds.has(id)))
          : current,
      );
      setHiddenRelationships((current) =>
        data.relationships.some((rel) => current.has(rel.id))
          ? new Set([...current].filter((id) => !relationshipIds.has(id)))
          : current,
      );
      showLabels([...data.nodeInfo.values()].flatMap((info) => info.labels));
    },
    [showLabels],
  );

  // ---- Schema clicks ---------------------------------------------------------------------------------------

  /**
   * Clicking a label that is on screen removes just that label: its nodes and the relationships attached to
   * them. Clicking a label that is not on screen adds its nodes on their own, with no connections and no
   * neighbouring labels. Relationships come from clicking a relationship pattern.
   */
  const onSchemaNodeClick = useCallback(
    (node: Node) => {
      const label = schema?.labelById.get(node.id);
      if (!schema || !label) return;
      if ((sceneCountsRef.current.labels.get(label) ?? 0) > 0) {
        record(`Remove (:${label})`);
        setHiddenLabels((current) => withKey(current, label, true));
        return;
      }
      // Its nodes were loaded before and only hidden: show them again, no query needed.
      if (sceneStateRef.current.items.has(labelKey(label))) {
        if (sceneStateRef.current.hiddenLabels.has(label)) {
          record(`Show (:${label})`);
          showLabels([label]);
        }
        return;
      }
      addItem(
        labelKey(label),
        `(:${label})`,
        () => fetchLabel(label, schema.colorFor, sliceFor(label)),
        [label],
      );
    },
    [schema, addItem, record, showLabels, sliceFor],
  );

  /**
   * Clicking a relationship pattern adds it with its end nodes, or removes it again. A pattern that is loaded
   * but partly hidden (an end label was removed, or some of it was dismissed) is shown in full first, so a
   * click never takes away a pattern you could not fully see.
   */
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
          record(`Show ${loaded.title}`);
          revealAll(
            connections ? mergeGraphs([loaded.data, connections]) : loaded.data,
          );
        } else {
          record(`Remove ${loaded.title}`);
          connectionRequestsRef.current.delete(patternKey(pattern));
          setItems((current) => {
            const next = new Map(current);
            next.delete(key);
            next.delete(connectionKey(pattern));
            return next;
          });
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
    [schema, addItem, record, revealAll],
  );

  // ---- Connections of selected patterns --------------------------------------------------------------------

  /** Connection lookups running. They only show the small spinner: the graph stays fully usable meanwhile. */
  const [syncingConnections, setSyncingConnections] = useState(0);

  /**
   * A selected pattern always shows every one of its relationships between the nodes on screen, whatever brought
   * those nodes in (a label, a slice, an expansion, a path, unhiding). Once the scene settles, any selected pattern
   * whose end nodes changed is looked up again. The lookup returns relationships only, so it never adds a node and
   * cannot set itself off again.
   */
  useEffect(() => {
    if (!schema) return;
    const timer = setTimeout(() => {
      const selected = [...schema.relationshipById.values()].filter((pattern) =>
        items.has(relationshipKey(pattern)),
      );
      const requests = connectionRequests(scene, selected);

      // Patterns no longer selected, or with nothing on screen at one end, need no connections.
      const stale = [...connectionRequestsRef.current.keys()].filter(
        (key) => !requests.has(key),
      );
      for (const key of stale) connectionRequestsRef.current.delete(key);
      const staleItems = [...items.keys()].filter(
        (key) =>
          key.startsWith(CONNECTION_KEY_PREFIX) &&
          !requests.has(key.slice(CONNECTION_KEY_PREFIX.length)),
      );
      if (staleItems.length > 0) {
        setItems((current) => {
          const next = new Map(current);
          for (const key of staleItems) next.delete(key);
          return next;
        });
      }

      const started = generation.current;
      for (const [key, request] of requests) {
        if (sameRequest(connectionRequestsRef.current.get(key), request))
          continue;
        connectionRequestsRef.current.set(key, request);
        // Only the latest lookup for a pattern may land, and none from before a Clear or a restore.
        const isLatest = () =>
          connectionRequestsRef.current.get(key) === request &&
          started === generation.current;
        setSyncingConnections((count) => count + 1);
        fetchConnections(
          request.pattern,
          request.fromIds,
          request.toIds,
          schema.colorFor,
        )
          .then((data) => {
            if (!isLatest()) return;
            setItems((current) =>
              // The pattern may have been removed while this ran.
              current.has(relationshipKey(request.pattern))
                ? new Map(current).set(connectionKey(request.pattern), {
                    title: `connections of ${patternTitle(request.pattern)}`,
                    data,
                  })
                : current,
            );
          })
          .catch((e: unknown) => {
            if (!isLatest()) return;
            // Forget it, so the next change to the scene tries again.
            connectionRequestsRef.current.delete(key);
            setError(errorMessage(e));
          })
          .finally(() => setSyncingConnections((count) => count - 1));
      }
    }, CONNECTION_SYNC_DELAY_MS);
    return () => clearTimeout(timer);
  }, [schema, items, scene]);

  // Only the latest slice request for a label may update the view, so a slow one cannot overwrite a newer one.
  const sliceRequests = useRef(new Map<string, number>());

  /**
   * The user dragged a label's ring: remember the slice and load it. A label that was only on screen as an
   * end of a relationship pattern becomes a selection of its own, as if it had been clicked. Connections are
   * only followed for the relationship patterns visible right now, so nothing new is selected.
   */
  const changeSlice = useCallback(
    (label: string, slice: Slice) => {
      if (!schema) return;
      record(`Change slice of (:${label})`);
      // Shown straight away, so the ring stays where it was dropped while the nodes load; undone if they cannot be.
      const previous = sceneStateRef.current.slices.get(label);
      setSlices((current) => new Map(current).set(label, slice));
      const key = labelKey(label);

      const request = (sliceRequests.current.get(key) ?? 0) + 1;
      sliceRequests.current.set(key, request);
      const started = generation.current;
      const isLatest = () =>
        sliceRequests.current.get(key) === request &&
        started === generation.current;

      const visiblePatterns = [...schema.relationshipById.values()].filter(
        (pattern) =>
          (pattern.fromLabel === label || pattern.toLabel === label) &&
          (sceneCountsRef.current.patterns.get(patternKey(pattern)) ?? 0) > 0,
      );

      setError(null);
      setLoading(key, true);
      fetchLabel(label, schema.colorFor, slice, visiblePatterns)
        .then((data) => {
          if (!isLatest()) return;
          setItems((current) =>
            new Map(current).set(key, {
              title: current.get(key)?.title ?? `(:${label})`,
              data,
            }),
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

  /** Go back to a snapshot: its data, hidden labels and slices, then its node positions and camera. */
  const restoreSnapshot = useCallback(
    (snapshot: Snapshot) => {
      // Going back is a change too. Keep where we were, so it can be undone.
      record(`Before going back to "${snapshot.reason}"`);
      generation.current += 1; // queries still running would otherwise land on top of the restored graph
      connectionRequestsRef.current.clear(); // look the restored scene's connections up afresh
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

  /**
   * Double-clicking a node shows everything one hop away from it. Double-click it again to take those
   * connections away. Like everything else, this is a step in the history.
   */
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
        revealAll,
      );
    },
    [record, addItem, removeItem, revealAll],
  );

  /** What the user's scribbles asked for, applied when scribble mode ends. */
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
          revealAll,
        );
      }
    },
    [record, addItem, revealAll],
  );

  // ---- Scribble mode ---------------------------------------------------------------------------------------
  const isEmpty = scene.nodes.length === 0;
  // Scribble mode can only be on while there is a graph to scribble on and the history is closed.
  const canScribble = !isEmpty && !history.nowCard;
  useEffect(() => {
    if (!canScribble) setScribbling(false);
  }, [canScribble]);
  useScribbleShortcuts({
    scribbling,
    canScribble,
    setScribbling,
    paneRef: dataPaneRef,
  });

  // ---- Schema view -----------------------------------------------------------------------------------------

  // NVL takes DOM elements for overlays. We make one per schema node and render React into it through a
  // portal, so the same element stays put while its numbers change.
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

  // A schema element is highlighted while it is visible in the scene (or on its way): the labels and
  // relationship patterns you selected, and the end labels a pattern brought in.
  // Nodes drop their built-in caption for an HTML overlay; relationships keep theirs, with the numbers added.
  const schemaView = useMemo<GraphData | null>(() => {
    if (!schema) return null;
    const isLabelOn = (label: string) =>
      (sceneCounts.labels.get(label) ?? 0) > 0 ||
      loadingKeys.has(labelKey(label));
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

  /**
   * The slice a label's ring shows. A label you selected has its own slice. One that is only on screen as a
   * neighbour has none yet, so its ring starts as the nodes currently visible, from the first node on:
   * dragging it turns it into a selection of its own.
   */
  const ringSliceFor = (label: string): Slice => {
    const connected = schema?.totals.connected.get(label) ?? 0;
    if (items.has(labelKey(label)))
      return slices.get(label) ?? defaultSlice(connected);
    return {
      skip: 0,
      count: Math.min(
        Math.max(sceneCounts.labels.get(label) ?? 0, 1),
        connected,
      ),
    };
  };

  return (
    <div className="app ndl-theme-light">
      <section className="pane pane-left">
        <div className="graph-fullscreen">
          {schemaView ? (
            // Selection is driven by what is loaded, so NVL's own select-on-click is off. The schema has
            // captions (labels and types), so it uses the Canvas renderer.
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
                inScene={sceneCounts.labels.get(label) ?? 0}
                total={schema.totals.labels.get(label) ?? 0}
                sliceTotal={connected}
                nodeSize={SCHEMA_NODE_SIZE}
                selected={(sceneCounts.labels.get(label) ?? 0) > 0}
                slice={ringSliceFor(label)}
                visibleInSlice={visibleInSlices.get(label)}
                maxCount={Math.min(connected, MAX_SLICE)}
                onSliceChange={(slice) => changeSlice(label, slice)}
              />,
              overlayFor(node.id),
              node.id,
            );
          })}

        <Box padding="16" borderRadius="xl" className="panel panel-title">
          <Flex gap="4">
            <Flex flexDirection="row" alignItems="center" gap="12">
              <Logo type="icon" color="color" style={{ height: 28 }} />
              <Typography variant="title-3">Schema</Typography>
            </Flex>
            <Typography
              variant="body-medium"
              className="text-neutral-text-weak"
            >
              {schema
                ? `${schema.nodes.length} labels, ${schema.relationships.length} relationship patterns`
                : "Loading schema"}
            </Typography>
          </Flex>
        </Box>
      </section>

      <section className="pane pane-right">
        <div className="graph-fullscreen">
          {/* NVL may only start once the minimap element exists. The graph is unmounted while empty: NVL's WebGL
              renderer does not redraw after its last nodes are removed, so the old picture would stay on screen.
              A fresh instance is created when data arrives. */}
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

        <div className="panel-actions">
          <OutlinedButton
            variant={scribbling ? "primary" : "neutral"}
            size="medium"
            isFloating
            isDisabled={!scribbling && !canScribble}
            leadingVisual={
              scribbling ? <CheckIconOutline /> : <PencilIconOutline />
            }
            onClick={() => setScribbling((on) => !on)}
          >
            {scribbling ? "Done (S)" : "Scribble (S)"}
          </OutlinedButton>
          <OutlinedButton
            variant="neutral"
            size="medium"
            isFloating
            isDisabled={history.snapshots.length === 0 || scribbling}
            leadingVisual={<ClockIconOutline />}
            onClick={history.open}
          >
            {`History (${history.snapshots.length})`}
          </OutlinedButton>
          <OutlinedButton
            variant="neutral"
            size="medium"
            isFloating
            isDisabled={isEmpty && loadingKeys.size === 0}
            leadingVisual={<TrashIconOutline />}
            onClick={clearAll}
          >
            Clear
          </OutlinedButton>
        </div>

        {/* Over the data graph while a query runs. It ignores the mouse, so the graph stays usable underneath. */}
        {loadingKeys.size > 0 && (
          <div className="loading-overlay" role="status" aria-live="polite">
            <div className="loading-scrim" />
            <Flex alignItems="center" gap="12" className="loading-content">
              <LoadingSpinner size="large" />
              <Typography variant="subheading-medium">Loading data</Typography>
            </Flex>
          </div>
        )}

        {scribbling && (
          <div className="scribble-hint" role="status">
            <Typography variant="subheading-small">Scribble mode</Typography>
            <Typography variant="body-small" className="text-neutral-text-weak">
              Draw with the mouse. Cross out a node or relationship to dismiss
              it, draw a line from one node to another for the shortest path, or
              circle some nodes and cross the circle to dismiss them all.
              Right-drag pans, scroll zooms. S applies, Backspace undoes a
              stroke, Esc cancels.
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
            <Typography variant="body-large" className="text-neutral-text-weak">
              Click a label or relationship in the schema to show it here
            </Typography>
          </div>
        )}

        <Box padding="16" borderRadius="xl" className="panel panel-title">
          <Flex gap="4">
            <Flex flexDirection="row" alignItems="center" gap="12">
              <Typography variant="title-3">Data</Typography>
              {(loadingKeys.size > 0 || syncingConnections > 0) && (
                <LoadingSpinner size="small" />
              )}
            </Flex>
            <Typography
              variant="body-medium"
              className="text-neutral-text-weak"
            >
              {formatGraphSummary(
                scene.nodes.length,
                scene.relationships.length,
              )}
            </Typography>
          </Flex>
        </Box>

        <Box padding="2" borderRadius="xl" className="panel panel-minimap">
          <div ref={setMinimapEl} className="minimap-container" />
        </Box>
      </section>

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
