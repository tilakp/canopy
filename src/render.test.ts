import { afterEach, describe, expect, it, vi } from "vitest";
import { addChild, createNode } from "./model";
import { renderMindMap } from "./render";

// Regression test for a real bug: renderLeafNode used to build its <g> (with
// the text and hit-rect inside it) fully detached, then call text.getBBox()
// before ever attaching it to the document. Real browsers don't throw for
// that — they silently return a zero-size box, which is far worse than
// jsdom's approach (an outright "not implemented" exception on every call,
// attached or not) since it produces plausible-looking wrong geometry
// instead of loudly failing. jsdom's blanket exception is also why this
// can't be caught by spying on a shared prototype method: its SVG class
// hierarchy doesn't wire getBBox through SVGGraphicsElement the way real
// browsers do, so this patches getBBox onto each <text> element directly as
// it's created, which is reachable regardless of that hierarchy.

let container: HTMLElement;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("renderMindMap", () => {
  it("only measures <text> elements that are already attached to the document", () => {
    const root = createNode("Root");
    const child = addChild(root, "Child");
    addChild(child, "Grandchild");

    container = document.createElement("div");
    document.body.appendChild(container);

    const connectedAtCallTime: boolean[] = [];
    const createElementNS = document.createElementNS.bind(document);
    vi.spyOn(document, "createElementNS").mockImplementation((ns: string | null, tag: string) => {
      const el = createElementNS(ns, tag);
      if (tag === "text") {
        (el as unknown as { getBBox: () => DOMRect }).getBBox = function (this: Element) {
          connectedAtCallTime.push(this.isConnected);
          return new DOMRect(0, 0, 0, 0);
        };
      }
      return el;
    });

    renderMindMap(
      container,
      root,
      { selectedId: null, editingId: null },
      { onEditCommit() {}, onEditCancel() {} },
    );

    // root's text + child's text + grandchild's text
    expect(connectedAtCallTime).toHaveLength(3);
    expect(connectedAtCallTime, JSON.stringify(connectedAtCallTime)).toEqual([true, true, true]);
  });
});
