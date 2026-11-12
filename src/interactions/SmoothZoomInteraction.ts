import type { NVL, Point } from "@neo4j-nvl/base";

import { clientToGraph } from "./ScribbleInteraction";

// Caps a single wheel step, so a fast trackpad flick can't jump the zoom.
const MAX_DELTA = 200;

export type SmoothZoomOptions = {
  // Ease-out time constant in ms. Default 140.
  smoothing?: number;
  // Zoom scales by exp(-delta * sensitivity) per wheel pixel. Default 0.0018.
  wheelSensitivity?: number;
  // Trackpad pinch (reported as ctrl + wheel). Default 0.01.
  pinchSensitivity?: number;
  onZoom?: (zoom: number) => void;
};

// Relative gap below which easing stops.
const SETTLE_EPSILON = 0.0005;

// Eased wheel/pinch zoom around the pointer. Replaces NVL's built-in ZoomInteraction.
export class SmoothZoomInteraction {
  private readonly nvl: NVL;
  private readonly container: HTMLElement;
  private readonly smoothing: number;
  private readonly wheelSensitivity: number;
  private readonly pinchSensitivity: number;
  private readonly onZoom?: (zoom: number) => void;

  private targetZoom: number | null = null;
  // Pointer position (clientX/Y); the graph point under it stays fixed while zooming.
  private anchor: Point = { x: 0, y: 0 };
  private frame: number | null = null;

  constructor(nvl: NVL, options: SmoothZoomOptions = {}) {
    this.nvl = nvl;
    this.container = nvl.getContainer();
    this.smoothing = options.smoothing ?? 140;
    this.wheelSensitivity = options.wheelSensitivity ?? 0.0018;
    this.pinchSensitivity = options.pinchSensitivity ?? 0.01;
    this.onZoom = options.onZoom;

    // Not passive, so we can stop the page from scrolling or browser-zooming.
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
    const delta = Math.max(-MAX_DELTA, Math.min(MAX_DELTA, event.deltaY));

    this.anchor = { x: event.clientX, y: event.clientY };

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

  // Adjusts the pan so the graph point under the anchor stays under it.
  private zoomTo(newZoom: number): void {
    const point = clientToGraph(this.nvl, this.anchor);
    const pan = this.nvl.getPan();
    // Scale the pan's distance to that point, so the point stays under the pointer.
    const ratio = this.nvl.getScale() / newZoom;
    this.nvl.setZoomAndPan(
      newZoom,
      point.x - (point.x - pan.x) * ratio,
      point.y - (point.y - pan.y) * ratio,
    );
    this.onZoom?.(newZoom);
  }
}
