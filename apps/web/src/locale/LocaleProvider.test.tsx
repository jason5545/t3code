// @vitest-environment jsdom

import { act, memo } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { LanguageSettings } from "../components/settings/LanguageSettings";
import { SettingsBreadcrumb } from "../components/settings/SettingsBreadcrumb";
import { LOCALE_STORAGE_KEY } from "./locale";
import { LocaleProvider, useLocale } from "./LocaleProvider";

let renderer: ReactTestRenderer | null = null;

const Probe = memo(function Probe() {
  const { locale, setLocale, t } = useLocale();
  return (
    <button onClick={() => setLocale(locale === "en" ? "zh-TW" : "en")}>{t("Settings")}</button>
  );
});

async function mountProbe() {
  await act(() => {
    renderer = create(
      <LocaleProvider>
        <Probe />
      </LocaleProvider>,
    );
  });
}

function button() {
  return renderer!.root.findByType("button");
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.lang = "en";
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(navigator, "language", "get").mockReturnValue("zh-TW");
  vi.spyOn(navigator, "languages", "get").mockReturnValue(["zh-TW", "en-US"]);
});

afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  document.documentElement.lang = "en";
});

describe("LocaleProvider", () => {
  it("updates a memoized consumer, document lang, and persisted selection without reloading", async () => {
    await mountProbe();
    expect(button().children).toEqual(["設定"]);
    expect(document.documentElement.lang).toBe("zh-TW");
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();

    await act(() => button().props.onClick());
    expect(button().children).toEqual(["Settings"]);
    expect(document.documentElement.lang).toBe("en");
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("en");

    await act(() => renderer!.unmount());
    renderer = null;
    await mountProbe();
    expect(button().children).toEqual(["Settings"]);
    expect(document.documentElement.lang).toBe("en");

    await act(() => button().props.onClick());
    expect(button().children).toEqual(["設定"]);
    expect(document.documentElement.lang).toBe("zh-TW");
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("zh-TW");
  });

  it("reacts to another window's selection and preference removal and removes its listener", async () => {
    const removeListener = vi.spyOn(window, "removeEventListener");
    await mountProbe();
    localStorage.setItem(LOCALE_STORAGE_KEY, "en");

    await act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "unrelated" }));
    });
    expect(button().children).toEqual(["設定"]);

    await act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: LOCALE_STORAGE_KEY }));
    });
    expect(button().children).toEqual(["Settings"]);
    expect(document.documentElement.lang).toBe("en");

    localStorage.clear();
    await act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: null }));
    });
    expect(button().children).toEqual(["設定"]);
    expect(document.documentElement.lang).toBe("zh-TW");

    await act(() => renderer!.unmount());
    renderer = null;
    expect(removeListener).toHaveBeenCalledWith("storage", expect.any(Function));
  });

  it("keeps an in-memory selection usable when storage is denied", async () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("blocked");
    });
    await mountProbe();
    expect(button().children).toEqual(["設定"]);

    await act(() => button().props.onClick());
    expect(button().children).toEqual(["Settings"]);
    expect(document.documentElement.lang).toBe("en");
  });

  it("renders settings navigation and the device-local language selector in zh-TW", () => {
    const translated = renderToStaticMarkup(
      <LocaleProvider>
        <SettingsBreadcrumb pathname="/settings/appearance" />
        <LanguageSettings />
      </LocaleProvider>,
    );
    expect(translated).toContain("設定");
    expect(translated).toContain("外觀");
    expect(translated).toContain('aria-label="設定導覽路徑"');
    expect(translated).toContain('id="interface-language"');
    expect(translated).toContain('aria-label="介面語言"');
    expect(translated).toContain("繁體中文（台灣）");

    const english = renderToStaticMarkup(<SettingsBreadcrumb pathname="/settings/appearance" />);
    expect(english).toContain("Settings");
    expect(english).toContain("Appearance");
    expect(english).not.toContain("外觀");
  });
});
