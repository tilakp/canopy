import rough from "roughjs";
import type { RoughSVG } from "roughjs/bin/svg";
import { findNode, findParent, type MindMapNode } from "./model";
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

const ROOT_STYLE: BoxStyle = {
  fontSize: 19,
  fontWeight: 600,
  maxTextWidth: 240,
  paddingX: 22,
  paddingY: 14,
  lineHeight: 25,
  rx: 14,
};

const LEAF_STYLE: BoxStyle = {
  fontSize: 14.5,
  fontWeight: 500,
  maxTextWidth: 200,
  paddingX: 14,
  paddingY: 10,
  lineHeight: 20,
  rx: 10,
};

const ADD_BUTTON_GAP = 14;
const ADD_BUTTON_RADIUS = 9;
const COLLAPSE_TOGGLE_RADIUS = 7;
// Extra horizontal room to clear the collapse toggle before the add-button
// starts — without it the two circles (radius 7 + 9, only ADD_BUTTON_GAP
// apart) overlap.
const COLLAPSE_TOGGLE_CLEARANCE = COLLAPSE_TOGGLE_RADIUS * 2 + 6;

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
}

export interface RenderCallbacks {
  onEditCommit(id: string, text: string): void;
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
}

function fontString(style: BoxStyle): string {
  return `${style.fontWeight} ${style.fontSize}px ${getFontFamily()}`;
}

// Wraps every node's text once and derives its box size from that, so the
// same wrapped lines are reused for both layout (sizing) and drawing —
// there's no separate DOM-measurement pass to go out of sync with.
function buildVisuals(root: MindMapNode): Map<string, NodeVisual> {
  const visuals = new Map<string, NodeVisual>();
  for (const node of iterateNodes(root)) {
    const style = node.id === root.id ? ROOT_STYLE : LEAF_STYLE;
    const displayText = (node.icon ? node.icon + " " : "") + (node.text || " ");
    const wrapped = wrapText(displayText, fontString(style), style.maxTextWidth);
    const textWidth = wrapped.width + style.paddingX * 2;
    const textHeight = wrapped.lines.length * style.lineHeight + style.paddingY * 2;
    const size: NodeSize = node.image
      ? {
          width: Math.max(textWidth, IMAGE_THUMB_SIZE + style.paddingX * 2),
          height: textHeight + IMAGE_THUMB_SIZE + IMAGE_GAP,
        }
      : { width: textWidth, height: textHeight };
    visuals.set(node.id, { wrapped, style, size });
  }
  return visuals;
}

export function renderMindMap(
  container: HTMLElement,
  root: MindMapNode,
  state: RenderState,
  callbacks: RenderCallbacks,
): RenderResult {
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

  for (const edge of edges) {
    const dimmed = focusSet !== null && (!focusSet.has(edge.fromId) || !focusSet.has(edge.toId));
    content.appendChild(renderEdge(edge, positions, state.edgeStyle, rc, dimmed));
  }

  for (const node of iterateNodes(root)) {
    const layout = positions.get(node.id)!;
    const visual = visuals.get(node.id)!;
    renderNode(
      content,
      node,
      layout,
      visual,
      node.id === root.id,
      state.selectedIds,
      state.editingId,
      node.id === state.dropTargetId,
      rc,
      focusSet !== null && !focusSet.has(node.id),
    );
  }

  const contentBBox = safeBBox(content);
  const camera = state.camera ?? computeInitialCamera(container, contentBBox, root.children.length === 0);
  content.setAttribute("transform", cameraTransform(camera));

  if (state.editingId) {
    const node = findNode(root, state.editingId);
    const layout = node && positions.get(node.id);
    const visual = node && visuals.get(node.id);
    if (node && layout && visual) {
      renderEditOverlay(container, node, layout, visual.style, camera, callbacks);
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
        node.icon ?? "",
        "Emoji…",
        70,
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
        node.link ?? "",
        "https://…",
        220,
        (value) => callbacks.onLinkCommit(node.id, value),
        callbacks.onLinkCancel,
      );
    }
  }

  return { camera, positions, contentBBox };
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
  return true;
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

