/**
 * The data graph on screen, worked out from what is loaded and what the user hid. Pure functions: no React.
 */
import type { Node } from "@neo4j-nvl/base";

import { mergeGraphs, patternKey } from "./graph";
import type { DataGraph, Pattern } from "./graph";
import type { SceneState } from "./snapshots";

export type Scene = DataGraph & { nodeById: Map<string, Node> };

/**
 * Everything selected, de-duplicated (a node reached by two selections is drawn once), minus what the user took
 * away: hidden labels, and nodes and relationships dismissed one by one. Then any relationship that lost an end.
 */
export const buildScene = ({
  items,
  hiddenLabels,
  hiddenNodes,
  hiddenRelationships,
}: Omit<SceneState, "slices">): Scene => {
  const merged = mergeGraphs([...items.values()].map((item) => item.data));
  const nodeInfo = new Map(merged.nodeInfo);
  const nodeById = new Map(merged.nodes.map((node) => [node.id, node]));

  for (const [id, info] of nodeInfo) {
    if (
      hiddenNodes.has(id) ||
      info.labels.some((label) => hiddenLabels.has(label))
    ) {
      nodeById.delete(id);
      nodeInfo.delete(id);
    }
  }
  for (const id of hiddenNodes) nodeById.delete(id);

  const relationships = merged.relationships.filter(
    (rel) =>
      !hiddenRelationships.has(rel.id) &&
      nodeById.has(rel.from) &&
      nodeById.has(rel.to),
  );
  return { nodes: [...nodeById.values()], relationships, nodeInfo, nodeById };
};

/**
 * Whether everything a selection loaded is on screen. It can be loaded but partly hidden: an end label was
 * removed (possibly a second label of its nodes), or some of its nodes or relationships were dismissed.
 */
export const isFullyVisible = (data: DataGraph, scene: Scene): boolean => {
  const shownRelationships = new Set(scene.relationships.map((rel) => rel.id));
  return (
    data.nodes.every((node) => scene.nodeById.has(node.id)) &&
    data.relationships.every((rel) => shownRelationships.has(rel.id))
  );
};

/** How many of the nodes a selection loaded for `label` are on screen. */
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

/** Which nodes on screen a selected pattern must be connected between. Ids are sorted, so requests compare cheaply. */
export type ConnectionRequest = {
  pattern: Pattern;
  fromIds: string[];
  toIds: string[];
};

/**
 * For each selected pattern, the nodes on screen at each of its ends: every relationship of the pattern between
 * them belongs in the scene. A node with several labels counts for each of them. Patterns with nothing on screen
 * at one end need nothing, so they are left out.
 */
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

/** Whether two requests ask for the same thing, so the earlier answer still holds. */
export const sameRequest = (
  a: ConnectionRequest | undefined,
  b: ConnectionRequest,
) =>
  a !== undefined &&
  patternKey(a.pattern) === patternKey(b.pattern) &&
  sameIds(a.fromIds, b.fromIds) &&
  sameIds(a.toIds, b.toIds);

/** How many nodes of each label, and relationships of each pattern (by patternKey), are on screen. */
export const countScene = ({ nodeInfo, relationships }: Scene) => {
  const labels = new Map<string, number>();
  const patterns = new Map<string, number>();
  const bump = (map: Map<string, number>, key: string) =>
    map.set(key, (map.get(key) ?? 0) + 1);
  for (const info of nodeInfo.values())
    for (const label of info.labels) bump(labels, label);
  for (const rel of relationships) {
    // A data relationship's caption is its type (see toGraphData).
    const type = rel.caption ?? "";
    for (const fromLabel of nodeInfo.get(rel.from)?.labels ?? []) {
      for (const toLabel of nodeInfo.get(rel.to)?.labels ?? [])
        bump(patterns, patternKey({ fromLabel, type, toLabel }));
    }
  }
  return { labels, patterns };
};
