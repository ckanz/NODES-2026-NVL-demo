import type { NVL } from "@neo4j-nvl/base";

import { clientToGraph } from "./viewport";
import type { Point } from "./viewport";

export type ScribbleOptions = {
  /** Asked on every event: is scribble mode on? When it is off this handler does nothing at all. */
  isActive: () => boolean;
  /** A stroke began. Points are in graph coordinates, so a stroke stays put when the view zooms or pans. */
  onStrokeStart: (point: Point) => void;
  onStrokePoint: (point: Point) => void;
  onStrokeEnd: () => void;
};

// Points closer together than this (in screen pixels) add nothing but weight.
const MIN_POINT_DISTANCE_PX = 3;

/**
 * Lets the user draw on top of the graph, with the left mouse button, while scribble mode is on.
 *
 * It listens one level above the NVL container, in the capture phase, so it sees every press before NVL's own
 * handlers. (On the container itself it would not be enough: NVL also listens there in the capture phase, and
 * listeners on the same element run in the order they were added, which would put NVL's first.)
 * While scribbling it takes the left button for itself: nodes cannot be dragged, clicked or double-clicked.
 * The other buttons and the wheel are left alone, so panning (right or middle drag, see InertialPanInteraction)
 * and zooming keep working.
 */
export class ScribbleInteraction {
  private readonly nvl: NVL;
  private readonly container: HTMLElement;
  /** Where we listen: the container's parent, so we always run before listeners on the container. */
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
    // Only the left button draws. The others fall through to panning.
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

  /** NVL starts dragging a node on mousedown and selects on click. While scribbling, neither may happen. */
  private blockLeftButton = (event: MouseEvent): void => {
    if (this.options.isActive() && event.button === 0) this.swallow(event);
  };

  /** The right button pans while scribbling, so it must not also open the browser's menu. */
  private onContextMenu = (event: MouseEvent): void => {
    if (this.options.isActive()) this.swallow(event);
  };

  private swallow(event: Event): void {
    event.stopImmediatePropagation();
    event.stopPropagation();
    event.preventDefault();
  }
}
