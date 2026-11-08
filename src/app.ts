// One open map: its document, its view state (selection, editor, camera,
// drag, search) and every input that changes them. All actions are
// commands in one registry (see commands.ts), which the keyboard, the menu
// bar, the title bar, the toolbars, the right-click menu, the command
// palette and the help list read.
import {
  addChild,
  clearOffsets,
  cycleStatus,
  findNode,
  findParent,
  insertSiblingAfter,
  moveSibling,
  pathTo,
  removeNode,
  reparentNode,
  setCollapsedDeep,
  setColor,
  setIcon,
  setImage,
  setLink,
  setNotes,
  setWidths,
  updateText,
  visibleNodes,
  type MindMapNode,
} from "./model";
import { createDocument } from "./document";
import { renderMindMap, applyCamera, applySelection, setDropTarget } from "./render";
import { computeFitCamera, zoomAround, type Box, type Camera } from "./camera";
import { computeArrangedWidths } from "./visuals";
import { commitOpenEditor, type EditorKind, type EditorTarget } from "./editors";
import { startDragPreview, type DragPreview } from "./motion";
import type { NodeLayout } from "./layout";
import { createRegistry, formatKey, labelOf, shortcutOf, isEnabled, type Command } from "./commands";
import { createNodeToolbar, createZoomControls } from "./toolbar";
import { createPalette } from "./palette";
import { createContextMenu, type MenuEntry } from "./menu";
import { createMinimap } from "./minimap";
import { createSearchBar } from "./search";
import { createHelpPanel } from "./help";
import { PALETTE } from "./colors";
import { getViewPrefs, setViewPref } from "./prefs";
import { setTheme } from "./theme";
import { FONT_OPTIONS, getFontFamily, setFontId } from "./fonts";
import { saveToFile, loadFromFile, loadFromPath } from "./persistence";
import { openLink } from "./links";
import { exportMap } from "./exportFile";
import { fromMarkdown } from "./importMarkdown";
import { printMap } from "./printMap";
import { addRecentFile } from "./recentFiles";
import { askToSave, showError } from "./dialogs";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";

const ZOOM_MIN = 0.2;
const ZOOM_MAX = 3;
const ZOOM_STEP = 1.25;
// Pinch and wheel zoom move further per finger movement than the raw
// deltas; 1:1 felt slow.
const PINCH_ZOOM_SENSITIVITY = 1.6;
// Generous on purpose: real trackpad double-clicks are neither instant nor
// pixel-perfect, and macOS's double-click speed can be slow.
const DOUBLE_CLICK_MS = 600;
const DOUBLE_CLICK_PX = 12;
// One text line's worth of scroll, for line-mode wheel deltas.
const WHEEL_LINE_HEIGHT = 16;

type DragState =
  | {
      type: "node";
      id: string;
      startX: number;
      startY: number;
      // Every dragged node with its starting offset: the node under the
      // pointer, or every selected one for a drag on a multi-selection.
      moving: Map<MindMapNode, { dx: number; dy: number }>;
      // Every drawn node that moves: the dragged nodes and what is below.
      drawn: Set<string>;
      // Moves the drawn nodes while the pointer moves. Made on the first
      // move, so a plain click doesn't pay for it; null when the drag must
      // render each frame instead (hand-drawn style).
      preview?: DragPreview | null;
    }
  | { type: "pan"; startX: number; startY: number; startCamera: Camera }
  | null;

export interface AppHandle {
  // Runs a command from the registry (menu bar, title bar). Unknown ids
  // throw; a disabled command does nothing.
  run(commandId: string): void;
  openRoot(root: MindMapNode, path: string): void;
  // Every map's window-level listeners hear every key and resize; only
  // the visible map acts on them.
  setActive(active: boolean): void;
  getTitle(): string;
  // A render after a change that affects every map (theme, font, view).
  forceRender(): void;
  // Ends every listener of this map when its tab closes, so a closed map
  // neither handles keys nor stays in memory.
  destroy(): void;
  isDirty(): boolean;
  getFilePath(): string | null;
  // Resolves to whether the file opened, so a missing file can leave the
  // recent list.
  openRecent(path: string): Promise<boolean>;
  // Commits an open edit, so a check for unsaved changes includes it.
  flushEdit(): void;
  // Before this map closes or is replaced: asks Save / Don't Save / Cancel
  // if it has unsaved changes. Resolves to whether it may go on.
  confirmClose(): Promise<boolean>;
  isFocused(): boolean;
  canFocus(): boolean;
}

