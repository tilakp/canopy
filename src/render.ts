// Draws a map as SVG. Every render rebuilds the whole scene from the tree:
// no diffing, so no stale element can survive a change. Changes that
// touch nothing but the selection, the camera or a drag preview have
// cheaper paths (applySelection, applyCamera, motion.ts), since a full
// render costs tens of milliseconds on a large map.
import rough from "roughjs";
import type { RoughSVG } from "roughjs/bin/svg";
import { countDescendants, findNode, pathTo, visibleChildren, visibleNodes, type MindMapNode } from "./model";
import { computeLayout, type Edge, type NodeLayout } from "./layout";
import { buildVisuals, IMAGE_GAP, IMAGE_THUMB_SIZE, META_ICON_SLOT, type NodeVisual } from "./visuals";
import { themeColors, type ThemeColors } from "./colors";
import { cameraTransform, computeInitialCamera, type Box, type Camera } from "./camera";
import { edgeAnchorY, edgePath, edgeWidth, type EdgeStyle } from "./edges";
import { captureDraft, renderEditor, restoreDraft, type EditorCallbacks, type EditorTarget } from "./editors";
import { slideNodes, motionAllowed } from "./motion";
import { LruCache } from "./lru";
import { getTheme } from "./theme";
import { getFontFamily } from "./fonts";

const SVG_NS = "http://www.w3.org/2000/svg";

const ADD_BUTTON_GAP = 14;
const ADD_BUTTON_RADIUS = 9;
// The fold control sits where a node's lines leave it. An open node shows a
// "−" button there (on hover or selection only); a folded node shows a pill
// with the number of hidden ideas.
const FOLD_BUTTON_RADIUS = 9;
const FOLD_BUTTON_OFFSET = 12; // from the box's right edge to the button's center
const FOLD_PILL_GAP = 4; // from the box's right edge to the pill
const FOLD_PILL_HEIGHT = 18;
// Room before the add button for an open node's fold button.
const FOLD_BUTTON_CLEARANCE = 20;
// WCAG 2.5.8: pointer targets at least 24x24px.
const MIN_TARGET = 24;
// The selection and drop rings sit this far outside the box.
const RING_GAP = 4;

export interface RenderState {
  selectedIds: ReadonlySet<string>;
  editor: EditorTarget | null;
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

export interface RenderResult {
  camera: Camera;
  positions: Map<string, NodeLayout>;
  // The drawn map's bounds in world coordinates: every box and fold pill,
  // not the hover-only controls.
  contentBBox: Box;
}

// What one render needs everywhere, worked out once.
interface Scene {
  theme: ThemeColors;
  rc: RoughSVG | null;
  selectedIds: ReadonlySet<string>;
  editingId: string | null;
  dropTargetId: string | null;
  focusSet: Set<string> | null;
  popId: string | null;
}

export function renderMindMap(
  container: HTMLElement,
  root: MindMapNode,
  state: RenderState,
  callbacks: EditorCallbacks,
): RenderResult {
  const draft = captureDraft(container);
  container.innerHTML = "";

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "mm-canvas");
  const content = document.createElementNS(SVG_NS, "g");
  svg.appendChild(content);
  container.appendChild(svg);

  const fontFamily = getFontFamily();
  const visuals = buildVisuals(root, fontFamily);
  const { positions, edges } = computeLayout(root, (node) => visuals.get(node.id)!.size);
  const focusSet = state.focusId ? computeFocusSet(root, state.focusId) : null;
  const scene: Scene = {
    theme: themeColors(getTheme() === "dark"),
    rc: state.sketchy ? rough.svg(svg) : null,
    selectedIds: state.selectedIds,
    editingId: state.editor?.kind === "title" ? state.editor.id : null,
    dropTargetId: state.dropTargetId ?? null,
    focusSet,
    popId: state.popId ?? null,
  };
  const animate = !!state.animate && !state.sketchy && motionAllowed();
  // The slide covers a branch that opens, so the CSS reveal is only for
  // when there is no slide.
  const revealNode = state.revealId && !animate ? findNode(root, state.revealId) : null;
  const revealSet = new Set(revealNode ? [...visibleNodes(revealNode)].map((n) => n.id) : []);
  revealSet.delete(state.revealId ?? "");

