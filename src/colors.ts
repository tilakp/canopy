// Every color the map draws with. The palette is defined only here.

// Seven hues tuned to one lightness, so no branch shouts over another. The
// root's children take them in turn; the branch color menus offer them.
export const PALETTE = ["#4F6BED", "#12A383", "#E8890C", "#D6457A", "#7A4FE0", "#1497AE", "#5E9E2B"];
export const ROOT_COLOR = "#2E2C34";

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

type Rgb = [number, number, number];
const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];
// The dark theme's canvas color (--mm-bg in styles.css).
const DARK_BG: Rgb = [23, 23, 26];

function hexToRgb(hex: string): Rgb {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

// `from` mixed toward `to` by `amount` (0 = from, 1 = to).
function mix(from: Rgb, to: Rgb, amount: number): string {
  const m = (i: number) => Math.round(from[i] + (to[i] - from[i]) * amount);
  return `rgb(${m(0)} ${m(1)} ${m(2)})`;
}

// What one branch color becomes in one theme. Every value is set as an SVG
// attribute, not CSS, so exports and print keep it.
export interface BranchColors {
  // Lines, underlines, the done check: the color itself, lighter on dark.
  line: string;
  // A first-level branch's fill: a light tint, or a dim one on dark.
  fill: string;
  // Text on that fill, well over 4.5:1 against it.
  text: string;
  // The outline that keeps a dark tint apart from the canvas.
  stroke: string;
}

// The colors of one theme. A render asks for the same few branch colors
// for every node, so each is worked out once and kept.
export interface ThemeColors {
  dark: boolean;
  branch(hex: string): BranchColors;
  rootFill: string;
  rootBorder: string;
  // Root and deeper-node text, as attributes so exports keep them.
  text: string;
  leafText: string;
  // The check mark on a done badge.
  onLine: string;
}

const themes = new Map<boolean, ThemeColors>();

export function themeColors(dark: boolean): ThemeColors {
  let theme = themes.get(dark);
  if (!theme) {
    const cache = new Map<string, BranchColors>();
    theme = {
      dark,
      branch(hex) {
        let colors = cache.get(hex);
        if (!colors) {
          // A color that is not #rrggbb (a hand-edited file) draws as grey,
          // the same everywhere, not as NaN.
          const rgb = hexToRgb(isHexColor(hex) ? hex : "#8a8a94");
          colors = dark
            ? { line: mix(rgb, WHITE, 0.18), fill: mix(rgb, DARK_BG, 0.8), text: mix(rgb, WHITE, 0.6), stroke: mix(rgb, DARK_BG, 0.6) }
            : { line: mix(rgb, WHITE, 0), fill: mix(rgb, WHITE, 0.88), text: mix(rgb, BLACK, 0.42), stroke: "none" };
          cache.set(hex, colors);
        }
        return colors;
      },
      rootFill: dark ? "#232328" : "#ffffff",
      rootBorder: dark ? "#38383f" : "#e6e6eb",
      text: dark ? "#ededf0" : "#1c1c21",
      leafText: dark ? "#d6d6dc" : "#2a2a31",
      onLine: dark ? "#17171a" : "#ffffff",
    };
    themes.set(dark, theme);
  }
  return theme;
}
