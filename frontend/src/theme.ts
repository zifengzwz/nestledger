export const THEMES = [
  { id: "clay", name: "陶土暖棕", hint: "温润、安静", accent: "#bf572c", accentSoft: "#fff1e8" },
  { id: "forest", name: "森林青绿", hint: "清新、自然", accent: "#128654", accentSoft: "#e5faed" },
  { id: "blue", name: "雾蓝浅灰", hint: "冷静、清爽", accent: "#2379c8", accentSoft: "#e8f4ff" },
  { id: "plum", name: "烟紫暮色", hint: "柔和、沉静", accent: "#9a47ba", accentSoft: "#f6e9ff" },
  { id: "coral", name: "珊瑚橙", hint: "明快、有活力", accent: "#f05235", accentSoft: "#ffece7" },
  { id: "mango", name: "芒果黄", hint: "晴朗、醒目", accent: "#f6a400", accentSoft: "#fff4d6" },
  { id: "mint", name: "薄荷青", hint: "清爽、鲜亮", accent: "#00aa96", accentSoft: "#dffbf5" },
  { id: "berry", name: "莓果红", hint: "浓郁、俏皮", accent: "#e42879", accentSoft: "#ffe8f3" },
  { id: "contrast-ink", name: "高对比·黑白", hint: "纯白底，墨黑强调", accent: "#171717", accentSoft: "#e8e8e8" },
  { id: "contrast-navy", name: "高对比·海军蓝", hint: "纯白底，深蓝强调", accent: "#123969", accentSoft: "#e3edf9" },
  { id: "contrast-wine", name: "高对比·深酒红", hint: "纯白底，酒红强调", accent: "#731b37", accentSoft: "#f7e5ec" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];
export const DEFAULT_THEME: ThemeId = "clay";
export const THEME_STORAGE_KEY = "nestledger.theme";

const ids = THEMES.map((theme) => theme.id) as readonly string[];

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && ids.includes(value);
}

/** Apply a theme to <html data-theme>. Unknown values fall back to clay. */
export function applyTheme(value: unknown, root: HTMLElement = document.documentElement): ThemeId {
  const theme = isThemeId(value) ? value : DEFAULT_THEME;
  root.dataset.theme = theme;
  root.style.colorScheme = "light";
  const doc = root.ownerDocument;
  const icon = doc.querySelector<HTMLLinkElement>('link[rel="icon"][type="image/svg+xml"]');
  const accent = getComputedStyle(root).getPropertyValue('--accent-fill').trim()
    || THEMES.find((entry) => entry.id === theme)!.accent;
  if (icon) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="${accent}"/><g fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M24 45c-8-1-11-8-7-15 5-9 17-6 27-15 3 11 1 22-6 28-4 3-9 4-14 2Z"/><path d="M15 49c6-11 14-16 23-20"/></g></svg>`;
    icon.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }
  doc.querySelector('meta[name="theme-color"]')?.setAttribute('content', accent);
  return theme;
}

export function readStoredTheme(storage: Pick<Storage, "getItem"> | undefined = safeStorage()): ThemeId {
  try {
    const value = storage?.getItem(THEME_STORAGE_KEY);
    return isThemeId(value) ? value : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function storeTheme(value: unknown, storage: Pick<Storage, "setItem"> | undefined = safeStorage()) {
  if (!isThemeId(value) || !storage) return false;
  try {
    storage.setItem(THEME_STORAGE_KEY, value);
    return true;
  } catch {
    return false; // Private mode / quota: the theme still applies for this session.
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
