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
  for (const node of iterateNodes(root)) visuals.set(node.id, nodeVisual(node, node.id === root.id));
  return visuals;
}

// The narrowest a fixed width may squeeze the text, so a box never becomes
// a column of single letters.
const MIN_WRAP_WIDTH = 40;

function nodeVisual(node: MindMapNode, isRoot: boolean): NodeVisual {
  const style = isRoot ? ROOT_STYLE : LEAF_STYLE;
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
      const natural = nodeVisual({ ...node, width: undefined }, false).size.width;
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
  const revealNode = state.revealId ? findNode(root, state.revealId) : null;
  const revealSet = new Set(revealNode ? [...iterateNodes(revealNode)].map((n) => n.id) : []);
  revealSet.delete(state.revealId ?? "");

  for (const edge of edges) {
    const dimmed = focusSet !== null && (!focusSet.has(edge.fromId) || !focusSet.has(edge.toId));
    const edgeEl = renderEdge(edge, positions, state.edgeStyle, rc, dimmed);
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
      node.id === root.id,
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
      const fill = node.id === root.id ? rootFill() : boxFill(layout.color);
      renderEditOverlay(container, node, layout, visual, fill, !!state.sketchy, camera, callbacks);
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
  isJustFolded: boolean,
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

  if (rc) {
    const colors = boxColors(isRoot, isSelected, isDropTarget, layout.color);
    const options = {
      fill: colors.fill,
      fillStyle: "solid",
      stroke: colors.stroke,
      strokeWidth: colors.strokeWidth,
      roughness: 1.8,
      bowing: 1.2,
      seed: seedFrom(node.id),
      ...(colors.dashed ? { strokeLineDash: [5, 3] } : {}),
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
  text.setAttribute("class", isRoot ? "mm-root-text" : "mm-node-text");
  const { leading, trailing } = visual;
  const centerX = layout.x + leading + (size.width - leading - trailing) / 2;
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
  if (hasChildren && node.collapsed) {
    g.appendChild(renderFoldPill(layout, size, hiddenCount, pillWidth, isJustFolded));
  } else if (hasChildren) {
    g.appendChild(renderFoldButton(layout, size, isRoot));
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
    g.appendChild(renderStatusBadge(node.status, layout.x + style.paddingX + 6, firstLineCenterY));
  }
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

function foldPillWidth(count: number): number {
  return Math.max(22, String(count).length * 7 + 14);
}

// An open branch needs no icon: its children are on screen. A small dot in
// the branch color marks where the edges leave the box, and a "−" button
// over it appears on hover or selection (see styles.css).
function renderFoldButton(layout: NodeLayout, size: NodeSize, isRoot: boolean): SVGGElement {
  const edgeX = layout.x + size.width;
  const wrapper = document.createElementNS(SVG_NS, "g");

  // The root's edges each take a different branch color, so one colored
  // dot would match none of them.
  if (!isRoot) {
    const port = document.createElementNS(SVG_NS, "circle");
    port.setAttribute("class", "mm-fold-port");
    port.setAttribute("cx", String(edgeX));
    port.setAttribute("cy", String(layout.y));
    port.setAttribute("r", "3");
    port.setAttribute("fill", layout.color);
    wrapper.appendChild(port);
  }

  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("class", "mm-collapse-toggle mm-fold-btn");
  g.setAttribute("transform", `translate(${edgeX + FOLD_BUTTON_OFFSET} ${layout.y})`);
  g.appendChild(svgTitle("Fold branch (.)"));
  g.appendChild(hitRect(-MIN_TARGET / 2, MIN_TARGET));

  const circle = document.createElementNS(SVG_NS, "circle");
  circle.setAttribute("r", String(FOLD_BUTTON_RADIUS));
  g.appendChild(circle);

  const minus = document.createElementNS(SVG_NS, "path");
  minus.setAttribute("d", "M -4 0 H 4");
  g.appendChild(minus);

  wrapper.appendChild(g);
  return wrapper;
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
  pill.setAttribute("fill", layout.color);
  g.appendChild(pill);

  const label = document.createElementNS(SVG_NS, "text");
  label.setAttribute("x", String(width / 2));
  label.setAttribute("text-anchor", "middle");
  label.setAttribute("dominant-baseline", "central");
  label.setAttribute("fill", "#ffffff");
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
    const options = {
      stroke: to.color,
      strokeWidth: 2,
      roughness: 1.6,
      bowing: 1,
      seed: seedFrom(edge.fromId + edge.toId),
    };
    const sketch = cachedSketch(`path|${d}|${JSON.stringify(options)}`, () => rc.path(d, options));
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
  fill: string,
  sketchy: boolean,
  camera: Camera,
  callbacks: RenderCallbacks,
): void {
  const { style } = visual;
  // Badges are hidden while editing, so the text may use the full fixed
  // box width (if the node has one) minus padding.
  const fixedTextWidth = node.width ? Math.max(MIN_WRAP_WIDTH, node.width - style.paddingX * 2) : null;
  const input = document.createElement("textarea");
  input.className = `mm-edit-input${style === ROOT_STYLE ? " mm-edit-root" : ""}`;
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
  input.style.background = fill;

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
