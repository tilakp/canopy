import type { MindMapNode } from "./model";

// Converts the tree to a Markdown outline: the root becomes an H1, and each
// child subtree becomes a nested bullet list (2-space indent per depth).
// A node's icon prefixes its bullet text; a link wraps the bullet as a
// Markdown link; notes render as an italic line one level deeper than the
// bullet they belong to; a checklist status prefixes the bullet with
// standard `[ ] `/`[x] ` task-list syntax.
export function toMarkdown(root: MindMapNode): string {
  const lines: string[] = [`# ${linkedLabel(root)}`, ...notesLines(root, ""), ""];
  for (const child of root.children) {
    lines.push(...renderNode(child, 1));
  }
  return lines.join("\n") + "\n";
}

function renderNode(node: MindMapNode, depth: number): string[] {
  const indent = "  ".repeat(depth - 1);
  const bulletText = linkedLabel(node);
  const checklistPrefix = node.status ? (node.status === "done" ? "[x] " : "[ ] ") : "";

  const lines = [`${indent}- ${checklistPrefix}${bulletText}`];
  lines.push(...notesLines(node, `${indent}  `));
  for (const child of node.children) {
    lines.push(...renderNode(child, depth + 1));
  }
  return lines;
}

// Markdown syntax characters in a node's own text are escaped, so text
// such as "[draft](v2)" or "a*b*" comes back as text, not as a link or
// italics.
export function escapeMarkdown(text: string): string {
  return text.replace(/[\\[\]*]/g, "\\$&");
}

// Icon, then text, wrapped as a Markdown link when the node has one.
function linkedLabel(node: MindMapNode): string {
  // An empty bullet ("- ") is not a bullet to a Markdown parser, so it
  // would drop the node on import and move its children to the wrong parent.
  const label = (node.icon ? `${node.icon} ` : "") + escapeMarkdown(node.text.trim() || "Untitled");
  return node.link ? `[${label}](${node.link})` : label;
}

// One italic line per notes line: a single *...* cannot span lines.
function notesLines(node: MindMapNode, indent: string): string[] {
  return (node.notes ?? "")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => `${indent}*${escapeMarkdown(line.trim())}*`);
}
