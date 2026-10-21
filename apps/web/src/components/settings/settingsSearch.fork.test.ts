import { describe, expect, it } from "vite-plus/test";

import { isTranslationKey, translate, type Translator } from "../../locale/locale";
import { zhTWMessages } from "../../locale/messages";

import {
  getSettingsSearchTargetScope,
  searchableSetting,
  searchSettings,
  SETTINGS_SEARCH_ITEMS,
  type SettingsSearchItem,
} from "./settingsSearch";

describe("localized settings catalog", () => {
  const t: Translator = (key, params) => translate("zh-TW", key, params);

  it.each([
    ["傳送快捷鍵", "send-shortcut"],
    ["外觀", "theme"],
    ["佈景主題", "theme"],
    ["  語言  ", "interface-language"],
    ["繁體中文", "interface-language"],
    ["Taiwan", "interface-language"],
    ["send shortcut", "send-shortcut"],
    ["appearance", "theme"],
    ["語言 English", "interface-language"],
  ])("finds %s while retaining English aliases", (query, id) => {
    expect(searchSettings(query, undefined, t).map((item) => item.id)).toContain(id);
  });

  it("preserves destination paths, stable anchors, and device-local scope", () => {
    expect(searchSettings("傳送快捷鍵", undefined, t)[0]).toMatchObject({
      id: "send-shortcut",
      title: "Send shortcut",
      to: "/settings/general",
    });
    expect(searchSettings("介面語言", undefined, t)[0]).toMatchObject({
      id: "interface-language",
      to: "/settings/general",
    });
    expect(searchableSetting("send-shortcut", t)).toEqual({
      id: "send-shortcut",
      title: "傳送快捷鍵",
    });
    expect(searchableSetting("interface-language", t)).toEqual({
      id: "interface-language",
      title: "介面語言",
    });
    expect(searchableSetting("send-shortcut").title).toBe("Send shortcut");
    expect(getSettingsSearchTargetScope("interface-language")?.scope).toBeNull();
    expect(searchSettings("   ", undefined, t)).toEqual([]);
  });

  it("falls back for unmapped headings without treating custom text as translation keys", () => {
    const customItem: SettingsSearchItem = {
      id: "custom-setting",
      title: "Custom device setting",
      to: "/settings/general",
    };
    expect(searchSettings("Custom device", [customItem], t)).toEqual([customItem]);
    expect(searchSettings("一般", [customItem], t)).toEqual([customItem]);
    expect(searchSettings("不存在的設定", [customItem], t)).toEqual([]);
  });

  it("covers General and Appearance catalog headings with Taiwan translations", () => {
    for (const item of SETTINGS_SEARCH_ITEMS) {
      if (item.to !== "/settings/general" && item.to !== "/settings/appearance") continue;
      expect(isTranslationKey(item.title), item.title).toBe(true);
      if (isTranslationKey(item.title)) {
        expect(zhTWMessages[item.title], item.title).toBeTruthy();
      }
    }
  });
});
