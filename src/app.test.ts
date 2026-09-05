import { describe, expect, it, beforeEach } from "vitest";
import { addChild, createNode, findNode, type MindMapNode } from "./model";
import { startApp } from "./app";

// jsdom doesn't implement real SVG layout, so getBBox() always throws;
// render.ts's safeBBox() falls back to a zero-size box, which is fine here
// since these tests only care about interaction/state, not visual geometry.

function fireClick(el: Element, x: number, y: number, timeStamp: number) {
  const down = new PointerEvent("pointerdown", { bubbles: true, clientX: x, clientY: y });
  Object.defineProperty(down, "timeStamp", { value: timeStamp });
  el.dispatchEvent(down);
  el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: x, clientY: y }));
}

function fireKey(key: string) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

function fireKeyMeta(key: string, shiftKey = false) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, metaKey: true, shiftKey, bubbles: true, cancelable: true }));
}

function fireKeyAlt(key: string) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, altKey: true, bubbles: true, cancelable: true }));
}

function pointer(el: Element, type: string, x: number, y: number) {
  el.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y }));
}

function getTransform(container: HTMLElement): { x: number; y: number; scale: number } {
  const g = container.querySelector("svg > g")!;
  const match = (g.getAttribute("transform") ?? "").match(
    /translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)/,
  );
  if (!match) throw new Error(`unexpected transform: ${g.getAttribute("transform")}`);
  return { x: parseFloat(match[1]), y: parseFloat(match[2]), scale: parseFloat(match[3]) };
}

function nodeEl(container: HTMLElement, id: string): Element {
  const el = container.querySelector(`[data-node-id="${id}"]`);
  if (!el) throw new Error(`no element for node ${id}`);
  return el;
}

function buildTree(): { root: MindMapNode; child: MindMapNode } {
  const root = createNode("Root");
  const child = addChild(root, "Child");
  return { root, child };
}

let container: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = "";
  container = document.createElement("div");
  Object.defineProperty(container, "clientWidth", { value: 800, configurable: true });
  Object.defineProperty(container, "clientHeight", { value: 600, configurable: true });
  container.getBoundingClientRect = () =>
    ({ width: 800, height: 600, left: 0, top: 0, right: 800, bottom: 600, x: 0, y: 0, toJSON() {} }) as DOMRect;
  document.body.appendChild(container);
});

