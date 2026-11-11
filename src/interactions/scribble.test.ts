import { describe, expect, it } from "vitest";

import { analyseScribbles } from "./scribble";
import type { SceneNode, SceneRelationship, Stroke } from "./scribble";
import type { Point } from "@neo4j-nvl/base";

// Two nodes 300 apart on the x axis, joined by one relationship.
const nodes: SceneNode[] = [
  { id: "a", x: 0, y: 0, radius: 25 },
  { id: "b", x: 300, y: 0, radius: 25 },
];
const relationships: SceneRelationship[] = [{ id: "r", from: "a", to: "b" }];

/** A straight stroke, in enough points to count as a scribble. */
const line = (from: Point, to: Point, points = 10): Stroke =>
  Array.from({ length: points }, (_, i) => ({
    x: from.x + ((to.x - from.x) * i) / (points - 1),
    y: from.y + ((to.y - from.y) * i) / (points - 1),
  }));

/** A closed loop around a point. */
const circle = (center: Point, radius: number, points = 24): Stroke =>
  Array.from({ length: points + 1 }, (_, i) => {
    const angle = (i / points) * Math.PI * 2;
    return {
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
    };
  });

const analyse = (...strokes: Stroke[]) =>
  analyseScribbles(strokes, nodes, relationships);

describe("analyseScribbles", () => {
  it("reads a line from one node to another as a shortest-path request", () => {
    const result = analyse(line({ x: 0, y: 0 }, { x: 300, y: 0 }));
    expect(result.paths).toEqual([{ from: "a", to: "b" }]);
    expect(result.dismissNodes).toEqual([]);
    expect(result.consumed).toEqual([0]);
  });

  it("asks for the same path once, whichever way it was drawn", () => {
    const result = analyse(
      line({ x: 0, y: 0 }, { x: 300, y: 0 }),
      line({ x: 300, y: 0 }, { x: 0, y: 0 }),
    );
    expect(result.paths).toHaveLength(1);
    expect(result.consumed).toEqual([0, 1]);
  });

  it("dismisses a node a stroke crosses", () => {
    const result = analyse(line({ x: 0, y: -100 }, { x: 0, y: 100 }));
    expect(result.dismissNodes).toEqual(["a"]);
    expect(result.dismissRelationships).toEqual([]);
  });

  it("does not dismiss a node a stroke only starts on", () => {
    const result = analyse(line({ x: 0, y: 0 }, { x: 0, y: -200 }));
    expect(result.dismissNodes).toEqual([]);
    expect(result.consumed).toEqual([]);
  });

  it("dismisses a relationship a stroke crosses", () => {
    const result = analyse(line({ x: 150, y: -100 }, { x: 150, y: 100 }));
    expect(result.dismissRelationships).toEqual(["r"]);
    expect(result.dismissNodes).toEqual([]);
  });

  it("leaves a circle on its own alone, for a later stroke to cross", () => {
    const result = analyse(circle({ x: 0, y: 0 }, 60));
    expect(result.dismissNodes).toEqual([]);
    expect(result.consumed).toEqual([]);
  });

  it("dismisses everything inside a circle that a stroke crosses, and uses up both", () => {
    // Crosses the circle's edge without coming near the node inside it.
    const result = analyse(
      circle({ x: 0, y: 0 }, 60),
      line({ x: -100, y: -40 }, { x: -20, y: -40 }),
    );
    expect(result.dismissNodes).toEqual(["a"]);
    expect(result.consumed.sort()).toEqual([0, 1]);
  });

  it("ignores strokes too short to mean anything", () => {
    const result = analyse(line({ x: 0, y: -100 }, { x: 0, y: 100 }, 3));
    expect(result).toEqual({
      dismissNodes: [],
      dismissRelationships: [],
      paths: [],
      consumed: [],
    });
  });
});
