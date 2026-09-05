import type { EdgeStyle } from "./render";

export const BRANCH_COLORS = ["#4C6EF5", "#12B886", "#F59F00", "#E64980", "#7048E8", "#15AABF", "#82C91E"];

export interface ToolbarCallbacks {
  onPickColor(color: string): void;
  onPickEdgeStyle(style: EdgeStyle): void;
  onUndo(): void;
  onRedo(): void;
  onSave(): void;
  onOpen(): void;
  onTidy(): void;
  onZoomToFit(): void;
  onZoomIn(): void;
  onZoomOut(): void;
  onExport(): void;
}

export interface ToolbarHandle {
  element: HTMLElement;
  update(state: {
    hasSelection: boolean;
    activeColor: string | null;
    edgeStyle: EdgeStyle;
    canUndo: boolean;
    canRedo: boolean;
  }): void;
}

const CURVED_ICON = `<svg viewBox="0 0 16 16" fill="none"><path d="M2 13c0-6 4-6 6-8s4-2 6-2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
const STRAIGHT_ICON = `<svg viewBox="0 0 16 16" fill="none"><path d="M2 13 H8 V3 H14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const UNDO_ICON = `<svg viewBox="0 0 16 16" fill="none"><path d="M6 3 L3 6 L6 9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 6 H10a3 3 0 0 1 0 6H7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const REDO_ICON = `<svg viewBox="0 0 16 16" fill="none"><path d="M10 3 L13 6 L10 9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M13 6 H6a3 3 0 0 0 0 6h3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const SAVE_ICON = `<svg viewBox="0 0 16 16" fill="none"><path d="M3 2 H11.5 L13.5 4 V13 A1 1 0 0 1 12.5 14 H3 A1 1 0 0 1 2 13 V3 A1 1 0 0 1 3 2 Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M4.5 2 V6 H10 V2" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><rect x="4.8" y="9" width="6.2" height="4" stroke="currentColor" stroke-width="1.6"/></svg>`;
const OPEN_ICON = `<svg viewBox="0 0 16 16" fill="none"><path d="M2 4.5 A1 1 0 0 1 3 3.5 H6.2 L7.6 5 H13 A1 1 0 0 1 14 6 V12 A1 1 0 0 1 13 13 H3 A1 1 0 0 1 2 12 Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
const TIDY_ICON = `<svg viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.6"/><rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.6"/><rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.6"/><rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.6"/></svg>`;
const ZOOM_FIT_ICON = `<svg viewBox="0 0 16 16" fill="none"><path d="M2 6 V2.8 A0.8 0.8 0 0 1 2.8 2 H6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M10 2 H13.2 A0.8 0.8 0 0 1 14 2.8 V6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M14 10 V13.2 A0.8 0.8 0 0 1 13.2 14 H10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M6 14 H2.8 A0.8 0.8 0 0 1 2 13.2 V10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
const EXPORT_ICON = `<svg viewBox="0 0 16 16" fill="none"><path d="M8 10 V2 M8 2 L5 5 M8 2 L11 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 11 V13 A1 1 0 0 0 4 14 H12 A1 1 0 0 0 13 13 V11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ZOOM_IN_ICON = `<svg viewBox="0 0 16 16" fill="none"><circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" stroke-width="1.6"/><path d="M9.7 9.7 L13.5 13.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M6.5 4.3 V8.7 M4.3 6.5 H8.7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`;
const ZOOM_OUT_ICON = `<svg viewBox="0 0 16 16" fill="none"><circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" stroke-width="1.6"/><path d="M9.7 9.7 L13.5 13.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M4.3 6.5 H8.7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`;

function makeIconButton(icon: string, title: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = "mm-edge-btn";
  btn.title = title;
  btn.innerHTML = icon;
  btn.addEventListener("click", onClick);
  return btn;
}

