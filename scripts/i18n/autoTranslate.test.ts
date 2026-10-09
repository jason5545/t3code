import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeModule from "node:module";

import { afterAll, describe, expect, it } from "vitest";

import { catalogFile } from "./extract.ts";

const require = NodeModule.createRequire(import.meta.url);
const repoRoot = NodePath.resolve(import.meta.dirname, "../..");
const babel = NodeModule.createRequire(
  NodePath.join(
    NodeFS.realpathSync(NodePath.join(repoRoot, "apps/web/node_modules/@rolldown/plugin-babel")),
    "package.json",
  ),
)("@babel/core") as { transformSync(code: string, options: object): { code: string } };
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
    ].join("\n");
    const output = transform(source, "components/chat/ProviderStatusBanner.tsx");
    expect(output).toContain(`return busy ? __t3_t("Cancel", "取消") : __t3_t("Undo", "復原");`);
    expect(output).toContain(`__t3_tf(["Rename ", 0], ["重新命名 ", 0], [thread.title])`);
    expect(output).toContain(`[__t3_t("Could not save", "無法儲存")]`);
    expect(output).toContain(`detail: __t3_t("Add provider", "新增供應商")`);
    expect(transform(source)).toBe(untouched(source));
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