  for (const edge of edges) {
    const dimmed = focusSet !== null && (!focusSet.has(edge.fromId) || !focusSet.has(edge.toId));
    const el = renderEdge(edge, positions, state.edgeStyle, scene, dimmed);
    if (revealSet.has(edge.toId)) el.classList.add("mm-revealing");
    content.appendChild(el);
  }
  const parents = new Map<string, string>();
  for (const node of visibleNodes(root)) {
    for (const child of visibleChildren(node)) parents.set(child.id, node.id);
    const el = renderNode(node, positions.get(node.id)!, visuals.get(node.id)!, scene);
    if (revealSet.has(node.id)) el.classList.add("mm-revealing");
    content.appendChild(el);
  }

  showAddButtonOnHover(container);
  const contentBBox = contentBounds(root, positions);
  const camera =
    state.camera ?? computeInitialCamera(contentBBox, container.getBoundingClientRect(), root.children.length === 0);
  content.setAttribute("transform", cameraTransform(camera));
  syncGrid(container, camera);
  slideNodes(container, content, positions, parents, state.edgeStyle, animate);

  // A blank map says how to start.
  if (root.children.length === 0 && !state.editor) {
    const rootLayout = positions.get(root.id)!;
    const hint = document.createElementNS(SVG_NS, "text");
    hint.setAttribute("class", "mm-empty-hint");
    hint.setAttribute("x", String(rootLayout.x));
    hint.setAttribute("y", String(rootLayout.y + rootLayout.height / 2 + 28));
    hint.textContent = "Press Tab to add your first idea, or ? for all shortcuts";
    content.appendChild(hint);
  }

  if (state.editor) {
    const node = findNode(root, state.editor.id);
    const layout = node && positions.get(node.id);
    if (node && layout) {
      const ctx = { camera, theme: scene.theme, fontFamily, sketchy: !!state.sketchy };
      renderEditor(container, state.editor, node, layout, visuals.get(node.id)!, ctx, callbacks);
    }
  }
  if (draft) restoreDraft(container, draft);
  return { camera, positions, contentBBox };
}

// Re-aims the camera without rebuilding anything: layout works in world
// coordinates, so a pan or zoom changes only the content group's transform.
// Returns false if nothing is rendered yet, so the caller renders instead.
export function applyCamera(container: HTMLElement, camera: Camera): boolean {
  const content = container.querySelector<SVGGElement>("svg.mm-canvas > g");
  if (!content) return false;
  content.setAttribute("transform", cameraTransform(camera));
  syncGrid(container, camera);
  return true;
}

// Marks a new selection on the drawn map without rebuilding it, since a
// selection changes only the selected class and the rings. Returns false
// if nothing is rendered yet.
export function applySelection(container: HTMLElement, selectedIds: ReadonlySet<string>): boolean {
  const content = container.querySelector<SVGGElement>("svg.mm-canvas > g");
  if (!content) return false;
  for (const g of content.querySelectorAll<SVGGElement>(":scope > .mm-node")) {
    const selected = selectedIds.has(g.dataset.nodeId!);
    if (selected === g.classList.contains("mm-selected")) continue;
    g.classList.toggle("mm-selected", selected);
    if (selected) g.appendChild(ringFor(g, "selection"));
    else g.querySelector(".mm-selection-ring")?.remove();
  }
  return true;
}

// Shows the drop target during a drag without a render.
export function setDropTarget(container: HTMLElement, id: string | null): void {
  for (const ring of container.querySelectorAll(".mm-drop-ring")) {
    ring.parentElement!.classList.remove("mm-drop-target");
    ring.remove();
  }
  if (!id) return;
  const g = [...container.querySelectorAll<SVGGElement>("svg.mm-canvas > g > .mm-node")].find(
    (el) => el.dataset.nodeId === id,
  );
  if (!g) return;
  g.classList.add("mm-drop-target");
  g.appendChild(ringFor(g, "drop"));
}

