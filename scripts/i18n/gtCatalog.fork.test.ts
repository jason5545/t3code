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