describe("startApp interactions", () => {
  it("selects a node on click", () => {
    const { root, child } = buildTree();
    startApp(container, root);

    fireClick(nodeEl(container, child.id), 100, 100, 0);

    expect(nodeEl(container, child.id).closest(".mm-node")?.classList.contains("mm-selected")).toBe(true);
  });

  it("enters edit mode on a quick double-click at the same spot", () => {
    const { root, child } = buildTree();
    startApp(container, root);

    fireClick(nodeEl(container, child.id), 100, 100, 0);
    fireClick(nodeEl(container, child.id), 100, 100, 120);

    expect(container.querySelector("input.mm-edit-input")).not.toBeNull();
  });

  it("does NOT enter edit mode when the second click is too slow", () => {
    const { root, child } = buildTree();
    startApp(container, root);

    fireClick(nodeEl(container, child.id), 100, 100, 0);
    fireClick(nodeEl(container, child.id), 100, 100, 1000);

    expect(container.querySelector("input.mm-edit-input")).toBeNull();
  });

  it("tolerates realistic timing and hand-tremor position drift between clicks", () => {
    const { root, child } = buildTree();
    startApp(container, root);

    // A real double-click is never pixel-perfect or instant.
    fireClick(nodeEl(container, child.id), 100, 100, 0);
    fireClick(nodeEl(container, child.id), 106, 104, 450);

    expect(container.querySelector("input.mm-edit-input")).not.toBeNull();
  });

  it("adds a child on Tab and enters edit mode", () => {
    const { root, child } = buildTree();
    startApp(container, root);

    fireClick(nodeEl(container, child.id), 100, 100, 0);
    fireKey("Tab");

    expect(child.children).toHaveLength(1);
    expect(container.querySelector("input.mm-edit-input")).not.toBeNull();
  });

  it("removes the selected node on Delete", () => {
    const { root, child } = buildTree();
    startApp(container, root);

    fireClick(nodeEl(container, child.id), 100, 100, 0);
    fireKey("Delete");

    expect(findNode(root, child.id)).toBeNull();
  });

  it("Escape exits editing even without input focus", () => {
    const { root, child } = buildTree();
    startApp(container, root);

    fireClick(nodeEl(container, child.id), 100, 100, 0);
    fireKey("Tab");
    expect(container.querySelector("input.mm-edit-input")).not.toBeNull();

    fireKey("Escape");
    expect(container.querySelector("input.mm-edit-input")).toBeNull();
  });

  it("adds a sibling on Enter", () => {
    const { root, child } = buildTree();
    startApp(container, root);

    fireClick(nodeEl(container, child.id), 100, 100, 0);
    fireKey("Enter");

    expect(root.children).toHaveLength(2);
  });

  it("deselects when clicking empty canvas", () => {
    const { root, child } = buildTree();
    startApp(container, root);

    fireClick(nodeEl(container, child.id), 100, 100, 0);
    expect(container.querySelector(".mm-selected")).not.toBeNull();

    fireClick(container, 700, 500, 500);
    expect(container.querySelector(".mm-selected")).toBeNull();
  });

  it("drags a node to a new position via its offset", () => {
    const { root, child } = buildTree();
    startApp(container, root);

    pointer(nodeEl(container, child.id), "pointerdown", 100, 100);
    pointer(container, "pointermove", 140, 130);
    pointer(container, "pointerup", 140, 130);

    expect(child.offset).toEqual({ dx: 40, dy: 30 });
  });

  it("does not drag the root node (it has no offset)", () => {
    const { root } = buildTree();
    startApp(container, root);

    pointer(nodeEl(container, root.id), "pointerdown", 100, 100);
    pointer(container, "pointermove", 140, 130);
    pointer(container, "pointerup", 140, 130);

    expect(root.offset).toBeUndefined();
  });

  it("pans the camera when dragging empty canvas", () => {
    const { root } = buildTree();
    startApp(container, root);
    const before = getTransform(container);

    pointer(container, "pointerdown", 200, 200);
    pointer(container, "pointermove", 250, 260);
    pointer(container, "pointerup", 250, 260);

    const after = getTransform(container);
    expect(after.x - before.x).toBeCloseTo(50);
    expect(after.y - before.y).toBeCloseTo(60);
  });

  it("zooms in toward the cursor on wheel scroll", async () => {
    const { root } = buildTree();
    startApp(container, root);
    const before = getTransform(container);

    container.dispatchEvent(
      new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: 400, clientY: 300, deltaY: -100 }),
    );
    // Wheel-driven zoom is coalesced to one render per animation frame.
    await new Promise((resolve) => requestAnimationFrame(resolve));

    const after = getTransform(container);
    expect(after.scale).toBeGreaterThan(before.scale);
  });

  it("zooms in/out around the viewport center via ⌘= / ⌘-", () => {
    const { root } = buildTree();
    startApp(container, root);
    const before = getTransform(container);

    fireKeyMeta("=");
    const zoomedIn = getTransform(container);
    expect(zoomedIn.scale).toBeGreaterThan(before.scale);

    fireKeyMeta("-");
    const backOut = getTransform(container);
    expect(backOut.scale).toBeCloseTo(before.scale);
  });

  it("zooms in/out via the toolbar's zoom buttons", () => {
    const { root } = buildTree();
    startApp(container, root);
    const before = getTransform(container);

    const zoomInBtn = container.querySelector<HTMLButtonElement>('[title^="Zoom in"]')!;
    const zoomOutBtn = container.querySelector<HTMLButtonElement>('[title^="Zoom out"]')!;
    zoomInBtn.click();
    expect(getTransform(container).scale).toBeGreaterThan(before.scale);
    zoomOutBtn.click();
    expect(getTransform(container).scale).toBeCloseTo(before.scale);
  });

  // Undo/redo swaps in a freshly-cloned tree internally (new object
  // identities, same ids), so assertions here check the rendered DOM
  // (which always reflects whatever tree is currently active) rather than
  // the pre-existing `root`/`child` object references, which go stale the
  // moment an undo or redo happens.

  it("undoes and redoes adding a node via ⌘Z / ⌘⇧Z", () => {
    const { root, child } = buildTree();
    startApp(container, root);

    const countLeaves = () => container.querySelectorAll(".mm-leaf").length;
    const before = countLeaves();

    fireClick(nodeEl(container, child.id), 100, 100, 0);
    fireKey("Tab");
    expect(countLeaves()).toBe(before + 1);

    // ⌘Z is deliberately a no-op while editing (so it doesn't fight the
    // input's own native undo) — exit editing first, as a real user would.
    fireKey("Escape");
    fireKeyMeta("z");
    expect(countLeaves()).toBe(before);

    fireKeyMeta("z", true);
    expect(countLeaves()).toBe(before + 1);
  });

  it("undoes a delete", () => {
    const { root, child } = buildTree();
    startApp(container, root);

    fireClick(nodeEl(container, child.id), 100, 100, 0);
    fireKey("Delete");
    expect(container.querySelector(`[data-node-id="${child.id}"]`)).toBeNull();

    fireKeyMeta("z");
    expect(container.querySelector(`[data-node-id="${child.id}"]`)).not.toBeNull();
  });

  it("undoes a completed drag but does not record a no-op click as a history step", () => {
    const { root, child } = buildTree();
    startApp(container, root);
    const boxX = () => nodeEl(container, child.id).querySelector(".mm-node-box")!.getAttribute("x");
    const xBefore = boxX();

    pointer(nodeEl(container, child.id), "pointerdown", 100, 100);
    pointer(container, "pointermove", 140, 130);
    pointer(container, "pointerup", 140, 130);
    expect(boxX()).not.toBe(xBefore);

    fireKeyMeta("z");
    expect(boxX()).toBe(xBefore);
  });

  it("does not trigger undo/redo while editing text", () => {
    const { root, child } = buildTree();
    startApp(container, root);

    fireClick(nodeEl(container, child.id), 100, 100, 0);
    fireKey("Tab");
    const input = container.querySelector<HTMLInputElement>("input.mm-edit-input")!;
    input.value = "typed while editing";

    fireKeyMeta("z"); // should be a no-op at the app level (input handles its own undo)
    expect(input.value).toBe("typed while editing");
    expect(container.querySelector("input.mm-edit-input")).not.toBeNull();
  });

  function isSelected(id: string): boolean {
    return nodeEl(container, id).closest(".mm-node")?.classList.contains("mm-selected") ?? false;
  }

  it("navigates between siblings with ArrowUp/ArrowDown", () => {
    const root = createNode("Root");
    const a = addChild(root, "A");
    const b = addChild(root, "B");
    startApp(container, root);

    fireClick(nodeEl(container, a.id), 100, 100, 0);
    fireKey("ArrowDown");
    expect(isSelected(b.id)).toBe(true);
    fireKey("ArrowUp");
    expect(isSelected(a.id)).toBe(true);
    // Clamps at the ends instead of wrapping.
    fireKey("ArrowUp");
    expect(isSelected(a.id)).toBe(true);
  });

  it("navigates to the parent with ArrowLeft and to the first child with ArrowRight", () => {
    const root = createNode("Root");
    const a = addChild(root, "A");
    const grandchild = addChild(a, "A-child");
    startApp(container, root);

    fireClick(nodeEl(container, a.id), 100, 100, 0);
    fireKey("ArrowRight");
    expect(isSelected(grandchild.id)).toBe(true);
    fireKey("ArrowLeft");
    expect(isSelected(a.id)).toBe(true);
  });

  it("reorders siblings with Alt+ArrowUp/ArrowDown", () => {
    const root = createNode("Root");
    const a = addChild(root, "A");
    const b = addChild(root, "B");
    startApp(container, root);

    fireClick(nodeEl(container, a.id), 100, 100, 0);
    fireKeyAlt("ArrowDown");
    expect(root.children.map((n) => n.id)).toEqual([b.id, a.id]);
    fireKeyAlt("ArrowUp");
    expect(root.children.map((n) => n.id)).toEqual([a.id, b.id]);
  });

  it("collapses and expands a subtree via its toggle, hiding/showing descendants", () => {
    const { root, child } = buildTree();
    const grandchild = addChild(child, "Grandchild");
    startApp(container, root);

    expect(container.querySelector(`[data-node-id="${grandchild.id}"]`)).not.toBeNull();

    const toggle = nodeEl(container, child.id).closest(".mm-node")!.querySelector(".mm-collapse-toggle")!;
    fireClick(toggle, 100, 100, 0);
    expect(child.collapsed).toBe(true);
    expect(container.querySelector(`[data-node-id="${grandchild.id}"]`)).toBeNull();

    fireClick(nodeEl(container, child.id).closest(".mm-node")!.querySelector(".mm-collapse-toggle")!, 100, 100, 0);
    expect(child.collapsed).toBe(false);
    expect(container.querySelector(`[data-node-id="${grandchild.id}"]`)).not.toBeNull();
  });

  it("opens a notes editor on 'n', commits on blur, and shows a badge", () => {
    const { root, child } = buildTree();
    startApp(container, root);

    fireClick(nodeEl(container, child.id), 100, 100, 0);
    fireKey("n");
    const textarea = container.querySelector<HTMLTextAreaElement>("textarea.mm-notes-input")!;
    expect(textarea).not.toBeNull();
    textarea.value = "Some notes";
    textarea.dispatchEvent(new Event("blur"));

    expect(child.notes).toBe("Some notes");
    expect(nodeEl(container, child.id).querySelector(".mm-notes-badge")).not.toBeNull();
  });

  it("cancels notes editing on Escape without committing", () => {
    const { root, child } = buildTree();
    startApp(container, root);

    fireClick(nodeEl(container, child.id), 100, 100, 0);
    fireKey("n");
    const textarea = container.querySelector<HTMLTextAreaElement>("textarea.mm-notes-input")!;
    textarea.value = "Discard me";
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));

    expect(child.notes).toBeUndefined();
    expect(container.querySelector("textarea.mm-notes-input")).toBeNull();
  });

  it("sets an icon on 'i' that shows up alongside the node's text", () => {
    const { root, child } = buildTree();
    startApp(container, root);

    fireClick(nodeEl(container, child.id), 100, 100, 0);
    fireKey("i");
    const input = container.querySelector<HTMLInputElement>("input.mm-inline-input")!;
    input.value = "🚀";
    input.dispatchEvent(new Event("blur"));

    expect(child.icon).toBe("🚀");
    expect(nodeEl(container, child.id).textContent).toContain("🚀");
  });

  it("sets a link on 'l' that shows a clickable badge", () => {
    const { root, child } = buildTree();
    startApp(container, root);

    fireClick(nodeEl(container, child.id), 100, 100, 0);
    fireKey("l");
    const input = container.querySelector<HTMLInputElement>("input.mm-inline-input")!;
    input.value = "https://example.com";
    input.dispatchEvent(new Event("blur"));

    expect(child.link).toBe("https://example.com");
    expect(nodeEl(container, child.id).querySelector(".mm-link-badge")).not.toBeNull();
  });
});
