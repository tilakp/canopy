import { describe, expect, it } from "vitest";
import { addChild, createNode, moveSibling, reparentNode } from "./model";

describe("moveSibling", () => {
  it("swaps a node with the next sibling", () => {
    const root = createNode("Root");
    const a = addChild(root, "A");
    const b = addChild(root, "B");

    expect(moveSibling(root, a.id, 1)).toBe(true);
    expect(root.children).toEqual([b, a]);
  });

  it("swaps a node with the previous sibling", () => {
    const root = createNode("Root");
    const a = addChild(root, "A");
    const b = addChild(root, "B");

    expect(moveSibling(root, b.id, -1)).toBe(true);
    expect(root.children).toEqual([b, a]);
  });

  it("is a no-op at the start or end of the sibling list", () => {
    const root = createNode("Root");
    const a = addChild(root, "A");
    const b = addChild(root, "B");

    expect(moveSibling(root, a.id, -1)).toBe(false);
    expect(moveSibling(root, b.id, 1)).toBe(false);
    expect(root.children).toEqual([a, b]);
  });

  it("is a no-op for the root (it has no parent/siblings)", () => {
    const root = createNode("Root");
    addChild(root, "A");

    expect(moveSibling(root, root.id, 1)).toBe(false);
  });
});

describe("reparentNode", () => {
  it("moves a node from one parent to another, appended as the last child", () => {
    const root = createNode("Root");
    const branchA = addChild(root, "A");
    const branchB = addChild(root, "B");
    const existingChild = addChild(branchB, "B-child");
    branchA.offset = { dx: 10, dy: 10 };

    expect(reparentNode(root, branchA.id, branchB.id)).toBe(true);
    expect(root.children).toEqual([branchB]);
    expect(branchB.children).toEqual([existingChild, branchA]);
    expect(branchA.offset).toBeUndefined();
  });

  it("refuses to move the root", () => {
    const root = createNode("Root");
    const a = addChild(root, "A");
    expect(reparentNode(root, root.id, a.id)).toBe(false);
  });

  it("refuses to drop a node onto itself or its own descendant (would cycle)", () => {
    const root = createNode("Root");
    const branch = addChild(root, "Branch");
    const grandchild = addChild(branch, "Grandchild");

    expect(reparentNode(root, branch.id, branch.id)).toBe(false);
    expect(reparentNode(root, branch.id, grandchild.id)).toBe(false);
    expect(root.children).toEqual([branch]);
    expect(branch.children).toEqual([grandchild]);
  });
});
