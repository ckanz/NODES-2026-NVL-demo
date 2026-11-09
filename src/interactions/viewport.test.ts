import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeNvl } from "./fakeNvl";
import { clientToGraph, cssPixelsPerUnit } from "./viewport";

describe("viewport", () => {
  beforeEach(() => vi.stubGlobal("window", { devicePixelRatio: 2 }));
  afterEach(() => vi.unstubAllGlobals());

  it("makes one graph unit zoom / devicePixelRatio CSS pixels", () => {
    expect(cssPixelsPerUnit(4)).toBe(2);
  });

  it("puts the pan at the centre of the container", () => {
    const nvl = new FakeNvl({ pan: { x: 10, y: 20 }, zoom: 4 });
    Object.assign(nvl.rect, { left: 100, top: 50, width: 400, height: 200 });
    expect(clientToGraph(nvl.asNvl(), { x: 300, y: 150 })).toEqual({
      x: 10,
      y: 20,
    });
  });

  it("maps an offset from the centre through the zoom", () => {
    const nvl = new FakeNvl({ pan: { x: 10, y: 20 }, zoom: 4 });
    Object.assign(nvl.rect, { left: 100, top: 50, width: 400, height: 200 });
    // 2 CSS pixels per unit: 40 px right is 20 units, 10 px up is 5 units.
    expect(clientToGraph(nvl.asNvl(), { x: 340, y: 140 })).toEqual({
      x: 30,
      y: 15,
    });
  });
});
