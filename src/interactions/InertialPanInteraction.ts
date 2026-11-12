import type { NVL } from "@neo4j-nvl/base";

export type InertialPanOptions = {
  // Slow-down time constant in ms: speed decays as exp(-t / friction). Default 150.
  friction?: number;
  // Stop gliding below this speed, in CSS px/ms. Default 0.02.
  minSpeed?: number;
  // Cap on the release speed, in CSS px/ms. Default 1.5.
  maxSpeed?: number;
  // Don't pan when pressing on a node, so node dragging works. Default true.
  excludeNodes?: boolean | (() => boolean);
  // Let any mouse button pan, not just the left one. Asked on every press.
  anyButton?: () => boolean;
};

type Sample = { x: number; y: number; t: number };

// Releasing this long after the last move means "held still": no glide.
const STALE_SAMPLE_MS = 80;
// Moving further than this is a pan, not a click.
const CLICK_SLOP_PX = 4;
const CLICK_SUPPRESS_MS = 100;
const VELOCITY_WINDOW_MS = 100;

// Drag-to-pan with a glide after release. Replaces NVL's built-in PanInteraction.
export class InertialPanInteraction {
  private readonly nvl: NVL;
  private readonly container: HTMLElement;
  private readonly friction: number;
  private readonly minSpeed: number;
  private readonly maxSpeed: number;
  private readonly excludeNodes: () => boolean;
  private readonly anyButton: () => boolean;

  private pointerId: number | null = null;
  private last: { x: number; y: number } | null = null;
  private start: { x: number; y: number } | null = null;
  private suppressClick = false;
  private suppressTimer: ReturnType<typeof setTimeout> | null = null;
  private samples: Sample[] = [];
  private frame: number | null = null;
  private velocity = { x: 0, y: 0 };
  // Our own pan for the current gesture. NVL's setPan only applies on the next render and getPan returns the
  // old value until then, so building on getPan() would lose pointer moves between renders.
  private pan: { x: number; y: number; scale: number } | null = null;
  private previousCursor = "";
  private previousUserSelect = "";

  constructor(nvl: NVL, options: InertialPanOptions = {}) {
    this.nvl = nvl;
    this.container = nvl.getContainer();
    this.friction = options.friction ?? 150;
    this.minSpeed = options.minSpeed ?? 0.02;
    this.maxSpeed = options.maxSpeed ?? 1.5;
    const excludeNodes = options.excludeNodes ?? true;
    this.excludeNodes =
      typeof excludeNodes === "function" ? excludeNodes : () => excludeNodes;
    this.anyButton = options.anyButton ?? (() => false);

    this.container.style.touchAction = "none";
    this.container.addEventListener("pointerdown", this.onPointerDown);
    this.container.addEventListener("pointermove", this.onPointerMove);
    this.container.addEventListener("pointerup", this.onPointerUp);
    this.container.addEventListener("pointercancel", this.onPointerUp);
    // Capture phase, to swallow the click after a pan before NVL sees it.
    this.container.addEventListener("click", this.onClick, true);
    this.container.addEventListener("wheel", this.stopGlide, { passive: true });
  }

