import type { MindMapNode } from "./model";

// Converts the tree to a Markdown outline: the root becomes an H1, and each
// child subtree becomes a nested bullet list (2-space indent per depth).
// A node's icon prefixes its bullet text; a link wraps the bullet as a
// Markdown link; notes render as an italic line one level deeper than the
// bullet they belong to; a checklist status prefixes the bullet with
// standard `[ ] `/`[x] ` task-list syntax.
export function toMarkdown(root: MindMapNode): string {
  const lines: string[] = [`# ${root.text}`, ""];
  for (const child of root.children) {
    lines.push(...renderNode(child, 1));
  }
  return lines.join("\n") + "\n";
}

function renderNode(node: MindMapNode, depth: number): string[] {
  const indent = "  ".repeat(depth - 1);
  // An empty bullet ("- ") is not a bullet to a Markdown parser, so it
  // would drop the node on import and move its children to the wrong parent.
  const label = (node.icon ? `${node.icon} ` : "") + (node.text.trim() || "Untitled");
  const bulletText = node.link ? `[${label}](${node.link})` : label;
  const checklistPrefix = node.status ? (node.status === "done" ? "[x] " : "[ ] ") : "";

  const lines = [`${indent}- ${checklistPrefix}${bulletText}`];
  // One italic line per notes line: a single *...* cannot span lines.
  for (const noteLine of (node.notes ?? "").split("\n")) {
    if (noteLine.trim()) lines.push(`${indent}  *${noteLine.trim()}*`);
  }
  for (const child of node.children) {
    lines.push(...renderNode(child, depth + 1));
  }
  return lines;
}
