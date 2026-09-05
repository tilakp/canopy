import { describe, expect, it } from "vitest";
import { addChild, createNode } from "./model";
import { toMarkdown } from "./exportMarkdown";

describe("toMarkdown", () => {
  it("renders a lone root as just an H1", () => {
    const root = createNode("Root");
    expect(toMarkdown(root)).toBe("# Root\n\n");
  });

  it("renders a multi-level tree as nested bullets, 2-space indent per depth", () => {
    const root = createNode("Root");
    const a = addChild(root, "A");
    addChild(a, "A-child");
    addChild(root, "B");

    expect(toMarkdown(root)).toBe(["# Root", "", "- A", "  - A-child", "- B"].join("\n") + "\n");
  });

  it("renders a node's notes as an italic line one level deeper than its bullet", () => {
    const root = createNode("Root");
    const a = addChild(root, "A");
    a.notes = "Some notes";

    expect(toMarkdown(root)).toBe(["# Root", "", "- A", "  *Some notes*"].join("\n") + "\n");
  });

  it("renders a node's link by wrapping its bullet text as a Markdown link", () => {
    const root = createNode("Root");
    const a = addChild(root, "A");
    a.link = "https://example.com";

    expect(toMarkdown(root)).toBe(["# Root", "", "- [A](https://example.com)"].join("\n") + "\n");
  });

  it("prefixes a node's bullet text with its icon", () => {
    const root = createNode("Root");
    const a = addChild(root, "A");
    a.icon = "🚀";

    expect(toMarkdown(root)).toBe(["# Root", "", "- 🚀 A"].join("\n") + "\n");
  });

  it("combines icon + link + notes on the same node", () => {
    const root = createNode("Root");
    const a = addChild(root, "A");
    a.icon = "🚀";
    a.link = "https://example.com";
    a.notes = "Some notes";

    expect(toMarkdown(root)).toBe(
      ["# Root", "", "- [🚀 A](https://example.com)", "  *Some notes*"].join("\n") + "\n",
    );
  });
});
