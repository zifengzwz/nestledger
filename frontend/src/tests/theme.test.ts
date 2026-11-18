import { afterEach, describe, expect, it, vi } from "vitest";
import { applyTheme, isThemeId, readStoredTheme, storeTheme, THEME_STORAGE_KEY, THEMES } from "../theme";

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
  vi.unstubAllGlobals();
  window.localStorage?.clear();
});

describe("theme tokens", () => {
  it("exposes eleven distinct themes", () => {
    expect(THEMES.map(theme => theme.id)).toEqual(["clay", "forest", "blue", "plum", "coral", "mango", "mint", "berry", "contrast-ink", "contrast-navy", "contrast-wine"]);
    expect(new Set(THEMES.map(theme => theme.accent)).size).toBe(11);
    expect(THEMES.every(theme => /^#[0-9a-f]{6}$/i.test(theme.accent))).toBe(true);
  });
  it("applies valid ids to the html element", () => {
    expect(applyTheme("forest")).toBe("forest");
    expect(document.documentElement.dataset.theme).toBe("forest");
    expect(applyTheme("plum")).toBe("plum");
    expect(document.documentElement.dataset.theme).toBe("plum");
  });
  it("falls back to clay for unknown or hostile values", () => {
    for (const value of ["", "nope", "constructor", "__proto__", null, undefined, 42, {}]) {
      expect(applyTheme(value)).toBe("clay");
      expect(document.documentElement.dataset.theme).toBe("clay");
    }
  });
  it("validates ids strictly", () => {
    expect(isThemeId("blue")).toBe(true);
    expect(isThemeId("Blue")).toBe(false);
    expect(isThemeId("toString")).toBe(false);
    expect(isThemeId(1)).toBe(false);
  });
  it("reads and stores the preference, ignoring corrupt data", () => {
    expect(readStoredTheme()).toBe("clay");
    expect(storeTheme("blue")).toBe(true);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("blue");
    expect(readStoredTheme()).toBe("blue");
    localStorage.setItem(THEME_STORAGE_KEY, "{broken");
    expect(readStoredTheme()).toBe("clay");
    expect(storeTheme("invalid")).toBe(false);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("{broken");
  });
  it("keeps working when storage is unavailable", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(readStoredTheme()).toBe("clay");
    expect(storeTheme("forest")).toBe(false);
    expect(applyTheme("forest")).toBe("forest");
  });
  it("does not throw when the storage getter itself throws", () => {
    const getter = () => { throw new Error("SecurityError"); };
    const storage = {
      getItem: () => { getter(); return null; },
      setItem: () => { getter(); },
    };
    expect(readStoredTheme(storage as unknown as Storage)).toBe("clay");
    expect(storeTheme("plum", storage as unknown as Storage)).toBe(false);
  });
});
