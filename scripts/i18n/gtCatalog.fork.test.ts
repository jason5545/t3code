// @effect-diagnostics nodeBuiltinImport:off - Compares the generator's output with the committed files.
import * as NodeFS from "node:fs";

import { expect, it } from "vite-plus/test";

import { buildGtCatalogs } from "./gtCatalog.ts";

// Fails after a sync in which upstream wrapped more text in gt-react: add the Chinese to
// `gtTranslations.json` or the catalog, then run `node scripts/i18n/gtCatalog.ts`.
it("gt-react's zh-TW catalogs cover every upstream string and are up to date", () => {
  for (const { file, contents, missing } of buildGtCatalogs()) {
    expect(missing, file).toEqual([]);
    expect(NodeFS.readFileSync(file, "utf8"), file).toBe(contents);
  }
});

// Mobile cannot import a catalog by name at run time, so `I18nProvider.tsx` lists each one. On
// 2026-11-12 zh-TW was a locale with a catalog file the list lacked, and its text stayed English.
it("the mobile provider loads the zh-TW catalog", () => {
  const provider = NodeFS.readFileSync(
    new URL("../../apps/mobile/src/i18n/I18nProvider.tsx", import.meta.url),
    "utf8",
  );
  expect(provider).toContain('import zhTW from "./translations/zh-TW.json";');
  expect(provider).toContain('"zh-TW": zhTW,');
});
