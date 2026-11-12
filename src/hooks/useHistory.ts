import type { RefObject } from "react";
import { useCallback, useRef, useState } from "react";

import type { GraphPaneHandle } from "../components/GraphPane";
import type { GraphSnapshot } from "../components/GraphPane";
import type { SceneState } from "../data/scene";

// Taken just before the data graph changes, so it holds the state the user is about to leave.
export type Snapshot = SceneState & {
  id: number;
  /** What is about to happen. Shown on the card. */
  reason: string;
  time: number;
  nodes: number;
  relationships: number;
  /** Null when the graph was empty. */
  view: GraphSnapshot | null;
};

// The live graph as the history's front card, captured when the history was opened.
export type NowCard = {
  time: number;
  nodes: number;
  relationships: number;
  /** Null when the graph is empty. */
  view: GraphSnapshot | null;
};

const MAX_SNAPSHOTS = 30;

type UseHistoryOptions = {
  /** Read synchronously when a snapshot is taken. */
  getState: () => SceneState;
  paneRef: RefObject<GraphPaneHandle | null>;
  getCounts: () => { nodes: number; relationships: number };
};

// Snapshots taken before every data graph change, plus the "now" card while the history is open.
export const useHistory = ({
  getState,
  paneRef,
  getCounts,
}: UseHistoryOptions) => {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  // Null while the history is closed.
  const [nowCard, setNowCard] = useState<NowCard | null>(null);
  const nextId = useRef(0);
  const lastRecorded = useRef<SceneState | null>(null);

  // Read through a ref so `record` and `open` stay stable.
  const options = useRef({ getState, paneRef, getCounts });
  options.current = { getState, paneRef, getCounts };

  // Call before changing state: everything is read synchronously, so it captures the graph as it is on screen.
  const record = useCallback((reason: string) => {
    const state = options.current.getState();
    const last = lastRecorded.current;
    // Nothing changed since the last snapshot.
    if (
      last &&
      (Object.keys(state) as (keyof SceneState)[]).every(
        (key) => last[key] === state[key],
      )
    )
      return;
    lastRecorded.current = state;

    const snapshot: Snapshot = {
      ...state,
      ...options.current.getCounts(),
      id: ++nextId.current,
      reason,
      time: Date.now(),
      view: options.current.paneRef.current?.capture() ?? null,
    };
    setSnapshots((current) => [...current, snapshot].slice(-MAX_SNAPSHOTS));
  }, []);

  const open = useCallback(() => {
    setNowCard({
      ...options.current.getCounts(),
      time: Date.now(),
      view: options.current.paneRef.current?.capture() ?? null,
    });
  }, []);

  const close = useCallback(() => setNowCard(null), []);

  return { snapshots, nowCard, record, open, close };
};
