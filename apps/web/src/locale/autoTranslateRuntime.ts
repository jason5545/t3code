import { createElement, Fragment, type ReactNode } from "react";

import { readLocalePreference } from "./locale";

/**
 * Called by code that `scripts/i18n/autoTranslate.cjs` rewrites at build time.
 * The locale is read once at startup; changing it reloads the page.
 */
export const useChinese = readLocalePreference() === "zh-TW";

/** Template parts: literal text, or an index into the values array. */
type Parts = ReadonlyArray<string | number>;

export function __t3_t(english: string, chinese: string): string {
  return useChinese ? chinese : english;
}

export function __t3_tf(english: Parts, chinese: Parts, values: ReadonlyArray<unknown>): string {
  let text = "";
  for (const part of useChinese ? chinese : english) {
    text += typeof part === "number" ? String(values[part]) : part;
  }
  return text;
}

export function __t3_tj(
  english: Parts,
  chinese: Parts,
  values: ReadonlyArray<ReactNode>,
): ReactNode {
  const parts = useChinese ? chinese : english;
  return createElement(
    Fragment,
    null,
    ...parts.map((part) => (typeof part === "number" ? values[part] : part)),
  );
}