// The dot grid (styles.css, .mm-grid) moves and scales with the map. At a
// small zoom every other dot is left out, so the grid does not turn grey.
const GRID_SPACING = 22;

function syncGrid(container: HTMLElement, camera: Camera): void {
  const size = GRID_SPACING * camera.scale * (camera.scale < 0.5 ? 2 : 1);
  container.style.backgroundSize = `${size}px ${size}px`;
  container.style.backgroundPosition = `${camera.x}px ${camera.y}px`;
}

// The bounds of what is drawn, from the layout, so nothing has to be
// measured: every box, plus the count pill of a folded node.
function contentBounds(root: MindMapNode, positions: Map<string, NodeLayout>): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of visibleNodes(root)) {
    const p = positions.get(node.id)!;
    const pill = node.collapsed && node.children.length > 0 ? FOLD_PILL_GAP + foldPillWidth(countDescendants(node)) : 0;
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x + p.width + pill);
    minY = Math.min(minY, p.y - p.height / 2);
    maxY = Math.max(maxY, p.y + p.height / 2);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// Focus mode keeps the focused node, everything below it and its ancestors
// up to the root lit, so the branch's place in the map stays visible.
function computeFocusSet(root: MindMapNode, focusId: string): Set<string> {
  const path = pathTo(root, focusId);
  if (!path) return new Set();
  const set = new Set(path.map((n) => n.id));
  for (const n of visibleNodes(path[path.length - 1])) set.add(n.id);
  return set;
}

// Deterministic per-shape seed so rough.js's hand-drawn wobble stays the
// same on every render instead of jittering.
function seedFrom(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(hash) || 1;
}

// rough.js gives the same shape for the same seed and inputs, but computing
// it is slow (65ms per render at 79 nodes), and every select, drag or edit
// renders again. So each shape is generated once, keyed by all of its
// inputs, and cloned on later renders.
const sketchCache = new LruCache<string, SVGGElement>(5000);

function cachedSketch(key: string, draw: () => SVGGElement): SVGGElement {
  let el = sketchCache.get(key);
  if (!el) {
    el = draw();
    sketchCache.set(key, el);
  }
  return el.cloneNode(true) as SVGGElement;
}

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, String(value));
  return el;
}

