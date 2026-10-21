import { memo } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import { act, render } from "../../test/render";
import { LanguageSettings } from "../components/settings/LanguageSettings";
import { SettingsBreadcrumb } from "../components/settings/SettingsBreadcrumb";
import { LOCALE_STORAGE_KEY } from "./locale";
import { LocaleProvider, useLocale } from "./LocaleProvider";

const Probe = memo(function Probe() {
  const { locale, setLocale, t } = useLocale();
  return (
    <button onClick={() => setLocale(locale === "en" ? "zh-TW" : "en")}>{t("Settings")}</button>
  );
});

/** A zh-TW browser with empty storage, put back the way it was when the test ends. */
function zhTWBrowser(): Disposable {
  localStorage.clear();
  document.documentElement.lang = "en";
  const language = vi.spyOn(navigator, "language", "get").mockReturnValue("zh-TW");
  const languages = vi.spyOn(navigator, "languages", "get").mockReturnValue(["zh-TW", "en-US"]);
  return {
    [Symbol.dispose]() {
      language.mockRestore();
      languages.mockRestore();
      localStorage.clear();
      document.documentElement.lang = "en";
    },
  };
}

const renderProbe = (reload: () => void) =>
  render(
    <LocaleProvider reload={reload}>
      <Probe />
    </LocaleProvider>,
    { router: false },
  );

const buttonText = (container: HTMLElement) => container.querySelector("button")!.textContent;

const clickButton = (container: HTMLElement) =>
  act(() => container.querySelector("button")!.click());

describe("LocaleProvider", () => {
  it("updates a memoized consumer, document lang, and persisted selection, then reloads", async () => {
    using _browser = zhTWBrowser();
    const reload = vi.fn();
    {
      await using screen = await renderProbe(reload);
      expect(buttonText(screen.container)).toBe("設定");
      expect(document.documentElement.lang).toBe("zh-TW");
      expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();

      await clickButton(screen.container);
      expect(buttonText(screen.container)).toBe("Settings");
      expect(document.documentElement.lang).toBe("en");
      expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("en");
      expect(reload).toHaveBeenCalledTimes(1);
    }

    await using screen = await renderProbe(reload);
    expect(buttonText(screen.container)).toBe("Settings");
    expect(document.documentElement.lang).toBe("en");

    await clickButton(screen.container);
    expect(buttonText(screen.container)).toBe("設定");
    expect(document.documentElement.lang).toBe("zh-TW");
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("zh-TW");
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("reacts to another window's selection and preference removal and removes its listener", async () => {
    using _browser = zhTWBrowser();
    using removeListener = vi.spyOn(window, "removeEventListener");
    const reload = vi.fn();
    await using screen = await renderProbe(reload);
    localStorage.setItem(LOCALE_STORAGE_KEY, "en");

    await act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "unrelated" }));
    });
    expect(buttonText(screen.container)).toBe("設定");
    expect(reload).not.toHaveBeenCalled();

    await act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: LOCALE_STORAGE_KEY }));
    });
    expect(buttonText(screen.container)).toBe("Settings");
    expect(document.documentElement.lang).toBe("en");
    expect(reload).toHaveBeenCalledTimes(1);

    localStorage.clear();
    await act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: null }));
    });
    expect(buttonText(screen.container)).toBe("設定");
    expect(document.documentElement.lang).toBe("zh-TW");

    await screen.unmount();
    expect(removeListener).toHaveBeenCalledWith("storage", expect.any(Function));
  });

  it("keeps an in-memory selection usable when storage is denied", async () => {
    using _browser = zhTWBrowser();
    using _deniedStorage = vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("blocked");
    });
    const reload = vi.fn();
    await using screen = await renderProbe(reload);
    expect(buttonText(screen.container)).toBe("設定");

    await clickButton(screen.container);
    expect(buttonText(screen.container)).toBe("Settings");
    expect(document.documentElement.lang).toBe("en");
    expect(reload).not.toHaveBeenCalled();
  });

  it("renders settings navigation and the device-local language selector in zh-TW", async () => {
    using _browser = zhTWBrowser();
    {
      await using screen = await render(
        <LocaleProvider>
          <SettingsBreadcrumb pathname="/settings/appearance" />
          <LanguageSettings />
        </LocaleProvider>,
        { router: false },
      );
      const { container } = screen;
      expect(container.textContent).toContain("設定");
      expect(container.textContent).toContain("外觀");
      expect(container.querySelector('[aria-label="設定導覽路徑"]')).not.toBeNull();
      expect(container.querySelector("#interface-language")).not.toBeNull();
      expect(container.querySelector('[aria-label="介面語言"]')).not.toBeNull();
      expect(container.textContent).toContain("繁體中文（台灣）");
    }

    await using screen = await render(<SettingsBreadcrumb pathname="/settings/appearance" />, {
      router: false,
    });
    expect(screen.container.textContent).toContain("Settings");
    expect(screen.container.textContent).toContain("Appearance");
    expect(screen.container.textContent).not.toContain("外觀");
  });
});
