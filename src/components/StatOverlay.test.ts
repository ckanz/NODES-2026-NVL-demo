import { describe, expect, it } from "vitest";

import { moveSlice } from "./StatOverlay";

// 100 nodes; the slice covers nodes 20 to 39.
const slice = { skip: 20, count: 20 };

describe("moveSlice", () => {
  it("shifts the whole slice, stopping at either end", () => {
    expect(moveSlice("shift", slice, 0.1, 100, 50)).toEqual({
      skip: 30,
      count: 20,
    });
    expect(moveSlice("shift", slice, -0.5, 100, 50)).toEqual({
      skip: 0,
      count: 20,
    });
    expect(moveSlice("shift", slice, 0.9, 100, 50)).toEqual({
      skip: 80,
      count: 20,
    });
  });

  it("moves the start, keeping at least one node and at most maxCount", () => {
    expect(moveSlice("start", slice, -0.1, 100, 50)).toEqual({
      skip: 10,
      count: 30,
    });
    expect(moveSlice("start", slice, 0.5, 100, 50)).toEqual({
      skip: 39,
      count: 1,
    });
    expect(moveSlice("start", slice, -0.5, 100, 25)).toEqual({
      skip: 15,
      count: 25,
    });
  });

  it("moves the end, never past the last node", () => {
    expect(moveSlice("end", slice, 0.1, 100, 50)).toEqual({
      skip: 20,
      count: 30,
    });
    expect(moveSlice("end", slice, -0.5, 100, 50)).toEqual({
      skip: 20,
      count: 1,
    });
    expect(moveSlice("end", slice, 0.9, 100, 200)).toEqual({
      skip: 20,
      count: 80,
    });
  });
});
