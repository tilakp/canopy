export interface FontOption {
  id: string;
  label: string;
  stack: string;
}

// System font stacks only — no bundled font files, so the app stays fully
// offline-capable. "Hand-drawn" leans on whichever handwriting-style font
// each OS ships (Bradley Hand/Chalkboard SE on macOS, Segoe Print/Comic
// Sans MS on Windows), falling back to the generic 'cursive' keyword
// elsewhere.
export const FONT_OPTIONS: FontOption[] = [
  {
    id: "system",
    label: "System Default",
    stack: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
  },
  { id: "serif", label: "Serif", stack: 'Georgia, "Times New Roman", Times, serif' },
  {
    id: "mono",
    label: "Monospace",
    stack: '"SF Mono", "Cascadia Code", Consolas, "Courier New", monospace',
  },
  {
    id: "handwritten",
    label: "Hand-drawn",
    stack: '"Bradley Hand", "Segoe Print", "Comic Sans MS", "Chalkboard SE", cursive',
  },
];

const DEFAULT_FONT_ID = "system";
const STORAGE_KEY = "canopy-font";

function stackFor(id: string): string {
  return (FONT_OPTIONS.find((f) => f.id === id) ?? FONT_OPTIONS[0]).stack;
}

export function getFontId(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored && FONT_OPTIONS.some((f) => f.id === stored) ? stored : DEFAULT_FONT_ID;
  } catch {
    return DEFAULT_FONT_ID;
  }
}

// The actual CSS font-family value for the current pick — what render.ts
// needs for canvas text measurement, kept in sync with the CSS variable
// below so wrapping math matches what's actually painted on screen.
export function getFontFamily(): string {
  return stackFor(getFontId());
}

export function setFontId(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Best-effort — a restricted context (e.g. private browsing) just won't persist it.
  }
  document.documentElement.style.setProperty("--mm-font-family", stackFor(id));
}

// Applies whatever getFontId() currently returns. Call once at startup so
// the app boots with the right font before any user interaction.
export function initFontFamily(): void {
  document.documentElement.style.setProperty("--mm-font-family", stackFor(getFontId()));
}
