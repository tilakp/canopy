// The floating controls inside one map: the zoom control and help button
// in the bottom corners, and the toolbar next to the selected node. Their
// buttons run commands from the map's registry, so their labels and
// shortcuts are the commands' own.
import { attachPopover, swatchRow } from "./menu";
import { ICONS, iconButton } from "./icons";
import { PALETTE } from "./colors";
import { labelOf, shortcutOf, type CommandRegistry } from "./commands";

// A button that runs a command. A command whose label changes with the
// selection ("Mark as done") gets a fixed `label` here: a button keeps its
// name.
function commandButton(commands: CommandRegistry, id: string, icon: string, label?: string): HTMLButtonElement {
  const command = commands.get(id);
  return iconButton(icon, label ?? labelOf(command), shortcutOf(command), () => commands.run(id));
}

// Bottom-left: zoom out, the zoom level (click it to fit the map), zoom
// in. Bottom-right: the shortcut list.
export function createZoomControls(container: HTMLElement, commands: CommandRegistry): { update(scale: number): void } {
  const zoom = document.createElement("div");
  zoom.className = "mm-toolbar mm-zoom";
  const fit = commands.get("map.zoomToFit");
  const level = document.createElement("button");
  level.className = "mm-zoom-level";
  level.title = `${labelOf(fit)}  ${shortcutOf(fit)}`;
  level.addEventListener("click", () => commands.run(fit.id));
  zoom.append(commandButton(commands, "map.zoomOut", ICONS.minus), level, commandButton(commands, "map.zoomIn", ICONS.plus));

  const help = commandButton(commands, "help.shortcuts", ICONS.help);
  help.classList.add("mm-toolbar", "mm-help-btn");

  container.append(zoom, help);
  let shownScale = NaN;
  return {
    update(scale) {
      if (scale === shownScale) return;
      shownScale = scale;
      level.textContent = `${Math.round(scale * 100)}%`;
    },
  };
}

export interface NodeToolbarState {
  // The selected node's box in screen coordinates (canvas-relative).
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

export interface NodeToolbarOptions {
  commands: CommandRegistry;
  onPickColor(color: string, final: boolean): void;
  // Opens the node's full menu under the given button.
  onMore(anchor: DOMRect): void;
  signal: AbortSignal;
}

// A small toolbar next to the selected node with the actions for it, where
// the eye already is: to its right when nothing is there, else above it.
export function createNodeToolbar(
  container: HTMLElement,
  options: NodeToolbarOptions,
): { update(state: NodeToolbarState | null): void } {
  const { commands } = options;
  const el = document.createElement("div");
  el.className = "mm-toolbar mm-node-toolbar";
  el.setAttribute("role", "toolbar");
  el.setAttribute("aria-label", "Node actions");
  el.hidden = true;

  const colorBtn = iconButton("", "Branch color");
  colorBtn.classList.add("mm-color-btn");
  const colorDot = document.createElement("span");
  colorDot.className = "mm-color-dot";
  colorBtn.appendChild(colorDot);
  const colorPanel = document.createElement("div");
  colorPanel.classList.add("mm-color-panel");
  let activeColor: string | null = null;
  const colorPopover = attachPopover(container, colorBtn, colorPanel, {
    align: "center",
    signal: options.signal,
    onOpen() {
      colorPanel.replaceChildren(
        swatchRow({ swatches: PALETTE, active: activeColor, onPick: options.onPickColor }, () => colorPopover.close()),
      );
    },
  });

  const divider = document.createElement("span");
  divider.className = "mm-toolbar-divider";
  const more = iconButton(ICONS.more, "More actions", undefined, () => options.onMore(more.getBoundingClientRect()));
  el.append(
    colorBtn,
    divider,
    commandButton(commands, "node.addChild", ICONS.addChild),
    commandButton(commands, "node.notes", ICONS.notes),
    commandButton(commands, "node.link", ICONS.link),
    commandButton(commands, "node.icon", ICONS.emoji),
    commandButton(commands, "node.status", ICONS.status, "Checklist status"),
    more,
  );
  container.appendChild(el);

  // The toolbar's size, measured once per variant: reading it after each
  // move would force the browser to lay out the whole map again.
  const sizes = new Map<boolean, { width: number; height: number }>();
  const GAP = 10;
  const RIGHT_GAP = 40; // past the node's + button, which shows on hover
  const EDGE = 8;
  return {
    update(state) {
      if (!state) {
        el.hidden = true;
        colorPopover.close();
        return;
      }
      activeColor = state.color;
      colorBtn.style.display = divider.style.display = state.canColor ? "" : "none";
      colorDot.style.background = state.color ?? "";
      colorDot.dataset.mixed = String(state.canColor && state.color === null);
      el.hidden = false;
      let size = sizes.get(state.canColor);
      if (!size || size.width === 0) {
        size = { width: el.offsetWidth, height: el.offsetHeight || 40 };
        sizes.set(state.canColor, size);
      }
      const viewportWidth = container.clientWidth;
      const rightX = state.right + RIGHT_GAP;
      if (state.roomRight && rightX + size.width < viewportWidth - EDGE) {
        el.dataset.side = "right";
        el.style.left = `${rightX}px`;
        el.style.top = `${(state.top + state.bottom) / 2 - size.height / 2}px`;
        return;
      }
      // Above the node, or below it when there is no room above.
      el.dataset.side = "above";
      const centerX = (state.left + state.right) / 2;
      const half = size.width / 2;
      el.style.left = `${Math.max(half + EDGE, Math.min(centerX, viewportWidth - half - EDGE))}px`;
      const above = state.top - GAP - size.height;
      el.style.top = `${above > EDGE ? above : state.bottom + GAP}px`;
    },
  };
}
