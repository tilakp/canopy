import type { MindMapNode } from "./model";
import { TEMPLATES } from "./templates";
import { FONT_OPTIONS } from "./fonts";

export interface TabInfo {
  id: string;
  title: string;
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

  const themeBtn = document.createElement("button");
  themeBtn.className = "mm-tab-new";
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
      themeBtn.textContent = isDark ? "☀️" : "🌙";
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
        title.textContent = tab.title || "Untitled";
        tabEl.appendChild(title);

        // Closing the last remaining tab is allowed (the workspace replaces
        // it with a fresh blank map) — always show the control.
        const closeBtn = document.createElement("button");
        closeBtn.className = "mm-tab-close";
        closeBtn.title = "Close map";
        closeBtn.textContent = "×";
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
