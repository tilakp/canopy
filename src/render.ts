import rough from "roughjs";
import type { RoughSVG } from "roughjs/bin/svg";
import { countDescendants, findNode, findParent, type MindMapNode } from "./model";
import { computeLayout, type Edge, type NodeLayout, type NodeSize } from "./layout";
import { wrapText, type WrappedText } from "./textwrap";
import { getTheme } from "./theme";
import { getFontFamily } from "./fonts";

const SVG_NS = "http://www.w3.org/2000/svg";

interface BoxStyle {
  fontSize: number;
  fontWeight: number;
  maxTextWidth: number;
  paddingX: number;
  paddingY: number;
  lineHeight: number;
  rx: number;
}

// Three levels, so the map reads at a glance: the root is a white card,
// first-level branches are tinted pills, and deeper ideas are plain text
// on a line in the branch color.
const ROOT_STYLE: BoxStyle = {
  fontSize: 18,
  fontWeight: 650,
  maxTextWidth: 240,
  paddingX: 22,
  paddingY: 15,
  lineHeight: 24,
  rx: 14,
};

const BRANCH_STYLE: BoxStyle = {
  fontSize: 14.5,
  fontWeight: 600,
  maxTextWidth: 200,
  paddingX: 14,
  paddingY: 10,
  lineHeight: 20,
  rx: 10,
};

const LEAF_STYLE: BoxStyle = {
  fontSize: 14,
  fontWeight: 450,
  maxTextWidth: 220,
  paddingX: 6,
  paddingY: 7,
  lineHeight: 19,
  rx: 6,
};

function styleFor(depth: number): BoxStyle {
  return depth === 0 ? ROOT_STYLE : depth === 1 ? BRANCH_STYLE : LEAF_STYLE;
}

// The selection ring sits this far outside the node.
const RING_GAP = 4;

const ADD_BUTTON_GAP = 14;
const ADD_BUTTON_RADIUS = 9;
// The fold control sits where a node's edges leave its box. An open node
// shows a "−" button there (on hover or selection only); a folded node
// shows a pill with the number of hidden ideas.
const FOLD_BUTTON_RADIUS = 9;
const FOLD_BUTTON_OFFSET = 12; // from the box's right edge to the button's center
const FOLD_PILL_GAP = 4; // from the box's right edge to the pill
const FOLD_PILL_HEIGHT = 18;
// WCAG 2.5.8: pointer targets at least 24x24px.
const MIN_TARGET = 24;
// Extra horizontal room before the add-button for an open node's fold
// button, so the two circles don't overlap.
const FOLD_BUTTON_CLEARANCE = 20;

// A pasted image is drawn as a small fixed-size thumbnail stacked above the
// node's text, with a gap between the two.
const IMAGE_THUMB_SIZE = 56;
const IMAGE_GAP = 8;

export type EdgeStyle = "curved" | "straight";

export interface Camera {
  x: number;
  y: number;
  scale: number;
}

export interface RenderState {
  selectedIds: ReadonlySet<string>;
  editingId: string | null;
  notesEditingId?: string | null;
  iconEditingId?: string | null;
  linkEditingId?: string | null;
  edgeStyle: EdgeStyle;
  sketchy?: boolean;
  focusId?: string | null;
  camera?: Camera;
  dropTargetId?: string | null;
  // A node that was just opened: its newly visible nodes play the reveal
  // animation. Set for one render only.
  revealId?: string | null;
  // A node that was just folded: its count pill plays the pop animation.
  popId?: string | null;
  // Nodes that moved since the last render slide from where they were.
  animate?: boolean;
}

export interface RenderCallbacks {
  // `next` says which key ended the edit: Enter asks for a sibling after
  // it, Tab for a child. The app decides whether to act on it.
  onEditCommit(id: string, text: string, next?: "sibling" | "child"): void;
  onEditCancel(): void;
  onNotesCommit(id: string, notes: string): void;
  onNotesCancel(): void;
  onIconCommit(id: string, icon: string): void;
  onIconCancel(): void;
  onLinkCommit(id: string, link: string): void;
  onLinkCancel(): void;
}

export interface RenderResult {
  camera: Camera;
  positions: Map<string, NodeLayout>;
  contentBBox: DOMRect;
}

interface NodeVisual {
  wrapped: WrappedText;
  style: BoxStyle;
  size: NodeSize;
  // Room inside the box before the text (checklist circle) and after it
  // (notes and link icons), so badges never sit on top of the text.
  leading: number;
  trailing: number;
}

const STATUS_SLOT = 20;
const META_ICON_SLOT = 18;

function fontString(style: BoxStyle): string {
  return `${style.fontWeight} ${style.fontSize}px ${getFontFamily()}`;
}

// Wraps every node's text once and derives its box size from that, so the
// same wrapped lines are reused for both layout (sizing) and drawing —
// there's no separate DOM-measurement pass to go out of sync with.
function buildVisuals(root: MindMapNode): Map<string, NodeVisual> {
  const visuals = new Map<string, NodeVisual>();
  const visit = (node: MindMapNode, depth: number) => {
    visuals.set(node.id, nodeVisual(node, depth));
    if (!node.collapsed) for (const child of node.children) visit(child, depth + 1);
  };
  visit(root, 0);
  return visuals;
}

// The narrowest a fixed width may squeeze the text, so a box never becomes
// a column of single letters.
const MIN_WRAP_WIDTH = 40;

function nodeVisual(node: MindMapNode, depth: number): NodeVisual {
  const style = styleFor(depth);
  const displayText = (node.icon ? node.icon + " " : "") + (node.text || " ");
  const leading = node.status ? STATUS_SLOT : 0;
  const trailing = ((node.notes ? 1 : 0) + (node.link ? 1 : 0)) * META_ICON_SLOT;
  const chrome = style.paddingX * 2 + leading + trailing;
  const fixedTextWidth = node.width ? Math.max(MIN_WRAP_WIDTH, node.width - chrome) : null;
  const wrapped = wrapText(displayText, fontString(style), fixedTextWidth ?? style.maxTextWidth);
  // A word longer than the fixed width still widens the box rather than
  // spilling out of it.
  const textWidth = Math.max(fixedTextWidth ?? 0, wrapped.width) + chrome;
  const textHeight = wrapped.lines.length * style.lineHeight + style.paddingY * 2;
  const size: NodeSize = node.image
    ? {
        width: Math.max(textWidth, IMAGE_THUMB_SIZE + style.paddingX * 2),
        height: textHeight + IMAGE_THUMB_SIZE + IMAGE_GAP,
      }
    : { width: textWidth, height: textHeight };
  return { wrapped, style, size, leading, trailing };
}