// Mixes a color toward white for a soft pastel fill, e.g. lighten("#4C6EF5", 0.85).
function lighten(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return `rgb(${mix(r)} ${mix(g)} ${mix(b)})`;
}

// Mixes a color toward a dark gray instead of white — lighten()'s pastel
// blend reads as washed-out, low-contrast boxes against a dark background.
function darken(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const DARK = 38; // matches --mm-surface's dark value in styles.css
  const mix = (c: number) => Math.round(c + (DARK - c) * amount);
  return `rgb(${mix(r)} ${mix(g)} ${mix(b)})`;
}

// Leaf box fill: pastel (toward white) in light mode, muted (toward dark
// gray) in dark mode, so text stays legible either way.
function boxFill(branchColor: string): string {
  return getTheme() === "dark" ? darken(branchColor, 0.6) : lighten(branchColor, 0.85);
}

function rootFill(): string {
  return getTheme() === "dark" ? "#26262e" : "#ffffff";
}

function rootBorder(): string {
  return getTheme() === "dark" ? "#3a3a44" : "#e9e9ee";
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

interface BoxColors {
  fill: string;
  stroke: string;
  strokeWidth: number;
  dashed: boolean;
}

function boxColors(isRoot: boolean, isSelected: boolean, isDropTarget: boolean, branchColor: string): BoxColors {
  const fill = isRoot ? rootFill() : boxFill(branchColor);
  if (isDropTarget) return { fill, stroke: "#12b886", strokeWidth: 2.5, dashed: true };
  if (isRoot) return { fill, stroke: isSelected ? "#4c6ef5" : rootBorder(), strokeWidth: isSelected ? 1.5 : 1, dashed: false };
  return { fill, stroke: isSelected ? "#4c6ef5" : "transparent", strokeWidth: 2, dashed: false };
}

function renderNode(
  content: SVGGElement,
  node: MindMapNode,
  layout: NodeLayout,
  visual: NodeVisual,
  isRoot: boolean,
  selectedIds: ReadonlySet<string>,
  editingId: string | null,
  isDropTarget: boolean,
  rc: RoughSVG | null,
  isDimmed: boolean,
): void {
  const isSelected = selectedIds.has(node.id);
  const isEditing = editingId === node.id;
  const { wrapped, style, size } = visual;

  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute(
    "class",
    `mm-node ${isRoot ? "mm-root" : "mm-leaf"}${isSelected ? " mm-selected" : ""}${isEditing ? " mm-editing" : ""}${isDropTarget ? " mm-drop-target" : ""}${isDimmed ? " mm-dimmed" : ""}`,
  );
  g.dataset.nodeId = node.id;
  content.appendChild(g);

  const boxTop = layout.y - size.height / 2;

  // Invisible, but hit-testable: without this, the box and the add-button
  // are two separate painted shapes with empty (unpainted, so un-hoverable)
  // space between them, and the CSS :hover driving the button's visibility
  // drops the instant the cursor crosses that gap, hiding the button before
  // the pointer ever reaches it. This spans continuously from the box
  // through the button so hover survives the trip.
  const hasChildren = node.children.length > 0;
  const addButtonClearance = hasChildren ? COLLAPSE_TOGGLE_CLEARANCE : 0;

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

  if (rc) {
    const colors = boxColors(isRoot, isSelected, isDropTarget, layout.color);
    const sketch = rc.rectangle(layout.x, boxTop, size.width, size.height, {
      fill: colors.fill,
      fillStyle: "solid",
      stroke: colors.stroke,
      strokeWidth: colors.strokeWidth,
      roughness: 1.8,
      bowing: 1.2,
      seed: seedFrom(node.id),
      ...(colors.dashed ? { strokeLineDash: [5, 3] } : {}),
    });
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
    if (!isRoot) rect.setAttribute("fill", boxFill(layout.color));
    g.appendChild(rect);
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

  const text = document.createElementNS(SVG_NS, "text");
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("class", `${isRoot ? "mm-root-text" : "mm-node-text"}${isEditing ? " mm-editing" : ""}`);
  const centerX = layout.x + size.width / 2;
  // Text is normally centered as a block on the box's vertical center; an
  // image thumbnail above it shifts that block down to sit right below the
  // image instead (see buildVisuals for the matching size calculation).
  const firstLineCenterY = node.image
    ? boxTop + style.paddingY + IMAGE_THUMB_SIZE + IMAGE_GAP + style.lineHeight / 2
    : layout.y - ((wrapped.lines.length - 1) * style.lineHeight) / 2;
  wrapped.lines.forEach((line, i) => {
    const tspan = document.createElementNS(SVG_NS, "tspan");
    const lineY = firstLineCenterY + i * style.lineHeight;
    tspan.setAttribute("x", String(centerX));
    tspan.setAttribute("y", String(lineY));
    tspan.setAttribute("dominant-baseline", "central");
    tspan.textContent = line;
    text.appendChild(tspan);
  });
  g.appendChild(text);

  g.appendChild(renderAddButton(layout, size, addButtonClearance));
  if (hasChildren) {
    g.appendChild(renderCollapseToggle(layout, size, !!node.collapsed));
  }
  if (node.notes) {
    g.appendChild(renderBadge("📝", layout.x + 3, boxTop + size.height - 4, "mm-notes-badge"));
  }
  if (node.link) {
    g.appendChild(renderBadge("🔗", layout.x + size.width - 15, boxTop + size.height - 4, "mm-link-badge"));
  }
  if (node.status) {
    g.appendChild(renderStatusBadge(node.status, layout.x + 12, boxTop + 12));
  }
}

function renderBadge(glyph: string, x: number, y: number, className: string): SVGTextElement {
  const t = document.createElementNS(SVG_NS, "text");
  t.setAttribute("class", className);
  t.setAttribute("x", String(x));
  t.setAttribute("y", String(y));
  t.textContent = glyph;
  return t;
}

// Checklist indicator, top-left corner: an empty circle outline for "todo",
// a filled circle with a checkmark for "done".
function renderStatusBadge(status: "todo" | "done", x: number, y: number): SVGGElement {
  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("class", `mm-status-badge mm-status-${status}`);
  g.setAttribute("transform", `translate(${x} ${y})`);

  const circle = document.createElementNS(SVG_NS, "circle");
  circle.setAttribute("r", "6");
  g.appendChild(circle);

  if (status === "done") {
    const check = document.createElementNS(SVG_NS, "path");
    check.setAttribute("d", "M -3 0 L -1 2.5 L 3.5 -2.5");
    check.setAttribute("fill", "none");
    g.appendChild(check);
  }

  return g;
}

// Sits right on the box's trailing edge (distinct from the hover-only "+"
// button further out), always visible when the node has children so the
// user knows there's a subtree to toggle.
function renderCollapseToggle(layout: NodeLayout, size: NodeSize, collapsed: boolean): SVGGElement {
  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("class", "mm-collapse-toggle");
  g.setAttribute("transform", `translate(${layout.x + size.width} ${layout.y})`);

  const circle = document.createElementNS(SVG_NS, "circle");
  circle.setAttribute("r", "7");
  g.appendChild(circle);

  const glyph = document.createElementNS(SVG_NS, "path");
  const s = 3.5;
  // Collapsed: a right chevron (more hidden this way). Expanded: the
  // mirrored left chevron (tuck back in) — deliberately not a "+" or "−",
  // which would read as add/delete rather than expand/collapse.
  glyph.setAttribute(
    "d",
    collapsed
      ? `M ${-s * 0.6} ${-s} L ${s * 0.7} 0 L ${-s * 0.6} ${s}`
      : `M ${s * 0.6} ${-s} L ${-s * 0.7} 0 L ${s * 0.6} ${s}`,
  );
  glyph.setAttribute("fill", "none");
  glyph.setAttribute("stroke-linejoin", "round");
  g.appendChild(glyph);

  return g;
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

function renderEdge(
  edge: Edge,
  positions: Map<string, NodeLayout>,
  edgeStyle: EdgeStyle,
  rc: RoughSVG | null,
  isDimmed: boolean,
): SVGElement {
  const from = positions.get(edge.fromId)!;
  const to = positions.get(edge.toId)!;

  const fromX = from.x + from.width;
  const fromY = from.y;
  const toX = to.x;
  const toY = to.y;

  const d =
    edgeStyle === "curved"
      ? (() => {
          const midX = (fromX + toX) / 2;
          return `M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`;
        })()
      : (() => {
          const midX = (fromX + toX) / 2;
          return `M ${fromX} ${fromY} L ${midX} ${fromY} L ${midX} ${toY} L ${toX} ${toY}`;
        })();

  if (rc) {
    const sketch = rc.path(d, {
      stroke: to.color,
      strokeWidth: 2,
      roughness: 1.6,
      bowing: 1,
      seed: seedFrom(edge.fromId + edge.toId),
    });
    sketch.setAttribute("class", `mm-edge mm-sketchy-edge${isDimmed ? " mm-dimmed" : ""}`);
    sketch.setAttribute("opacity", "0.75");
    return sketch;
  }

  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", d);
  path.setAttribute("class", `mm-edge${isDimmed ? " mm-dimmed" : ""}`);
  path.setAttribute("stroke", to.color);
  return path;
}

function renderEditOverlay(
  container: HTMLElement,
  node: MindMapNode,
  layout: NodeLayout,
  style: BoxStyle,
  camera: Camera,
  callbacks: RenderCallbacks,
): void {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "mm-edit-input";
  input.value = node.text;

  const centerX = layout.x + layout.width / 2;
  const screenX = camera.x + centerX * camera.scale;
  const screenY = camera.y + layout.y * camera.scale;
  input.style.left = `${screenX}px`;
  input.style.top = `${screenY}px`;
  input.style.fontSize = `${style.fontSize * camera.scale}px`;
  input.style.fontWeight = String(style.fontWeight);
  input.style.textAlign = "center";
  input.style.transform = "translate(-50%, -50%)";
  input.style.minWidth = `${(layout.width - style.paddingX * 2) * camera.scale}px`;

  const commit = () => callbacks.onEditCommit(node.id, input.value);
  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      input.removeEventListener("blur", commit);
      callbacks.onEditCancel();
    }
    e.stopPropagation();
  });

  container.appendChild(input);
  input.focus();
  input.select();
}

