import { nvlResultTransformer } from "@neo4j-nvl/base";
import type { Node, Relationship } from "@neo4j-nvl/base";
import { tokens } from "@neo4j-ndl/base";
import neo4j from "neo4j-driver";
import type {
  Node as Neo4jNode,
  Relationship as Neo4jRelationship,
} from "neo4j-driver";

import { mergeGraphs, patternKey } from "./graph";
import type { DataGraph, GraphData, NodeInfo, Pattern } from "./graph";

// Connection settings, injected at build time from the environment (see webpack.config.js). The defaults point
// at a local development instance. Anything set here ends up in the client bundle, password included, so only
// ever build with a read-only database user, and prefer an encrypted URI (neo4j+s://) outside development.
const NEO4J_URI = process.env.NEO4J_URI ?? "bolt://localhost:7687";
const NEO4J_USER = process.env.NEO4J_USERNAME ?? "neo4j";
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD ?? "password";
const DATABASE = process.env.NEO4J_DATABASE ?? "neo4j";

/** Longest a single query may run on the server before it is stopped and reported as an error. */
const QUERY_TIMEOUT_MS = 60_000;

/** Default amount a click loads, and the cap on relationship-pattern queries. */
const QUERY_LIMIT = 1000;
/** Ceiling for a label slice the user stretches with the ring. Guards the browser, not the database. */
export const MAX_SLICE = 50_000;

let driver: ReturnType<typeof neo4j.driver> | null = null;
const getDriver = () => {
  if (!driver) {
    driver = neo4j.driver(
      NEO4J_URI,
      neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD),
    );
    // Release the connections when the page goes away.
    window.addEventListener("pagehide", () => {
      void driver?.close();
      driver = null;
    });
  }
  return driver;
};

/** Every query here only reads: on a cluster, any member may answer. Bounded in time on the server. */
const queryConfig = {
  database: DATABASE,
  routing: neo4j.routing.READ,
  transactionConfig: { timeout: QUERY_TIMEOUT_MS },
};

/** Quote a label or relationship type for use in Cypher. */
const quote = (name: string) => `\`${name.replace(/`/g, "``")}\``;

const run = (query: string, params: Record<string, unknown> = {}) =>
  getDriver().executeQuery(query, params, {
    ...queryConfig,
    resultTransformer: nvlResultTransformer,
  });

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

// Needle graph palette. Each label gets one color, shared by the schema and the data view.
const palette = Object.values(tokens.graph);
export type ColorFor = (label: string) => string;

/** Deterministic colors: labels are sorted, then assigned palette entries in order. */
const makeColorFor = (labels: string[]): ColorFor => {
  const byLabel = new Map(
    [...labels]
      .sort()
      .map((label, index) => [label, palette[index % palette.length]]),
  );
  return (label) => byLabel.get(label) ?? palette[0];
};

// ---------------------------------------------------------------------------
// Result -> NVL elements
// ---------------------------------------------------------------------------

const captionFor = (
  labels: string[],
  properties: Record<string, unknown>,
): string =>
  String(properties.name ?? properties.ip ?? properties.type ?? labels[0]);

type Transformed = Awaited<ReturnType<typeof run>>;

/**
 * Enrich the bare `{ id }` elements the transformer returns, and drop duplicates.
 * Many nodes carry several labels (e.g. `Account` + `Internal`). `preferred` are the labels the user
 * asked for, so a node is colored like the schema node they clicked rather than by its first label.
 */
