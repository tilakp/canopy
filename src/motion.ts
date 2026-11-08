// Movement between renders. A render draws every node at its final place;
// these functions move nodes for a moment without a render: the slide to a
// new place after a change, and the drag preview while a node follows the
// pointer.
import type { NodeLayout } from "./layout";
import { edgePath, type EdgeStyle } from "./edges";

interface Point {
  x: number;
  y: number;
}

// Where each node was last shown, per canvas, so the next render can slide
// nodes from there.
interface Motion {
  shown: Map<string, Point>;
  frame: number | null;
}
const motions = new WeakMap<HTMLElement, Motion>();

function motionOf(canvas: HTMLElement): Motion {
  let motion = motions.get(canvas);
  if (!motion) {
    motion = { shown: new Map(), frame: null };
    motions.set(canvas, motion);
  }
  return motion;
}

export function motionAllowed(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    typeof requestAnimationFrame === "function" &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

const SLIDE_MS = 220;
// Past this many moving nodes the slide costs more per frame than it is
// worth to watch, so the nodes go straight to their places.
const MAX_SLIDING_NODES = 300;

interface Slide {
  el: SVGGElement;
  dx: number;
  dy: number;
  fade: boolean;
}

// After a render: each node that was shown somewhere else a moment ago is
// moved back there with a transform and eases home; a new node comes out
// of its parent's old place and fades in. Lines between moving nodes are
// redrawn every frame.
export function slideNodes(
  canvas: HTMLElement,
  content: SVGGElement,
  positions: Map<string, NodeLayout>,
  parents: Map<string, string>,
  edgeStyle: EdgeStyle,
  animate: boolean,
): void {
  const motion = motionOf(canvas);
  if (motion.frame !== null) cancelAnimationFrame(motion.frame);
  motion.frame = null;
  const previous = motion.shown;
  const shown = new Map<string, Point>();
  for (const [id, p] of positions) shown.set(id, { x: p.x, y: p.y });
  motion.shown = shown;
  if (!animate || previous.size === 0) return;

  const slides = new Map<string, Slide>();
  for (const el of content.querySelectorAll<SVGGElement>(":scope > .mm-node")) {
    const id = el.dataset.nodeId!;
    const to = positions.get(id)!;
    let from = previous.get(id);
    let fade = false;
    if (!from) {
      const parentId = parents.get(id);
      from = parentId ? previous.get(parentId) : undefined;
      if (!from) continue;
      fade = true;
    }
    const dx = from.x - to.x;
    const dy = from.y - to.y;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && !fade) continue;
    slides.set(id, { el, dx, dy, fade });
  }
  if (slides.size === 0 || slides.size > MAX_SLIDING_NODES) return;

  const edges = [...content.querySelectorAll<SVGPathElement>(":scope > path.mm-edge")].filter(
    (el) => slides.has(el.dataset.from!) || slides.has(el.dataset.to!),
  );
  const shift = { fromDx: 0, fromDy: 0, toDx: 0, toDy: 0 };
  const start = performance.now();

  const step = (now: number) => {
    const t = Math.min(1, (now - start) / SLIDE_MS);
    const left = (1 - t) ** 3; // the part of the move still to go, eased out
    for (const [id, slide] of slides) {
      slide.el.setAttribute("transform", t < 1 ? `translate(${slide.dx * left} ${slide.dy * left})` : "");
      // A node outside a focused branch is dimmed by CSS; fading it would
      // override that, so it appears at once.
      if (slide.fade && !slide.el.classList.contains("mm-dimmed")) slide.el.style.opacity = t < 1 ? String(t) : "";
      const p = positions.get(id)!;
      const point = shown.get(id)!;
      point.x = p.x + slide.dx * left;
      point.y = p.y + slide.dy * left;
    }
    for (const el of edges) {
      const from = slides.get(el.dataset.from!);
      const to = slides.get(el.dataset.to!);
      shift.fromDx = (from?.dx ?? 0) * left;
      shift.fromDy = (from?.dy ?? 0) * left;
      shift.toDx = (to?.dx ?? 0) * left;
      shift.toDy = (to?.dy ?? 0) * left;
      el.setAttribute("d", edgePath(positions.get(el.dataset.from!)!, positions.get(el.dataset.to!)!, edgeStyle, shift));
      if (to?.fade && !el.classList.contains("mm-dimmed")) el.style.opacity = t < 1 ? String(t) : "";
    }
    motion.frame = t < 1 ? requestAnimationFrame(step) : null;
  };
  step(start);
}

export interface DragPreview {
  // Moves the dragged nodes by (dx, dy) world units from where the last
  // render drew them.
  move(dx: number, dy: number): void;
}

// A node drag moves the dragged subtrees and nothing else (an offset does
// not change how siblings stack), so instead of a render per pointer move
// it moves their elements and redraws only the lines into them. The render
// at the end of the drag draws the real result. Null when the drag cannot
// be previewed this way (hand-drawn lines are not paths), so the caller
// renders instead.
export function startDragPreview(
  canvas: HTMLElement,
  moving: ReadonlySet<string>,
  positions: Map<string, NodeLayout>,
  edgeStyle: EdgeStyle,
): DragPreview | null {
  const content = canvas.querySelector<SVGGElement>("svg.mm-canvas > g");
  if (!content || content.querySelector(".mm-sketchy-edge")) return null;
  const nodes = [...content.querySelectorAll<SVGGElement>(":scope > .mm-node")].filter((el) =>
    moving.has(el.dataset.nodeId!),
  );
  const inner: SVGPathElement[] = [];
  const crossing: SVGPathElement[] = [];
  for (const el of content.querySelectorAll<SVGPathElement>(":scope > path.mm-edge")) {
    const fromMoves = moving.has(el.dataset.from!);
    const toMoves = moving.has(el.dataset.to!);
    if (fromMoves && toMoves) inner.push(el);
    else if (fromMoves || toMoves) crossing.push(el);
  }
  const shown = motionOf(canvas).shown;
  return {
    move(dx, dy) {
      const transform = `translate(${dx} ${dy})`;
      for (const el of nodes) el.setAttribute("transform", transform);
      for (const el of inner) el.setAttribute("transform", transform);
      for (const el of crossing) {
        const fromMoves = moving.has(el.dataset.from!);
        const shift = fromMoves ? { fromDx: dx, fromDy: dy, toDx: 0, toDy: 0 } : { fromDx: 0, fromDy: 0, toDx: dx, toDy: dy };
        el.setAttribute("d", edgePath(positions.get(el.dataset.from!)!, positions.get(el.dataset.to!)!, edgeStyle, shift));
      }
      // The render after the drag must not slide these nodes back from
      // where they were before it.
      for (const id of moving) {
        const p = positions.get(id);
        if (p) shown.set(id, { x: p.x + dx, y: p.y + dy });
      }
    },
  };
}
