import { LruCache } from "./lru";

export interface WrappedText {
  lines: string[];
  width: number;
}

let sharedCanvas: HTMLCanvasElement | null = null;
let currentFont = "";

// Every render wraps every node again, and most text has not changed since
// the last render, so results are cached. The font is part of the key, so a
// font change needs no explicit clear.
const cache = new LruCache<string, WrappedText>(5000);

// jsdom (used by tests) doesn't implement canvas text measurement, so this
// falls back to a rough per-character estimate rather than throwing. Real
// browsers always take the accurate canvas path.
function measureWidth(text: string, font: string): number {
  try {
    sharedCanvas ??= document.createElement("canvas");
    const ctx = sharedCanvas.getContext("2d");
    if (!ctx) return text.length * 7;
    // Setting ctx.font is slow even when the value is the same.
    if (font !== currentFont) {
      ctx.font = font;
      currentFont = font;
    }
    return ctx.measureText(text).width;
  } catch {
    return text.length * 7;
  }
}

// The width of `text` as drawn in `font`, spaces included.
export function measureText(text: string, font: string): number {
  return measureWidth(text, font);
}

// Greedily wraps `text` into lines no wider than `maxWidth` when rendered
// with `font` (a CSS font shorthand, e.g. "500 14.5px sans-serif").
export function wrapText(text: string, font: string, maxWidth: number): WrappedText {
  const key = `${font}\0${maxWidth}\0${text}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const result = wrapUncached(text, font, maxWidth);
  cache.set(key, result);
  return result;
}

function wrapUncached(text: string, font: string, maxWidth: number): WrappedText {
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