const toGraphData = (
  { nodes, relationships, recordObjectMap }: Transformed,
  colorFor: ColorFor,
  preferred: string[] = [],
): DataGraph => {
  const uniqueNodes = new Map<string, Node>();
  const nodeInfo = new Map<string, NodeInfo>();
  for (const node of nodes) {
    if (uniqueNodes.has(node.id)) continue;
    const record = recordObjectMap.get(node.id);
    if (!record || !("labels" in record)) {
      uniqueNodes.set(node.id, node);
      continue;
    }
    nodeInfo.set(node.id, { labels: record.labels });
    uniqueNodes.set(node.id, {
      ...node,
      caption: captionFor(record.labels, record.properties),
      color: colorFor(
        record.labels.find((label) => preferred.includes(label)) ??
          record.labels[0],
      ),
    });
  }

  const uniqueRels = new Map<string, Relationship>();
  for (const rel of relationships) {
    if (uniqueRels.has(rel.id)) continue;
    const record = recordObjectMap.get(rel.id);
    uniqueRels.set(
      rel.id,
      record && "type" in record ? { ...rel, caption: record.type } : rel,
    );
  }

  return {
    nodes: [...uniqueNodes.values()],
    relationships: [...uniqueRels.values()],
    nodeInfo,
  };
};

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/** How much of each label and relationship pattern exists in the whole database. */
export type SchemaTotals = {
  /** label -> number of nodes with it */
  labels: Map<string, number>;
  /** label -> number of those nodes that have at least one relationship. The ring slices over these. */
  connected: Map<string, number>;
  /** patternKey -> number of relationships */
  patterns: Map<string, number>;
};

export type SchemaGraph = GraphData & {
  totals: SchemaTotals;
  colorFor: ColorFor;
  /** schema node id -> label */
  labelById: Map<string, string>;
  /** schema relationship id -> what it connects */
  relationshipById: Map<string, Pattern>;
};

/** Plain rows, for aggregate queries that are not graph elements. */
const rows = async (query: string): Promise<Record<string, unknown>[]> => {
  const { records } = await getDriver().executeQuery(query, {}, queryConfig);
  return records.map((record) => record.toObject());
};

const toNumber = (value: unknown): number =>
  neo4j.isInt(value) ? value.toNumber() : Number(value);

const fetchTotals = async (): Promise<SchemaTotals> => {
  // A node with several labels counts once for each of them, matching how the schema lists them.
  const [labelRows, connectedRows, patternRows] = await Promise.all([
    rows("MATCH (n) UNWIND labels(n) AS label RETURN label, count(*) AS c"),
    rows(
      "MATCH (n) WHERE EXISTS { (n)--() } UNWIND labels(n) AS label RETURN label, count(*) AS c",
    ),
    rows(`MATCH (a)-[r]->(b)
          UNWIND labels(a) AS fromLabel
          UNWIND labels(b) AS toLabel
          RETURN fromLabel, type(r) AS type, toLabel, count(*) AS c`),
  ]);
  return {
    labels: new Map(
      labelRows.map((row) => [String(row.label), toNumber(row.c)]),
    ),
    connected: new Map(
      connectedRows.map((row) => [String(row.label), toNumber(row.c)]),
    ),
    patterns: new Map(
      patternRows.map((row) => [
        patternKey({
          fromLabel: String(row.fromLabel),
          type: String(row.type),
          toLabel: String(row.toLabel),
        }),
        toNumber(row.c),
      ]),
    ),
  };
};

/**
 * One node per label, one relationship per (label)-[type]->(label) pattern, plus database totals.
 *
 * db.schema.visualization() returns virtual elements with made-up negative ids. Nodes and relationships
 * draw those ids from separate counters, so the same id (e.g. "-5") can be a node and a relationship in the
 * same result. nvlResultTransformer keeps both in one map keyed by id, where one overwrites the other, and
 * relationships then lose their type. So the raw driver objects are read here instead, and the schema
 * elements get ids of their own: the label, and the pattern. These are also stable between calls.
 */
export const fetchSchema = async (): Promise<SchemaGraph> => {
  const [schemaResult, totals] = await Promise.all([
    getDriver().executeQuery("CALL db.schema.visualization()", {}, queryConfig),
    fetchTotals(),
  ]);
  const record = schemaResult.records[0];
  const rawNodes: Neo4jNode[] = record?.get("nodes") ?? [];
  const rawRelationships: Neo4jRelationship[] =
    record?.get("relationships") ?? [];

  // Virtual element id -> label, only for this result.
  const labelByElementId = new Map<string, string>();
  for (const node of rawNodes) {
    const label = node.labels[0] ?? String(node.properties.name ?? "");
    if (label) labelByElementId.set(node.elementId, label);
  }
  const labels = [...new Set(labelByElementId.values())];
  const colorFor = makeColorFor(labels);

  const nodeId = (label: string) => `label:${label}`;
  const labelById = new Map(labels.map((label) => [nodeId(label), label]));
  const nodes: Node[] = labels.map((label) => ({
    id: nodeId(label),
    caption: label,
    color: colorFor(label),
  }));

  const relationshipById = new Map<string, Pattern>();
  const relationships: Relationship[] = [];
  for (const rel of rawRelationships) {
    const fromLabel = labelByElementId.get(rel.startNodeElementId);
    const toLabel = labelByElementId.get(rel.endNodeElementId);
    if (!fromLabel || !toLabel || !rel.type) continue;
    const pattern: Pattern = { type: rel.type, fromLabel, toLabel };
    const id = `pattern:${patternKey(pattern)}`;
    if (relationshipById.has(id)) continue;
    relationshipById.set(id, pattern);
    relationships.push({
      id,
      from: nodeId(fromLabel),
      to: nodeId(toLabel),
      caption: rel.type,
    });
  }

  return {
    nodes,
    relationships,
    totals,
    colorFor,
    labelById,
    relationshipById,
  };
};

