import {
  addChild,
  clearOffsets,
  findNode,
  findParent,
  moveSibling,
  removeNode,
  reparentNode,
  setColor,
  setIcon,
  setLink,
  setNotes,
  toggleCollapsed,
  updateText,
  type MindMapNode,
} from "./model";
import { renderMindMap, computeFitCamera, applyCamera, type Camera, type EdgeStyle } from "./render";
import { createToolbar } from "./toolbar";
import { createHistory } from "./history";
import { saveToFile, loadFromFile } from "./persistence";
import { openLink } from "./links";
import { exportMap } from "./exportFile";

const ZOOM_MIN = 0.2;
const ZOOM_MAX = 3;
// macOS's double-click speed preference can be slower than a hardcoded
// "fast" guess, and real clicks never land on the exact same pixel twice.
const DOUBLE_CLICK_MS = 600;
const DOUBLE_CLICK_PX = 12;

type DragState =
  | { type: "node"; id: string; startX: number; startY: number; startOffset: { dx: number; dy: number } }
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
  let editingId: string | null = null;
  let notesEditingId: string | null = null;
  let iconEditingId: string | null = null;
  let linkEditingId: string | null = null;
  let edgeStyle: EdgeStyle = "curved";
  let camera: Camera | undefined;
  let dragState: DragState = null;
  let dragMoved = false;
  let lastClick: { id: string; time: number; x: number; y: number } | null = null;
  let filePath: string | null = initialFilePath;
  let lastContentBBox = new DOMRect();
  let dropTargetId: string | null = null;

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
      if (!selectedId || selectedId === root.id) return;
      setColor(root, selectedId, color);
      commit();
      render();
    },
    onPickEdgeStyle(style) {
      edgeStyle = style;
      render();
    },
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
  });

  function render(): void {
    const result = renderMindMap(
      canvasEl,
      root,
      { selectedId, editingId, notesEditingId, iconEditingId, linkEditingId, edgeStyle, camera, dropTargetId },
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

    const hasSelection = selectedId !== null && selectedId !== root.id;
    toolbar.update({
      hasSelection,
      activeColor: hasSelection ? (result.positions.get(selectedId!)?.color ?? null) : null,
      edgeStyle,
      canUndo: history.canUndo(),
      canRedo: history.canRedo(),
    });
    onChange?.();
  }

  function startEditing(id: string): void {
    selectedId = id;
    editingId = id;
    render();
  }

  function loadRoot(newRoot: MindMapNode, path: string | null): void {
    root = newRoot;
    filePath = path;
    selectedId = null;
    editingId = null;
    camera = undefined;
    dragState = null;
    history.push(structuredClone(root));
    render();
  }

  async function performSave(): Promise<void> {
    const savedPath = await saveToFile(root, filePath);
    if (savedPath) filePath = savedPath;
  }

  async function performOpen(): Promise<void> {
    // A file that can't be read, or whose JSON isn't a mind map, must leave
    // the current document alone rather than half-replacing it.
    const result = await loadFromFile().catch(() => null);
    if (result) loadRoot(result.root, result.path);
  }

  async function performExport(): Promise<void> {
    const svgEl = canvasEl.querySelector<SVGSVGElement>("svg.mm-canvas");
    if (!svgEl) return;
    await exportMap(root, svgEl, lastContentBBox);
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
    selectedId = null;
    editingId = null;
    render();
  }

  function performRedo(): void {
    const snapshot = history.redo();
    if (!snapshot) return;
    root = structuredClone(snapshot);
    selectedId = null;
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

      selectedId = id;
      if (id !== root.id) {
        const node = findNode(root, id)!;
        dragState = {
          type: "node",
          id,
          startX: e.clientX,
          startY: e.clientY,
          startOffset: { ...(node.offset ?? { dx: 0, dy: 0 }) },
        };
      }
      render();
    } else {
      lastClick = null;
      selectedId = null;
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
      const node = findNode(root, dragState.id)!;
      node.offset = {
        dx: dragState.startOffset.dx + dxPx / camera!.scale,
        dy: dragState.startOffset.dy + dyPx / camera!.scale,
      };
      dropTargetId = findDropTargetId(e.clientX, e.clientY, dragState.id);
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
    }
    dragState = null;
    dragMoved = false;
    dropTargetId = null;
    render();
  });
  container.addEventListener("pointercancel", () => {
    dragState = null;
    dragMoved = false;
    dropTargetId = null;
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
    } else if (e.key === "0") {
      e.preventDefault();
      performZoomToFit();
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
        selectedId = root.id;
        render();
        return;
      }
      const parent = findParent(root, selectedId);
      if (!parent) return;
      const siblings = parent.children;
      const index = siblings.findIndex((n) => n.id === selectedId);
      const nextIndex = clamp(index + (e.key === "ArrowDown" ? 1 : -1), 0, siblings.length - 1);
      selectedId = siblings[nextIndex].id;
      render();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      if (!selectedId) return;
      const parent = findParent(root, selectedId);
      if (parent) {
        selectedId = parent.id;
        render();
      }
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      const node = selectedId ? findNode(root, selectedId) : root;
      if (node && node.children.length > 0) {
        selectedId = node.children[0].id;
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
      if (!selectedId || selectedId === root.id) return;
      e.preventDefault();
      const parent = findParent(root, selectedId);
      removeNode(root, selectedId);
      commit();
      selectedId = parent ? parent.id : null;
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
