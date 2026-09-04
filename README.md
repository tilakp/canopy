# Canopy

A simple mindmapping desktop app for thinking, built with Tauri + TypeScript.

## Status

Working: radial auto-layout (balanced left/right branches), SVG rendering,
node selection, inline text editing, add child (Tab) / add sibling (Enter),
delete (Delete/Backspace), drag-to-reposition, pan (drag empty canvas), and
zoom (scroll wheel).

Not yet started: save/load to a local file, undo/redo, themes.

## Development

```sh
bun install
bun run tauri dev   # launch the desktop app
bun run test         # run the layout algorithm tests
```

## How it works

- `src/model.ts` — the mind map's tree data structure.
- `src/layout.ts` — computes node positions: splits the root's children
  across left/right (balanced by subtree size) and stacks each side
  vertically.
- `src/render.ts` — draws the tree as SVG (root box, branch-colored bezier
  edges, node text) and the pan/zoom camera.
- `src/app.ts` — owns app state and wires up all interactions (click,
  drag, keyboard shortcuts, inline editing).
