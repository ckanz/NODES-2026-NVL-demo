import { LoadingSpinner } from "@neo4j-ndl/react";
import type { NvlOptions } from "@neo4j-nvl/base";
import { StaticPictureWrapper } from "@neo4j-nvl/react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";

import type { GraphSnapshot } from "./GraphPane";

// "free" keeps nodes at the given positions. No WebGL: a context per card would hit the browser's limit.
const PICTURE_OPTIONS: NvlOptions = { layout: "free", disableWebGL: true };

// A static NVL picture of a snapshot, with a spinner until it is ready.
export const SnapshotPicture = ({
  view,
  className,
}: {
  view: GraphSnapshot;
  className?: string;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number }>();
  // Offset sizes ignore the card's 3D transform.
  useLayoutEffect(() => {
    const element = ref.current;
    if (element)
      setSize({ width: element.offsetWidth, height: element.offsetHeight });
  }, []);

  // Memoized: the picture is redrawn whenever these change.
  const nodes = useMemo(() => {
    const at = new Map(
      view.positions.map((position) => [position.id, position]),
    );
    return view.graph.nodes.map((node) => ({
      ...node,
      x: at.get(node.id)?.x,
      y: at.get(node.id)?.y,
    }));
  }, [view]);

  return (
    <div ref={ref} className={className}>
      {size ? (
        <StaticPictureWrapper
          nodes={nodes}
          rels={view.graph.relationships}
          nvlOptions={PICTURE_OPTIONS}
          width={size.width}
          height={size.height}
        />
      ) : null}
      <LoadingSpinner className="snapshot-picture-spinner" />
    </div>
  );
};
