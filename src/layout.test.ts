import { describe, expect, it } from "vitest";
import { addChild, createNode } from "./model";
import { computeLayout } from "./layout";

const NODE_HEIGHT = 40;

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
    const { positions, edges } = computeLayout(root);
    expect(positions.size).toBe(1);
    expect(edges).toHaveLength(0);
    expect(positions.get(root.id)).toMatchObject({ x: 0, y: 0, side: "root" });
  });

  it("lays out 5 nodes with no overlapping siblings", () => {
    const root = createNode("Root");
    for (let i = 0; i < 4; i++) addChild(root, `Child ${i}`);

    const { positions, edges } = computeLayout(root);
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

    const { positions, edges } = computeLayout(root);
    expect(positions.size).toBe(1 + 5 + 15);
    expect(edges).toHaveLength(5 + 15);
    expectNoOverlap(positions);
  });

  it("balances branches across both sides instead of piling them on one", () => {
    const root = createNode("Root");
    for (let i = 0; i < 6; i++) addChild(root, `Child ${i}`);

    const { positions } = computeLayout(root);
    const sides = [...positions.values()].filter((p) => p.side !== "root").map((p) => p.side);
    const leftCount = sides.filter((s) => s === "left").length;
    const rightCount = sides.filter((s) => s === "right").length;
    expect(leftCount).toBe(3);
    expect(rightCount).toBe(3);
  });

  it("shifts a dragged node and its descendants by its offset", () => {
    const root = createNode("Root");
    const branch = addChild(root, "Branch");
    const leaf = addChild(branch, "Leaf");
    branch.offset = { dx: 30, dy: -12 };

    const { positions } = computeLayout(root);
    const branchDefault = positions.get(branch.id)!;
    const leafDefault = positions.get(leaf.id)!;

    // Recompute without the offset to get the baseline position.
    branch.offset = undefined;
    const baseline = computeLayout(root);
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
    const before = computeLayout(root);
    const bBefore = before.positions.get(b.id)!;

    a.offset = { dx: 50, dy: 50 };
    const after = computeLayout(root);
    const bAfter = after.positions.get(b.id)!;

    expect(bAfter).toEqual(bBefore);
  });
});
