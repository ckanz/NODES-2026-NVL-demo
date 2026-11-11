# NVL skill and docs: suggested improvements

Things we had to work out from NVL's source or by experiment while building this app, which the
`neo4j-nvl-skill` (shipped in `@neo4j-nvl/base`) or the NVL docs could state directly. Each entry says what
was missing, what we found, and where it would fit.

Checked against `@neo4j-nvl/base` and `@neo4j-nvl/react` `2.0.0-3b74980d` (the `next` tag) and the skill
shipped with it. Paths below are relative to `skills/neo4j-nvl-skill/`.

Add new findings at the end of the list, in the same format.

---

## 1. Picture of a graph that is already laid out (`StaticPictureWrapper` + `free` layout)

**Where:** `references/react-wrappers.md`, next to "Many `<StaticPictureWrapper>`s at once". Also the
"Static PNG / SVG" row of the table in `SKILL.md`.

**Missing:** how to picture a graph exactly as it looks on screen, e.g. for history thumbnails. Without this
recipe we wrote our own canvas drawing code (about 130 lines) and only later found NVL can do it.

**What works** (tested: 50 nodes, PNG ready in about 300 ms):

```tsx
const nodes = graph.nodes.map((node) => ({
  ...node,
  ...positions.get(node.id),
})); // x, y from getNodePositions()

<StaticPictureWrapper
  nodes={nodes}
  rels={graph.relationships}
  nvlOptions={{ layout: "free", disableWebGL: true }}
  width={width}
  height={height}
/>;
```

**Worth stating:**

- With `layout: "free"`, nodes stay at the `x`/`y` they are given, `onLayoutDone` still fires, and the
  wrapper fits all nodes into the picture. No layout runs.
- The wrapper renders `null` until the image is ready, and there is no callback for when it is ready. Show a
  placeholder yourself, e.g. a CSS sibling rule `img ~ .spinner { display: none }`.
- `width` and `height` are pixels and are required in practice (default 500×500). The wrapper does not size
  itself to its container, so measure the container first.
- The picture is redrawn whenever the `nodes` or `rels` array changes identity. Memoize them.
- Pass `disableWebGL: true` when many pictures render at once. This is already documented and worked as
  described.

**Possible API improvements:** an `onReady(dataUrl)` callback or a `placeholder` prop, and an option to fill
the container instead of fixed pixel sizes.

## 2. `getImageDataUrl()` / `getSvgDataUrl()` capture only the current view

**Where:** `references/api/base/classes/NVL.md` (both methods), and the "Static PNG / SVG" row in `SKILL.md`.

**Missing:** both methods return only what is visible in the viewport. A snapshot taken while zoomed in
shows a handful of nodes. `saveFullGraphToLargeFile()` covers everything, but it triggers a download and
draws at default zoom. To get an image of the whole graph, use `StaticPictureWrapper`, which fits first (see
1). One line in each method's description would have saved the investigation.

## 3. `minFps` / `maxFps` have no effect on the GPU layout path

**Where:** `references/layouts-and-positions.md`, under the line about `minFps` / `maxFps`.

**Missing:** the docs say these set "the presentation rate while a layout is active". We set `maxFps: 1` to
make layouts settle faster, then found from the source that it does nothing in the common case.

**What the source does:**

- **GPU path:** WebGL renderer, force-directed layout running on the GPU, no HTML overlays on nodes or
  relationships, and no `onLayoutStep` callback registered. Each frame runs
  `clamp(100000 / nodeCount, 1, 20)` layout steps, and `minFps` / `maxFps` are not read at all.
- **CPU path:** everything else, e.g. the Canvas renderer, or another layout.
  - `minFps` caps how long a frame may spend catching up with real time (1000 / `minFps` ms).
  - `maxFps` allows up to 20 extra steps per frame, within 1000 / `maxFps` ms.

**Suggested text:** "Only used when the layout runs on the CPU (Canvas or SVG renderer, a non-GPU layout,
HTML overlays, or an `onLayoutStep` callback). With WebGL and the force-directed layout, the number of steps
per frame depends on the node count only."

## 4. `captionSize` units

**Where:** `references/labels-and-overlays.md` (it does not mention `captionSize` today), and the
`Relationship` and `Node` type docs.

