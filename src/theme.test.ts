import { describe, expect, it, beforeEach } from "vitest";
import { getTheme, getThemePref, setTheme, initTheme } from "./theme";

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

describe("the system theme", () => {
  function fakeSystem(dark: boolean) {
    window.matchMedia = ((query: string) => ({
      matches: dark && query.includes("dark"),
      addEventListener() {},
    })) as unknown as typeof window.matchMedia;
  }

  it("is the choice when nothing is persisted", () => {
    expect(getThemePref()).toBe("system");
  });

  it("follows the OS appearance", () => {
    fakeSystem(true);
    setTheme("system");
    expect(localStorage.getItem("canopy-theme")).toBe("system");
    expect(getTheme()).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    fakeSystem(false);
    expect(getTheme()).toBe("light");
    delete (window as { matchMedia?: unknown }).matchMedia;
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