export function createToolbar(container: HTMLElement, callbacks: ToolbarCallbacks): ToolbarHandle {
  const el = document.createElement("div");
  el.className = "mm-toolbar";

  const fileGroup = document.createElement("div");
  fileGroup.className = "mm-toolbar-group";
  const openBtn = makeIconButton(OPEN_ICON, "Open… (⌘O)", callbacks.onOpen);
  const saveBtn = makeIconButton(SAVE_ICON, "Save (⌘S)", callbacks.onSave);
  const exportBtn = makeIconButton(EXPORT_ICON, "Export as PNG, SVG, or Markdown…", callbacks.onExport);
  fileGroup.appendChild(openBtn);
  fileGroup.appendChild(saveBtn);
  fileGroup.appendChild(exportBtn);

  const historyGroup = document.createElement("div");
  historyGroup.className = "mm-toolbar-group";
  const undoBtn = makeIconButton(UNDO_ICON, "Undo (⌘Z)", callbacks.onUndo);
  const redoBtn = makeIconButton(REDO_ICON, "Redo (⌘⇧Z)", callbacks.onRedo);
  historyGroup.appendChild(undoBtn);
  historyGroup.appendChild(redoBtn);

  const colorGroup = document.createElement("div");
  colorGroup.className = "mm-toolbar-group";
  const swatchButtons = BRANCH_COLORS.map((color) => {
    const btn = document.createElement("button");
    btn.className = "mm-swatch";
    btn.style.background = color;
    btn.title = "Set branch color";
    btn.addEventListener("click", () => callbacks.onPickColor(color));
    colorGroup.appendChild(btn);
    return { color, btn };
  });

  const edgeGroup = document.createElement("div");
  edgeGroup.className = "mm-toolbar-group";
  const curvedBtn = makeIconButton(CURVED_ICON, "Curved edges", () => callbacks.onPickEdgeStyle("curved"));
  const straightBtn = makeIconButton(STRAIGHT_ICON, "Straight edges", () => callbacks.onPickEdgeStyle("straight"));
  edgeGroup.appendChild(curvedBtn);
  edgeGroup.appendChild(straightBtn);

  const tidyGroup = document.createElement("div");
  tidyGroup.className = "mm-toolbar-group";
  const tidyBtn = makeIconButton(TIDY_ICON, "Tidy up layout", callbacks.onTidy);
  const zoomOutBtn = makeIconButton(ZOOM_OUT_ICON, "Zoom out (⌘−)", callbacks.onZoomOut);
  const zoomInBtn = makeIconButton(ZOOM_IN_ICON, "Zoom in (⌘=)", callbacks.onZoomIn);
  const zoomFitBtn = makeIconButton(ZOOM_FIT_ICON, "Zoom to fit (0)", callbacks.onZoomToFit);
  tidyGroup.appendChild(tidyBtn);
  tidyGroup.appendChild(zoomOutBtn);
  tidyGroup.appendChild(zoomInBtn);
  tidyGroup.appendChild(zoomFitBtn);

  function divider(): HTMLElement {
    const d = document.createElement("div");
    d.className = "mm-toolbar-divider";
    return d;
  }

  el.appendChild(fileGroup);
  el.appendChild(divider());
  el.appendChild(historyGroup);
  el.appendChild(divider());
  el.appendChild(colorGroup);
  el.appendChild(divider());
  el.appendChild(edgeGroup);
  el.appendChild(divider());
  el.appendChild(tidyGroup);
  container.appendChild(el);

  return {
    element: el,
    update({ hasSelection, activeColor, edgeStyle, canUndo, canRedo }) {
      el.dataset.disabled = String(!hasSelection);
      for (const { color, btn } of swatchButtons) {
        btn.dataset.active = String(color === activeColor);
      }
      curvedBtn.dataset.active = String(edgeStyle === "curved");
      straightBtn.dataset.active = String(edgeStyle === "straight");
      undoBtn.disabled = !canUndo;
      redoBtn.disabled = !canRedo;
    },
  };
}
