import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  isLocale,
  LOCALE_STORAGE_KEY,
  persistLocalePreference,
  readLocalePreference,
  translate,
  type Locale,
  type Translator,
} from "./locale";

interface LocaleContextValue {
  readonly locale: Locale;
  readonly setLocale: (locale: Locale) => void;
  readonly t: Translator;
}

// Isolated components / server-rendered tests keep their existing English text.
const LocaleContext = createContext<LocaleContextValue>({
  locale: "en",
  setLocale: () => {},
  t: (key, params) => translate("en", key, params),
});

const reloadPage = () => window.location.reload();

/**
 * Most interface text is translated at build time with the locale read at
 * startup, so a stored change reloads the page instead of mixing languages.
 */
export function LocaleProvider({
  children,
  reload = reloadPage,
}: {
  readonly children: ReactNode;
  readonly reload?: () => void;
}) {
  const [locale, updateLocale] = useState<Locale>(() => readLocalePreference());
  const [startupLocale] = useState(locale);
  const setLocale = (next: Locale) => {
    if (!isLocale(next)) return;
    updateLocale(next);
    if (persistLocalePreference(next) && next !== startupLocale) reload();
  };

  useEffect(() => {
    if (typeof document !== "undefined") document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== LOCALE_STORAGE_KEY) return;
      const next = readLocalePreference();
      updateLocale(next);
      if (next !== startupLocale) reload();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [reload, startupLocale]);

  const value: LocaleContextValue = {
    locale,
    setLocale,
    t: (key, params) => translate(locale, key, params),
  };

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  return useContext(LocaleContext);
}
