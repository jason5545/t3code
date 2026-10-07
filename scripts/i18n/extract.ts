/**
 * Lists interface text the zh-TW catalog does not cover yet, using the same
 * rules as the build plugin. Run after syncing upstream:
 *
 *   node scripts/i18n/extract.ts                 # summary
 *   node scripts/i18n/extract.ts --json out.json # missing keys with context
 *   node scripts/i18n/extract.ts --stale         # catalog keys no longer in source
 */
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const repoRoot = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "../..",
);
export const catalogFile = NodePath.join(repoRoot, "apps/web/src/locale/zh-TW.json");
export const untranslatedFile = NodePath.join(repoRoot, "scripts/i18n/untranslated.json");
export const translationRoots = [
  NodePath.join(repoRoot, "apps/web/src"),
  NodePath.join(repoRoot, "apps/mobile/src"),
  NodePath.join(repoRoot, "packages/client-runtime/src"),
];

const require = NodeModule.createRequire(import.meta.url);
// @babel/core is a peer of the web build's Babel plugin; borrow that copy.
const babelPluginDir = NodeFS.realpathSync(
  NodePath.join(repoRoot, "apps/web/node_modules/@rolldown/plugin-babel"),
);
const babel = NodeModule.createRequire(NodePath.join(babelPluginDir, "package.json"))(
  "@babel/core",
) as {
  transformSync(code: string, options: object): unknown;
};
const autoTranslate = require("./autoTranslate.cjs");

export interface Candidate {
  readonly key: string;
  readonly kinds: Set<string>;
  readonly files: Set<string>;
}

/** Strings that are identifiers, paths, or URLs rather than prose. */
export function isInterfaceText(key: string): boolean {
  if (!/[A-Za-z]{2,}/.test(key) || /^(?:https?:\/\/|--)/.test(key)) return false;
  if (/^[a-z0-9]+(?:-[a-z0-9]+){2,}$/.test(key)) return false;
  const bare = key.replace(/\{[^}]+\}/g, "");
  return /\s/.test(bare.trim()) || !/[/_.:@#=<>\\]|[a-z][A-Z]/.test(bare);
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of NodeFS.readdirSync(dir, { withFileTypes: true })) {
    const path = NodePath.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && !entry.name.startsWith(".")) sourceFiles(path, out);
    } else if (/\.[cm]?[jt]sx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      out.push(path);
    }
  }
  return out;
}

export function collectCandidates(roots = translationRoots): Map<string, Candidate> {
  const candidates = new Map<string, Candidate>();
  const onMessage = (message: { key: string; file: string; line: number; kind: string }) => {
    if (!isInterfaceText(message.key)) return;
    const candidate = candidates.get(message.key) ?? {
      key: message.key,
      kinds: new Set(),
      files: new Set(),
    };
    candidate.kinds.add(message.kind);
    candidate.files.add(`${NodePath.relative(repoRoot, message.file)}:${message.line}`);
    candidates.set(message.key, candidate);
  };
  for (const root of roots) {
    for (const file of sourceFiles(root)) {
      babel.transformSync(NodeFS.readFileSync(file, "utf8"), {
        filename: file,
        babelrc: false,
        configFile: false,
        code: false,
        parserOpts: { plugins: ["typescript", "jsx"] },
        plugins: [
          [
            autoTranslate,
            {
              roots,
              runtimeFile: NodePath.join(repoRoot, "apps/web/src/locale/autoTranslateRuntime.ts"),
              onMessage,
            },
          ],
        ],
      });
    }
  }
  return candidates;
}

export function readJson<T>(file: string, fallback: T): T {
  return NodeFS.existsSync(file) ? (JSON.parse(NodeFS.readFileSync(file, "utf8")) as T) : fallback;
}

function main() {
  const args = process.argv.slice(2);
  const catalog = readJson<Record<string, string>>(catalogFile, {});
  const keptEnglish = new Set(
    readJson<{ everywhere?: string[] }>(untranslatedFile, {}).everywhere ?? [],
  );
  const candidates = collectCandidates();
  if (args.includes("--stale")) {
    for (const key of Object.keys(catalog))
      if (!candidates.has(key)) console.log(JSON.stringify(key));
    return;
  }
  const missing = [...candidates.values()].filter(
    (candidate) => !Object.hasOwn(catalog, candidate.key) && !keptEnglish.has(candidate.key),
  );
  const translated = [...candidates.keys()].filter((key) => Object.hasOwn(catalog, key)).length;
  console.log(
    `candidates: ${candidates.size}, translated: ${translated}, kept English: ${keptEnglish.size}, missing: ${missing.length}`,
  );
  const jsonIndex = args.indexOf("--json");
  if (jsonIndex !== -1) {
    const rows = missing.map((candidate) => ({
      key: candidate.key,
      kinds: [...candidate.kinds],
      files: [...candidate.files].slice(0, 3),
    }));
    NodeFS.writeFileSync(args[jsonIndex + 1]!, `${JSON.stringify(rows, null, 2)}\n`);
  }
}

if (import.meta.url === NodeURL.pathToFileURL(process.argv[1] ?? "").href) main();
