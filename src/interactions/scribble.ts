// Interprets scribbles. Pure geometry in graph coordinates, so zoom doesn't matter.
import type { Point } from "@neo4j-nvl/base";

export type Stroke = Point[];

export type SceneNode = {
  id: string;
  x: number;
  y: number;
  radius: number;
};
export type SceneRelationship = { id: string; from: string; to: string };

export type ScribbleResult = {
  dismissNodes: string[];
  dismissRelationships: string[];
  paths: { from: string; to: string }[];
  // Indices of used strokes. The rest stay on screen.
  consumed: number[];
};

// Strokes count as touching a node slightly outside its edge; hands aren't precise.
const NODE_REACH = 1.2;
// A circle's ends meet (relative to its size) and it encloses some area.
const CLOSED_GAP_RATIO = 0.3;
const CLOSED_MIN_AREA_RATIO = 0.25;
const MIN_POINTS = 5;

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

const boundingDiagonal = (stroke: Stroke): number => {
  const xs = stroke.map((p) => p.x);
  const ys = stroke.map((p) => p.y);
  return Math.hypot(
    Math.max(...xs) - Math.min(...xs),
    Math.max(...ys) - Math.min(...ys),
  );
};

// Shoelace formula.
const polygonArea = (polygon: Stroke): number => {
  let sum = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
};

const isCircle = (stroke: Stroke): boolean => {
  if (stroke.length < MIN_POINTS * 2) return false;
  const diagonal = boundingDiagonal(stroke);
  if (diagonal === 0) return false;
  if (
    distance(stroke[0], stroke[stroke.length - 1]) >
    CLOSED_GAP_RATIO * diagonal
  )
    return false;
  // A zigzag can also end where it began; a circle has room inside it.
  return (
    polygonArea(stroke) > CLOSED_MIN_AREA_RATIO * Math.PI * (diagonal / 2) ** 2
  );
};

// Ray casting.
const insidePolygon = (point: Point, polygon: Stroke): boolean => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
};

const cross = (o: Point, a: Point, b: Point) =>
  (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

const segmentsIntersect = (a: Point, b: Point, c: Point, d: Point): boolean => {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return d1 * d2 < 0 && d3 * d4 < 0;
};

const polylineCrossesSegment = (
  stroke: Stroke,
  a: Point,
  b: Point,
): boolean => {
  for (let i = 1; i < stroke.length; i++)
    if (segmentsIntersect(stroke[i - 1], stroke[i], a, b)) return true;
  return false;
};

// The outline is treated as closed.
const strokeCrossesOutline = (stroke: Stroke, outline: Stroke): boolean => {
  for (let i = 0; i < outline.length; i++) {
    if (
      polylineCrossesSegment(
        stroke,
        outline[i],
        outline[(i + 1) % outline.length],
      )
    )
      return true;
  }
  return false;
};

const distanceToSegment = (p: Point, a: Point, b: Point): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t =
    dx === 0 && dy === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy),
          ),
        );
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};

const nodeAt = (point: Point, nodes: SceneNode[]): SceneNode | undefined => {
  let best: SceneNode | undefined;
  let bestDistance = Infinity;
  for (const node of nodes) {
    const d = distance(point, node);
    if (d <= node.radius * NODE_REACH && d < bestDistance) {
      best = node;
      bestDistance = d;
    }
  }
  return best;
};

// Only strokes that start and end outside the node cross it, so starting a line on a node doesn't dismiss it.
const crossesNode = (stroke: Stroke, node: SceneNode): boolean => {
  const reach = node.radius * NODE_REACH;
  if (
    distance(stroke[0], node) <= reach ||
    distance(stroke[stroke.length - 1], node) <= reach
  )
    return false;
  for (let i = 1; i < stroke.length; i++)
    if (distanceToSegment(node, stroke[i - 1], stroke[i]) <= reach) return true;
  return false;
};

// The part of the relationship inside each node is not counted.
const crossesRelationship = (
  stroke: Stroke,
  from: SceneNode,
  to: SceneNode,
): boolean => {
  const length = distance(from, to);
  if (length <= from.radius + to.radius) return false;
  const ux = (to.x - from.x) / length;
  const uy = (to.y - from.y) / length;
  const start = { x: from.x + ux * from.radius, y: from.y + uy * from.radius };
  const end = { x: to.x - ux * to.radius, y: to.y - uy * to.radius };
  return polylineCrossesSegment(stroke, start, end);
};

/**
 * - line from node to node: shortest path
 * - stroke through a node or relationship: dismiss it
 * - stroke through a circle: dismiss the nodes inside (a circle alone does nothing)
 */
export const analyseScribbles = (
  strokes: Stroke[],
  nodes: SceneNode[],
  relationships: SceneRelationship[],
): ScribbleResult => {
  const dismissNodes = new Set<string>();
  const dismissRelationships = new Set<string>();
  const paths: { from: string; to: string }[] = [];
  const consumed = new Set<number>();
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  const usable = strokes
    .map((stroke, index) => ({ stroke, index }))
    .filter(({ stroke }) => stroke.length >= MIN_POINTS);

  const circles = usable
    .filter(({ stroke }) => isCircle(stroke))
    .map(({ stroke, index }) => ({
      index,
      outline: stroke,
      inside: nodes
        .filter((node) => insidePolygon(node, stroke))
        .map((node) => node.id),
    }));
  const circleIndices = new Set(circles.map((circle) => circle.index));

  for (const { stroke, index } of usable) {
    if (circleIndices.has(index)) continue;

    const first = nodeAt(stroke[0], nodes);
    const last = nodeAt(stroke[stroke.length - 1], nodes);
    if (first && last && first.id !== last.id) {
      const duplicate = paths.some(
        (path) =>
          (path.from === first.id && path.to === last.id) ||
          (path.from === last.id && path.to === first.id),
      );
      if (!duplicate) paths.push({ from: first.id, to: last.id });
      consumed.add(index);
      continue;
    }

    const crossedCircles = circles.filter((circle) =>
      strokeCrossesOutline(stroke, circle.outline),
    );
    if (crossedCircles.length > 0) {
      for (const circle of crossedCircles) {
        circle.inside.forEach((id) => dismissNodes.add(id));
        consumed.add(circle.index);
      }
      consumed.add(index);
      continue;
    }

    const crossedNodes = nodes.filter((node) => crossesNode(stroke, node));
    const crossedRelationships = relationships.filter((relationship) => {
      const from = nodeById.get(relationship.from);
      const to = nodeById.get(relationship.to);
      return from && to && crossesRelationship(stroke, from, to);
    });
    if (crossedNodes.length > 0 || crossedRelationships.length > 0) {
      crossedNodes.forEach((node) => dismissNodes.add(node.id));
      crossedRelationships.forEach((relationship) =>
        dismissRelationships.add(relationship.id),
      );
      consumed.add(index);
    }
  }

  return {
    dismissNodes: [...dismissNodes],
    dismissRelationships: [...dismissRelationships],
    paths,
    consumed: [...consumed],
  };
};
