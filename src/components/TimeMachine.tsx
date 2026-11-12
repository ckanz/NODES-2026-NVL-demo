import { Box, CleanIconButton, Flex, Typography } from "@neo4j-ndl/react";
import {
  ChevronLeftIconOutline,
  ChevronRightIconOutline,
  XMarkIconOutline,
} from "@neo4j-ndl/react/icons";
import type { CSSProperties, WheelEvent } from "react";
import { useEffect, useRef, useState } from "react";

import type { NowCard, Snapshot } from "../hooks/useHistory";
import type { GraphSnapshot } from "./GraphPane";
import { SnapshotPicture } from "./SnapshotPicture";
import { formatGraphSummary } from "../utils/format";

type TimeMachineProps = {
  snapshots: Snapshot[];
  now: NowCard;
  onRestore: (snapshot: Snapshot) => void;
  onClose: () => void;
};

const formatTime = (time: number) =>
  new Date(time).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

// A snapshot, or the live graph at the front.
type Card = {
  key: string;
  title: string;
  time: number;
  nodes: number;
  relationships: number;
  view: GraphSnapshot | null;
  snapshot?: Snapshot;
};

// Each step back moves a card into the screen and up, so older ones show as tabs above the front card.
const DEPTH_PER_STEP = 130;
const RISE_PER_STEP = 30;
const FADE_PER_STEP = 0.16;
const MAX_VISIBLE_BEHIND = 4;
// The cooldown stops a trackpad flying through the stack.
const WHEEL_STEP = 50;
const WHEEL_COOLDOWN_MS = 140;

// `offset` is steps from the front card; negative is older.
const cardStyle = (offset: number): CSSProperties => {
  if (offset > 0) {
    // Newer cards swing past the viewer and out of sight.
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

// Snapshots as a stack of cards, newest in front. Clicking the front card restores it.
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
      view: snapshot.view,
      snapshot,
    })),
    {
      key: "now",
      title: "Now",
      time: now.time,
      nodes: now.nodes,
      relationships: now.relationships,
      view: now.view,
    },
  ];
  const [active, setActive] = useState(cards.length - 1);
  const wheelTotal = useRef(0);
  const lastStep = useRef(0);

  // Bring a snapshot that arrives while open to the front.
  const count = cards.length;
  useEffect(() => setActive(count - 1), [count]);

  const step = (by: number) =>
    setActive((index) => Math.min(count - 1, Math.max(0, index + by)));

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
    // Down goes back in time.
    step(wheelTotal.current > 0 ? -1 : 1);
    wheelTotal.current = 0;
    lastStep.current = now;
  };

  const current = cards[active];

  return (
    <div
      className="time-machine"
      role="dialog"
      aria-label="History"
      onWheel={onWheel}
    >
      <div className="time-machine-header">
        <Typography variant="subheading-small">History</Typography>
        <Typography
          variant="body-small"
          className="text-neutral-text-weak time-machine-hint"
        >
          {current?.snapshot
            ? `${active + 1} of ${count}. Click the front card to go back to this point.`
            : "Scroll to go back in time. Click the front card to return to the live graph."}
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
            {/* What peeks out from behind the cards in front. */}
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

            {card.view ? (
              <SnapshotPicture
                view={card.view}
                className="time-machine-image"
              />
            ) : (
              <div className="time-machine-image" />
            )}

            {/* Mimics the pane's title panel at that moment. */}
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