// Positioned below the box (rather than centered on it, like the title
// edit overlay) so it doesn't obscure the node while editing its notes.
function renderNotesOverlay(
  container: HTMLElement,
  node: MindMapNode,
  layout: NodeLayout,
  camera: Camera,
  callbacks: RenderCallbacks,
): void {
  const textarea = document.createElement("textarea");
  textarea.className = "mm-notes-input";
  textarea.placeholder = "Notes…";
  textarea.value = node.notes ?? "";

  const centerX = layout.x + layout.width / 2;
  const screenX = camera.x + centerX * camera.scale;
  const screenY = camera.y + (layout.y + layout.height / 2 + 10) * camera.scale;
  textarea.style.left = `${screenX}px`;
  textarea.style.top = `${screenY}px`;
  textarea.style.transform = "translate(-50%, 0)";

  const commit = () => callbacks.onNotesCommit(node.id, textarea.value);
  textarea.addEventListener("blur", commit);
  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      textarea.removeEventListener("blur", commit);
      callbacks.onNotesCancel();
    }
    e.stopPropagation();
  });

  container.appendChild(textarea);
  textarea.focus();
}

// A single-line overlay below the node, shared by icon and link editing —
// same positioning/commit/cancel wiring as the notes overlay, just a
// narrower <input> instead of a <textarea>.
function renderInlineTextOverlay(
  container: HTMLElement,
  layout: NodeLayout,
  camera: Camera,
  value: string,
  placeholder: string,
  width: number,
  onCommit: (value: string) => void,
  onCancel: () => void,
): void {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "mm-inline-input";
  input.placeholder = placeholder;
  input.value = value;
  input.style.width = `${width}px`;

  const centerX = layout.x + layout.width / 2;
  const screenX = camera.x + centerX * camera.scale;
  const screenY = camera.y + (layout.y + layout.height / 2 + 10) * camera.scale;
  input.style.left = `${screenX}px`;
  input.style.top = `${screenY}px`;
  input.style.transform = "translate(-50%, 0)";

  const commit = () => onCommit(input.value);
  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      input.removeEventListener("blur", commit);
      onCancel();
    }
    e.stopPropagation();
  });

  container.appendChild(input);
  input.focus();
  input.select();
}
