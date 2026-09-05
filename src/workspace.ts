import { createNode, type MindMapNode } from "./model";
import { startApp, type AppHandle } from "./app";
import { createTabStrip } from "./tabs";
import { getTheme, setTheme } from "./theme";

// Multiple maps are multiple fully independent startApp instances, each
// mounted in its own full-size container stacked in the same #app element.
// Only the active document's container is shown — see AppHandle.setActive
// for why the *inactive* ones still need to ignore window-level key/resize
// events even while hidden.
interface Doc {
  id: string;
  containerEl: HTMLElement;
  handle: AppHandle;
  filePath: string | null;
}

export interface Workspace {
  openInNewTab(root: MindMapNode, path: string | null): void;
}

export function createWorkspace(appEl: HTMLElement, initialRoot: MindMapNode, initialPath: string | null): Workspace {
  const docs: Doc[] = [];
  let activeId: string;

  const tabStrip = createTabStrip(appEl, {
    onSwitch: (id) => switchTo(id),
    onClose: (id) => closeDoc(id),
    onNew: () => addDoc(createNode("Untitled"), null, true),
    onToggleTheme: () => {
      setTheme(getTheme() === "dark" ? "light" : "dark");
      // Most theming is live via CSS custom properties, but a leaf node's
      // pastel fill is baked into an inline SVG attribute per render — force
      // every open document to re-render so none of them show a stale shade.
      for (const d of docs) d.handle.forceRender();
      refreshTabs();
    },
  });

  function refreshTabs(): void {
    tabStrip.update(
      docs.map((d) => ({ id: d.id, title: d.handle.getTitle() })),
      activeId,
      getTheme() === "dark",
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
    docs.push({ id, containerEl, handle, filePath: path });
    if (makeActive) {
      switchTo(id);
    } else {
      containerEl.style.display = "none";
      refreshTabs();
    }
  }

  function closeDoc(id: string): void {
    const index = docs.findIndex((d) => d.id === id);
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
      addDoc(root, path, true);
    },
  };
}
