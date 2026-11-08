import type { EdgeStyle } from "./edges";

// View preferences shared by every open map, set from the View popover or
// the command palette: line style, hand-drawn style, the dot grid and the
// minimap. Like the theme and the font, they are global and persist in
// localStorage, not in the .canopy file.
export interface ViewPrefs {
  edgeStyle: EdgeStyle;
  sketchy: boolean;
  grid: boolean;
  minimap: boolean;
}

const STORAGE_KEY = "canopy-view";
const DEFAULTS: ViewPrefs = { edgeStyle: "curved", sketchy: false, grid: true, minimap: false };

export function getViewPrefs(): ViewPrefs {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<ViewPrefs>;
    return {
      edgeStyle: stored.edgeStyle === "straight" ? "straight" : "curved",
      sketchy: typeof stored.sketchy === "boolean" ? stored.sketchy : DEFAULTS.sketchy,
      grid: typeof stored.grid === "boolean" ? stored.grid : DEFAULTS.grid,
      minimap: typeof stored.minimap === "boolean" ? stored.minimap : DEFAULTS.minimap,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function setViewPref<K extends keyof ViewPrefs>(key: K, value: ViewPrefs[K]): void {
  const prefs = { ...getViewPrefs(), [key]: value };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Best-effort: a restricted context just won't persist it.
  }
  emitViewChange();
}

// Anything that changes how every map looks (these prefs, the theme, the
// font) calls emitViewChange, and the workspace re-renders every map.
const listeners = new Set<() => void>();

export function onViewChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitViewChange(): void {
  for (const listener of listeners) listener();
}
