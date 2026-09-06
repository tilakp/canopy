const STORAGE_KEY = "canopy-recent-files";
const MAX_RECENT_FILES = 8;

export function getRecentFiles(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

function saveRecentFiles(paths: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(paths));
  } catch {
    // Best-effort — a restricted context (e.g. private browsing) just won't persist it.
  }
}

// Moves `path` to the front, de-duplicating, and caps the list at
// MAX_RECENT_FILES (dropping the oldest).
export function addRecentFile(path: string): void {
  const rest = getRecentFiles().filter((p) => p !== path);
  saveRecentFiles([path, ...rest].slice(0, MAX_RECENT_FILES));
}

// For pruning an entry that failed to load, rather than leaving a stale
// broken path in the list.
export function removeRecentFile(path: string): void {
  saveRecentFiles(getRecentFiles().filter((p) => p !== path));
}
