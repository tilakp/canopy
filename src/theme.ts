import { emitViewChange } from "./prefs";

export type Theme = "light" | "dark";
// "system" follows the OS appearance and changes with it.
export type ThemePref = Theme | "system";

const STORAGE_KEY = "canopy-theme";

export function getThemePref(): ThemePref {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "dark" || stored === "light" ? stored : "system";
  } catch {
    return "system";
  }
}

function systemIsDark(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

// The theme in effect now: the stored choice, or the OS appearance for
// "system".
export function getTheme(): Theme {
  const pref = getThemePref();
  if (pref !== "system") return pref;
  return systemIsDark() ? "dark" : "light";
}

export function setTheme(pref: ThemePref): void {
  try {
    localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    // Best-effort — a restricted context (e.g. private browsing) just won't persist it.
  }
  document.documentElement.dataset.theme = getTheme();
  emitViewChange();
}

// Applies the theme in effect at startup, and follows OS appearance changes
// while the choice is "system".
export function initTheme(): void {
  document.documentElement.dataset.theme = getTheme();
  if (typeof window.matchMedia !== "function") return;
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (getThemePref() !== "system") return;
    document.documentElement.dataset.theme = getTheme();
    emitViewChange();
  });
}
