import { beforeEach, describe, expect, it, vi } from "vitest";
import { createNode } from "./model";
import { startApp } from "./app";

// The real dialog and file system exist only inside Tauri, so both plugins
// are mocked: Save As asks for "/maps/copy.canopy".
const dialog = vi.hoisted(() => ({ save: vi.fn(async () => "/maps/copy.canopy") }));
const fs = vi.hoisted(() => ({ writeTextFile: vi.fn(async () => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: dialog.save, open: vi.fn(), ask: vi.fn(), message: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({ writeTextFile: fs.writeTextFile, readTextFile: vi.fn() }));

const saveKey = (shiftKey: boolean) =>
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", metaKey: true, shiftKey, bubbles: true, cancelable: true }));
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

let container: HTMLElement;
beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
  container = document.createElement("div");
  container.getBoundingClientRect = () =>
    ({ width: 800, height: 600, left: 0, top: 0, right: 800, bottom: 600, x: 0, y: 0, toJSON() {} }) as DOMRect;
  document.body.appendChild(container);
});

describe("saving", () => {
  it("writes an open file in place on ⌘S, with no dialog", async () => {
    const app = startApp(container, createNode("Doc"), "/maps/doc.canopy");
    saveKey(false);
    await settle();

    expect(dialog.save).not.toHaveBeenCalled();
    expect(fs.writeTextFile).toHaveBeenCalledWith("/maps/doc.canopy", expect.any(String));
    app.destroy();
  });

  it("asks for a new path on ⇧⌘S and keeps working on the copy", async () => {
    const app = startApp(container, createNode("Doc"), "/maps/doc.canopy");
    saveKey(true);
    await settle();

    expect(dialog.save).toHaveBeenCalledTimes(1);
    expect(fs.writeTextFile).toHaveBeenCalledWith("/maps/copy.canopy", expect.any(String));
    expect(app.getFilePath()).toBe("/maps/copy.canopy");
    app.destroy();
  });

  it("runs Save As from the menu bar the same way", async () => {
    const app = startApp(container, createNode("Doc"), "/maps/doc.canopy");
    app.saveAs();
    await settle();

    expect(dialog.save).toHaveBeenCalledTimes(1);
    expect(app.getFilePath()).toBe("/maps/copy.canopy");
    app.destroy();
  });
});
