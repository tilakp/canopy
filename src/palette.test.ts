import { describe, expect, it, vi } from "vitest";
import { createPalette, filterCommands } from "./palette";
import type { Command } from "./commands";

const cmd = (label: string, run = () => {}): Command => ({ id: label, label, group: "Map", run });

describe("filterCommands", () => {
  const commands = [cmd("Zoom to fit"), cmd("Fold branch"), cmd("Focus on branch"), cmd("Font: Serif")];

  it("keeps every command for an empty query", () => {
    expect(filterCommands(commands, "  ")).toHaveLength(4);
  });

  it("keeps commands that contain every word, best match first", () => {
    expect(filterCommands(commands, "fo").map((c) => c.label)).toEqual(["Fold branch", "Focus on branch", "Font: Serif"]);
    expect(filterCommands(commands, "branch").map((c) => c.label)).toEqual(["Fold branch", "Focus on branch"]);
    expect(filterCommands(commands, "on bran").map((c) => c.label)).toEqual(["Focus on branch"]);
    expect(filterCommands(commands, "fit").map((c) => c.label)).toEqual(["Zoom to fit"]);
  });
});

describe("createPalette", () => {
  it("runs the chosen command with the keyboard and closes", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const fold = vi.fn();
    const onClose = vi.fn();
    const palette = createPalette(container, () => [cmd("Zoom to fit"), cmd("Fold branch", fold)], onClose);
    palette.open();
    const input = container.querySelector<HTMLInputElement>(".mm-palette-input")!;
    input.value = "branch";
    input.dispatchEvent(new Event("input"));
    expect(container.querySelectorAll(".mm-palette-item")).toHaveLength(1);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(fold).toHaveBeenCalledOnce();
    expect(palette.isOpen()).toBe(false);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("moves the selection with the arrow keys and closes on Escape", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const second = vi.fn();
    const palette = createPalette(container, () => [cmd("One"), cmd("Two", second)], () => {});
    palette.open();
    const input = container.querySelector<HTMLInputElement>(".mm-palette-input")!;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(container.querySelector('[aria-selected="true"]')!.textContent).toBe("Two");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(palette.isOpen()).toBe(false);
    expect(second).not.toHaveBeenCalled();
  });
});
