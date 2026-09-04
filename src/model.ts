export interface MindMapNode {
  id: string;
  text: string;
  children: MindMapNode[];
  // Manual drag adjustment layered on top of the auto-computed position,
  // applied to this node and inherited by its descendants.
  offset?: { dx: number; dy: number };
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
