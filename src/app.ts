import { addChild, findNode, findParent, removeNode, updateText, type MindMapNode } from "./model";
import { renderMindMap, type Camera } from "./render";

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
  let camera: Camera | undefined;
  let dragState: DragState = null;
  let lastClick: { id: string; time: number; x: number; y: number } | null = null;

  // Without a focused, focusable element, WKWebView's native tab-navigation
  // can intercept the Tab key before it reaches the DOM as a keydown event.
  // Keeping the container focused (except while an edit input is up) avoids
  // that.
  container.tabIndex = -1;

  function render(): void {
    const result = renderMindMap(
      container,
      root,
      { selectedId, editingId, camera },
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
  }

  function startEditing(id: string): void {
    selectedId = id;
    editingId = id;
    render();
  }

  container.addEventListener("pointerdown", (e) => {
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    container.focus();
    if (editingId) return;

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
    container.setPointerCapture?.(e.pointerId);
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
