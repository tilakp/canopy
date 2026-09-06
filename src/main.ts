import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { addChild, createNode, type MindMapNode } from "./model";
import { createWorkspace } from "./workspace";
import { loadFromPath } from "./persistence";
import { initTheme } from "./theme";
import { initFontFamily } from "./fonts";

function buildSampleTree() {
  const root = createNode("Canopy");
  addChild(root, "Idea");
  return root;
}

window.addEventListener("DOMContentLoaded", async () => {
  initTheme();
  initFontFamily();
  const app = document.querySelector<HTMLDivElement>("#app")!;

  // A .canopy file double-clicked in Finder launches us with its path
  // waiting on the Rust side (see get_pending_file in lib.rs) — fetched
  // once here rather than only via the "file-opened" event below, so we
  // don't race that event against this listener being registered.
  let initial: { root: MindMapNode; path: string } | null = null;
  const pendingPath = await invoke<string | null>("get_pending_file").catch(() => null);
  if (pendingPath) {
    initial = await loadFromPath(pendingPath).catch(() => null);
  }

  const workspace = createWorkspace(app, initial?.root ?? buildSampleTree(), initial?.path ?? null);

  // Fires when a .canopy file is double-clicked while the app is already
  // running — opens it as a new tab rather than replacing whatever's
  // active. Outside a real Tauri webview (e.g. testing in plain Chrome
  // against the dev server) this silently never fires.
  listen<string>("file-opened", async (event) => {
    const result = await loadFromPath(event.payload).catch(() => null);
    if (result) workspace.openInNewTab(result.root, result.path);
  }).catch(() => {});
});
