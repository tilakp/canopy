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
| `src/model.ts` | The tree data structure (`MindMapNode`) and pure mutation helpers (`addChild`, `removeNode`, `updateText`, `setColor`, `setOffset`, `findNode`, `findParent`). No rendering or layout knowledge. |
| `src/layout.ts` | `computeLayout(root, getSize)` — positions every node. Takes an **injected** `getSize(node) => {width, height}` callback rather than assuming fixed dimensions, so it doesn't need to know about text/DOM at all (this is what keeps it unit-testable in jsdom with a trivial fixed-size stub). Colors cascade from each top-level branch down through descendants, overridable per-subtree via `node.color`. A node's own manual drag `offset` shifts it and its descendants without disturbing sibling stacking. |
| `src/textwrap.ts` | `wrapText(text, font, maxWidth)` — canvas-based text measurement and greedy line wrapping. Falls back to a `text.length * 7` estimate if canvas isn't available (jsdom in tests; real browsers always take the accurate path). |
| `src/render.ts` | Builds the actual SVG from a layout: draws boxes (root white/bordered, others pastel-filled per branch color via `lighten()`), wrapped multi-line text, bezier or right-angle edges (`EdgeStyle`), the hover-reveal "+" add-button, and the inline `<input>` edit overlay. Wraps each node's text *once* per render and reuses those wrapped lines for both sizing (via layout's `getSize`) and drawing, so they can't drift out of sync. |
| `src/app.ts` | Owns all mutable UI state (selection, editing, camera, drag, edge style, undo history, open file path) and every event listener (pointer, wheel, keydown, resize). This is the orchestration layer — `render()` re-runs the whole render.ts pipeline on every state change. |
| `src/toolbar.ts` | The floating top-left toolbar: open/save, undo/redo, branch color swatches, edge-style toggle. Plain DOM, callback-driven — no state of its own beyond what `update()` is told. |
| `src/history.ts` | Generic linear undo/redo stack (`createHistory`) operating on whole-document snapshots (`structuredClone`), not diffs. Simple, and plenty fast for a document this small. |
| `src/persistence.ts` | Save/load to a local `.canopy` (JSON) file via `@tauri-apps/plugin-dialog` + `@tauri-apps/plugin-fs`. |

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

## Status (as of 2026-09-04)

**Working and verified** (real interaction testing, not just unit tests):
select, inline edit (double-click or hover "+" button), add child (Tab/Enter/+button), delete, drag-to-reposition, pan, zoom, branch recoloring via toolbar, curved/straight edge toggle, word-wrap on long labels, undo/redo of add/delete/drag/color (`⌘Z` / `⌘⇧Z`).

**Implemented but NOT yet verified working — check this first:**
Save/load (`⌘S` / `⌘O` and the toolbar buttons). The Rust plugins
(`tauri-plugin-dialog`, `tauri-plugin-fs`) are added to `Cargo.toml` and
registered in `lib.rs`; capabilities include `dialog:default`, `fs:default`
plus explicit read/write-text-file permissions. Clicking the toolbar Save
button in the real running app did **not** visibly open a native save
dialog, and no error surfaced in the dev server log (which wouldn't show
JS-side errors anyway — there's no devtools console access wired up for
quick checking). Next step: open the app's WebView inspector (right-click →
Inspect Element, if enabled) and check for a thrown/rejected error from
`saveToFile()` in `src/persistence.ts`, or verify the capabilities file is
actually being picked up (try `fs:allow-write-text-file` scoped more
explicitly if `fs:default` isn't sufficient).

**Not started — brainstormed and prioritized, not yet built:**
arrow-key navigation, collapse/expand subtrees, zoom-to-fit/recenter,
reparent-by-drag, reorder siblings, node notes (secondary text field),
link attachments, export as image (PNG/SVG), export as Markdown outline,
multiple maps, dark mode, per-node emoji/icon.

Of these, export-to-image/Markdown and dark mode are the best candidates for
parallel/cheap-model subagent work later — they barely touch the shared hot
files (`app.ts`, `render.ts`, `layout.ts`). The rest touch the same files
each other would, so building them in parallel risks unmergeable conflicts;
do them one at a time.