**Missing:** what `captionSize: 1` means. From the source: relationship captions are 6 px at `captionSize: 1`,
in graph units. So they scale with zoom, and a graph fitted at zoom 0.33 shows them at about 2 px on screen.
We needed `captionSize: 3.5` for readable schema captions. Also worth saying: there is no way to keep caption
text a fixed size on screen except updating `captionSize` on zoom.

## 5. The skill only ships in the `next` pre-release

**Where:** the skill's `README.md` and the NVL install docs.

**Missing:** `npx skills sync` finds nothing with `@neo4j-nvl/base@latest` (`2.0.0`), because its
`package.json` `files` is only `["LICENSE.txt", "dist"]`. The skill is only in `@neo4j-nvl/base@next`. Until
a stable release includes it, the README could say which version to install. Needle (`@neo4j-ndl/react`)
ships its skill in the stable release, which made the difference confusing.

## 6. `setPan` / `setZoomAndPan` apply on the next frame

**Where:** `references/lifecycle-and-updates.md`, or the pan and zoom section of `NVL.md`.

**Missing:** `setPan()` and `setZoomAndPan()` store a pending value, and `getPan()` / `getScale()` keep
returning the old value until NVL renders its next frame. Custom pan or zoom handlers that read `getPan()`,
add the pointer delta and call `setPan()` lose movement when two pointer events arrive within one frame. Keep
your own running value instead of reading it back, as `src/interactions/InertialPanInteraction.ts` does.

## 7. The WebGL renderer leaves the last picture on screen when all nodes are removed

**Where:** `references/lifecycle-and-updates.md`.

**Missing:** after removing every node, the WebGL renderer does not redraw, so the old graph stays visible.
We unmount the wrapper while the graph is empty and mount a fresh one when data arrives (see the comment in
`src/App.tsx`). Either document the workaround or fix the redraw.

## 8. `onLayoutDone` also fires after dragging a node

**Where:** `references/layouts-and-positions.md`, "Callbacks". It currently says "Trigger `fit`, exports and
screenshots from here".

**Missing:** `onLayoutDone` fires after every re-layout, including the short one after a node drag. Calling
`fit()` there unconditionally makes the view jump every time the user drags a node. Suggest: "fit only when
the set of elements changed", e.g. with a flag set when nodes or relationships are added or removed. That is
what `src/components/GraphPane.tsx` does.

## 9. `nvlResultTransformer` and `db.schema.visualization()`

**Where:** `references/data-from-neo4j.md`.

**Missing:** `db.schema.visualization()` returns virtual elements with negative ids drawn from separate
counters for nodes and relationships, so a node and a relationship can share an id. `nvlResultTransformer`
keys both in one map, so one overwrites the other, and relationships lose their type. Read the raw driver
records for schema graphs instead (as `fetchSchema` in `src/data/neo4j.ts` does), or have the transformer
keep nodes and relationships apart.

## 10. No public way to turn a pointer position into graph coordinates

**Where:** an `NVL` method, or an export from `@neo4j-nvl/interaction-handlers`.

**Missing:** custom interactions (drawing, lasso tools, placing nodes) need the graph point under the pointer.
NVL documents only the other direction (`NodeWithClientPosition`:
`clientPosition = (point - pan) * zoom / devicePixelRatio + containerSize / 2`), so every app writes the
inverse itself, like `clientToGraph` in `src/interactions/ScribbleInteraction.ts`.
`@neo4j-nvl/interaction-handlers` already contains it (`getCanvasPosition` and `getWorldPosition` in
`lib/interaction-handlers/utils.js`), but the package only exports its root, so apps cannot import them.

**Suggestion:** add `nvl.clientToLayout({ x: clientX, y: clientY })` (and `layoutToClient`), or export
`getWorldPosition` from `@neo4j-nvl/interaction-handlers`. Until then, document the inverse formula next to
the existing one: `point = pan + (client - containerTopLeft - containerSize / 2) * devicePixelRatio / zoom`.

---

## Already covered well

These came up too, and the skill already answered them:

- `minimapContainer` must exist before NVL starts (`react-wrappers.md`).
- `nvlCallbacks` are captured once (`react-wrappers.md`).
- `interactionOptions` replaces the defaults (`react-wrappers.md`).
- The WebGL context limit with many `StaticPictureWrapper`s (`react-wrappers.md`).
