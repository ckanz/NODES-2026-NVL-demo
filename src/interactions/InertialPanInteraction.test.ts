import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeNvl } from "./fakeNvl";
import { InertialPanInteraction } from "./InertialPanInteraction";

const pointer = (clientX: number, clientY: number, timeStamp: number) => ({
  pointerId: 1,
  pointerType: "mouse",
  button: 0,
  clientX,
  clientY,
  timeStamp,
});

describe("InertialPanInteraction", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { devicePixelRatio: 1 });
    vi.stubGlobal("document", { body: { style: {} } });
  });
  afterEach(() => vi.unstubAllGlobals());

  /** Drag from x = 0 through the given points, then let go long after, so there is no glide. */
  const drag = (nvl: FakeNvl, xs: number[], renderBetweenMoves: boolean) => {
    const pan = new InertialPanInteraction(nvl.asNvl());
    nvl.dispatch("pointerdown", pointer(0, 0, 0));
    xs.forEach((x, i) => {
      nvl.dispatch("pointermove", pointer(x, 0, 10 * (i + 1)));
      if (renderBetweenMoves) nvl.render();
    });
    nvl.dispatch("pointerup", pointer(xs[xs.length - 1], 0, 10_000));
    nvl.render();
    pan.destroy();
  };

  it("follows the pointer when NVL renders after every move", () => {
    const nvl = new FakeNvl();
    drag(nvl, [10, 20, 30], true);
    // The scene moved 30 px right, so the pan (the graph point at the centre) moved 30 units left.
    expect(nvl.getPan()).toEqual({ x: -30, y: 0 });
  });

  it("loses no movement when several moves arrive before NVL renders", () => {
    // Regression: building each move on getPan(), which lags until the next render, dropped all but the last.
    const nvl = new FakeNvl();
    drag(nvl, [10, 20, 30], false);
    expect(nvl.getPan()).toEqual({ x: -30, y: 0 });
  });

  it("pans in graph units, through the zoom", () => {
    const nvl = new FakeNvl({ zoom: 2 });
    drag(nvl, [10, 20, 30], false);
    expect(nvl.getPan()).toEqual({ x: -15, y: 0 });
  });

  it("picks up a zoom that happened during the drag", () => {
    const nvl = new FakeNvl();
    const pan = new InertialPanInteraction(nvl.asNvl());
    nvl.dispatch("pointerdown", pointer(0, 0, 0));
    nvl.dispatch("pointermove", pointer(10, 0, 10));
    nvl.render();
    // Something else zooms in (and moves the pan) between two moves.
    nvl.setZoomAndPan(2, 100, 0);
    nvl.render();
    nvl.dispatch("pointermove", pointer(30, 0, 20));
    nvl.dispatch("pointerup", pointer(30, 0, 10_000));
    nvl.render();
    pan.destroy();
    // 20 px at zoom 2 is 10 units, from the pan the zoom left behind.
    expect(nvl.getPan()).toEqual({ x: 90, y: 0 });
  });
});
