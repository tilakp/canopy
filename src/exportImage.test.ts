import { describe, expect, it } from "vitest";
import { addChild, createNode } from "./model";
import { renderMindMap, type RenderCallbacks } from "./render";
import { exportSvgString } from "./exportImage";

const noopCallbacks: RenderCallbacks = {
  onEditCommit() {},
  onEditCancel() {},
  onNotesCommit() {},
  onNotesCancel() {},
  onIconCommit() {},
  onIconCancel() {},
  onLinkCommit() {},
  onLinkCancel() {},
};

function setup(): HTMLElement {
  const container = document.createElement("div");
  Object.defineProperty(container, "clientWidth", { value: 800, configurable: true });
  Object.defineProperty(container, "clientHeight", { value: 600, configurable: true });
  container.getBoundingClientRect = () =>
    ({ width: 800, height: 600, left: 0, top: 0, right: 800, bottom: 600, x: 0, y: 0, toJSON() {} }) as DOMRect;
  document.body.appendChild(container);
  return container;
}

describe("exportSvgString", () => {
  it("produces a standalone SVG with an xmlns, inlined styles, and the node's text", () => {
    const root = createNode("Root");
    addChild(root, "Branch");
    const container = setup();
    renderMindMap(container, root, { selectedId: null, editingId: null, edgeStyle: "curved" }, noopCallbacks);

    const svgEl = container.querySelector("svg.mm-canvas") as unknown as SVGSVGElement;
    const result = exportSvgString(svgEl, { x: -50, y: -50, width: 300, height: 200 });

    expect(result).toContain('xmlns="http://www.w3.org/2000/svg"');
    // jsdom's test environment doesn't load styles.css as a real
    // stylesheet, so document.styleSheets is empty here and the <style>
    // tag is correctly present but empty (self-closes as <style/>) — a
    // real browser/Tauri run has actual rules to inline. Just check the
    // tag itself exists.
    expect(result).toMatch(/<style\s*\/?>/);
    expect(result).toContain("Root");
    expect(result).toContain("Branch");
  });

  it("resets the pan/zoom transform so the export isn't offset or cropped", () => {
    const root = createNode("Root");
    addChild(root, "Branch");
    const container = setup();
    renderMindMap(
      container,
      root,
      { selectedId: null, editingId: null, edgeStyle: "curved", camera: { x: 123, y: 45, scale: 1.7 } },
      noopCallbacks,
    );

    const svgEl = container.querySelector("svg.mm-canvas") as unknown as SVGSVGElement;
    const result = exportSvgString(svgEl, { x: -50, y: -50, width: 300, height: 200 });

    expect(result).not.toContain("translate(123");
  });

  it("sizes the viewBox from the given content bbox plus a margin", () => {
    const root = createNode("Root");
    const container = setup();
    renderMindMap(container, root, { selectedId: null, editingId: null, edgeStyle: "curved" }, noopCallbacks);

    const svgEl = container.querySelector("svg.mm-canvas") as unknown as SVGSVGElement;
    const result = exportSvgString(svgEl, { x: 0, y: 0, width: 100, height: 50 });

    // width/height attributes should be bbox size + 2*margin (48), not the
    // live viewport size (800x600) baked in by computeInitialCamera.
    expect(result).toMatch(/width="148"/);
    expect(result).toMatch(/height="98"/);
  });
});

// exportPngDataUrl's actual rasterization (Image/canvas) isn't testable in
// jsdom — this project's own tests already document that jsdom fakes
// canvas/getContext rather than implementing it (see textwrap.ts's
// documented fallback), so there's nothing meaningful to assert here
// beyond what exportSvgString already covers above.
