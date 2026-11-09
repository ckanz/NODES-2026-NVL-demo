import { describe, expect, it } from "vitest";

import {
  formatCount,
  formatGraphSummary,
  formatPercent,
  fractionOf,
} from "./format";

describe("formatCount", () => {
  it("groups thousands", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(1234567)).toBe("1,234,567");
  });
});

describe("fractionOf", () => {
  it("is the share of the total", () => {
    expect(fractionOf(25, 100)).toBe(0.25);
  });

  it("is 0 when there is no total, and never above 1", () => {
    expect(fractionOf(5, 0)).toBe(0);
    expect(fractionOf(150, 100)).toBe(1);
  });
});

describe("formatPercent", () => {
  it("shows nothing as 0%", () => {
    expect(formatPercent(0)).toBe("0%");
  });

  it("shows tiny shares as <0.1% rather than 0%", () => {
    expect(formatPercent(0.0004)).toBe("<0.1%");
  });

  it("uses one decimal below 10% and whole numbers above", () => {
    expect(formatPercent(0.0567)).toBe("5.7%");
    expect(formatPercent(0.456)).toBe("46%");
    expect(formatPercent(1)).toBe("100%");
  });
});

describe("formatGraphSummary", () => {
  it("says so when the graph is empty", () => {
    expect(formatGraphSummary(0, 0)).toBe("Nothing selected yet");
  });

  it("counts nodes and relationships", () => {
    expect(formatGraphSummary(1500, 3)).toBe("1,500 nodes, 3 relationships");
  });
});
