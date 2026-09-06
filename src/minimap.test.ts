import { describe, expect, it } from "vitest";
import { computeMinimapCamera, computeViewportWorldRect, minimapScreenToWorld, MINIMAP_WIDTH, MINIMAP_HEIGHT } from "./minimap";

describe("computeMinimapCamera", () => {
  it("fits a wide content bbox into the minimap's fixed viewport", () => {
    const bbox = new DOMRect(0, 0, 1600, 400);
    const camera = computeMinimapCamera(bbox);
    expect(camera.scale).toBeCloseTo((MINIMAP_WIDTH / 1600) * 0.9);
    expect(camera.x).toBeCloseTo(MINIMAP_WIDTH / 2 - 800 * camera.scale);
    expect(camera.y).toBeCloseTo(MINIMAP_HEIGHT / 2 - 200 * camera.scale);
  });

  it("never scales up past 1x for content smaller than the minimap", () => {
    const camera = computeMinimapCamera(new DOMRect(0, 0, 20, 10));
    expect(camera.scale).toBe(1);
  });
});

describe("minimapScreenToWorld", () => {
  it("inverts the camera's world->screen mapping", () => {
    const camera = { x: 10, y: 20, scale: 2 };
    const world = minimapScreenToWorld(camera, 30, 40);
    // screen = camera.x + world * scale, so world = (screen - camera.x) / scale
    expect(world.x).toBeCloseTo((30 - 10) / 2);
    expect(world.y).toBeCloseTo((40 - 20) / 2);
  });

  it("round-trips through computeMinimapCamera for a point inside the content bbox", () => {
    const bbox = new DOMRect(0, 0, 200, 100);
    const camera = computeMinimapCamera(bbox);
    const screenX = camera.x + 50 * camera.scale;
    const screenY = camera.y + 25 * camera.scale;
    const world = minimapScreenToWorld(camera, screenX, screenY);
    expect(world.x).toBeCloseTo(50);
    expect(world.y).toBeCloseTo(25);
  });
});

describe("computeViewportWorldRect", () => {
  it("derives the visible world rect from camera and viewport size", () => {
    const camera = { x: 100, y: 50, scale: 2 };
    const rect = computeViewportWorldRect(camera, { width: 800, height: 600 });
    expect(rect.x).toBeCloseTo(-50);
    expect(rect.y).toBeCloseTo(-25);
    expect(rect.width).toBeCloseTo(400);
    expect(rect.height).toBeCloseTo(300);
  });

  it("shrinks the world rect as scale increases (zooming in narrows the view)", () => {
    const viewportSize = { width: 800, height: 600 };
    const zoomedOut = computeViewportWorldRect({ x: 0, y: 0, scale: 1 }, viewportSize);
    const zoomedIn = computeViewportWorldRect({ x: 0, y: 0, scale: 2 }, viewportSize);
    expect(zoomedIn.width).toBeLessThan(zoomedOut.width);
    expect(zoomedIn.height).toBeLessThan(zoomedOut.height);
  });
});
