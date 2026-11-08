import { isEnabled, labelOf, shortcutOf, type Command } from "./commands";

export interface PaletteHandle {
  open(): void;
  close(): void;
  isOpen(): boolean;
}

// The commands whose label has every word of the query, best match first:
// a label that starts with the query, then one with a word that does, then
// the rest, each in their original order.
export function filterCommands(commands: Command[], query: string): Command[] {
  commands = commands.filter((c) => !c.hidden && isEnabled(c));
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return commands;
  const q = query.trim().toLowerCase();
  const rank = (label: string) => (label.startsWith(q) ? 0 : label.split(/\s+/).some((w) => w.startsWith(q)) ? 1 : 2);
  return commands
    .map((command, index) => ({ command, index, label: labelOf(command).toLowerCase() }))
    .filter(({ label }) => words.every((w) => label.includes(w)))
    .sort((a, b) => rank(a.label) - rank(b.label) || a.index - b.index)
    .map(({ command }) => command);
}

// ⌘K: every action in one searchable list, with its shortcut. Shown and
// hidden, not rebuilt per render, like the search bar.
export function createPalette(
  container: HTMLElement,
  getCommands: () => Command[],
  onClose: () => void,
): PaletteHandle {
  const backdrop = document.createElement("div");
  backdrop.className = "mm-palette-backdrop";
  backdrop.hidden = true;

  const el = document.createElement("div");
  el.className = "mm-palette";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", "Commands");

  const input = document.createElement("input");
  input.className = "mm-palette-input";
  input.placeholder = "Type a command";
  input.spellcheck = false;
  input.setAttribute("aria-label", "Search commands");

  const list = document.createElement("div");
  list.className = "mm-palette-list";
  list.setAttribute("role", "listbox");

  const foot = document.createElement("div");
  foot.className = "mm-palette-foot";
  foot.textContent = "↑↓ to move · ↵ to run · esc to close";

  el.append(input, list, foot);
  backdrop.appendChild(el);
  container.appendChild(backdrop);

  let shown: Command[] = [];
  let index = 0;

  function draw(): void {
    shown = filterCommands(getCommands(), input.value);
    index = Math.min(index, Math.max(0, shown.length - 1));
    list.innerHTML = "";
    if (shown.length === 0) {
      const empty = document.createElement("div");
      empty.className = "mm-palette-empty";
      empty.textContent = "No matching commands";
      list.appendChild(empty);
      return;
    }
    let group = "";
    shown.forEach((command, i) => {
      if (command.group !== group) {
        group = command.group;
        const heading = document.createElement("div");
        heading.className = "mm-palette-group";
        heading.textContent = group;
        list.appendChild(heading);
      }
      const item = document.createElement("button");
      item.className = "mm-palette-item";
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(i === index));
      const label = document.createElement("span");
      label.textContent = labelOf(command);
      item.appendChild(label);
      const shortcut = shortcutOf(command);
      if (shortcut) {
        const key = document.createElement("kbd");
        key.textContent = shortcut;
        item.appendChild(key);
      }
      item.addEventListener("pointerdown", (e) => e.preventDefault());
      item.addEventListener("click", () => run(i));
      item.addEventListener("pointermove", () => {
        if (index !== i) {
          index = i;
          draw();
        }
      });
      list.appendChild(item);
    });
    list.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" });
  }

  function run(i: number): void {
    const command = shown[i];
    handle.close();
    if (command && isEnabled(command)) command.run();
  }

  input.addEventListener("input", () => {
    index = 0;
    draw();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (shown.length > 0) index = (index + (e.key === "ArrowDown" ? 1 : -1) + shown.length) % shown.length;
      draw();
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(index);
    } else if (e.key === "Escape" || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k")) {
      e.preventDefault();
      handle.close();
    }
    // Typing here must not reach the app's shortcuts.
    e.stopPropagation();
  });
  backdrop.addEventListener("pointerdown", (e) => {
    if (e.target === backdrop) {
      e.preventDefault();
      handle.close();
    }
  });

  const handle: PaletteHandle = {
    open() {
      input.value = "";
      index = 0;
      backdrop.hidden = false;
      draw();
      input.focus();
    },
    close() {
      if (backdrop.hidden) return;
      backdrop.hidden = true;
      onClose();
    },
    isOpen: () => !backdrop.hidden,
  };
  return handle;
}
