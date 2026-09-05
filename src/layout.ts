import type { MindMapNode } from "./model";

export type Side = "root" | "branch";

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
const V_GAP = 20;
const H_GAP = 200;
const ROOT_COLOR = "#2E2C34";

const PALETTE = ["#4C6EF5", "#12B886", "#F59F00", "#E64980", "#7048E8", "#15AABF", "#82C91E"];

function subtreeHeight(node: MindMapNode): number {
  if (node.children.length === 0) return NODE_HEIGHT;
  const childrenHeight = node.children.reduce((sum, child) => sum + subtreeHeight(child), 0);
  return childrenHeight + V_GAP * (node.children.length - 1);
}

// Positions `node` and its descendants in a single vertical stack, growing
// rightward from the root. `yTop` is the top of node's own slice.
function layoutSubtree(
  node: MindMapNode,
  x: number,
  yTop: number,
  depth: number,
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
  positions.set(node.id, { id: node.id, x: ox, y: oyTop + height / 2, depth, side: "branch", color });

  const childX = ox + H_GAP;
  let cursorY = oyTop;
  for (const child of node.children) {
    layoutSubtree(child, childX, cursorY, depth + 1, color, positions, edges);
    edges.push({ fromId: node.id, toId: child.id });
    cursorY += subtreeHeight(child) + V_GAP;
  }
}

// Computes a left-to-right tree layout: the root sits at the far left, and
// every branch stacks vertically, centered on the root, growing rightward
// as depth increases.
export function computeLayout(root: MindMapNode): LayoutResult {
  const positions = new Map<string, NodeLayout>();
  const edges: Edge[] = [];

  positions.set(root.id, { id: root.id, x: 0, y: 0, depth: 0, side: "root", color: ROOT_COLOR });
  if (root.children.length === 0) {
    return { positions, edges };
  }

  const colorByChildId = new Map(root.children.map((child, i) => [child.id, PALETTE[i % PALETTE.length]]));

  const totalHeight =
    root.children.reduce((sum, child) => sum + subtreeHeight(child), 0) + V_GAP * (root.children.length - 1);

  let cursorY = -totalHeight / 2;
  for (const child of root.children) {
    layoutSubtree(child, H_GAP, cursorY, 1, colorByChildId.get(child.id)!, positions, edges);
    edges.push({ fromId: root.id, toId: child.id });
    cursorY += subtreeHeight(child) + V_GAP;
  }

  return { positions, edges };
}
