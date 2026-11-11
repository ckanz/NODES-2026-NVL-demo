// The Neo4j connection and the app's queries. Each query returns a DataGraph.
import { tokens } from "@neo4j-ndl/base";
import { nvlResultTransformer } from "@neo4j-nvl/base";
import type { Node, Relationship } from "@neo4j-nvl/base";
import neo4j from "neo4j-driver";
import type {
  Integer,
  Node as Neo4jNode,
  Record as Neo4jRecord,
  Relationship as Neo4jRelationship,
} from "neo4j-driver";

import { patternKey } from "./scene";
import type { DataGraph, GraphData, NodeInfo, Pattern } from "./scene";

// ---- Connection -------------------------------------------------------------------------------------------

// Set at build time. These end up in the browser bundle, password included: use a read-only database user.
const driver = neo4j.driver(
  process.env.NEO4J_URI ?? "bolt://localhost:7687",
  neo4j.auth.basic(
    process.env.NEO4J_USERNAME ?? "neo4j",
    process.env.NEO4J_PASSWORD ?? "password",
  ),
);

const queryConfig = {
  database: process.env.NEO4J_DATABASE ?? "neo4j",
  routing: neo4j.routing.READ,
  transactionConfig: { timeout: 60_000 },
};

// `preferred` labels take priority when picking node colors.
const runGraph = async (
  query: string,
  params: Record<string, unknown>,
  colorFor: ColorFor,
  preferred: string[] = [],
): Promise<DataGraph> => {
  const result = await driver.executeQuery(query, params, {
    ...queryConfig,
    resultTransformer: nvlResultTransformer,
  });
  return toGraphData(result, colorFor, preferred);
};

const quote = (name: string) => `\`${name.replace(/`/g, "``")}\``;

// ---- Turning results into NVL elements --------------------------------------------------------------------

// One color per label, the same in the schema and the data view.
export type ColorFor = (label: string) => string;

const palette = Object.values(tokens.graph);
const makeColorFor = (labels: string[]): ColorFor => {
  const byLabel = new Map(
    [...labels].sort().map((label, i) => [label, palette[i % palette.length]]),
  );
  return (label) => byLabel.get(label) ?? palette[0];
};

/**
 * Adds captions and colors to nvlResultTransformer's bare elements and drops duplicates. A multi-label node takes
 * the color of its first `preferred` label, to match the schema node the user clicked.
 */
const toGraphData = (
  {
    nodes,
    relationships,
    recordObjectMap,
  }: Awaited<ReturnType<typeof nvlResultTransformer>>,
  colorFor: ColorFor,
  preferred: string[],
): DataGraph => {
  const uniqueNodes = new Map<string, Node>();
  const nodeInfo = new Map<string, NodeInfo>();
  for (const node of nodes) {
    if (uniqueNodes.has(node.id)) continue;
    const { labels, properties } = recordObjectMap.get(node.id) as Neo4jNode;
    nodeInfo.set(node.id, { labels });
    uniqueNodes.set(node.id, {
      ...node,
      caption: String(
        properties.name ?? properties.ip ?? properties.type ?? labels[0],
      ),
      color: colorFor(labels.find((l) => preferred.includes(l)) ?? labels[0]),
    });
  }

  const uniqueRels = new Map<string, Relationship>();
  for (const rel of relationships) {
    const { type } = recordObjectMap.get(rel.id) as Neo4jRelationship;
    // The caption is the type: the scene counts patterns by it.
    uniqueRels.set(rel.id, { ...rel, caption: type });
  }

  return {
    nodes: [...uniqueNodes.values()],
    relationships: [...uniqueRels.values()],
    nodeInfo,
  };
};

// ---- Schema -----------------------------------------------------------------------------------------------

export type SchemaTotals = {
  labels: Map<string, number>;
  /** Nodes with at least one relationship. The ring slices over these. */
  connected: Map<string, number>;
  /** Keyed by patternKey. */
  patterns: Map<string, number>;
};

export type SchemaGraph = GraphData & {
  totals: SchemaTotals;
  colorFor: ColorFor;
  labelById: Map<string, string>;
  relationshipById: Map<string, Pattern>;
};

// The query must return its count as `c`.
const countBy = async (query: string, key: (row: Neo4jRecord) => string) => {
  const { records } = await driver.executeQuery(query, {}, queryConfig);
  return new Map(
    records.map((row) => [key(row), (row.get("c") as Integer).toNumber()]),
  );
};

const fetchTotals = async (): Promise<SchemaTotals> => {
  const byLabel = (row: Neo4jRecord) => row.get("label") as string;
  const [labels, connected, patterns] = await Promise.all([
    countBy(
      "MATCH (n) UNWIND labels(n) AS label RETURN label, count(*) AS c",
      byLabel,
    ),
    countBy(
      "MATCH (n) WHERE EXISTS { (n)--() } UNWIND labels(n) AS label RETURN label, count(*) AS c",
      byLabel,
    ),
    countBy(
      `MATCH (a)-[r]->(b) UNWIND labels(a) AS fromLabel UNWIND labels(b) AS toLabel
       RETURN fromLabel, type(r) AS type, toLabel, count(*) AS c`,
      (row) =>
        patternKey({
          fromLabel: row.get("fromLabel"),
          type: row.get("type"),
          toLabel: row.get("toLabel"),
        }),
    ),
  ]);
  return { labels, connected, patterns };
};

/**
 * One node per label, one relationship per pattern. db.schema.visualization() can give a node and a relationship
 * the same id, which nvlResultTransformer can't handle, so the raw records are read and given ids of their own.
 */
