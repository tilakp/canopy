import type { MindMapNode } from "./model";
import { TEMPLATES } from "./templates";
import { FONT_OPTIONS } from "./fonts";

const SUN_ICON = `<svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="3" stroke="currentColor" stroke-width="1.5"/><path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
const MOON_ICON = `<svg viewBox="0 0 16 16" fill="none"><path d="M13.2 9.6A5.6 5.6 0 0 1 6.4 2.8a5.6 5.6 0 1 0 6.8 6.8Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
export const CLOSE_ICON = `<svg viewBox="0 0 16 16" fill="none"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;

export interface TabInfo {
  id: string;
  title: string;
  dirty: boolean;
}

export interface TabsCallbacks {
  onSwitch(id: string): void;
  onClose(id: string): void;
  onNew(root: MindMapNode): void;
  onToggleTheme(): void;
  onPickFont(fontId: string): void;
}

export interface TabsHandle {
  element: HTMLElement;
  update(tabs: TabInfo[], activeId: string, isDark: boolean, fontId: string): void;
}

export function createTabStrip(container: HTMLElement, callbacks: TabsCallbacks): TabsHandle {
  const el = document.createElement("div");
  el.className = "mm-tabstrip";

  const newBtn = document.createElement("button");
  newBtn.className = "mm-tab-new";
  newBtn.title = "New map";
  newBtn.textContent = "+";
  const templatePanel = document.createElement("div");
  templatePanel.className = "mm-popover";
  templatePanel.hidden = true;
  for (const template of TEMPLATES) {
    const item = document.createElement("button");
    item.className = "mm-popover-item";
    item.textContent = template.name;
    item.addEventListener("click", () => {
      templatePanel.hidden = true;
      callbacks.onNew(template.build());
    });
    templatePanel.appendChild(item);
  }
  // Positioned relative to `container` (not the "+" button itself): the tab
  // strip has `overflow-x: auto` for horizontal tab scrolling, which — per
  // the CSS overflow spec — makes the other axis clip too, so a popover
  // anchored *inside* the strip would be invisible below its bottom edge
  // despite not being `hidden`. `container` fills the viewport with no
  // offset, so the button's own viewport-relative rect doubles as its
  // container-relative position.
  newBtn.addEventListener("click", () => {
    if (templatePanel.hidden) {
      const rect = newBtn.getBoundingClientRect();
      templatePanel.style.left = `${rect.left + rect.width / 2}px`;
      templatePanel.style.top = `${rect.bottom + 6}px`;
    }
    templatePanel.hidden = !templatePanel.hidden;
  });
  container.appendChild(templatePanel);
  // Closes on a click anywhere outside it, or on Esc, like the toolbar's.
  container.addEventListener("pointerdown", (e) => {
    if (!templatePanel.contains(e.target as Node) && !newBtn.contains(e.target as Node)) templatePanel.hidden = true;
  });
  container.addEventListener("keydown", (e) => {
    if (e.key === "Escape") templatePanel.hidden = true;
  });

  const themeBtn = document.createElement("button");
  themeBtn.className = "mm-tab-new mm-tab-icon";
  themeBtn.addEventListener("click", () => callbacks.onToggleTheme());

  const fontSelect = document.createElement("select");
  fontSelect.className = "mm-font-select";
  fontSelect.title = "Font";
  for (const font of FONT_OPTIONS) {
    const option = document.createElement("option");
    option.value = font.id;
    option.textContent = font.label;
    fontSelect.appendChild(option);
  }
  fontSelect.addEventListener("change", () => callbacks.onPickFont(fontSelect.value));

  container.appendChild(el);

  return {
    element: el,
    update(tabs, activeId, isDark, fontId) {
      themeBtn.innerHTML = isDark ? SUN_ICON : MOON_ICON;
      themeBtn.title = isDark ? "Switch to light mode" : "Switch to dark mode";
      fontSelect.value = fontId;
      el.innerHTML = "";
      for (const tab of tabs) {
        const tabEl = document.createElement("div");
        tabEl.className = "mm-tab";
        tabEl.dataset.active = String(tab.id === activeId);
        tabEl.addEventListener("click", () => callbacks.onSwitch(tab.id));

        const title = document.createElement("span");
        title.className = "mm-tab-title";
        title.textContent = (tab.dirty ? "• " : "") + (tab.title || "Untitled");
        if (tab.dirty) title.title = "Unsaved changes";
        tabEl.appendChild(title);

        // Closing the last remaining tab is allowed (the workspace replaces
        // it with a fresh blank map) — always show the control.
        const closeBtn = document.createElement("button");
        closeBtn.className = "mm-tab-close";
        closeBtn.title = "Close map";
        closeBtn.innerHTML = CLOSE_ICON;
        closeBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          callbacks.onClose(tab.id);
        });
        tabEl.appendChild(closeBtn);

        el.appendChild(tabEl);
      }
      el.appendChild(newBtn);
      el.appendChild(fontSelect);
      el.appendChild(themeBtn);
    },
  };
}
