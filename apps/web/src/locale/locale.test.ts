import { describe, expect, it, vi, afterEach } from "vite-plus/test";
import {
  browserLocaleStorage,
  defaultLocale,
  isLocale,
  isTranslationKey,
  LOCALE_STORAGE_KEY,
  persistLocalePreference,
  readLocalePreference,
  translate,
} from "./locale";
import { englishMessageKeys, zhTWMessages } from "./messages";
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
  it("falls back per key and interpolates without rewriting parameter content", () => {
    expect(translate("zh-TW", "Settings")).toBe("設定");
    expect(translate("en", "Settings")).toBe("Settings");
    expect(translate("zh-TW", "New thread ({shortcut})", { shortcut: "⌘N" }, {})).toBe(
      "New thread (⌘N)",
    );
    expect(translate("zh-TW", "Working ({count})", { count: 0 })).toBe("進行中（0）");
    expect(
      translate("zh-TW", "No threads in {project} yet", { project: "Settings/<code>/{count}" }),
    ).toBe("Settings/<code>/{count} 尚無對話");
    expect(translate("en", "Working ({count})")).toBe("Working ({count})");
    expect(isTranslationKey("Settings")).toBe(true);
    expect(isTranslationKey("user chat text")).toBe(false);
  });
  it("covers every declared UI key with matching interpolation placeholders", () => {
    expect(new Set(englishMessageKeys).size).toBe(englishMessageKeys.length);
    expect(Object.keys(zhTWMessages).sort()).toEqual([...englishMessageKeys].sort());
    const placeholders = (text: string) =>
      [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    for (const key of englishMessageKeys) {
      const value = zhTWMessages[key];
      expect(value.trim(), key).not.toBe("");
      expect(placeholders(value), key).toEqual(placeholders(key));
    }
  });
});
