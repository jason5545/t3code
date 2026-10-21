import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

const locale = vi.hoisted(() => ({ chinese: false }));
vi.mock("~/locale/autoTranslateRuntime", () => ({
  get useChinese() {
    return locale.chinese;
  },
  __t3_t: (english: string, chinese: string) => (locale.chinese ? chinese : english),
}));

const { DraftHeroHeading } = await import("./DraftHeroHeading");

function renderHeading(chinese: boolean, projectSelector = <button type="button">Voco</button>) {
  locale.chinese = chinese;
  return renderToStaticMarkup(
    <DraftHeroHeading projectName="Voco">{projectSelector}</DraftHeroHeading>,
  );
}

describe("localized draft hero heading", () => {
  it("puts the Voco question around the picker without replacing it", () => {
    const html = renderHeading(true);
    expect(html).not.toContain("aria-label");
    expect(html).toContain(
      '想在 <span class="whitespace-nowrap"><button type="button">Voco</button> 做些什麼？</span>',
    );
    expect(html).not.toContain("What should we build");
  });

  it("keeps upstream's English heading and its picker", () => {
    const html = renderHeading(false);
    expect(html).toContain("What should we build");
    expect(html).toContain('<button type="button">Voco</button>');
    expect(html).not.toContain("想在");
  });

  it("preserves placeholder-like characters in project names", () => {
    const name = "Voco/{project}/<code>";
    const html = renderHeading(true, <button type="button">{name}</button>);
    expect(html).toContain("Voco/{project}/&lt;code&gt;</button>");
  });
});