  destroy(): void {
    if (this.suppressTimer !== null) clearTimeout(this.suppressTimer);
    this.suppressTimer = null;
    this.stopGlide();
    this.endDrag();
    this.container.removeEventListener("pointerdown", this.onPointerDown);
    this.container.removeEventListener("pointermove", this.onPointerMove);
    this.container.removeEventListener("pointerup", this.onPointerUp);
    this.container.removeEventListener("pointercancel", this.onPointerUp);
    this.container.removeEventListener("click", this.onClick, true);
    this.container.removeEventListener("wheel", this.stopGlide);
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (this.pointerId !== null) return;
    if (
      event.pointerType === "mouse" &&
      event.button !== 0 &&
      !this.anyButton()
    )
      return;
    if (
      this.excludeNodes() &&
      this.nvl.getHits(event, ["node"]).nvlTargets.nodes.length > 0
    )
      return;

    this.pointerId = event.pointerId; // before stopGlide, so the glide's pan is kept
    this.stopGlide();
    this.last = { x: event.clientX, y: event.clientY };
    this.start = { x: event.clientX, y: event.clientY };
    this.samples = [{ x: event.clientX, y: event.clientY, t: event.timeStamp }];
    this.container.setPointerCapture(event.pointerId);
    this.previousCursor = this.container.style.cursor;
    this.previousUserSelect = document.body.style.userSelect;
    this.container.style.cursor = "grabbing";
    document.body.style.userSelect = "none";
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId || this.last === null) return;
    this.panByScreenDelta(
      event.clientX - this.last.x,
      event.clientY - this.last.y,
    );
    this.last = { x: event.clientX, y: event.clientY };
    this.samples.push({
      x: event.clientX,
      y: event.clientY,
      t: event.timeStamp,
    });
    const cutoff = event.timeStamp - VELOCITY_WINDOW_MS;
    this.samples = this.samples.filter((sample) => sample.t >= cutoff);
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    const velocity = this.releaseVelocity(event.timeStamp);
    // Releasing a pan over a node must not count as clicking that node.
    if (
      this.start &&
      Math.hypot(event.clientX - this.start.x, event.clientY - this.start.y) >
        CLICK_SLOP_PX
    ) {
      this.suppressClick = true;
      if (this.suppressTimer !== null) clearTimeout(this.suppressTimer);
      this.suppressTimer = setTimeout(() => {
        this.suppressClick = false;
        this.suppressTimer = null;
      }, CLICK_SUPPRESS_MS);
    }
    this.endDrag();
    if (Math.hypot(velocity.x, velocity.y) < this.minSpeed) {
      this.pan = null;
      return;
    }
    this.velocity = velocity;
    this.startGlide();
  };

  private endDrag(): void {
    if (
      this.pointerId !== null &&
      this.container.hasPointerCapture(this.pointerId)
    ) {
      this.container.releasePointerCapture(this.pointerId);
    }
    if (this.pointerId !== null) {
      this.container.style.cursor = this.previousCursor;
      document.body.style.userSelect = this.previousUserSelect;
    }
    this.pointerId = null;
    this.last = null;
    this.start = null;
    this.samples = [];
  }

  private onClick = (event: MouseEvent): void => {
    if (!this.suppressClick) return;
    this.suppressClick = false;
    event.stopPropagation();
  };

  private releaseVelocity(releaseTime: number): { x: number; y: number } {
    const { samples } = this;
    if (samples.length < 2) return { x: 0, y: 0 };
    const first = samples[0];
    const last = samples[samples.length - 1];
    if (releaseTime - last.t > STALE_SAMPLE_MS) return { x: 0, y: 0 };
    const dt = last.t - first.t;
    if (dt <= 0) return { x: 0, y: 0 };
    let vx = (last.x - first.x) / dt;
    let vy = (last.y - first.y) / dt;
    const speed = Math.hypot(vx, vy);
    if (speed > this.maxSpeed) {
      vx = (vx / speed) * this.maxSpeed;
      vy = (vy / speed) * this.maxSpeed;
    }
    return { x: vx, y: vy };
  }

  private startGlide(): void {
    let previous = performance.now();
    const step = (now: number): void => {
      const dt = Math.min(now - previous, 50);
      previous = now;
      // Exact integral over dt, so the glide doesn't depend on frame rate.
      const decay = Math.exp(-dt / this.friction);
      const travel = this.friction * (1 - decay);
      this.panByScreenDelta(this.velocity.x * travel, this.velocity.y * travel);
      this.velocity = {
        x: this.velocity.x * decay,
        y: this.velocity.y * decay,
      };

      if (Math.hypot(this.velocity.x, this.velocity.y) < this.minSpeed) {
        this.frame = null;
        this.pan = null;
        return;
      }
      this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }

  private stopGlide = (): void => {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.velocity = { x: 0, y: 0 };
    // A press during a glide keeps this.pan: getPan() may still lag behind.
    if (this.pointerId === null) this.pan = null;
  };

  // Pan is the graph point at the centre, so it moves opposite to the scene.
  private panByScreenDelta(dx: number, dy: number): void {
    const scale = this.nvl.getScale();
    // Resync from NVL at gesture start or after a zoom (zooming moves the pan too).
    if (this.pan === null || this.pan.scale !== scale) {
      const current = this.nvl.getPan();
      this.pan = { x: current.x, y: current.y, scale };
    }
    const perUnit = scale / window.devicePixelRatio; // CSS pixels per graph unit
    this.pan.x -= dx / perUnit;
    this.pan.y -= dy / perUnit;
    this.nvl.setPan(this.pan.x, this.pan.y);
  }
}
