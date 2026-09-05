import { findNode, type MindMapNode } from "./model";
import { computeLayout, type Edge, type NodeLayout, type NodeSize } from "./layout";
import { wrapText, type WrappedText } from "./textwrap";

const SVG_NS = "http://www.w3.org/2000/svg";

const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';

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

export type EdgeStyle = "curved" | "straight";

export interface Camera {
  x: number;
  y: number;
  scale: number;
}

export interface RenderState {
  selectedId: string | null;
  editingId: string | null;
  edgeStyle: EdgeStyle;
  camera?: Camera;
}

export interface RenderCallbacks {
  onEditCommit(id: string, text: string): void;
  onEditCancel(): void;
}

export interface RenderResult {
  camera: Camera;
  positions: Map<string, NodeLayout>;
}

interface NodeVisual {
  wrapped: WrappedText;
  style: BoxStyle;
  size: NodeSize;
}

function fontString(style: BoxStyle): string {
  return `${style.fontWeight} ${style.fontSize}px ${FONT_FAMILY}`;
}

// Wraps every node's text once and derives its box size from that, so the
// same wrapped lines are reused for both layout (sizing) and drawing —
// there's no separate DOM-measurement pass to go out of sync with.
function buildVisuals(root: MindMapNode): Map<string, NodeVisual> {
  const visuals = new Map<string, NodeVisual>();
  for (const node of iterateNodes(root)) {
    const style = node.id === root.id ? ROOT_STYLE : LEAF_STYLE;
    const wrapped = wrapText(node.text || " ", fontString(style), style.maxTextWidth);
    const size: NodeSize = {
      width: wrapped.width + style.paddingX * 2,
      height: wrapped.lines.length * style.lineHeight + style.paddingY * 2,
    };
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

  for (const edge of edges) {
    content.appendChild(renderEdge(edge, positions, state.edgeStyle));
  }

  for (const node of iterateNodes(root)) {
    const layout = positions.get(node.id)!;
    const visual = visuals.get(node.id)!;
    renderNode(content, node, layout, visual, node.id === root.id, state.selectedId, state.editingId);
  }

  const camera = state.camera ?? computeInitialCamera(container, content);
  content.setAttribute("transform", `translate(${camera.x} ${camera.y}) scale(${camera.scale})`);

  if (state.editingId) {
    const node = findNode(root, state.editingId);
    const layout = node && positions.get(node.id);
    const visual = node && visuals.get(node.id);
    if (node && layout && visual) {
      renderEditOverlay(container, node, layout, visual.style, camera, callbacks);
    }
  }

  return { camera, positions };
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

function* iterateNodes(node: MindMapNode): Generator<MindMapNode> {
  yield node;
  for (const child of node.children) yield* iterateNodes(child);
}

function computeInitialCamera(container: HTMLElement, content: SVGGElement): Camera {
  const bbox = safeBBox(content);
  const rect = container.getBoundingClientRect();
  const x = rect.width / 2 - (bbox.x + bbox.width / 2);
  const y = rect.height / 2 - (bbox.y + bbox.height / 2);
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

function renderNode(
  content: SVGGElement,
  node: MindMapNode,
  layout: NodeLayout,
  visual: NodeVisual,
  isRoot: boolean,
  selectedId: string | null,
  editingId: string | null,
): void {
  const isSelected = selectedId === node.id;
  const isEditing = editingId === node.id;
  const { wrapped, style, size } = visual;

  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute(
    "class",
    `mm-node ${isRoot ? "mm-root" : "mm-leaf"}${isSelected ? " mm-selected" : ""}${isEditing ? " mm-editing" : ""}`,
  );
  g.dataset.nodeId = node.id;
  content.appendChild(g);

  const boxTop = layout.y - size.height / 2;
  const rect = document.createElementNS(SVG_NS, "rect");
  rect.setAttribute("class", isRoot ? "mm-root-box" : "mm-node-box");
  rect.setAttribute("x", String(layout.x));
  rect.setAttribute("y", String(boxTop));
  rect.setAttribute("width", String(size.width));
  rect.setAttribute("height", String(size.height));
  rect.setAttribute("rx", String(style.rx));
  if (!isRoot) rect.setAttribute("fill", lighten(layout.color, 0.85));
  g.appendChild(rect);

  const text = document.createElementNS(SVG_NS, "text");
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("class", `${isRoot ? "mm-root-text" : "mm-node-text"}${isEditing ? " mm-editing" : ""}`);
  const centerX = layout.x + size.width / 2;
  wrapped.lines.forEach((line, i) => {
    const tspan = document.createElementNS(SVG_NS, "tspan");
    const lineY = layout.y - ((wrapped.lines.length - 1) * style.lineHeight) / 2 + i * style.lineHeight;
    tspan.setAttribute("x", String(centerX));
    tspan.setAttribute("y", String(lineY));
    tspan.setAttribute("dominant-baseline", "central");
    tspan.textContent = line;
    text.appendChild(tspan);
  });
  g.appendChild(text);

  g.appendChild(renderAddButton(layout, size));
}

function renderAddButton(layout: NodeLayout, size: NodeSize): SVGGElement {
  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("class", "mm-add-btn");
  const cx = layout.x + size.width + ADD_BUTTON_GAP;
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

function renderEdge(edge: Edge, positions: Map<string, NodeLayout>, edgeStyle: EdgeStyle): SVGPathElement {
  const from = positions.get(edge.fromId)!;
  const to = positions.get(edge.toId)!;

  const fromX = from.x + from.width;
  const fromY = from.y;
  const toX = to.x;
  const toY = to.y;

  const path = document.createElementNS(SVG_NS, "path");
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
  path.setAttribute("d", d);
  path.setAttribute("class", "mm-edge");
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
