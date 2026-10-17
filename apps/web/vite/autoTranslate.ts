import * as NodeURL from "node:url";

import { transformAsync } from "@babel/core";
import type { Plugin } from "vite-plus";

import autoTranslate from "../../../scripts/i18n/autoTranslate.cjs";

const roots = [
  NodeURL.fileURLToPath(new URL("../src", import.meta.url)),
  NodeURL.fileURLToPath(new URL("../../../packages/client-runtime/src", import.meta.url)),
];

const autoTranslateOptions = {
  catalogFile: NodeURL.fileURLToPath(new URL("../src/locale/zh-TW.json", import.meta.url)),
  runtimeFile: NodeURL.fileURLToPath(
    new URL("../src/locale/autoTranslateRuntime.ts", import.meta.url),
  ),
  roots,
};

/**
 * The fork's zh-TW build-time translation (scripts/i18n/autoTranslate.cjs).
 * It reads JSX text, so it runs before `vite:react-compiler`, which is also
 * `enforce: "pre"` and compiles JSX away; keep it ahead of `react()` in the
 * plugin list.
 */
export function autoTranslatePlugin(): Plugin {
  return {
    name: "t3code:auto-translate",
    enforce: "pre",
    transform: {
      filter: { id: { include: /\.[tj]sx?(?:\?|$)/, exclude: /\/node_modules\// } },
      async handler(code, id) {
        const [filename] = id.split("?");
        if (!filename || !roots.some((root) => filename.startsWith(root))) return null;
        const result = await transformAsync(code, {
          filename,
          babelrc: false,
          configFile: false,
          parserOpts: { plugins: ["typescript", "jsx"] },
          plugins: [[autoTranslate, autoTranslateOptions]],
          sourceMaps: true,
        });
        if (!result?.code) return null;
        return { code: result.code, map: result.map ?? null };
      },
    },
  };
}
