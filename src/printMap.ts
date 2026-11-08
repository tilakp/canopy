import { exportSvgString } from "./exportImage";
import type { Box } from "./camera";

// Prints the live map by embedding a standalone copy of its SVG (the same
// serialization exportImage.ts's SVG export uses) into a hidden iframe and
// invoking the browser's native print flow on that iframe's own window —
// keeps the app chrome (toolbar, tabs) out of the printed page.
let previousFrame: HTMLIFrameElement | null = null;

export async function printMap(svgEl: SVGSVGElement, contentBBox: Box): Promise<void> {
  // The XML prolog is only meaningful for a standalone .svg file; inside an
  // HTML document it isn't valid markup.
  const svgMarkup = exportSvgString(svgEl, contentBBox).replace(/^<\?xml.*?\?>\s*/, "");

  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.top = "-10000px";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "none";

  const html = `<!DOCTYPE html><html><head><style>
    html, body { margin: 0; height: 100%; }
    body { display: flex; align-items: center; justify-content: center; }
    svg { max-width: 100%; max-height: 100%; }
  </style></head><body>${svgMarkup}</body></html>`;

  await new Promise<void>((resolve) => {
    iframe.addEventListener("load", () => resolve(), { once: true });
    iframe.srcdoc = html;
    document.body.appendChild(iframe);
  });

  const win = iframe.contentWindow;
  if (!win) {
    iframe.remove();
    return;
  }

  // Removed after printing, or by the next print where an engine never
  // fires afterprint. A timer could remove it while the dialog is open.
  win.addEventListener("afterprint", () => iframe.remove(), { once: true });
  previousFrame?.remove();
  previousFrame = iframe;

  win.focus();
  win.print();
}
