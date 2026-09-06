import { describe, expect, it } from "vitest";
import { parseDocument } from "./persistence";

// A .canopy file is plain JSON that the app may never have written itself
// (the open dialog accepts .json, and Finder can hand us any file
// associated with the extension), so its shape can't be assumed.

describe("parseDocument", () => {
  it("keeps a full document's fields", () => {
    const doc = {
      id: "root",
      text: "Root",
      color: "#4C6EF5",
      collapsed: true,
      notes: "note",
      link: "https://example.com",
      icon: "🚀",
      status: "done",
      image: "data:image/png;base64,abc123",
      offset: { dx: 5, dy: -5 },
      children: [{ id: "a", text: "A", children: [] }],
    };

    expect(parseDocument(JSON.stringify(doc))).toEqual(doc);
  });

  it("rejects JSON that isn't a mind map", () => {
    // A node without children throws mid-render, after the app has already
    // swapped the new tree in — losing whatever was open in that tab.
    expect(() => parseDocument(`{"id":"x","text":"No children"}`)).toThrow();
    expect(() => parseDocument(`{"id":"x","text":"Bad kids","children":{}}`)).toThrow();
    expect(() => parseDocument(`{"id":"x","children":[]}`)).toThrow();
    expect(() => parseDocument(`{"id":"x","text":"Bad kid","children":[null]}`)).toThrow();
    expect(() => parseDocument(`[1,2,3]`)).toThrow();
    expect(() => parseDocument(`not json`)).toThrow();
  });

  it("drops wrong-typed optional fields instead of letting them reach layout", () => {
    // A non-numeric offset would turn every coordinate downstream into NaN.
    const parsed = parseDocument(
      `{"id":"x","text":"T","offset":"nope","icon":7,"status":"maybe","image":7,"children":[]}`,
    );

    expect(parsed.offset).toBeUndefined();
    expect(parsed.icon).toBeUndefined();
    expect(parsed.status).toBeUndefined();
    expect(parsed.image).toBeUndefined();
  });
});