function renderNode(node: MindMapNode, layout: NodeLayout, visual: NodeVisual, scene: Scene): SVGGElement {
  const { tier, wrapped, style, size, leading, trailing } = visual;
  const { theme, rc } = scene;
  const colors = theme.branch(layout.color);
  const isRoot = tier === "root";
  const isSelected = scene.selectedIds.has(node.id);
  const isDimmed = scene.focusSet !== null && !scene.focusSet.has(node.id);
  const isDropTarget = scene.dropTargetId === node.id;

  const g = document.createElementNS(SVG_NS, "g");
  const flags = [
    isSelected && "mm-selected",
    scene.editingId === node.id && "mm-editing",
    isDropTarget && "mm-drop-target",
    isDimmed && "mm-dimmed",
  ];
  g.setAttribute("class", ["mm-node", `mm-${tier}`, ...flags].filter(Boolean).join(" "));
  g.dataset.nodeId = node.id;
  const boxTop = layout.y - size.height / 2;
  const boxBottom = boxTop + size.height;
  // Where the rings go; read by applySelection and setDropTarget.
  g.dataset.box = `${layout.x} ${boxTop} ${size.width} ${size.height} ${style.rx}`;
  // The hover color of the + and − buttons.
  g.style.setProperty("--mm-branch", colors.line);

  // Invisible but hit-testable, from the box through the add button: the
  // two are separate shapes with unpainted space between them, and without
  // this the :hover that shows the button would drop in that gap.
  const hasChildren = node.children.length > 0;
  const hiddenCount = node.collapsed ? countDescendants(node) : 0;
  const pillWidth = foldPillWidth(hiddenCount);
  const addButtonClearance = !hasChildren
    ? 0
    : node.collapsed
      ? Math.max(FOLD_BUTTON_CLEARANCE, FOLD_PILL_GAP * 2 + pillWidth - ADD_BUTTON_GAP + ADD_BUTTON_RADIUS)
      : FOLD_BUTTON_CLEARANCE;
  g.appendChild(
    svgEl("rect", {
      class: "mm-hover-zone",
      x: layout.x,
      y: boxTop,
      width: size.width + addButtonClearance + ADD_BUTTON_GAP + ADD_BUTTON_RADIUS * 2,
      height: size.height,
    }),
  );

  // The box: a card for the root, a tinted pill for a branch, and for a
  // deeper idea an unpainted (but clickable) area over a colored underline.
  const fill = isRoot ? theme.rootFill : tier === "branch" ? colors.fill : "transparent";
  const stroke = isRoot ? theme.rootBorder : tier === "branch" ? colors.stroke : "none";
  const boxClass = isRoot ? "mm-root-box" : "mm-node-box";
  if (rc && tier !== "leaf") {
    const options = {
      fill,
      fillStyle: "solid",
      stroke: stroke === "none" ? colors.line : stroke,
      strokeWidth: 1,
      roughness: 1.8,
      bowing: 1.2,
      seed: seedFrom(node.id),
    };
    const key = `rect|${layout.x}|${boxTop}|${size.width}|${size.height}|${JSON.stringify(options)}`;
    const sketch = cachedSketch(key, () => rc.rectangle(layout.x, boxTop, size.width, size.height, options));
    sketch.classList.add(boxClass, "mm-sketchy-box");
    g.appendChild(sketch);
  } else {
    const box = { class: boxClass, x: layout.x, y: boxTop, width: size.width, height: size.height, rx: style.rx };
    g.appendChild(svgEl("rect", { ...box, fill, stroke }));
  }

  if (tier === "leaf") {
    const x2 = layout.x + size.width;
    if (rc) {
      const options = { stroke: colors.line, strokeWidth: 2, roughness: 1.2, seed: seedFrom(node.id) };
      const key = `line|${layout.x}|${boxBottom}|${x2}|${JSON.stringify(options)}`;
      const sketch = cachedSketch(key, () => rc.line(layout.x, boxBottom, x2, boxBottom, options));
      sketch.classList.add("mm-underline");
      g.appendChild(sketch);
    } else {
      g.appendChild(svgEl("path", { class: "mm-underline", d: `M ${layout.x} ${boxBottom} H ${x2}`, stroke: colors.line }));
    }
  }

  if (isSelected) g.appendChild(ringFor(g, "selection"));
  if (isDropTarget) g.appendChild(ringFor(g, "drop"));

  if (node.image) {
    const image = svgEl("image", {
      x: layout.x + (size.width - IMAGE_THUMB_SIZE) / 2,
      y: boxTop + style.paddingY,
      width: IMAGE_THUMB_SIZE,
      height: IMAGE_THUMB_SIZE,
      preserveAspectRatio: "xMidYMid slice",
      href: node.image,
    });
    image.setAttributeNS("http://www.w3.org/1999/xlink", "href", node.image);
    g.appendChild(image);
  }

  // A deeper idea's text starts at the left, on its line; the root and
  // branches center theirs in the box. The fill is an attribute so exports
  // keep it.
  const textX =
    tier === "leaf" ? layout.x + style.paddingX + leading : layout.x + leading + (size.width - leading - trailing) / 2;
  const text = svgEl("text", {
    class: isRoot ? "mm-root-text" : "mm-node-text",
    "text-anchor": tier === "leaf" ? "start" : "middle",
    fill: isRoot ? theme.text : tier === "branch" ? colors.text : theme.leafText,
  });
  // The text block is centered on the box, or sits under the image.
  const firstLineY = node.image
    ? boxTop + style.paddingY + IMAGE_THUMB_SIZE + IMAGE_GAP + style.lineHeight / 2
    : layout.y - ((wrapped.lines.length - 1) * style.lineHeight) / 2;
  wrapped.lines.forEach((line, i) => {
    const tspan = svgEl("tspan", { x: textX, y: firstLineY + i * style.lineHeight, "dominant-baseline": "central" });
    tspan.textContent = line;
    text.appendChild(tspan);
  });
  g.appendChild(text);

  // Where the shared add button goes when the pointer is over this node.
  g.dataset.add = `${layout.x + size.width + addButtonClearance + ADD_BUTTON_GAP} ${layout.y}`;
  if (hasChildren && node.collapsed) {
    g.appendChild(renderFoldPill(layout, size.width, hiddenCount, pillWidth, colors, node.id === scene.popId));
  } else if (hasChildren) {
    g.appendChild(renderFoldButton(layout, size.width));
  }

  const rightSlotX = layout.x + size.width - style.paddingX - META_ICON_SLOT / 2 + 3;
  if (node.link) g.appendChild(renderMetaIcon(LINK_ICON_PATH, rightSlotX, firstLineY, "mm-link-badge", node.link));
  if (node.notes) {
    const x = rightSlotX - (node.link ? META_ICON_SLOT : 0);
    g.appendChild(renderMetaIcon(NOTES_ICON_PATH, x, firstLineY, "mm-notes-badge", truncate(node.notes, 280)));
  }
  if (node.status) {
    g.appendChild(renderStatusBadge(node.status, layout.x + style.paddingX + 6, firstLineY, colors.line, theme.onLine));
  }
  return g;
}

