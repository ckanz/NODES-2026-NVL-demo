import type { NVL } from "@neo4j-nvl/base";

import { cssPixelsPerUnit } from "./viewport";
import { normalizeWheelDelta } from "./wheel";

export type SmoothZoomOptions = {
  /**
   * Time constant of the ease-out in milliseconds. The zoom closes the gap to its target
   * as `1 - exp(-t / smoothing)`, so a larger value settles more slowly. Default 140.
   */
  smoothing?: number;
  /** Zoom speed for a mouse wheel. Each wheel pixel scales the zoom by `exp(-delta * sensitivity)`. Default 0.0018. */
  wheelSensitivity?: number;
  /** Zoom speed for trackpad pinch gestures (reported as ctrl + wheel). Default 0.01. */
  pinchSensitivity?: number;
  /** Called after every zoom step with the new zoom level. */
  onZoom?: (zoom: number) => void;
};

// Stop easing once the remaining gap is below this relative amount.
const SETTLE_EPSILON = 0.0005;

/**
 * Zooms with the wheel or trackpad pinch around the pointer, easing out towards the target
 * zoom instead of jumping, so the motion decelerates after the gesture ends.
 * Replaces NVL's built-in `ZoomInteraction`.
 */
export class SmoothZoomInteraction {
  private readonly nvl: NVL;
  private readonly container: HTMLElement;
  private readonly smoothing: number;
  private readonly wheelSensitivity: number;
  private readonly pinchSensitivity: number;
  private readonly onZoom?: (zoom: number) => void;

  private targetZoom: number | null = null;
  /** Pointer position in CSS px relative to the container; the point that stays fixed while zooming. */
  private anchor = { x: 0, y: 0 };
  private frame: number | null = null;

  constructor(nvl: NVL, options: SmoothZoomOptions = {}) {
    this.nvl = nvl;
    this.container = nvl.getContainer();
    this.smoothing = options.smoothing ?? 140;
    this.wheelSensitivity = options.wheelSensitivity ?? 0.0018;
    this.pinchSensitivity = options.pinchSensitivity ?? 0.01;
    this.onZoom = options.onZoom;

    // Not passive: we cancel the default so the page does not scroll or browser-zoom.
    this.container.addEventListener("wheel", this.onWheel, { passive: false });
  }

  destroy(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.targetZoom = null;
    this.container.removeEventListener("wheel", this.onWheel);
  }

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();

    const sensitivity = event.ctrlKey
      ? this.pinchSensitivity
      : this.wheelSensitivity;
    const delta = normalizeWheelDelta(event);

    const rect = this.container.getBoundingClientRect();
    this.anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top };

    const { minZoom, maxZoom } = this.nvl.getZoomLimits();
    const base = this.targetZoom ?? this.nvl.getScale();
    this.targetZoom = Math.min(
      maxZoom,
      Math.max(minZoom, base * Math.exp(-delta * sensitivity)),
    );

    if (this.frame === null) this.startEasing();
  };

  private startEasing(): void {
    let previous = performance.now();
    const step = (now: number): void => {
      const target = this.targetZoom;
      if (target === null) {
        this.frame = null;
        return;
      }
      const dt = Math.min(now - previous, 50);
      previous = now;

      const current = this.nvl.getScale();
      const alpha = 1 - Math.exp(-dt / this.smoothing);
      const settled = Math.abs(target - current) / target < SETTLE_EPSILON;
      this.zoomTo(settled ? target : current + (target - current) * alpha);

      if (settled) {
        this.targetZoom = null;
        this.frame = null;
        return;
      }
      this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }

  /**
   * Sets the zoom and adjusts the pan so the layout point under the anchor stays under it: the anchor's
   * offset from the container centre, `(p - pan) * cssPixelsPerUnit(zoom)`, is kept constant.
   */
  private zoomTo(newZoom: number): void {
    const oldPerUnit = cssPixelsPerUnit(this.nvl.getScale());
    const newPerUnit = cssPixelsPerUnit(newZoom);
    const pan = this.nvl.getPan();
    const { width, height } = this.container.getBoundingClientRect();
    const offsetX = this.anchor.x - width / 2;
    const offsetY = this.anchor.y - height / 2;

    const pointX = pan.x + offsetX / oldPerUnit;
    const pointY = pan.y + offsetY / oldPerUnit;
    this.nvl.setZoomAndPan(
      newZoom,
      pointX - offsetX / newPerUnit,
      pointY - offsetY / newPerUnit,
    );
    this.onZoom?.(newZoom);
  }
}
