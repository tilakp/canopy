import type { MindMapNode } from "./model";

// Converts the tree to a Markdown outline: the root becomes an H1, and each
// child subtree becomes a nested bullet list (2-space indent per depth).
// A node's icon prefixes its bullet text; a link wraps the bullet as a
// Markdown link; notes render as an italic line one level deeper than the
// bullet they belong to.
export function toMarkdown(root: MindMapNode): string {
  const lines: string[] = [`# ${root.text}`, ""];
  for (const child of root.children) {
    lines.push(...renderNode(child, 1));
  }
  return lines.join("\n") + "\n";
}

function renderNode(node: MindMapNode, depth: number): string[] {
  const indent = "  ".repeat(depth - 1);
  const label = (node.icon ? `${node.icon} ` : "") + node.text;
  const bulletText = node.link ? `[${label}](${node.link})` : label;

  const lines = [`${indent}- ${bulletText}`];
  if (node.notes) {
    lines.push(`${indent}  *${node.notes}*`);
  }
  for (const child of node.children) {
    lines.push(...renderNode(child, depth + 1));
  }
  return lines;
}
