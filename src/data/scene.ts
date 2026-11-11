// The data graph and what is on screen. Pure functions: no driver, no React.
import type { Node, Relationship } from "@neo4j-nvl/base";

import type { Slice } from "./neo4j";

export type GraphData = {
  nodes: Node[];
  relationships: Relationship[];
};

export type NodeInfo = { labels: string[] };

// A data relationship's caption is its type.
export type DataGraph = GraphData & { nodeInfo: Map<string, NodeInfo> };

// (fromLabel)-[type]->(toLabel)
export type Pattern = { type: string; fromLabel: string; toLabel: string };

export const patternKey = ({ fromLabel, type, toLabel }: Pattern) =>
  `${fromLabel}|${type}|${toLabel}`;

// The first occurrence of an element wins, so put the results whose look should win first.
export const mergeGraphs = (graphs: Iterable<DataGraph>): DataGraph => {
  const nodes = new Map<string, Node>();
  const relationships = new Map<string, Relationship>();
  const nodeInfo = new Map<string, NodeInfo>();
  for (const graph of graphs) {
    for (const node of graph.nodes)
      if (!nodes.has(node.id)) nodes.set(node.id, node);
    for (const rel of graph.relationships)
      if (!relationships.has(rel.id)) relationships.set(rel.id, rel);
    for (const [id, info] of graph.nodeInfo)
      if (!nodeInfo.has(id)) nodeInfo.set(id, info);
  }
  return {
    nodes: [...nodes.values()],
    relationships: [...relationships.values()],
    nodeInfo,
  };
};

// What one click on the schema loaded.
export type Item = { title: string; data: DataGraph };

// Never changed in place, so keeping the references is enough to restore a state later.
export type SceneState = {
  items: ReadonlyMap<string, Item>;
  hiddenLabels: ReadonlySet<string>;
  /** Dismissed by scribbling. */
  hiddenNodes: ReadonlySet<string>;
  hiddenRelationships: ReadonlySet<string>;
  /** Labels not listed use their default slice. */
  slices: ReadonlyMap<string, Slice>;
};

// Most nodes drawn at once. Beyond it, the most recently loaded nodes are left out.
export const MAX_SCENE_NODES = 30_000;

export type Scene = DataGraph & {
  nodeById: Map<string, Node>;
  // Nodes left out because of MAX_SCENE_NODES.
  overCap: number;
};

/**
 * Labels sliced with the ring, with their slice's nodes. Other nodes of those labels are not drawn unless `keep`
 * holds them (nodes from an expansion or a path).
 */
export type SliceRestriction = {
  slicedLabels: Map<string, Set<string>>;
  keep: Set<string>;
};

// Unsliced labels never exclude a node.
const outsideSlices = (
  id: string,
  labels: string[],
  { slicedLabels, keep }: SliceRestriction,
) => {
  if (keep.has(id)) return false;
  const slices = labels.flatMap((label) => slicedLabels.get(label) ?? []);
  return slices.length > 0 && !slices.some((slice) => slice.has(id));
};

/**
 * Everything selected, minus hidden labels, dismissed nodes and relationships, nodes outside a ring slice, and
 * relationships that lost an end.
 */
