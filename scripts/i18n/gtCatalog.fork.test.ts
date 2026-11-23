// @effect-diagnostics nodeBuiltinImport:off - Compares the generator's output with the committed files.
import * as NodeFS from "node:fs";

import { expect, it } from "vite-plus/test";

import { buildGtCatalogs, collectStrings } from "./gtCatalog.ts";

// Fails after a sync in which upstream wrapped more text in gt-react: add the Chinese to
// `gtTranslations.json` or the catalog, then run `node scripts/i18n/gtCatalog.ts`.
it("gt-react's zh-TW catalogs cover every upstream string and are up to date", () => {
  for (const { file, contents, missing } of buildGtCatalogs()) {
    expect(missing, file).toEqual([]);
    expect(JSON.parse(NodeFS.readFileSync(file, "utf8")), file).toEqual(JSON.parse(contents));
  }
});

// Mobile cannot import a catalog by name at run time, so `I18nProvider.tsx` lists each one. On
// 2026-11-12 zh-TW was a locale with a catalog file the list lacked, and its text stayed English.
it("the mobile provider loads the zh-TW catalog", () => {
  const provider = NodeFS.readFileSync(
    new URL("../../apps/mobile/src/i18n/I18nProvider.tsx", import.meta.url),
    "utf8",
  );
  expect(provider).toContain('"zh-TW": () => require("./translations/zh-TW.json"),');
});

// Until 2026-11-23 the desktop main process had no zh-TW catalog, so its dialogs and menus
// stayed English under Traditional Chinese.
it("the desktop main process loads the zh-TW catalog", () => {
  const messages = NodeFS.readFileSync(
    new URL("../../apps/desktop/src/i18n/messages.ts", import.meta.url),
    "utf8",
  );
  expect(messages).toContain('"zh-TW": () => import("./translations/zh-TW.json"');
});

// A plural or branch element keeps its text in `d.b`, not `c`. `--fill` skipped it, so the
// mobile catalog shipped 已打开 1 个标签页 in Simplified script.
it("--fill converts the text inside plural branches", () => {
  const strings: string[] = [];
  collectStrings(
    {
      t: "Plural",
      i: 1,
      d: {
        b: {
          singular: "已打开 1 个标签页",
          other: { t: "C2", i: 2, c: [{ i: 3, k: "_gt_value_3", v: "v" }, " 个标签页"] },
        },
        t: "p",
      },
    },
    strings,
  );
  expect(strings).toEqual(["已打开 1 个标签页", " 个标签页"]);
});