// A selection or drop ring around the node, from the box geometry the node
// carries in data-box.
function ringFor(g: SVGGElement, kind: "selection" | "drop"): SVGRectElement {
  const [x, y, width, height, rx] = g.dataset.box!.split(" ").map(Number);
  return svgEl("rect", {
    class: `mm-ring mm-${kind}-ring`,
    x: x - RING_GAP,
    y: y - RING_GAP,
    width: width + RING_GAP * 2,
    height: height + RING_GAP * 2,
    rx: rx + RING_GAP,
  });
}

// 12x12 line icons centered on (0, 0), drawn in the muted text color.
const NOTES_ICON_PATH = "M -4.5 -4 H 4.5 M -4.5 -1.3 H 4.5 M -4.5 1.4 H 4.5 M -4.5 4.1 H 1.5";
const LINK_ICON_PATH =
  "M -0.8 -3.2 L 0.8 -4.8 A 2.6 2.6 0 0 1 4.8 -0.8 L 3.2 0.8 M 0.8 3.2 L -0.8 4.8 A 2.6 2.6 0 0 1 -4.8 0.8 L -3.2 -0.8 M -1.8 1.8 L 1.8 -1.8";

function renderMetaIcon(d: string, x: number, y: number, className: string, tooltip: string): SVGGElement {
  const g = svgEl("g", { class: `mm-meta-icon ${className}`, transform: `translate(${x} ${y})` });
  g.appendChild(svgTitle(tooltip));
  // As tall as WCAG asks; as wide as the slot, so neighbors don't overlap.
  const hit = { class: "mm-fold-hit", x: -META_ICON_SLOT / 2, y: -MIN_TARGET / 2, width: META_ICON_SLOT, height: MIN_TARGET };
  g.appendChild(svgEl("rect", hit));
  g.appendChild(svgEl("path", { d }));
  return g;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// The checklist badge: an empty circle for "todo", a filled circle in the
// branch color with a check for "done".
function renderStatusBadge(status: "todo" | "done", x: number, y: number, color: string, checkColor: string): SVGGElement {
  const g = svgEl("g", { class: `mm-status-badge mm-status-${status}`, transform: `translate(${x} ${y})` });
  const circle = svgEl("circle", { r: 6 });
  g.appendChild(circle);
  if (status === "done") {
    circle.setAttribute("fill", color);
    circle.setAttribute("stroke", color);
    g.appendChild(svgEl("path", { d: "M -3 0 L -1 2.5 L 3.5 -2.5", fill: "none", stroke: checkColor }));
  }
  return g;
}

function foldPillWidth(count: number): number {
  return Math.max(22, String(count).length * 7 + 14);
}

// An open branch needs no icon: its children are on screen. A "−" button
// where its lines leave the node shows on hover or selection.
function renderFoldButton(layout: NodeLayout, boxWidth: number): SVGGElement {
  const g = svgEl("g", {
    class: "mm-collapse-toggle mm-fold-btn",
    transform: `translate(${layout.x + boxWidth + FOLD_BUTTON_OFFSET} ${edgeAnchorY(layout)})`,
  });
  g.appendChild(svgTitle("Fold branch (.)"));
  g.appendChild(hitRect(-MIN_TARGET / 2, MIN_TARGET));
  g.appendChild(svgEl("circle", { r: FOLD_BUTTON_RADIUS }));
  g.appendChild(svgEl("path", { d: "M -4 0 H 4" }));
  return g;
}

// A folded branch says how much it hides: a pill in the branch color with
// the number of hidden ideas, always shown (also in exports and print).
function renderFoldPill(
  layout: NodeLayout,
  boxWidth: number,
  count: number,
  width: number,
  colors: { fill: string; line: string; text: string },
  pop: boolean,
): SVGGElement {
  const g = svgEl("g", {
    class: `mm-collapse-toggle mm-fold-pill${pop ? " mm-popping" : ""}`,
    transform: `translate(${layout.x + boxWidth + FOLD_PILL_GAP} ${layout.y})`,
  });
  g.appendChild(svgTitle(`Show ${count} hidden ${count === 1 ? "idea" : "ideas"}`));
  g.appendChild(hitRect(-2, Math.max(MIN_TARGET, width + 4)));
  const pill = { y: -FOLD_PILL_HEIGHT / 2, width, height: FOLD_PILL_HEIGHT, rx: FOLD_PILL_HEIGHT / 2 };
  g.appendChild(svgEl("rect", { ...pill, fill: colors.fill, stroke: colors.line }));
  const label = svgEl("text", { x: width / 2, "text-anchor": "middle", "dominant-baseline": "central", fill: colors.text });
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
  return svgEl("rect", { class: "mm-fold-hit", x, y: -MIN_TARGET / 2, width, height: MIN_TARGET });
}

// One add button per canvas, not per node: it shows on hover only, and a
// button in every node was a quarter of the map's elements (and of its
// render time). The pointer entering a node moves the button into that
// node's group, so CSS :hover and the click handling work as if each node
// had its own.
const hoverCanvases = new WeakSet<HTMLElement>();

function showAddButtonOnHover(container: HTMLElement): void {
  if (hoverCanvases.has(container)) return;
  hoverCanvases.add(container);
  container.addEventListener("pointerover", (e) => {
    const g = (e.target as Element).closest<SVGGElement>(".mm-node");
    if (!g?.dataset.add || g.querySelector(":scope > .mm-add-btn")) return;
    const content = g.parentElement!;
    let button = content.querySelector<SVGGElement>(".mm-add-btn");
    if (!button) {
      button = svgEl("g", { class: "mm-add-btn" });
      button.appendChild(svgEl("circle", { r: ADD_BUTTON_RADIUS }));
      button.appendChild(svgEl("path", { d: "M -4 0 H 4 M 0 -4 V 4" }));
    }
    const [x, y] = g.dataset.add.split(" ");
    button.setAttribute("transform", `translate(${x} ${y})`);
    g.appendChild(button);
  });
}

function renderEdge(
  edge: Edge,
  positions: Map<string, NodeLayout>,
  edgeStyle: EdgeStyle,
  scene: Scene,
  isDimmed: boolean,
): SVGElement {
  const from = positions.get(edge.fromId)!;
  const to = positions.get(edge.toId)!;
  const d = edgePath(from, to, edgeStyle);
  const color = scene.theme.branch(to.color).line;
  const width = edgeWidth(from.depth);
  let el: SVGElement;
  if (scene.rc) {
    const rc = scene.rc;
    const options = { stroke: color, strokeWidth: width, roughness: 1.6, bowing: 1, seed: seedFrom(edge.fromId + edge.toId) };
    el = cachedSketch(`path|${d}|${JSON.stringify(options)}`, () => rc.path(d, options));
    el.setAttribute("class", "mm-edge mm-sketchy-edge");
  } else {
    el = svgEl("path", { class: "mm-edge", d, stroke: color, "stroke-width": width });
  }
  if (isDimmed) el.classList.add("mm-dimmed");
  el.dataset.from = edge.fromId;
  el.dataset.to = edge.toId;
  return el;
}
