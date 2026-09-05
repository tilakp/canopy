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
  const root = JSON.parse(text) as MindMapNode;
  return { root, path };
}
