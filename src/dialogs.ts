import { message } from "@tauri-apps/plugin-dialog";

// Native dialogs inside the real Tauri webview. In a plain browser (the
// Chrome-driven dev server, tests) the plugin calls reject, so these fall
// back to the browser's own confirm/console.
export type SaveChoice = "save" | "discard" | "cancel";

// The standard macOS question before unsaved work goes away, with Save as
// the default button.
export async function askToSave(title: string): Promise<SaveChoice> {
  const name = title || "Untitled";
  try {
    const result = await message(`Your changes will be lost if you don't save them.`, {
      title: `Do you want to save the changes you made to "${name}"?`,
      kind: "warning",
      buttons: { yes: "Save", no: "Don't Save", cancel: "Cancel" },
    });
    // Custom buttons resolve to their label; default ones to Yes/No.
    if (result === "Save" || result === "Yes") return "save";
    if (result === "Don't Save" || result === "No") return "discard";
    return "cancel";
  } catch {
    // A plain browser has no three-button dialog: Discard or Cancel only.
    return window.confirm(`"${name}" has unsaved changes. Discard them?`) ? "discard" : "cancel";
  }
}

export async function showError(text: string): Promise<void> {
  try {
    await message(text, { title: "Canopy", kind: "error" });
  } catch {
    console.error(text);
  }
}
