import { describe, expect, it, vi } from "vitest";
import { createRegistry, type Command } from "./commands";

const key = (key: string, mods: Partial<KeyboardEventInit> = {}) => new KeyboardEvent("keydown", { key, ...mods });

function registry(extra: Partial<Command> = {}) {
  const run = vi.fn();
  const commands = createRegistry([
    { id: "save", group: "File", label: "Save", keys: ["Mod+S"], whileEditing: true, run },
    { id: "saveAs", group: "File", label: "Save As", keys: ["Mod+Shift+S"], run },
    { id: "status", group: "Selected node", label: "Status", keys: ["T"], run },
    { id: "zoomIn", group: "Map", label: "Zoom in", keys: ["Mod+=", "Mod++"], run },
    { id: "help", group: "Help", label: "Help", keys: ["?"], run },
    { id: "edit", group: "Selected node", label: "Edit", keys: ["F2", " "], run, ...extra },
  ]);
  return { commands, run };
}

describe("the command registry", () => {
  it("finds a command by its key, with modifiers matched exactly", () => {
    const { commands } = registry();
    expect(commands.forKey(key("s", { metaKey: true }), false)?.id).toBe("save");
    expect(commands.forKey(key("s", { ctrlKey: true }), false)?.id).toBe("save");
    expect(commands.forKey(key("S", { metaKey: true, shiftKey: true }), false)?.id).toBe("saveAs");
    expect(commands.forKey(key("s"), false)).toBeUndefined();
  });

  it("takes a letter with Caps Lock on, but not with Shift", () => {
    const { commands } = registry();
    expect(commands.forKey(key("T"), false)?.id).toBe("status");
    expect(commands.forKey(key("T", { shiftKey: true }), false)).toBeUndefined();
  });

  it("reads keys that need Shift to type, and the + key", () => {
    const { commands } = registry();
    expect(commands.forKey(key("?", { shiftKey: true }), false)?.id).toBe("help");
    expect(commands.forKey(key("+", { metaKey: true, shiftKey: true }), false)?.id).toBe("zoomIn");
    expect(commands.forKey(key(" "), false)?.id).toBe("edit");
    expect(commands.forKey(key("F2"), false)?.id).toBe("edit");
  });

  it("leaves keys to an open editor unless the command works while editing", () => {
    const { commands } = registry();
    expect(commands.forKey(key("T"), true)).toBeUndefined();
    expect(commands.forKey(key("s", { metaKey: true }), true)?.id).toBe("save");
  });

  it("ignores a disabled command, from a key or by id", () => {
    const { commands, run } = registry({ enabled: () => false });
    expect(commands.forKey(key("F2"), false)).toBeUndefined();
    expect(commands.run("edit")).toBe(false);
    expect(run).not.toHaveBeenCalled();
    expect(() => commands.run("nope")).toThrow();
  });
});
