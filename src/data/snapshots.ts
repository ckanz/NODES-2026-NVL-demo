import type { ViewState } from "../components/GraphPane";
import type { DataGraph } from "./graph";
import type { Slice } from "./neo4j";

/** What one click on the schema brought in. */
export type Item = { title: string; data: DataGraph };

/**
 * The app state that produces the data graph. These maps and sets are never changed in place, so keeping the
 * references is enough: no copy is needed to restore them later.
 */
export type SceneState = {
  /** Loaded selections by key, in the order they were added. */
  items: ReadonlyMap<string, Item>;
  /** Labels removed from the scene. Their nodes, and any relationships to them, are not drawn. */
  hiddenLabels: ReadonlySet<string>;
  /** Nodes and relationships dismissed one by one (by scribbling over them). */
  hiddenNodes: ReadonlySet<string>;
  hiddenRelationships: ReadonlySet<string>;
  /** Which slice of each label to load. Labels not listed use their default slice. */
  slices: ReadonlyMap<string, Slice>;
};

/**
 * One point in time. Taken just before something changes the data graph, so it holds the state the user
 * is about to leave: what was loaded, how it looked, and where every node was.
 */
export type Snapshot = SceneState & {
  id: number;
  /** What is about to happen, e.g. "Add (:Customer)". Shown on the card. */
  reason: string;
  time: number;
  nodes: number;
  relationships: number;
  /** A small picture of the graph at that moment. Null when the graph was empty. */
  image: string | null;
  /** Where the nodes and the camera were. Null when the graph was empty. */
  view: ViewState | null;
};

/** The live graph as the front card of the history: a picture of it as it is when the history is opened. */
export type NowCard = {
  time: number;
  nodes: number;
  relationships: number;
  /** Null when the graph is empty. */
  image: string | null;
};

/** Most snapshots kept. The oldest are dropped first. */
export const MAX_SNAPSHOTS = 30;

// The front card fills the pane, so the picture should keep every pixel the canvas has: its size in CSS pixels
// times the screen's pixel ratio. This ceiling only guards memory on unusually large canvases.
const THUMBNAIL_WIDTH = 2400;
const THUMBNAIL_QUALITY = 0.95;

/** Re-encodes a full-size capture as a JPEG, which is what is kept in memory. Only scales down past the ceiling. */
export const makeThumbnail = (url: string): Promise<string> =>
  new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      // Never scale up: a small capture stays as it is.
      canvas.width = Math.min(THUMBNAIL_WIDTH, image.width);
      canvas.height = Math.max(
        1,
        Math.round((image.height * canvas.width) / image.width),
      );
      const context = canvas.getContext("2d");
      if (context) {
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
      }
      resolve(canvas.toDataURL("image/jpeg", THUMBNAIL_QUALITY));
    };
    // Keep the full picture rather than lose it.
    image.onerror = () => resolve(url);
    image.src = url;
  });
