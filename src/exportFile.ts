import { save } from "@tauri-apps/plugin-dialog";
import { writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type { MindMapNode } from "./model";
import { toMarkdown } from "./exportMarkdown";
import { exportSvgString, exportPngDataUrl, type ContentBBox } from "./exportImage";

const EXPORT_FILTERS = [
  { name: "PNG image", extensions: ["png"] },
  { name: "SVG image", extensions: ["svg"] },
  { name: "Markdown outline", extensions: ["md"] },
];

// Exports the current map to whichever format the user picks via the save
// dialog's filename extension — one toolbar action covers all three so the
// toolbar doesn't need a separate button per format.
export async function exportMap(root: MindMapNode, svgEl: SVGSVGElement, contentBBox: ContentBBox): Promise<void> {
  const path = await save({
    filters: EXPORT_FILTERS,
    defaultPath: `${root.text || "mindmap"}.png`,
  });
  if (!path) return;

  if (path.endsWith(".md")) {
    await writeTextFile(path, toMarkdown(root));
  } else if (path.endsWith(".svg")) {
    await writeTextFile(path, exportSvgString(svgEl, contentBBox));
  } else {
    const dataUrl = await exportPngDataUrl(svgEl, contentBBox);
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    await writeFile(path, bytes);
  }
}
