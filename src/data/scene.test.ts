import { describe, expect, it } from "vitest";

import { patternKey } from "./graph";
import type { DataGraph } from "./graph";
import {
  buildScene,
  connectionRequests,
  countScene,
  countVisible,
  isFullyVisible,
  sameRequest,
} from "./scene";
import type { Item } from "./snapshots";

// Two customers, one with an account that also has a second label.
const customers: DataGraph = {
  nodes: [{ id: "c1" }, { id: "c2" }, { id: "a1" }],
  relationships: [{ id: "r1", from: "c1", to: "a1", caption: "HAS_ACCOUNT" }],
  nodeInfo: new Map([
    ["c1", { labels: ["Customer"] }],
    ["c2", { labels: ["Customer"] }],
    ["a1", { labels: ["Account", "Internal"] }],
  ]),
};
// Overlaps the first selection in one node.
const emails: DataGraph = {
  nodes: [{ id: "c2" }, { id: "e1" }],
  relationships: [{ id: "r2", from: "c2", to: "e1", caption: "USES_EMAIL" }],
  nodeInfo: new Map([
    ["c2", { labels: ["Customer"] }],
    ["e1", { labels: ["Email"] }],
  ]),
};

const items = new Map<string, Item>([
  ["one", { title: "one", data: customers }],
  ["two", { title: "two", data: emails }],
]);
const nothingHidden = {
  hiddenLabels: new Set<string>(),
  hiddenNodes: new Set<string>(),
  hiddenRelationships: new Set<string>(),
};
const ids = (elements: { id: string }[]) =>
  elements.map((element) => element.id).sort();

describe("buildScene", () => {
  it("draws a node reached by two selections once", () => {
    const scene = buildScene({ items, ...nothingHidden });
    expect(ids(scene.nodes)).toEqual(["a1", "c1", "c2", "e1"]);
    expect(ids(scene.relationships)).toEqual(["r1", "r2"]);
    expect(scene.nodeById.get("c2")).toBeDefined();
  });

  it("drops the nodes of a hidden label, with their relationships", () => {
    const scene = buildScene({
      items,
      ...nothingHidden,
      hiddenLabels: new Set(["Internal"]),
    });
    expect(ids(scene.nodes)).toEqual(["c1", "c2", "e1"]);
    expect(ids(scene.relationships)).toEqual(["r2"]);
    expect(scene.nodeInfo.has("a1")).toBe(false);
  });

  it("draws only the set slice of a label, plus nodes kept on purpose", () => {
    const restriction = {
      slicedLabels: new Map([["Customer", new Set(["c2"])]]),
      keep: new Set<string>(),
    };
    expect(
      ids(buildScene({ items, ...nothingHidden }, restriction).nodes),
    ).toEqual(["a1", "c2", "e1"]);
    const kept = { ...restriction, keep: new Set(["c1"]) };
    expect(
      ids(buildScene({ items, ...nothingHidden }, kept).relationships),
    ).toEqual(["r1", "r2"]);
  });

  it("drops dismissed nodes and relationships", () => {
    const scene = buildScene({
      items,
      ...nothingHidden,
      hiddenNodes: new Set(["e1"]),
      hiddenRelationships: new Set(["r1"]),
    });
    expect(ids(scene.nodes)).toEqual(["a1", "c1", "c2"]);
    expect(scene.relationships).toEqual([]);
  });
});

describe("isFullyVisible", () => {
  it("is true when nothing of the selection is hidden", () => {
    expect(
      isFullyVisible(customers, buildScene({ items, ...nothingHidden })),
    ).toBe(true);
  });

  it("is false when a second label of an end node is hidden", () => {
    const scene = buildScene({
      items,
      ...nothingHidden,
      hiddenLabels: new Set(["Internal"]),
    });
    expect(isFullyVisible(customers, scene)).toBe(false);
    expect(isFullyVisible(emails, scene)).toBe(true);
  });

  it("is false when a node or relationship of it was dismissed", () => {
    expect(
      isFullyVisible(
        customers,
        buildScene({ items, ...nothingHidden, hiddenNodes: new Set(["c2"]) }),
      ),
    ).toBe(false);
    expect(
      isFullyVisible(
        customers,
        buildScene({
          items,
          ...nothingHidden,
          hiddenRelationships: new Set(["r1"]),
        }),
      ),
    ).toBe(false);
  });
});

