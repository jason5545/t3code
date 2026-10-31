// @effect-diagnostics nodeBuiltinImport:off - Writes a temporary catalog and loads the CommonJS Babel plugin through require.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeModule from "node:module";

import { afterAll, describe, expect, it } from "vite-plus/test";

import { catalogFile } from "./extract.ts";

const require = NodeModule.createRequire(import.meta.url);
const repoRoot = NodePath.resolve(import.meta.dirname, "../..");
const babel = NodeModule.createRequire(NodePath.join(repoRoot, "apps/web/package.json"))(
  "@babel/core",
) as { transformSync(code: string, options: object): { code: string } };
const autoTranslate = require("./autoTranslate.cjs");

const tempDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-i18n-"));
const testCatalog = NodePath.join(tempDir, "zh-TW.json");
NodeFS.writeFileSync(
  testCatalog,
  JSON.stringify({
    "Add provider": "新增供應商",
    "Run {0} to start.": "執行 {0} 即可開始。",
    "Delete {name} from {project}?": "要從 {project} 刪除 {name} 嗎？",
    "Rename {thread.title}": "重新命名 {thread.title}",
    Cancel: "取消",
    "Could not save": "無法儲存",
    Undo: "復原",
    "New thread": "新增對話",
    "{count} files": "{count} 個檔案",
    "{count} environment{0}": "{count} 個環境",
    "Broken {name}": "壞掉的 {other}",
    folder: "資料夾",
  }),
);
afterAll(() => NodeFS.rmSync(tempDir, { recursive: true, force: true }));

const webSrc = NodePath.join(repoRoot, "apps/web/src");

function compile(code: string, file: string, plugins: ReadonlyArray<unknown>): string {
  return babel.transformSync(code, {
    filename: NodePath.join(webSrc, file),
    babelrc: false,
    configFile: false,
    parserOpts: { plugins: ["typescript", "jsx"] },
    generatorOpts: { jsescOption: { minimal: true } },
    plugins,
  }).code;
}

function transform(code: string, file = "components/Example.tsx"): string {
  return compile(code, file, [
    [
      autoTranslate,
      {
        catalogFile: testCatalog,
        runtimeFile: NodePath.join(webSrc, "locale/autoTranslateRuntime.ts"),
        roots: [webSrc],
      },
    ],
  ]);
}

/** Babel's own output without the plugin, for "left unchanged" comparisons. */
const untouched = (code: string) => compile(code, "components/Example.tsx", []);

