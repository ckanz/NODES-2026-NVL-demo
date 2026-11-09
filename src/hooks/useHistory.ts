import type { RefObject } from "react";
import { useCallback, useRef, useState } from "react";

import type { GraphPaneHandle } from "../components/GraphPane";
import { makeThumbnail, MAX_SNAPSHOTS } from "../data/snapshots";
import type { NowCard, SceneState, Snapshot } from "../data/snapshots";

type UseHistoryOptions = {
  /** The scene state as it is right now. Read synchronously when a snapshot is taken. */
  getState: () => SceneState;
  /** The data pane, to take a picture of it and read where its nodes are. */
  paneRef: RefObject<GraphPaneHandle | null>;
  /** Node and relationship counts on screen, for the cards. */
  getCounts: () => { nodes: number; relationships: number };
};

/**
 * The history of the data graph: snapshots taken before every change, and the "now" card shown in front of them
 * while the history is open.
 */
export const useHistory = ({
  getState,
  paneRef,
  getCounts,
}: UseHistoryOptions) => {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  /** The live graph as it was when the history was opened. Null while the history is closed. */
  const [nowCard, setNowCard] = useState<NowCard | null>(null);
  const nextId = useRef(0);
  const lastRecorded = useRef<SceneState | null>(null);

  // The options are read through a ref so `record` and `open` can stay stable.
  const options = useRef({ getState, paneRef, getCounts });
  options.current = { getState, paneRef, getCounts };

  /**
   * Store how the data graph looks right now, before something changes it. Call this first, then change
   * state. Everything is read synchronously, so the picture and positions are of the graph as it is on
   * screen, not as it will be after the change.
   */
  const record = useCallback((reason: string) => {
    const state = options.current.getState();
    const last = lastRecorded.current;
    // Nothing has changed since the last snapshot was taken, so this would only repeat it.
    if (
      last &&
      (Object.keys(state) as (keyof SceneState)[]).every(
        (key) => last[key] === state[key],
      )
    )
      return;
    lastRecorded.current = state;

    const captured = options.current.paneRef.current?.capture() ?? null;
    const id = ++nextId.current;
    const snapshot: Snapshot = {
      ...state,
      ...options.current.getCounts(),
      id,
      reason,
      time: Date.now(),
      image: captured?.image ?? null,
      view: captured
        ? {
            positions: captured.positions,
            zoom: captured.zoom,
            pan: captured.pan,
          }
        : null,
    };
    setSnapshots((current) => [...current, snapshot].slice(-MAX_SNAPSHOTS));

    // The full-size picture is only needed to make the thumbnail that is kept.
    if (captured) {
      void makeThumbnail(captured.image).then((image) =>
        setSnapshots((current) =>
          current.map((entry) =>
            entry.id === id ? { ...entry, image } : entry,
          ),
        ),
      );
    }
  }, []);

  /**
   * Open the history. The live graph is the front card: it cannot sit inside the 3D stack and stay
   * interactive, so a picture of it is taken now, and the real one waits underneath.
   */
  const open = useCallback(() => {
    const captured = options.current.paneRef.current?.capture() ?? null;
    const card: NowCard = {
      ...options.current.getCounts(),
      time: Date.now(),
      image: captured?.image ?? null,
    };
    setNowCard(card);
    if (captured)
      void makeThumbnail(captured.image).then((image) =>
        setNowCard((current) =>
          current === card ? { ...card, image } : current,
        ),
      );
  }, []);

  const close = useCallback(() => setNowCard(null), []);

  return { snapshots, nowCard, record, open, close };
};
