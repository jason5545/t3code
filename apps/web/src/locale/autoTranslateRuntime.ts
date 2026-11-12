import { withChineseChangeRequestTerms } from "@t3tools/client-runtime/changeRequestTermText";
import { setChineseProviderOptionLabels } from "@t3tools/client-runtime/providerStatusMessages";
import { setChineseDurations } from "@t3tools/shared/durationFormat";
import { createElement, Fragment, type ReactNode } from "react";

import { type Locale, LOCALE_STORAGE_KEY, readLocalePreference } from "./locale";

/**
 * Called by code that `scripts/i18n/autoTranslate.cjs` rewrites at build time.
 * The locale is read once at startup; changing it reloads the page.
 */
export const startupLocale = readLocalePreference();
export const useChinese = startupLocale === "zh-TW";
// Durations from @t3tools/shared and option labels built in client-runtime follow the same choice.
setChineseDurations(useChinese);
setChineseProviderOptionLabels(useChinese);

/** Reloads when a stored choice differs from the language this page was built in. */
export function localeStorageListener(startup: Locale, reload: () => void) {
  return (event: Pick<StorageEvent, "key">) => {
    if (event.key !== null && event.key !== LOCALE_STORAGE_KEY) return;
    if (readLocalePreference() !== startup) reload();
  };
}

// Every translated module imports this file, so the page's language is set up here
// rather than in a provider: the document names it, and other windows follow a change.
// Unit tests stub `document` without a root element.
if (typeof document !== "undefined" && document.documentElement) {
  document.documentElement.lang = startupLocale;
}
if (typeof window !== "undefined") {
  window.addEventListener(
    "storage",
    localeStorageListener(startupLocale, () => window.location.reload()),
  );
}

/** Template parts: literal text, or an index into the values array. */
type Parts = ReadonlyArray<string | number>;

export function __t3_t(english: string, chinese: string): string {
  return useChinese ? chinese : english;
}

export function __t3_tf(english: Parts, chinese: Parts, values: ReadonlyArray<unknown>): string {
  let text = "";
  for (const part of useChinese ? withChineseChangeRequestTerms(chinese, values) : english) {
    text += typeof part === "number" ? String(values[part]) : part;
  }
  return text;
}

export function __t3_tj(
  english: Parts,
  chinese: Parts,
  values: ReadonlyArray<ReactNode>,
): ReactNode {
  const parts = useChinese ? withChineseChangeRequestTerms(chinese, values) : english;
  return createElement(
    Fragment,
    null,
    ...parts.map((part) => (typeof part === "number" ? values[part] : part)),
  );
}
