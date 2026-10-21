export type Locale = "en" | "zh-TW";
export const LOCALE_STORAGE_KEY = "t3code:interface-locale:v1";
export const LOCALE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "zh-TW", label: "繁體中文（台灣）" },
] as const;

export type LocaleStorage = Pick<Storage, "getItem" | "setItem">;

export function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "zh-TW";
}

/** Only Traditional Chinese language tags opt in; generic zh / zh-CN stay English. */
export function defaultLocale(language: string | undefined): Locale {
  return language && /^zh-(?:tw|hk|mo|hant)(?:-|$)/i.test(language) ? "zh-TW" : "en";
}

export function browserLocaleStorage(): LocaleStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function readLocalePreference(
  storage: LocaleStorage | undefined = browserLocaleStorage(),
  language: string | undefined = typeof navigator === "undefined"
    ? undefined
    : navigator.languages?.[0] || navigator.language,
): Locale {
  try {
    const saved = storage?.getItem(LOCALE_STORAGE_KEY);
    if (isLocale(saved)) return saved;
  } catch {
    // Private browsing and restricted Electron origins can block storage.
  }
  return defaultLocale(language);
}

/** Returns whether the selection was stored, so it survives a reload. */
export function persistLocalePreference(
  locale: Locale,
  storage: LocaleStorage | undefined = browserLocaleStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(LOCALE_STORAGE_KEY, locale);
    return true;
  } catch {
    // The in-memory selection remains usable even when persistence is denied.
    return false;
  }
}
