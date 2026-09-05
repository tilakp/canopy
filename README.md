# Canopy

A simple, elegant mindmapping desktop app for thinking.

Canopy draws your ideas as a left-to-right tree. The root sits on the
left. Branches grow to the right. Each branch gets its own pastel color.
You can add ideas fast, drag nodes to arrange them, and tidy the whole
tree back into place with one click.

## Download

Get the latest build from the
[Releases page](https://github.com/tilakp/canopy/releases).

Pick the file for your system:

| System | File |
|---|---|
| macOS (Apple Silicon) | `Canopy_aarch64.dmg` |
| macOS (Intel) | `Canopy_x64.dmg` |
| Windows | `Canopy_x64-setup.exe` (or the `.msi`) |
| Linux | `.AppImage` or `.deb` |

These builds are not code-signed or notarized, so your OS will warn you
before the first launch:

- **macOS**: right-click (or Control-click) the app and choose **Open**,
  then confirm in the dialog. Opening it normally from Finder will
  refuse to launch, since macOS blocks unsigned apps by default.
- **Windows**: click **More info**, then **Run anyway** on the
  SmartScreen prompt.

## Features

- Add a child (Tab) or a sibling (Enter) to the selected node.
- Double-click a node, or hover it and click its **+** button, to edit
  its text.
- Delete the selected node (Delete/Backspace) along with its subtree.
- Navigate with arrow keys: Up/Down between siblings, Left to the parent,
  Right to the first child. Reorder siblings with Alt+Up/Down.
- Drag a node to reposition it, or drop it onto another node to reparent
  it there. Click **Tidy up** in the toolbar to clear all manual
  positioning and snap back to the auto-computed layout, or **zoom to
  fit** (toolbar button or `0`) to frame the whole tree.
- Collapse/expand a subtree via the toggle on any node with children.
- Add notes (`N`), a link (`L`), or an icon/emoji (`I`) to the selected
  node. A link renders as a clickable badge that opens in your default
  browser.
- Work on multiple maps at once via the tab strip above the toolbar.
- Pan (drag empty canvas) and zoom (scroll wheel).
- Recolor a branch from the toolbar's color swatches.
- Switch between curved and straight edges.
- Toggle dark mode from the tab strip.
- Undo/redo (⌘Z / ⌘⇧Z) for every change.
- Save (⌘S) and open (⌘O) `.canopy` files, a plain JSON format. On
  macOS, double-clicking a `.canopy` file opens it directly in Canopy.
- Export the current map as PNG, SVG, or a Markdown outline from the
  toolbar — pick the format via the save dialog's filename extension.

## Development

Requires [Bun](https://bun.sh) and the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your
platform (a Rust toolchain, plus platform build tools).

```sh
bun install
bun run tauri dev   # launch the desktop app (first run compiles Rust deps, ~1min)
bun run test        # vitest, jsdom environment
bunx tsc --noEmit    # type-check
```

The dev app does not read or write any file by default. It boots a
small starter tree so you can jump straight into your own map.

## How it works

| File | Responsibility |
|---|---|
| `src/model.ts` | The tree data structure and pure mutation helpers. |
| `src/layout.ts` | Computes every node's position from the tree. |
| `src/textwrap.ts` | Measures and wraps node text. |
| `src/render.ts` | Draws the tree as SVG. |
| `src/app.ts` | Owns UI state and every event listener for one map. |
| `src/toolbar.ts` | The floating toolbar. |
| `src/tabs.ts` / `src/workspace.ts` | The tab strip and multi-map coordination. |
| `src/history.ts` | Undo/redo stack. |
| `src/persistence.ts` | Save/load to a local `.canopy` file. |
| `src/exportFile.ts`, `exportImage.ts`, `exportMarkdown.ts` | Export to PNG/SVG/Markdown. |
| `src/theme.ts` | Dark mode. |
| `src-tauri/` | The Tauri (Rust) shell: window, file dialogs, file system access, and file-association handling. |

See `CLAUDE.md` for the design decisions behind these files and a list of
known bugs worth remembering.

## Releasing a build

Push a tag matching `v*` (for example `v0.2.0`) to trigger
`.github/workflows/release.yml`. It builds Canopy for macOS
(Apple Silicon and Intel), Windows, and Linux, then publishes the
installers to a new GitHub release under that tag.

```sh
git tag v0.2.0
git push origin v0.2.0
```
