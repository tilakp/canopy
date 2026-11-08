// One icon set for all the app's controls: 16x16, 1.6px round strokes in
// the current text color, so every icon has the same weight.
function icon(body: string): string {
  return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

export const ICONS = {
  plus: icon(`<path d="M8 3v10M3 8h10"/>`),
  minus: icon(`<path d="M3 8h10"/>`),
  close: icon(`<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>`),
  arrange: icon(`<rect x="2" y="3" width="4" height="10" rx="1"/><rect x="10" y="3" width="4" height="10" rx="1"/>`),
  focus: icon(
    `<circle cx="8" cy="8" r="2"/><path d="M2 5V3a1 1 0 0 1 1-1h2M11 2h2a1 1 0 0 1 1 1v2M14 11v2a1 1 0 0 1-1 1h-2M5 14H3a1 1 0 0 1-1-1v-2"/>`,
  ),
  search: icon(`<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14"/>`),
  sliders: icon(`<path d="M2 4h7M12 4h2M2 12h2M7 12h7"/><circle cx="10.5" cy="4" r="1.5"/><circle cx="5.5" cy="12" r="1.5"/>`),
  help: icon(`<circle cx="8" cy="8" r="6"/><path d="M6.5 6.5a1.5 1.5 0 1 1 2 1.4c-.4.2-.5.5-.5.9v.7"/><path d="M8 11.5h.01" stroke-width="2"/>`),
  addChild: icon(`<path d="M3 3v5a2 2 0 0 0 2 2h4"/><path d="M12 8v5M9.5 10.5h5"/>`),
  notes: icon(`<path d="M4 2h6l3 3v9H4z"/><path d="M6 8h5M6 11h3"/>`),
  link: icon(`<path d="M7 9a3 3 0 0 0 4 0l2-2a3 3 0 0 0-4-4l-.5.5"/><path d="M9 7a3 3 0 0 0-4 0L3 9a3 3 0 0 0 4 4l.5-.5"/>`),
  emoji: icon(`<circle cx="8" cy="8" r="6"/><path d="M5.8 9.6c1.2 1.1 3.2 1.1 4.4 0"/><path d="M6 6.5h.01M10 6.5h.01" stroke-width="2"/>`),
  status: icon(`<circle cx="8" cy="8" r="6"/><path d="M5.5 8l1.8 1.8L10.5 6.5"/>`),
  more: icon(`<path d="M3.5 8h.01M8 8h.01M12.5 8h.01" stroke-width="2.4"/>`),
  chevronUp: icon(`<path d="M4 10l4-4 4 4"/>`),
  chevronDown: icon(`<path d="M4 6l4 4 4-4"/>`),
};
