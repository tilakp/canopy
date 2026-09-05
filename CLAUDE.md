# Canopy

A simple, elegant mindmapping desktop app for thinking. Tauri (Rust shell) +
vanilla TypeScript frontend (no framework — the app is one interactive
canvas, not a multi-view app). GitHub: https://github.com/tilakp/canopy

## Running it

```sh
bun install
bun run tauri dev   # launch the desktop app (first run compiles Rust deps, ~1min)
bun run test        # vitest, jsdom environment, ~40 tests, sub-second
bunx tsc --noEmit    # type-check
```

The dev app reads/writes nothing on disk yet by default — it boots a
hardcoded sample tree (`buildSampleTree()` in `src/main.ts`).

## Architecture

Left-to-right tree layout (root at far left, branches stacking vertically
and growing rightward with depth), rendered as boxed, pastel-colored SVG
nodes with word-wrapped text.

| File | Responsibility |
|---|---|
| `src/model.ts` | The tree data structure (`MindMapNode`) and pure mutation helpers (`addChild`, `removeNode`, `updateText`, `setColor`, `setOffset`, `findNode`, `findParent`, `moveSibling`, `reparentNode`, `toggleCollapsed`, `setNotes`, `setLink`, `setIcon`, `clearOffsets`). No rendering or layout knowledge. |
| `src/layout.ts` | `computeLayout(root, getSize)` — positions every node. Takes an **injected** `getSize(node) => {width, height}` callback rather than assuming fixed dimensions, so it doesn't need to know about text/DOM at all (this is what keeps it unit-testable in jsdom with a trivial fixed-size stub). Colors cascade from each top-level branch down through descendants, overridable per-subtree via `node.color`. A node's own manual drag `offset` shifts it and its descendants without disturbing sibling stacking. A `collapsed` node's children stay in the data but are treated as absent for sizing/positioning/edges (see `visibleChildren`). |
| `src/textwrap.ts` | `wrapText(text, font, maxWidth)` — canvas-based text measurement and greedy line wrapping. Falls back to a `text.length * 7` estimate if canvas isn't available (jsdom in tests; real browsers always take the accurate path). |
| `src/render.ts` | Builds the actual SVG from a layout: draws boxes (root white/bordered, others pastel-filled per branch color via `lighten()`), wrapped multi-line text (prefixed with `node.icon` if set), bezier or right-angle edges (`EdgeStyle`), the hover-reveal "+" add-button, an always-visible collapse/expand toggle on nodes with children, notes/link badges, a drop-target highlight during reparent-by-drag, and the inline `<input>`/`<textarea>` overlays for title/notes/icon/link editing. Exposes `computeFitCamera` (shared by initial-camera and the toolbar's zoom-to-fit) and `RenderResult.contentBBox`. Wraps each node's text *once* per render and reuses those wrapped lines for both sizing (via layout's `getSize`) and drawing, so they can't drift out of sync. |
| `src/app.ts` | Owns all mutable UI state (selection, editing, camera, drag, edge style, undo history, open file path, drop target) for **one** document and every event listener (pointer, wheel, keydown, resize). This is the orchestration layer — `render()` re-runs the whole render.ts pipeline on every state change. `AppHandle.setActive()`/`getTitle()` exist for `workspace.ts` to coordinate multiple concurrently-mounted instances (see below) — an inactive instance's `window`-level key/resize listeners no-op, since `window` listeners are global and every open document's instance receives every keystroke regardless of which is visible. |
| `src/toolbar.ts` | The floating toolbar (open/save, undo/redo, branch color swatches, edge-style toggle, tidy-up, zoom-to-fit). Plain DOM, callback-driven — no state of its own beyond what `update()` is told. |
| `src/tabs.ts` | The tab strip above the toolbar for multiple maps: switch/close/new. Same callback-driven pattern as `toolbar.ts`. |
| `src/workspace.ts` | Multiple maps = multiple fully independent `startApp` instances, each in its own full-size sibling container inside `#app`; only the active one is shown (others `display:none`) and active (`setActive`). Closing the last tab replaces it with a fresh blank map rather than leaving zero. |
| `src/links.ts` | Thin wrapper around `@tauri-apps/plugin-opener`'s `openUrl` for opening a node's `link` in the default browser; swallows errors (no-ops outside a real Tauri webview, e.g. in tests or the Chrome-driven dev server). |
| `src/history.ts` | Generic linear undo/redo stack (`createHistory`) operating on whole-document snapshots (`structuredClone`), not diffs. Simple, and plenty fast for a document this small. |
| `src/persistence.ts` | Save/load to a local `.canopy` (JSON) file via `@tauri-apps/plugin-dialog` + `@tauri-apps/plugin-fs`. |
| `src/exportFile.ts` | One toolbar action exporting the current map to PNG, SVG, or Markdown — the save dialog's chosen filename extension picks the format. |
| `src/exportImage.ts` | `exportSvgString`/`exportPngDataUrl` — serializes the live SVG into a standalone image. Since the live canvas relies on an external stylesheet (and inherits its font from `<body>`) for visuals a cloned/detached SVG wouldn't have, it inlines the actual current `.mm-*` CSS rules (read live from `document.styleSheets`, not hand-duplicated) plus `render.ts`'s `FONT_FAMILY` into an embedded `<style>`. |
| `src/exportMarkdown.ts` | `toMarkdown(root)` — a pure function rendering the tree as a Markdown outline (root as H1, nested bullets, icon-prefixed/link-wrapped/notes-as-italic-subline per node). |
| `src/theme.ts` | `getTheme`/`setTheme`/`initTheme` — dark mode, persisted via `localStorage`, applied as `data-theme` on `<html>` (drives `styles.css`'s `:root[data-theme="dark"]` overrides). |

### Key design decisions (the "why", so it doesn't get re-litigated)

- **No node-tree diffing anywhere.** Every render does `container.innerHTML = ""` and rebuilds the whole SVG from scratch. The tree is small enough (tens of nodes) that this is imperceptibly fast, and it eliminates an entire class of "stale DOM node" bugs — see the "Bugs worth remembering" section below for what happens when you build a node detached and measure it before attaching.
- **Undo/redo is whole-tree snapshots, not commands/diffs.** `history.push(structuredClone(root))` after every mutating action. Simple to reason about; a command-pattern approach would be more memory-efficient but this document will never be large enough for that to matter.
- **The canvas lives in its own child div (`canvasEl`), not directly in the container `app.ts` receives.** `renderMindMap()` clears its container on every call — if the toolbar were a sibling inside that same container it would get wiped after the first render. This was a real, shipped bug; the fix is `canvasEl = container.appendChild(div)`, and `renderMindMap` targets `canvasEl` while the toolbar mounts on `container` directly.
- **`e.preventDefault()` on every non-toolbar `pointerdown`.** Without it, when a double-click opens the inline edit `<input>` and focuses it, the browser's own default mousedown handling (still targeting the original, now-detached SVG element from the render that just happened) steals focus back off the input a tick later — which fires blur, which our commit-on-blur handler treats as "user clicked away," instantly closing the edit that had just opened. This is real-browser-only behavior with no jsdom equivalent (jsdom doesn't simulate default focus-shifting at all), so no unit test catches it — it was found by instrumenting real event sequences in Chrome.
- **Double-click is detected from raw `pointerdown` timing/position, not the native `dblclick` event**, because `container.setPointerCapture()` (needed for drag) makes native `dblclick` unreliable. Thresholds are intentionally generous (600ms / 12px) — real trackpad double-clicks are neither instant nor pixel-perfect.
- **Every node has an invisible "hover zone" rect spanning continuously from its box through its add-button**, rendered behind both. Without it, the box and the button are separate painted shapes with unpainted (and therefore un-hoverable) empty space between them, so the CSS `:hover` driving the button's visibility drops the instant the cursor crosses that gap — the button disappears before the pointer ever reaches it.
- **Colors**: `layout.ts` auto-assigns a palette color per top-level branch, inherited by descendants; `node.color` overrides that for the node's own subtree. `render.ts`'s `lighten(hex, amount)` derives each box's pastel fill from that color at render time — there's no separate stored "fill color", so a user-picked custom color (not just the 7 palette entries) gets a correct pastel automatically.

### Bugs worth remembering (so they don't come back)

1. **Never measure an SVG element before it's attached to the document.** `text.getBBox()` on a detached element silently returns a zero-size box in real browsers (Chrome/WebKit) — no exception. jsdom, by contrast, throws "not implemented" for *every* `getBBox()` call regardless of attachment state, which is *worse* for catching this class of bug: it meant early tests all "passed" by accident (always hitting the safe fallback) while the real app's leaf-node hit-rects were all broken identically. This is why node sizing was redesigned to not depend on DOM measurement at all — see `src/textwrap.ts` (canvas-based) — `render.ts` only calls `getBBox()` on the top-level content group now, for camera-fit purposes.
2. **OS-level screen automation (`cliclick`, AppleScript `System Events`) is unreliable for verifying this app.** Window focus drifts back to the controlling terminal between separate tool calls (not within one), and window resizes happen unpredictably mid-test-sequence, silently invalidating previously-queried coordinates. **Prefer driving a Chrome tab pointed at `http://localhost:1420`** (same frontend code, since it's plain web content) via `mcp__claude-in-chrome__*` tools — real CDP-driven clicks, reliable coordinate space, and console/DOM access. The one thing that *can't* be tested this way is anything touching actual Tauri APIs (dialogs, fs) — those only exist inside the real Tauri webview.

## Status (as of 2026-09-05)

Every item from the original backlog is now implemented and verified —
nothing is left brainstormed-but-not-built.

**Working and verified** (real interaction testing, not just unit tests):
select, inline edit (double-click or hover "+" button), add child (Tab/Enter/+button), delete, drag-to-reposition, pan, zoom, branch recoloring via toolbar, curved/straight edge toggle, word-wrap on long labels, undo/redo of add/delete/drag/color (`⌘Z` / `⌘⇧Z`), tidy-up (clears manual drag offsets, snapping back to the auto-computed layout), a centered floating toolbar with standard folder/floppy-disk open/save icons.

Arrow-key navigation (Up/Down = siblings, Left = parent, Right = first
child), reorder siblings (Alt+Up/Down), zoom-to-fit (toolbar button or `0`),
collapse/expand subtrees (an always-visible per-node toggle — collapsed
children stay in the data, just hidden from layout/render), reparent-by-drag
(drop a dragged node onto another to move it there, with a green dashed
drop-target highlight; refuses drops that would create a cycle), node notes
/ link / per-node icon (`N`/`L`/`I` on the selected node — link renders as a
clickable badge that opens in the default browser via
`@tauri-apps/plugin-opener`, icon prefixes the node's wrapped text), and
multiple maps (a tab strip above the toolbar; each tab is a fully
independent `startApp` instance mounted in its own sibling container — see
`workspace.ts`) are all implemented and verified, both via jsdom tests and
live Chrome/real-app interaction.

Export as PNG/SVG/Markdown is one toolbar action (`exportFile.ts`) whose
save-dialog filename extension picks the format — verified end-to-end in
the real app, including a real bug caught only by that verification: the
exported SVG's inlined `<style>` (see `exportImage.ts`) only collects
`.mm-`-prefixed CSS rules, so the canvas's actual font (inherited from
`<body>`, not a `.mm-` rule) was missing and fell back to a serif font in
rasterized exports — fixed by explicitly inlining `render.ts`'s exported
`FONT_FAMILY` constant into the export's `<style>` block.

Dark mode (`src/theme.ts` + a toggle in the tab strip, persisted via
`localStorage`) is implemented and verified in both directions. The one
non-CSS-variable piece: `render.ts`'s `lighten()` mixes a branch color
toward white for leaf-box fill, which would wash out on a dark background,
so there's now a `darken()` counterpart (mixes toward dark gray) picked by
`boxFill()` based on the current theme. Everything else is CSS custom
properties on `:root[data-theme="dark"]`, with each rule's original value
kept as its own `var(--x, <original>)` fallback so light mode needed no
separate definitions.

A brand-new blank map (just a root, no children) anchors near the top-left
instead of dead-centering — see `computeInitialCamera`'s `isBlank` branch in
`render.ts` — since the tree only ever grows rightward (and vertically from
wherever the root sits), centering a lone root wastes the entire right half
of the window and leaves a taller-than-necessary gap below the floating
toolbar/tab strip (which float on top, not in normal flow, so they don't
shrink the container). This only applies when `root.children.length === 0`
— opening/loading a document with existing content still centers normally.

Save/load (`⌘S` / `⌘O` and the toolbar buttons) is also verified working,
including both halves of expected native-app behavior: saving a file that's
already open writes straight to it with no dialog, and saving with no file
open (or one opened via double-click, see below) prompts the native Save
panel. Double-click-to-open a `.canopy` file from Finder works too (both
cold-start and while already running) — this needed two things beyond the
dialog/fs plugins: a `bundle.fileAssociations` entry in `tauri.conf.json`,
and catching `RunEvent::Opened` in `lib.rs` to hand the path to the
frontend via a `get_pending_file` command + a `file-opened` event. The
non-obvious gotcha: a file path delivered this way (never touched by the
open/save dialog) is invisible to the fs plugin unless a static `scope` is
declared in `capabilities/default.json` — dialog-picked paths get an
ephemeral runtime grant that OS-delivered paths don't, so without an
explicit `{"path": "$HOME/**"}` scope, `readTextFile` on that path silently
fails and the app falls back to the default sample tree with no visible
error.

A signed/notarized release isn't set up — `.github/workflows/release.yml`
builds unsigned installers for macOS/Windows/Linux on a `v*` tag push.

**Not started:** nothing outstanding from the original brainstormed list.
Future feature ideas should get their own round of brainstorming rather than
assuming the old list still applies.
