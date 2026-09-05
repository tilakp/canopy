import { describe, expect, it, beforeEach } from "vitest";
import { createNode } from "./model";
import { createWorkspace } from "./workspace";

let container: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = "";
  container = document.createElement("div");
  container.getBoundingClientRect = () =>
    ({ width: 800, height: 600, left: 0, top: 0, right: 800, bottom: 600, x: 0, y: 0, toJSON() {} }) as DOMRect;
  document.body.appendChild(container);
});

function docContainers(): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(".mm-doc-container")];
}

function tabEls(): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(".mm-tab")];
}

describe("createWorkspace", () => {
  it("starts with exactly one visible document tab", () => {
    createWorkspace(container, createNode("First"), null);

    expect(docContainers()).toHaveLength(1);
    expect(tabEls()).toHaveLength(1);
    expect(tabEls()[0].dataset.active).toBe("true");
    expect(docContainers()[0].style.display).not.toBe("none");
  });

  it("opens a new tab and makes it active, hiding the previous one", () => {
    const workspace = createWorkspace(container, createNode("First"), null);
    workspace.openInNewTab(createNode("Second"), null);

    expect(docContainers()).toHaveLength(2);
    expect(docContainers()[0].style.display).toBe("none");
    expect(docContainers()[1].style.display).not.toBe("none");

    const tabs = tabEls();
    expect(tabs.map((t) => t.dataset.active)).toEqual(["false", "true"]);
  });

  it("switches the active tab on click", () => {
    const workspace = createWorkspace(container, createNode("First"), null);
    workspace.openInNewTab(createNode("Second"), null);

    tabEls()[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(docContainers()[0].style.display).not.toBe("none");
    expect(docContainers()[1].style.display).toBe("none");
  });

  it("closes a tab via its close button", () => {
    const workspace = createWorkspace(container, createNode("First"), null);
    workspace.openInNewTab(createNode("Second"), null);
    expect(docContainers()).toHaveLength(2);

    tabEls()[1].querySelector<HTMLButtonElement>(".mm-tab-close")!.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );

    expect(docContainers()).toHaveLength(1);
  });

  // Key/resize listeners are window-level, so every open document hears
  // every keystroke and ignores it unless it's the active one. Closing the
  // active tab used to leave that instance flagged active with its
  // listeners still attached — it kept editing its own detached canvas (and
  // would still have opened a save dialog on ⌘S).
  it("stops a closed document from reacting to window key events", () => {
    const workspace = createWorkspace(container, createNode("First"), null);
    workspace.openInNewTab(createNode("Second"), null);
    const closed = docContainers()[1];
    const nodesBefore = closed.querySelectorAll(".mm-node").length;

    tabEls()[1]
      .querySelector<HTMLButtonElement>(".mm-tab-close")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));

    expect(closed.querySelectorAll(".mm-node")).toHaveLength(nodesBefore);
    // The tab that's actually open still responds.
    expect(docContainers()[0].querySelectorAll(".mm-node").length).toBe(nodesBefore + 1);
  });

  it("replaces the last remaining tab with a fresh blank map instead of leaving zero", () => {
    createWorkspace(container, createNode("Only"), null);
    expect(docContainers()).toHaveLength(1);

    tabEls()[0].querySelector<HTMLButtonElement>(".mm-tab-close")!.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );

    expect(docContainers()).toHaveLength(1);
    expect(tabEls()[0].querySelector(".mm-tab-title")!.textContent).toBe("Untitled");
  });

  it("creates a new blank map via the '+' button", () => {
    createWorkspace(container, createNode("First"), null);
    container.querySelector<HTMLButtonElement>(".mm-tab-new")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(docContainers()).toHaveLength(2);
    expect(tabEls()[1].querySelector(".mm-tab-title")!.textContent).toBe("Untitled");
  });
});
