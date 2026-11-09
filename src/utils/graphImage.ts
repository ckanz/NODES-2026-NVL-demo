/**
 * A picture of the whole graph, however the camera is set.
 *
 * NVL can only give a picture of the current view (`getImageDataUrl`), so a snapshot taken while zoomed in
 * would show a few nodes. `saveFullGraphToLargeFile` does cover everything, but it is a download, not an image
 * we can keep, and it draws at the default zoom, which is enormous for a big graph. So the picture is drawn here,
 * from the node positions, scaled to fit. It is not NVL's own rendering (no arrowheads, no captions), but it
 * shows the shape of the whole graph, and it works in one synchronous step.
 */

export type DrawnNode = {
  id: string;
  x: number;
  y: number;
  color?: string;
  /** Radius in graph units. */ radius: number;
};
export type DrawnRelationship = { from: string; to: string; color?: string };

type GraphImageOptions = {
  nodes: DrawnNode[];
  relationships: DrawnRelationship[];
  /** Size of the picture in pixels. */
  width: number;
  height: number;
  background: string;
  /** Used for relationships that have no color of their own. */
  relationshipColor: string;
  /** Fallback fill for nodes that have no color of their own. */
  nodeColor: string;
};

/** Empty space left around the graph, as a share of the picture's shorter side. */
const MARGIN = 0.06;
/** No node is drawn smaller than this, so every node stays visible in a graph of tens of thousands. */
const MIN_NODE_RADIUS_PX = 1.5;
/** Width of relationship lines, in pixels of the picture. */
const RELATIONSHIP_WIDTH_PX = 1;

/** Draws the graph fitted into `width` x `height` and returns it as a PNG data URL. */
export const renderGraphImage = ({
  nodes,
  relationships,
  width,
  height,
  background,
  relationshipColor,
  nodeColor,
}: GraphImageOptions): string => {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const context = canvas.getContext("2d");
  if (!context) return canvas.toDataURL("image/png");

  context.fillStyle = background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  if (nodes.length === 0) return canvas.toDataURL("image/png");

  // Bounds of the whole graph, nodes included (not just their centres).
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.x - node.radius);
    minY = Math.min(minY, node.y - node.radius);
    maxX = Math.max(maxX, node.x + node.radius);
    maxY = Math.max(maxY, node.y + node.radius);
  }
  // A single node, or nodes in a line, would give no extent to scale by.
  const graphWidth = Math.max(maxX - minX, 1);
  const graphHeight = Math.max(maxY - minY, 1);

  const margin = Math.min(canvas.width, canvas.height) * MARGIN;
  const scale = Math.min(
    (canvas.width - 2 * margin) / graphWidth,
    (canvas.height - 2 * margin) / graphHeight,
  );
  // Centre the graph in whatever room is left over.
  const offsetX = (canvas.width - graphWidth * scale) / 2 - minX * scale;
  const offsetY = (canvas.height - graphHeight * scale) / 2 - minY * scale;

  const byId = new Map(nodes.map((node) => [node.id, node]));

  context.lineWidth = RELATIONSHIP_WIDTH_PX;
  context.lineCap = "round";
  // One path per color: a single stroke for thousands of lines is much cheaper than one each.
  const linesByColor = new Map<string, Path2D>();
  for (const relationship of relationships) {
    const from = byId.get(relationship.from);
    const to = byId.get(relationship.to);
    if (!from || !to) continue;
    const color = relationship.color ?? relationshipColor;
    let path = linesByColor.get(color);
    if (!path) {
      path = new Path2D();
      linesByColor.set(color, path);
    }
    path.moveTo(from.x * scale + offsetX, from.y * scale + offsetY);
    path.lineTo(to.x * scale + offsetX, to.y * scale + offsetY);
  }
  for (const [color, path] of linesByColor) {
    context.strokeStyle = color;
    context.stroke(path);
  }

  const nodesByColor = new Map<string, Path2D>();
  for (const node of nodes) {
    const color = node.color ?? nodeColor;
    let path = nodesByColor.get(color);
    if (!path) {
      path = new Path2D();
      nodesByColor.set(color, path);
    }
    const x = node.x * scale + offsetX;
    const y = node.y * scale + offsetY;
    const radius = Math.max(node.radius * scale, MIN_NODE_RADIUS_PX);
    path.moveTo(x + radius, y);
    path.arc(x, y, radius, 0, Math.PI * 2);
  }
  for (const [color, path] of nodesByColor) {
    context.fillStyle = color;
    context.fill(path);
  }

  return canvas.toDataURL("image/png");
};
