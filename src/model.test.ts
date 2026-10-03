import { describe, expect, it } from "vitest";
import { addChild, cloneTree, countDescendants, createNode, cycleStatus, insertSiblingAfter, moveSibling, reparentNode, setCollapsedDeep, setImage, setLink } from "./model";

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

describe("cycleStatus", () => {
  it("cycles undefined -> todo -> done -> undefined", () => {
    const root = createNode("Root");
    const a = addChild(root, "A");

    cycleStatus(root, a.id);
    expect(a.status).toBe("todo");
    cycleStatus(root, a.id);
    expect(a.status).toBe("done");
    cycleStatus(root, a.id);
    expect(a.status).toBeUndefined();
  });

  it("is a no-op for an unknown id", () => {
    const root = createNode("Root");
    expect(() => cycleStatus(root, "missing")).not.toThrow();
  });
});

describe("setImage", () => {
  it("sets and clears a node's image", () => {
    const root = createNode("Root");
    const a = addChild(root, "A");

    setImage(root, a.id, "data:image/png;base64,abc");
    expect(a.image).toBe("data:image/png;base64,abc");

    setImage(root, a.id, undefined);
    expect(a.image).toBeUndefined();
  });
});

describe("insertSiblingAfter", () => {
  it("inserts directly after the node, not at the end of the list", () => {
    const root = createNode("Root");
    const a = addChild(root, "A");
    const b = addChild(root, "B");

    const added = insertSiblingAfter(root, a.id, "New")!;
    expect(root.children).toEqual([a, added, b]);
  });

  it("returns null for the root", () => {
    const root = createNode("Root");
    expect(insertSiblingAfter(root, root.id, "New")).toBeNull();
  });
});

describe("cloneTree", () => {
  it("makes a deep copy that does not share nodes, children or offsets", () => {
    const root = createNode("Root");
    const a = addChild(root, "A");
    a.offset = { dx: 1, dy: 2 };

    const copy = cloneTree(root);
    expect(copy).toEqual(root);
    copy.children[0].text = "changed";
    copy.children[0].offset!.dx = 99;
    copy.children.push(createNode("extra"));
    expect(a.text).toBe("A");
    expect(a.offset).toEqual({ dx: 1, dy: 2 });
    expect(root.children).toHaveLength(1);
  });
});

describe("countDescendants", () => {
  it("counts nodes at every level below the node", () => {
    const root = createNode("Root");
    const a = addChild(root, "A");
    addChild(addChild(a, "B"), "C");
    addChild(root, "D");

    expect(countDescendants(root)).toBe(4);
    expect(countDescendants(a)).toBe(2);
  });
});

describe("setCollapsedDeep", () => {
  it("folds or opens a node and every node below it that has children", () => {
    const root = createNode("Root");
    const a = addChild(root, "A");
    const b = addChild(a, "B");
    const leaf = addChild(b, "Leaf");

    setCollapsedDeep(root, true);
    expect([root.collapsed, a.collapsed, b.collapsed, leaf.collapsed]).toEqual([true, true, true, undefined]);

    setCollapsedDeep(root, false);
    expect([root.collapsed, a.collapsed, b.collapsed]).toEqual([false, false, false]);
  });

describe("setLink", () => {
  it("adds https:// to a link typed without a scheme, and keeps other schemes", () => {
    const root = createNode("Root");
    setLink(root, root.id, " example.com/page ");
    expect(root.link).toBe("https://example.com/page");
    setLink(root, root.id, "mailto:a@example.com");
    expect(root.link).toBe("mailto:a@example.com");
    setLink(root, root.id, "  ");
    expect(root.link).toBeUndefined();
  });
});
});
