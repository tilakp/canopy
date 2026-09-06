import {
  addChild,
  clearOffsets,
  cycleStatus,
  findNode,
  findParent,
  moveSibling,
  removeNode,
  reparentNode,
  setColor,
  setIcon,
  setImage,
  setLink,
  setNotes,
  toggleCollapsed,
  updateText,
  type MindMapNode,
} from "./model";
import { renderMindMap, computeFitCamera, applyCamera, type Camera, type EdgeStyle } from "./render";
import type { NodeLayout } from "./layout";
import { createToolbar } from "./toolbar";
import { createMinimap } from "./minimap";
import { createHistory } from "./history";
import { saveToFile, loadFromFile, loadFromPath } from "./persistence";
import { openLink } from "./links";
import { exportMap } from "./exportFile";
import { createSearchBar } from "./search";
import { fromMarkdown } from "./importMarkdown";
import { printMap } from "./printMap";
import { addRecentFile } from "./recentFiles";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";

const ZOOM_MIN = 0.2;
const ZOOM_MAX = 3;
// macOS's double-click speed preference can be slower than a hardcoded
// "fast" guess, and real clicks never land on the exact same pixel twice.
const DOUBLE_CLICK_MS = 600;
const DOUBLE_CLICK_PX = 12;

type DragState =
  | {
      type: "node";
      id: string;
      startX: number;
      startY: number;
      // Every dragged node's starting offset, keyed by id — usually just the
      // one node under the pointer, but a shift+drag on a member of the
      // current multi-selection moves every selected node together.
      startOffsets: Map<string, { dx: number; dy: number }>;
    }
  | { type: "pan"; startX: number; startY: number; startCamera: Camera }
  | null;

export interface AppHandle {
  openRoot(root: MindMapNode, path: string): void;
  // Multiple maps share one window's global (window-level) key/resize
  // listeners across every open document's startApp instance — only the
  // active one should act on them. The container itself is what actually
  // shows/hides (see workspace.ts), so pointer/wheel listeners (scoped to
  // the container) don't need this: a hidden container gets no such events.
  setActive(active: boolean): void;
  getTitle(): string;
  // Most visual state (CSS custom properties) updates live across every
  // open document the instant the theme changes, but a node's pastel leaf
  // fill is computed once per render into an inline SVG attribute — this
  // forces a fresh render so that color picks up the new theme too.
  forceRender(): void;
  // Detaches this instance's window-level listeners when its tab closes.
  // They're global, so without this a closed document keeps handling every
  // keystroke (⌘S on a closed map still opens a save dialog) and keeps its
  // whole tree, undo history and detached DOM alive for the session.
  destroy(): void;
}

