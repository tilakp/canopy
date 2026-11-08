import { beforeEach, describe, expect, it, vi } from "vitest";
import { getViewPrefs, onViewChange, setViewPref } from "./prefs";

beforeEach(() => localStorage.clear());

describe("view prefs", () => {
  it("defaults to curved lines, no hand-drawn style, the dot grid on and the minimap off", () => {
    expect(getViewPrefs()).toEqual({ edgeStyle: "curved", sketchy: false, grid: true, minimap: false });
  });

  it("persists a change and tells every listener", () => {
    const listener = vi.fn();
    const stop = onViewChange(listener);
    setViewPref("edgeStyle", "straight");
    setViewPref("minimap", true);
    expect(getViewPrefs()).toMatchObject({ edgeStyle: "straight", minimap: true, grid: true });
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    setViewPref("grid", false);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("falls back to the defaults for stored values it does not understand", () => {
    localStorage.setItem("canopy-view", '{"edgeStyle":"zigzag","grid":"yes"}');
    expect(getViewPrefs()).toEqual({ edgeStyle: "curved", sketchy: false, grid: true, minimap: false });
    localStorage.setItem("canopy-view", "not json");
    expect(getViewPrefs().grid).toBe(true);
  });
});
