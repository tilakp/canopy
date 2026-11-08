// How big each node is and how its text wraps: the one place a node's box
// size is computed. Layout gets sizes from here, drawing gets wrapped lines
// from here, and the title editor sizes itself the same way, so the three
// cannot disagree.
import { visibleChildren, type MindMapNode } from "./model";
import type { NodeSize } from "./layout";
import { wrapText, type WrappedText } from "./textwrap";

export interface BoxStyle {
  fontSize: number;
  fontWeight: number;
  maxTextWidth: number;
  paddingX: number;
  paddingY: number;
  lineHeight: number;
  rx: number;
}

// Three levels, so the map reads at a glance: the root is a white card,
// first-level branches are tinted pills, and deeper ideas are plain text on
// a line in the branch color. The font sizes and weights must match
// styles.css's .mm-root-text and .mm-*-text rules.
export type Tier = "root" | "branch" | "leaf";

const STYLES: Record<Tier, BoxStyle> = {
  root: { fontSize: 18, fontWeight: 650, maxTextWidth: 240, paddingX: 22, paddingY: 15, lineHeight: 24, rx: 14 },
  branch: { fontSize: 14.5, fontWeight: 600, maxTextWidth: 200, paddingX: 14, paddingY: 10, lineHeight: 20, rx: 10 },
  leaf: { fontSize: 14, fontWeight: 450, maxTextWidth: 220, paddingX: 6, paddingY: 7, lineHeight: 19, rx: 6 },
};

function tierOf(depth: number): Tier {
  return depth === 0 ? "root" : depth === 1 ? "branch" : "leaf";
}

export function fontString(style: BoxStyle, fontFamily: string): string {
  return `${style.fontWeight} ${style.fontSize}px ${fontFamily}`;
}

// Badge slots inside the box: the checklist circle before the text, the
// notes and link icons after it, so badges never sit on the text.
const STATUS_SLOT = 20;
export const META_ICON_SLOT = 18;
// A pasted image: a fixed-size thumbnail above the text.
export const IMAGE_THUMB_SIZE = 56;
export const IMAGE_GAP = 8;
// The narrowest a fixed width may squeeze the text, so a box never becomes
// a column of single letters.
const MIN_WRAP_WIDTH = 40;

export interface NodeVisual {
  tier: Tier;
  style: BoxStyle;
  wrapped: WrappedText;
  size: NodeSize;
  // Room inside the box before the text (checklist circle) and after it
  // (notes and link icons).
  leading: number;
  trailing: number;
  // The width the text wraps at.
  wrapWidth: number;
}

function nodeVisual(node: MindMapNode, depth: number, fontFamily: string): NodeVisual {
  const tier = tierOf(depth);
  const style = STYLES[tier];
  const displayText = (node.icon ? node.icon + " " : "") + (node.text || " ");
  const leading = node.status ? STATUS_SLOT : 0;
  const trailing = ((node.notes ? 1 : 0) + (node.link ? 1 : 0)) * META_ICON_SLOT;
  const chrome = style.paddingX * 2 + leading + trailing;
  const fixedTextWidth = node.width ? Math.max(MIN_WRAP_WIDTH, node.width - chrome) : null;
  const wrapWidth = fixedTextWidth ?? style.maxTextWidth;
  const wrapped = wrapText(displayText, fontString(style, fontFamily), wrapWidth);
  // A word longer than the fixed width still widens the box rather than
  // spilling out of it.
  const textWidth = Math.max(fixedTextWidth ?? 0, wrapped.width) + chrome;
  const textHeight = wrapped.lines.length * style.lineHeight + style.paddingY * 2;
  const size: NodeSize = node.image
    ? { width: Math.max(textWidth, IMAGE_THUMB_SIZE + style.paddingX * 2), height: textHeight + IMAGE_THUMB_SIZE + IMAGE_GAP }
    : { width: textWidth, height: textHeight };
  return { tier, style, wrapped, size, leading, trailing, wrapWidth };
}

// Every drawn node's visual, wrapped once per render and used for both
// layout (sizes) and drawing (lines), so the two cannot drift apart.
export function buildVisuals(root: MindMapNode, fontFamily: string): Map<string, NodeVisual> {
  const visuals = new Map<string, NodeVisual>();
  const visit = (node: MindMapNode, depth: number) => {
    visuals.set(node.id, nodeVisual(node, depth, fontFamily));
    for (const child of visibleChildren(node)) visit(child, depth + 1);
  };
  visit(root, 0);
  return visuals;
}

// Arrange: one box width per depth, the widest natural box at that depth,
// so the boxes in a column line up and the columns start at the same x.
// Folded nodes count too, so a branch opened later still fits. The root
// keeps its natural size; it is a column of its own.
export function computeArrangedWidths(root: MindMapNode, fontFamily: string): Map<string, number> {
  const columnWidth: number[] = [];
  const depthOf = new Map<string, number>();
  const visit = (node: MindMapNode, depth: number) => {
    if (depth > 0) {
      const natural = nodeVisual({ ...node, width: undefined }, depth, fontFamily).size.width;
      columnWidth[depth] = Math.max(columnWidth[depth] ?? 0, natural);
      depthOf.set(node.id, depth);
    }
    for (const child of node.children) visit(child, depth + 1);
  };
  visit(root, 0);
  return new Map([...depthOf].map(([id, depth]) => [id, Math.ceil(columnWidth[depth])]));
}
