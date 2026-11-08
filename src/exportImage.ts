import { getFontFamily } from "./fonts";
import { getTheme } from "./theme";
import type { Box } from "./camera";

// Exports the live rendered mind map SVG as a standalone image (SVG string
// or rasterized PNG data URL). "Standalone" matters: the live SVG relies on
// an external stylesheet for some of its visuals (root box fill/stroke,
// default text color, edge styling — see styles.css's `.mm-*` rules), which
// a cloned/serialized copy won't have access to on its own. So the export
// inlines the relevant CSS into a <style> tag rather than re-deriving those
// values by hand here (which would silently drift out of sync with
// styles.css over time). Font-family is the one exception: the live canvas
// just inherits it from <body>, which isn't a ".mm-" rule the collector
// below would pick up, so it's set explicitly instead.


const MARGIN = 24;

// Pulls every "mm-" prefixed rule out of the document's real stylesheets,
// so the exported SVG carries the actual current visuals rather than a
// hand-copied snapshot of them.
function collectCanvasCss(): string {
  const rules: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let cssRules: CSSRuleList;
    try {
      cssRules = sheet.cssRules;
    } catch {
      continue; // cross-origin stylesheets throw on access — nothing we can do
    }
    for (const rule of Array.from(cssRules)) {
      if (rule.cssText.includes(".mm-")) rules.push(rule.cssText);
    }
  }
  return rules.join("\n");
}

export function exportSvgString(svgEl: SVGSVGElement, contentBBox: Box): string {
  const clone = svgEl.cloneNode(true) as SVGSVGElement;

  const x = contentBBox.x - MARGIN;
  const y = contentBBox.y - MARGIN;
  const width = contentBBox.width + MARGIN * 2;
  const height = contentBBox.height + MARGIN * 2;

  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  clone.setAttribute("viewBox", `${x} ${y} ${width} ${height}`);

  // The live SVG's top-level <g> carries the pan/zoom transform — reset it
  // since the viewBox above handles framing instead, and leaving it in
  // would offset/crop the export to whatever the on-screen camera happened
  // to be at.
  // The "−" fold button and the selection ring show on a selected node, and
  // a blank map shows a how-to-start hint; none belongs in an image of the
  // map.
  for (const el of clone.querySelectorAll(".mm-fold-btn, .mm-empty-hint, .mm-ring")) el.remove();
  const contentGroup = clone.querySelector(":scope > g");
  contentGroup?.removeAttribute("transform");
  // A slide or drag in progress moves nodes and lines with transforms; the
  // image shows where they end.
  for (const el of clone.querySelectorAll("[transform]")) {
    if (el.matches(".mm-node, .mm-edge")) el.removeAttribute("transform");
  }
  // In dark mode the text is light, so the image needs the dark canvas
  // behind it to be readable anywhere it is opened.
  if (getTheme() === "dark") {
    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    for (const [k, v] of Object.entries({ x, y, width, height, fill: "#17171a" })) bg.setAttribute(k, String(v));
    clone.insertBefore(bg, contentGroup ?? null);
  }

  const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = `svg { font-family: ${getFontFamily()}; }\n${collectCanvasCss()}`;
  clone.insertBefore(style, clone.firstChild);

  const serialized = new XMLSerializer().serializeToString(clone);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${serialized}`;
}

export async function exportPngDataUrl(
  svgEl: SVGSVGElement,
  contentBBox: Box,
  scale = 2,
): Promise<string> {
  const svgString = exportSvgString(svgEl, contentBBox);
  const base64 = btoa(unescape(encodeURIComponent(svgString)));
  const dataUrl = `data:image/svg+xml;base64,${base64}`;

  const width = (contentBBox.width + MARGIN * 2) * scale;
  const height = (contentBBox.height + MARGIN * 2) * scale;

  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Failed to load exported SVG for rasterization"));
    image.src = dataUrl;
  });

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(image, 0, 0, width, height);

  return canvas.toDataURL("image/png");
}
