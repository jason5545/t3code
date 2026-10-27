import { describe, expect, it, vi } from "vite-plus/test";

// Settings titles are translated where they are declared, at build time; this runs that
// output with the zh-TW branch selected, as a Traditional Chinese device would.
vi.mock("../../locale/autoTranslateRuntime", () => {
  const join = (parts: ReadonlyArray<string | number>, values: ReadonlyArray<unknown>) =>
    parts.map((part) => (typeof part === "number" ? String(values[part]) : part)).join("");
  return {
    useChinese: true,
    __t3_t: (_english: string, chinese: string) => chinese,
    __t3_tf: (_english: unknown, chinese: ReadonlyArray<string | number>, values: unknown[]) =>
      join(chinese, values),
    __t3_tj: (_english: unknown, chinese: ReadonlyArray<string | number>, values: unknown[]) =>
      join(chinese, values),
  };
});

const { getSettingsSearchTargetScope, searchableSetting, searchSettings } =
  await import("./settingsSearch");

describe("settings search in zh-TW", () => {
  it.each([
    ["傳送快捷鍵", "send-shortcut"],
    ["外觀", "theme"],
    ["佈景主題", "theme"],
    ["  語言  ", "interface-language"],
    ["繁體中文", "interface-language"],
    ["Taiwan", "interface-language"],
    ["語言 English", "interface-language"],
  ])("finds %s", (query, id) => {
    expect(searchSettings(query).map((item) => item.id)).toContain(id);
  });

  it("keeps destination paths, stable anchors, and device-local scope", () => {
    expect(searchSettings("傳送快捷鍵")[0]).toMatchObject({
      id: "send-shortcut",
      title: "傳送快捷鍵",
      to: "/settings/chat",
    });
    expect(searchSettings("介面語言")[0]).toMatchObject({
      id: "interface-language",
      to: "/settings/general",
    });
    expect(searchableSetting("send-shortcut")).toEqual({
      id: "send-shortcut",
      title: "傳送快捷鍵",
    });
    expect(searchableSetting("interface-language")).toEqual({
      id: "interface-language",
      title: "介面語言",
    });
    expect(getSettingsSearchTargetScope("interface-language")?.scope).toBeNull();
    expect(searchSettings("   ")).toEqual([]);
  });
});
