import { Typography } from "@neo4j-ndl/react";
import type { PointerEvent as ReactPointerEvent, SVGProps } from "react";
import { useEffect, useRef, useState } from "react";

import type { Slice } from "../data/neo4j";
import { formatCount, formatPercent, fractionOf } from "../utils/format";

type StatOverlayProps = {
  title: string;
  inScene: number;
  /** Count in the whole database. */
  total: number;
  /** Nodes with at least one relationship: what the ring slices over. */
  sliceTotal: number;
  /** The node's radius. */
  nodeSize: number;
  /** Only when loaded is the ring a control; otherwise it shows the share on screen. */
  selected: boolean;
  slice: Slice;
  /** Nodes of the slice actually on screen. */
  visibleInSlice?: number;
  maxCount: number;
  /** Called once, when a drag is released with a different slice. */
  onSliceChange: (slice: Slice) => void;
};

type DragMode = "shift" | "start" | "end";

// Graph units: NVL scales the overlay with the zoom.
const RING_GAP = 12;
const RING_WIDTH = 6;
const HANDLE_RADIUS = 14;
const HIT_WIDTH = 44;
const HANDLE_HIT_RADIUS = 30;

// So a tiny share does not look the same as none.
const atLeastASliver = (fraction: number) =>
  fraction > 0 ? Math.max(fraction, 0.015) : 0;

const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));

// The new slice always covers 1 to maxCount nodes and stays within the label's nodes.
export const moveSlice = (
  mode: DragMode,
  from: Slice,
  travelled: number, // fraction of the circle, positive is clockwise
  total: number,
  maxCount: number,
): Slice => {
  const delta = Math.round(travelled * total);
  const end = from.skip + from.count;
  if (mode === "shift") {
    return {
      skip: clamp(from.skip + delta, 0, total - from.count),
      count: from.count,
    };
  }
  if (mode === "start") {
    const skip = clamp(from.skip + delta, Math.max(0, end - maxCount), end - 1);
    return { skip, count: end - skip };
  }
  const newEnd = clamp(
    end + delta,
    from.skip + 1,
    Math.min(total, from.skip + maxCount),
  );
  return { skip: from.skip, count: newEnd - from.skip };
};

/**
 * A schema node's NVL `html` overlay. Once loaded, the ring is a range control: drag the arc to shift the slice,
 * or an end to resize it.
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
  // Also run on unmount, so no window listener is left behind.
  const stopDragRef = useRef<(() => void) | null>(null);
  useEffect(() => () => stopDragRef.current?.(), []);

  const interactive = selected && sliceTotal > 0;
  const shown = dragSlice ?? slice;
  // Fractions of the circle, from 12 o'clock.
  const arcStart = interactive ? shown.skip / sliceTotal : 0;
  const arcLength = interactive
    ? atLeastASliver(shown.count / sliceTotal)
    : atLeastASliver(fractionOf(inScene, total));
  // Then the slice is drawn faintly, with the part on screen solid over it.
  const partlyHidden =
    interactive &&
    !dragSlice &&
    visibleInSlice !== undefined &&
    visibleInSlice < shown.count;

  const center = nodeSize;
  const radius = nodeSize + RING_GAP;
  const circumference = 2 * Math.PI * radius;
  const pointAt = (fraction: number) => {
    const angle = 2 * Math.PI * fraction - Math.PI / 2;
    return {
      cx: center + radius * Math.cos(angle),
      cy: center + radius * Math.sin(angle),
    };
  };

  // From the arc's start; `length` 1 is the full ring.
  const arc = (length: number, props: SVGProps<SVGCircleElement>) => (
    <circle
      cx={center}
      cy={center}
      r={radius}
      strokeWidth={RING_WIDTH}
      strokeDasharray={
        length < 1 ? `${circumference * length} ${circumference}` : undefined
      }
      transform={`rotate(${-90 + 360 * arcStart} ${center} ${center})`}
      {...props}
    />
  );

  // 0 at 12 o'clock, increasing clockwise.
  const fractionAround = ({
    clientX,
    clientY,
  }: {
    clientX: number;
    clientY: number;
  }) => {
    const rect = rootRef.current!.getBoundingClientRect();
    const angle = Math.atan2(
      clientY - rect.top - rect.height / 2,
      clientX - rect.left - rect.width / 2,
    );
    return (((angle / (2 * Math.PI) + 0.25) % 1) + 1) % 1;
  };

  const beginDrag = (mode: DragMode) => (event: ReactPointerEvent) => {
    // Keep NVL out of it: no panning, no click on the node underneath.
    event.stopPropagation();
    event.preventDefault();
    let last = fractionAround(event);
    let travelled = 0;
    let current = slice;

    const onMove = (move: PointerEvent) => {
      // Sum small steps, so crossing 12 o'clock does not jump a full turn.
      const here = fractionAround(move);
      travelled += ((here - last + 1.5) % 1) - 0.5;
      last = here;
      current = moveSlice(mode, slice, travelled, sliceTotal, maxCount);
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

  // At most a quarter of the arc each, so the middle stays free for shifting.
  const handleHitRadius = clamp(
    circumference * arcLength * 0.25,
    10,
    HANDLE_HIT_RADIUS,
  );
  const start = pointAt(arcStart);
  const end = pointAt(arcStart + arcLength);

  return (
    <div ref={rootRef} className="stat-overlay stat-node">
      {/* NVL's click handler also listens for mouse down and click, which must not reach it. */}
      <svg
        className="stat-ring"
        viewBox={`0 0 ${nodeSize * 2} ${nodeSize * 2}`}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {arc(1, { className: "stat-ring-track" })}
        {arcLength > 0 &&
          arc(arcLength, {
            className: partlyHidden
              ? "stat-ring-arc stat-ring-arc-loaded"
              : "stat-ring-arc",
          })}
        {partlyHidden &&
          (visibleInSlice ?? 0) > 0 &&
          arc(atLeastASliver((visibleInSlice ?? 0) / sliceTotal), {
            className: "stat-ring-arc",
          })}
        {interactive && (
          <>
            {arc(arcLength, {
              className: "stat-ring-hit",
              strokeWidth: HIT_WIDTH,
              onPointerDown: beginDrag("shift"),
            })}
            <circle className="stat-handle" {...start} r={HANDLE_RADIUS} />
            <circle className="stat-handle" {...end} r={HANDLE_RADIUS} />
            <circle
              className="stat-handle-hit"
              {...start}
              r={handleHitRadius}
              onPointerDown={beginDrag("start")}
            />
            <circle
              className="stat-handle-hit"
              {...end}
              r={handleHitRadius}
              onPointerDown={beginDrag("end")}
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
            ? `${formatCount(dragSlice.skip + 1)}\u2013${formatCount(dragSlice.skip + dragSlice.count)} of ${formatCount(sliceTotal)}`
            : `${formatPercent(fractionOf(inScene, total))} of ${formatCount(total)}`}
        </Typography>
      </div>
    </div>
  );
};
