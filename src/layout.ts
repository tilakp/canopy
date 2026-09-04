import type { MindMapNode } from "./model";

export type Side = "left" | "right" | "root";

export interface NodeLayout {
  id: string;
  x: number;
  y: number;
  depth: number;
  side: Side;
  color: string;
}

export interface Edge {
  fromId: string;
  toId: string;
}

export interface LayoutResult {
  positions: Map<string, NodeLayout>;
  edges: Edge[];
}

const NODE_HEIGHT = 40;
const V_GAP = 16;
const H_GAP = 180;
const ROOT_COLOR = "#333333";

const PALETTE = ["#f4b942", "#4a90d9", "#2ec4b6", "#8a5cf6", "#e0479e", "#ff6b6b", "#6bbf59"];

function subtreeHeight(node: MindMapNode): number {
  if (node.children.length === 0) return NODE_HEIGHT;
  const childrenHeight = node.children.reduce((sum, child) => sum + subtreeHeight(child), 0);
  return childrenHeight + V_GAP * (node.children.length - 1);
}

// Positions `node` and its descendants in a single vertical stack, growing
// away from the root along `side`. `yTop` is the top of node's own slice.
function layoutSubtree(
  node: MindMapNode,
  x: number,
  yTop: number,
  depth: number,
  side: Side,
  color: string,
  positions: Map<string, NodeLayout>,
  edges: Edge[],
): void {
  const height = subtreeHeight(node);
  // A manual offset shifts this node and cascades to its descendants, but
  // leaves sibling stacking (which uses subtreeHeight, unaffected by offset)
  // alone.
  const ox = x + (node.offset?.dx ?? 0);
  const oyTop = yTop + (node.offset?.dy ?? 0);
  positions.set(node.id, { id: node.id, x: ox, y: oyTop + height / 2, depth, side, color });

  const dir = side === "left" ? -1 : 1;
  const childX = ox + H_GAP * dir;
  let cursorY = oyTop;
  for (const child of node.children) {
    layoutSubtree(child, childX, cursorY, depth + 1, side, color, positions, edges);
    edges.push({ fromId: node.id, toId: child.id });
    cursorY += subtreeHeight(child) + V_GAP;
  }
}

// Lays out one side's top-level branches, stacked and centered on y = 0.
function layoutSide(
  root: MindMapNode,
  branches: MindMapNode[],
  colorByChildId: Map<string, string>,
  side: "left" | "right",
  positions: Map<string, NodeLayout>,
  edges: Edge[],
): void {
  if (branches.length === 0) return;
  const totalHeight =
    branches.reduce((sum, branch) => sum + subtreeHeight(branch), 0) + V_GAP * (branches.length - 1);
  const dir = side === "left" ? -1 : 1;
  const x = H_GAP * dir;

  let cursorY = -totalHeight / 2;
  for (const branch of branches) {
    layoutSubtree(branch, x, cursorY, 1, side, colorByChildId.get(branch.id)!, positions, edges);
    edges.push({ fromId: root.id, toId: branch.id });
    cursorY += subtreeHeight(branch) + V_GAP;
  }
}

// Computes a radial mindmap layout: the root sits at the origin, its
// top-level children are split left/right (balanced by subtree size), and
// each side is stacked top-to-bottom and centered vertically.
export function computeLayout(root: MindMapNode): LayoutResult {
  const positions = new Map<string, NodeLayout>();
  const edges: Edge[] = [];

  positions.set(root.id, { id: root.id, x: 0, y: 0, depth: 0, side: "root", color: ROOT_COLOR });
  if (root.children.length === 0) {
    return { positions, edges };
  }

  const colorByChildId = new Map(
    root.children.map((child, i) => [child.id, PALETTE[i % PALETTE.length]]),
  );

  const byHeightDesc = [...root.children].sort((a, b) => subtreeHeight(b) - subtreeHeight(a));
  const left: MindMapNode[] = [];
  const right: MindMapNode[] = [];
  let leftHeight = 0;
  let rightHeight = 0;
  for (const child of byHeightDesc) {
    const height = subtreeHeight(child);
    if (leftHeight <= rightHeight) {
      left.push(child);
      leftHeight += height + V_GAP;
    } else {
      right.push(child);
      rightHeight += height + V_GAP;
    }
  }

  layoutSide(root, left, colorByChildId, "left", positions, edges);
  layoutSide(root, right, colorByChildId, "right", positions, edges);

  return { positions, edges };
}
