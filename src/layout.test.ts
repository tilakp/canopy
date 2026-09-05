import { describe, expect, it } from "vitest";
import { addChild, createNode } from "./model";
import { computeLayout, type GetSize } from "./layout";

const NODE_HEIGHT = 40;
const NODE_WIDTH = 120;
const fixedSize: GetSize = () => ({ width: NODE_WIDTH, height: NODE_HEIGHT });

// Nodes that share an x-coordinate are on the same side at the same depth,
// so their vertical slices must not overlap.
function expectNoOverlap(positions: Map<string, { x: number; y: number }>) {
  const byX = new Map<number, number[]>();
  for (const { x, y } of positions.values()) {
    const bucket = byX.get(x) ?? [];
    bucket.push(y);
    byX.set(x, bucket);
  }
  for (const ys of byX.values()) {
    ys.sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(NODE_HEIGHT - 1e-9);
    }
  }
}

describe("computeLayout", () => {
  it("places a lone root at the origin", () => {
    const root = createNode("Root");
    const { positions, edges } = computeLayout(root, fixedSize);
    expect(positions.size).toBe(1);
    expect(edges).toHaveLength(0);
    expect(positions.get(root.id)).toMatchObject({ x: 0, y: 0, side: "root" });
  });

  it("lays out 5 nodes with no overlapping siblings", () => {
    const root = createNode("Root");
    for (let i = 0; i < 4; i++) addChild(root, `Child ${i}`);

    const { positions, edges } = computeLayout(root, fixedSize);
    expect(positions.size).toBe(5);
    expect(edges).toHaveLength(4);
    expectNoOverlap(positions);
  });

  it("lays out a 20-node tree with no overlapping branches", () => {
    const root = createNode("Root");
    for (let i = 0; i < 5; i++) {
      const branch = addChild(root, `Branch ${i}`);
      for (let j = 0; j < 3; j++) addChild(branch, `Leaf ${i}-${j}`);
    }

    const { positions, edges } = computeLayout(root, fixedSize);
    expect(positions.size).toBe(1 + 5 + 15);
    expect(edges).toHaveLength(5 + 15);
    expectNoOverlap(positions);
  });

  it("grows strictly rightward as depth increases, never left of the root", () => {
    const root = createNode("Root");
    for (let i = 0; i < 3; i++) {
      const branch = addChild(root, `Branch ${i}`);
      addChild(branch, `Leaf ${i}`);
    }

    const { positions } = computeLayout(root, fixedSize);
    const byDepth = new Map<number, number[]>();
    for (const { x, depth } of positions.values()) {
      (byDepth.get(depth) ?? byDepth.set(depth, []).get(depth)!).push(x);
    }

    expect(byDepth.get(0)).toEqual([0]);
    for (const x of byDepth.get(1) ?? []) expect(x).toBeGreaterThan(0);
    for (const x of byDepth.get(2) ?? []) expect(x).toBeGreaterThan(byDepth.get(1)![0]);
  });

  it("centers top-level branches vertically on the root", () => {
    const root = createNode("Root");
    addChild(root, "A");
    addChild(root, "B");

    const { positions } = computeLayout(root, fixedSize);
    const ys = [...positions.values()].filter((p) => p.depth === 1).map((p) => p.y);
    expect(ys[0] + ys[1]).toBeCloseTo(0);
  });

  it("gives a wider node's children more horizontal clearance", () => {
    const root = createNode("Root");
    const wide = addChild(root, "Wide");
    const wideChild = addChild(wide, "Wide's child");

    const getSize: GetSize = (node) => ({
      width: node.id === wide.id ? 400 : NODE_WIDTH,
      height: NODE_HEIGHT,
    });

    const { positions } = computeLayout(root, getSize);
    const wideLayout = positions.get(wide.id)!;
    const childLayout = positions.get(wideChild.id)!;
    expect(childLayout.x).toBeGreaterThanOrEqual(wideLayout.x + 400);
  });

  it("reserves at least a node's own height even with smaller children", () => {
    const root = createNode("Root");
    const tall = addChild(root, "Tall");
    addChild(tall, "small child");

    const getSize: GetSize = (node) => ({
      width: NODE_WIDTH,
      height: node.id === tall.id ? 200 : 20,
    });

    const { positions } = computeLayout(root, getSize);
    // The child's own slice (20) is far smaller than the parent's height
    // (200), so the parent's height should govern the reserved vertical
    // space rather than being clipped to the child's.
    const tallLayout = positions.get(tall.id)!;
    expect(tallLayout.height).toBe(200);
  });

  it("lets a node's own color override its inherited branch color", () => {
    const root = createNode("Root");
    const branch = addChild(root, "Branch");
    const recolored = addChild(branch, "Recolored");
    recolored.color = "#123456";
    const sibling = addChild(branch, "Sibling");

    const { positions } = computeLayout(root, fixedSize);
    expect(positions.get(recolored.id)!.color).toBe("#123456");
    expect(positions.get(sibling.id)!.color).toBe(positions.get(branch.id)!.color);
  });

  it("shifts a dragged node and its descendants by its offset", () => {
    const root = createNode("Root");
    const branch = addChild(root, "Branch");
    const leaf = addChild(branch, "Leaf");
    branch.offset = { dx: 30, dy: -12 };

    const { positions } = computeLayout(root, fixedSize);
    const branchDefault = positions.get(branch.id)!;
    const leafDefault = positions.get(leaf.id)!;

    // Recompute without the offset to get the baseline position.
    branch.offset = undefined;
    const baseline = computeLayout(root, fixedSize);
    const branchBase = baseline.positions.get(branch.id)!;
    const leafBase = baseline.positions.get(leaf.id)!;

    expect(branchDefault.x - branchBase.x).toBeCloseTo(30);
    expect(branchDefault.y - branchBase.y).toBeCloseTo(-12);
    // The offset cascades to descendants too.
    expect(leafDefault.x - leafBase.x).toBeCloseTo(30);
    expect(leafDefault.y - leafBase.y).toBeCloseTo(-12);
  });

  it("does not let a dragged node's offset disturb its siblings", () => {
    const root = createNode("Root");
    const a = addChild(root, "A");
    const b = addChild(root, "B");
    const before = computeLayout(root, fixedSize);
    const bBefore = before.positions.get(b.id)!;

    a.offset = { dx: 50, dy: 50 };
    const after = computeLayout(root, fixedSize);
    const bAfter = after.positions.get(b.id)!;

    expect(bAfter).toEqual(bBefore);
  });
});
