import { save, open } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type { MindMapNode } from "./model";

const FILE_FILTERS = [{ name: "Canopy mind map", extensions: ["canopy", "json"] }];

export async function saveToFile(root: MindMapNode, existingPath: string | null): Promise<string | null> {
  const path =
    existingPath ??
    (await save({
      filters: FILE_FILTERS,
      defaultPath: `${root.text || "mindmap"}.canopy`,
    }));
  if (!path) return null;
  await writeTextFile(path, JSON.stringify(root, null, 2));
  return path;
}

export async function loadFromFile(): Promise<{ root: MindMapNode; path: string } | null> {
  const path = await open({ multiple: false, filters: FILE_FILTERS });
  if (!path || Array.isArray(path)) return null;
  return loadFromPath(path);
}

export async function loadFromPath(path: string): Promise<{ root: MindMapNode; path: string }> {
  const text = await readTextFile(path);
  return { root: parseDocument(text), path };
}

// A .canopy file is just JSON on disk: it can be hand-edited, truncated, or
// not a mind map at all (the open dialog accepts .json too, and a file
// double-clicked in Finder was never necessarily written by this app). The
// shape is checked here rather than trusted, because a node missing its
// `children` array throws mid-render — after `root` has already been
// swapped in, leaving the document unrenderable and its previous contents
// gone.
export function parseDocument(text: string): MindMapNode {
  return parseNode(JSON.parse(text), new Set(), 0);
}

// Far deeper than any real map; a deeper file would overflow the stack in
// this parser and in the recursive layout and render code.
const MAX_DEPTH = 1000;

function parseNode(value: unknown, seenIds: Set<string>, depth: number): MindMapNode {
  if (depth > MAX_DEPTH) throw new Error(`This map is nested more than ${MAX_DEPTH} levels deep`);
  const raw = value as Record<string, unknown> | null;
  if (
    typeof raw !== "object" ||
    raw === null ||
    typeof raw.id !== "string" ||
    typeof raw.text !== "string" ||
    !Array.isArray(raw.children)
  ) {
    throw new Error("Not a Canopy mind map");
  }

  // A repeated id (from a hand-edited or merged file) would make every
  // find-by-id act on the first node with it, so later copies get new ids.
  const id = seenIds.has(raw.id) ? crypto.randomUUID() : raw.id;
  seenIds.add(id);
  const node: MindMapNode = {
    id,
    text: raw.text,
    children: raw.children.map((child) => parseNode(child, seenIds, depth + 1)),
  };
  const offset = raw.offset as { dx?: unknown; dy?: unknown } | undefined;
  if (offset && typeof offset.dx === "number" && typeof offset.dy === "number") {
    node.offset = { dx: offset.dx, dy: offset.dy };
  }
  if (typeof raw.color === "string") node.color = raw.color;
  if (raw.collapsed === true) node.collapsed = true;
  if (typeof raw.notes === "string") node.notes = raw.notes;
  if (typeof raw.link === "string") node.link = raw.link;
  if (typeof raw.icon === "string") node.icon = raw.icon;
  if (raw.status === "todo" || raw.status === "done") node.status = raw.status;
  // Only an embedded image. A remote URL would make opening the file send a
  // request to that server (a tracking pixel).
  if (typeof raw.image === "string" && raw.image.startsWith("data:image/")) node.image = raw.image;
  return node;
}
