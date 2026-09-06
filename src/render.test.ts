import { describe, expect, it } from "vitest";
import { addChild, createNode } from "./model";
import { renderMindMap, computeFitCamera, type EdgeStyle } from "./render";

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
    { selectedIds: new Set(), editingId: null, edgeStyle },
    {
      onEditCommit() {},
      onEditCancel() {},
      onNotesCommit() {},
      onNotesCancel() {},
      onIconCommit() {},
      onIconCancel() {},
      onLinkCommit() {},
      onLinkCancel() {},
    },
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

  it("grows a node's box to fit its image thumbnail", () => {
    const plainRoot = createNode("Root");
    addChild(plainRoot, "Branch");
    render(plainRoot);
    const plainHeight = Number(
      container.querySelector(".mm-node-box")!.getAttribute("height"),
    );

    const imageRoot = createNode("Root");
    const withImage = addChild(imageRoot, "Branch");
    withImage.image = "data:image/png;base64,abc";
    render(imageRoot);
    const g = container.querySelector(`[data-node-id="${withImage.id}"]`)!;
    const imageHeight = Number(g.querySelector(".mm-node-box")!.getAttribute("height"));

    expect(imageHeight).toBeGreaterThan(plainHeight);
    expect(g.querySelector("image")).not.toBeNull();
  });

  it("shows a status badge only when a node's status is set", () => {
    const root = createNode("Root");
    const plain = addChild(root, "Plain");
    const todo = addChild(root, "Todo");
    todo.status = "todo";
    const done = addChild(root, "Done");
    done.status = "done";
    render(root);

    expect(container.querySelector(`[data-node-id="${plain.id}"] .mm-status-badge`)).toBeNull();
    expect(container.querySelector(`[data-node-id="${todo.id}"] .mm-status-badge`)).not.toBeNull();
    expect(
      container.querySelector(`[data-node-id="${done.id}"] .mm-status-badge.mm-status-done`),
    ).not.toBeNull();
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

describe("computeFitCamera", () => {
  it("scales down and centers content larger than the viewport", () => {
    const bbox = new DOMRect(0, 0, 1600, 400);
    const camera = computeFitCamera(bbox, { width: 800, height: 600 });
    expect(camera.scale).toBeCloseTo((800 / 1600) * 0.9);
    expect(camera.x).toBeCloseTo(400 - 800 * camera.scale);
    expect(camera.y).toBeCloseTo(300 - 200 * camera.scale);
  });

  it("never scales up past 1x for content smaller than the viewport", () => {
    const bbox = new DOMRect(0, 0, 100, 50);
    const camera = computeFitCamera(bbox, { width: 800, height: 600 });
    expect(camera.scale).toBe(1);
  });

  it("falls back to an identity camera for an empty/zero-size bbox", () => {
    const camera = computeFitCamera(new DOMRect(0, 0, 0, 0), { width: 800, height: 600 });
    expect(camera).toEqual({ x: 400, y: 300, scale: 1 });
  });
});