// Arrange: one box width per depth, the widest natural box at that depth,
// so the boxes in a column line up and the columns start at the same x.
// Hidden (folded) nodes count too, so a branch opened later still fits.
// The root keeps its natural size; it is a column of its own.
export function computeArrangedWidths(root: MindMapNode): Map<string, number> {
  const columnWidth: number[] = [];
  const depthOf = new Map<string, number>();
  const visit = (node: MindMapNode, depth: number) => {
    if (depth > 0) {
      const natural = nodeVisual({ ...node, width: undefined }, depth).size.width;
      columnWidth[depth] = Math.max(columnWidth[depth] ?? 0, natural);
      depthOf.set(node.id, depth);
    }
    for (const child of node.children) visit(child, depth + 1);
  };
  visit(root, 0);
  return new Map([...depthOf].map(([id, depth]) => [id, Math.ceil(columnWidth[depth])]));
}

export function renderMindMap(
  container: HTMLElement,
  root: MindMapNode,
  state: RenderState,
  callbacks: RenderCallbacks,
): RenderResult {
  // An editor that is open across a full render (a zoom while typing, for
  // example) is rebuilt from the saved node, which would drop what was typed
  // so far. Its draft, caret and focus are carried over to the new editor.
  const draft = captureDraft(container);
  container.innerHTML = "";

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "mm-canvas");
  const content = document.createElementNS(SVG_NS, "g");
  svg.appendChild(content);
  container.appendChild(svg);

  const visuals = buildVisuals(root);
  const { positions, edges } = computeLayout(root, (node) => visuals.get(node.id)!.size);
  const rc = state.sketchy ? rough.svg(svg) : null;
  const focusSet = state.focusId ? computeFocusSet(root, state.focusId) : null;
  const animate = !!state.animate && !state.sketchy && motionAllowed();
  // The slide-in from moveNodes covers a branch that opens, so the CSS
  // reveal is only for when there is no slide.
  const revealNode = state.revealId && !animate ? findNode(root, state.revealId) : null;
  const revealSet = new Set(revealNode ? [...iterateNodes(revealNode)].map((n) => n.id) : []);
  revealSet.delete(state.revealId ?? "");

  for (const edge of edges) {
    const dimmed = focusSet !== null && (!focusSet.has(edge.fromId) || !focusSet.has(edge.toId));
    const edgeEl = renderEdge(edge, positions, state.edgeStyle, rc, dimmed);
    edgeEl.dataset.from = edge.fromId;
    edgeEl.dataset.to = edge.toId;
    if (revealSet.has(edge.toId)) edgeEl.classList.add("mm-revealing");
    content.appendChild(edgeEl);
  }

  for (const node of iterateNodes(root)) {
    const layout = positions.get(node.id)!;
    const visual = visuals.get(node.id)!;
    renderNode(
      content,
      node,
      layout,
      visual,
      state.selectedIds,
      state.editingId,
      node.id === state.dropTargetId,
      rc,
      focusSet !== null && !focusSet.has(node.id),
      node.id === state.popId,
    );
    if (revealSet.has(node.id)) content.lastElementChild!.classList.add("mm-revealing");
  }

  const contentBBox = safeBBox(content);
  const camera = state.camera ?? computeInitialCamera(container, contentBBox, root.children.length === 0);
  content.setAttribute("transform", cameraTransform(camera));
  syncGrid(container, camera);
  // After the bounding box is measured: the slide moves nodes for a moment,
  // and the box must be where they end.
  moveNodes(container, content, root, positions, state.edgeStyle, animate);

  // A blank map says how to start. Added after the bounding box is
  // measured, so it does not move where a new map is placed.
  if (root.children.length === 0 && !state.editingId) {
    const rootLayout = positions.get(root.id)!;
    const hint = document.createElementNS(SVG_NS, "text");
    hint.setAttribute("class", "mm-empty-hint");
    hint.setAttribute("x", String(rootLayout.x));
    hint.setAttribute("y", String(rootLayout.y + rootLayout.height / 2 + 28));
    hint.textContent = "Press Tab to add your first idea, or ? for all shortcuts";
    content.appendChild(hint);
  }

  if (state.editingId) {
    const node = findNode(root, state.editingId);
    const layout = node && positions.get(node.id);
    const visual = node && visuals.get(node.id);
    if (node && layout && visual) {
      renderEditOverlay(container, node, layout, visual, !!state.sketchy, camera, callbacks);
    }
  }

  if (state.notesEditingId) {
    const node = findNode(root, state.notesEditingId);
    const layout = node && positions.get(node.id);
    if (node && layout) {
      renderNotesOverlay(container, node, layout, camera, callbacks);
    }
  }

  if (state.iconEditingId) {
    const node = findNode(root, state.iconEditingId);
    const layout = node && positions.get(node.id);
    if (node && layout) {
      renderInlineTextOverlay(
        container,
        layout,
        camera,
        `icon:${node.id}`,
        "Icon",
        node.icon ?? "",
        "An emoji, e.g. 🚀",
        180,
        (value) => callbacks.onIconCommit(node.id, value),
        callbacks.onIconCancel,
      );
    }
  }

  if (state.linkEditingId) {
    const node = findNode(root, state.linkEditingId);
    const layout = node && positions.get(node.id);
    if (node && layout) {
      renderInlineTextOverlay(
        container,
        layout,
        camera,
        `link:${node.id}`,
        "Link",
        node.link ?? "",
        "https://…",
        260,
        (value) => callbacks.onLinkCommit(node.id, value),
        callbacks.onLinkCancel,
      );
    }
  }

  if (draft) restoreDraft(container, draft);
  return { camera, positions, contentBBox };
}