// ---------------------------------------------------------------------------
// Data queries (all bounded)
// ---------------------------------------------------------------------------

/** A window onto a label's connected nodes: skip this many, then take this many (at most MAX_SLICE). */
export type Slice = { skip: number; count: number };

/** The slice shown when a label is first selected: the first QUERY_LIMIT connected nodes, or all if fewer. */
export const defaultSlice = (connectedTotal: number): Slice => ({
  skip: 0,
  count: Math.min(connectedTotal, QUERY_LIMIT),
});

/**
 * Selects one slice of a label's connected nodes (those with at least one relationship), in a fixed order
 * (by element id), so slices line up and never repeat. Isolated nodes are left out.
 */
const SLICE_MATCH = (label: string) => `
  MATCH (n:${quote(label)}) WHERE EXISTS { (n)--() }
  WITH n ORDER BY elementId(n) SKIP $skip LIMIT $limit
`;

/** Most relationships kept per slice node, and the rough total budget they are shared from. */
const MAX_RELS_PER_NODE = 25;
const RELS_BUDGET = 25_000;

/**
 * One slice of a label's connected nodes. Relationships are only followed for the given patterns (with the
 * node at the other end); with none, the nodes come on their own. The cap on connections is per node, not
 * global, so every node in the slice keeps its share instead of the later ones being cut off. A big slice
 * gets fewer per node (the budget is shared), so a very well connected node may show only some of them.
 */
export const fetchLabel = async (
  label: string,
  colorFor: ColorFor,
  slice: Slice = { skip: 0, count: QUERY_LIMIT },
  patterns: Pattern[] = [],
): Promise<DataGraph> => {
  const count = Math.min(slice.count, MAX_SLICE);
  const perNode = Math.max(
    1,
    Math.min(MAX_RELS_PER_NODE, Math.floor(RELS_BUDGET / Math.max(count, 1))),
  );
  const params = {
    skip: neo4j.int(slice.skip),
    limit: neo4j.int(count),
    perNode: neo4j.int(perNode),
    patterns: patterns.map(({ type, fromLabel, toLabel }) => ({
      type,
      fromLabel,
      toLabel,
    })),
  };

  // A relationship counts when its type matches a pattern and the labels line up in that pattern's direction.
  const connectionQuery = `${SLICE_MATCH(label)}
     CALL (n) {
       MATCH (n)-[r]-(m)
       WHERE any(p IN $patterns WHERE type(r) = p.type AND (
         (startNode(r) = n AND p.fromLabel IN labels(n) AND p.toLabel IN labels(m)) OR
         (endNode(r) = n AND p.toLabel IN labels(n) AND p.fromLabel IN labels(m))
       ))
       RETURN r, m LIMIT $perNode
     }
     RETURN n, r, m`;

  // Both queries run at once; with no patterns there is nothing to connect, so only the nodes are fetched.
  const [sliceResult, connectionResult] = await Promise.all([
    run(`${SLICE_MATCH(label)} RETURN n`, params),
    patterns.length > 0 ? run(connectionQuery, params) : null,
  ]);
  const nodes = toGraphData(sliceResult, colorFor, [label]);
  if (!connectionResult) return nodes;
  // The slice nodes come first so they keep their color when a neighbor shares a label with them.
  return mergeGraphs([nodes, toGraphData(connectionResult, colorFor, [label])]);
};

