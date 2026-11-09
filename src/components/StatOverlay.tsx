import { Typography } from "@neo4j-ndl/react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useRef, useState } from "react";

import type { Slice } from "../data/neo4j";
import { formatCount, formatPercent, fractionOf } from "../utils/format";

type StatOverlayProps = {
  title: string;
  /** How many of these are in the data graph right now. */
  inScene: number;
  /** How many exist in the whole database. */
  total: number;
  /** How many of those have at least one relationship: the nodes the ring slices over. */
  sliceTotal: number;
  /** The node's `size` (its radius), so the ring can sit just outside its edge. */
  nodeSize: number;
  /** Whether this label's nodes are loaded. Only then is the ring a control; otherwise it just shows the share on screen. */
  selected: boolean;
  /** Which nodes of this label are loaded. */
  slice: Slice;
  /**
   * How many of the loaded slice's nodes are on screen. Loaded nodes can be hidden (their label, or a second
   * label of theirs, was removed, or they were dismissed), so the slice alone would overstate what is shown.
   * Leave out when the label has no slice of its own.
   */
  visibleInSlice?: number;
  /** The most nodes the arc may cover. */
  maxCount: number;
  /** Called once, when a drag is released with a different slice. */
  onSliceChange: (slice: Slice) => void;
};

type DragMode = "shift" | "start" | "end";

/** Anything above zero gets at least a sliver, so a tiny share does not look the same as none. */
const MIN_VISIBLE_FRACTION = 0.015;
const visibleFraction = (fraction: number) =>
  fraction > 0 ? Math.max(fraction, MIN_VISIBLE_FRACTION) : 0;

const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));

// NVL lays the overlay out in a box the size of the node (diameter 2 * size) and scales that box with the
// zoom, so these numbers are in graph units: they scale with the graph.
const RING_GAP = 12;
const RING_WIDTH = 12;
const HANDLE_RADIUS = 12;
const HANDLE_HIT_RADIUS = 30;
const MIN_HANDLE_HIT_RADIUS = 10;
// Each end may grab at most this share of the arc, so the middle half is always free to shift it.
const HANDLE_HIT_ARC_SHARE = 0.25;
const BODY_HIT_WIDTH = 44;

/**
 * Content of a node's NVL `html` overlay: its label, how much of it is on screen, and a ring around it.
 *
 * Once the label is loaded the ring is a circular range control over that label's nodes: the full circle is
 * all of them, the red arc is the slice that is shown. Drag the arc to shift the slice, or drag either end
 * to make it smaller or larger. The new slice is reported when the drag is released.
 */
