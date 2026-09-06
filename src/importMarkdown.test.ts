import { describe, expect, it } from "vitest";
import { addChild, createNode } from "./model";
import { toMarkdown } from "./exportMarkdown";
import { fromMarkdown } from "./importMarkdown";

describe("fromMarkdown", () => {
  it("parses the '# ' line as the root's text", () => {
    expect(fromMarkdown("# My Map\n").text).toBe("My Map");
  });

  it("round-trips a multi-level tree through toMarkdown", () => {
    const root = createNode("Root");
    const a = addChild(root, "A");
    addChild(a, "A-child");
    addChild(root, "B");
    const md = toMarkdown(root);

    expect(toMarkdown(fromMarkdown(md))).toBe(md);
  });

  it("round-trips a node combining icon + link + notes", () => {
    const root = createNode("Root");
    const a = addChild(root, "A");
    a.icon = "🚀";
    a.link = "https://example.com";
    a.notes = "Some notes";
    const md = toMarkdown(root);

    expect(toMarkdown(fromMarkdown(md))).toBe(md);
  });

  it("extracts a leading emoji as the node's icon", () => {
    const root = fromMarkdown(["# Root", "", "- 🚀 A"].join("\n"));
    expect(root.children[0].text).toBe("A");
    expect(root.children[0].icon).toBe("🚀");
  });

  it("extracts a Markdown link as the node's link, using the label as its text", () => {
    const root = fromMarkdown(["# Root", "", "- [A](https://example.com)"].join("\n"));
    expect(root.children[0].text).toBe("A");
    expect(root.children[0].link).toBe("https://example.com");
  });

  it("extracts an icon from inside a linked bullet's label", () => {
    const root = fromMarkdown(["# Root", "", "- [🚀 A](https://example.com)"].join("\n"));
    expect(root.children[0].text).toBe("A");
    expect(root.children[0].icon).toBe("🚀");
    expect(root.children[0].link).toBe("https://example.com");
  });

  it("extracts notes from an italic line right after a bullet", () => {
    const root = fromMarkdown(["# Root", "", "- A", "  *Some notes*"].join("\n"));
    expect(root.children[0].notes).toBe("Some notes");
  });

  it("parses a plain hand-written outline with no icons or links", () => {
    const md = ["# My Plan", "", "- Step One", "- Step Two", "  - Sub step"].join("\n");
    const root = fromMarkdown(md);

    expect(root.text).toBe("My Plan");
    expect(root.children.map((c) => c.text)).toEqual(["Step One", "Step Two"]);
    expect(root.children[1].children[0].text).toBe("Sub step");
    expect(root.children[0].icon).toBeUndefined();
    expect(root.children[0].link).toBeUndefined();
  });

  it("tolerates '*' and '+' bullets, and blank lines", () => {
    const md = ["# Outline", "", "* First", "", "+ Second", ""].join("\n");
    const root = fromMarkdown(md);

    expect(root.children.map((c) => c.text)).toEqual(["First", "Second"]);
  });

  it("defaults to 'Untitled' when there's no '# ' line", () => {
    const root = fromMarkdown("- A\n- B");
    expect(root.text).toBe("Untitled");
    expect(root.children.map((c) => c.text)).toEqual(["A", "B"]);
  });
});
