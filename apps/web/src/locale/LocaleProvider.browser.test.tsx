import { act, memo } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { LanguageSettings } from "../components/settings/LanguageSettings";
import { SettingsBreadcrumb } from "../components/settings/SettingsBreadcrumb";
import { LOCALE_STORAGE_KEY } from "./locale";
import { LocaleProvider, useLocale } from "./LocaleProvider";

let root: Root | null = null;
let container: HTMLDivElement;
const reload = vi.fn();

const Probe = memo(function Probe() {
  const { locale, setLocale, t } = useLocale();
  return (
    <button onClick={() => setLocale(locale === "en" ? "zh-TW" : "en")}>{t("Settings")}</button>
  );
});

async function render(element: React.ReactNode) {
  root = createRoot(container);
  await act(() => root!.render(element));
}

async function mountProbe() {
  await render(
    <LocaleProvider reload={reload}>
      <Probe />
    </LocaleProvider>,
  );
}

async function unmount() {
  await act(() => root?.unmount());
  root = null;
}

function button() {
  return container.querySelector("button")!;
}

function buttonText() {
  return [button().textContent];
}

async function clickButton() {
  await act(() => button().click());
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  reload.mockClear();
  localStorage.clear();
  document.documentElement.lang = "en";
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(navigator, "language", "get").mockReturnValue("zh-TW");
  vi.spyOn(navigator, "languages", "get").mockReturnValue(["zh-TW", "en-US"]);
});

afterEach(async () => {
  await unmount();
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  document.documentElement.lang = "en";
});

describe("LocaleProvider", () => {
  it("updates a memoized consumer, document lang, and persisted selection, then reloads", async () => {
    await mountProbe();
    expect(buttonText()).toEqual(["設定"]);
    expect(document.documentElement.lang).toBe("zh-TW");
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();

    await clickButton();
    expect(buttonText()).toEqual(["Settings"]);
    expect(document.documentElement.lang).toBe("en");
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("en");
    expect(reload).toHaveBeenCalledTimes(1);

    await unmount();
    await mountProbe();
    expect(buttonText()).toEqual(["Settings"]);
    expect(document.documentElement.lang).toBe("en");

    await clickButton();
    expect(buttonText()).toEqual(["設定"]);
    expect(document.documentElement.lang).toBe("zh-TW");
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("zh-TW");
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("reacts to another window's selection and preference removal and removes its listener", async () => {
    const removeListener = vi.spyOn(window, "removeEventListener");
    await mountProbe();
    localStorage.setItem(LOCALE_STORAGE_KEY, "en");

    await act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "unrelated" }));
    });
    expect(buttonText()).toEqual(["設定"]);
    expect(reload).not.toHaveBeenCalled();

    await act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: LOCALE_STORAGE_KEY }));
    });
    expect(buttonText()).toEqual(["Settings"]);
    expect(document.documentElement.lang).toBe("en");
    expect(reload).toHaveBeenCalledTimes(1);

    localStorage.clear();
    await act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: null }));
    });
    expect(buttonText()).toEqual(["設定"]);
    expect(document.documentElement.lang).toBe("zh-TW");

    await unmount();
    expect(removeListener).toHaveBeenCalledWith("storage", expect.any(Function));
  });

  it("keeps an in-memory selection usable when storage is denied", async () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("blocked");
    });
    await mountProbe();
    expect(buttonText()).toEqual(["設定"]);

    await clickButton();
    expect(buttonText()).toEqual(["Settings"]);
    expect(document.documentElement.lang).toBe("en");
    expect(reload).not.toHaveBeenCalled();
  });

  it("renders settings navigation and the device-local language selector in zh-TW", async () => {
    await render(
      <LocaleProvider>
        <SettingsBreadcrumb pathname="/settings/appearance" />
        <LanguageSettings />
      </LocaleProvider>,
    );
    expect(container.textContent).toContain("設定");
    expect(container.textContent).toContain("外觀");
    expect(container.querySelector('[aria-label="設定導覽路徑"]')).not.toBeNull();
    expect(container.querySelector("#interface-language")).not.toBeNull();
    expect(container.querySelector('[aria-label="介面語言"]')).not.toBeNull();
    expect(container.textContent).toContain("繁體中文（台灣）");
    await unmount();

    await render(<SettingsBreadcrumb pathname="/settings/appearance" />);
    expect(container.textContent).toContain("Settings");
    expect(container.textContent).toContain("Appearance");
    expect(container.textContent).not.toContain("外觀");
  });
});
