import { describe, expect, it, beforeEach } from "vitest";
import { getRecentFiles, addRecentFile, removeRecentFile } from "./recentFiles";

beforeEach(() => {
  localStorage.clear();
});

describe("getRecentFiles", () => {
  it("returns an empty array when nothing is persisted", () => {
    expect(getRecentFiles()).toEqual([]);
  });
});

describe("addRecentFile", () => {
  it("adds entries most-recent-first", () => {
    addRecentFile("/a.canopy");
    addRecentFile("/b.canopy");
    expect(getRecentFiles()).toEqual(["/b.canopy", "/a.canopy"]);
  });

  it("de-duplicates, moving a re-added path back to the front", () => {
    addRecentFile("/a.canopy");
    addRecentFile("/b.canopy");
    addRecentFile("/a.canopy");
    expect(getRecentFiles()).toEqual(["/a.canopy", "/b.canopy"]);
  });

  it("caps the list at 8 entries, dropping the oldest", () => {
    for (let i = 0; i < 10; i++) addRecentFile(`/file${i}.canopy`);
    const files = getRecentFiles();

    expect(files).toHaveLength(8);
    expect(files[0]).toBe("/file9.canopy");
    expect(files).not.toContain("/file0.canopy");
    expect(files).not.toContain("/file1.canopy");
  });
});

describe("removeRecentFile", () => {
  it("removes one entry, keeping the rest in order", () => {
    addRecentFile("/a.canopy");
    addRecentFile("/b.canopy");
    addRecentFile("/c.canopy");
    removeRecentFile("/b.canopy");
    expect(getRecentFiles()).toEqual(["/c.canopy", "/a.canopy"]);
  });

  it("is a no-op for a path that isn't in the list", () => {
    addRecentFile("/a.canopy");
    removeRecentFile("/nope.canopy");
    expect(getRecentFiles()).toEqual(["/a.canopy"]);
  });
});
