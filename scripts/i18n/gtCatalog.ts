// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - A command-line generator run with node.
/**
 * Writes gt-react's zh-TW catalogs (`apps/{web,mobile}/src/i18n/translations/zh-TW.json`) from
 * upstream's `en.json`, which maps each string's hash to its English text. The Chinese comes
 * from `gtTranslations.json`, then from the build plugin's own catalog. Run after syncing
 * upstream; it exits 1 and lists the English text that has no Chinese yet.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { catalogFile } from "./extract.ts";

const repoRoot = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "../..",
);
const GT_APPS = ["web", "mobile"] as const;
const readJson = (file: string): Record<string, string> =>
  JSON.parse(NodeFS.readFileSync(file, "utf8"));
const translationsFile = (app: (typeof GT_APPS)[number], locale: string) =>
  NodePath.join(repoRoot, "apps", app, "src/i18n/translations", `${locale}.json`);

export function buildGtCatalogs() {
  const chinese = {
    ...readJson(catalogFile),
    ...readJson(NodePath.join(repoRoot, "scripts/i18n/gtTranslations.json")),
  };
  return GT_APPS.map((app) => {
    const missing: string[] = [];
    const catalog: Record<string, string> = {};
    for (const [hash, english] of Object.entries(readJson(translationsFile(app, "en")))) {
      const translated = chinese[english];
      if (translated === undefined) missing.push(english);
      else catalog[hash] = translated;
    }
    return {
      file: translationsFile(app, "zh-TW"),
      contents: `${JSON.stringify(catalog, null, 2)}\n`,
      missing,
    };
  });
}

function main() {
  let incomplete = false;
  for (const { file, contents, missing } of buildGtCatalogs()) {
    NodeFS.writeFileSync(file, contents);
    console.log(`${NodePath.relative(repoRoot, file)}: ${missing.length} missing`);
    for (const english of missing) console.log(`  ${JSON.stringify(english)}`);
    incomplete ||= missing.length > 0;
  }
  if (incomplete) process.exitCode = 1;
}

if (import.meta.url === NodeURL.pathToFileURL(process.argv[1] ?? "").href) main();
