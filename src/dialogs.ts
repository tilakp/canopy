import { ask, message } from "@tauri-apps/plugin-dialog";

// Native dialogs inside the real Tauri webview. In a plain browser (the
// Chrome-driven dev server, tests) the plugin calls reject, so these fall
// back to the browser's own confirm/console.
// With no title, the question is about all open maps (closing the window).
export async function confirmDiscard(title?: string): Promise<boolean> {
  const text =
    title === undefined
      ? "Some open maps have unsaved changes. Discard them?"
      : `"${title || "Untitled"}" has unsaved changes. Discard them?`;
  try {
    return await ask(text, { title: "Unsaved changes", kind: "warning", okLabel: "Discard", cancelLabel: "Cancel" });
  } catch {
    return window.confirm(text);
  }
}

export async function showError(text: string): Promise<void> {
  try {
    await message(text, { title: "Canopy", kind: "error" });
  } catch {
    console.error(text);
  }
}
