export interface MindMapNode {
  id: string;
  text: string;
  children: MindMapNode[];
  // Manual drag adjustment layered on top of the auto-computed position,
  // applied to this node and inherited by its descendants.
  offset?: { dx: number; dy: number };
  // Explicit branch color starting at this node, inherited by descendants
  // until another node overrides it. Unset means "inherit from parent",
  // and an unset root falls back to the auto-assigned palette.
  color?: string;
  // When true, children are kept in the data but hidden from layout/render.
  collapsed?: boolean;
  // Freeform secondary text, shown via a small indicator + toggleable overlay.
  notes?: string;
  // An external URL associated with this node.
  link?: string;
  // A single emoji/short glyph shown alongside the node's text.
  icon?: string;
}

export function createNode(text: string): MindMapNode {
  return { id: crypto.randomUUID(), text, children: [] };
}

export function addChild(parent: MindMapNode, text: string): MindMapNode {
  const child = createNode(text);
  parent.children.push(child);
  return child;
}

export function removeNode(root: MindMapNode, id: string): boolean {
  const index = root.children.findIndex((child) => child.id === id);
  if (index !== -1) {
    root.children.splice(index, 1);
    return true;
  }
  return root.children.some((child) => removeNode(child, id));
}

export function findNode(root: MindMapNode, id: string): MindMapNode | null {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

export function findParent(root: MindMapNode, id: string): MindMapNode | null {
  for (const child of root.children) {
    if (child.id === id) return root;
    const found = findParent(child, id);
    if (found) return found;
  }
  return null;
}

export function updateText(root: MindMapNode, id: string, text: string): void {
  const node = findNode(root, id);
  if (node) node.text = text;
}

export function setOffset(root: MindMapNode, id: string, offset: { dx: number; dy: number }): void {
  const node = findNode(root, id);
  if (node) node.offset = offset;
}

export function setColor(root: MindMapNode, id: string, color: string): void {
  const node = findNode(root, id);
  if (node) node.color = color;
}

export function toggleCollapsed(root: MindMapNode, id: string): void {
  const node = findNode(root, id);
  if (node) node.collapsed = !node.collapsed;
}

export function setNotes(root: MindMapNode, id: string, notes: string): void {
  const node = findNode(root, id);
  if (node) node.notes = notes.trim() === "" ? undefined : notes;
}

export function setLink(root: MindMapNode, id: string, link: string): void {
  const node = findNode(root, id);
  if (node) node.link = link.trim() === "" ? undefined : link.trim();
}

export function setIcon(root: MindMapNode, id: string, icon: string): void {
  const node = findNode(root, id);
  if (node) node.icon = icon.trim() === "" ? undefined : icon.trim();
}

function isSelfOrDescendant(node: MindMapNode, id: string): boolean {
  return node.id === id || node.children.some((child) => isSelfOrDescendant(child, id));
}

// Moves `id` to become the last child of `newParentId`. Refuses to move the
// root (it has no parent to detach from) or drop a node into its own
// subtree (which would create a cycle). Clears the moved node's manual
// offset since it's now positioned fresh under its new parent.
export function reparentNode(root: MindMapNode, id: string, newParentId: string): boolean {
  if (id === root.id) return false;
  const node = findNode(root, id);
  const newParent = findNode(root, newParentId);
  const oldParent = findParent(root, id);
  if (!node || !newParent || !oldParent || isSelfOrDescendant(node, newParentId)) return false;

  oldParent.children.splice(oldParent.children.indexOf(node), 1);
  newParent.children.push(node);
  node.offset = undefined;
  return true;
}

// Clears every node's manual drag offset, snapping the whole tree back to
// its auto-computed layout.
export function clearOffsets(root: MindMapNode): void {
  root.offset = undefined;
  for (const child of root.children) clearOffsets(child);
}

// Swaps a node with its adjacent sibling (direction -1 = earlier, +1 =
// later). Returns false (no-op) for the root, or a node already at that end
// of its sibling list.
export function moveSibling(root: MindMapNode, id: string, direction: -1 | 1): boolean {
  const parent = findParent(root, id);
  if (!parent) return false;
  const index = parent.children.findIndex((n) => n.id === id);
  const newIndex = index + direction;
  if (newIndex < 0 || newIndex >= parent.children.length) return false;
  [parent.children[index], parent.children[newIndex]] = [parent.children[newIndex], parent.children[index]];
  return true;
}