/** Up to QUERY_LIMIT relationships of one pattern, with their endpoints. */
export const fetchRelationship = async (
  { type, fromLabel, toLabel }: Pattern,
  colorFor: ColorFor,
): Promise<DataGraph> => {
  // An empty label or type is not valid Cypher. It would mean the schema was read wrongly, so say so plainly.
  if (!type || !fromLabel || !toLabel) {
    throw new Error(
      `Cannot load an incomplete relationship pattern (:${fromLabel})-[:${type}]->(:${toLabel}).`,
    );
  }
  return toGraphData(
    await run(
      `MATCH (n:${quote(fromLabel)})-[r:${quote(type)}]->(m:${quote(toLabel)})
       RETURN n, r, m LIMIT $limit`,
      { limit: neo4j.int(QUERY_LIMIT) },
    ),
    colorFor,
    [fromLabel, toLabel],
  );
};

/**
 * Every relationship of one pattern between the given nodes (by element id), and nothing else: the result has
 * no nodes, so it never brings a node into the scene or keeps one there. Not capped: the caller asks for the
 * nodes on screen, and all of their connections are wanted.
 *
 * The walk starts from whichever side has fewer nodes, and checks the other end against the other list.
 */
export const fetchConnections = async (
  { type }: Pattern,
  fromIds: string[],
  toIds: string[],
  colorFor: ColorFor,
): Promise<DataGraph> => {
  if (!type)
    throw new Error(
      "Cannot load connections for a relationship pattern without a type.",
    );
  if (fromIds.length === 0 || toIds.length === 0)
    return { nodes: [], relationships: [], nodeInfo: new Map() };
  const fromStart = fromIds.length <= toIds.length;
  const query = fromStart
    ? `UNWIND $start AS id
       MATCH (a) WHERE elementId(a) = id
       MATCH (a)-[r:${quote(type)}]->(b) WHERE elementId(b) IN $other
       RETURN r`
    : `UNWIND $start AS id
       MATCH (b) WHERE elementId(b) = id
       MATCH (a)-[r:${quote(type)}]->(b) WHERE elementId(a) IN $other
       RETURN r`;
  const result = await run(
    query,
    fromStart
      ? { start: fromIds, other: toIds }
      : { start: toIds, other: fromIds },
  );
  return {
    nodes: [],
    relationships: toGraphData(result, colorFor).relationships,
    nodeInfo: new Map(),
  };
};

/**
 * Everything one hop away from a single node: its relationships and the nodes at their other ends.
 * Capped at QUERY_LIMIT relationships, so a very well connected node shows only some of them.
 * Throws if the node has no connections, so the user is told instead of nothing happening.
 */
export const fetchNeighbours = async (
  nodeId: string,
  colorFor: ColorFor,
): Promise<DataGraph> => {
  const result = await run(
    `MATCH (n) WHERE elementId(n) = $id
     MATCH (n)-[r]-(m)
     RETURN n, r, m LIMIT $limit`,
    { id: nodeId, limit: neo4j.int(QUERY_LIMIT) },
  );
  const data = toGraphData(result, colorFor);
  if (data.relationships.length === 0)
    throw new Error("That node has no connections to show.");
  return data;
};

/** Longest path searched for, in relationships. Cypher needs this as a literal, not a parameter. */
const MAX_PATH_HOPS = 15;

/**
 * The shortest path between two nodes (by element id), following relationships in either direction.
 * Throws if none connects them within MAX_PATH_HOPS.
 */
export const fetchShortestPath = async (
  fromId: string,
  toId: string,
  colorFor: ColorFor,
): Promise<DataGraph> => {
  const result = await run(
    `MATCH (a) WHERE elementId(a) = $from
     MATCH (b) WHERE elementId(b) = $to
     MATCH p = shortestPath((a)-[*..${MAX_PATH_HOPS}]-(b))
     RETURN p`,
    { from: fromId, to: toId },
  );
  const data = toGraphData(result, colorFor);
  if (data.nodes.length === 0) {
    throw new Error(
      `No path of up to ${MAX_PATH_HOPS} relationships connects those two nodes.`,
    );
  }
  return data;
};
