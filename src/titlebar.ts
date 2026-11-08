import type { MindMapNode } from "./model";
import { TEMPLATES } from "./templates";
import { FONT_OPTIONS, getFontId, setFontId } from "./fonts";
import { getThemePref, setTheme, type ThemePref } from "./theme";
import { getViewPrefs, setViewPref, type ViewPrefs } from "./prefs";
import { getRecentFiles, removeRecentFile } from "./recentFiles";
import { attachPopover, fillMenu, moveMenuFocus, type MenuEntry } from "./menu";
import { ICONS } from "./icons";

export interface TabInfo {
  id: string;
  title: string;
  dirty: boolean;
}

// File actions, for the File button. It shows only where there is no
// native File menu (Windows, Linux, a plain browser); macOS has one.
export interface FileActions {
  onNew(): void;
  onOpen(): void;
  onOpenRecent(path: string): Promise<boolean>;
  onSave(): void;
  onSaveAs(): void;
  onImport(): void;
  onExport(): void;
  onPrint(): void;
}

export interface TitleBarCallbacks {
  onSwitch(id: string): void;
  onClose(id: string): void;
  onNew(root: MindMapNode): void;
  onArrange(): void;
  onToggleFocus(): void;
  onFind(): void;
  file: FileActions | null;
}

export interface TitleBarState {
  focused: boolean;
  canFocus: boolean;
}

export interface TitleBarHandle {
  element: HTMLElement;
  update(tabs: TabInfo[], activeId: string, state: TitleBarState): void;
}

// The macOS window buttons sit inside the title bar (titleBarStyle
// "Overlay" in tauri.conf.json), so the tabs start after them there.
export function hasOverlayTitleBar(): boolean {
  return navigator.userAgent.includes("Mac") && "__TAURI_INTERNALS__" in window;
}

function iconButton(icon: string, label: string, shortcut?: string): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = "mm-icon-btn";
  btn.innerHTML = icon;
  btn.setAttribute("aria-label", label);
  btn.title = shortcut ? `${label}  ${shortcut}` : label;
  return btn;
}

export function createTitleBar(host: HTMLElement, callbacks: TitleBarCallbacks): TitleBarHandle {
  const el = document.createElement("header");
  el.className = "mm-titlebar";
  if (hasOverlayTitleBar()) el.classList.add("mm-titlebar-overlay");
  // Dragging the empty parts of the bar moves the window. Tauri checks
  // only the element under the pointer, so each empty area carries it.
  el.setAttribute("data-tauri-drag-region", "");

  const tabsEl = document.createElement("nav");
  tabsEl.className = "mm-tabs";
  tabsEl.setAttribute("aria-label", "Open maps");
  tabsEl.setAttribute("data-tauri-drag-region", "");

  const newBtn = iconButton(ICONS.plus, "New map");
  newBtn.classList.add("mm-tab-new");
  const templatePanel = document.createElement("div");
  const templates = attachPopover(host, newBtn, templatePanel, "start");
  fillMenu(
    templatePanel,
    TEMPLATES.map((t) => ({ label: t.name, run: () => callbacks.onNew(t.build()) })),
    () => templates.close(),
  );

  const spacer = document.createElement("div");
  spacer.className = "mm-titlebar-spacer";
  spacer.setAttribute("data-tauri-drag-region", "");

  const actions = document.createElement("div");
  actions.className = "mm-titlebar-actions";

  if (callbacks.file) actions.appendChild(createFileButton(host, callbacks.file));

  const arrangeBtn = iconButton(ICONS.arrange, "Arrange: line up the columns");
  arrangeBtn.addEventListener("click", callbacks.onArrange);
  const focusBtn = iconButton(ICONS.focus, "Focus on the selected branch", "F");
  focusBtn.addEventListener("click", callbacks.onToggleFocus);
  const findBtn = iconButton(ICONS.search, "Find", "⌘F");
  findBtn.addEventListener("click", callbacks.onFind);

  const viewBtn = document.createElement("button");
  viewBtn.className = "mm-text-btn mm-view-btn";
  viewBtn.innerHTML = `${ICONS.sliders}<span>View</span>`;
  viewBtn.title = "View options";
  const view = createViewPanel();
  attachPopover(host, viewBtn, view.panel, "end", view.refresh);

  actions.append(arrangeBtn, focusBtn, findBtn, viewBtn);
  el.append(tabsEl, newBtn, spacer, actions);
  host.appendChild(el);

  return {
    element: el,
    update(tabs, activeId, state) {
      focusBtn.dataset.active = String(state.focused);
      focusBtn.disabled = !state.canFocus && !state.focused;
      view.refresh();
      tabsEl.innerHTML = "";
      for (const tab of tabs) {
        const tabEl = document.createElement("div");
        tabEl.className = "mm-tab";
        tabEl.dataset.active = String(tab.id === activeId);
        tabEl.setAttribute("role", "tab");
        tabEl.setAttribute("aria-selected", String(tab.id === activeId));
        tabEl.addEventListener("click", () => callbacks.onSwitch(tab.id));

        const title = document.createElement("span");
        title.className = "mm-tab-title";
        title.textContent = tab.title || "Untitled";
        tabEl.appendChild(title);

        // The close button doubles as the unsaved-changes dot, as in macOS:
        // a dirty tab shows a dot that turns into × on hover.
        const closeBtn = document.createElement("button");
        closeBtn.className = "mm-tab-close";
        closeBtn.dataset.dirty = String(tab.dirty);
        closeBtn.title = tab.dirty ? "Close map (unsaved changes)" : "Close map";
        closeBtn.setAttribute("aria-label", closeBtn.title);
        closeBtn.innerHTML = ICONS.close;
        closeBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          callbacks.onClose(tab.id);
        });
        tabEl.appendChild(closeBtn);
        tabsEl.appendChild(tabEl);
      }
    },
  };
}

