import { describe, expect, it } from "vitest";

import { mergeGraphs, patternKey } from "./graph";
import type { DataGraph } from "./graph";

describe("patternKey", () => {
  it("tells patterns apart by type and by direction", () => {
    const owns = patternKey({
      fromLabel: "Customer",
      type: "HAS_ACCOUNT",
      toLabel: "Account",
    });
    expect(owns).toBe(
      patternKey({
        fromLabel: "Customer",
        type: "HAS_ACCOUNT",
        toLabel: "Account",
      }),
    );
    expect(owns).not.toBe(
      patternKey({
        fromLabel: "Account",
        type: "HAS_ACCOUNT",
        toLabel: "Customer",
      }),
    );
    expect(owns).not.toBe(
      patternKey({
        fromLabel: "Customer",
        type: "USES_EMAIL",
        toLabel: "Account",
      }),
    );
  });
});

describe("mergeGraphs", () => {
  const first: DataGraph = {
    nodes: [
      { id: "a", color: "red" },
      { id: "b", color: "red" },
    ],
    relationships: [{ id: "r1", from: "a", to: "b", caption: "KNOWS" }],
    nodeInfo: new Map([
      ["a", { labels: ["Person"] }],
      ["b", { labels: ["Person"] }],
    ]),
  };
  const second: DataGraph = {
    nodes: [
      { id: "b", color: "blue" },
      { id: "c", color: "blue" },
    ],
    relationships: [
      { id: "r1", from: "a", to: "b", caption: "OTHER" },
      { id: "r2", from: "b", to: "c", caption: "KNOWS" },
    ],
    nodeInfo: new Map([
      ["b", { labels: ["Other"] }],
      ["c", { labels: ["Person"] }],
    ]),
  };

  it("keeps every element once", () => {
    const merged = mergeGraphs([first, second]);
    expect(merged.nodes.map((node) => node.id)).toEqual(["a", "b", "c"]);
    expect(merged.relationships.map((rel) => rel.id)).toEqual(["r1", "r2"]);
    expect([...merged.nodeInfo.keys()]).toEqual(["a", "b", "c"]);
  });

  it("keeps the first copy of a duplicate", () => {
    const merged = mergeGraphs([first, second]);
    expect(merged.nodes.find((node) => node.id === "b")?.color).toBe("red");
    expect(merged.relationships.find((rel) => rel.id === "r1")?.caption).toBe(
      "KNOWS",
    );
    expect(merged.nodeInfo.get("b")?.labels).toEqual(["Person"]);
  });

  it("merges nothing into an empty graph", () => {
    const merged = mergeGraphs([]);
    expect(merged.nodes).toEqual([]);
    expect(merged.relationships).toEqual([]);
    expect(merged.nodeInfo.size).toBe(0);
  });
});
