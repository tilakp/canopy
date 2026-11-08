// Floating panels shared by the title bar, the node toolbar and the
// right-click menu: a popover that opens under (or over) a button, and a
// menu of actions that can go in one or open at the pointer.

export interface PopoverHandle {
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
}

export interface PopoverOptions {
  align: "start" | "center" | "end";
  // Fills or refreshes the panel just before it shows.
  onOpen?: () => void;
  // Ends the popover's document listeners, for a popover that belongs to a
  // map: without it a closed map stays in memory through them.
  signal?: AbortSignal;
}

// The panel goes in `host` with position: fixed, placed from the anchor's
// screen rect, not inside the anchor: the tab strip scrolls sideways, and
// overflow on one axis clips the other too, so a panel inside it would be
// cut off. It closes on a pointerdown outside the panel and the anchor, or
// on Escape.
export function attachPopover(
  host: HTMLElement,
  anchor: HTMLElement,
  panel: HTMLElement,
  { align, onOpen, signal }: PopoverOptions,
): PopoverHandle {
  panel.classList.add("mm-popover");
  panel.hidden = true;
  host.appendChild(panel);

  function place(): void {
    const rect = anchor.getBoundingClientRect();
    const gap = 6;
    panel.style.top = `${rect.bottom + gap}px`;
    panel.style.bottom = "";
    if (align === "start") panel.style.left = `${rect.left}px`;
    else if (align === "end") panel.style.left = `${rect.right}px`;
    else panel.style.left = `${rect.left + rect.width / 2}px`;
    panel.dataset.align = align;
    // No room below (a button near the bottom edge): open upward.
    const below = window.innerHeight - rect.bottom;
    if (below < panel.offsetHeight + gap * 2 && rect.top > below) {
      panel.style.top = "";
      panel.style.bottom = `${window.innerHeight - rect.top + gap}px`;
    }
  }

  const handle: PopoverHandle = {
    open() {
      onOpen?.();
      panel.hidden = false;
      anchor.setAttribute("aria-expanded", "true");
      place();
    },
    close() {
      panel.hidden = true;
      anchor.setAttribute("aria-expanded", "false");
    },
    toggle() {
      if (panel.hidden) handle.open();
      else handle.close();
    },
    isOpen: () => !panel.hidden,
  };
  anchor.setAttribute("aria-haspopup", "true");
  anchor.setAttribute("aria-expanded", "false");
  anchor.addEventListener("click", () => handle.toggle());
  document.addEventListener(
    "pointerdown",
    (e) => {
      const target = e.target as Node;
      if (!panel.hidden && !panel.contains(target) && !anchor.contains(target)) handle.close();
    },
    { capture: true, signal },
  );
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape" && !panel.hidden) {
        handle.close();
        e.stopPropagation();
      }
    },
    { signal },
  );
  return handle;
}

export interface MenuAction {
  label: string;
  shortcut?: string;
  run(): void;
  disabled?: boolean;
  danger?: boolean;
}

export interface MenuSwatches {
  swatches: string[];
  active: string | null;
  // `final` is false while the system color picker is being dragged (a
  // preview) and true for a pick that should be kept as one undo step.
  onPick(color: string, final: boolean): void;
}

export type MenuEntry = MenuAction | MenuSwatches | "separator";

// Fills `panel` with the entries. `close` runs after an action is chosen.
export function fillMenu(panel: HTMLElement, entries: MenuEntry[], close: () => void): void {
  panel.innerHTML = "";
  panel.setAttribute("role", "menu");
  for (const entry of entries) {
    if (entry === "separator") {
      const sep = document.createElement("div");
      sep.className = "mm-menu-sep";
      sep.setAttribute("role", "separator");
      panel.appendChild(sep);
    } else if ("swatches" in entry) {
      panel.appendChild(swatchRow(entry, close));
    } else {
      const item = document.createElement("button");
      item.className = `mm-menu-item${entry.danger ? " mm-menu-danger" : ""}`;
      item.setAttribute("role", "menuitem");
      item.disabled = !!entry.disabled;
      const label = document.createElement("span");
      label.textContent = entry.label;
      item.appendChild(label);
      if (entry.shortcut) {
        const key = document.createElement("span");
        key.className = "mm-menu-key";
        key.textContent = entry.shortcut;
        item.appendChild(key);
      }
      item.addEventListener("click", () => {
        close();
        entry.run();
      });
      panel.appendChild(item);
    }
  }
}

export function swatchRow(entry: MenuSwatches, close: () => void): HTMLElement {
  const row = document.createElement("div");
  row.className = "mm-swatch-row";
  row.setAttribute("aria-label", "Branch color");
  for (const color of entry.swatches) {
    const btn = document.createElement("button");
    btn.className = "mm-swatch";
    btn.style.background = color;
    btn.title = "Set branch color";
    btn.setAttribute("aria-label", `Branch color ${color}`);
    btn.dataset.active = String(color.toLowerCase() === entry.active?.toLowerCase());
    btn.addEventListener("click", () => {
      close();
      entry.onPick(color, true);
    });
    row.appendChild(btn);
  }
  // The presets can't cover every taste: this opens the system color picker.
  const custom = document.createElement("label");
  custom.className = "mm-swatch mm-swatch-custom";
  custom.title = "Custom branch color…";
  const isCustom = entry.active !== null && !entry.swatches.some((c) => c.toLowerCase() === entry.active!.toLowerCase());
  custom.dataset.active = String(isCustom);
  const input = document.createElement("input");
  input.type = "color";
  input.setAttribute("aria-label", "Custom branch color");
  if (entry.active) input.value = entry.active;
  input.addEventListener("input", () => entry.onPick(input.value, false));
  input.addEventListener("change", () => entry.onPick(input.value, true));
  custom.appendChild(input);
  row.appendChild(custom);
  return row;
}

// Arrow keys move between a menu's items, as in a native menu.
export function moveMenuFocus(panel: HTMLElement, e: KeyboardEvent): void {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  const items = [...panel.querySelectorAll<HTMLButtonElement>(".mm-menu-item:not(:disabled)")];
  if (items.length === 0) return;
  e.preventDefault();
  const index = items.indexOf(document.activeElement as HTMLButtonElement);
  const next = e.key === "ArrowDown" ? index + 1 : index - 1;
  items[(next + items.length) % items.length].focus();
}

// A menu at the pointer (right-click), kept inside the window.
export interface ContextMenu {
  show(x: number, y: number, entries: MenuEntry[]): void;
  close(): void;
  isOpen(): boolean;
}

export function createContextMenu(host: HTMLElement, signal?: AbortSignal): ContextMenu {
  const panel = document.createElement("div");
  panel.className = "mm-popover mm-context-menu";
  panel.hidden = true;
  host.appendChild(panel);
  const close = () => (panel.hidden = true);
  panel.addEventListener("keydown", (e) => {
    moveMenuFocus(panel, e);
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
      host.focus();
    }
  });
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (!panel.hidden && !panel.contains(e.target as Node)) close();
    },
    { capture: true, signal },
  );
  return {
    show(x, y, entries) {
      fillMenu(panel, entries, close);
      panel.hidden = false;
      const margin = 8;
      const left = Math.min(x, window.innerWidth - panel.offsetWidth - margin);
      const top = y + panel.offsetHeight + margin > window.innerHeight ? Math.max(margin, y - panel.offsetHeight) : y;
      panel.style.left = `${Math.max(margin, left)}px`;
      panel.style.top = `${top}px`;
      panel.querySelector<HTMLButtonElement>(".mm-menu-item:not(:disabled)")?.focus();
    },
    close,
    isOpen: () => !panel.hidden,
  };
}