export function startApp(
  container: HTMLElement,
  initialRoot: MindMapNode,
  initialFilePath: string | null = null,
  onChange?: () => void,
): AppHandle {
  const doc = createDocument(initialRoot, initialFilePath);
  // Every listener and popover of this map ends with it (destroy()).
  const lifetime = new AbortController();
  const { signal } = lifetime;
  let isActive = true;

  // The selection: a set for shift+click multi-select, and a primary node
  // that single-node actions (edit, notes, arrow keys) act on.
  let selectedId: string | null = null;
  let selectedIds = new Set<string>();
  // The open editor, if any.
  let editor: EditorTarget | null = null;
  // A node that Tab/Enter/+ just added, open for its first edit. It is not
  // in the undo history yet: the add and its first text are one undo step,
  // and an edit that ends empty (or is cancelled) removes it again.
  let newNodeId: string | null = null;
  let focusId: string | null = null;
  let camera: Camera | undefined;
  let drag: DragState = null;
  let dragMoved = false;
  let dropTargetId: string | null = null;
  // A shift+click on a node already in a multi-selection: a drag moves the
  // group, a plain click (decided at pointerup) takes the node out.
  let pendingDeselectId: string | null = null;
  let lastClick: { id: string; time: number; x: number; y: number } | null = null;
  let lastPositions = new Map<string, NodeLayout>();
  let lastContentBBox: Box = { x: 0, y: 0, width: 0, height: 0 };
  let searchQuery = "";
  let searchMatchIds: string[] = [];
  let searchIndex = 0;
  // Animation hints for the next render only (see RenderState).
  let revealId: string | null = null;
  let popId: string | null = null;
  // The node toolbar shows for a selection made with the pointer, and hides
  // again on keyboard work, where it would only cover the map.
  let nodeToolbarWanted = false;

  // Without a focused element, WKWebView's own tab navigation can take
  // the Tab key before the page sees it.
  container.tabIndex = -1;

  // renderMindMap clears its container on every render, so the canvas has
  // its own child: the controls on `container` survive renders.
  const canvasEl = document.createElement("div");
  canvasEl.className = "mm-canvas-container";
  container.appendChild(canvasEl);

  // ----- Selection -----

  function selectOnly(id: string | null): void {
    selectedId = id;
    selectedIds = id ? new Set([id]) : new Set();
  }

  const selectedNode = () => (selectedId ? findNode(doc.root, selectedId) : null);
  const selectedNonRoot = () => [...selectedIds].filter((id) => id !== doc.root.id);

  // The nearest node that is drawn: the node itself, or the folded
  // ancestor hiding it. Null if it is not in the tree.
  function nearestVisible(id: string): string | null {
    const path = pathTo(doc.root, id);
    if (!path) return null;
    return (path.slice(0, -1).find((n) => n.collapsed) ?? path[path.length - 1]).id;
  }

  // A selection, focus or search match can point at a node that a delete,
  // undo, load or fold has removed or hidden. Before each render they move
  // to what is drawn, so no action targets a node nobody can see.
  function keepTargetsVisible(): void {
    const ids = [...new Set([...selectedIds].map(nearestVisible).filter((id): id is string => id !== null))];
    selectedIds = new Set(ids);
    if (selectedId) selectedId = nearestVisible(selectedId);
    if (selectedId && !selectedIds.has(selectedId)) selectedIds.add(selectedId);
    if (!selectedId) selectedId = ids[0] ?? null;
    if (focusId) focusId = nearestVisible(focusId);
    if (focusId === doc.root.id) focusId = null;
    if (searchQuery) updateSearchMatches(false);
  }

  // Whether a selected node above `id` (other than the root, which never
  // moves) already carries it along in a group drag.
  function hasSelectedAncestor(id: string): boolean {
    const path = pathTo(doc.root, id) ?? [];
    return path.slice(1, -1).some((n) => selectedIds.has(n.id));
  }

  // ----- Rendering -----

  function render(): void {
    keepTargetsVisible();
    const prefs = getViewPrefs();
    canvasEl.classList.toggle("mm-grid", prefs.grid);
    const result = renderMindMap(
      canvasEl,
      doc.root,
      {
        selectedIds,
        editor,
        edgeStyle: prefs.edgeStyle,
        sketchy: prefs.sketchy,
        focusId,
        camera,
        dropTargetId,
        revealId,
        popId,
        animate: drag?.type !== "node",
      },
      { onCommit: commitEditor, onCancel: cancelEditor },
    );
    revealId = null;
    popId = null;
    camera = result.camera;
    lastContentBBox = result.contentBBox;
    lastPositions = result.positions;
    minimap.update({
      positions: lastPositions,
      contentBBox: lastContentBBox,
      camera,
      viewportSize: viewport(),
      visible: prefs.minimap,
    });
    searchBar.update({ query: searchQuery, matchCount: searchMatchIds.length, currentIndex: searchIndex });
    afterViewChange();
  }

  // A change to the selection only: marks it on the drawn map instead of
  // rebuilding the map.
  function showSelection(): void {
    if (!applySelection(canvasEl, selectedIds)) return render();
    afterViewChange();
  }

  // A change to the camera only (pan, pinch, search jump).
  function showCamera(): void {
    if (!camera || !applyCamera(canvasEl, camera)) return render();
    minimap.update({
      positions: lastPositions,
      contentBBox: lastContentBBox,
      camera,
      viewportSize: viewport(),
      visible: getViewPrefs().minimap,
    });
    updateFloatingControls();
  }

  function afterViewChange(): void {
    updateFloatingControls();
    onChange?.();
  }

  // The size of the visible area, kept from the last resize, since reading
  // it from the DOM after a render forces the browser to lay out the map.
  let viewportSize: { width: number; height: number } | null = null;
  function viewport(): { width: number; height: number } {
    if (viewportSize) return viewportSize;
    const rect = container.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }
  if (typeof ResizeObserver === "function") {
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) viewportSize = { width, height };
    });
    observer.observe(container);
    signal.addEventListener("abort", () => observer.disconnect());
  }

  // ----- Editing -----

  const isEditing = () => editor !== null;

  function openEditor(kind: EditorKind, id = selectedId): void {
    if (!id || !findNode(doc.root, id)) return;
    if (kind === "title") selectOnly(id);
    editor = { kind, id };
    render();
  }

  function commitEditor(target: EditorTarget, value: string, next?: "sibling" | "child"): void {
    editor = null;
    const node = findNode(doc.root, target.id);
    if (!node) return render();
    if (target.kind !== "title") {
      const before = node[target.kind];
      if (target.kind === "notes") setNotes(doc.root, node.id, value);
      else if (target.kind === "icon") setIcon(doc.root, node.id, value);
      else setLink(doc.root, node.id, value);
      if (node[target.kind] !== before) doc.commit();
      render();
      container.focus();
      return;
    }
    const isNew = target.id === newNodeId;
    newNodeId = null;
    if (isNew && !value.trim()) {
      removeNewNode(target.id);
    } else {
      const before = node.text;
      updateText(doc.root, node.id, value.trim() || "Untitled");
      if (isNew || node.text !== before) doc.commit();
      // Enter or Tab on a node that was just added goes on to the next
      // one, so a list of ideas is one keystroke per idea. Ending an edit
      // of an existing node stays a plain commit.
      if (isNew && next) {
        if (next === "child") addNodeAndEdit(node);
        else addNodeAndEdit(siblingParentOf(node.id), node.id);
        return;
      }
    }
    render();
    container.focus();
  }

  // Ends an edit with no commit. A node added just for this edit goes away
  // again, so a cancelled add leaves no empty box behind.
  function cancelEditor(): void {
    if (newNodeId && editor?.id === newNodeId) removeNewNode(newNodeId);
    newNodeId = null;
    editor = null;
    render();
    container.focus();
  }

  // ----- Changing the map -----

  // Adds an empty node and opens it for editing: after `afterId` among its
  // siblings, or as the last child. A folded parent opens first, so the
  // new node has somewhere to show.
  function addNodeAndEdit(parent: MindMapNode, afterId?: string): void {
    parent.collapsed = false;
    const node = afterId && afterId !== doc.root.id ? insertSiblingAfter(doc.root, afterId, "")! : addChild(parent, "");
    newNodeId = node.id;
    openEditor("title", node.id);
  }

  // Where Enter puts a new sibling: next to the node, or under the root
  // when the node is the root (it has no siblings).
  function siblingParentOf(id: string): MindMapNode {
    return id === doc.root.id ? doc.root : (findParent(doc.root, id) ?? doc.root);
  }

  function removeNewNode(id: string): void {
    const parent = findParent(doc.root, id);
    removeNode(doc.root, id);
    selectOnly(parent ? parent.id : null);
  }

  // Folds an open node or opens a folded one; with `allLevels`, every node
  // below it gets the same state.
  function toggleFold(id: string, allLevels = false): void {
    const node = findNode(doc.root, id);
    if (!node || node.children.length === 0) return;
    const fold = !node.collapsed;
    if (allLevels) setCollapsedDeep(node, fold);
    else node.collapsed = fold;
    if (fold) popId = id;
    else revealId = id;
    doc.commit();
    render();
  }

  // A final pick is one undo step; the system color picker previews every
  // color it passes through without one.
  function pickColor(color: string, final: boolean): void {
    const targets = selectedNonRoot();
    if (targets.length === 0) return;
    for (const id of targets) setColor(doc.root, id, color);
    if (final) doc.commit();
    render();
  }

  // Arrange: undo manual drags and give every box in a column the same
  // width, so the columns line up; then show the whole result. One undo
  // step, none if nothing changed.
  function arrange(): void {
    const layoutOf = (root: MindMapNode) =>
      [...visibleNodes(root)].map((n) => `${n.id}:${n.offset?.dx},${n.offset?.dy},${n.width}`).join("|");
    const before = layoutOf(doc.root);
    clearOffsets(doc.root);
    setWidths(doc.root, computeArrangedWidths(doc.root, getFontFamily()));
    if (layoutOf(doc.root) !== before) doc.commit();
    render();
    zoomToFit();
  }

  function cycleSelectedStatus(): void {
    const node = selectedNode();
    if (!node) return;
    cycleStatus(doc.root, node.id);
    doc.commit();
    render();
  }

  function deleteSelection(): void {
    const targets = selectedNonRoot();
    if (targets.length === 0) return;
    const parent = targets.length === 1 ? findParent(doc.root, targets[0]) : null;
    // Deleting an ancestor also removes its selected descendants, so a
    // later removeNode for one of those is a no-op.
    for (const id of targets) removeNode(doc.root, id);
    doc.commit();
    selectOnly(parent?.id ?? null);
    render();
  }

  function moveSelected(direction: -1 | 1): void {
    if (selectedId && moveSibling(doc.root, selectedId, direction)) {
      doc.commit();
      render();
    }
  }

  function toggleFocus(): void {
    if (focusId && (!selectedId || selectedId === focusId)) focusId = null;
    else if (selectedId && selectedId !== doc.root.id) focusId = selectedId;
    render();
  }

  // Arrow keys: up and down among siblings, left to the parent, right to
  // the first child (opening a folded node). With nothing selected, any
  // arrow selects the root.
  function navigate(key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight"): void {
    const node = selectedNode();
    if (!node) {
      selectOnly(doc.root.id);
      return showSelection();
    }
    if (key === "ArrowRight") {
      if (node.collapsed) return toggleFold(node.id);
      if (node.children.length > 0) selectOnly(node.children[0].id);
    } else {
      const parent = findParent(doc.root, node.id);
      if (!parent) return;
      if (key === "ArrowLeft") selectOnly(parent.id);
      else {
        const siblings = parent.children;
        const index = siblings.indexOf(node) + (key === "ArrowDown" ? 1 : -1);
        selectOnly(siblings[Math.min(Math.max(index, 0), siblings.length - 1)].id);
      }
    }
    showSelection();
  }

  function undo(): void {
    if (!doc.undo()) return;
    selectOnly(null);
    render();
  }

  function redo(): void {
    if (!doc.redo()) return;
    selectOnly(null);
    render();
  }

  // ----- Files -----

  function loadRoot(root: MindMapNode, path: string | null): void {
    doc.load(root, path);
    selectOnly(null);
    editor = null;
    newNodeId = null;
    focusId = null;
    camera = undefined;
    drag = null;
    closeSearch(false);
    render();
  }

  function flushEdit(): void {
    if (editor) commitOpenEditor(canvasEl);
  }

  // Asked before anything replaces or closes this map: Save (then go on
  // only if the save worked), Don't Save, or Cancel. An open edit counts.
  async function canDiscardChanges(): Promise<boolean> {
    flushEdit();
    if (!doc.isDirty()) return true;
    const choice = await askToSave(doc.root.text);
    if (choice === "save") return save();
    return choice === "discard";
  }

  // Save writes to the open file, or asks for a path if there is none;
  // Save As always asks. Resolves to whether the map was saved.
  async function save(saveAs = false): Promise<boolean> {
    flushEdit();
    const version = doc.version();
    let savedPath: string | null;
    try {
      savedPath = await saveToFile(doc.root, saveAs ? null : doc.filePath);
    } catch (err) {
      await showError(`Could not save the map: ${err}`);
      return false;
    }
    if (!savedPath) return false;
    doc.markSaved(version, savedPath);
    addRecentFile(savedPath);
    onChange?.();
    return true;
  }

  // Each file action leaves the map alone when any step fails (a dialog
  // that is not there outside Tauri, a file that is not a map), rather than
  // half-replacing it or surfacing an unhandled rejection.
  async function openFile(): Promise<void> {
    if (!(await canDiscardChanges())) return;
    const result = await loadFromFile().catch(() => null);
    if (result) {
      loadRoot(result.root, result.path);
      addRecentFile(result.path);
    }
  }

  async function importMarkdown(): Promise<void> {
    if (!(await canDiscardChanges())) return;
    const path = await open({ multiple: false, filters: [{ name: "Markdown", extensions: ["md"] }] }).catch(() => null);
    if (!path || Array.isArray(path)) return;
    const imported = await readTextFile(path).then(fromMarkdown).catch(() => null);
    if (imported) {
      loadRoot(imported, null);
      addRecentFile(path);
    }
  }

  async function openRecent(path: string): Promise<boolean> {
    if (!(await canDiscardChanges())) return true;
    // Imported Markdown files are in the recent list too, and they are not
    // JSON, so they go through the importer again.
    if (path.toLowerCase().endsWith(".md")) {
      const imported = await readTextFile(path).then(fromMarkdown).catch(() => null);
      if (!imported) return false;
      loadRoot(imported, null);
      addRecentFile(path);
      return true;
    }
    const result = await loadFromPath(path).catch(() => null);
    if (!result) return false;
    loadRoot(result.root, result.path);
    addRecentFile(result.path);
    return true;
  }

  const canvasSvg = () => canvasEl.querySelector<SVGSVGElement>("svg.mm-canvas");

  async function exportFile(): Promise<void> {
    const svg = canvasSvg();
    if (svg) await exportMap(doc.root, svg, lastContentBBox);
  }

  async function print(): Promise<void> {
    const svg = canvasSvg();
    if (svg) await printMap(svg, lastContentBBox);
  }

  // ----- Camera -----

  function zoomToFit(): void {
    camera = computeFitCamera(lastContentBBox, viewport());
    render();
  }

  function zoomBy(factor: number): void {
    if (!camera) return;
    const { width, height } = viewport();
    camera = zoomAround(camera, camera.scale * factor, width / 2, height / 2, ZOOM_MIN, ZOOM_MAX);
    render();
  }

  // Continuous zoom (pinch, wheel) changes only the camera, so it takes
  // the camera-only path: a full render per frame (tens of milliseconds on
  // a large map) made the gesture uneven. An open editor is HTML placed
  // from the camera, so it needs the full render.
  function zoomLive(base: Camera, targetScale: number, anchorX: number, anchorY: number): void {
    camera = zoomAround(base, targetScale, anchorX, anchorY, ZOOM_MIN, ZOOM_MAX);
    if (isEditing()) render();
    else showCamera();
  }

  function centerOn(id: string): void {
    const layout = lastPositions.get(id);
    if (!layout || !camera) return;
    const { width, height } = viewport();
    camera = {
      ...camera,
      x: width / 2 - (layout.x + layout.width / 2) * camera.scale,
      y: height / 2 - layout.y * camera.scale,
    };
  }

  // ----- Search -----

  // Matches are the drawn nodes only: a node inside a folded branch has no
  // place on screen to jump to.
  function updateSearchMatches(resetIndex: boolean): void {
    const query = searchQuery.trim().toLowerCase();
    searchMatchIds = query
      ? [...visibleNodes(doc.root)].filter((n) => n.text.toLowerCase().includes(query)).map((n) => n.id)
      : [];
    if (resetIndex || searchIndex >= searchMatchIds.length) searchIndex = 0;
  }

  function jumpToSearchMatch(): void {
    const id = searchMatchIds[searchIndex];
    if (id) {
      selectOnly(id);
      centerOn(id);
      showCamera();
      showSelection();
    }
    searchBar.update({ query: searchQuery, matchCount: searchMatchIds.length, currentIndex: searchIndex });
  }

  function closeSearch(refocus = true): void {
    searchBar.close();
    searchQuery = "";
    searchMatchIds = [];
    if (refocus) container.focus();
  }

  // ----- Commands -----

  const hasNode = () => selectedNode() !== null;
  const STATUS_LABELS = { none: "Mark as to do", todo: "Mark as done", done: "Clear status" };

  const commands = createRegistry([
    // The selected node. With nothing selected, adding goes under the root.
    { id: "node.addChild", group: "Selected node", label: "Add child", keys: ["Tab"], run: () => addNodeAndEdit(selectedNode() ?? doc.root) },
    {
      id: "node.addSibling",
      group: "Selected node",
      label: "Add sibling",
      keys: ["Enter"],
      run: () => (selectedId ? addNodeAndEdit(siblingParentOf(selectedId), selectedId) : addNodeAndEdit(doc.root)),
    },
    { id: "node.edit", group: "Selected node", label: "Edit text", keys: ["F2", " "], enabled: hasNode, run: () => openEditor("title") },
    { id: "node.notes", group: "Selected node", label: "Notes", keys: ["N"], enabled: hasNode, run: () => openEditor("notes") },
    { id: "node.link", group: "Selected node", label: "Link", keys: ["L"], enabled: hasNode, run: () => openEditor("link") },
    { id: "node.icon", group: "Selected node", label: "Icon", keys: ["I"], enabled: hasNode, run: () => openEditor("icon") },
    {
      id: "node.status",
      group: "Selected node",
      label: () => STATUS_LABELS[selectedNode()?.status ?? "none"],
      keys: ["T"],
      enabled: hasNode,
      run: cycleSelectedStatus,
    },
    {
      id: "node.fold",
      group: "Selected node",
      label: () => (selectedNode()?.collapsed ? "Open branch" : "Fold branch"),
      keys: ["."],
      enabled: () => (selectedNode()?.children.length ?? 0) > 0,
      run: () => toggleFold(selectedId!),
    },
    {
      id: "node.foldAll",
      group: "Selected node",
      label: () => (selectedNode()?.collapsed ? "Open every level below" : "Fold every level below"),
      keys: ["Alt+."],
      enabled: () => (selectedNode()?.children.length ?? 0) > 0,
      run: () => toggleFold(selectedId!, true),
    },
    {
      id: "node.focus",
      group: "Selected node",
      label: () => (focusId && focusId === selectedId ? "Exit focus" : "Focus on branch"),
      keys: ["F"],
      enabled: () => focusId !== null || (selectedId !== null && selectedId !== doc.root.id),
      run: toggleFocus,
    },
    { id: "node.moveUp", group: "Selected node", label: "Move up", keys: ["Alt+ArrowUp"], enabled: hasNode, run: () => moveSelected(-1) },
    { id: "node.moveDown", group: "Selected node", label: "Move down", keys: ["Alt+ArrowDown"], enabled: hasNode, run: () => moveSelected(1) },
    {
      id: "node.delete",
      group: "Selected node",
      label: "Delete",
      keys: ["Backspace", "Delete"],
      enabled: () => selectedNonRoot().length > 0,
      run: deleteSelection,
    },
    ...(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"] as const).map(
      (key): Command => ({ id: `select.${key}`, group: "Selected node", label: `Select ${key}`, keys: [key], hidden: true, run: () => navigate(key) }),
    ),
    // The map.
    { id: "map.addIdea", group: "Map", label: "Add idea", hidden: true, run: () => addNodeAndEdit(doc.root) },
    { id: "map.undo", group: "Map", label: "Undo", keys: ["Mod+Z"], enabled: () => doc.canUndo(), run: undo },
    { id: "map.redo", group: "Map", label: "Redo", keys: ["Mod+Shift+Z"], enabled: () => doc.canRedo(), run: redo },
    { id: "map.arrange", group: "Map", label: "Arrange", run: arrange },
    { id: "map.find", group: "Map", label: "Find", keys: ["Mod+F"], run: () => searchBar.open() },
    { id: "map.zoomToFit", group: "Map", label: "Zoom to fit", keys: ["0"], run: zoomToFit },
    { id: "map.zoomIn", group: "Map", label: "Zoom in", keys: ["Mod+=", "Mod++"], whileEditing: true, run: () => zoomBy(ZOOM_STEP) },
    { id: "map.zoomOut", group: "Map", label: "Zoom out", keys: ["Mod+-"], whileEditing: true, run: () => zoomBy(1 / ZOOM_STEP) },
    // Files. These work during an edit too: they commit it first.
    { id: "file.open", group: "File", label: "Open…", keys: ["Mod+O"], whileEditing: true, run: () => void openFile() },
    { id: "file.save", group: "File", label: "Save", keys: ["Mod+S"], whileEditing: true, run: () => void save() },
    { id: "file.saveAs", group: "File", label: "Save As…", keys: ["Mod+Shift+S"], whileEditing: true, run: () => void save(true) },
    { id: "file.import", group: "File", label: "Import Markdown…", run: () => void importMarkdown() },
    { id: "file.export", group: "File", label: "Export…", run: () => void exportFile() },
    { id: "file.print", group: "File", label: "Print…", run: () => void print() },
    // How every map looks.
    ...(["system", "light", "dark"] as const).map(
      (theme): Command => ({ id: `view.theme.${theme}`, group: "View", label: `Appearance: ${theme[0].toUpperCase()}${theme.slice(1)}`, run: () => setTheme(theme) }),
    ),
    {
      id: "view.lines",
      group: "View",
      label: () => (getViewPrefs().edgeStyle === "curved" ? "Lines: Elbow" : "Lines: Curved"),
      run: () => setViewPref("edgeStyle", getViewPrefs().edgeStyle === "curved" ? "straight" : "curved"),
    },
    viewToggle("sketchy", "hand-drawn style", "Turn on", "Turn off"),
    viewToggle("grid", "dot grid", "Show", "Hide"),
    viewToggle("minimap", "minimap", "Show", "Hide"),
    ...FONT_OPTIONS.map(
      (font): Command => ({ id: `view.font.${font.id}`, group: "View", label: `Font: ${font.id === "system" ? "System" : font.label}`, run: () => setFontId(font.id) }),
    ),
    { id: "help.shortcuts", group: "Help", label: "Keyboard shortcuts", keys: ["?"], run: () => help.toggle() },
    {
      id: "palette.open",
      group: "Help",
      label: "Commands",
      keys: ["Mod+K"],
      hidden: true,
      run() {
        contextMenu.close();
        palette.open();
      },
    },
  ]);

  function viewToggle(pref: "sketchy" | "grid" | "minimap", name: string, on: string, off: string): Command {
    return {
      id: `view.${pref}`,
      group: "View",
      label: () => `${getViewPrefs()[pref] ? off : on} ${name}`,
      run: () => setViewPref(pref, !getViewPrefs()[pref]),
    };
  }

  // A right-click menu entry for a command. The node menu leaves out what
  // does not apply; the canvas menu shows it disabled (Undo with nothing
  // to undo), so its layout stays put.
  function menuEntry(id: string): MenuEntry {
    const command = commands.get(id);
    return {
      label: labelOf(command),
      shortcut: shortcutOf(command),
      disabled: !isEnabled(command),
      danger: id === "node.delete",
      run: () => commands.run(id),
    };
  }

  function nodeMenuEntries(): MenuEntry[] {
    const groups: (string[] | "swatches")[] = [
      ["node.addChild", "node.addSibling", "node.edit"],
      ["node.notes", "node.link", "node.icon", "node.status"],
      "swatches",
      ["node.fold", "node.focus"],
      ["node.delete"],
    ];
    const isRoot = selectedId === doc.root.id;
    const sections = groups
      .map((group): MenuEntry[] => {
        if (group === "swatches") {
          return isRoot ? [] : [{ swatches: PALETTE, active: selectionColor(), onPick: pickColor }];
        }
        return group.filter((id) => isEnabled(commands.get(id)) && !(isRoot && id === "node.addSibling")).map(menuEntry);
      })
      .filter((section) => section.length > 0);
    return sections.flatMap((section, i) => (i === 0 ? section : ["separator" as const, ...section]));
  }

  function canvasMenuEntries(): MenuEntry[] {
    return [
      menuEntry("map.addIdea"),
      "separator",
      menuEntry("map.undo"),
      menuEntry("map.redo"),
      "separator",
      menuEntry("map.arrange"),
      menuEntry("map.zoomToFit"),
      { label: "Commands…", shortcut: formatKey("Mod+K"), run: () => palette.open() },
    ];
  }

  // The selection's shared branch color, or null for a mixed selection, as
  // a bold button goes blank over mixed text in a word processor.
  function selectionColor(): string | null {
    const colors = selectedNonRoot().map((id) => lastPositions.get(id)?.color ?? null);
    return colors.length > 0 && colors.every((c) => c === colors[0]) ? colors[0] : null;
  }

  // The help list: every command with a shortcut, plus the gestures.
  function helpRows(): [string, string][] {
    const rows: [string, string][] = [
      ["Arrow keys", "Move the selection (→ also opens a folded branch)"],
      ["Enter / Tab while typing a new node", "Go on to the next sibling / child"],
      ["Double-click", "Edit a node"],
      ["Esc", "Stop editing (an empty new node is removed)"],
      ["Shift+click", "Select more than one node"],
      ["⌥-click − or a count", "Fold or open every level below"],
      ["Right-click", "Actions for a node, or for the map"],
      [formatKey("Mod+V"), "Paste an image onto the node"],
    ];
    for (const command of commands.all()) {
      if (command.hidden && command.id !== "palette.open") continue;
      if (!command.keys) continue;
      const keys = command.keys.map(formatKey).filter((k, i, all) => all.indexOf(k) === i).join(" / ");
      rows.push([keys, command.id === "palette.open" ? "Search all commands" : labelOf(command)]);
    }
    return rows;
  }

  // ----- Controls -----

  const zoomControls = createZoomControls(container, commands);
  const contextMenu = createContextMenu(container, signal);
  const nodeToolbar = createNodeToolbar(container, {
    commands,
    onPickColor: pickColor,
    onMore: (anchor) => contextMenu.show(anchor.left, anchor.bottom + 6, nodeMenuEntries()),
    signal,
  });
  const palette = createPalette(container, commands.all, () => container.focus());
  const help = createHelpPanel(container, helpRows);
  const minimap = createMinimap(container, {
    // Centers the camera on the world point clicked in the minimap.
    onNavigate(worldX, worldY) {
      if (!camera) return;
      const { width, height } = viewport();
      camera = { ...camera, x: width / 2 - worldX * camera.scale, y: height / 2 - worldY * camera.scale };
      showCamera();
    },
  });
  const searchBar = createSearchBar(container, {
    onQueryChange(query) {
      searchQuery = query;
      updateSearchMatches(true);
      jumpToSearchMatch();
    },
    onNext() {
      if (searchMatchIds.length === 0) return;
      searchIndex = (searchIndex + 1) % searchMatchIds.length;
      jumpToSearchMatch();
    },
    onPrev() {
      if (searchMatchIds.length === 0) return;
      searchIndex = (searchIndex - 1 + searchMatchIds.length) % searchMatchIds.length;
      jumpToSearchMatch();
    },
    onClose: () => closeSearch(),
  });

  // The node toolbar and the zoom level follow the camera.
  function updateFloatingControls(): void {
    zoomControls.update(camera?.scale ?? 1);
    const layout = selectedId ? lastPositions.get(selectedId) : undefined;
    if (!camera || !layout || !nodeToolbarWanted || editor || drag) {
      nodeToolbar.update(null);
      return;
    }
    const s = camera.scale;
    nodeToolbar.update({
      left: camera.x + layout.x * s,
      right: camera.x + (layout.x + layout.width) * s,
      top: camera.y + (layout.y - layout.height / 2) * s,
      bottom: camera.y + (layout.y + layout.height / 2) * s,
      color: selectionColor(),
      canColor: selectedNonRoot().length > 0,
      // A folded node has its count pill there, so only a node with no
      // children at all has the room.
      roomRight: selectedNode()?.children.length === 0,
    });
  }

  // ----- Pointer -----

  const on = <K extends keyof HTMLElementEventMap>(
    type: K,
    listener: (e: HTMLElementEventMap[K]) => void,
    options: AddEventListenerOptions = {},
  ) => container.addEventListener(type, listener, { ...options, signal });

  const nodeIdOf = (el: Element | null) => el?.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId ?? null;

  on("contextmenu", (e) => {
    // An editor keeps the system menu (cut, copy, paste, spelling).
    if (["INPUT", "TEXTAREA"].includes((e.target as HTMLElement).tagName)) return;
    e.preventDefault();
    if (isEditing()) return;
    const id = nodeIdOf(e.target as Element);
    if (id) {
      if (!selectedIds.has(id)) selectOnly(id);
      else selectedId = id;
      nodeToolbarWanted = false;
      showSelection();
      contextMenu.show(e.clientX, e.clientY, nodeMenuEntries());
    } else {
      contextMenu.show(e.clientX, e.clientY, canvasMenuEntries());
    }
  });

  on("pointerdown", (e) => {
    const target = e.target as Element;
    if (["INPUT", "TEXTAREA"].includes((target as HTMLElement).tagName)) return;
    // A right-click (or Control-click) opens the context menu instead.
    if (e.button === 2 || e.ctrlKey) return;
    // Menus, popovers and the palette handle their own clicks.
    if (target.closest(".mm-popover, .mm-palette-backdrop, .mm-minimap, .mm-help")) return;
    // A click on an editor panel's label must not end the edit.
    if (target.closest(".mm-field-panel")) return e.preventDefault();
    const linkBadge = target.closest(".mm-link-badge");
    if (linkBadge) {
      const link = findNode(doc.root, nodeIdOf(linkBadge) ?? "")?.link;
      if (link) void openLink(link);
      return;
    }
    // Toolbar buttons must not take keyboard focus from the map, or Tab,
    // Enter and the other shortcuts stop working after a click on them.
    if (target.closest(".mm-toolbar")) {
      if (target.closest("button")) e.preventDefault();
      return;
    }
    // Without this, when a double-click opens the title editor and
    // focuses it, the browser's own mousedown handling (aimed at the
    // element that render just removed) takes the focus back a moment
    // later, which commits and closes the edit at once.
    e.preventDefault();
    container.focus();
    if (isEditing()) return;

    const notesBadge = target.closest(".mm-notes-badge");
    if (notesBadge) {
      const id = nodeIdOf(notesBadge);
      if (id) {
        selectOnly(id);
        openEditor("notes", id);
      }
      return;
    }
    const foldControl = target.closest(".mm-collapse-toggle");
    if (foldControl) {
      // Option-click folds or opens every level below, as in macOS outline views.
      const id = nodeIdOf(foldControl);
      if (id) toggleFold(id, e.altKey);
      return;
    }
    const addButton = target.closest(".mm-add-btn");
    if (addButton) {
      const parent = findNode(doc.root, nodeIdOf(addButton) ?? "");
      if (parent) addNodeAndEdit(parent);
      return;
    }

    const id = nodeIdOf(target);
    if (!id) {
      lastClick = null;
      selectOnly(null);
      nodeToolbarWanted = false;
      drag = { type: "pan", startX: e.clientX, startY: e.clientY, startCamera: { ...camera! } };
      showSelection();
      capturePointer(e);
      return;
    }

    // Double-clicks come from pointerdown timing: the native dblclick is
    // unreliable once the container captures the pointer for drags.
    const isDoubleClick =
      lastClick?.id === id &&
      e.timeStamp - lastClick.time < DOUBLE_CLICK_MS &&
      Math.abs(e.clientX - lastClick.x) < DOUBLE_CLICK_PX &&
      Math.abs(e.clientY - lastClick.y) < DOUBLE_CLICK_PX;
    lastClick = isDoubleClick ? null : { id, time: e.timeStamp, x: e.clientX, y: e.clientY };
    if (isDoubleClick) return openEditor("title", id);

    // Shift+click adds or removes a node from the selection; removing waits
    // for pointerup, so a shift+drag on a selected node moves the group.
    if (e.shiftKey && id !== doc.root.id) {
      if (selectedIds.has(id)) pendingDeselectId = id;
      else selectedIds.add(id);
      selectedId = id;
    } else {
      selectOnly(id);
    }
    nodeToolbarWanted = true;
    if (id !== doc.root.id) startNodeDrag(id, e);
    showSelection();
    capturePointer(e);
  });

  function capturePointer(e: PointerEvent): void {
    try {
      container.setPointerCapture?.(e.pointerId);
    } catch {
      // No active pointer with this id (a synthetic event).
    }
  }

  function startNodeDrag(id: string, e: PointerEvent): void {
    // A group drag moves every selected node but the root (moving the root
    // moves the whole map) and but a node under another selected node
    // (offsets apply to descendants, so it would move twice).
    const groupDrag = selectedIds.has(id) && selectedIds.size > 1;
    const ids = groupDrag ? selectedNonRoot().filter((nid) => !hasSelectedAncestor(nid)) : [id];
    const moving = new Map<MindMapNode, { dx: number; dy: number }>();
    const drawn = new Set<string>();
    for (const nid of ids) {
      const node = findNode(doc.root, nid);
      if (!node) continue;
      moving.set(node, { ...(node.offset ?? { dx: 0, dy: 0 }) });
      for (const n of visibleNodes(node)) drawn.add(n.id);
    }
    drag = { type: "node", id, startX: e.clientX, startY: e.clientY, moving, drawn };
  }

  // Pointer events can come faster than the screen refreshes, so the drag
  // updates at most once per animation frame.
  let pendingDragFrame: number | null = null;
  function cancelDragFrame(): void {
    if (pendingDragFrame !== null) cancelAnimationFrame(pendingDragFrame);
    pendingDragFrame = null;
  }

  on("pointermove", (e) => {
    if (!drag) return;
    const dxPx = e.clientX - drag.startX;
    const dyPx = e.clientY - drag.startY;
    if (drag.type === "pan") {
      camera = { ...drag.startCamera, x: drag.startCamera.x + dxPx, y: drag.startCamera.y + dyPx };
      return showCamera();
    }
    if (dxPx === 0 && dyPx === 0) return;
    if (!dragMoved) {
      dragMoved = true;
      nodeToolbar.update(null);
      drag.preview = startDragPreview(canvasEl, drag.drawn, lastPositions, getViewPrefs().edgeStyle);
    }
    const scale = camera!.scale;
    for (const [node, start] of drag.moving) node.offset = { dx: start.dx + dxPx / scale, dy: start.dy + dyPx / scale };
    // Dropping onto another node reparents a single dragged node; a group
    // only moves (dropping several nodes onto one risks cycles).
    const single = drag.moving.size === 1 ? [...drag.moving.keys()][0] : null;
    dropTargetId = single ? findDropTargetId(e.clientX, e.clientY, single) : null;
    const current = drag;
    pendingDragFrame ??= requestAnimationFrame(() => {
      pendingDragFrame = null;
      if (current.preview) {
        current.preview.move(dxPx / scale, dyPx / scale);
        setDropTarget(canvasEl, dropTargetId);
      } else {
        render();
      }
    });
  });

  // The node under the pointer during a drag, if the dragged node may be
  // dropped onto it: not the node itself, and not one of its descendants
  // (that would make a cycle).
  function findDropTargetId(clientX: number, clientY: number, dragged: MindMapNode): string | null {
    let hit: Element | null;
    try {
      hit = document.elementFromPoint(clientX, clientY);
    } catch {
      return null; // jsdom has no elementFromPoint
    }
    const id = nodeIdOf(hit);
    if (!id || id === dragged.id || findNode(dragged, id)) return null;
    return id;
  }

  on("pointerup", () => {
    if (!drag) return;
    cancelDragFrame();
    const finished = drag;
    drag = null;
    if (finished.type === "node" && dragMoved) {
      // One undo step for the move or the reparent. A plain click records
      // nothing, or ⌘Z would seem to do nothing until pressed once per click.
      if (dropTargetId) {
        const target = findNode(doc.root, dropTargetId);
        reparentNode(doc.root, finished.id, dropTargetId);
        // A node dropped onto a folded branch opens it, so the node stays
        // in sight.
        if (target) target.collapsed = false;
      }
      doc.commit();
      dragMoved = false;
      dropTargetId = null;
      return render();
    }
    dragMoved = false;
    dropTargetId = null;
    if (finished.type === "node" && pendingDeselectId) {
      selectedIds.delete(pendingDeselectId);
      if (selectedId === pendingDeselectId) selectedId = [...selectedIds][0] ?? null;
      pendingDeselectId = null;
      return showSelection();
    }
    pendingDeselectId = null;
    updateFloatingControls();
  });

  on("pointercancel", () => {
    cancelDragFrame();
    // The system took the pointer mid-drag: put the nodes back, with no
    // undo step.
    if (drag?.type === "node" && dragMoved) {
      for (const [node, start] of drag.moving) node.offset = start.dx === 0 && start.dy === 0 ? undefined : start;
    }
    pendingDeselectId = null;
    drag = null;
    dragMoved = false;
    dropTargetId = null;
    render();
  });

  // Pastes a clipboard image onto the selected node.
  on("paste", (e) => {
    if (["INPUT", "TEXTAREA"].includes((e.target as HTMLElement).tagName)) return;
    const targetId = selectedId;
    const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"));
    const file = item?.getAsFile();
    if (!targetId || !file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string" || !findNode(doc.root, targetId)) return;
      setImage(doc.root, targetId, reader.result);
      doc.commit();
      render();
    };
    reader.readAsDataURL(file);
  });

  // ----- Zoom gestures -----

  // Wheel and Chromium pinch (wheel with ctrlKey) come faster than a frame,
  // so their deltas add up and apply once per frame, against the camera at
  // the start of that frame's batch.
  let wheelFrame: number | null = null;
  let wheelBase: Camera | null = null;
  let wheelScale = 1;
  let wheelAnchor = { x: 0, y: 0 };
  on(
    "wheel",
    (e) => {
      e.preventDefault();
      if (!camera) return;
      const rect = container.getBoundingClientRect();
      wheelAnchor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      if (wheelFrame === null) {
        wheelBase = camera;
        wheelScale = 1;
      }
      wheelScale *= Math.pow(1.0015, -wheelDeltaPixels(e, rect.height) * PINCH_ZOOM_SENSITIVITY);
      wheelFrame ??= requestAnimationFrame(() => {
        wheelFrame = null;
        zoomLive(wheelBase!, wheelBase!.scale * wheelScale, wheelAnchor.x, wheelAnchor.y);
      });
    },
    { passive: false },
  );

  // WKWebView (the macOS app) reports a trackpad pinch as WebKit gesture
  // events, not wheel events. Their scale is cumulative since
  // gesturestart, so each change starts from the camera at that moment.
  let gestureBase: Camera | null = null;
  let gestureFrame: number | null = null;
  const onGesture = (type: string, listener: (e: Event) => void) =>
    container.addEventListener(type, listener, { signal });
  onGesture("gesturestart", (e) => {
    e.preventDefault();
    gestureBase = camera ? { ...camera } : null;
  });
  onGesture("gesturechange", (e) => {
    e.preventDefault();
    const ge = e as unknown as { scale: number; clientX: number; clientY: number };
    const base = gestureBase;
    if (!base) return;
    const rect = container.getBoundingClientRect();
    const targetScale = base.scale * Math.pow(ge.scale, PINCH_ZOOM_SENSITIVITY);
    const anchor = { x: ge.clientX - rect.left, y: ge.clientY - rect.top };
    if (gestureFrame !== null) cancelAnimationFrame(gestureFrame);
    gestureFrame = requestAnimationFrame(() => {
      gestureFrame = null;
      zoomLive(base, targetScale, anchor.x, anchor.y);
    });
  });
  onGesture("gestureend", (e) => {
    e.preventDefault();
    gestureBase = null;
  });

  // ----- Window -----

  let lastRect = container.getBoundingClientRect();
  window.addEventListener(
    "resize",
    () => {
      if (!isActive) return;
      const rect = container.getBoundingClientRect();
      // Keep the map's center where it was.
      if (camera) {
        camera = { ...camera, x: camera.x + (rect.width - lastRect.width) / 2, y: camera.y + (rect.height - lastRect.height) / 2 };
      }
      lastRect = rect;
      viewportSize = null;
      render();
    },
    { signal },
  );

  window.addEventListener(
    "keydown",
    (e) => {
      if (!isActive) return;
      // Keys pressed in a menu, popover or the palette are theirs.
      if ((e.target as Element | null)?.closest?.(".mm-popover, .mm-palette-backdrop")) return;
      // Keyboard work hides the node toolbar; a click on a node brings it
      // back.
      if (!e.metaKey && !e.ctrlKey && !["Shift", "Meta", "Control", "Alt"].includes(e.key) && nodeToolbarWanted) {
        nodeToolbarWanted = false;
        nodeToolbar.update(null);
      }
      if (e.key === "Escape") {
        // A safety net: Escape always ends an edit, even if its field never
        // got focus.
        if (isEditing()) {
          e.preventDefault();
          return cancelEditor();
        }
        if (help.isOpen()) {
          e.preventDefault();
          return help.close();
        }
      }
      const command = commands.forKey(e, isEditing());
      if (!command) return;
      e.preventDefault();
      command.run();
    },
    { signal },
  );

  render();
  container.focus();

  return {
    run(id) {
      commands.run(id);
      if (!isEditing() && !searchBar.isOpen()) container.focus();
    },
    openRoot: loadRoot,
    setActive(active) {
      isActive = active;
      if (active) container.focus();
    },
    getTitle: () => doc.root.text,
    forceRender: render,
    destroy: () => lifetime.abort(),
    isDirty: () => doc.isDirty(),
    getFilePath: () => doc.filePath,
    openRecent,
    flushEdit,
    confirmClose: canDiscardChanges,
    isFocused: () => focusId !== null,
    canFocus: () => isEnabled(commands.get("node.focus")),
  };
}

// Trackpads report wheel deltas in pixels, but a mouse wheel can report
// lines or pages, where one notch is a single-digit delta.
function wheelDeltaPixels(e: WheelEvent, viewportHeight: number): number {
  if (e.deltaMode === WheelEvent.DOM_DELTA_LINE) return e.deltaY * WHEEL_LINE_HEIGHT;
  if (e.deltaMode === WheelEvent.DOM_DELTA_PAGE) return e.deltaY * viewportHeight;
  return e.deltaY;
}
