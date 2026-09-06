import { getFontFamily } from "./fonts";

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

export interface ContentBBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

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

export function exportSvgString(svgEl: SVGSVGElement, contentBBox: ContentBBox): string {
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
  const contentGroup = clone.querySelector(":scope > g");
  contentGroup?.removeAttribute("transform");

  const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = `svg { font-family: ${getFontFamily()}; }\n${collectCanvasCss()}`;
  clone.insertBefore(style, clone.firstChild);

  const serialized = new XMLSerializer().serializeToString(clone);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${serialized}`;
}

export async function exportPngDataUrl(
  svgEl: SVGSVGElement,
  contentBBox: ContentBBox,
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
