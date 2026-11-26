// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - A command-line generator run with node.
/**
 * Writes gt-react's zh-TW catalogs from upstream's `en.json` and the fork's translation files.
 * `--fill` drafts missing entries from upstream's `zh` into `gtTranslations.pending.json`, which no
 * catalog reads; `--accept` moves them in once each has been read against its English.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { catalogFile } from "./extract.ts";
import { mainlandWording, toTaiwanWording } from "./zhTwWording.ts";

type GtEntry = string | ReadonlyArray<unknown>;

const repoRoot = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "../..",
);
const GT_APPS = ["web", "mobile", "desktop"] as const;
const gtTranslationsFile = NodePath.join(repoRoot, "scripts/i18n/gtTranslations.json");
/** Chinese for one gt hash (or `<app>:<hash>`), where the same English means different things. */
export const gtByHashFile = NodePath.join(repoRoot, "scripts/i18n/gtTranslationsByHash.json");
export const gtPendingFile = NodePath.join(repoRoot, "scripts/i18n/gtTranslations.pending.json");
const readJson = <T>(file: string): T => JSON.parse(NodeFS.readFileSync(file, "utf8")) as T;
const translationsFile = (app: (typeof GT_APPS)[number], locale: string) =>
  NodePath.join(repoRoot, "apps", app, "src/i18n/translations", `${locale}.json`);
const entryKey = (english: GtEntry) =>
  typeof english === "string" ? english : JSON.stringify(english);

