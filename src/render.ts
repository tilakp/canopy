import { findNode, type MindMapNode } from "./model";
import { computeLayout, type Edge, type NodeLayout } from "./layout";

const SVG_NS = "http://www.w3.org/2000/svg";

const ROOT_PADDING_X = 20;
const ROOT_PADDING_Y = 14;
const LEAF_PADDING_X = 8;
const LEAF_PADDING_Y = 5;
const TEXT_OFFSET_Y = 6;
const ROOT_FONT_SIZE = 20;
const LEAF_FONT_SIZE = 15;

export interface Camera {
  x: number;
  y: number;
  scale: number;
}

export interface RenderState {
  selectedId: string | null;
  editingId: string | null;
  camera?: Camera;
}

export interface RenderCallbacks {
  onEditCommit(id: string, text: string): void;
  onEditCancel(): void;
}

export interface RenderResult {
  camera: Camera;
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
  container.appendChild(svg); // Attach before measuring text, so getBBox works.

  const { positions, edges } = computeLayout(root);
  const rootLayout = positions.get(root.id)!;

  const rootHalfWidth = renderRootNode(content, root, rootLayout, state.selectedId, state.editingId);

  for (const edge of edges) {
    content.appendChild(renderEdge(edge, positions, rootHalfWidth));
  }

  for (const node of iterateNodes(root)) {
    if (node.id === root.id) continue;
    const layout = positions.get(node.id)!;
    content.appendChild(renderLeafNode(node, layout, state.selectedId, state.editingId));
  }

  const camera = state.camera ?? computeInitialCamera(container, content);
  content.setAttribute("transform", `translate(${camera.x} ${camera.y}) scale(${camera.scale})`);

  if (state.editingId) {
    const node = findNode(root, state.editingId);
    const layout = node && positions.get(node.id);
    if (node && layout) {
      renderEditOverlay(container, node, layout, camera, callbacks);
    }
  }

  return { camera };
}

function* iterateNodes(node: MindMapNode): Generator<MindMapNode> {
  yield node;
  for (const child of node.children) yield* iterateNodes(child);
}

function computeInitialCamera(container: HTMLElement, content: SVGGElement): Camera {
  const bbox = content.getBBox();
  const rect = container.getBoundingClientRect();
  const x = rect.width / 2 - (bbox.x + bbox.width / 2);
  const y = rect.height / 2 - (bbox.y + bbox.height / 2);
  return { x, y, scale: 1 };
}

// Renders the root's box + label and returns half the box width, which
// edges need to know where they leave the box on each side.
function renderRootNode(
  content: SVGGElement,
  node: MindMapNode,
  layout: NodeLayout,
  selectedId: string | null,
  editingId: string | null,
): number {
  const isSelected = selectedId === node.id;
  const isEditing = editingId === node.id;

  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("class", `mm-node mm-root${isSelected ? " mm-selected" : ""}`);
  g.dataset.nodeId = node.id;
  content.appendChild(g);

  const rect = document.createElementNS(SVG_NS, "rect");
  rect.setAttribute("class", "mm-root-box");
  rect.setAttribute("rx", "14");
  rect.setAttribute("ry", "14");
  g.appendChild(rect);

  const text = document.createElementNS(SVG_NS, "text");
  text.setAttribute("x", String(layout.x));
  text.setAttribute("y", String(layout.y));
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("dominant-baseline", "central");
  text.setAttribute("class", `mm-root-text${isEditing ? " mm-editing" : ""}`);
  text.textContent = node.text;
  g.appendChild(text);

  const bbox = text.getBBox();
  const halfWidth = bbox.width / 2 + ROOT_PADDING_X;
  rect.setAttribute("x", String(layout.x - halfWidth));
  rect.setAttribute("y", String(bbox.y - ROOT_PADDING_Y));
  rect.setAttribute("width", String(halfWidth * 2));
  rect.setAttribute("height", String(bbox.height + ROOT_PADDING_Y * 2));

  return halfWidth;
}

function renderLeafNode(
  node: MindMapNode,
  layout: NodeLayout,
  selectedId: string | null,
  editingId: string | null,
): SVGGElement {
  const isSelected = selectedId === node.id;
  const isEditing = editingId === node.id;

  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("class", `mm-node mm-leaf${isSelected ? " mm-selected" : ""}`);
  g.dataset.nodeId = node.id;

  const hit = document.createElementNS(SVG_NS, "rect");
  hit.setAttribute("class", `mm-node-hit${isEditing ? " mm-editing" : ""}`);
  hit.setAttribute("rx", "6");
  hit.setAttribute("ry", "6");
  g.appendChild(hit);

  const text = document.createElementNS(SVG_NS, "text");
  text.setAttribute("x", String(layout.x));
  text.setAttribute("y", String(layout.y - TEXT_OFFSET_Y));
  text.setAttribute("text-anchor", layout.side === "left" ? "end" : "start");
  text.setAttribute("class", `mm-node-text${isEditing ? " mm-editing" : ""}`);
  text.textContent = node.text;
  g.appendChild(text);

  const bbox = text.getBBox();
  hit.setAttribute("x", String(bbox.x - LEAF_PADDING_X));
  hit.setAttribute("y", String(bbox.y - LEAF_PADDING_Y));
  hit.setAttribute("width", String(bbox.width + LEAF_PADDING_X * 2));
  hit.setAttribute("height", String(bbox.height + LEAF_PADDING_Y * 2));

  return g;
}

function renderEdge(edge: Edge, positions: Map<string, NodeLayout>, rootHalfWidth: number): SVGPathElement {
  const from = positions.get(edge.fromId)!;
  const to = positions.get(edge.toId)!;
  const dir = to.side === "left" ? -1 : 1;

  const fromX = from.side === "root" ? dir * rootHalfWidth : from.x;
  const fromY = from.y;
  const midX = (fromX + to.x) / 2;

  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", `M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${to.y}, ${to.x} ${to.y}`);
  path.setAttribute("class", "mm-edge");
  path.setAttribute("stroke", to.color);
  return path;
}

function renderEditOverlay(
  container: HTMLElement,
  node: MindMapNode,
  layout: NodeLayout,
  camera: Camera,
  callbacks: RenderCallbacks,
): void {
  const isRoot = layout.side === "root";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "mm-edit-input";
  input.value = node.text;

  const screenX = camera.x + layout.x * camera.scale;
  const screenY = camera.y + layout.y * camera.scale;
  input.style.left = `${screenX}px`;
  input.style.top = `${screenY}px`;
  input.style.fontSize = `${(isRoot ? ROOT_FONT_SIZE : LEAF_FONT_SIZE) * camera.scale}px`;

  if (isRoot) {
    input.style.textAlign = "center";
    input.style.transform = "translate(-50%, -50%)";
  } else if (layout.side === "left") {
    input.style.textAlign = "right";
    input.style.transform = "translate(-100%, -70%)";
  } else {
    input.style.textAlign = "left";
    input.style.transform = "translate(0, -70%)";
  }

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
