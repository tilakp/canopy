export interface TabInfo {
  id: string;
  title: string;
}

export interface TabsCallbacks {
  onSwitch(id: string): void;
  onClose(id: string): void;
  onNew(): void;
  onToggleTheme(): void;
}

export interface TabsHandle {
  element: HTMLElement;
  update(tabs: TabInfo[], activeId: string, isDark: boolean): void;
}

export function createTabStrip(container: HTMLElement, callbacks: TabsCallbacks): TabsHandle {
  const el = document.createElement("div");
  el.className = "mm-tabstrip";

  const newBtn = document.createElement("button");
  newBtn.className = "mm-tab-new";
  newBtn.title = "New map";
  newBtn.textContent = "+";
  newBtn.addEventListener("click", () => callbacks.onNew());

  const themeBtn = document.createElement("button");
  themeBtn.className = "mm-tab-new";
  themeBtn.addEventListener("click", () => callbacks.onToggleTheme());

  container.appendChild(el);

  return {
    element: el,
    update(tabs, activeId, isDark) {
      themeBtn.textContent = isDark ? "☀️" : "🌙";
      themeBtn.title = isDark ? "Switch to light mode" : "Switch to dark mode";
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
      el.appendChild(themeBtn);
    },
  };
}