interface EditorDraft {
  key: string;
  value: string;
  selectionStart: number | null;
  selectionEnd: number | null;
  focused: boolean;
}

function captureDraft(container: HTMLElement): EditorDraft | null {
  const field = container.querySelector<HTMLInputElement | HTMLTextAreaElement>("[data-editor]");
  if (!field) return null;
  // Chrome fires blur on a focused element while the render removes it, and
  // the element still counts as connected then. This mark tells the
  // editor's blur handler that the blur is not "clicked away".
  field.dataset.rebuilding = "true";
  return {
    key: field.dataset.editor!,
    value: field.value,
    selectionStart: field.selectionStart,
    selectionEnd: field.selectionEnd,
    focused: document.activeElement === field,
  };
}

// False for a blur caused by a render removing the editor (see
// captureDraft) or by Enter/Escape having already ended the edit.
function isUserBlur(field: HTMLElement): boolean {
  return field.isConnected && field.dataset.rebuilding !== "true";
}

function restoreDraft(container: HTMLElement, draft: EditorDraft): void {
  const field = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-editor="${draft.key}"]`);
  if (!field) return;
  field.value = draft.value;
  // Lets the editor resize itself to the restored text.
  field.dispatchEvent(new Event("input"));
  if (draft.focused) field.focus();
  if (draft.selectionStart !== null && draft.selectionEnd !== null) {
    field.setSelectionRange(draft.selectionStart, draft.selectionEnd);
  }
}

function cameraTransform(camera: Camera): string {
  return `translate(${camera.x} ${camera.y}) scale(${camera.scale})`;
}

// Re-aims the camera on an already-rendered canvas without rebuilding it.
// The camera is the *only* camera-dependent thing in a render: computeLayout
// works entirely in world coordinates, so scale/pan affect nothing but this
// one transform attribute on the content group. Returns false if nothing has
// been rendered into `container` yet, so the caller can fall back to a full
// render.
export function applyCamera(container: HTMLElement, camera: Camera): boolean {
  const content = container.querySelector<SVGGElement>("svg.mm-canvas > g");
  if (!content) return false;
  content.setAttribute("transform", cameraTransform(camera));
  syncGrid(container, camera);
  return true;
}

// The dot grid (styles.css, .mm-grid) moves and scales with the map. At a
// small zoom every other dot is left out, so the grid does not turn grey.
const GRID_SPACING = 22;

function syncGrid(container: HTMLElement, camera: Camera): void {
  const size = GRID_SPACING * camera.scale * (camera.scale < 0.5 ? 2 : 1);
  container.style.backgroundSize = `${size}px ${size}px`;
  container.style.backgroundPosition = `${camera.x}px ${camera.y}px`;
}

function motionAllowed(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    typeof requestAnimationFrame === "function" &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

// Where each node was last shown, per canvas, so the next render can slide
// nodes from there to their new places.
interface Motion {
  shown: Map<string, { x: number; y: number }>;
  frame: number | null;
}
const motions = new WeakMap<HTMLElement, Motion>();
const MOVE_MS = 220;

// Every render rebuilds the SVG with nodes at their final places. A node
// that was somewhere else a moment ago is moved back there with a
// transform and slides home; a new node slides out from its parent and
// fades in. The lines are redrawn each frame between the moving ends.
function moveNodes(
  container: HTMLElement,
  content: SVGGElement,
  root: MindMapNode,
  positions: Map<string, NodeLayout>,
  edgeStyle: EdgeStyle,
  animate: boolean,
): void {
  let motion = motions.get(container);
  if (!motion) {
    motion = { shown: new Map(), frame: null };
    motions.set(container, motion);
  }
  if (motion.frame !== null) cancelAnimationFrame(motion.frame);
  motion.frame = null;
  const previous = motion.shown;
  const final = new Map([...positions].map(([id, p]) => [id, { x: p.x, y: p.y }]));
  motion.shown = final;
  if (!animate || previous.size === 0) return;

  const parents = new Map<string, string>();
  const walk = (node: MindMapNode) => {
    if (node.collapsed) return;
    for (const child of node.children) {
      parents.set(child.id, node.id);
      walk(child);
    }
  };
  walk(root);

  interface Move {
    el: SVGGElement;
    dx: number;
    dy: number;
    fade: boolean;
  }
  const moves = new Map<string, Move>();
  for (const el of content.querySelectorAll<SVGGElement>(":scope > .mm-node")) {
    const id = el.dataset.nodeId!;
    const to = final.get(id)!;
    let from = previous.get(id);
    let fade = false;
    if (!from) {
      // A new node comes out of its parent, from where the parent was.
      const parentId = parents.get(id);
      const parentFrom = parentId ? previous.get(parentId) : undefined;
      if (!parentFrom) continue;
      from = parentFrom;
      fade = true;
    }
    const dx = from.x - to.x;
    const dy = from.y - to.y;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && !fade) continue;
    moves.set(id, { el, dx, dy, fade });
  }
  if (moves.size === 0) return;

  const edges = [...content.querySelectorAll<SVGPathElement>(":scope > path.mm-edge")].filter(
    (el) => moves.has(el.dataset.from!) || moves.has(el.dataset.to!),
  );
  const start = performance.now();
  const shown = motion.shown;
  const current = motion;

  const step = (now: number) => {
    const t = Math.min(1, (now - start) / MOVE_MS);
    const left = (1 - t) ** 3; // the part of the move still to go, eased out
    const at = (id: string): NodeLayout => {
      const p = positions.get(id)!;
      const move = moves.get(id);
      return move ? { ...p, x: p.x + move.dx * left, y: p.y + move.dy * left } : p;
    };
    for (const [id, move] of moves) {
      move.el.setAttribute("transform", t < 1 ? `translate(${move.dx * left} ${move.dy * left})` : "");
      if (move.fade) move.el.style.opacity = t < 1 ? String(t) : "";
      const p = positions.get(id)!;
      shown.set(id, { x: p.x + move.dx * left, y: p.y + move.dy * left });
    }
    for (const el of edges) {
      el.setAttribute("d", edgePath(at(el.dataset.from!), at(el.dataset.to!), edgeStyle));
      if (moves.get(el.dataset.to!)?.fade) el.style.opacity = t < 1 ? String(t) : "";
    }
    current.frame = t < 1 ? requestAnimationFrame(step) : null;
  };
  step(start);
}

// Computes the camera that fits `bbox` snugly inside `rect`, with a margin
// so nodes don't touch the viewport edge. Shared by the initial camera and
// the toolbar's "zoom to fit" action.
export function computeFitCamera(bbox: DOMRect, rect: { width: number; height: number }): Camera {
  if (bbox.width <= 0 || bbox.height <= 0) {
    return { x: rect.width / 2, y: rect.height / 2, scale: 1 };
  }
  const margin = 0.9;
  const scale = Math.min((rect.width / bbox.width) * margin, (rect.height / bbox.height) * margin, 1);
  return {
    scale,
    x: rect.width / 2 - (bbox.x + bbox.width / 2) * scale,
    y: rect.height / 2 - (bbox.y + bbox.height / 2) * scale,
  };
}

// getBBox() on an empty group has historically been flaky in some WebKit
// versions, and isn't implemented at all in jsdom (used by tests). A
// zero-size fallback keeps rendering going instead of throwing.
function safeBBox(el: SVGGraphicsElement): DOMRect {
  try {
    return el.getBBox();
  } catch {
    return new DOMRect(0, 0, 0, 0);
  }
}

// Skips descendants of a collapsed node — they stay in the data but have no
// layout position (see layout.ts's visibleChildren), so they must not be
// visited here either.
function* iterateNodes(node: MindMapNode): Generator<MindMapNode> {
  yield node;
  if (node.collapsed) return;
  for (const child of node.children) yield* iterateNodes(child);
}

// Focus mode's "in view, full opacity" set: the focused node, everything
// beneath it, and its ancestors up to the root (so the branch's place in
// the tree stays visible) — everything else gets dimmed.
function computeFocusSet(root: MindMapNode, focusId: string): Set<string> {
  const set = new Set<string>();
  const focusNode = findNode(root, focusId);
  if (!focusNode) return set;
  for (const n of iterateNodes(focusNode)) set.add(n.id);
  let parent = findParent(root, focusId);
  while (parent) {
    set.add(parent.id);
    parent = findParent(root, parent.id);
  }
  return set;
}

// A brand-new blank map (just a root, no children yet) is anchored near
// the left edge instead of horizontally centered — the tree only ever
// grows rightward, so centering it wastes the entire right half of the
// window. Vertically it's still centered, like any other map.
const BLANK_LEFT_MARGIN = 120;

function computeInitialCamera(container: HTMLElement, bbox: DOMRect, isBlank: boolean): Camera {
  const rect = container.getBoundingClientRect();
  const y = rect.height / 2 - (bbox.y + bbox.height / 2);
  if (isBlank) {
    return { x: BLANK_LEFT_MARGIN - bbox.x, y, scale: 1 };
  }
  const x = rect.width / 2 - (bbox.x + bbox.width / 2);
  return { x, y, scale: 1 };
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const value = parseInt(clean, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

// Mixes `hex` toward the color `to` by `amount` (0 = hex, 1 = to).
function mix(hex: string, to: [number, number, number], amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const m = (c: number, t: number) => Math.round(c + (t - c) * amount);
  return `rgb(${m(r, to[0])} ${m(g, to[1])} ${m(b, to[2])})`;
}

const WHITE: [number, number, number] = [255, 255, 255];
const BLACK: [number, number, number] = [0, 0, 0];
// The dark theme's canvas color (--mm-bg in styles.css).
const DARK_BG: [number, number, number] = [23, 23, 26];

const isDark = () => getTheme() === "dark";

// The colors for one branch color. Every one is set as an SVG attribute,
// not CSS, so exports and print keep them.
// Lines and underlines: the color itself, a little lighter on dark.
function lineColor(hex: string): string {
  return isDark() ? mix(hex, WHITE, 0.18) : mix(hex, WHITE, 0);
}

// A first-level branch's fill: a light tint, or on dark a dim one.
function tintFill(hex: string): string {
  return isDark() ? mix(hex, DARK_BG, 0.8) : mix(hex, WHITE, 0.88);
}

// Text on that tint: a dark shade, or on dark a light one, both well over
// 4.5:1 against the tint.
function tintText(hex: string): string {
  return isDark() ? mix(hex, WHITE, 0.6) : mix(hex, BLACK, 0.42);
}

// The thin outline that keeps a dark tint from blending into the canvas.
function tintStroke(hex: string): string {
  return isDark() ? mix(hex, DARK_BG, 0.6) : "none";
}

function rootFill(): string {
  return isDark() ? "#232328" : "#ffffff";
}

function rootBorder(): string {
  return isDark() ? "#38383f" : "#e6e6eb";
}

// Deterministic per-shape seed so rough.js's hand-drawn wobble stays fixed
// across re-renders — without this every render (which happens on nearly
// every interaction) would redraw each box/edge with a new random wobble,
// making the canvas look like it's jittering continuously.
function seedFrom(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(hash) || 1;
}

// rough.js gives the same shape for the same seed and inputs, but computing
// it is slow (65ms per render at 79 nodes, 1.3s at 1000), and every
// select/drag/edit renders again. So each shape is generated once, keyed by
// all of its inputs, and cloned on later renders.
const sketchCache = new Map<string, SVGGElement>();
const SKETCH_CACHE_LIMIT = 5000;

function cachedSketch(key: string, draw: () => SVGGElement): SVGGElement {
  let el = sketchCache.get(key);
  if (!el) {
    if (sketchCache.size >= SKETCH_CACHE_LIMIT) sketchCache.clear();
    el = draw();
    sketchCache.set(key, el);
  }
  return el.cloneNode(true) as SVGGElement;
}

type Tier = "root" | "branch" | "leaf";

function tierOf(layout: NodeLayout): Tier {
  return layout.depth === 0 ? "root" : layout.depth === 1 ? "branch" : "leaf";
}

function renderNode(
  content: SVGGElement,
  node: MindMapNode,
  layout: NodeLayout,
  visual: NodeVisual,
  selectedIds: ReadonlySet<string>,
  editingId: string | null,
  isDropTarget: boolean,
  rc: RoughSVG | null,
  isDimmed: boolean,
  isJustFolded: boolean,
): void {
  const tier = tierOf(layout);
  const isRoot = tier === "root";
  const isSelected = selectedIds.has(node.id);
  const isEditing = editingId === node.id;
  const { wrapped, style, size } = visual;

  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute(
    "class",
    `mm-node mm-${tier}${isSelected ? " mm-selected" : ""}${isEditing ? " mm-editing" : ""}${isDropTarget ? " mm-drop-target" : ""}${isDimmed ? " mm-dimmed" : ""}`,
  );
  g.dataset.nodeId = node.id;
  // The hover color of the + and − buttons.
  g.style.setProperty("--mm-branch", lineColor(layout.color));
  content.appendChild(g);

  const boxTop = layout.y - size.height / 2;
  const boxBottom = boxTop + size.height;

  // Invisible, but hit-testable: without this, the box and the add-button
  // are two separate painted shapes with empty (unpainted, so un-hoverable)
  // space between them, and the CSS :hover driving the button's visibility
  // drops the instant the cursor crosses that gap, hiding the button before
  // the pointer ever reaches it. This spans continuously from the box
  // through the button so hover survives the trip.
  const hasChildren = node.children.length > 0;
  const hiddenCount = node.collapsed ? countDescendants(node) : 0;
  const pillWidth = foldPillWidth(hiddenCount);
  const addButtonClearance = !hasChildren
    ? 0
    : node.collapsed
      ? Math.max(FOLD_BUTTON_CLEARANCE, FOLD_PILL_GAP * 2 + pillWidth - ADD_BUTTON_GAP + ADD_BUTTON_RADIUS)
      : FOLD_BUTTON_CLEARANCE;

  const hoverZone = document.createElementNS(SVG_NS, "rect");
  hoverZone.setAttribute("class", "mm-hover-zone");
  hoverZone.setAttribute("x", String(layout.x));
  hoverZone.setAttribute("y", String(boxTop));
  hoverZone.setAttribute(
    "width",
    String(size.width + addButtonClearance + ADD_BUTTON_GAP + ADD_BUTTON_RADIUS * 2),
  );
  hoverZone.setAttribute("height", String(size.height));
  g.appendChild(hoverZone);

  // The box: a card for the root, a tinted pill for a branch, and for a
  // deeper idea an unpainted (but clickable) area over a colored underline.
  const fill = isRoot ? rootFill() : tier === "branch" ? tintFill(layout.color) : "transparent";
  const stroke = isRoot ? rootBorder() : tier === "branch" ? tintStroke(layout.color) : "none";
  if (rc && tier !== "leaf") {
    const options = {
      fill,
      fillStyle: "solid",
      stroke: stroke === "none" ? lineColor(layout.color) : stroke,
      strokeWidth: 1,
      roughness: 1.8,
      bowing: 1.2,
      seed: seedFrom(node.id),
    };
    const key = `rect|${layout.x}|${boxTop}|${size.width}|${size.height}|${JSON.stringify(options)}`;
    const sketch = cachedSketch(key, () => rc.rectangle(layout.x, boxTop, size.width, size.height, options));
    sketch.classList.add(isRoot ? "mm-root-box" : "mm-node-box", "mm-sketchy-box");
    g.appendChild(sketch);
  } else {
    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("class", isRoot ? "mm-root-box" : "mm-node-box");
    rect.setAttribute("x", String(layout.x));
    rect.setAttribute("y", String(boxTop));
    rect.setAttribute("width", String(size.width));
    rect.setAttribute("height", String(size.height));
    rect.setAttribute("rx", String(style.rx));
    rect.setAttribute("fill", fill);
    rect.setAttribute("stroke", stroke);
    g.appendChild(rect);
  }

  if (tier === "leaf") {
    const color = lineColor(layout.color);
    if (rc) {
      const options = { stroke: color, strokeWidth: 2, roughness: 1.2, seed: seedFrom(node.id) };
      const x2 = layout.x + size.width;
      const key = `line|${layout.x}|${boxBottom}|${x2}|${JSON.stringify(options)}`;
      const sketch = cachedSketch(key, () => rc.line(layout.x, boxBottom, x2, boxBottom, options));
      sketch.classList.add("mm-underline");
      g.appendChild(sketch);
    } else {
      const line = document.createElementNS(SVG_NS, "path");
      line.setAttribute("class", "mm-underline");
      line.setAttribute("d", `M ${layout.x} ${boxBottom} H ${layout.x + size.width}`);
      line.setAttribute("stroke", color);
      g.appendChild(line);
    }
  }

  if (isSelected || isDropTarget) {
    const ring = document.createElementNS(SVG_NS, "rect");
    ring.setAttribute("class", isDropTarget ? "mm-ring mm-drop-ring" : "mm-ring mm-selection-ring");
    ring.setAttribute("x", String(layout.x - RING_GAP));
    ring.setAttribute("y", String(boxTop - RING_GAP));
    ring.setAttribute("width", String(size.width + RING_GAP * 2));
    ring.setAttribute("height", String(size.height + RING_GAP * 2));
    ring.setAttribute("rx", String(style.rx + RING_GAP));
    g.appendChild(ring);
  }

  if (node.image) {
    const image = document.createElementNS(SVG_NS, "image");
    image.setAttribute("x", String(layout.x + (size.width - IMAGE_THUMB_SIZE) / 2));
    image.setAttribute("y", String(boxTop + style.paddingY));
    image.setAttribute("width", String(IMAGE_THUMB_SIZE));
    image.setAttribute("height", String(IMAGE_THUMB_SIZE));
    image.setAttribute("preserveAspectRatio", "xMidYMid slice");
    image.setAttributeNS("http://www.w3.org/1999/xlink", "href", node.image);
    image.setAttribute("href", node.image);
    g.appendChild(image);
  }

  // A deeper idea's text starts at the left, on its line; the root and
  // branches center theirs in the box.
  const text = document.createElementNS(SVG_NS, "text");
  const { leading, trailing } = visual;
  const textX =
    tier === "leaf" ? layout.x + style.paddingX + leading : layout.x + leading + (size.width - leading - trailing) / 2;
  text.setAttribute("text-anchor", tier === "leaf" ? "start" : "middle");
  text.setAttribute("class", isRoot ? "mm-root-text" : "mm-node-text");
  if (tier === "branch") text.setAttribute("fill", tintText(layout.color));
  // Text is normally centered as a block on the box's vertical center; an
  // image thumbnail above it shifts that block down to sit right below the
  // image instead (see buildVisuals for the matching size calculation).
  const firstLineCenterY = node.image
    ? boxTop + style.paddingY + IMAGE_THUMB_SIZE + IMAGE_GAP + style.lineHeight / 2
    : layout.y - ((wrapped.lines.length - 1) * style.lineHeight) / 2;
  wrapped.lines.forEach((line, i) => {
    const tspan = document.createElementNS(SVG_NS, "tspan");
    const lineY = firstLineCenterY + i * style.lineHeight;
    tspan.setAttribute("x", String(textX));
    tspan.setAttribute("y", String(lineY));
    tspan.setAttribute("dominant-baseline", "central");
    tspan.textContent = line;
    text.appendChild(tspan);
  });
  g.appendChild(text);

  g.appendChild(renderAddButton(layout, size, addButtonClearance));
  if (hasChildren && node.collapsed) {
    g.appendChild(renderFoldPill(layout, size, hiddenCount, pillWidth, isJustFolded));
  } else if (hasChildren) {
    g.appendChild(renderFoldButton(layout, size, edgeStartY(layout)));
  }
  // Badges sit in their own slots on the first text line: the checklist
  // circle before the text, the notes and link icons after it.
  const rightSlotX = layout.x + size.width - style.paddingX - META_ICON_SLOT / 2 + 3;
  if (node.link) {
    g.appendChild(renderMetaIcon(LINK_ICON_PATH, rightSlotX, firstLineCenterY, "mm-link-badge", node.link));
  }
  if (node.notes) {
    const x = rightSlotX - (node.link ? META_ICON_SLOT : 0);
    g.appendChild(renderMetaIcon(NOTES_ICON_PATH, x, firstLineCenterY, "mm-notes-badge", truncate(node.notes, 280)));
  }
  if (node.status) {
    g.appendChild(
      renderStatusBadge(node.status, layout.x + style.paddingX + 6, firstLineCenterY, lineColor(layout.color)),
    );
  }
}

// Where a node's lines leave it, and where a line reaches it: the middle
// of the right or left side for the root and branches, the underline for
// deeper ideas.
function edgeStartY(layout: NodeLayout): number {
  return layout.depth >= 2 ? layout.y + layout.height / 2 : layout.y;
}

// 12x12 line icons centered on (0, 0), drawn in the muted text color.
const NOTES_ICON_PATH = "M -4.5 -4 H 4.5 M -4.5 -1.3 H 4.5 M -4.5 1.4 H 4.5 M -4.5 4.1 H 1.5";
const LINK_ICON_PATH =
  "M -0.8 -3.2 L 0.8 -4.8 A 2.6 2.6 0 0 1 4.8 -0.8 L 3.2 0.8 M 0.8 3.2 L -0.8 4.8 A 2.6 2.6 0 0 1 -4.8 0.8 L -3.2 -0.8 M -1.8 1.8 L 1.8 -1.8";

function renderMetaIcon(d: string, x: number, y: number, className: string, tooltip: string): SVGGElement {
  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("class", `mm-meta-icon ${className}`);
  g.setAttribute("transform", `translate(${x} ${y})`);
  g.appendChild(svgTitle(tooltip));
  const hit = document.createElementNS(SVG_NS, "rect");
  hit.setAttribute("class", "mm-fold-hit");
  hit.setAttribute("x", "-8");
  hit.setAttribute("y", "-8");
  hit.setAttribute("width", "16");
  hit.setAttribute("height", "16");
  g.appendChild(hit);
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", d);
  g.appendChild(path);
  return g;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// Checklist indicator, top-left corner: an empty circle outline for "todo",
// a filled circle with a checkmark for "done".
function renderStatusBadge(status: "todo" | "done", x: number, y: number, color: string): SVGGElement {
  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("class", `mm-status-badge mm-status-${status}`);
  g.setAttribute("transform", `translate(${x} ${y})`);

  const circle = document.createElementNS(SVG_NS, "circle");
  circle.setAttribute("r", "6");
  g.appendChild(circle);

  // Done is a filled circle in the branch color with a check in it.
  if (status === "done") {
    circle.setAttribute("fill", color);
    circle.setAttribute("stroke", color);
    const check = document.createElementNS(SVG_NS, "path");
    check.setAttribute("d", "M -3 0 L -1 2.5 L 3.5 -2.5");
    check.setAttribute("fill", "none");
    check.setAttribute("stroke", isDark() ? "#17171a" : "#ffffff");
    g.appendChild(check);
  }

  return g;
}

function foldPillWidth(count: number): number {
  return Math.max(22, String(count).length * 7 + 14);
}

// An open branch needs no icon: its children are on screen. A "−" button
// where its lines leave the node shows on hover or selection (see
// styles.css).
function renderFoldButton(layout: NodeLayout, size: NodeSize, anchorY: number): SVGGElement {
  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("class", "mm-collapse-toggle mm-fold-btn");
  g.setAttribute("transform", `translate(${layout.x + size.width + FOLD_BUTTON_OFFSET} ${anchorY})`);
  g.appendChild(svgTitle("Fold branch (.)"));
  g.appendChild(hitRect(-MIN_TARGET / 2, MIN_TARGET));

  const circle = document.createElementNS(SVG_NS, "circle");
  circle.setAttribute("r", String(FOLD_BUTTON_RADIUS));
  g.appendChild(circle);

  const minus = document.createElementNS(SVG_NS, "path");
  minus.setAttribute("d", "M -4 0 H 4");
  g.appendChild(minus);
  return g;
}

// A folded branch says how much it hides: a pill in the branch color with
// the number of hidden ideas, always visible (also in exports and print).
// The fill and text color are attributes, not CSS, so exports keep them.
function renderFoldPill(layout: NodeLayout, size: NodeSize, count: number, width: number, pop: boolean): SVGGElement {
  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("class", `mm-collapse-toggle mm-fold-pill${pop ? " mm-popping" : ""}`);
  g.setAttribute("transform", `translate(${layout.x + size.width + FOLD_PILL_GAP} ${layout.y})`);
  g.appendChild(svgTitle(`Show ${count} hidden ${count === 1 ? "idea" : "ideas"}`));
  g.appendChild(hitRect(-2, Math.max(MIN_TARGET, width + 4)));

  const pill = document.createElementNS(SVG_NS, "rect");
  pill.setAttribute("y", String(-FOLD_PILL_HEIGHT / 2));
  pill.setAttribute("width", String(width));
  pill.setAttribute("height", String(FOLD_PILL_HEIGHT));
  pill.setAttribute("rx", String(FOLD_PILL_HEIGHT / 2));
  pill.setAttribute("fill", tintFill(layout.color));
  pill.setAttribute("stroke", lineColor(layout.color));
  g.appendChild(pill);

  const label = document.createElementNS(SVG_NS, "text");
  label.setAttribute("x", String(width / 2));
  label.setAttribute("text-anchor", "middle");
  label.setAttribute("dominant-baseline", "central");
  label.setAttribute("fill", tintText(layout.color));
  label.textContent = String(count);
  g.appendChild(label);

  return g;
}

function svgTitle(text: string): SVGTitleElement {
  const title = document.createElementNS(SVG_NS, "title");
  title.textContent = text;
  return title;
}

// An invisible target, vertically centered on the control's origin, so a
// small control still takes a 24px-tall click.
function hitRect(x: number, width: number): SVGRectElement {
  const rect = document.createElementNS(SVG_NS, "rect");
  rect.setAttribute("class", "mm-fold-hit");
  rect.setAttribute("x", String(x));
  rect.setAttribute("y", String(-MIN_TARGET / 2));
  rect.setAttribute("width", String(width));
  rect.setAttribute("height", String(MIN_TARGET));
  return rect;
}

function renderAddButton(layout: NodeLayout, size: NodeSize, extraClearance: number): SVGGElement {
  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("class", "mm-add-btn");
  const cx = layout.x + size.width + extraClearance + ADD_BUTTON_GAP;
  const cy = layout.y;
  g.setAttribute("transform", `translate(${cx} ${cy})`);

  const circle = document.createElementNS(SVG_NS, "circle");
  circle.setAttribute("r", String(ADD_BUTTON_RADIUS));
  g.appendChild(circle);

  const plus = document.createElementNS(SVG_NS, "path");
  const s = 4;
  plus.setAttribute("d", `M ${-s} 0 H ${s} M 0 ${-s} V ${s}`);
  g.appendChild(plus);

  return g;
}

// Lines get thinner further from the root, as branches of a tree do.
function edgeWidth(fromDepth: number): number {
  return fromDepth === 0 ? 3 : fromDepth === 1 ? 2 : 1.5;
}

function edgePath(from: NodeLayout, to: NodeLayout, edgeStyle: EdgeStyle): string {
  const fromX = from.x + from.width;
  const fromY = edgeStartY(from);
  const toX = to.x;
  const toY = edgeStartY(to);
  const midX = (fromX + toX) / 2;
  return edgeStyle === "curved"
    ? `M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`
    : `M ${fromX} ${fromY} L ${midX} ${fromY} L ${midX} ${toY} L ${toX} ${toY}`;
}

function renderEdge(
  edge: Edge,
  positions: Map<string, NodeLayout>,
  edgeStyle: EdgeStyle,
  rc: RoughSVG | null,
  isDimmed: boolean,
): SVGElement {
  const from = positions.get(edge.fromId)!;
  const to = positions.get(edge.toId)!;
  const d = edgePath(from, to, edgeStyle);
  const color = lineColor(to.color);
  const width = edgeWidth(from.depth);

  if (rc) {
    const options = {
      stroke: color,
      strokeWidth: width,
      roughness: 1.6,
      bowing: 1,
      seed: seedFrom(edge.fromId + edge.toId),
    };
    const sketch = cachedSketch(`path|${d}|${JSON.stringify(options)}`, () => rc.path(d, options));
    sketch.setAttribute("class", `mm-edge mm-sketchy-edge${isDimmed ? " mm-dimmed" : ""}`);
    return sketch;
  }

  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", d);
  path.setAttribute("class", `mm-edge${isDimmed ? " mm-dimmed" : ""}`);
  path.setAttribute("stroke", color);
  path.setAttribute("stroke-width", String(width));
  return path;
}

// Keys typed into an edit overlay stay there, so they don't also trigger
// the app's shortcuts. ⌘S is the exception: it must reach the app's
// window-level handler, which commits the open edit and then saves.
function stopUnlessSave(e: KeyboardEvent): void {
  if (!((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s")) e.stopPropagation();
}

// Edits the title in place: the node's box itself becomes the editor, with
// the same fill, font, padding and corner radius, and it resizes as you
// type using the same measurement the node uses, so what you see while
// typing is what the node looks like after. The SVG node is hidden
// meanwhile (.mm-node.mm-editing in styles.css). A textarea, not an input,
// so a long title wraps onto more lines the way the node will.
function renderEditOverlay(
  container: HTMLElement,
  node: MindMapNode,
  layout: NodeLayout,
  visual: NodeVisual,
  sketchy: boolean,
  camera: Camera,
  callbacks: RenderCallbacks,
): void {
  const { style } = visual;
  const tier = tierOf(layout);
  // Badges are hidden while editing, so the text may use the full fixed
  // box width (if the node has one) minus padding.
  const fixedTextWidth = node.width ? Math.max(MIN_WRAP_WIDTH, node.width - style.paddingX * 2) : null;
  const input = document.createElement("textarea");
  input.className = `mm-edit-input mm-edit-${tier}`;
  input.dataset.editor = `title:${node.id}`;
  input.value = node.text;
  input.rows = 1;
  input.spellcheck = false;

  const scale = camera.scale;
  input.style.left = `${camera.x + layout.x * scale}px`;
  input.style.top = `${camera.y + layout.y * scale}px`;
  input.style.fontSize = `${style.fontSize * scale}px`;
  input.style.fontWeight = String(style.fontWeight);
  input.style.lineHeight = `${style.lineHeight * scale}px`;
  input.style.padding = `${style.paddingY * scale}px ${style.paddingX * scale}px`;
  // Sketchy boxes are hand-drawn rectangles, not rounded ones.
  input.style.borderRadius = sketchy ? "2px" : `${style.rx * scale}px`;
  // A deeper idea has no fill of its own, so its editor takes the panel
  // color; the root and branches keep theirs.
  if (tier === "root") input.style.background = rootFill();
  else if (tier === "branch") {
    input.style.background = tintFill(layout.color);
    input.style.color = tintText(layout.color);
  } else {
    input.style.textAlign = "left";
    input.style.borderBottom = `2px solid ${lineColor(layout.color)}`;
  }

  const fit = () => {
    const wrapped = wrapText(input.value || " ", fontString(style), fixedTextWidth ?? style.maxTextWidth);
    const width = Math.max(wrapped.width, fixedTextWidth ?? MIN_EDIT_TEXT_WIDTH) + style.paddingX * 2;
    const height = wrapped.lines.length * style.lineHeight + style.paddingY * 2;
    // +1px: the textarea wraps on its own, and a subpixel rounding
    // difference must not push the last word onto a new line.
    input.style.width = `${width * scale + 1}px`;
    input.style.height = `${height * scale}px`;
  };
  input.addEventListener("input", () => {
    // A title is one line of text that wraps; pasted line breaks become spaces.
    if (input.value.includes("\n")) input.value = input.value.replace(/\s*\n\s*/g, " ");
    fit();
  });
  fit();

  const commit = () => callbacks.onEditCommit(node.id, input.value);
  input.addEventListener("blur", () => isUserBlur(input) && commit());
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      callbacks.onEditCommit(node.id, input.value, e.key === "Enter" ? "sibling" : "child");
    } else if (e.key === "Escape") {
      e.preventDefault();
      callbacks.onEditCancel();
    }
    stopUnlessSave(e);
  });

  container.appendChild(input);
  input.focus();
  input.select();
}

const MIN_EDIT_TEXT_WIDTH = 24;

// The notes, icon and link editors are small labeled panels below the
// node (above it when there is no room below), so they don't cover the
// node being edited and they say how to save or cancel.
function createFieldPanel(
  container: HTMLElement,
  layout: NodeLayout,
  camera: Camera,
  label: string,
  hint: string,
  width: number,
  expectedHeight: number,
): HTMLDivElement {
  const panel = document.createElement("div");
  panel.className = "mm-field-panel";
  panel.style.width = `${width}px`;

  const head = document.createElement("div");
  head.className = "mm-field-head";
  const labelEl = document.createElement("span");
  labelEl.className = "mm-field-label";
  labelEl.textContent = label;
  const hintEl = document.createElement("span");
  hintEl.className = "mm-field-hint";
  hintEl.textContent = hint;
  head.append(labelEl, hintEl);
  panel.appendChild(head);

  const screenX = camera.x + (layout.x + layout.width / 2) * camera.scale;
  const below = camera.y + (layout.y + layout.height / 2) * camera.scale + 8;
  const above = camera.y + (layout.y - layout.height / 2) * camera.scale - 8;
  const roomBelow = container.getBoundingClientRect().height - below;
  panel.style.left = `${screenX}px`;
  if (roomBelow < expectedHeight && above > expectedHeight) {
    panel.style.top = `${above}px`;
    panel.style.transform = "translate(-50%, -100%)";
  } else {
    panel.style.top = `${below}px`;
    panel.style.transform = "translate(-50%, 0)";
  }
  return panel;
}

function renderNotesOverlay(
  container: HTMLElement,
  node: MindMapNode,
  layout: NodeLayout,
  camera: Camera,
  callbacks: RenderCallbacks,
): void {
  const panel = createFieldPanel(container, layout, camera, "Notes", "⌘↵ to save · Esc to cancel", 260, 150);
  const textarea = document.createElement("textarea");
  textarea.className = "mm-notes-input";
  textarea.dataset.editor = `notes:${node.id}`;
  textarea.placeholder = "Add details, context or a reminder";
  textarea.value = node.notes ?? "";
  // Grows with its text, up to the max-height in styles.css.
  const fit = () => {
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  };
  textarea.addEventListener("input", fit);

  const commit = () => callbacks.onNotesCommit(node.id, textarea.value);
  textarea.addEventListener("blur", () => isUserBlur(textarea) && commit());
  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      callbacks.onNotesCancel();
    }
    stopUnlessSave(e);
  });

  panel.appendChild(textarea);
  container.appendChild(panel);
  fit();
  textarea.focus();
}

// A single-line field in the same kind of panel, shared by icon and link
// editing.
function renderInlineTextOverlay(
  container: HTMLElement,
  layout: NodeLayout,
  camera: Camera,
  editorKey: string,
  label: string,
  value: string,
  placeholder: string,
  width: number,
  onCommit: (value: string) => void,
  onCancel: () => void,
): void {
  const panel = createFieldPanel(container, layout, camera, label, "↵ to save · Esc to cancel", width, 80);
  const input = document.createElement("input");
  input.type = "text";
  input.className = "mm-inline-input";
  input.dataset.editor = editorKey;
  input.placeholder = placeholder;
  input.value = value;
  input.spellcheck = false;

  const commit = () => onCommit(input.value);
  input.addEventListener("blur", () => isUserBlur(input) && commit());
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
    stopUnlessSave(e);
  });

  panel.appendChild(input);
  container.appendChild(panel);
  input.focus();
  input.select();
}
