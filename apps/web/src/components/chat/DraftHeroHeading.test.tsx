import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";
import { LocaleProvider } from "~/locale/LocaleProvider";
import { LOCALE_STORAGE_KEY, translate } from "~/locale/locale";
import { DraftHeroHeading } from "./DraftHeroHeading";
afterEach(() => vi.unstubAllGlobals());
function renderHeading(
  locale: "en" | "zh-TW",
  overrides: Partial<Parameters<typeof DraftHeroHeading>[0]> = {},
) {
  vi.stubGlobal("window", {
    localStorage: { getItem: (key: string) => (key === LOCALE_STORAGE_KEY ? locale : null) },
  });
  return renderToStaticMarkup(
    <LocaleProvider>
      <DraftHeroHeading
        isScratchDraft={false}
        hasResolvedProject
        canChooseProject
        projectName="Voco"
        projectSelector={<button type="button">Voco</button>}
        {...overrides}
      />
    </LocaleProvider>,
  );
}

describe("localized draft hero heading", () => {
  it("translates the Voco question without replacing the picker", () => {
    const html = renderHeading("zh-TW");
    expect(html).not.toContain("aria-label");
    expect(html).toContain(
      '想在 <span class="whitespace-nowrap"><button type="button">Voco</button> 做些什麼？</span>',
    );
    expect(html).not.toContain("What should we build");
    expect(translate("zh-TW", "or start without a project")).toBe("或直接開始，不選專案");
  });
  it("keeps upstream's English heading and its picker", () => {
    const html = renderHeading("en");
    expect(html).toContain("What should we build");
    expect(html).toContain('<button type="button">Voco</button>');
    expect(html).not.toContain("想在");
    expect(translate("en", "or start without a project")).toBe("or start without a project");
  });
  it("localizes the scratch-project heading", () => {
    const html = renderHeading("zh-TW", { isScratchDraft: true });
    expect(html).toContain("想做些什麼？");
    expect(html).not.toContain("Voco");
  });
  it("localizes the project-selection state", () => {
    const html = renderHeading("zh-TW", { hasResolvedProject: false });
    expect(html).toContain('選擇 <span><button type="button">Voco</button> 開始</span>');
  });
  it("localizes the no-project first-run state", () => {
    const html = renderHeading("zh-TW", { hasResolvedProject: false, canChooseProject: false });
    expect(html).toContain("新增專案後開始");
    expect(html).not.toContain("<button");
  });
  it("preserves placeholder-like characters in project names", () => {
    const name = "Voco/{project}/<code>";
    const html = renderHeading("zh-TW", {
      projectSelector: <button type="button">{name}</button>,
    });
    expect(html).toContain("Voco/{project}/&lt;code&gt;</button>");
  });
  it("covers project menu and fallback labels", () => {
    expect(translate("zh-TW", "No project")).toBe("無專案");
    expect(translate("zh-TW", "Choose a project")).toBe("選擇專案");
    expect(translate("zh-TW", "Add project")).toBe("新增專案");
    expect(translate("zh-TW", "Add a project")).toBe("新增專案");
  });
});
