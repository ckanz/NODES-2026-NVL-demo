import { Box, CleanIconButton, Flex, Typography } from "@neo4j-ndl/react";
import {
  ChevronLeftIconOutline,
  ChevronRightIconOutline,
  XMarkIconOutline,
} from "@neo4j-ndl/react/icons";
import type { CSSProperties, KeyboardEvent, WheelEvent } from "react";
import { useEffect, useRef, useState } from "react";

import type { NowCard, Snapshot } from "../data/snapshots";
import { formatGraphSummary } from "../utils/format";

type TimeMachineProps = {
  /** Oldest first. */
  snapshots: Snapshot[];
  /** The graph as it is now. It is the front card, with the snapshots receding behind it. */
  now: NowCard;
  /** The user picked a snapshot to go back to. */
  onRestore: (snapshot: Snapshot) => void;
  onClose: () => void;
};

const formatTime = (time: number) =>
  new Date(time).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

/** One card of the stack: a snapshot, or the live graph at the front. */
type Card = {
  key: string;
  title: string;
  time: number;
  nodes: number;
  relationships: number;
  image: string | null;
  snapshot?: Snapshot;
};

// How the stack recedes. The front card fills the pane, and each step back in time moves a card this far
// into the screen and up, so the older ones show as a row of tabs above it.
const DEPTH_PER_STEP = 130;
const RISE_PER_STEP = 30;
const FADE_PER_STEP = 0.16;
const MAX_VISIBLE_BEHIND = 4;
// Scrolling: this much wheel movement is one step, with a short pause so a trackpad does not fly through.
const WHEEL_STEP = 50;
const WHEEL_COOLDOWN_MS = 140;

/** Where one card sits, given how many steps it is from the front card. Negative is older, behind it. */
const cardStyle = (offset: number): CSSProperties => {
  if (offset > 0) {
    // Newer than the front card: it has been passed, so it swings past the viewer and out of sight.
    return {
      transform: `translate3d(0, ${offset * 140}px, ${offset * 300}px)`,
      opacity: 0,
      pointerEvents: "none",
      zIndex: 100 - offset,
    };
  }
  const behind = -offset;
  const visible = behind <= MAX_VISIBLE_BEHIND;
  return {
    transform: `translate3d(0, ${-behind * RISE_PER_STEP}px, ${-behind * DEPTH_PER_STEP}px)`,
    opacity: visible ? Math.max(0.2, 1 - behind * FADE_PER_STEP) : 0,
    pointerEvents: visible ? "auto" : "none",
    zIndex: 100 - behind,
  };
};

/**
 * Snapshots as a stack of cards receding into the screen, newest in front, like flicking back through
 * a pile of pictures. Scroll, use the arrow keys or the buttons to move through time. Clicking a card
 * further back brings it to the front; clicking the front card goes back to it.
 */
export const TimeMachine = ({
  snapshots,
  now,
  onRestore,
  onClose,
}: TimeMachineProps) => {
  const cards: Card[] = [
    ...snapshots.map((snapshot) => ({
      key: String(snapshot.id),
      title: snapshot.reason,
      time: snapshot.time,
      nodes: snapshot.nodes,
      relationships: snapshot.relationships,
      image: snapshot.image,
      snapshot,
    })),
    {
      key: "now",
      title: "Now",
      time: now.time,
      nodes: now.nodes,
      relationships: now.relationships,
      image: now.image,
    },
  ];
  const [active, setActive] = useState(cards.length - 1);
  const rootRef = useRef<HTMLDivElement>(null);
  const wheelTotal = useRef(0);
  const lastStep = useRef(0);

  // A new snapshot arrives while the stack is open: bring it to the front.
  const count = cards.length;
  useEffect(() => setActive(count - 1), [count]);
  // Take the keyboard, so the arrow keys work straight away.
  useEffect(() => rootRef.current?.focus(), []);

  const step = (by: number) =>
    setActive((index) => Math.min(count - 1, Math.max(0, index + by)));

  /** The front card was chosen: go back to a snapshot, or return to the live graph. */
  const choose = (index: number) => {
    const card = cards[index];
    if (card?.snapshot) onRestore(card.snapshot);
    else onClose();
  };

  const onWheel = (event: WheelEvent) => {
    wheelTotal.current += event.deltaY;
    const now = performance.now();
    if (
      Math.abs(wheelTotal.current) < WHEEL_STEP ||
      now - lastStep.current < WHEEL_COOLDOWN_MS
    )
      return;
    // Scrolling down goes further back in time.
    step(wheelTotal.current > 0 ? -1 : 1);
    wheelTotal.current = 0;
    lastStep.current = now;
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const keys: Record<string, () => void> = {
      ArrowLeft: () => step(-1),
      ArrowDown: () => step(-1),
      ArrowRight: () => step(1),
      ArrowUp: () => step(1),
      Enter: () => choose(active),
      Escape: onClose,
    };
    const action = keys[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  };

  const current = cards[active];

  return (
    <div
      ref={rootRef}
      className="time-machine"
      role="dialog"
      aria-label="History"
      tabIndex={-1}
      onWheel={onWheel}
      onKeyDown={onKeyDown}
    >
      <div className="time-machine-header">
        <Typography variant="subheading-small">History</Typography>
        <Typography
          variant="body-small"
          className="text-neutral-text-weak time-machine-hint"
        >
          {current?.snapshot
            ? `${active + 1} of ${count}. Click the front card to go back to this point.`
            : "Scroll or use the arrow keys to go back in time. Click the front card to return to the live graph."}
        </Typography>
        <CleanIconButton
          description="Older"
          size="small"
          onClick={() => step(-1)}
        >
          <ChevronLeftIconOutline />
        </CleanIconButton>
        <CleanIconButton
          description="Newer"
          size="small"
          onClick={() => step(1)}
        >
          <ChevronRightIconOutline />
        </CleanIconButton>
        <CleanIconButton
          description="Close history"
          size="small"
          onClick={onClose}
        >
          <XMarkIconOutline />
        </CleanIconButton>
      </div>

      <div className="time-machine-stage">
        {cards.map((card, index) => (
          <button
            key={card.key}
            type="button"
            tabIndex={-1}
            className={`time-machine-card${index === active ? " time-machine-card-active" : ""}${card.snapshot ? "" : " time-machine-card-now"}`}
            style={cardStyle(index - active)}
            onClick={() =>
              index === active ? choose(index) : setActive(index)
            }
          >
            {/* A tab above the card. It is what peeks out from behind the cards in front. */}
            <span className="time-machine-tab">
              <Typography variant="label" className="time-machine-reason">
                {card.title}
              </Typography>
              <Typography
                variant="body-small"
                className="text-neutral-text-weak"
              >
                {formatTime(card.time)}
              </Typography>
            </span>

            {card.image ? (
              <img
                className="time-machine-image"
                src={card.image}
                alt=""
                draggable={false}
              />
            ) : (
              <div className="time-machine-image" />
            )}

            {/* The pane's title panel as it read at that moment, so the card looks like the app itself. */}
            <Box padding="16" borderRadius="xl" className="panel panel-title">
              <Flex gap="4">
                <Typography variant="title-3">Data</Typography>
                <Typography
                  variant="body-medium"
                  className="text-neutral-text-weak"
                >
                  {formatGraphSummary(card.nodes, card.relationships)}
                </Typography>
              </Flex>
            </Box>
          </button>
        ))}
      </div>
    </div>
  );
};
