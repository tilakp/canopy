import { describe, expect, it } from "vitest";
import { addChild, createNode } from "./model";
import { renderMindMap, type EdgeStyle } from "./render";

let container: HTMLElement;

function setup(): HTMLElement {
  container = document.createElement("div");
  Object.defineProperty(container, "clientWidth", { value: 800, configurable: true });
  Object.defineProperty(container, "clientHeight", { value: 600, configurable: true });
  container.getBoundingClientRect = () =>
    ({ width: 800, height: 600, left: 0, top: 0, right: 800, bottom: 600, x: 0, y: 0, toJSON() {} }) as DOMRect;
  document.body.appendChild(container);
  return container;
}

function render(root: ReturnType<typeof createNode>, edgeStyle: EdgeStyle = "curved") {
  return renderMindMap(
    setup(),
    root,
    { selectedId: null, editingId: null, edgeStyle },
    { onEditCommit() {}, onEditCancel() {} },
  );
}

describe("renderMindMap", () => {
  it("wraps long node text onto multiple lines and grows the box to fit", () => {
    const root = createNode("Root");
    const long = addChild(root, "This is a fairly long sentence used as a node label for wrapping");
    render(root);

    const g = container.querySelector(`[data-node-id="${long.id}"]`)!;
    const tspans = g.querySelectorAll(".mm-node-text tspan");
    const box = g.querySelector(".mm-node-box")!;

    expect(tspans.length).toBeGreaterThan(1);
    // Box height should scale with the number of wrapped lines, not stay
    // fixed at a single-line height.
    expect(Number(box.getAttribute("height"))).toBeGreaterThan(40);
  });

  it("keeps short text on a single line with a compact box", () => {
    const root = createNode("Root");
    const short = addChild(root, "Short");
    render(root);

    const g = container.querySelector(`[data-node-id="${short.id}"]`)!;
    expect(g.querySelectorAll(".mm-node-text tspan")).toHaveLength(1);
  });

  it("fills non-root boxes with a lightened version of their branch color", () => {
    const root = createNode("Root");
    const branch = addChild(root, "Branch");
    render(root);

    const box = container.querySelector(`[data-node-id="${branch.id}"] .mm-node-box`)!;
    const fill = box.getAttribute("fill")!;
    // A lightened color should read as "rgb(r g b)" with all channels
    // pulled up toward 255, not the raw saturated branch hex.
    expect(fill).toMatch(/^rgb\(/);
    const [r, g, b] = fill.match(/\d+/g)!.map(Number);
    expect(Math.min(r, g, b)).toBeGreaterThan(150);
  });

  it("draws a cubic bezier for curved edges and a right-angle path for straight ones", () => {
    const curvedRoot = createNode("Root");
    addChild(curvedRoot, "Branch");
    render(curvedRoot, "curved");
    const curvedPath = container.querySelector(".mm-edge")?.getAttribute("d") ?? "";
    expect(curvedPath).toContain("C");

    const straightRoot = createNode("Root");
    addChild(straightRoot, "Branch");
    render(straightRoot, "straight");
    const straightPath = container.querySelector(".mm-edge")?.getAttribute("d") ?? "";
    expect(straightPath).not.toContain("C");
    expect(straightPath).toContain("L");
  });
});
