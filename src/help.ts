export interface HelpHandle {
  toggle(): void;
  close(): void;
  isOpen(): boolean;
}

// A keyboard shortcut list, shown/hidden (not mounted per render) for the
// same reason as the search bar: renderMindMap() clears only the canvas.
// `rows` pairs keys or a gesture with what it does; app.ts builds them from
// its commands, so the list always matches the real shortcuts.
export function createHelpPanel(container: HTMLElement, rows: () => [string, string][]): HelpHandle {
  const el = document.createElement("div");
  el.className = "mm-help";
  el.hidden = true;

  const title = document.createElement("div");
  title.className = "mm-help-title";
  title.textContent = "Keyboard shortcuts";
  el.appendChild(title);

  const list = document.createElement("dl");
  const fill = () => {
    list.replaceChildren();
    for (const [keys, action] of rows()) {
      const dt = document.createElement("dt");
      dt.textContent = keys;
      const dd = document.createElement("dd");
      dd.textContent = action;
      list.append(dt, dd);
    }
  };
  el.appendChild(list);
  el.addEventListener("click", () => (el.hidden = true));
  container.appendChild(el);

  return {
    toggle() {
      if (el.hidden) fill();
      el.hidden = !el.hidden;
    },
    close: () => (el.hidden = true),
    isOpen: () => !el.hidden,
  };
}
