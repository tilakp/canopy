// The camera maps world coordinates (where layout puts nodes) to the
// screen: screen = world * scale + (x, y).
export interface Camera {
  x: number;
  y: number;
  scale: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function cameraTransform(camera: Camera): string {
  return `translate(${camera.x} ${camera.y}) scale(${camera.scale})`;
}

// The camera that fits `box` inside `viewport` with a margin, never
// zooming in past 100%. Used for the first view, zoom to fit, and the
// minimap.
export function computeFitCamera(box: Box, viewport: { width: number; height: number }): Camera {
  if (box.width <= 0 || box.height <= 0) {
    return { x: viewport.width / 2, y: viewport.height / 2, scale: 1 };
  }
  const margin = 0.9;
  const scale = Math.min((viewport.width / box.width) * margin, (viewport.height / box.height) * margin, 1);
  return {
    scale,
    x: viewport.width / 2 - (box.x + box.width / 2) * scale,
    y: viewport.height / 2 - (box.y + box.height / 2) * scale,
  };
}

// The camera for a map just loaded: centered, at 100%. A blank map (only a
// root) starts near the left edge instead, since a map only grows
// rightward and centering would waste the right half of the window.
const BLANK_LEFT_MARGIN = 120;

export function computeInitialCamera(box: Box, viewport: { width: number; height: number }, isBlank: boolean): Camera {
  const y = viewport.height / 2 - (box.y + box.height / 2);
  const x = isBlank ? BLANK_LEFT_MARGIN - box.x : viewport.width / 2 - (box.x + box.width / 2);
  return { x, y, scale: 1 };
}

// The camera after zooming to `targetScale` (clamped) with the screen
// point (anchorX, anchorY) kept still.
export function zoomAround(camera: Camera, targetScale: number, anchorX: number, anchorY: number, min: number, max: number): Camera {
  const scale = Math.min(max, Math.max(min, targetScale));
  const worldX = (anchorX - camera.x) / camera.scale;
  const worldY = (anchorY - camera.y) / camera.scale;
  return { scale, x: anchorX - worldX * scale, y: anchorY - worldY * scale };
}
