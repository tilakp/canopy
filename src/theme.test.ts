import { describe, expect, it, beforeEach } from "vitest";
import { getTheme, setTheme, initTheme } from "./theme";

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe("getTheme", () => {
  it("defaults to light when nothing is persisted", () => {
    expect(getTheme()).toBe("light");
  });

  it("returns whatever was persisted", () => {
    localStorage.setItem("canopy-theme", "dark");
    expect(getTheme()).toBe("dark");
  });

  it("treats any non-'dark' stored value as light", () => {
    localStorage.setItem("canopy-theme", "garbage");
    expect(getTheme()).toBe("light");
  });
});

describe("setTheme", () => {
  it("persists the theme and applies it to the document root", () => {
    setTheme("dark");
    expect(localStorage.getItem("canopy-theme")).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");

    setTheme("light");
    expect(localStorage.getItem("canopy-theme")).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});

describe("initTheme", () => {
  it("applies the persisted theme to the document root on startup", () => {
    localStorage.setItem("canopy-theme", "dark");
    initTheme();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("applies light by default", () => {
    initTheme();
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
