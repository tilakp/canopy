import type { MindMapNode } from "./model";

export type Side = "root" | "branch";

export interface NodeSize {
  width: number;
  height: number;
}

export interface NodeLayout {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
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

const V_GAP = 20;
const H_GAP = 56;
const ROOT_COLOR = "#2E2C34";

const PALETTE = ["#4C6EF5", "#12B886", "#F59F00", "#E64980", "#7048E8", "#15AABF", "#82C91E"];

// Layout doesn't know about text/DOM measurement (that's render.ts's job,
// and jsdom-based tests fake it); it just needs each node's box size.
export type GetSize = (node: MindMapNode) => NodeSize;

function subtreeHeight(node: MindMapNode, getSize: GetSize): number {
  const ownHeight = getSize(node).height;
  if (node.children.length === 0) return ownHeight;
  const childrenHeight =
    node.children.reduce((sum, child) => sum + subtreeHeight(child, getSize), 0) +
    V_GAP * (node.children.length - 1);
  return Math.max(ownHeight, childrenHeight);
}

// Positions `node` and its descendants in a single vertical stack, growing
// rightward from the root. `yTop` is the top of node's own reserved slice.
function layoutSubtree(
  node: MindMapNode,
  x: number,
  yTop: number,
  depth: number,
  inheritedColor: string,
  getSize: GetSize,
  positions: Map<string, NodeLayout>,
  edges: Edge[],
): void {
  const color = node.color ?? inheritedColor;
  const size = getSize(node);
  const height = subtreeHeight(node, getSize);

  // A manual offset shifts this node and cascades to its descendants, but
  // leaves sibling stacking (which uses subtreeHeight, unaffected by offset)
  // alone.
  const ox = x + (node.offset?.dx ?? 0);
  const oyTop = yTop + (node.offset?.dy ?? 0);
  positions.set(node.id, {
    id: node.id,
    x: ox,
    y: oyTop + height / 2,
    width: size.width,
    height: size.height,
    depth,
    side: "branch",
    color,
  });

  const childX = ox + size.width + H_GAP;
  const childrenHeight =
    node.children.reduce((sum, child) => sum + subtreeHeight(child, getSize), 0) +
    V_GAP * (node.children.length - 1);
  let cursorY = oyTop + (height - childrenHeight) / 2;
  for (const child of node.children) {
    layoutSubtree(child, childX, cursorY, depth + 1, color, getSize, positions, edges);
    edges.push({ fromId: node.id, toId: child.id });
    cursorY += subtreeHeight(child, getSize) + V_GAP;
  }
}

// Computes a left-to-right tree layout: the root sits at the far left, and
// every branch stacks vertically, centered on the root, growing rightward
// as depth increases.
export function computeLayout(root: MindMapNode, getSize: GetSize): LayoutResult {
  const positions = new Map<string, NodeLayout>();
  const edges: Edge[] = [];

  const rootSize = getSize(root);
  positions.set(root.id, {
    id: root.id,
    x: 0,
    y: 0,
    width: rootSize.width,
    height: rootSize.height,
    depth: 0,
    side: "root",
    color: root.color ?? ROOT_COLOR,
  });
  if (root.children.length === 0) {
    return { positions, edges };
  }

  const totalHeight =
    root.children.reduce((sum, child) => sum + subtreeHeight(child, getSize), 0) +
    V_GAP * (root.children.length - 1);

  let cursorY = -totalHeight / 2;
  root.children.forEach((child, i) => {
    const startColor = child.color ?? PALETTE[i % PALETTE.length];
    layoutSubtree(child, rootSize.width + H_GAP, cursorY, 1, startColor, getSize, positions, edges);
    edges.push({ fromId: root.id, toId: child.id });
    cursorY += subtreeHeight(child, getSize) + V_GAP;
  });

  return { positions, edges };
}
