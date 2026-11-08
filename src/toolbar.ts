import { attachPopover, swatchRow } from "./menu";
import { ICONS } from "./icons";

// The branch color presets, the same hues as layout.ts's PALETTE.
export const BRANCH_COLORS = ["#4F6BED", "#12A383", "#E8890C", "#D6457A", "#7A4FE0", "#1497AE", "#5E9E2B"];

function iconButton(icon: string, label: string, shortcut: string | null, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = "mm-icon-btn";
  btn.innerHTML = icon;
  btn.setAttribute("aria-label", label);
  btn.title = shortcut ? `${label}  ${shortcut}` : label;
  btn.addEventListener("click", onClick);
  return btn;
}

export interface ZoomCallbacks {
  onZoomIn(): void;
  onZoomOut(): void;
  onZoomToFit(): void;
  onToggleHelp(): void;
}

// Bottom-left: zoom out, the zoom level (click it to fit the map), zoom
// in. Bottom-right: the shortcut list.
export function createZoomControls(container: HTMLElement, callbacks: ZoomCallbacks): { update(scale: number): void } {
  const zoom = document.createElement("div");
  zoom.className = "mm-toolbar mm-zoom";
  const level = document.createElement("button");
  level.className = "mm-zoom-level";
  level.title = "Zoom to fit  0";
  level.addEventListener("click", callbacks.onZoomToFit);
  zoom.append(
    iconButton(ICONS.minus, "Zoom out", "⌘−", callbacks.onZoomOut),
    level,
    iconButton(ICONS.plus, "Zoom in", "⌘=", callbacks.onZoomIn),
  );

  const help = iconButton(ICONS.help, "Keyboard shortcuts", "?", callbacks.onToggleHelp);
  help.classList.add("mm-toolbar", "mm-help-btn");

  container.append(zoom, help);
  return {
    update(scale) {
      level.textContent = `${Math.round(scale * 100)}%`;
    },
  };
}

export interface NodeToolbarCallbacks {
  onPickColor(color: string): void;
  onAddChild(): void;
  onNotes(): void;
  onLink(): void;
  onIcon(): void;
  onStatus(): void;
  // Opens the node's full menu, under the given button.
  onMore(anchor: DOMRect): void;
}

export interface NodeToolbarState {
  // The selected node's box in screen coordinates (container-relative).
  left: number;
  right: number;
  top: number;
  bottom: number;
  // The selection's shared branch color, or null when mixed or the root.
  color: string | null;
  canColor: boolean;
  // Nothing is drawn to the right of the node (it has no children), so the
  // toolbar can go there without covering other nodes.
  roomRight: boolean;
}

// A small toolbar that floats next to the selected node with the actions
// for it, so they are where the eye already is: to its right when nothing
// is there, else above it.
export function createNodeToolbar(
  container: HTMLElement,
  callbacks: NodeToolbarCallbacks,
): { update(state: NodeToolbarState | null): void } {
  const el = document.createElement("div");
  el.className = "mm-toolbar mm-node-toolbar";
  el.setAttribute("role", "toolbar");
  el.setAttribute("aria-label", "Node actions");
  el.hidden = true;

  const colorBtn = document.createElement("button");
  colorBtn.className = "mm-icon-btn mm-color-btn";
  colorBtn.title = "Branch color";
  colorBtn.setAttribute("aria-label", "Branch color");
  const colorDot = document.createElement("span");
  colorDot.className = "mm-color-dot";
  colorBtn.appendChild(colorDot);
  const colorPanel = document.createElement("div");
  colorPanel.classList.add("mm-color-panel");
  let activeColor: string | null = null;
  const colorPopover = attachPopover(container, colorBtn, colorPanel, "center", () => {
    colorPanel.innerHTML = "";
    colorPanel.appendChild(
      swatchRow({ swatches: BRANCH_COLORS, active: activeColor, onPick: callbacks.onPickColor }, () =>
        colorPopover.close(),
      ),
    );
  });

  const divider = document.createElement("span");
  divider.className = "mm-toolbar-divider";

  const more = iconButton(ICONS.more, "More actions", null, () => callbacks.onMore(more.getBoundingClientRect()));
  el.append(
    colorBtn,
    divider,
    iconButton(ICONS.addChild, "Add child", "Tab", callbacks.onAddChild),
    iconButton(ICONS.notes, "Notes", "N", callbacks.onNotes),
    iconButton(ICONS.link, "Link", "L", callbacks.onLink),
    iconButton(ICONS.emoji, "Icon", "I", callbacks.onIcon),
    iconButton(ICONS.status, "Checklist status", "T", callbacks.onStatus),
    more,
  );
  container.appendChild(el);

  const GAP = 10;
  const RIGHT_GAP = 40;
  const TOP_LIMIT = 8;
  return {
    update(state) {
      if (!state) {
        el.hidden = true;
        colorPopover.close();
        return;
      }
      activeColor = state.color;
      colorBtn.disabled = !state.canColor;
      colorBtn.style.display = state.canColor ? "" : "none";
      divider.style.display = state.canColor ? "" : "none";
      colorDot.style.background = state.color ?? "";
      colorDot.dataset.mixed = String(state.canColor && state.color === null);
      el.hidden = false;
      const height = el.offsetHeight || 40;
      const width = el.offsetWidth || 260;
      // Past the node's + button, which shows on hover.
      const rightX = state.right + RIGHT_GAP;
      if (state.roomRight && rightX + width < container.clientWidth - 8) {
        el.style.left = `${rightX}px`;
        el.style.top = `${(state.top + state.bottom) / 2 - height / 2}px`;
        el.dataset.side = "right";
        return;
      }
      // Above the node, or below it when there is no room above.
      el.dataset.side = "above";
      const centerX = (state.left + state.right) / 2;
      const maxLeft = container.clientWidth - width / 2 - 8;
      el.style.left = `${Math.max(width / 2 + 8, Math.min(centerX, maxLeft || centerX))}px`;
      if (state.top - GAP - height > TOP_LIMIT) {
        el.style.top = `${state.top - GAP - height}px`;
      } else {
        el.style.top = `${state.bottom + GAP}px`;
      }
    },
  };
}
