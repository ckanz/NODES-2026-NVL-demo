import type { NVL, Point } from "@neo4j-nvl/base";

// NVL's pan is the graph point at the container's centre; one graph unit is zoom / devicePixelRatio CSS px.
export const clientToGraph = (nvl: NVL, client: Point): Point => {
  const rect = nvl.getContainer().getBoundingClientRect();
  const scale = nvl.getScale() / window.devicePixelRatio;
  const pan = nvl.getPan();
  return {
    x: pan.x + (client.x - rect.left - rect.width / 2) / scale,
    y: pan.y + (client.y - rect.top - rect.height / 2) / scale,
  };
};

export type ScribbleOptions = {
  isActive: () => boolean;
  // Points are in graph coordinates, so strokes stay put when the view zooms or pans.
  onStrokeStart: (point: Point) => void;
  onStrokePoint: (point: Point) => void;
  onStrokeEnd: () => void;
};

// Closer points add nothing but weight.
const MIN_POINT_DISTANCE_PX = 3;

/**
 * Drawing with the left mouse button while scribble mode is on. Listens on the container's parent in the capture
 * phase, so it runs before NVL's own handlers. Other buttons and the wheel still pan and zoom.
 */
export class ScribbleInteraction {
  private readonly nvl: NVL;
  private readonly container: HTMLElement;
  private readonly outer: HTMLElement;
  private readonly options: ScribbleOptions;

  private pointerId: number | null = null;
  private lastClient: { x: number; y: number } | null = null;

  constructor(nvl: NVL, options: ScribbleOptions) {
    this.nvl = nvl;
    this.container = nvl.getContainer();
    this.outer = this.container.parentElement ?? this.container;
    this.options = options;

    this.outer.addEventListener("pointerdown", this.onPointerDown, true);
    this.outer.addEventListener("pointermove", this.onPointerMove, true);
    this.outer.addEventListener("pointerup", this.onPointerUp, true);
    this.outer.addEventListener("pointercancel", this.onPointerUp, true);
    for (const type of ["mousedown", "mouseup", "click", "dblclick"] as const) {
      this.outer.addEventListener(type, this.blockLeftButton, true);
    }
    this.outer.addEventListener("contextmenu", this.onContextMenu, true);
  }

  destroy(): void {
    this.outer.removeEventListener("pointerdown", this.onPointerDown, true);
    this.outer.removeEventListener("pointermove", this.onPointerMove, true);
    this.outer.removeEventListener("pointerup", this.onPointerUp, true);
    this.outer.removeEventListener("pointercancel", this.onPointerUp, true);
    for (const type of ["mousedown", "mouseup", "click", "dblclick"] as const) {
      this.outer.removeEventListener(type, this.blockLeftButton, true);
    }
    this.outer.removeEventListener("contextmenu", this.onContextMenu, true);
  }

  private toGraph(event: PointerEvent): Point {
    return clientToGraph(this.nvl, { x: event.clientX, y: event.clientY });
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (!this.options.isActive() || this.pointerId !== null) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;

    this.swallow(event);
    this.pointerId = event.pointerId;
    this.lastClient = { x: event.clientX, y: event.clientY };
    this.container.setPointerCapture(event.pointerId);
    this.options.onStrokeStart(this.toGraph(event));
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId || !this.lastClient) return;
    this.swallow(event);
    if (
      Math.hypot(
        event.clientX - this.lastClient.x,
        event.clientY - this.lastClient.y,
      ) < MIN_POINT_DISTANCE_PX
    )
      return;
    this.lastClient = { x: event.clientX, y: event.clientY };
    this.options.onStrokePoint(this.toGraph(event));
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    this.swallow(event);
    this.options.onStrokePoint(this.toGraph(event));
    if (this.container.hasPointerCapture(event.pointerId))
      this.container.releasePointerCapture(event.pointerId);
    this.pointerId = null;
    this.lastClient = null;
    this.options.onStrokeEnd();
  };

  // Stops NVL's node dragging (mousedown) and selection (click) while scribbling.
  private blockLeftButton = (event: MouseEvent): void => {
    if (this.options.isActive() && event.button === 0) this.swallow(event);
  };

  // The right button pans while scribbling, so suppress the browser menu.
  private onContextMenu = (event: MouseEvent): void => {
    if (this.options.isActive()) this.swallow(event);
  };

  private swallow(event: Event): void {
    event.stopImmediatePropagation();
    event.stopPropagation();
    event.preventDefault();
  }
}
