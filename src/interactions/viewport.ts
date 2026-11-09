/**
 * How NVL maps graph coordinates to the screen, in one place.
 *
 * A layout point `p` appears at `client = (p - pan) * zoom / devicePixelRatio + size / 2` (CSS pixels, measured
 * from the container's top left). In other words: the pan is the graph point at the container's centre, and
 * one graph unit is `zoom / devicePixelRatio` CSS pixels.
 */
import type { NVL } from "@neo4j-nvl/base";

export type Point = { x: number; y: number };

/** NVL draws nodes with this radius (in graph units) when they have no `size`. */
export const DEFAULT_NODE_SIZE = 25;

/** CSS pixels per graph unit at a given zoom. */
export const cssPixelsPerUnit = (zoom: number) =>
  zoom / window.devicePixelRatio;

/** A pointer position (clientX/clientY) as a point in graph coordinates. */
export const clientToGraph = (nvl: NVL, client: Point): Point => {
  const rect = nvl.getContainer().getBoundingClientRect();
  const scale = cssPixelsPerUnit(nvl.getScale());
  const pan = nvl.getPan();
  return {
    x: pan.x + (client.x - rect.left - rect.width / 2) / scale,
    y: pan.y + (client.y - rect.top - rect.height / 2) / scale,
  };
};