const placeholders = (text: string) =>
  [...text.matchAll(/\{([^{},\s]+)/g)].map((match) => match[1]).toSorted();
const samePlaceholders = (english: string, chinese: string) =>
  JSON.stringify(placeholders(english)) === JSON.stringify(placeholders(chinese));

/** The fork's words where OpenCC's Taiwan vocabulary differs from the interface's. */
const TERMS: ReadonlyArray<readonly [RegExp, string]> = [
  [/會話/g, "對話"],
  [/子智慧體/g, "子代理程式"],
  [/智慧體/g, "代理程式"],
  [/提供方/g, "供應商"],
  [/提供商/g, "供應商"],
  [/許可權/g, "權限"],
  [/後臺/g, "背景"],
  [/高階/g, "進階"],
  [/倉庫/g, "存放庫"],
  [/本地/g, "本機"],
  [/改動/g, "變更"],
  [/二維碼/g, "QR Code"],
  [/命令/g, "指令"],
  [/匹配/g, "符合"],
  [/收尾/g, "結束"],
  [/定時任務/g, "排程工作"],
  [/移動客戶端/g, "行動用戶端"],
  [/客戶端/g, "用戶端"],
  [/重置/g, "重設"],
  [/視口/g, "檢視區"],
  [/貯藏/g, "貯存"],
  [/歸檔/g, "封存"],
  [/取消置頂/g, "取消釘選"],
  [/置頂/g, "釘選"],
  [/快捷鍵/g, "快速鍵"],
  [/克隆/g, "複製"],
  [/擴充套件/g, "擴充功能"],
  [/終端(?!機)/g, "終端機"],
  [/稍後提醒/g, "延後"],
  [/此應用/g, "此 App"],
  [/配置/g, "設定"],
  [/箇/g, "個"],
  [/賬戶|賬號/g, "帳號"],
  [/文本/g, "文字"],
  [/暫緩/g, "延後"],
  [/獲取/g, "取得"],
  [/發送/g, "傳送"],
  [/身份/g, "身分"],
  [/評論/g, "留言"],
  [/分配/g, "指派"],
  [/基準分支/g, "基礎分支"],
  [/收藏/g, "最愛"],
  [/編排/g, "協調"],
  [/外殼/g, "shell"],
  [/用戶(?!端)/g, "使用者"],
  [/登錄/g, "登入"],
  [/打開/g, "開啟"],
  [/創建/g, "建立"],
  [/運行/g, "執行"],
  [/添加/g, "新增"],
  [/訪問/g, "存取"],
  [/地址/g, "位址"],
  [/包管理器/g, "套件管理器"],
  [/鑰匙串/g, "鑰匙圈"],
  [/新建/g, "新增"],
  [/程式碼塊/g, "程式碼區塊"],
  [/已排隊/g, "已排入佇列"],
  [/排隊/g, "佇列"],
  [/任務/g, "工作"],
  [/工作流(?!程)/g, "工作流程"],
  [/通過(?=\s?[A-Za-z{]|中繼)/g, "透過"],
  [/計算機/g, "電腦"],
  [/郵箱/g, "信箱"],
  [/模板/g, "範本"],
  [/搜索/g, "搜尋"],
  [/彈窗/g, "彈出視窗"],
  [/標籤頁/g, "分頁"],
  [/重啟/g, "重新啟動"],
  [/單擊/g, "按一下"],
  [/雙擊/g, "按兩下"],
  [/計劃/g, "計畫"],
  [/全屏/g, "全螢幕"],
  [/共享與存取/g, "共用與存取"],
  [/側聊/g, "側邊對話"],
  [/“/g, "「"],
  [/”/g, "」"],
  [/‘/g, "『"],
  [/’/g, "』"],
];

const applyTerms = (text: string) =>
  TERMS.reduce((result, [pattern, replacement]) => result.replace(pattern, replacement), text);

/** Every string inside a JSX entry, in order, so one OpenCC run converts them all. */
type JsxElement = {
  readonly c?: unknown;
  readonly d?: { readonly b?: Readonly<Record<string, unknown>> };
};

/** Plural and branch elements keep their text in `d.b`, other elements in `c`. */
export function collectStrings(entry: unknown, into: string[]): void {
  if (typeof entry === "string") into.push(entry);
  else if (Array.isArray(entry)) for (const part of entry) collectStrings(part, into);
  else if (entry !== null && typeof entry === "object") {
    const { c, d } = entry as JsxElement;
    for (const branch of Object.values(d?.b ?? {})) collectStrings(branch, into);
    if (c !== undefined) collectStrings(c, into);
  }
}

function replaceStrings(entry: unknown, next: () => string): unknown {
  if (typeof entry === "string") return next();
  if (Array.isArray(entry)) return entry.map((part) => replaceStrings(part, next));
  if (entry !== null && typeof entry === "object") {
    const element = entry as JsxElement;
    const d =
      element.d?.b === undefined
        ? element.d
        : {
            ...element.d,
            b: Object.fromEntries(
              Object.entries(element.d.b).map(([name, branch]) => [
                name,
                replaceStrings(branch, next),
              ]),
            ),
          };
    const c = element.c === undefined ? undefined : replaceStrings(element.c, next);
    return {
      ...entry,
      ...(d === undefined ? {} : { d }),
      ...(c === undefined ? {} : { c }),
    };
  }
  return entry;
}

function toTaiwanChinese(entries: ReadonlyArray<unknown>): ReadonlyArray<unknown> {
  const strings: string[] = [];
  for (const entry of entries) collectStrings(entry, strings);
  const converted = NodeChildProcess.execFileSync("opencc", ["-c", "s2twp"], {
    input: strings.map((text) => JSON.stringify(text)).join("\n"),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\n")
    .slice(0, strings.length)
    .map((line) => toTaiwanWording(applyTerms(JSON.parse(line) as string)));
  let index = 0;
  return entries.map((entry) => replaceStrings(entry, () => converted[index++] ?? ""));
}

export function buildGtCatalogs() {
  const forkCatalog = readJson<Record<string, string>>(catalogFile);
  const gtTranslations = readJson<Record<string, GtEntry>>(gtTranslationsFile);
  const byHash = readJson<Record<string, GtEntry>>(gtByHashFile);
  const translate = (app: string, english: GtEntry, hash: string): GtEntry | undefined => {
    const contextual = byHash[`${app}:${hash}`] ?? byHash[hash];
    if (contextual !== undefined) return contextual;
    const explicit = gtTranslations[entryKey(english)];
    if (explicit !== undefined) return explicit;
    if (typeof english !== "string") return undefined;
    const fork = forkCatalog[english];
    return fork !== undefined && samePlaceholders(english, fork) ? fork : undefined;
  };
  return GT_APPS.map((app) => {
    const missing: GtEntry[] = [];
    const missingHashes: string[] = [];
    const catalog: Record<string, GtEntry> = {};
    for (const [hash, english] of Object.entries(
      readJson<Record<string, GtEntry>>(translationsFile(app, "en")),
    )) {
      const translated = translate(app, english, hash);
      if (translated === undefined) {
        missing.push(english);
        missingHashes.push(hash);
      } else catalog[hash] = translated;
    }
    return {
      app,
      file: translationsFile(app, "zh-TW"),
      contents: `${JSON.stringify(catalog, null, 2)}\n`,
      missing,
      missingHashes,
    };
  });
}

function fill() {
  const drafts = NodeFS.existsSync(gtPendingFile)
    ? readJson<Record<string, GtEntry>>(gtPendingFile)
    : {};
  const pending = new Map<string, unknown>();
  for (const { app, missing, missingHashes } of buildGtCatalogs()) {
    const simplified = readJson<Record<string, unknown>>(translationsFile(app, "zh"));
    missing.forEach((english, index) => {
      const source = simplified[missingHashes[index] ?? ""];
      if (source !== undefined && !(entryKey(english) in drafts))
        pending.set(entryKey(english), source);
    });
  }
  const converted = toTaiwanChinese([...pending.values()]);
  [...pending.keys()].forEach((key, index) => {
    drafts[key] = converted[index] as GtEntry;
  });
  NodeFS.writeFileSync(gtPendingFile, `${JSON.stringify(drafts, null, 2)}\n`);
  console.log(
    `gtTranslations.pending.json: ${pending.size} drafted from upstream's zh; read each one before --accept`,
  );
}

/** Moves the reviewed drafts into `gtTranslations.json`, refusing any that still read as mainland. */
function accept() {
  const drafts = readJson<Record<string, GtEntry>>(gtPendingFile);
  const gtTranslations = readJson<Record<string, GtEntry>>(gtTranslationsFile);
  const refused = Object.entries(drafts).flatMap(([english, chinese]) => {
    const strings: string[] = [];
    collectStrings(chinese, strings);
    const words = mainlandWording(strings.join("\n"));
    return words.length > 0 ? [`  ${JSON.stringify(english)}: ${words.join(", ")}`] : [];
  });
  if (refused.length > 0) {
    console.log(`gtTranslations.pending.json: ${refused.length} drafts still use mainland wording`);
    for (const line of refused) console.log(line);
    process.exit(1);
  }
  Object.assign(gtTranslations, drafts);
  NodeFS.writeFileSync(gtTranslationsFile, `${JSON.stringify(gtTranslations, null, 2)}\n`);
  NodeFS.rmSync(gtPendingFile);
  console.log(`gtTranslations.json: ${Object.keys(drafts).length} reviewed drafts accepted`);
}

function main() {
  if (process.argv.includes("--fill")) fill();
  if (process.argv.includes("--accept")) accept();
  let incomplete = false;
  const written = [
    gtTranslationsFile,
    gtByHashFile,
    ...(NodeFS.existsSync(gtPendingFile) ? [gtPendingFile] : []),
  ];
  for (const { file, contents, missing } of buildGtCatalogs()) {
    NodeFS.writeFileSync(file, contents);
    written.push(file);
    console.log(`${NodePath.relative(repoRoot, file)}: ${missing.length} missing`);
    for (const english of missing) console.log(`  ${JSON.stringify(english)}`);
    incomplete ||= missing.length > 0;
  }
  // The committed files follow the repository formatter, which keeps short arrays on one line.
  NodeChildProcess.execFileSync(
    NodePath.join(repoRoot, "node_modules/.bin/vp"),
    ["fmt", ...written],
    {
      cwd: repoRoot,
      stdio: "ignore",
    },
  );
  if (incomplete) process.exitCode = 1;
}

if (import.meta.url === NodeURL.pathToFileURL(process.argv[1] ?? "").href) main();
