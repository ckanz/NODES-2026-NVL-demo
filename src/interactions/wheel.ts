const LINE_HEIGHT_PX = 16;
const PAGE_HEIGHT_PX = 400;
const MAX_DELTA_PX = 200;

/** Wheel delta in pixels regardless of the device's delta mode, clamped so one event cannot jump. */
export const normalizeWheelDelta = (event: WheelEvent): number => {
  const unit =
    event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? LINE_HEIGHT_PX
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? PAGE_HEIGHT_PX
        : 1;
  return Math.max(-MAX_DELTA_PX, Math.min(MAX_DELTA_PX, event.deltaY * unit));
};
