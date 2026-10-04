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

  it("round-trips checklist status, also on a linked node", () => {
    const root = createNode("Root");
    const done = addChild(root, "Task");
    done.status = "done";
    const todo = addChild(root, "Docs");
    todo.status = "todo";
    todo.link = "https://example.com";

    const back = fromMarkdown(toMarkdown(root));
    expect(back.children.map((c) => [c.text, c.status, c.link])).toEqual([
      ["Task", "done", undefined],
      ["Docs", "todo", "https://example.com"],
    ]);
  });

  it("keeps an empty-text node and its children in place", () => {
    const root = createNode("Root");
    const empty = addChild(root, "");
    addChild(empty, "Kid");

    const back = fromMarkdown(toMarkdown(root));
    expect(back.children).toHaveLength(1);
    expect(back.children[0].children.map((c) => c.text)).toEqual(["Kid"]);
  });

  it("round-trips multi-line notes", () => {
    const root = createNode("Root");
    addChild(root, "A").notes = "line one\nline two";

    expect(fromMarkdown(toMarkdown(root)).children[0].notes).toBe("line one\nline two");
  });

  it("keeps text that looks like Markdown syntax as text", () => {
    const root = createNode("Root");
    addChild(root, "[draft](v2)");
    addChild(root, "a*b* and \\back");
    addChild(root, "[ ] not a task").notes = "ends with a star*";

    const back = fromMarkdown(toMarkdown(root));
    expect(back.children.map((c) => c.text)).toEqual(["[draft](v2)", "a*b* and \\back", "[ ] not a task"]);
    expect(back.children.map((c) => [c.link, c.status])).toEqual([[undefined, undefined], [undefined, undefined], [undefined, undefined]]);
    expect(back.children[2].notes).toBe("ends with a star*");
  });

  it("round-trips the root's icon, link and notes", () => {
    const root = createNode("Plan [v2]");
    root.icon = "🌳";
    root.link = "https://example.com";
    root.notes = "First line\nSecond line";
    addChild(root, "Child");

    const back = fromMarkdown(toMarkdown(root));
    expect([back.text, back.icon, back.link, back.notes]).toEqual([
      "Plan [v2]",
      "🌳",
      "https://example.com",
      "First line\nSecond line",
    ]);
    expect(back.children.map((c) => c.text)).toEqual(["Child"]);
  });
});

