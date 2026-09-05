import type { EdgeStyle } from "./render";

export const BRANCH_COLORS = ["#4C6EF5", "#12B886", "#F59F00", "#E64980", "#7048E8", "#15AABF", "#82C91E"];

export interface ToolbarCallbacks {
  onPickColor(color: string): void;
  onPickEdgeStyle(style: EdgeStyle): void;
}

export interface ToolbarHandle {
  element: HTMLElement;
  update(state: { hasSelection: boolean; activeColor: string | null; edgeStyle: EdgeStyle }): void;
}

const CURVED_ICON = `<svg viewBox="0 0 16 16" fill="none"><path d="M2 13c0-6 4-6 6-8s4-2 6-2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
const STRAIGHT_ICON = `<svg viewBox="0 0 16 16" fill="none"><path d="M2 13 H8 V3 H14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export function createToolbar(container: HTMLElement, callbacks: ToolbarCallbacks): ToolbarHandle {
  const el = document.createElement("div");
  el.className = "mm-toolbar";

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

  const divider = document.createElement("div");
  divider.className = "mm-toolbar-divider";

  const edgeGroup = document.createElement("div");
  edgeGroup.className = "mm-toolbar-group";
  const curvedBtn = document.createElement("button");
  curvedBtn.className = "mm-edge-btn";
  curvedBtn.title = "Curved edges";
  curvedBtn.innerHTML = CURVED_ICON;
  curvedBtn.addEventListener("click", () => callbacks.onPickEdgeStyle("curved"));

  const straightBtn = document.createElement("button");
  straightBtn.className = "mm-edge-btn";
  straightBtn.title = "Straight edges";
  straightBtn.innerHTML = STRAIGHT_ICON;
  straightBtn.addEventListener("click", () => callbacks.onPickEdgeStyle("straight"));

  edgeGroup.appendChild(curvedBtn);
  edgeGroup.appendChild(straightBtn);

  el.appendChild(colorGroup);
  el.appendChild(divider);
  el.appendChild(edgeGroup);
  container.appendChild(el);

  return {
    element: el,
    update({ hasSelection, activeColor, edgeStyle }) {
      el.dataset.disabled = String(!hasSelection);
      for (const { color, btn } of swatchButtons) {
        btn.dataset.active = String(color === activeColor);
      }
      curvedBtn.dataset.active = String(edgeStyle === "curved");
      straightBtn.dataset.active = String(edgeStyle === "straight");
    },
  };
}