export const buildScene = (
  {
    items,
    hiddenLabels,
    hiddenNodes,
    hiddenRelationships,
  }: Omit<SceneState, "slices">,
  restriction?: SliceRestriction,
  // Labels the user selected. A node with a hidden label stays if it also has one of these that isn't hidden.
  selectedLabels: ReadonlySet<string> = new Set(),
): Scene => {
  const hiddenByLabel = (labels: string[]) =>
    labels.some((label) => hiddenLabels.has(label)) &&
    !labels.some(
      (label) => selectedLabels.has(label) && !hiddenLabels.has(label),
    );

  const merged = mergeGraphs([...items.values()].map((item) => item.data));
  const nodeInfo = new Map(merged.nodeInfo);
  const nodeById = new Map(merged.nodes.map((node) => [node.id, node]));

  for (const [id, info] of nodeInfo) {
    if (
      hiddenNodes.has(id) ||
      hiddenByLabel(info.labels) ||
      (restriction && outsideSlices(id, info.labels, restriction))
    ) {
      nodeById.delete(id);
      nodeInfo.delete(id);
    }
  }
  for (const id of hiddenNodes) nodeById.delete(id);

  // Map order is load order, so the oldest nodes are kept.
  const overCap = Math.max(0, nodeById.size - MAX_SCENE_NODES);
  for (const id of [...nodeById.keys()].slice(MAX_SCENE_NODES)) {
    nodeById.delete(id);
    nodeInfo.delete(id);
  }

  const relationships = merged.relationships.filter(
    (rel) =>
      !hiddenRelationships.has(rel.id) &&
      nodeById.has(rel.from) &&
      nodeById.has(rel.to),
  );
  return {
    nodes: [...nodeById.values()],
    relationships,
    nodeInfo,
    nodeById,
    overCap,
  };
};

// A selection can be loaded but partly hidden, by a removed label or dismissed elements.
export const isFullyVisible = (data: DataGraph, scene: Scene): boolean => {
  const shownRelationships = new Set(scene.relationships.map((rel) => rel.id));
  return (
    data.nodes.every((node) => scene.nodeById.has(node.id)) &&
    data.relationships.every((rel) => shownRelationships.has(rel.id))
  );
};

export const countVisible = (
  data: DataGraph,
  scene: Scene,
  label: string,
): number => {
  let count = 0;
  for (const [id, info] of data.nodeInfo)
    if (info.labels.includes(label) && scene.nodeById.has(id)) count += 1;
  return count;
};

// Ids are sorted, so requests compare cheaply.
export type ConnectionRequest = {
  pattern: Pattern;
  fromIds: string[];
  toIds: string[];
};

// The on-screen nodes at each end of every selected pattern. Patterns with an empty end are left out.
export const connectionRequests = (
  scene: Scene,
  patterns: Iterable<Pattern>,
): Map<string, ConnectionRequest> => {
  const idsByLabel = new Map<string, string[]>();
  for (const [id, info] of scene.nodeInfo) {
    for (const label of info.labels) {
      const ids = idsByLabel.get(label);
      if (ids) ids.push(id);
      else idsByLabel.set(label, [id]);
    }
  }
  for (const ids of idsByLabel.values()) ids.sort();

  const requests = new Map<string, ConnectionRequest>();
  for (const pattern of patterns) {
    const fromIds = idsByLabel.get(pattern.fromLabel) ?? [];
    const toIds = idsByLabel.get(pattern.toLabel) ?? [];
    if (fromIds.length > 0 && toIds.length > 0)
      requests.set(patternKey(pattern), { pattern, fromIds, toIds });
  }
  return requests;
};

const sameIds = (a: string[], b: string[]) =>
  a.length === b.length && a.every((id, index) => id === b[index]);

export const sameRequest = (
  a: ConnectionRequest | undefined,
  b: ConnectionRequest,
) =>
  a !== undefined &&
  patternKey(a.pattern) === patternKey(b.pattern) &&
  sameIds(a.fromIds, b.fromIds) &&
  sameIds(a.toIds, b.toIds);

export const countScene = ({ nodeInfo, relationships }: Scene) => {
  const labels = new Map<string, number>();
  const patterns = new Map<string, number>();
  const bump = (map: Map<string, number>, key: string) =>
    map.set(key, (map.get(key) ?? 0) + 1);
  for (const info of nodeInfo.values())
    for (const label of info.labels) bump(labels, label);
  for (const rel of relationships) {
    // A data relationship's caption is its type.
    const type = rel.caption ?? "";
    for (const fromLabel of nodeInfo.get(rel.from)?.labels ?? []) {
      for (const toLabel of nodeInfo.get(rel.to)?.labels ?? [])
        bump(patterns, patternKey({ fromLabel, type, toLabel }));
    }
  }
  return { labels, patterns };
};
