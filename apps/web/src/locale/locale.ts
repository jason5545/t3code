import { englishMessageKeys, zhTWMessages, type TranslationKey } from "./messages";

export type Locale = "en" | "zh-TW";
export const LOCALE_STORAGE_KEY = "t3code:interface-locale:v1";
export const LOCALE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "zh-TW", label: "繁體中文（台灣）" },
] as const;

export type TranslationParams = Readonly<Record<string, string | number>>;
export type Translator = (key: TranslationKey, params?: TranslationParams) => string;
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

export function persistLocalePreference(
  locale: Locale,
  storage: LocaleStorage | undefined = browserLocaleStorage(),
): void {
  try {
    storage?.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // The in-memory selection remains usable even when persistence is denied.
  }
}

export function translate(
  locale: Locale,
  key: TranslationKey,
  params: TranslationParams = {},
  translations: Partial<Record<TranslationKey, string>> = zhTWMessages,
): string {
  const template = locale === "zh-TW" ? (translations[key] ?? key) : key;
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : placeholder,
  );
}

const keySet: ReadonlySet<string> = new Set(englishMessageKeys);
export function isTranslationKey(value: string): value is TranslationKey {
  return keySet.has(value);
}