function createFileButton(host: HTMLElement, file: FileActions): HTMLElement {
  const btn = document.createElement("button");
  btn.className = "mm-text-btn";
  btn.textContent = "File";
  const panel = document.createElement("div");
  panel.addEventListener("keydown", (e) => moveMenuFocus(panel, e));
  // The File button shows in a browser on a Mac too, so the shortcut
  // labels follow the platform.
  const mac = navigator.userAgent.includes("Mac");
  const key = (k: string, shift = false) => (mac ? `${shift ? "⇧" : ""}⌘${k}` : `Ctrl+${shift ? "Shift+" : ""}${k}`);
  const popover = attachPopover(host, btn, panel, "end", () => {
    const recent = getRecentFiles();
    const entries: MenuEntry[] = [
      { label: "New Map", run: file.onNew },
      { label: "Open…", shortcut: key("O"), run: file.onOpen },
      "separator",
      ...recent.map((path) => ({
        label: path.split(/[\\/]/).pop() || path,
        run: () => {
          void file.onOpenRecent(path).then((ok) => {
            if (!ok) removeRecentFile(path);
          });
        },
      })),
      ...(recent.length > 0 ? ["separator" as const] : []),
      { label: "Save", shortcut: key("S"), run: file.onSave },
      { label: "Save As…", shortcut: key("S", true), run: file.onSaveAs },
      "separator",
      { label: "Import Markdown…", run: file.onImport },
      { label: "Export…", run: file.onExport },
      { label: "Print…", run: file.onPrint },
    ];
    fillMenu(panel, entries, () => popover.close());
  });
  return btn;
}

// The View popover: settings that change how every map looks. Each control
// writes its global preference, which re-renders every map (see prefs.ts).
function createViewPanel(): { panel: HTMLElement; refresh(): void } {
  const panel = document.createElement("div");
  panel.classList.add("mm-view-panel");

  const themeSeg = segmented<ThemePref>(
    "Appearance",
    [
      ["system", "System"],
      ["light", "Light"],
      ["dark", "Dark"],
    ],
    (v) => setTheme(v),
  );
  const lineSeg = segmented<ViewPrefs["edgeStyle"]>(
    "Lines",
    [
      ["curved", "Curved"],
      ["straight", "Elbow"],
    ],
    (v) => setViewPref("edgeStyle", v),
  );

  const fontRow = document.createElement("label");
  fontRow.className = "mm-view-row";
  fontRow.textContent = "Font";
  const fontSelect = document.createElement("select");
  fontSelect.className = "mm-select";
  for (const font of FONT_OPTIONS) {
    const option = document.createElement("option");
    option.value = font.id;
    option.textContent = font.id === "system" ? "System" : font.label;
    fontSelect.appendChild(option);
  }
  fontSelect.addEventListener("change", () => setFontId(fontSelect.value));
  fontRow.appendChild(fontSelect);

  const sep = document.createElement("div");
  sep.className = "mm-menu-sep";

  const sketchy = toggle("Hand-drawn style", (on) => setViewPref("sketchy", on));
  const grid = toggle("Dot grid", (on) => setViewPref("grid", on));
  const minimap = toggle("Minimap", (on) => setViewPref("minimap", on));

  panel.append(themeSeg.el, lineSeg.el, fontRow, sep, sketchy.el, grid.el, minimap.el);

  return {
    panel,
    refresh() {
      const prefs = getViewPrefs();
      themeSeg.set(getThemePref());
      lineSeg.set(prefs.edgeStyle);
      fontSelect.value = getFontId();
      sketchy.set(prefs.sketchy);
      grid.set(prefs.grid);
      minimap.set(prefs.minimap);
    },
  };
}

function segmented<T extends string>(
  label: string,
  options: [T, string][],
  onPick: (value: T) => void,
): { el: HTMLElement; set(value: T): void } {
  const el = document.createElement("div");
  el.className = "mm-view-field";
  const title = document.createElement("span");
  title.className = "mm-view-label";
  title.textContent = label;
  const group = document.createElement("div");
  group.className = "mm-segmented";
  group.setAttribute("role", "radiogroup");
  group.setAttribute("aria-label", label);
  const buttons = options.map(([value, text]) => {
    const btn = document.createElement("button");
    btn.textContent = text;
    btn.setAttribute("role", "radio");
    btn.dataset.value = value;
    btn.addEventListener("click", () => onPick(value));
    group.appendChild(btn);
    return btn;
  });
  el.append(title, group);
  return {
    el,
    set(value) {
      for (const btn of buttons) btn.setAttribute("aria-checked", String(btn.dataset.value === value));
    },
  };
}

function toggle(label: string, onChange: (on: boolean) => void): { el: HTMLElement; set(on: boolean): void } {
  const el = document.createElement("label");
  el.className = "mm-view-row";
  el.textContent = label;
  const input = document.createElement("input");
  input.type = "checkbox";
  input.className = "mm-switch";
  input.setAttribute("role", "switch");
  input.addEventListener("change", () => onChange(input.checked));
  el.appendChild(input);
  return {
    el,
    set(on) {
      input.checked = on;
    },
  };
}
