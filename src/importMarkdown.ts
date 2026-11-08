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

  const title = parseBullet(titleMatch ? titleMatch[1].trim() : "Untitled");
  const root = createNode(title.text);
  if (title.icon) root.icon = title.icon;
  if (title.link) root.link = title.link;
  const stack: { node: MindMapNode; depth: number }[] = [{ node: root, depth: 0 }];
  // Italic lines right under the title are the root's notes.
  let lastBullet: MindMapNode | null = root;

  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;

    const bulletMatch = line.match(/^(\s*)[-*+]\s+(.+)$/);
    if (bulletMatch) {
      // A tab indents as much as two spaces, for outlines from editors that
      // indent with tabs.
      const depth = Math.floor(bulletMatch[1].replace(/\t/g, "  ").length / 2) + 1;
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
      const noteLine = unescapeMarkdown(notesMatch[1].trim());
      lastBullet.notes = lastBullet.notes ? `${lastBullet.notes}\n${noteLine}` : noteLine;
    }
  }

  return root;
}

function parseBullet(content: string): { text: string; icon?: string; link?: string } {
  let label = content;
  let link: string | undefined;
  // The label may hold escaped brackets ("\[") but no bare "]", so text
  // that was escaped on export is not taken for a link.
  // A link target with spaces comes in angle brackets (CommonMark).
  const linkMatch = content.match(/^\[((?:\\.|[^\\\]])+)\]\((?:<([^>]*)>|(\S+))\)$/);
  if (linkMatch) {
    label = linkMatch[1];
    link = linkMatch[2] ?? linkMatch[3];
  }
  label = unescapeMarkdown(label);

  const icon = leadingIcon(label);
  if (icon) return { text: label.slice(icon.length).trimStart(), icon, link };
  return { text: label, link };
}

// A leading emoji or symbol followed by a space is the node's icon. It is
// read as one grapheme, so an emoji built from several code points (a skin
// tone, a family, a flag, a keycap) stays whole.
// (An older WebKitGTK has no Intl.Segmenter: one code point then.)
const graphemes = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
function leadingIcon(label: string): string | null {
  const first = graphemes
    ? graphemes.segment(label)[Symbol.iterator]().next().value?.segment
    : label.match(/^\p{Extended_Pictographic}\uFE0F?/u)?.[0];
  if (!first || label[first.length] !== " ") return null;
  return /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3|\p{So}/u.test(first) ? first : null;
}

// The inverse of exportMarkdown.ts's escapeMarkdown.
function unescapeMarkdown(text: string): string {
  return text.replace(/\\([\\[\]*])/g, "$1");
}
