import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { addChild, createNode, type MindMapNode } from "./model";
import { createWorkspace } from "./workspace";
import { loadFromPath } from "./persistence";
import { initTheme } from "./theme";
import { initFontFamily } from "./fonts";
import { confirmDiscard } from "./dialogs";

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

  // ⌘Q (the app menu's Quit item, see lib.rs) asks about unsaved maps,
  // then quits. If anything here fails, quit anyway: a Quit that does
  // nothing is worse than one that does not ask.
  listen("quit-requested", async () => {
    try {
      if (workspace.hasUnsavedChanges() && !(await confirmDiscard())) return;
    } catch {
      // Fall through to quit.
    }
    await invoke("quit_app");
  }).catch(() => {});

  // Closing the window with unsaved maps asks first. Like the listener
  // above, this does nothing outside a real Tauri webview.
  try {
    await getCurrentWindow().onCloseRequested(async (event) => {
      if (workspace.hasUnsavedChanges() && !(await confirmDiscard())) event.preventDefault();
    });
  } catch {
    // Not running inside Tauri.
  }
});
