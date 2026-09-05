export interface WrappedText {
  lines: string[];
  width: number;
}

let sharedCanvas: HTMLCanvasElement | null = null;

// jsdom (used by tests) doesn't implement canvas text measurement, so this
// falls back to a rough per-character estimate rather than throwing. Real
// browsers always take the accurate canvas path.
function measureWidth(text: string, font: string): number {
  try {
    sharedCanvas ??= document.createElement("canvas");
    const ctx = sharedCanvas.getContext("2d");
    if (!ctx) return text.length * 7;
    ctx.font = font;
    return ctx.measureText(text).width;
  } catch {
    return text.length * 7;
  }
}

// Greedily wraps `text` into lines no wider than `maxWidth` when rendered
// with `font` (a CSS font shorthand, e.g. "500 14.5px sans-serif").
export function wrapText(text: string, font: string, maxWidth: number): WrappedText {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { lines: [""], width: 0 };

  const lines: string[] = [];
  let current = words[0];
  for (let i = 1; i < words.length; i++) {
    const attempt = `${current} ${words[i]}`;
    if (measureWidth(attempt, font) <= maxWidth) {
      current = attempt;
    } else {
      lines.push(current);
      current = words[i];
    }
  }
  lines.push(current);

  const width = Math.max(...lines.map((line) => measureWidth(line, font)));
  return { lines, width };
}
