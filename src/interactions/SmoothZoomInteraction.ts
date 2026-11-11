import type { NVL } from "@neo4j-nvl/base";

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
  // Pointer position in CSS px relative to the container; stays fixed while zooming.
  private anchor = { x: 0, y: 0 };
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

  // Adjusts the pan so the graph point under the anchor stays under it.
  private zoomTo(newZoom: number): void {
    const oldPerUnit = this.nvl.getScale() / window.devicePixelRatio;
    const newPerUnit = newZoom / window.devicePixelRatio;
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
