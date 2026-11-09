/**
 * The shapes graphs take in this app, and pure helpers on them. No driver, no NVL runtime, no React, so they
 * can be used and tested anywhere.
 */
import type { Node, Relationship } from "@neo4j-nvl/base";

/** NVL elements, ready to draw. */
export type GraphData = {
  nodes: Node[];
  relationships: Relationship[];
};

/** What a node really is, kept next to the bare NVL element: its labels, for counting and hiding by label. */
export type NodeInfo = { labels: string[] };

/** Query results: NVL elements plus the labels of each node. A data relationship's caption is its type. */
export type DataGraph = GraphData & { nodeInfo: Map<string, NodeInfo> };

/** A (label)-[type]->(label) relationship pattern. */
export type Pattern = { type: string; fromLabel: string; toLabel: string };

/** Identifies a pattern, e.g. in maps. */
export const patternKey = ({ fromLabel, type, toLabel }: Pattern) =>
  `${fromLabel}|${type}|${toLabel}`;

/**
 * Several results as one graph. An element that appears more than once is kept as it was first seen, so
 * put the results whose look (color, caption) should win first.
 */
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