export const StatOverlay = ({
  title,
  inScene,
  total,
  sliceTotal,
  nodeSize,
  selected,
  slice,
  visibleInSlice,
  maxCount,
  onSliceChange,
}: StatOverlayProps) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const [dragSlice, setDragSlice] = useState<Slice | null>(null);
  const onSliceChangeRef = useRef(onSliceChange);
  onSliceChangeRef.current = onSliceChange;
  /** Detaches the window listeners of a drag in progress. */
  const stopDragRef = useRef<(() => void) | null>(null);
  // Unmounting mid-drag (a restore, a cleared graph) must not leave listeners behind that report a slice later.
  useEffect(() => () => stopDragRef.current?.(), []);

  const interactive = selected && sliceTotal > 0;
  const shownSlice = dragSlice ?? slice;

  // Where the arc starts (0 to 1 around the circle, from 12 o'clock) and how long it is.
  const arcStart = interactive ? shownSlice.skip / sliceTotal : 0;
  const arcLength = interactive
    ? Math.max(shownSlice.count / sliceTotal, MIN_VISIBLE_FRACTION)
    : visibleFraction(fractionOf(inScene, total));

  // Of the slice, the part that is on screen. The slice itself is drawn faintly behind it as the control, so
  // a slice whose nodes are hidden looks loaded but not shown. While dragging, the new slice is drawn in full.
  const showVisiblePart =
    interactive &&
    !dragSlice &&
    visibleInSlice !== undefined &&
    visibleInSlice < shownSlice.count;
  const visibleLength = showVisiblePart
    ? visibleFraction((visibleInSlice ?? 0) / sliceTotal)
    : 0;

  const box = nodeSize * 2;
  const center = nodeSize;
  const radius = nodeSize + RING_GAP;
  const circumference = 2 * Math.PI * radius;
  const dash = `${circumference * arcLength} ${circumference}`;
  const rotation = `rotate(${-90 + 360 * arcStart} ${center} ${center})`;

  const pointAt = (fraction: number) => {
    const angle = 2 * Math.PI * fraction - Math.PI / 2;
    return {
      x: center + radius * Math.cos(angle),
      y: center + radius * Math.sin(angle),
    };
  };

  /** Pointer position as a fraction around the circle, 0 at 12 o'clock and increasing clockwise. */
  const fractionAround = (event: {
    clientX: number;
    clientY: number;
  }): number => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const angle = Math.atan2(
      event.clientY - (rect.top + rect.height / 2),
      event.clientX - (rect.left + rect.width / 2),
    );
    return ((((angle + Math.PI / 2) / (2 * Math.PI)) % 1) + 1) % 1;
  };

  const beginDrag = (mode: DragMode) => (event: ReactPointerEvent) => {
    // Keep NVL out of it: no panning, no click on the node underneath.
    event.stopPropagation();
    event.preventDefault();
    if (!interactive) return;

    const origin = {
      start: slice.skip / sliceTotal,
      end: (slice.skip + slice.count) / sliceTotal,
    };
    const minLength = 1 / sliceTotal;
    const maxLength = Math.min(1, maxCount / sliceTotal);
    let last = fractionAround(event);
    let travelled = 0;
    let current: Slice = slice;

    const onMove = (move: PointerEvent) => {
      // Track movement as a signed distance around the circle so crossing 12 o'clock does not jump.
      const here = fractionAround(move);
      let step = here - last;
      if (step > 0.5) step -= 1;
      if (step < -0.5) step += 1;
      travelled += step;
      last = here;

      let start: number;
      let end: number;
      if (mode === "shift") {
        const length = origin.end - origin.start;
        start = clamp(origin.start + travelled, 0, 1 - length);
        end = start + length;
      } else if (mode === "start") {
        end = origin.end;
        start = clamp(
          origin.start + travelled,
          Math.max(0, end - maxLength),
          end - minLength,
        );
      } else {
        start = origin.start;
        end = clamp(
          origin.end + travelled,
          start + minLength,
          Math.min(1, start + maxLength),
        );
      }

      const skip = Math.round(start * sliceTotal);
      const count = clamp(
        Math.round(end * sliceTotal) - skip,
        1,
        Math.min(maxCount, sliceTotal - skip),
      );
      // Whatever the pointer does, a slice never covers more than maxCount nodes or runs past the last one.
      current = {
        skip: Math.min(skip, sliceTotal - 1),
        count: Math.min(count, maxCount),
      };
      setDragSlice(current);
    };

    const stop = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      stopDragRef.current = null;
    };
    const onUp = () => {
      stop();
      setDragSlice(null);
      if (current.skip !== slice.skip || current.count !== slice.count)
        onSliceChangeRef.current(current);
    };

    stopDragRef.current?.();
    stopDragRef.current = stop;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  // NVL listens for these on its container. Anything that starts on the ring must not reach it.
  const keepFromNvl = {
    onMouseDown: (e: { stopPropagation: () => void }) => e.stopPropagation(),
    onClick: (e: { stopPropagation: () => void }) => e.stopPropagation(),
  };

  const handleHitRadius = clamp(
    circumference * arcLength * HANDLE_HIT_ARC_SHARE,
    MIN_HANDLE_HIT_RADIUS,
    HANDLE_HIT_RADIUS,
  );
  const startPoint = pointAt(arcStart);
  const endPoint = pointAt(arcStart + arcLength);

  return (
    <div ref={rootRef} className="stat-overlay stat-node">
      <svg className="stat-ring" viewBox={`0 0 ${box} ${box}`}>
        <circle
          className="stat-ring-track"
          cx={center}
          cy={center}
          r={radius}
          strokeWidth={RING_WIDTH}
        />
        {arcLength > 0 && (
          <circle
            className={
              showVisiblePart
                ? "stat-ring-arc stat-ring-arc-loaded"
                : "stat-ring-arc"
            }
            cx={center}
            cy={center}
            r={radius}
            strokeWidth={RING_WIDTH}
            strokeDasharray={dash}
            // start at 12 o'clock, shifted by the slice's start, and run clockwise
            transform={rotation}
          />
        )}
        {visibleLength > 0 && (
          <circle
            className="stat-ring-arc"
            cx={center}
            cy={center}
            r={radius}
            strokeWidth={RING_WIDTH}
            strokeDasharray={`${circumference * visibleLength} ${circumference}`}
            transform={rotation}
          />
        )}
        {interactive && (
          <>
            {/* a wide invisible stroke so the arc is easy to grab when zoomed out */}
            <circle
              className="stat-ring-hit"
              cx={center}
              cy={center}
              r={radius}
              strokeWidth={BODY_HIT_WIDTH}
              strokeDasharray={dash}
              transform={rotation}
              onPointerDown={beginDrag("shift")}
              {...keepFromNvl}
            />
            <circle
              className="stat-handle"
              cx={startPoint.x}
              cy={startPoint.y}
              r={HANDLE_RADIUS}
            />
            <circle
              className="stat-handle"
              cx={endPoint.x}
              cy={endPoint.y}
              r={HANDLE_RADIUS}
            />
            <circle
              className="stat-handle-hit"
              data-handle="start"
              cx={startPoint.x}
              cy={startPoint.y}
              r={handleHitRadius}
              onPointerDown={beginDrag("start")}
              {...keepFromNvl}
            />
            <circle
              className="stat-handle-hit"
              data-handle="end"
              cx={endPoint.x}
              cy={endPoint.y}
              r={handleHitRadius}
              onPointerDown={beginDrag("end")}
              {...keepFromNvl}
            />
          </>
        )}
      </svg>
      <div className="stat-text">
        <Typography variant="title-4" className="stat-title">
          {title}
        </Typography>
        <Typography variant="body-small" className="stat-line">
          {`${formatCount(inScene)} in scene`}
        </Typography>
        <Typography variant="body-small" className="stat-line">
          {dragSlice
            ? `${formatCount(dragSlice.skip + 1)}\u2013${formatCount(dragSlice.skip + dragSlice.count)} of ${formatCount(sliceTotal)}${sliceTotal < total ? " connected" : ""}${dragSlice.count >= maxCount ? " (max)" : ""}`
            : `${formatPercent(fractionOf(inScene, total))} of ${formatCount(total)}`}
        </Typography>
      </div>
    </div>
  );
};