describe("autoTranslate", () => {
  it("translates catalog text and imports the runtime relative to the file", () => {
    const output = transform(`const a = <Button>  Add provider  </Button>;`);
    expect(output).toContain(`import { __t3_t } from "../locale/autoTranslateRuntime";`);
    expect(output).toContain(`{"  " + __t3_t("Add provider", "新增供應商") + "  "}`);
  });

  it("leaves text without a translation and non-display attributes alone", () => {
    const source = `const a = <div className="Add provider" data-x="Cancel">Something else</div>;`;
    expect(transform(source)).toBe(untouched(source));
  });

  it("joins inline children into one message so the translation can reorder them", () => {
    const output = transform(
      `const a = <p>\n  Run <code>npx t3</code> to start.\n</p>;\nconst b = <p>Delete {name} from {project}?</p>;`,
    );
    expect(output).toContain(
      `__t3_tj(["Run ", 0, " to start."], ["執行 ", 0, " 即可開始。"], [<code>npx t3</code>])`,
    );
    expect(output).toContain(
      `__t3_tj(["Delete ", 0, " from ", 1, "?"], ["要從 ", 1, " 刪除 ", 0, " 嗎？"], [name, project])`,
    );
  });

  it("keeps string children for elements that only accept text", () => {
    const output = transform(`const a = <option>{count} files</option>;`);
    expect(output).toContain(`__t3_tf([0, " files"], [0, " 個檔案"], [count])`);
  });

  it("lets a translation drop an English plural suffix", () => {
    const output = transform('const a = <p>{count} environment{count === 1 ? "" : "s"}</p>;');
    expect(output).toContain(
      `__t3_tj([0, " environment", 1], [0, " 個環境"], [count, count === 1 ? "" : "s"])`,
    );
  });

  it("translates display attributes, templates, and conditional branches", () => {
    const output = transform(
      'const a = <Item label={busy ? "Cancel" : `Rename ${thread.title}`} aria-label="Undo" />;',
    );
    expect(output).toContain(`__t3_t("Cancel", "取消")`);
    expect(output).toContain(`__t3_tf(["Rename ", 0], ["重新命名 ", 0], [thread.title])`);
    expect(output).toContain(`aria-label={__t3_t("Undo", "復原")}`);
  });

  it("translates display properties, toast bodies, and alert dialogs", () => {
    const output = transform(
      [
        `const a = { title: "Could not save", id: "Cancel" };`,
        `toastManager.add({ type: "error", title: "Could not save", actionProps: { children: "Undo" } });`,
        `const b = { children: "Undo" };`,
        `Alert.alert("Could not save", undefined, [{ text: "Cancel", style: "cancel" }]);`,
      ].join("\n"),
    );
    expect(output).toContain(`title: __t3_t("Could not save", "無法儲存"),\n  id: "Cancel"`);
    expect(output).toContain(`children: __t3_t("Undo", "復原")`);
    expect(output).toContain(`const b = {\n  children: "Undo"\n};`);
    expect(output).toContain(`Alert.alert(__t3_t("Could not save", "無法儲存")`);
    expect(output).toContain(`text: __t3_t("Cancel", "取消")`);
  });

  it("translates mobile Dialog calls like Alert calls", () => {
    const output = transform(
      [
        `Dialog.alert("Could not save", undefined, [{ text: "Cancel", style: "cancel" }]);`,
        `Dialog.confirm({ title: "Could not save", message: "Undo", confirmText: "Cancel", onConfirm });`,
        `Dialog.prompt({ title: "Could not save", initialValue: "Undo", confirmText: "Cancel", onConfirm });`,
      ].join("\n"),
    );
    expect(output).toContain(`Dialog.alert(__t3_t("Could not save", "無法儲存")`);
    expect(output).toContain(`text: __t3_t("Cancel", "取消")`);
    expect(output).toContain(`message: __t3_t("Undo", "復原")`);
    expect(output.match(/confirmText: __t3_t\("Cancel", "取消"\)/g)).toHaveLength(2);
    expect(output).toContain(`initialValue: "Undo"`);
  });

  it("translates text returned by render-prop children and tooltip variables", () => {
    const output = transform(
      [
        `const a = <SelectValue>{(value) => (value === null ? "Undo" : labels[value])}</SelectValue>;`,
        `const b = <Button onClick={() => "Undo"} />;`,
        `const tooltip = busy ? "Cancel" : "Undo";`,
      ].join("\n"),
    );
    expect(output).toContain(`value === null ? __t3_t("Undo", "復原") : labels[value]`);
    expect(output).toContain(`onClick={() => "Undo"}`);
    expect(output).toContain(`busy ? __t3_t("Cancel", "取消") : __t3_t("Undo", "復原")`);
  });

  it("translates toast button labels built inside a helper", () => {
    const output = transform(
      [
        `toastManager.add(stackedThreadToast({ title: "Could not save", actionProps: { children: "Undo" }, data: { secondaryActionProps: { children: "Cancel" } } }));`,
        `stackedThreadToast({ actionProps: canUndo ? { children: "Undo" } : { children: "Cancel" } });`,
      ].join("\n"),
    );
    expect(output.match(/children: __t3_t\("Undo", "復原"\)/g)).toHaveLength(2);
    expect(output.match(/children: __t3_t\("Cancel", "取消"\)/g)).toHaveLength(2);
  });

  it("keeps English where code compares the value", () => {
    const source = `const a = { title: "New thread" };`;
    expect(transform(source, "components/ChatView.logic.ts")).toBe(untouched(source));
    expect(transform(source)).toContain(`__t3_t("New thread", "新增對話")`);
  });

  it("treats returned and assigned text as display copy only in display files", () => {
    const source = [
      `function a(busy) { return busy ? "Cancel" : "Undo"; }`,
      "const b = `Rename ${thread.title}`;",
      `const c = () => ["Could not save"];`,
      `const d = { detail: "Add provider" };`,
      `const e = { details: ["Could not save"] };`,
    ].join("\n");
    const output = transform(source, "components/chat/ProviderStatusBanner.tsx");
    expect(output).toContain(`return busy ? __t3_t("Cancel", "取消") : __t3_t("Undo", "復原");`);
    expect(output).toContain(`__t3_tf(["Rename ", 0], ["重新命名 ", 0], [thread.title])`);
    expect(output).toContain(`[__t3_t("Could not save", "無法儲存")]`);
    expect(output).toContain(`detail: __t3_t("Add provider", "新增供應商")`);
    expect(output).toContain(`details: [__t3_t("Could not save", "無法儲存")]`);
    expect(transform(source)).toBe(untouched(source));
  });

  it("treats sentences and capitalized table labels as display copy in display files", () => {
    const source = [
      `fail(detail ?? "Could not save");`,
      `error = busy ? "Add provider" : "Could not save";`,
      `const lines = [label, inUse ? "Add provider" : null];`,
      `const a = <Row value="Add provider" />;`,
      `const STATES = { cancel: "Cancel", icon: "folder" };`,
      `const b = { notice: "Could not save" };`,
      `track("Cancel");`,
      `const err = new Error("Could not save", { cause });`,
    ].join("\n");
    const output = transform(source, "components/chat/ProviderStatusBanner.tsx");
    expect(output).toContain(`fail(detail ?? __t3_t("Could not save", "無法儲存"))`);
    expect(output).toContain(
      `error = busy ? __t3_t("Add provider", "新增供應商") : __t3_t("Could not save", "無法儲存")`,
    );
    expect(output).toContain(`[label, inUse ? __t3_t("Add provider", "新增供應商") : null]`);
    expect(output).toContain(`value={__t3_t("Add provider", "新增供應商")}`);
    expect(output).toContain(`cancel: __t3_t("Cancel", "取消"),\n  icon: "folder"`);
    expect(output).toContain(`notice: __t3_t("Could not save", "無法儲存")`);
    // A single word handed to a call is usually an identifier.
    expect(output).toContain(`track("Cancel")`);
    expect(output).toContain(`new Error(__t3_t("Could not save", "無法儲存"), {`);
    expect(transform(source)).toBe(untouched(source));
  });

  it("translates variables and default props named for display text in any file", () => {
    const source = [
      `const footerActionLabel = busy ? "Cancel" : "Undo";`,
      `function Footer({ escapeLabel = "Cancel" }) { return escapeLabel; }`,
    ].join("\n");
    const output = transform(source);
    expect(output).toContain(
      `const footerActionLabel = busy ? __t3_t("Cancel", "取消") : __t3_t("Undo", "復原");`,
    );
    expect(output).toContain(`escapeLabel = __t3_t("Cancel", "取消")`);
    // Context-record fields reach agents, so the name alone does not make them display text.
    const data = `const terminalLabel = "Cancel";`;
    expect(transform(data)).toBe(untouched(data));
  });

  it("translates lookup tables that feed menu options", () => {
    const source = [
      `const SORT_ORDER_LABELS = { manual: "Cancel", recent: "Undo" } as const;`,
      `const toolbarTitles: Record<string, string> = { a: "Cancel" };`,
      `const ROUTES = { cancel: "Cancel" };`,
      `const select = <Select items={{ undo: "Undo" }} />;`,
    ].join("\n");
    const output = transform(source);
    expect(output).toContain(`undo: __t3_t("Undo", "復原")`);
    expect(output).toContain(`manual: __t3_t("Cancel", "取消")`);
    expect(output).toContain(`recent: __t3_t("Undo", "復原")`);
    expect(output).toContain(`a: __t3_t("Cancel", "取消")`);
    expect(output).toContain(`const ROUTES = {\n  cancel: "Cancel"\n};`);
  });

  it("translates what label helpers return, but not inside components", () => {
    const source = [
      `function resolveModeLabel(mode) { const fallback = "Undo"; return mode === "a" ? "Cancel" : fallback; }`,
      `const resolveOtherLabel = () => "Cancel";`,
      `function SidebarTitle() { const mode = "Cancel"; return mode; }`,
    ].join("\n");
    const output = transform(source);
    expect(output).toContain(`const fallback = __t3_t("Undo", "復原");`);
    expect(output).toContain(`mode === "a" ? __t3_t("Cancel", "取消") : fallback`);
    expect(output).toContain(`const resolveOtherLabel = () => __t3_t("Cancel", "取消");`);
    expect(output).toContain(`const mode = "Cancel";`);
  });

  it("keeps English when a translation invents a placeholder", () => {
    const source = "const a = <p>Broken {name}</p>;";
    expect(transform(source)).toBe(untouched(source));
  });

  it("skips verbatim elements and files outside the roots", () => {
    expect(transform(`const a = <kbd>Cancel</kbd>;`)).toBe(
      untouched(`const a = <kbd>Cancel</kbd>;`),
    );
    expect(transform(`const a = <b>Cancel</b>;`, "../../server/src/x.tsx")).toBe(
      untouched(`const a = <b>Cancel</b>;`),
    );
  });
});

describe("zh-TW catalog", () => {
  const catalog = JSON.parse(NodeFS.readFileSync(catalogFile, "utf8")) as Record<string, string>;
  const placeholders = (text: string) =>
    [...text.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]).sort();

  it("only uses placeholders the English text provides", () => {
    for (const [english, chinese] of Object.entries(catalog)) {
      expect(chinese.trim(), english).not.toBe("");
      const known = new Set(placeholders(english));
      expect(
        placeholders(chinese).filter((name) => !known.has(name)),
        english,
      ).toEqual([]);
    }
  });
});
