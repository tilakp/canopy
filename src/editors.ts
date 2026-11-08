// The editors on the canvas: a node's title, edited in place, and its
// notes, icon and link, edited in a small labeled panel next to it. They
// are HTML over the SVG, placed in screen coordinates from the camera.
import type { MindMapNode } from "./model";
import type { NodeLayout } from "./layout";
import type { Camera } from "./camera";
import type { ThemeColors } from "./colors";
import { measureText, wrapText } from "./textwrap";
import { fontString, type NodeVisual } from "./visuals";

export type EditorKind = "title" | "notes" | "icon" | "link";

export interface EditorTarget {
  kind: EditorKind;
  id: string;
}

export interface EditorCallbacks {
  // `next` says which key ended a title edit: Enter asks for a sibling
  // after it, Tab for a child. The app decides whether to act on it.
  onCommit(target: EditorTarget, value: string, next?: "sibling" | "child"): void;
  onCancel(): void;
}

export interface EditorContext {
  camera: Camera;
  theme: ThemeColors;
  fontFamily: string;
  sketchy: boolean;
}

// Each open editor's commit, so an edit can be committed without a blur
// (the window closing, a file opening): a blur needs focus, which the
// editor may not have then.
const commits = new WeakMap<HTMLElement, () => void>();

export function commitOpenEditor(container: HTMLElement): void {
  const field = container.querySelector<HTMLElement>("[data-editor]");
  if (field) commits.get(field)?.();
}

export function renderEditor(
  container: HTMLElement,
  target: EditorTarget,
  node: MindMapNode,
  layout: NodeLayout,
  visual: NodeVisual,
  ctx: EditorContext,
  callbacks: EditorCallbacks,
): void {
  if (target.kind === "title") renderTitleEditor(container, node, layout, visual, ctx, callbacks);
  else if (target.kind === "notes") renderNotesEditor(container, node, layout, ctx.camera, callbacks);
  else {
    const isIcon = target.kind === "icon";
    renderLineEditor(container, target, layout, ctx.camera, {
      label: isIcon ? "Icon" : "Link",
      value: (isIcon ? node.icon : node.link) ?? "",
      placeholder: isIcon ? "An emoji, e.g. 🚀" : "https://…",
      width: isIcon ? 180 : 260,
      callbacks,
    });
  }
}

// ----- Keeping a draft across a render -----

// An editor open across a full render (a zoom while typing) is rebuilt from
// the saved node, which would drop what was typed. Its draft, caret and
// focus are carried over to the new editor.
export interface EditorDraft {
  key: string;
  value: string;
  selectionStart: number | null;
  selectionEnd: number | null;
  focused: boolean;
}

export function captureDraft(container: HTMLElement): EditorDraft | null {
  const field = container.querySelector<HTMLInputElement | HTMLTextAreaElement>("[data-editor]");
  if (!field) return null;
  // Chrome fires blur on a focused element while the render removes it, and
  // the element still counts as connected then. This mark tells the
  // editor's blur handler that the blur is not "clicked away".
  field.dataset.rebuilding = "true";
  return {
    key: field.dataset.editor!,
    value: field.value,
    selectionStart: field.selectionStart,
    selectionEnd: field.selectionEnd,
    focused: document.activeElement === field,
  };
}

export function restoreDraft(container: HTMLElement, draft: EditorDraft): void {
  // Compared by value, not put in a selector: a node id from a file can
  // hold any character, and a quote would make the selector invalid.
  const field = [...container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-editor]")].find(
    (f) => f.dataset.editor === draft.key,
  );
  if (!field) return;
  field.value = draft.value;
  // Lets the editor resize itself to the restored text.
  field.dispatchEvent(new Event("input"));
  if (draft.focused) field.focus();
  if (draft.selectionStart !== null && draft.selectionEnd !== null) {
    field.setSelectionRange(draft.selectionStart, draft.selectionEnd);
  }
}

// False for a blur caused by a render removing the editor (see
// captureDraft) or by Enter/Escape having already ended the edit.
function isUserBlur(field: HTMLElement): boolean {
  return field.isConnected && field.dataset.rebuilding !== "true";
}

