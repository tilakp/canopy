import { describe, expect, it } from "vitest";
import { createHistory } from "./history";

describe("createHistory", () => {
  it("undoes back to the previous snapshot", () => {
    const h = createHistory("a");
    h.push("b");
    h.push("c");
    expect(h.undo()).toBe("b");
    expect(h.undo()).toBe("a");
  });

  it("returns null when there's nothing left to undo", () => {
    const h = createHistory("a");
    expect(h.undo()).toBeNull();
  });

  it("redoes forward after an undo", () => {
    const h = createHistory("a");
    h.push("b");
    h.undo();
    expect(h.redo()).toBe("b");
    expect(h.canRedo()).toBe(false);
  });

  it("clears redo history once a new change is pushed", () => {
    const h = createHistory("a");
    h.push("b");
    h.undo();
    h.push("c");
    expect(h.canRedo()).toBe(false);
    expect(h.undo()).toBe("a");
  });

  it("reports canUndo/canRedo correctly", () => {
    const h = createHistory("a");
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(false);
    h.push("b");
    expect(h.canUndo()).toBe(true);
    h.undo();
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(true);
  });
});
