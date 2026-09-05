import { openUrl } from "@tauri-apps/plugin-opener";

// Opens a link in the user's default browser. Swallows errors so a bad/odd
// URL (or running outside a Tauri webview, e.g. tests) doesn't crash the app.
export async function openLink(url: string): Promise<void> {
  try {
    await openUrl(url);
  } catch {
    // Nothing sensible to do — there's no console wired up for the user to see it.
  }
}
