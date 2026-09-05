import {
  addChild,
  findNode,
  findParent,
  removeNode,
  setColor,
  updateText,
  type MindMapNode,
} from "./model";
import { renderMindMap, type Camera, type EdgeStyle } from "./render";
import { createToolbar } from "./toolbar";

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

export function startApp(container: HTMLElement, root: MindMapNode): void {
  let selectedId: string | null = null;
  let editingId: string | null = null;
  let edgeStyle: EdgeStyle = "curved";
  let camera: Camera | undefined;
  let dragState: DragState = null;
  let lastClick: { id: string; time: number; x: number; y: number } | null = null;

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
      render();
    },
    onPickEdgeStyle(style) {
      edgeStyle = style;
      render();
    },
  });

  function render(): void {
    const result = renderMindMap(
      canvasEl,
      root,
      { selectedId, editingId, edgeStyle, camera },
      {
        onEditCommit(id, text) {
          updateText(root, id, text.trim() || "Untitled");
          editingId = null;
          render();
          container.focus();
        },
        onEditCancel() {
          editingId = null;
          render();
          container.focus();
        },
      },
    );
    camera = result.camera;

    const hasSelection = selectedId !== null && selectedId !== root.id;
    toolbar.update({
      hasSelection,
      activeColor: hasSelection ? (result.positions.get(selectedId!)?.color ?? null) : null,
      edgeStyle,
    });
  }

  function startEditing(id: string): void {
    selectedId = id;
    editingId = id;
    render();
  }

  container.addEventListener("pointerdown", (e) => {
    if ((e.target as HTMLElement).tagName === "INPUT") return;
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
    if (editingId) return;

    const addBtn = (e.target as Element).closest(".mm-add-btn");
    if (addBtn) {
      const parentId = addBtn.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId;
      if (parentId) {
        const parent = findNode(root, parentId)!;
        startEditing(addChild(parent, "").id);
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
      const node = findNode(root, dragState.id)!;
      node.offset = {
        dx: dragState.startOffset.dx + dxPx / camera!.scale,
        dy: dragState.startOffset.dy + dyPx / camera!.scale,
      };
    } else {
      camera = { ...dragState.startCamera, x: dragState.startCamera.x + dxPx, y: dragState.startCamera.y + dyPx };
    }
    render();
  });

  container.addEventListener("pointerup", () => {
    dragState = null;
  });
  container.addEventListener("pointercancel", () => {
    dragState = null;
  });

  container.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      if (!camera) return;
      const rect = container.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;
      const worldX = (cursorX - camera.x) / camera.scale;
      const worldY = (cursorY - camera.y) / camera.scale;
      const scale = clamp(camera.scale * Math.pow(1.0015, -e.deltaY), ZOOM_MIN, ZOOM_MAX);
      camera = { scale, x: cursorX - worldX * scale, y: cursorY - worldY * scale };
      render();
    },
    { passive: false },
  );

  let lastRect = container.getBoundingClientRect();
  window.addEventListener("resize", () => {
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
  });

  window.addEventListener("keydown", (e) => {
    // Global safety net: Escape always exits editing, even if the edit
    // input itself never picked up focus for some reason.
    if (e.key === "Escape" && editingId) {
      e.preventDefault();
      editingId = null;
      render();
      container.focus();
      return;
    }
    if (editingId) return;

    if (e.key === "Tab") {
      e.preventDefault();
      const parent = selectedId ? (findNode(root, selectedId) ?? root) : root;
      startEditing(addChild(parent, "").id);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (!selectedId || selectedId === root.id) {
        startEditing(addChild(root, "").id);
      } else {
        const parent = findParent(root, selectedId) ?? root;
        startEditing(addChild(parent, "").id);
      }
    } else if (e.key === "Delete" || e.key === "Backspace") {
      if (!selectedId || selectedId === root.id) return;
      e.preventDefault();
      const parent = findParent(root, selectedId);
      removeNode(root, selectedId);
      selectedId = parent ? parent.id : null;
      render();
    }
  });

  render();
  container.focus();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
