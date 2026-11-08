import { createNode, type MindMapNode } from "./model";
import { startApp, type AppHandle } from "./app";
import { createTitleBar, hasOverlayTitleBar } from "./titlebar";
import { onViewChange } from "./prefs";

// Multiple maps are multiple fully independent startApp instances, each
// mounted in its own full-size container stacked in the same #app element.
// Only the active document's container is shown — see AppHandle.setActive
// for why the *inactive* ones still need to ignore window-level key/resize
// events even while hidden.
interface Doc {
  id: string;
  containerEl: HTMLElement;
  handle: AppHandle;
}

export interface Workspace {
  openInNewTab(root: MindMapNode, path: string | null): void;
  // Before the window closes or the app quits: asks about each unsaved map
  // in turn, showing its tab. Resolves to false as soon as one is
  // cancelled or fails to save.
  confirmCloseAll(): Promise<boolean>;
  // The map in the visible tab, for menu bar commands.
  activeMap(): AppHandle;
}

export function createWorkspace(appEl: HTMLElement, initialRoot: MindMapNode, initialPath: string | null): Workspace {
  const docs: Doc[] = [];
  let activeId: string;

  const active = () => docs.find((d) => d.id === activeId)!.handle;
  const titleBar = createTitleBar(appEl, {
    onSwitch: (id) => switchTo(id),
    onClose: (id) => void closeDoc(id),
    onNew: (root) => addDoc(root, null, true),
    onArrange: () => active().run("map.arrange"),
    onToggleFocus: () => active().run("node.focus"),
    onFind: () => active().run("map.find"),
    // macOS has these in its File menu (lib.rs); elsewhere the title bar
    // shows a File button.
    file: hasOverlayTitleBar()
      ? null
      : {
          onNew: () => addDoc(createNode("Untitled"), null, true),
          onOpen: () => active().run("file.open"),
          onOpenRecent: (path) => active().openRecent(path),
          onSave: () => active().run("file.save"),
          onSaveAs: () => active().run("file.saveAs"),
          onImport: () => active().run("file.import"),
          onExport: () => active().run("file.export"),
          onPrint: () => active().run("file.print"),
        },
  });

  // A theme, font or view change: text is measured in the current font and
  // some colors are baked into SVG attributes per render, so every open map
  // renders again, not only the visible one.
  onViewChange(() => {
    for (const d of docs) d.handle.forceRender();
    refreshTabs();
  });

  function refreshTabs(): void {
    // Called from a new map's first render too, before it is in `docs`, and
    // while a closed map's tab is being replaced: then there may be no
    // active map to ask yet.
    const current = docs.find((d) => d.id === activeId)?.handle;
    if (!current) return;
    titleBar.update(
      docs.map((d) => ({ id: d.id, title: d.handle.getTitle(), dirty: d.handle.isDirty() })),
      activeId,
      { focused: current.isFocused(), canFocus: current.canFocus() },
    );
  }

  function switchTo(id: string): void {
    activeId = id;
    for (const d of docs) {
      d.containerEl.style.display = d.id === id ? "" : "none";
      d.handle.setActive(d.id === id);
    }
    refreshTabs();
  }

  function addDoc(root: MindMapNode, path: string | null, makeActive: boolean): void {
    const id = crypto.randomUUID();
    const containerEl = document.createElement("div");
    containerEl.className = "mm-doc-container";
    appEl.appendChild(containerEl);

    // Left visible for this first render: startApp's initial camera-fit
    // measures the container's real size, which a display:none box (zero
    // size) would poison before switchTo ever gets a chance to fix it.
    const handle = startApp(containerEl, root, path, refreshTabs);
    docs.push({ id, containerEl, handle });
    if (makeActive) {
      switchTo(id);
    } else {
      containerEl.style.display = "none";
      refreshTabs();
    }
  }

  async function closeDoc(id: string): Promise<void> {
    const doc = docs.find((d) => d.id === id);
    if (!doc) return;
    // A tab with no unsaved changes closes at once, with no await. An open
    // edit counts as a change.
    doc.handle.flushEdit();
    if (doc.handle.isDirty() && !(await doc.handle.confirmClose())) return;
    // Look the index up again: other tabs can close while the dialog is up.
    const index = docs.indexOf(doc);
    if (index === -1) return;
    // switchTo below only visits the docs still open, so a closed one is
    // never told it's inactive — it has to drop its own window listeners.
    docs[index].handle.destroy();
    docs[index].containerEl.remove();
    docs.splice(index, 1);

    if (docs.length === 0) {
      // Never zero tabs — replace with a fresh blank map.
      addDoc(createNode("Untitled"), null, true);
      return;
    }
    if (id === activeId) switchTo(docs[Math.max(0, index - 1)].id);
    else refreshTabs();
  }

  addDoc(initialRoot, initialPath, true);

  return {
    openInNewTab(root, path) {
      // A file opened twice (e.g. double-clicked again in Finder) goes to
      // its existing tab: two tabs on one path would overwrite each other.
      const existing = path ? docs.find((d) => d.handle.getFilePath() === path) : undefined;
      if (existing) switchTo(existing.id);
      else addDoc(root, path, true);
    },
    async confirmCloseAll() {
      for (const d of docs) d.handle.flushEdit();
      for (const doc of docs.filter((d) => d.handle.isDirty())) {
        switchTo(doc.id);
        if (!(await doc.handle.confirmClose())) return false;
      }
      return true;
    },
    activeMap: active,
  };
}
