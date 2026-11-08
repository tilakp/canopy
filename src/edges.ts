// The geometry of the lines between nodes, shared by drawing and by the
// animations that redraw lines between moving nodes.
import type { NodeLayout } from "./layout";

export type EdgeStyle = "curved" | "straight";

// Where lines leave and reach a node: the middle of its right or left side
// for the root and branches, its underline for deeper ideas.
export function edgeAnchorY(layout: Pick<NodeLayout, "y" | "height" | "depth">): number {
  return layout.depth >= 2 ? layout.y + layout.height / 2 : layout.y;
}

// Lines get thinner further from the root, as branches of a tree do.
export function edgeWidth(fromDepth: number): number {
  return fromDepth === 0 ? 3 : fromDepth === 1 ? 2 : 1.5;
}

// The path from `from`'s right side to `to`'s left side. `dx`/`dy` shift
// either end, for a node that is being dragged or is sliding into place.
export function edgePath(
  from: NodeLayout,
  to: NodeLayout,
  style: EdgeStyle,
  shift = { fromDx: 0, fromDy: 0, toDx: 0, toDy: 0 },
): string {
  const x1 = from.x + from.width + shift.fromDx;
  const y1 = edgeAnchorY(from) + shift.fromDy;
  const x2 = to.x + shift.toDx;
  const y2 = edgeAnchorY(to) + shift.toDy;
  const midX = (x1 + x2) / 2;
  return style === "curved"
    ? `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`
    : `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`;
}
