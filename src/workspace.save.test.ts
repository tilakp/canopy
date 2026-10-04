import { beforeEach, describe, expect, it, vi } from "vitest";
import { createNode } from "./model";
import { createWorkspace } from "./workspace";

// The three-button "save changes?" dialog and the file system exist only
// in Tauri, so both plugins are mocked: `answer` is the button the test
// "clicks", and the save panel picks "/maps/saved.canopy" unless told to
// cancel.
const dialog = vi.hoisted(() => ({
  answer: "Save",
  savePath: "/maps/saved.canopy" as string | null,
  message: vi.fn(),
  save: vi.fn(),
}));
const fs = vi.hoisted(() => ({ writeTextFile: vi.fn(async () => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  message: dialog.message,
  save: dialog.save,
  open: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({ writeTextFile: fs.writeTextFile, readTextFile: vi.fn() }));

let container: HTMLElement;
beforeEach(() => {
  vi.clearAllMocks();
  dialog.answer = "Save";
  dialog.savePath = "/maps/saved.canopy";
  dialog.message.mockImplementation(async () => dialog.answer);
  dialog.save.mockImplementation(async () => dialog.savePath);
  document.body.innerHTML = "";
  container = document.createElement("div");
  container.getBoundingClientRect = () =>
    ({ width: 800, height: 600, left: 0, top: 0, right: 800, bottom: 600, x: 0, y: 0, toJSON() {} }) as DOMRect;
  document.body.appendChild(container);
});

const tabs = () => [...container.querySelectorAll<HTMLElement>(".mm-tab")];
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// Opens a second tab and gives it an unsaved change (a checklist status on
// its root, through the "t" shortcut).
function dirtySecondTab() {
  const workspace = createWorkspace(container, createNode("First"), null);
  workspace.openInNewTab(createNode("Second"), null);
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }));
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "t", bubbles: true, cancelable: true }));
  expect(tabs()[1].textContent).toContain("•");
  return workspace;
}

async function closeSecondTab() {
  tabs()[1].querySelector<HTMLButtonElement>(".mm-tab-close")!.click();
  await settle();
  await settle();
}

describe("closing a map with unsaved changes", () => {
  it("offers Save, Don't Save and Cancel", async () => {
    dirtySecondTab();
    dialog.answer = "Cancel";
    await closeSecondTab();

    const options = dialog.message.mock.calls[0][1];
    expect(options.buttons).toEqual({ yes: "Save", no: "Don't Save", cancel: "Cancel" });
    expect(options.title).toContain('"Second"');
  });

  it("saves and then closes on Save", async () => {
    dirtySecondTab();
    await closeSecondTab();

    expect(fs.writeTextFile).toHaveBeenCalledWith("/maps/saved.canopy", expect.stringContaining('"Second"'));
    expect(tabs()).toHaveLength(1);
  });

  it("keeps the tab open when the save panel is cancelled", async () => {
    dirtySecondTab();
    dialog.savePath = null;
    await closeSecondTab();

    expect(fs.writeTextFile).not.toHaveBeenCalled();
    expect(tabs()).toHaveLength(2);
  });

  it("closes without saving on Don't Save, and stays open on Cancel", async () => {
    dirtySecondTab();
    dialog.answer = "Cancel";
    await closeSecondTab();
    expect(tabs()).toHaveLength(2);

    dialog.answer = "Don't Save";
    await closeSecondTab();
    expect(fs.writeTextFile).not.toHaveBeenCalled();
    expect(tabs()).toHaveLength(1);
  });

  it("asks about each unsaved map before the window closes, and stops at Cancel", async () => {
    const workspace = dirtySecondTab();
    dialog.answer = "Don't Save";
    expect(await workspace.confirmCloseAll()).toBe(true);

    dialog.answer = "Cancel";
    expect(await workspace.confirmCloseAll()).toBe(false);
    expect(dialog.message).toHaveBeenCalledTimes(2);
  });
});
