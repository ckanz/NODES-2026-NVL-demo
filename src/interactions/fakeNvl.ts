import type { NVL } from "@neo4j-nvl/base";

import type { Point } from "./viewport";

type Listener = (event: unknown) => void;

/**
 * Just enough of an NVL instance for the interaction handlers, with one property of the real thing that matters:
 * like NVL 2.0, setPan / setZoomAndPan only store a pending value, and getPan / getScale keep returning the old
 * one until the next `render()`.
 */
export class FakeNvl {
  private pan: Point = { x: 0, y: 0 };
  private zoom = 1;
  private pending: { pan: Point; zoom: number } | null = null;
  private readonly listeners = new Map<string, Set<Listener>>();
  readonly rect = { left: 0, top: 0, width: 800, height: 600 };

  readonly container = {
    style: {} as Record<string, string>,
    addEventListener: (type: string, listener: Listener) => {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type)!.add(listener);
    },
    removeEventListener: (type: string, listener: Listener) =>
      this.listeners.get(type)?.delete(listener),
    getBoundingClientRect: () => this.rect,
    setPointerCapture: () => {},
    hasPointerCapture: () => false,
    releasePointerCapture: () => {},
    parentElement: null,
  };

  constructor(view: { pan?: Point; zoom?: number } = {}) {
    this.pan = view.pan ?? this.pan;
    this.zoom = view.zoom ?? this.zoom;
  }

  asNvl = () => this as unknown as NVL;

  getContainer = () => this.container;
  getPan = () => ({ ...this.pan });
  getScale = () => this.zoom;
  getHits = () => ({ nvlTargets: { nodes: [], relationships: [] } });
  setPan = (x: number, y: number) => {
    this.pending = { pan: { x, y }, zoom: this.pending?.zoom ?? this.zoom };
  };
  setZoomAndPan = (zoom: number, x: number, y: number) => {
    this.pending = { pan: { x, y }, zoom };
  };

  /** What NVL does on its next frame: apply what was set since the last one. */
  render() {
    if (!this.pending) return;
    this.pan = this.pending.pan;
    this.zoom = this.pending.zoom;
    this.pending = null;
  }

  /** Fires an event at the container's listeners. */
  dispatch(type: string, event: object) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}
