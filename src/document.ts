// One map's data: the tree, the file it belongs to, its undo history, and
// whether it has unsaved changes. No UI knowledge.
import { cloneTree, type MindMapNode } from "./model";
import { createHistory, type History } from "./history";

export interface MapDocument {
  // The live tree. Mutate it in place, then call commit() to record the
  // change as one undo step.
  readonly root: MindMapNode;
  readonly filePath: string | null;
  commit(): void;
  // Each replaces `root` with the tree as it was. False if there is no
  // step to go to.
  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  isDirty(): boolean;
  // The state a save is about to write. Pass it to markSaved when the save
  // succeeds: an edit made while the save dialog was open stays unsaved.
  version(): object;
  markSaved(version: object, path: string): void;
  // Replaces the whole document, with a new history: ⌘Z after an open must
  // not bring back the previous map. A tree with no file (an import) starts
  // unsaved.
  load(root: MindMapNode, path: string | null): void;
}

// Snapshots are whole trees made with cloneTree, which shares string
// values: a pasted image's data URL is not copied into every snapshot.
// Dirty state is snapshot identity: undoing back to the saved snapshot
// makes the map clean again at no cost.
export function createDocument(initialRoot: MindMapNode, initialPath: string | null): MapDocument {
  let root = initialRoot;
  let filePath = initialPath;
  let current = cloneTree(root);
  // A map opened from the starter tree counts as saved: there is nothing
  // to lose yet.
  let saved: MindMapNode | null = current;
  let history: History<MindMapNode> = createHistory(current);

  const restore = (snapshot: MindMapNode | null): boolean => {
    if (!snapshot) return false;
    current = snapshot;
    root = cloneTree(snapshot);
    return true;
  };

  return {
    get root() {
      return root;
    },
    get filePath() {
      return filePath;
    },
    commit() {
      current = cloneTree(root);
      history.push(current);
    },
    undo: () => restore(history.undo()),
    redo: () => restore(history.redo()),
    canUndo: () => history.canUndo(),
    canRedo: () => history.canRedo(),
    isDirty: () => current !== saved,
    version: () => current,
    markSaved(version, path) {
      saved = version as MindMapNode;
      filePath = path;
    },
    load(newRoot, path) {
      root = newRoot;
      filePath = path;
      current = cloneTree(root);
      saved = path ? current : null;
      history = createHistory(current);
    },
  };
}