// Keys typed into an editor stay there, so they don't also trigger the
// app's shortcuts. ⌘S is the exception: it must reach the app's handler,
// which commits the open edit and then saves.
function stopUnlessSave(e: KeyboardEvent): void {
  if (!((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s")) e.stopPropagation();
}

function wireField(
  field: HTMLInputElement | HTMLTextAreaElement,
  target: EditorTarget,
  label: string,
  commit: () => void,
): void {
  field.dataset.editor = `${target.kind}:${target.id}`;
  field.setAttribute("aria-label", label);
  field.spellcheck = target.kind === "notes";
  commits.set(field, commit);
  field.addEventListener("blur", () => isUserBlur(field) && commit());
}

// ----- The title editor -----

// Edits the title in place: the node's box itself becomes the editor, with
// the same fill, font, padding and corner radius, and it resizes as you
// type using the same measurement the node uses, so what you see while
// typing is what the node looks like after. The SVG node is hidden
// meanwhile (.mm-node.mm-editing in styles.css). A textarea, not an input,
// so a long title wraps onto more lines the way the node will.
function renderTitleEditor(
  container: HTMLElement,
  node: MindMapNode,
  layout: NodeLayout,
  visual: NodeVisual,
  ctx: EditorContext,
  callbacks: EditorCallbacks,
): void {
  const { style, tier, leading, trailing, wrapWidth } = visual;
  const { camera, theme } = ctx;
  const scale = camera.scale;
  const target: EditorTarget = { kind: "title", id: node.id };
  const input = document.createElement("textarea");
  input.className = `mm-edit-input mm-edit-${tier}`;
  input.value = node.text;
  input.rows = 1;

  input.style.left = `${camera.x + layout.x * scale}px`;
  input.style.top = `${camera.y + layout.y * scale}px`;
  input.style.fontSize = `${style.fontSize * scale}px`;
  input.style.fontWeight = String(style.fontWeight);
  input.style.lineHeight = `${style.lineHeight * scale}px`;
  // The badge slots stay empty while editing, so the text wraps at the
  // same width as in the node.
  input.style.padding = `${style.paddingY * scale}px ${(style.paddingX + trailing) * scale}px ${style.paddingY * scale}px ${(style.paddingX + leading) * scale}px`;
  // Sketchy boxes are hand-drawn rectangles, not rounded ones.
  input.style.borderRadius = ctx.sketchy ? "2px" : `${style.rx * scale}px`;
  const colors = theme.branch(layout.color);
  if (tier === "root") input.style.background = theme.rootFill;
  else if (tier === "branch") {
    input.style.background = colors.fill;
    input.style.color = colors.text;
  } else {
    // A deeper idea has no fill of its own: the panel color, with its line.
    input.style.textAlign = "left";
    input.style.borderBottom = `2px solid ${colors.line}`;
  }
  // The underline (a bottom border) would take room from the text unless
  // the box grows by it.
  const underline = tier === "leaf" ? 2 : 0;
  const font = fontString(style, ctx.fontFamily);
  const fixed = node.width !== undefined;

  const fit = () => {
    const wrapped = wrapText(input.value || " ", font, wrapWidth);
    let lineCount = wrapped.lines.length;
    let textWidth = wrapped.width;
    // wrapText leaves out a space at the end, but the textarea keeps it, and
    // with no room for it the cursor after it drops to the next line until
    // the next letter is typed. So the space counts here: on this line if
    // it fits, else as a new line, where the next word goes.
    if (input.value.trim() && /\s$/.test(input.value)) {
      const withSpace = measureText(`${wrapped.lines[lineCount - 1]} `, font);
      if (withSpace <= wrapWidth) textWidth = Math.max(textWidth, withSpace);
      else lineCount += 1;
    }
    const width = Math.max(textWidth, fixed ? wrapWidth : MIN_EDIT_TEXT_WIDTH) + style.paddingX * 2 + leading + trailing;
    const height = lineCount * style.lineHeight + style.paddingY * 2;
    // +1px: the textarea wraps on its own, and a subpixel rounding
    // difference must not push the last word onto a new line.
    input.style.width = `${width * scale + 1}px`;
    input.style.height = `${height * scale + underline}px`;
  };
  input.addEventListener("input", () => {
    // A title is one line of text that wraps. The node shows no line
    // breaks, no leading space and no runs of spaces, so the editor doesn't
    // either: otherwise its text wraps where the measured box says it
    // shouldn't.
    const value = tidyTitle(input.value);
    if (value !== input.value) {
      const caret = tidyTitle(input.value.slice(0, input.selectionStart ?? input.value.length)).length;
      input.value = value;
      input.setSelectionRange(caret, caret);
    }
    fit();
  });
  fit();

  wireField(input, target, "Title", () => callbacks.onCommit(target, input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      callbacks.onCommit(target, input.value, e.key === "Enter" ? "sibling" : "child");
    } else if (e.key === "Escape") {
      e.preventDefault();
      callbacks.onCancel();
    }
    stopUnlessSave(e);
  });

  container.appendChild(input);
  input.focus();
  input.select();
}

const MIN_EDIT_TEXT_WIDTH = 24;

function tidyTitle(text: string): string {
  return text.replace(/\s*\n\s*/g, " ").replace(/^\s+/, "").replace(/ {2,}/g, " ");
}

// ----- Notes, icon and link panels -----

// A labeled panel below the node (above it when there is no room below),
// so it doesn't cover the node being edited, and it says how to save or
// cancel.
function createFieldPanel(
  container: HTMLElement,
  layout: NodeLayout,
  camera: Camera,
  label: string,
  hint: string,
  width: number,
  expectedHeight: number,
): HTMLDivElement {
  const panel = document.createElement("div");
  panel.className = "mm-field-panel";
  panel.style.width = `${width}px`;

  const head = document.createElement("div");
  head.className = "mm-field-head";
  const labelEl = document.createElement("span");
  labelEl.className = "mm-field-label";
  labelEl.textContent = label;
  const hintEl = document.createElement("span");
  hintEl.className = "mm-field-hint";
  hintEl.textContent = hint;
  head.append(labelEl, hintEl);
  panel.appendChild(head);

  const screenX = camera.x + (layout.x + layout.width / 2) * camera.scale;
  const below = camera.y + (layout.y + layout.height / 2) * camera.scale + 8;
  const above = camera.y + (layout.y - layout.height / 2) * camera.scale - 8;
  const roomBelow = container.clientHeight - below;
  panel.style.left = `${screenX}px`;
  if (roomBelow < expectedHeight && above > expectedHeight) {
    panel.style.top = `${above}px`;
    panel.style.transform = "translate(-50%, -100%)";
  } else {
    panel.style.top = `${below}px`;
    panel.style.transform = "translate(-50%, 0)";
  }
  return panel;
}

function renderNotesEditor(
  container: HTMLElement,
  node: MindMapNode,
  layout: NodeLayout,
  camera: Camera,
  callbacks: EditorCallbacks,
): void {
  const target: EditorTarget = { kind: "notes", id: node.id };
  const panel = createFieldPanel(container, layout, camera, "Notes", "⌘↵ to save · Esc to cancel", 260, 150);
  const textarea = document.createElement("textarea");
  textarea.className = "mm-notes-input";
  textarea.placeholder = "Add details, context or a reminder";
  textarea.value = node.notes ?? "";
  // Grows with its text, up to the max-height in styles.css.
  const fit = () => {
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  };
  textarea.addEventListener("input", fit);

  const commit = () => callbacks.onCommit(target, textarea.value);
  wireField(textarea, target, "Notes", commit);
  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      callbacks.onCancel();
    }
    stopUnlessSave(e);
  });

  panel.appendChild(textarea);
  container.appendChild(panel);
  fit();
  textarea.focus();
}

// A single-line field in the same kind of panel, for the icon and the link.
function renderLineEditor(
  container: HTMLElement,
  target: EditorTarget,
  layout: NodeLayout,
  camera: Camera,
  field: { label: string; value: string; placeholder: string; width: number; callbacks: EditorCallbacks },
): void {
  const panel = createFieldPanel(container, layout, camera, field.label, "↵ to save · Esc to cancel", field.width, 80);
  const input = document.createElement("input");
  input.type = "text";
  input.className = "mm-inline-input";
  input.placeholder = field.placeholder;
  input.value = field.value;

  const commit = () => field.callbacks.onCommit(target, input.value);
  wireField(input, target, field.label, commit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      field.callbacks.onCancel();
    }
    stopUnlessSave(e);
  });

  panel.appendChild(input);
  container.appendChild(panel);
  input.focus();
  input.select();
}
