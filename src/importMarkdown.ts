import { addChild, createNode, type MindMapNode } from "./model";

// The inverse of exportMarkdown.ts's toMarkdown: the '# ' line becomes the
// root's text, and each bullet (2-space indent per depth, matching
// toMarkdown's exact output) becomes a child node at the corresponding
// depth. Tolerates '*'/'+' bullets and blank lines too, for a hand-written
// outline that was never produced by toMarkdown in the first place.
export function fromMarkdown(text: string): MindMapNode {
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;
  const titleMatch = i < lines.length ? lines[i].match(/^#\s+(.+)$/) : null;
  if (titleMatch) i++;

  const root = createNode(titleMatch ? titleMatch[1].trim() : "Untitled");
  const stack: { node: MindMapNode; depth: number }[] = [{ node: root, depth: 0 }];
  let lastBullet: MindMapNode | null = null;

  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;

    const bulletMatch = line.match(/^(\s*)[-*+]\s+(.+)$/);
    if (bulletMatch) {
      const depth = Math.floor(bulletMatch[1].length / 2) + 1;
      while (stack.length > 1 && stack[stack.length - 1].depth >= depth) stack.pop();
      // A task-list checkbox comes first, before the link check: in
      // "[ ] [Docs](url)" the link regex would otherwise take "[ ] [Docs"
      // as the label.
      const checkbox = bulletMatch[2].trim().match(/^\[([ xX])\]\s+(.*)$/);
      const content = checkbox ? checkbox[2] : bulletMatch[2].trim();
      const { text: bulletText, icon, link } = parseBullet(content);
      const node = addChild(stack[stack.length - 1].node, bulletText);
      if (checkbox) node.status = checkbox[1] === " " ? "todo" : "done";
      if (icon) node.icon = icon;
      if (link) node.link = link;
      stack.push({ node, depth });
      lastBullet = node;
      continue;
    }

    // An italic line right after a bullet is that node's notes — but only
    // if it doesn't already look like a '* item' bullet (no space right
    // after the opening '*'). Several italic lines are multi-line notes.
    const notesMatch = line.match(/^\s*\*(.+)\*\s*$/);
    if (notesMatch && lastBullet) {
      const noteLine = notesMatch[1].trim();
      lastBullet.notes = lastBullet.notes ? `${lastBullet.notes}\n${noteLine}` : noteLine;
    }
  }

  return root;
}

function parseBullet(content: string): { text: string; icon?: string; link?: string } {
  let label = content;
  let link: string | undefined;
  const linkMatch = content.match(/^\[(.+)\]\((\S+)\)$/);
  if (linkMatch) {
    label = linkMatch[1];
    link = linkMatch[2];
  }

  const iconMatch = label.match(/^(\p{Extended_Pictographic}\uFE0F?)\s+(.*)$/u);
  if (iconMatch) return { text: iconMatch[2], icon: iconMatch[1], link };
  return { text: label, link };
}
