// A generic linear undo/redo stack. Works on whole-document snapshots
// (structuredClone of the tree) rather than diffs — simple to reason about
// and plenty fast for a document this small.
export interface History<T> {
  push(snapshot: T): void;
  undo(): T | null;
  redo(): T | null;
  canUndo(): boolean;
  canRedo(): boolean;
}

const HISTORY_LIMIT = 200;

export function createHistory<T>(initial: T): History<T> {
  let past: T[] = [];
  let present: T = initial;
  let future: T[] = [];

  return {
    push(snapshot) {
      past.push(present);
      if (past.length > HISTORY_LIMIT) past.shift();
      present = snapshot;
      future = [];
    },
    undo() {
      if (past.length === 0) return null;
      future.unshift(present);
      present = past.pop()!;
      return present;
    },
    redo() {
      if (future.length === 0) return null;
      past.push(present);
      present = future.shift()!;
      return present;
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
  };
}
