export interface SearchCallbacks {
  onQueryChange(query: string): void;
  onNext(): void;
  onPrev(): void;
  onClose(): void;
}

export interface SearchState {
  query: string;
  matchCount: number;
  currentIndex: number;
}

export interface SearchHandle {
  element: HTMLElement;
  open(): void;
  close(): void;
  isOpen(): boolean;
  update(state: SearchState): void;
}

// A floating find bar, shown/hidden rather than mounted per-render (unlike
// the canvas) so it survives renderMindMap()'s container.innerHTML wipe and
// keeps its own input's focus/caret across keystrokes.
export function createSearchBar(container: HTMLElement, callbacks: SearchCallbacks): SearchHandle {
  const el = document.createElement("div");
  el.className = "mm-search";
  el.hidden = true;

  const input = document.createElement("input");
  input.type = "text";
  input.className = "mm-search-input";
  input.placeholder = "Find…";
  input.addEventListener("input", () => callbacks.onQueryChange(input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) callbacks.onPrev();
      else callbacks.onNext();
    } else if (e.key === "Escape") {
      e.preventDefault();
      callbacks.onClose();
    }
    // Keep the app's global keydown handler (arrow-nav, delete, etc.) from
    // also reacting to keystrokes meant for this input.
    e.stopPropagation();
  });

  const countEl = document.createElement("span");
  countEl.className = "mm-search-count";

  function navButton(glyph: string, title: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.className = "mm-search-btn";
    btn.textContent = glyph;
    btn.title = title;
    btn.addEventListener("click", onClick);
    return btn;
  }

  const prevBtn = navButton("↑", "Previous match (Shift+Enter)", () => callbacks.onPrev());
  const nextBtn = navButton("↓", "Next match (Enter)", () => callbacks.onNext());
  const closeBtn = navButton("×", "Close (Esc)", () => callbacks.onClose());

  el.appendChild(input);
  el.appendChild(countEl);
  el.appendChild(prevBtn);
  el.appendChild(nextBtn);
  el.appendChild(closeBtn);
  container.appendChild(el);

  return {
    element: el,
    open() {
      el.hidden = false;
      input.focus();
      input.select();
    },
    close() {
      el.hidden = true;
      input.value = "";
    },
    isOpen: () => !el.hidden,
    update({ query, matchCount, currentIndex }) {
      if (input.value !== query) input.value = query;
      countEl.textContent = matchCount > 0 ? `${currentIndex + 1}/${matchCount}` : query ? "No results" : "";
    },
  };
}
