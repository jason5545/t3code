import { describe, expect, it, vi, afterEach } from "vite-plus/test";
import { localeStorageListener, selectInterfaceLocale } from "./autoTranslateRuntime";
import {
  browserLocaleStorage,
  defaultLocale,
  isLocale,
  LOCALE_STORAGE_KEY,
  persistLocalePreference,
  readLocalePreference,
} from "./locale";
function memoryStorage() {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
  };
}

afterEach(() => vi.unstubAllGlobals());
describe("interface locale", () => {
  it.each(["zh-TW", "zh-tw", "zh-TW-u-nu-hanidec", "zh-Hant", "zh-Hant-TW", "zh-HK", "zh-MO"])(
    "defaults %s to Taiwan Traditional Chinese",
    (language) => {
      expect(defaultLocale(language)).toBe("zh-TW");
    },
  );
  it.each([undefined, "", "en-US", "ja", "zh", "zh-CN", "zh-Hans", "zh-TWhatever"])(
    "falls back to English for %s",
    (language) => {
      expect(defaultLocale(language)).toBe("en");
    },
  );
  it("persists an explicit selection and prefers it to navigator language", () => {
    const storage = memoryStorage();
    expect(readLocalePreference(storage, "zh-TW")).toBe("zh-TW");
    expect(storage.entries.size).toBe(0); // Browser default is not a saved user choice.
    persistLocalePreference("en", storage);
    expect(storage.entries.get(LOCALE_STORAGE_KEY)).toBe("en");
    expect(readLocalePreference(storage, "zh-TW")).toBe("en");
    persistLocalePreference("zh-TW", storage);
    expect(readLocalePreference(storage, "en-US")).toBe("zh-TW");
    expect(storage.entries.size).toBe(1);
  });
  it("ignores corrupt or unsupported saved preferences", () => {
    const storage = memoryStorage();
    for (const value of ["zh-CN", "zh-tw", '"en"', "invalid", ""]) {
      storage.setItem(LOCALE_STORAGE_KEY, value);
      expect(readLocalePreference(storage, "zh-TW")).toBe("zh-TW");
      expect(readLocalePreference(storage, "fr")).toBe("en");
    }
    expect(isLocale("zh-TW")).toBe(true);
    expect(isLocale("zh-CN")).toBe(false);
  });
  it("uses the browser's first preferred language and tolerates blocked storage", () => {
    vi.stubGlobal("navigator", { languages: ["zh-Hant-TW", "en-US"], language: "en-US" });
    vi.stubGlobal("window", {
      get localStorage() {
        throw new Error("blocked");
      },
    });
    expect(browserLocaleStorage()).toBeUndefined();
    expect(readLocalePreference()).toBe("zh-TW");
    expect(() => persistLocalePreference("en")).not.toThrow();
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readLocalePreference(blocked, "en-US")).toBe("en");
    expect(() => persistLocalePreference("zh-TW", blocked)).not.toThrow();
  });
  it("reloads for another window's stored change and ignores unrelated keys", () => {
    const storage = memoryStorage();
    vi.stubGlobal("window", { localStorage: storage });
    const reload = vi.fn();
    const onStorage = localeStorageListener("zh-TW", reload);
    storage.setItem(LOCALE_STORAGE_KEY, "en");
    onStorage({ key: "unrelated" });
    expect(reload).not.toHaveBeenCalled();
    onStorage({ key: LOCALE_STORAGE_KEY });
    expect(reload).toHaveBeenCalledTimes(1);
    storage.entries.clear();
    vi.stubGlobal("navigator", { languages: ["zh-TW"], language: "zh-TW" });
    onStorage({ key: null });
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it("applies a selection, reloading only for a stored change from the startup language", () => {
    const storage = memoryStorage();
    const documentElement = { lang: "en" };
    vi.stubGlobal("window", { localStorage: storage });
    vi.stubGlobal("document", { documentElement });
    const reload = vi.fn();
    const startup = readLocalePreference(storage, navigator.languages?.[0] || navigator.language);
    const other = startup === "en" ? "zh-TW" : "en";
    selectInterfaceLocale(startup, reload);
    expect(reload).not.toHaveBeenCalled();
    selectInterfaceLocale(other, reload);
    expect(documentElement.lang).toBe(other);
    expect(storage.entries.get(LOCALE_STORAGE_KEY)).toBe(other);
    expect(reload).toHaveBeenCalledTimes(1);
    vi.stubGlobal("window", {
      get localStorage() {
        throw new Error("blocked");
      },
    });
    selectInterfaceLocale(other, reload);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