describe("countVisible", () => {
  it("counts only the nodes of that label that are on screen", () => {
    expect(
      countVisible(
        customers,
        buildScene({ items, ...nothingHidden }),
        "Customer",
      ),
    ).toBe(2);
    expect(
      countVisible(
        customers,
        buildScene({ items, ...nothingHidden, hiddenNodes: new Set(["c1"]) }),
        "Customer",
      ),
    ).toBe(1);
    expect(
      countVisible(
        customers,
        buildScene({
          items,
          ...nothingHidden,
          hiddenLabels: new Set(["Internal"]),
        }),
        "Account",
      ),
    ).toBe(0);
  });
});

describe("connectionRequests", () => {
  const hasAccount = {
    fromLabel: "Customer",
    type: "HAS_ACCOUNT",
    toLabel: "Account",
  };
  const usesEmail = {
    fromLabel: "Customer",
    type: "USES_EMAIL",
    toLabel: "Email",
  };

  it("lists the nodes on screen at each end, sorted", () => {
    const requests = connectionRequests(
      buildScene({ items, ...nothingHidden }),
      [hasAccount],
    );
    expect(requests.get(patternKey(hasAccount))).toEqual({
      pattern: hasAccount,
      fromIds: ["c1", "c2"],
      toIds: ["a1"],
    });
  });

  it("counts a node with several labels for each of them", () => {
    const internal = {
      fromLabel: "Customer",
      type: "HAS_ACCOUNT",
      toLabel: "Internal",
    };
    const requests = connectionRequests(
      buildScene({ items, ...nothingHidden }),
      [internal],
    );
    expect(requests.get(patternKey(internal))?.toIds).toEqual(["a1"]);
  });

  it("leaves out hidden and dismissed nodes, and patterns with an empty end", () => {
    const scene = buildScene({
      items,
      ...nothingHidden,
      hiddenLabels: new Set(["Internal"]),
      hiddenNodes: new Set(["c1"]),
    });
    const requests = connectionRequests(scene, [hasAccount, usesEmail]);
    expect(requests.has(patternKey(hasAccount))).toBe(false);
    expect(requests.get(patternKey(usesEmail))).toEqual({
      pattern: usesEmail,
      fromIds: ["c2"],
      toIds: ["e1"],
    });
  });
});

describe("sameRequest", () => {
  const pattern = { fromLabel: "A", type: "R", toLabel: "B" };
  it("compares the pattern and both id lists", () => {
    const request = { pattern, fromIds: ["1", "2"], toIds: ["3"] };
    expect(sameRequest(undefined, request)).toBe(false);
    expect(sameRequest({ ...request, fromIds: ["1", "2"] }, request)).toBe(
      true,
    );
    expect(sameRequest({ ...request, toIds: ["4"] }, request)).toBe(false);
    expect(
      sameRequest({ ...request, pattern: { ...pattern, type: "S" } }, request),
    ).toBe(false);
  });
});

describe("countScene", () => {
  it("counts each label of a node with several", () => {
    const { labels } = countScene(buildScene({ items, ...nothingHidden }));
    expect(labels.get("Customer")).toBe(2);
    expect(labels.get("Account")).toBe(1);
    expect(labels.get("Internal")).toBe(1);
  });

  it("counts a relationship under every label pair it connects", () => {
    const { patterns } = countScene(buildScene({ items, ...nothingHidden }));
    expect(
      patterns.get(
        patternKey({
          fromLabel: "Customer",
          type: "HAS_ACCOUNT",
          toLabel: "Account",
        }),
      ),
    ).toBe(1);
    expect(
      patterns.get(
        patternKey({
          fromLabel: "Customer",
          type: "HAS_ACCOUNT",
          toLabel: "Internal",
        }),
      ),
    ).toBe(1);
    expect(
      patterns.get(
        patternKey({
          fromLabel: "Customer",
          type: "USES_EMAIL",
          toLabel: "Email",
        }),
      ),
    ).toBe(1);
    expect(patterns.size).toBe(3);
  });
});
