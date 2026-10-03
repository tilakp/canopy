export interface HelpHandle {
  toggle(): void;
  close(): void;
  isOpen(): boolean;
}

const SHORTCUTS: [string, string][] = [
  ["Tab", "Add a child"],
  ["Enter", "Add a sibling after the selected node"],
  ["Enter / Tab while typing a new node", "Go on to the next sibling / child"],
  ["F2, Space or double-click", "Edit the selected node"],
  ["Esc", "Stop editing (an empty new node is removed)"],
  ["Delete", "Delete the selected nodes"],
  ["Arrow keys", "Move the selection (→ also opens a folded branch)"],
  [".", "Fold or open the selected branch"],
  ["⌥-click − or a count", "Fold or open every level below"],
  ["⌥↑ / ⌥↓", "Move the node up / down"],
  ["Shift+click", "Select more than one node"],
  ["N / I / L", "Edit notes / icon / link"],
  ["T", "Cycle the checklist status"],
  ["⌘V", "Paste an image onto the node"],
  ["F", "Focus on the selected branch"],
  ["0", "Zoom to fit"],
  ["⌘= / ⌘−", "Zoom in / out"],
  ["⌘F", "Find"],
  ["⌘Z / ⌘⇧Z", "Undo / redo"],
  ["⌘S / ⌘O", "Save / open"],
  ["?", "Show or hide this list"],
];

// A keyboard shortcut list, shown/hidden (not mounted per render) for the
// same reason as the search bar: renderMindMap() clears only the canvas.
export function createHelpPanel(container: HTMLElement): HelpHandle {
  const el = document.createElement("div");
  el.className = "mm-help";
  el.hidden = true;

  const title = document.createElement("div");
  title.className = "mm-help-title";
  title.textContent = "Keyboard shortcuts";
  el.appendChild(title);

  const list = document.createElement("dl");
  for (const [keys, action] of SHORTCUTS) {
    const dt = document.createElement("dt");
    dt.textContent = keys;
    const dd = document.createElement("dd");
    dd.textContent = action;
    list.append(dt, dd);
  }
  el.appendChild(list);
  el.addEventListener("click", () => (el.hidden = true));
  container.appendChild(el);

  return {
    toggle: () => (el.hidden = !el.hidden),
    close: () => (el.hidden = true),
    isOpen: () => !el.hidden,
  };
}
