import type { NodeLayout } from "./layout";
import { computeFitCamera, type Camera } from "./render";

const SVG_NS = "http://www.w3.org/2000/svg";

export const MINIMAP_WIDTH = 160;
export const MINIMAP_HEIGHT = 120;
const MIN_DOT = 3;

export interface MinimapCallbacks {
  onNavigate(worldX: number, worldY: number): void;
}

export interface MinimapState {
  positions: Map<string, NodeLayout>;
  contentBBox: DOMRect;
  camera: Camera;
  viewportSize: { width: number; height: number };
  visible: boolean;
}

export interface MinimapHandle {
  element: HTMLElement;
  update(state: MinimapState): void;
}

// Fits `bbox` into the minimap's small fixed viewport, same math as
// render.ts's computeFitCamera (which the main canvas uses to fit content
// into the real viewport) — reused rather than reimplemented.
export function computeMinimapCamera(bbox: DOMRect): Camera {
  return computeFitCamera(bbox, { width: MINIMAP_WIDTH, height: MINIMAP_HEIGHT });
}

// Inverse of the world->screen mapping a Camera describes: given a point in
// the minimap's own screen space, what world coordinate is under it.
export function minimapScreenToWorld(camera: Camera, screenX: number, screenY: number): { x: number; y: number } {
  return { x: (screenX - camera.x) / camera.scale, y: (screenY - camera.y) / camera.scale };
}

// The world-space rect the main canvas currently shows, derived from its
// camera and real pixel size — this is what the minimap draws as the
// "you are here" outline.
export function computeViewportWorldRect(
  camera: Camera,
  viewportSize: { width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  return {
    x: -camera.x / camera.scale,
    y: -camera.y / camera.scale,
    width: viewportSize.width / camera.scale,
    height: viewportSize.height / camera.scale,
  };
}

// A small floating SVG overview of the whole tree, fixed bottom-right, with
// a rectangle showing the main canvas's current viewport. Click or
// click-drag inside it to jump the main camera there. Lives on `container`
// (not the canvas's own child div, which renderMindMap wipes every render)
// so it survives re-renders like the toolbar and search bar.
export function createMinimap(container: HTMLElement, callbacks: MinimapCallbacks): MinimapHandle {
  const el = document.createElement("div");
  el.className = "mm-minimap";
  el.hidden = true;

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", String(MINIMAP_WIDTH));
  svg.setAttribute("height", String(MINIMAP_HEIGHT));
  svg.setAttribute("viewBox", `0 0 ${MINIMAP_WIDTH} ${MINIMAP_HEIGHT}`);
  el.appendChild(svg);
  container.appendChild(el);

  // The camera that maps world coordinates to this minimap's own screen
  // space, recomputed on every update() — needed to invert a click back to
  // a world point.
  let currentCamera: Camera | null = null;

  function navigateAt(e: PointerEvent): void {
    if (!currentCamera) return;
    const rect = svg.getBoundingClientRect();
    const world = minimapScreenToWorld(currentCamera, e.clientX - rect.left, e.clientY - rect.top);
    callbacks.onNavigate(world.x, world.y);
  }

  svg.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    svg.setPointerCapture(e.pointerId);
    navigateAt(e);
  });
  svg.addEventListener("pointermove", (e) => {
    if (e.buttons !== 1) return;
    navigateAt(e);
  });

  return {
    element: el,
    update(state) {
      // Nothing meaningful to show for a blank map (just a root, no
      // children) — same spirit as render.ts's initial-camera blank case.
      if (!state.visible || state.positions.size <= 1) {
        el.hidden = true;
        currentCamera = null;
        return;
      }
      el.hidden = false;
      const camera = computeMinimapCamera(state.contentBBox);
      currentCamera = camera;

      svg.innerHTML = "";
      for (const pos of state.positions.values()) {
        const w = Math.max(MIN_DOT, pos.width * camera.scale);
        const h = Math.max(MIN_DOT, pos.height * camera.scale);
        const cx = camera.x + (pos.x + pos.width / 2) * camera.scale;
        const cy = camera.y + pos.y * camera.scale;
        const rect = document.createElementNS(SVG_NS, "rect");
        rect.setAttribute("x", String(cx - w / 2));
        rect.setAttribute("y", String(cy - h / 2));
        rect.setAttribute("width", String(w));
        rect.setAttribute("height", String(h));
        rect.setAttribute("rx", "1");
        rect.setAttribute("fill", pos.color);
        svg.appendChild(rect);
      }

      const viewportRect = computeViewportWorldRect(state.camera, state.viewportSize);
      const outlineX = camera.x + viewportRect.x * camera.scale;
      const outlineY = camera.y + viewportRect.y * camera.scale;
      const outlineW = viewportRect.width * camera.scale;
      const outlineH = viewportRect.height * camera.scale;
      // Clamp to the minimap's own viewBox: a small/new map's total content
      // is often narrower than what the (possibly zoomed-out, or just wide)
      // main window shows, so the true viewport rect can be bigger than the
      // whole minimap — unclamped, every edge of that rect lands outside
      // the visible area at once and the outline never renders at all.
      const clampedX = Math.max(0, outlineX);
      const clampedY = Math.max(0, outlineY);
      const clampedRight = Math.min(MINIMAP_WIDTH, outlineX + outlineW);
      const clampedBottom = Math.min(MINIMAP_HEIGHT, outlineY + outlineH);
      const outline = document.createElementNS(SVG_NS, "rect");
      outline.setAttribute("class", "mm-minimap-viewport");
      outline.setAttribute("x", String(clampedX));
      outline.setAttribute("y", String(clampedY));
      outline.setAttribute("width", String(Math.max(0, clampedRight - clampedX)));
      outline.setAttribute("height", String(Math.max(0, clampedBottom - clampedY)));
      svg.appendChild(outline);
    },
  };
}
