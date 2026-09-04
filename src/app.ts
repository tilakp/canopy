import { addChild, findNode, findParent, removeNode, updateText, type MindMapNode } from "./model";
import { renderMindMap, type Camera } from "./render";

const ZOOM_MIN = 0.2;
const ZOOM_MAX = 3;

type DragState =
  | { type: "node"; id: string; startX: number; startY: number; startOffset: { dx: number; dy: number } }
  | { type: "pan"; startX: number; startY: number; startCamera: Camera }
  | null;

export function startApp(container: HTMLElement, root: MindMapNode): void {
  let selectedId: string | null = null;
  let editingId: string | null = null;
  let camera: Camera | undefined;
  let dragState: DragState = null;

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
        },
        onEditCancel() {
          editingId = null;
          render();
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
    if (editingId) return;

    const nodeEl = (e.target as Element).closest<HTMLElement>("[data-node-id]");
    if (nodeEl) {
      const id = nodeEl.dataset.nodeId!;
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
      selectedId = null;
      dragState = { type: "pan", startX: e.clientX, startY: e.clientY, startCamera: { ...camera! } };
      render();
    }
    container.setPointerCapture(e.pointerId);
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

  container.addEventListener("dblclick", (e) => {
    const nodeEl = (e.target as Element).closest<HTMLElement>("[data-node-id]");
    if (!nodeEl) return;
    dragState = null;
    startEditing(nodeEl.dataset.nodeId!);
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
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
