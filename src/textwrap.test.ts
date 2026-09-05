import { describe, expect, it } from "vitest";
import { wrapText } from "./textwrap";

// jsdom has no canvas text measurement, so wrapText falls back to a rough
// per-character width estimate (7px/char). These tests work within that.

describe("wrapText", () => {
  it("keeps short text on a single line", () => {
    const { lines } = wrapText("Quick start", "14px sans-serif", 300);
    expect(lines).toEqual(["Quick start"]);
  });

  it("splits long text across multiple lines", () => {
    const { lines } = wrapText(
      "This is a fairly long sentence used as a node label",
      "14px sans-serif",
      100,
    );
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(" ")).toBe("This is a fairly long sentence used as a node label");
  });

  it("never splits a single word across lines", () => {
    const { lines } = wrapText("Supercalifragilisticexpialidocious", "14px sans-serif", 10);
    expect(lines).toEqual(["Supercalifragilisticexpialidocious"]);
  });

  it("handles empty text", () => {
    const { lines, width } = wrapText("", "14px sans-serif", 100);
    expect(lines).toEqual([""]);
    expect(width).toBe(0);
  });
});
