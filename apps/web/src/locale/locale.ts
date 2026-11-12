import { resolveLocale, SYSTEM_LANGUAGE } from "@t3tools/client-runtime/locales";

import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "../i18n/locales";

export type Locale = "en" | "zh-TW";
/** A copy of the locale the Language setting last resolved to, readable before settings load. */
export const LOCALE_STORAGE_KEY = "t3code:interface-locale:v1";
export const LOCALE_MIGRATED_KEY = "t3code:interface-locale:migrated:v1";

export type LocaleStorage = Pick<Storage, "getItem" | "setItem">;

export function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "zh-TW";
}

/** Only Traditional Chinese language tags opt in; generic zh / zh-CN stay English. */
export function defaultLocale(language: string | undefined): Locale {
  return language && /^zh-(?:tw|hk|mo|hant)(?:-|$)/i.test(language) ? "zh-TW" : "en";
}

/** The build-time translations' locale for a Language setting: Chinese only for zh-TW. */
export function translatedLocale(language: string, systemLocales: ReadonlyArray<string>): Locale {
  return resolveLocale(language, systemLocales, SUPPORTED_LOCALES, DEFAULT_LOCALE) === "zh-TW"
    ? "zh-TW"
    : "en";
}

/**
 * The Language setting for a device that used the fork's own selector: its saved Chinese
 * choice, or System default where the device's language made the interface Chinese unasked.
 * Null leaves the setting alone.
 */
export function migratedLanguage(saved: string | null, language: string | undefined) {
  if (saved === "zh-TW") return "zh-TW";
  return saved === null && defaultLocale(language) === "zh-TW" ? SYSTEM_LANGUAGE : null;
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
