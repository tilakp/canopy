// Every action a map offers, defined once. The keyboard, the command
// palette, the right-click menu, the node toolbar, the help list, the
// title bar and the macOS menu bar all read the same definition, so a
// label, a shortcut or an enabled rule cannot drift between them.

export type CommandGroup = "Selected node" | "Map" | "File" | "View" | "Help";

export interface Command {
  id: string;
  group: CommandGroup;
  // A function when the label depends on state ("Fold branch" / "Open
  // branch").
  label: string | (() => string);
  // Key bindings in the form "Mod+Shift+S", "Alt+ArrowUp", "Tab", " ".
  // Mod is ⌘ on macOS and Ctrl elsewhere. The first one is shown to people.
  keys?: string[];
  // Runs even while a title, notes, icon or link editor is open. Most
  // shortcuts don't: the keys are text then.
  whileEditing?: boolean;
  // Left out of the command palette (arrow-key moves, Escape).
  hidden?: boolean;
  enabled?: () => boolean;
  run(): void;
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);

interface KeyBinding {
  key: string;
  mod: boolean;
  shift: boolean;
  alt: boolean;
}

function parseBinding(binding: string): KeyBinding {
  // The key is what follows the last "+", except for the "+" key itself
  // ("Mod++").
  const plusKey = binding.endsWith("++") || binding === "+";
  const key = plusKey ? "+" : binding.slice(binding.lastIndexOf("+") + 1) || binding;
  const mods = new Set(binding.slice(0, binding.length - key.length).split("+"));
  return { key, mod: mods.has("Mod"), shift: mods.has("Shift"), alt: mods.has("Alt") };
}

// Whether `e` is the binding. Letters compare without case, so Shift+S
// matches "Shift+S" whether the event says "s" or "S". A binding without
// Shift still matches a shifted key when the key itself needs Shift ("?").
function matchesKey(e: KeyboardEvent, binding: string): boolean {
  const b = parseBinding(binding);
  const mod = e.metaKey || e.ctrlKey;
  if (mod !== b.mod || e.altKey !== b.alt) return false;
  if (b.shift && !e.shiftKey) return false;
  const isLetter = /^[a-z]$/i.test(b.key);
  if (isLetter && !b.shift && e.shiftKey) return false;
  return isLetter ? e.key.toLowerCase() === b.key.toLowerCase() : e.key === b.key;
}

const KEY_SYMBOLS: Record<string, string> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Enter: "↩",
  Escape: "Esc",
  Backspace: "⌫",
  Delete: "⌫",
  " ": "Space",
};

// How a binding is shown: "⇧⌘S" on macOS, "Ctrl+Shift+S" elsewhere.
export function formatKey(binding: string): string {
  const b = parseBinding(binding);
  const key = KEY_SYMBOLS[b.key] ?? (b.key.length === 1 ? b.key.toUpperCase() : b.key);
  if (isMac) return `${b.alt ? "⌥" : ""}${b.shift ? "⇧" : ""}${b.mod ? "⌘" : ""}${key}`;
  return [b.mod && "Ctrl", b.alt && "Alt", b.shift && "Shift", key].filter(Boolean).join("+");
}

export function labelOf(command: Command): string {
  return typeof command.label === "function" ? command.label() : command.label;
}

export function shortcutOf(command: Command): string | undefined {
  return command.keys?.[0] && formatKey(command.keys[0]);
}

export function isEnabled(command: Command): boolean {
  return command.enabled?.() ?? true;
}

export interface CommandRegistry {
  get(id: string): Command;
  all(): Command[];
  // Runs the command if it is enabled. Returns whether it ran.
  run(id: string): boolean;
  // The enabled command bound to the key, if any, given whether an editor
  // is open.
  forKey(e: KeyboardEvent, editing: boolean): Command | undefined;
}

export function createRegistry(commands: Command[]): CommandRegistry {
  const byId = new Map(commands.map((c) => [c.id, c]));
  const get = (id: string) => {
    const command = byId.get(id);
    if (!command) throw new Error(`Unknown command: ${id}`);
    return command;
  };
  return {
    get,
    all: () => commands,
    run(id) {
      const command = get(id);
      if (!isEnabled(command)) return false;
      command.run();
      return true;
    },
    forKey(e, editing) {
      return commands.find(
        (c) => (!editing || c.whileEditing) && c.keys?.some((k) => matchesKey(e, k)) && isEnabled(c),
      );
    },
  };
}