export function startApp(
  container: HTMLElement,
  initialRoot: MindMapNode,
  initialFilePath: string | null = null,
  onChange?: () => void,
): AppHandle {
  let root = initialRoot;
  let isActive = true;
  let selectedId: string | null = null;
  // The full multi-selection (shift+click to add/remove members); selectedId
  // is the "primary" member that single-target actions (edit, notes/icon/
  // link, arrow-key navigation, add-child) act on. selectOnly() keeps both
  // in sync for the common single-selection case.
  let selectedIds: Set<string> = new Set();
  function selectOnly(id: string | null): void {
    selectedId = id;
    selectedIds = id ? new Set([id]) : new Set();
  }
  let editingId: string | null = null;
  let notesEditingId: string | null = null;
  let iconEditingId: string | null = null;
  let linkEditingId: string | null = null;
  let edgeStyle: EdgeStyle = "curved";
  let sketchy = false;
  let focusId: string | null = null;
  function toggleFocus(): void {
    if (!selectedId || selectedId === root.id) return;
    focusId = focusId === selectedId ? null : selectedId;
    render();
  }
  let camera: Camera | undefined;
  let dragState: DragState = null;
  let dragMoved = false;
  // Set at pointerdown when shift-clicking a node that's already part of a
  // multi-selection — resolved at pointerup: a plain click (no drag) then
  // toggles it off, but a drag moves the whole group without deselecting it.
  let pendingDeselectId: string | null = null;
  let lastClick: { id: string; time: number; x: number; y: number } | null = null;
  let filePath: string | null = initialFilePath;
  let lastContentBBox = new DOMRect();
  let lastPositions = new Map<string, NodeLayout>();
  let dropTargetId: string | null = null;
  let minimapVisible = true;
  let searchQuery = "";
  let searchMatchIds: string[] = [];
  let searchIndex = 0;

  const history = createHistory(structuredClone(root));
  function commit(): void {
    history.push(structuredClone(root));
  }

  // Without a focused, focusable element, WKWebView's native tab-navigation
  // can intercept the Tab key before it reaches the DOM as a keydown event.
  // Keeping the container focused (except while an edit input is up) avoids
  // that.
  container.tabIndex = -1;

  // renderMindMap() clears its container on every render, so the canvas
  // gets a dedicated child element — otherwise it would wipe the toolbar
  // out after the very first render.
  const canvasEl = document.createElement("div");
  canvasEl.className = "mm-canvas-container";
  container.appendChild(canvasEl);

  const toolbar = createToolbar(container, {
    onPickColor(color) {
      const targets = [...selectedIds].filter((id) => id !== root.id);
      if (targets.length === 0) return;
      for (const id of targets) setColor(root, id, color);
      commit();
      render();
    },
    onPickEdgeStyle(style) {
      edgeStyle = style;
      render();
    },
    onToggleSketchy() {
      sketchy = !sketchy;
      render();
    },
    onToggleFocus: () => toggleFocus(),
    onUndo: () => void performUndo(),
    onRedo: () => void performRedo(),
    onSave: () => void performSave(),
    onOpen: () => void performOpen(),
    onTidy: () => {
      clearOffsets(root);
      commit();
      render();
    },
    onZoomToFit: () => performZoomToFit(),
    onZoomIn: () => performZoomBy(ZOOM_STEP),
    onZoomOut: () => performZoomBy(1 / ZOOM_STEP),
    onExport: () => void performExport(),
    onToggleMinimap: () => {
      minimapVisible = !minimapVisible;
      render();
    },
    onImportMarkdown: () => void performImportMarkdown(),
    onPrint: () => void performPrint(),
    onOpenRecent: (path) => performOpenRecent(path),
  });

  const minimap = createMinimap(container, {
    // Re-centers the main camera on the world point the user clicked inside
    // the minimap.
    onNavigate(worldX, worldY) {
      if (!camera) return;
      const rect = container.getBoundingClientRect();
      camera = {
        ...camera,
        x: rect.width / 2 - worldX * camera.scale,
        y: rect.height / 2 - worldY * camera.scale,
      };
      render();
    },
  });

  const searchBar = createSearchBar(container, {
    onQueryChange(query) {
      searchQuery = query;
      updateSearchMatches();
      if (searchMatchIds.length > 0) jumpToSearchMatch();
      else render();
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
    onClose() {
      searchBar.close();
      searchQuery = "";
      searchMatchIds = [];
      container.focus();
      render();
    },
  });

  // Mirrors render.ts's own iterateNodes: a collapsed node's descendants
  // have no layout position, so matches inside one couldn't be centered on
  // anyway — search is scoped to what's currently visible.
  function* visibleNodes(node: MindMapNode): Generator<MindMapNode> {
    yield node;
    if (node.collapsed) return;
    for (const child of node.children) yield* visibleNodes(child);
  }

  function updateSearchMatches(): void {
    const query = searchQuery.trim().toLowerCase();
    searchMatchIds = query
      ? [...visibleNodes(root)].filter((n) => n.text.toLowerCase().includes(query)).map((n) => n.id)
      : [];
    searchIndex = 0;
  }

  function centerCameraOn(id: string): void {
    const layout = lastPositions.get(id);
    if (!layout || !camera) return;
    const rect = container.getBoundingClientRect();
    camera = {
      ...camera,
      x: rect.width / 2 - (layout.x + layout.width / 2) * camera.scale,
      y: rect.height / 2 - layout.y * camera.scale,
    };
  }

  function jumpToSearchMatch(): void {
    const id = searchMatchIds[searchIndex];
    if (!id) {
      render();
      return;
    }
    selectOnly(id);
    centerCameraOn(id);
    render();
  }

  function render(): void {
    // A focused node removed by an edit/undo would otherwise leave every
    // remaining node dimmed (computeFocusSet finds nothing to keep lit).
    if (focusId && !findNode(root, focusId)) focusId = null;
    const result = renderMindMap(
      canvasEl,
      root,
      {
        selectedIds,
        editingId,
        notesEditingId,
        iconEditingId,
        linkEditingId,
        edgeStyle,
        sketchy,
        focusId,
        camera,
        dropTargetId,
      },
      {
        onEditCommit(id, text) {
          updateText(root, id, text.trim() || "Untitled");
          commit();
          editingId = null;
          render();
          container.focus();
        },
        onEditCancel() {
          editingId = null;
          render();
          container.focus();
        },
        onNotesCommit(id, notes) {
          setNotes(root, id, notes);
          commit();
          notesEditingId = null;
          render();
          container.focus();
        },
        onNotesCancel() {
          notesEditingId = null;
          render();
          container.focus();
        },
        onIconCommit(id, icon) {
          setIcon(root, id, icon);
          commit();
          iconEditingId = null;
          render();
          container.focus();
        },
        onIconCancel() {
          iconEditingId = null;
          render();
          container.focus();
        },
        onLinkCommit(id, link) {
          setLink(root, id, link);
          commit();
          linkEditingId = null;
          render();
          container.focus();
        },
        onLinkCancel() {
          linkEditingId = null;
          render();
          container.focus();
        },
      },
    );
    camera = result.camera;
    lastContentBBox = result.contentBBox;
    lastPositions = result.positions;
    minimap.update({
      positions: lastPositions,
      contentBBox: lastContentBBox,
      camera,
      viewportSize: container.getBoundingClientRect(),
      visible: minimapVisible,
    });

    const targets = [...selectedIds].filter((id) => id !== root.id);
    const targetColors = targets.map((id) => result.positions.get(id)?.color ?? null);
    // Only show a swatch as "active" when every selected node shares that
    // color — a mixed multi-selection shows no active swatch, same idea as
    // a word processor's bold button going blank over a mixed-weight range.
    const activeColor = targetColors.length > 0 && targetColors.every((c) => c === targetColors[0]) ? targetColors[0] : null;
    toolbar.update({
      hasSelection: targets.length > 0,
      activeColor,
      edgeStyle,
      sketchy,
      focused: focusId !== null,
      minimapVisible,
      canUndo: history.canUndo(),
      canRedo: history.canRedo(),
    });
    searchBar.update({ query: searchQuery, matchCount: searchMatchIds.length, currentIndex: searchIndex });
    onChange?.();
  }

  function startEditing(id: string): void {
    selectOnly(id);
    editingId = id;
    render();
  }

  function loadRoot(newRoot: MindMapNode, path: string | null): void {
    root = newRoot;
    filePath = path;
    selectOnly(null);
    editingId = null;
    focusId = null;
    camera = undefined;
    dragState = null;
    history.push(structuredClone(root));
    render();
  }

  async function performSave(): Promise<void> {
    const savedPath = await saveToFile(root, filePath);
    if (savedPath) {
      filePath = savedPath;
      addRecentFile(savedPath);
    }
  }

  async function performOpen(): Promise<void> {
    // A file that can't be read, or whose JSON isn't a mind map, must leave
    // the current document alone rather than half-replacing it.
    const result = await loadFromFile().catch(() => null);
    if (result) {
      loadRoot(result.root, result.path);
      addRecentFile(result.path);
    }
  }

  async function performImportMarkdown(): Promise<void> {
    // The whole flow (including the dialog itself) is wrapped, not just the
    // file read — same shape as performOpen(): a failure at any step must
    // leave the current document alone rather than half-replacing it, and
    // must not surface as an unhandled rejection.
    const path = await open({ multiple: false, filters: [{ name: "Markdown", extensions: ["md"] }] }).catch(
      () => null,
    );
    if (!path || Array.isArray(path)) return;
    const importedRoot = await readTextFile(path).then(fromMarkdown).catch(() => null);
    if (importedRoot) {
      loadRoot(importedRoot, null);
      addRecentFile(path);
    }
  }

  async function performOpenRecent(path: string): Promise<boolean> {
    const result = await loadFromPath(path).catch(() => null);
    if (!result) return false;
    loadRoot(result.root, result.path);
    addRecentFile(result.path);
    return true;
  }

  async function performExport(): Promise<void> {
    const svgEl = canvasEl.querySelector<SVGSVGElement>("svg.mm-canvas");
    if (!svgEl) return;
    await exportMap(root, svgEl, lastContentBBox);
  }

  async function performPrint(): Promise<void> {
    const svgEl = canvasEl.querySelector<SVGSVGElement>("svg.mm-canvas");
    if (!svgEl) return;
    await printMap(svgEl, lastContentBBox);
  }

  // The element under the cursor during a node drag, if it's a valid
  // reparent target — not the dragged node itself, and not one of its own
  // descendants (that would create a cycle).
  function findDropTargetId(clientX: number, clientY: number, draggedId: string): string | null {
    // jsdom (used by tests) doesn't implement elementFromPoint at all — it
    // throws rather than returning null, unlike a real browser.
    let hit: Element | null;
    try {
      hit = document.elementFromPoint(clientX, clientY);
    } catch {
      return null;
    }
    const el = hit?.closest<HTMLElement>("[data-node-id]");
    const id = el?.dataset.nodeId;
    if (!id || id === draggedId) return null;
    const draggedNode = findNode(root, draggedId)!;
    if (findNode(draggedNode, id)) return null;
    return id;
  }

  function performZoomToFit(): void {
    camera = computeFitCamera(lastContentBBox, container.getBoundingClientRect());
    render();
  }

  const ZOOM_STEP = 1.25;

  function performZoomBy(factor: number): void {
    if (!camera) return;
    const rect = container.getBoundingClientRect();
    zoomAround(camera, camera.scale * factor, rect.width / 2, rect.height / 2);
  }

  function performUndo(): void {
    const snapshot = history.undo();
    if (!snapshot) return;
    root = structuredClone(snapshot);
    selectOnly(null);
    editingId = null;
    render();
  }

  function performRedo(): void {
    const snapshot = history.redo();
    if (!snapshot) return;
    root = structuredClone(snapshot);
    selectOnly(null);
    editingId = null;
    render();
  }

  container.addEventListener("pointerdown", (e) => {
    if (["INPUT", "TEXTAREA"].includes((e.target as HTMLElement).tagName)) return;

    const linkBadge = (e.target as Element).closest(".mm-link-badge");
    if (linkBadge) {
      const nodeId = linkBadge.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId;
      const node = nodeId ? findNode(root, nodeId) : null;
      if (node?.link) void openLink(node.link);
      return;
    }
    // Let toolbar buttons behave like normal buttons — don't preventDefault
    // (which would suppress the click event they rely on) or treat this as
    // a canvas pan.
    if ((e.target as Element).closest(".mm-toolbar")) return;
    // Same reasoning: the minimap handles its own pointer events (click/drag
    // to navigate) and shouldn't also fall through to canvas pan/selection.
    if ((e.target as Element).closest(".mm-minimap")) return;
    // Suppress the browser's default mousedown focus handling: without
    // this, when startEditing() below focuses a freshly-created <input>,
    // the browser's own default action (targeting the original, now
    // detached element) blurs it right back off a tick later, which
    // immediately commits and closes the edit we just opened.
    e.preventDefault();
    container.focus();
    if (editingId || notesEditingId || iconEditingId || linkEditingId) return;

    const collapseToggle = (e.target as Element).closest(".mm-collapse-toggle");
    if (collapseToggle) {
      const nodeId = collapseToggle.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId;
      if (nodeId) {
        toggleCollapsed(root, nodeId);
        commit();
        render();
      }
      return;
    }

    const addBtn = (e.target as Element).closest(".mm-add-btn");
    if (addBtn) {
      const parentId = addBtn.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId;
      if (parentId) {
        const parent = findNode(root, parentId)!;
        const child = addChild(parent, "");
        commit();
        startEditing(child.id);
      }
      return;
    }

    const nodeEl = (e.target as Element).closest<HTMLElement>("[data-node-id]");
    if (nodeEl) {
      const id = nodeEl.dataset.nodeId!;

      // Native 'dblclick' can be unreliable once setPointerCapture is in
      // play, so double-clicks are detected here from raw pointerdowns.
      const isDoubleClick =
        lastClick &&
        lastClick.id === id &&
        e.timeStamp - lastClick.time < DOUBLE_CLICK_MS &&
        Math.abs(e.clientX - lastClick.x) < DOUBLE_CLICK_PX &&
        Math.abs(e.clientY - lastClick.y) < DOUBLE_CLICK_PX;
      lastClick = { id, time: e.timeStamp, x: e.clientX, y: e.clientY };

      if (isDoubleClick) {
        lastClick = null;
        startEditing(id);
        return;
      }

      // Shift+click toggles multi-selection membership; a shift+drag on a
      // node already in that selection moves every selected node together.
      // A plain click always replaces the selection with just this node —
      // same as before multi-select existed.
      if (e.shiftKey && id !== root.id) {
        if (selectedIds.has(id)) {
          // Don't toggle off yet — deferred to pointerup so that dragging
          // this node (see groupDrag below) moves the whole group instead
          // of first shrinking it down to nothing.
          pendingDeselectId = id;
        } else {
          selectedIds.add(id);
        }
        selectedId = id;
      } else {
        selectOnly(id);
      }

      if (id !== root.id) {
        const groupDrag = selectedIds.has(id) && selectedIds.size > 1;
        const idsToMove = groupDrag ? selectedIds : new Set([id]);
        const startOffsets = new Map<string, { dx: number; dy: number }>();
        for (const nid of idsToMove) {
          const n = findNode(root, nid);
          if (n) startOffsets.set(nid, { ...(n.offset ?? { dx: 0, dy: 0 }) });
        }
        dragState = { type: "node", id, startX: e.clientX, startY: e.clientY, startOffsets };
      }
      render();
    } else {
      lastClick = null;
      selectOnly(null);
      dragState = { type: "pan", startX: e.clientX, startY: e.clientY, startCamera: { ...camera! } };
      render();
    }
    try {
      container.setPointerCapture?.(e.pointerId);
    } catch {
      // No active pointer with this id (e.g. a synthetic event) — harmless.
    }
  });

  container.addEventListener("pointermove", (e) => {
    if (!dragState) return;
    const dxPx = e.clientX - dragState.startX;
    const dyPx = e.clientY - dragState.startY;

    if (dragState.type === "node") {
      if (dxPx === 0 && dyPx === 0) return;
      dragMoved = true;
      for (const [nid, startOffset] of dragState.startOffsets) {
        const n = findNode(root, nid);
        if (n) {
          n.offset = {
            dx: startOffset.dx + dxPx / camera!.scale,
            dy: startOffset.dy + dyPx / camera!.scale,
          };
        }
      }
      // Reparent-by-drop only applies to a single dragged node — dropping a
      // multi-node group onto one target would have to reparent every
      // selected node onto it at once, which risks ambiguous nesting and
      // cycles (e.g. a selected node being an ancestor of the target), so
      // group drags just reposition instead.
      dropTargetId = dragState.startOffsets.size === 1 ? findDropTargetId(e.clientX, e.clientY, dragState.id) : null;
      render();
    } else {
      camera = { ...dragState.startCamera, x: dragState.startCamera.x + dxPx, y: dragState.startCamera.y + dyPx };
      // Panning, like zooming, moves the camera and nothing else, so it gets
      // the same one-attribute fast path — see zoomAroundLive for why a full
      // render per event is worth avoiding. (No edit overlay can be up here:
      // pointerdown bails out while one is, so a pan never starts mid-edit.)
      if (!applyCamera(canvasEl, camera)) render();
    }
  });

  container.addEventListener("pointerup", () => {
    if (!dragState) return;
    // A node drag mutates the tree (offset, or a reparent), so it's one
    // undo step — but only if it actually moved. A plain click never
    // dispatches a pointermove, and recording it would bury real edits
    // under identical snapshots, so ⌘Z would appear to do nothing until
    // you'd pressed it once per intervening click.
    if (dragState.type === "node" && dragMoved) {
      if (dropTargetId) reparentNode(root, dragState.id, dropTargetId);
      commit();
    } else if (dragState.type === "node" && pendingDeselectId) {
      // A plain (non-dragging) shift+click on an already-selected node —
      // now it's safe to toggle it off without breaking a group drag.
      selectedIds.delete(pendingDeselectId);
      if (selectedId === pendingDeselectId) selectedId = [...selectedIds][0] ?? null;
    }
    pendingDeselectId = null;
    dragState = null;
    dragMoved = false;
    dropTargetId = null;
    render();
  });
  container.addEventListener("pointercancel", () => {
    pendingDeselectId = null;
    dragState = null;
    dragMoved = false;
    dropTargetId = null;
  });

  // Pastes an image from the clipboard onto the selected node. Container-
  // scoped like the pointer listeners above (not window), since paste
  // targets whichever element currently has focus, and container.focus()
  // is what this instance holds when active and not mid-edit.
  container.addEventListener("paste", (e) => {
    if (["INPUT", "TEXTAREA"].includes((e.target as HTMLElement).tagName)) return;
    if (!selectedId) return;
    const targetId = selectedId;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (!item.type.startsWith("image/")) continue;
      const file = item.getAsFile();
      if (!file) continue;
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          setImage(root, targetId, reader.result);
          commit();
          render();
        }
      };
      reader.readAsDataURL(file);
      break;
    }
  });

  // Multiplier applied to both wheel-driven and native pinch-gesture zoom
  // deltas so a pinch covers more zoom range per finger movement — plain
  // 1:1 tracking of the OS-reported deltas felt too slow.
  const PINCH_ZOOM_SENSITIVITY = 1.6;

  // Moves the camera so that the point at (anchorX, anchorY) in the *base*
  // camera (before this zoom) stays under that same screen point afterward.
  function cameraZoomedAround(
    baseCamera: Camera,
    targetScale: number,
    anchorX: number,
    anchorY: number,
  ): Camera {
    const scale = clamp(targetScale, ZOOM_MIN, ZOOM_MAX);
    const worldX = (anchorX - baseCamera.x) / baseCamera.scale;
    const worldY = (anchorY - baseCamera.y) / baseCamera.scale;
    return { scale, x: anchorX - worldX * scale, y: anchorY - worldY * scale };
  }

  // Discrete, one-shot zoom (toolbar buttons, ⌘= / ⌘-). One full render per
  // press is fine — there's no frame budget to hold to.
  function zoomAround(baseCamera: Camera, targetScale: number, anchorX: number, anchorY: number): void {
    camera = cameraZoomedAround(baseCamera, targetScale, anchorX, anchorY);
    render();
  }

  // Continuous zoom (trackpad pinch / wheel), where a full render per frame
  // is what made the gesture feel uneven. Zooming changes nothing about the
  // document — computeLayout's positions are world coordinates that don't
  // depend on scale — yet render() tears down the whole SVG and rebuilds
  // every node, re-measuring text through canvas and forcing a getBBox()
  // reflow. Measured on a 79-node map that's ~48ms typical and up to
  // ~180ms, versus ~0ms to rewrite the one transform attribute. The
  // accumulated deltas mean the *total* zoom came out right either way, but
  // an over-budget frame lets the next batch of wheel/gesture events pile
  // up, so each visible step jumped by however long the previous render
  // happened to take — hence "sometimes too much, sometimes not much".
  function zoomAroundLive(baseCamera: Camera, targetScale: number, anchorX: number, anchorY: number): void {
    camera = cameraZoomedAround(baseCamera, targetScale, anchorX, anchorY);
    // The inline edit overlays are HTML elements positioned in *screen*
    // coordinates derived from the camera, so they're the one thing the SVG
    // transform doesn't carry along — keep the full render while one is up.
    const isEditing = editingId || notesEditingId || iconEditingId || linkEditingId;
    if (isEditing || !applyCamera(canvasEl, camera)) render();
  }

  // Trackpad pinch on Chromium (incl. our own dev-server test target)
  // delivers ctrlKey wheel events at a much higher rate than the browser can
  // usefully re-render — same issue as WebKit's gesturechange below.
  // Rendering synchronously per event made this choppy, so deltas are
  // accumulated and applied as a single zoomAround once per animation
  // frame, relative to a base camera snapshotted at the start of that
  // batch (not the live `camera`, which the pending frame hasn't updated
  // yet — reading it mid-batch would silently drop the earlier deltas).
  let pendingWheelFrame: number | null = null;
  let wheelBaseCamera: Camera | null = null;
  let wheelAccumScale = 1;
  let wheelAnchorX = 0;
  let wheelAnchorY = 0;
  container.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      if (!camera) return;
      const rect = container.getBoundingClientRect();
      wheelAnchorX = e.clientX - rect.left;
      wheelAnchorY = e.clientY - rect.top;
      if (pendingWheelFrame === null) {
        wheelBaseCamera = camera;
        wheelAccumScale = 1;
      }
      wheelAccumScale *= Math.pow(1.0015, -wheelDeltaPixels(e, rect.height) * PINCH_ZOOM_SENSITIVITY);
      if (pendingWheelFrame === null) {
        pendingWheelFrame = requestAnimationFrame(() => {
          pendingWheelFrame = null;
          zoomAroundLive(wheelBaseCamera!, wheelBaseCamera!.scale * wheelAccumScale, wheelAnchorX, wheelAnchorY);
        });
      }
    },
    { passive: false },
  );

  // Safari/WKWebView (the real desktop app on macOS) reports trackpad pinch
  // as these WebKit-only gesture events, not as wheel events with ctrlKey
  // the way Chromium does — so pinch-to-zoom needs its own handler or it
  // silently does nothing (or triggers the webview's own native page zoom,
  // since nothing here would preventDefault it). `scale` on these events is
  // cumulative since gesturestart, not incremental, so the base camera is
  // snapshotted once at gesturestart and every gesturechange recomputes
  // from that same snapshot rather than compounding on the live camera.
  let gestureBaseCamera: Camera | null = null;
  // gesturechange fires far more often than the browser can usefully
  // re-render (much higher rate than wheel ticks) — rendering synchronously
  // on every single event is what made pinch feel choppy, since this app
  // rebuilds the whole SVG from scratch per render. Coalescing to at most
  // one render per animation frame fixes that without changing the math.
  let pendingGestureFrame: number | null = null;
  container.addEventListener("gesturestart", ((e: Event) => {
    e.preventDefault();
    gestureBaseCamera = camera ? { ...camera } : null;
  }) as EventListener);
  container.addEventListener("gesturechange", ((e: Event) => {
    e.preventDefault();
    const ge = e as unknown as { scale: number; clientX: number; clientY: number };
    const base = gestureBaseCamera;
    if (!base) return;
    const rect = container.getBoundingClientRect();
    const targetScale = base.scale * Math.pow(ge.scale, PINCH_ZOOM_SENSITIVITY);
    const anchorX = ge.clientX - rect.left;
    const anchorY = ge.clientY - rect.top;
    if (pendingGestureFrame !== null) cancelAnimationFrame(pendingGestureFrame);
    pendingGestureFrame = requestAnimationFrame(() => {
      pendingGestureFrame = null;
      zoomAroundLive(base, targetScale, anchorX, anchorY);
    });
  }) as EventListener);
  container.addEventListener("gestureend", ((e: Event) => {
    e.preventDefault();
    gestureBaseCamera = null;
  }) as EventListener);

  let lastRect = container.getBoundingClientRect();
  const onWindowResize = () => {
    if (!isActive) return;
    const rect = container.getBoundingClientRect();
    if (camera) {
      camera = {
        ...camera,
        x: camera.x + (rect.width - lastRect.width) / 2,
        y: camera.y + (rect.height - lastRect.height) / 2,
      };
    }
    lastRect = rect;
    render();
  };
  window.addEventListener("resize", onWindowResize);

  const onWindowKeyDown = (e: KeyboardEvent) => {
    if (!isActive) return;
    // Global safety net: Escape always exits editing, even if the edit
    // input itself never picked up focus for some reason.
    if (e.key === "Escape" && (editingId || notesEditingId || iconEditingId || linkEditingId)) {
      e.preventDefault();
      editingId = null;
      notesEditingId = null;
      iconEditingId = null;
      linkEditingId = null;
      render();
      container.focus();
      return;
    }

    const isEditingAnything = editingId || notesEditingId || iconEditingId || linkEditingId;
    const cmd = e.metaKey || e.ctrlKey;
    // While editing, do nothing at all here (crucially, no preventDefault)
    // so the input's own native undo handles text edits instead.
    if (cmd && e.key.toLowerCase() === "z" && !isEditingAnything) {
      e.preventDefault();
      if (e.shiftKey) performRedo();
      else performUndo();
      return;
    }
    if (cmd && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void performSave();
      return;
    }
    if (cmd && e.key.toLowerCase() === "o") {
      e.preventDefault();
      void performOpen();
      return;
    }
    if (cmd && e.key.toLowerCase() === "f" && !isEditingAnything) {
      e.preventDefault();
      searchBar.open();
      return;
    }
    if (cmd && (e.key === "=" || e.key === "+")) {
      e.preventDefault();
      performZoomBy(ZOOM_STEP);
      return;
    }
    if (cmd && e.key === "-") {
      e.preventDefault();
      performZoomBy(1 / ZOOM_STEP);
      return;
    }

    if (isEditingAnything) return;

    if (e.key === "n" || e.key === "i" || e.key === "l") {
      if (!selectedId) return;
      e.preventDefault();
      if (e.key === "n") notesEditingId = selectedId;
      else if (e.key === "i") iconEditingId = selectedId;
      else linkEditingId = selectedId;
      render();
    } else if (e.key === "t") {
      if (!selectedId) return;
      e.preventDefault();
      cycleStatus(root, selectedId);
      commit();
      render();
    } else if (e.key === "0") {
      e.preventDefault();
      performZoomToFit();
    } else if (e.key === "f") {
      e.preventDefault();
      toggleFocus();
    } else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      if (!selectedId) return;
      if (moveSibling(root, selectedId, e.key === "ArrowDown" ? 1 : -1)) {
        commit();
        render();
      }
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      if (!selectedId) {
        selectOnly(root.id);
        render();
        return;
      }
      const parent = findParent(root, selectedId);
      if (!parent) return;
      const siblings = parent.children;
      const index = siblings.findIndex((n) => n.id === selectedId);
      const nextIndex = clamp(index + (e.key === "ArrowDown" ? 1 : -1), 0, siblings.length - 1);
      selectOnly(siblings[nextIndex].id);
      render();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      if (!selectedId) return;
      const parent = findParent(root, selectedId);
      if (parent) {
        selectOnly(parent.id);
        render();
      }
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      const node = selectedId ? findNode(root, selectedId) : root;
      if (node && node.children.length > 0) {
        selectOnly(node.children[0].id);
        render();
      }
    } else if (e.key === "Tab") {
      e.preventDefault();
      const parent = selectedId ? (findNode(root, selectedId) ?? root) : root;
      const child = addChild(parent, "");
      commit();
      startEditing(child.id);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const parent = !selectedId || selectedId === root.id ? root : (findParent(root, selectedId) ?? root);
      const child = addChild(parent, "");
      commit();
      startEditing(child.id);
    } else if (e.key === "Delete" || e.key === "Backspace") {
      const targets = [...selectedIds].filter((id) => id !== root.id);
      if (targets.length === 0) return;
      e.preventDefault();
      if (targets.length === 1) {
        const parent = findParent(root, targets[0]);
        removeNode(root, targets[0]);
        commit();
        selectOnly(parent ? parent.id : null);
      } else {
        // Deleting an ancestor also removes its selected descendants, so a
        // later removeNode() call for one of those is a safe no-op.
        for (const id of targets) removeNode(root, id);
        commit();
        selectOnly(null);
      }
      render();
    }
  };
  window.addEventListener("keydown", onWindowKeyDown);

  render();
  container.focus();

  return {
    openRoot: loadRoot,
    setActive(active) {
      isActive = active;
      if (active) container.focus();
    },
    getTitle: () => root.text,
    forceRender: () => render(),
    destroy() {
      isActive = false;
      window.removeEventListener("resize", onWindowResize);
      window.removeEventListener("keydown", onWindowKeyDown);
    },
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// One text line's worth of scroll, for normalizing line-mode wheel deltas.
const WHEEL_LINE_HEIGHT = 16;

// Trackpads and Chromium-based webviews report wheel deltas in pixels, but a
// discrete mouse wheel can report lines (WebKitGTK) or pages instead, where
// one full notch is a single-digit deltaY. Taken as pixels that's a ~0.5%
// zoom step, i.e. a zoom that looks broken, so convert to pixels first.
function wheelDeltaPixels(e: WheelEvent, viewportHeight: number): number {
  if (e.deltaMode === WheelEvent.DOM_DELTA_LINE) return e.deltaY * WHEEL_LINE_HEIGHT;
  if (e.deltaMode === WheelEvent.DOM_DELTA_PAGE) return e.deltaY * viewportHeight;
  return e.deltaY;
}
