const path = require("node:path");

module.exports = function (api) {
  api.cache(true);
  return {
    presets: [["babel-preset-expo", { unstable_transformImportMeta: true }]],
    plugins: [
      [
        require("../../scripts/i18n/autoTranslate.cjs"),
        {
          catalogFile: path.resolve(__dirname, "../web/src/locale/zh-TW.json"),
          runtimeFile: path.resolve(__dirname, "src/locale/autoTranslateRuntime.ts"),
          roots: [
            path.resolve(__dirname, "src"),
            path.resolve(__dirname, "../../packages/client-runtime/src"),
          ],
        },
      ],
    ],
  };
};
