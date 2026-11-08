import { visibleChildren, type MindMapNode } from "./model";
import { PALETTE, ROOT_COLOR } from "./colors";

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

// Layout doesn't know about text/DOM measurement (that's render.ts's job,
// and jsdom-based tests fake it); it just needs each node's box size.
export type GetSize = (node: MindMapNode) => NodeSize;

// One layout pass: the size callback, and each subtree's height computed
// once. Every level asks for its children's heights, so without the memo a
// deep branch is measured again at each level above it.
interface Pass {
  getSize: GetSize;
  heights: Map<MindMapNode, number>;
}

function subtreeHeight(node: MindMapNode, pass: Pass): number {
  let height = pass.heights.get(node);
  if (height === undefined) {
    const own = pass.getSize(node).height;
    height = Math.max(own, childrenHeight(visibleChildren(node), pass));
    pass.heights.set(node, height);
  }
  return height;
}

function childrenHeight(children: MindMapNode[], pass: Pass): number {
  if (children.length === 0) return 0;
  return children.reduce((sum, child) => sum + subtreeHeight(child, pass), 0) + V_GAP * (children.length - 1);
}

// Positions `node` and its descendants in a single vertical stack, growing
// rightward from the root. `yTop` is the top of node's own reserved slice.
// Places `node` and its subtree in a vertical stack growing rightward.
// `yTop` is the top of the slice of height reserved for the subtree.
function layoutSubtree(node: MindMapNode, x: number, yTop: number, depth: number, color: string, pass: Pass, out: LayoutResult): void {
  const size = pass.getSize(node);
  const height = subtreeHeight(node, pass);
  // A manual offset moves this node and its descendants, and leaves how the
  // siblings stack (subtreeHeight ignores offsets) alone.
  const nodeX = x + (node.offset?.dx ?? 0);
  const nodeTop = yTop + (node.offset?.dy ?? 0);
  out.positions.set(node.id, {
    id: node.id,
    x: nodeX,
    y: nodeTop + height / 2,
    width: size.width,
    height: size.height,
    depth,
    color,
  });
  layoutChildren(node, nodeX + size.width + H_GAP, nodeTop + height / 2, depth + 1, color, pass, out);
}

// Stacks a node's visible children, centered on `centerY`. Below the root,
// children inherit their parent's color; the root's children take one
// palette color each.
function layoutChildren(parent: MindMapNode, x: number, centerY: number, depth: number, color: string | null, pass: Pass, out: LayoutResult): void {
  const children = visibleChildren(parent);
  let cursorY = centerY - childrenHeight(children, pass) / 2;
  children.forEach((child, i) => {
    const childColor = child.color ?? color ?? PALETTE[i % PALETTE.length];
    layoutSubtree(child, x, cursorY, depth, childColor, pass, out);
    out.edges.push({ fromId: parent.id, toId: child.id });
    cursorY += subtreeHeight(child, pass) + V_GAP;
  });
}

// A left-to-right tree: the root at the far left with its center at (0, 0)
// and every branch stacked vertically around it, growing rightward.
export function computeLayout(root: MindMapNode, getSize: GetSize): LayoutResult {
  const out: LayoutResult = { positions: new Map(), edges: [] };
  const pass: Pass = { getSize, heights: new Map() };
  const rootSize = getSize(root);
  out.positions.set(root.id, {
    id: root.id,
    x: 0,
    y: 0,
    width: rootSize.width,
    height: rootSize.height,
    depth: 0,
    color: root.color ?? ROOT_COLOR,
  });
  layoutChildren(root, rootSize.width + H_GAP, 0, 1, null, pass, out);
  return out;
}
