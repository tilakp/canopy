export type Theme = "light" | "dark";

const STORAGE_KEY = "canopy-theme";

export function getTheme(): Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Best-effort — a restricted context (e.g. private browsing) just won't persist it.
  }
  document.documentElement.dataset.theme = theme;
}

// Applies whatever getTheme() currently returns. Call once at startup so
// the app boots in the right theme before any user interaction.
export function initTheme(): void {
  document.documentElement.dataset.theme = getTheme();
}
