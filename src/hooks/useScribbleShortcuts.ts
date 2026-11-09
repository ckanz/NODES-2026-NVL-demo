import type { RefObject } from "react";
import { useEffect, useRef } from "react";

import type { GraphPaneHandle } from "../components/GraphPane";

type UseScribbleShortcutsOptions = {
  scribbling: boolean;
  /** Whether scribble mode may be turned on now. */
  canScribble: boolean;
  setScribbling: (on: boolean) => void;
  paneRef: RefObject<GraphPaneHandle | null>;
};

/**
 * Keyboard for scribble mode: S starts and finishes it, Escape cancels it (nothing is acted on), Backspace undoes
 * the last stroke. Ignored while typing in a form field, or with a modifier held.
 */
export const useScribbleShortcuts = ({
  scribbling,
  canScribble,
  setScribbling,
  paneRef,
}: UseScribbleShortcutsOptions) => {
  // Read through a ref so the listener is added once.
  const current = useRef({ scribbling, canScribble, setScribbling, paneRef });
  current.current = { scribbling, canScribble, setScribbling, paneRef };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat)
        return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      )
        return;
      const { scribbling, canScribble, setScribbling, paneRef } =
        current.current;

      if (event.key === "s" || event.key === "S") {
        if (!scribbling && !canScribble) return;
        event.preventDefault();
        setScribbling(!scribbling);
      } else if (scribbling && event.key === "Escape") {
        event.preventDefault();
        paneRef.current?.discardScribbles(); // before turning off, so there is nothing left to act on
        setScribbling(false);
      } else if (scribbling && event.key === "Backspace") {
        event.preventDefault();
        paneRef.current?.undoScribble();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
};