export const fetchSchema = async (): Promise<SchemaGraph> => {
  const [schemaResult, totals] = await Promise.all([
    driver.executeQuery("CALL db.schema.visualization()", {}, queryConfig),
    fetchTotals(),
  ]);
  const record = schemaResult.records[0];
  const rawNodes: Neo4jNode[] = record?.get("nodes") ?? [];
  const rawRelationships: Neo4jRelationship[] =
    record?.get("relationships") ?? [];

  const labelByElementId = new Map(
    rawNodes.map((node) => [node.elementId, node.labels[0]]),
  );
  const labels = [...new Set(labelByElementId.values())];
  const colorFor = makeColorFor(labels);
  const nodeId = (label: string) => `label:${label}`;
  const nodes: Node[] = labels.map((label) => ({
    id: nodeId(label),
    caption: label,
    color: colorFor(label),
  }));

  const relationshipById = new Map<string, Pattern>();
  for (const rel of rawRelationships) {
    const fromLabel = labelByElementId.get(rel.startNodeElementId);
    const toLabel = labelByElementId.get(rel.endNodeElementId);
    if (!fromLabel || !toLabel) continue;
    const pattern = { type: rel.type, fromLabel, toLabel };
    relationshipById.set(`pattern:${patternKey(pattern)}`, pattern);
  }
  const relationships: Relationship[] = [...relationshipById].map(
    ([id, { type, fromLabel, toLabel }]) => ({
      id,
      from: nodeId(fromLabel),
      to: nodeId(toLabel),
      caption: type,
    }),
  );

  return {
    nodes,
    relationships,
    totals,
    colorFor,
    labelById: new Map(labels.map((label) => [nodeId(label), label])),
    relationshipById,
  };
};

// ---- Data -------------------------------------------------------------------------------------------------

// Cap for a pattern click or a node expansion.
const QUERY_LIMIT = 1000;
// Largest slice the ring can select. Guards the browser, not the database.
export const MAX_SLICE = 30_000;

export type Slice = { skip: number; count: number };

export const defaultSlice = (connectedTotal: number): Slice => ({
  skip: 0,
  count: Math.min(connectedTotal, QUERY_LIMIT),
});

/**
 * One slice of a label's connected nodes, in a fixed order so slices line up, plus their `patterns`
 * relationships: up to 25 per node, fewer in big slices so the total stays around 25,000.
 */
export const fetchLabel = (
  label: string,
  colorFor: ColorFor,
  slice: Slice,
  patterns: Pattern[] = [],
): Promise<DataGraph> => {
  const count = Math.min(slice.count, MAX_SLICE);
  const perNode = Math.max(1, Math.min(25, Math.floor(25_000 / count)));
  return runGraph(
    `MATCH (n:${quote(label)}) WHERE EXISTS { (n)--() }
     WITH n ORDER BY elementId(n) SKIP $skip LIMIT $limit
     CALL (n) {
       // A relationship matches a pattern when its type and the labels at both ends line up.
       OPTIONAL MATCH (n)-[r]-(m)
       WHERE any(p IN $patterns WHERE type(r) = p.type AND (
         (startNode(r) = n AND p.fromLabel IN labels(n) AND p.toLabel IN labels(m)) OR
         (endNode(r) = n AND p.toLabel IN labels(n) AND p.fromLabel IN labels(m))
       ))
       RETURN r, m LIMIT $perNode
     }
     RETURN n, r, m`,
    {
      skip: neo4j.int(slice.skip),
      limit: neo4j.int(count),
      perNode: neo4j.int(perNode),
      patterns,
    },
    colorFor,
    [label],
  );
};

export const fetchRelationship = (
  { type, fromLabel, toLabel }: Pattern,
  colorFor: ColorFor,
): Promise<DataGraph> =>
  runGraph(
    `MATCH (n:${quote(fromLabel)})-[r:${quote(type)}]->(m:${quote(toLabel)})
     RETURN n, r, m LIMIT $limit`,
    { limit: neo4j.int(QUERY_LIMIT) },
    colorFor,
    [fromLabel, toLabel],
  );

// Relationships only, never nodes. Not capped: every connection between the nodes on screen is wanted.
export const fetchConnections = async (
  { type }: Pattern,
  fromIds: string[],
  toIds: string[],
  colorFor: ColorFor,
): Promise<DataGraph> => {
  const { relationships } = await runGraph(
    `MATCH (a)-[r:${quote(type)}]->(b)
     WHERE elementId(a) IN $fromIds AND elementId(b) IN $toIds
     RETURN r`,
    { fromIds, toIds },
    colorFor,
  );
  return { nodes: [], relationships, nodeInfo: new Map() };
};

export const fetchNeighbours = async (
  nodeId: string,
  colorFor: ColorFor,
): Promise<DataGraph> => {
  const data = await runGraph(
    `MATCH (n)-[r]-(m) WHERE elementId(n) = $id
     RETURN n, r, m LIMIT $limit`,
    { id: nodeId, limit: neo4j.int(QUERY_LIMIT) },
    colorFor,
  );
  if (data.relationships.length === 0)
    throw new Error("That node has no connections to show.");
  return data;
};

export const fetchShortestPath = async (
  fromId: string,
  toId: string,
  colorFor: ColorFor,
): Promise<DataGraph> => {
  const data = await runGraph(
    `MATCH (a) WHERE elementId(a) = $from
     MATCH (b) WHERE elementId(b) = $to
     MATCH p = shortestPath((a)-[*..15]-(b))
     RETURN p`,
    { from: fromId, to: toId },
    colorFor,
  );
  if (data.nodes.length === 0)
    throw new Error(
      "No path of up to 15 relationships connects those two nodes.",
    );
  return data;
};
