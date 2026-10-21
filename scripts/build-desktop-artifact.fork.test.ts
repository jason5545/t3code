import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";

import { createBuildConfig, DESKTOP_ELECTRON_LANGUAGES } from "./build-desktop-artifact.ts";

it.layer(NodeServices.layer)("build-desktop-artifact (fork)", (it) => {
  it("keeps the Traditional Chinese Electron resources on every platform", () => {
    // Verify both actual file basenames against electron-builder's literal
    // matching rule. Hyphens alone incorrectly delete macOS's zh_TW.lproj.
    for (const locale of ["en", "en-US", "zh-TW", "zh_TW"]) {
      const language = locale.toLowerCase();
      assert.isTrue(
        DESKTOP_ELECTRON_LANGUAGES.some(
          (wanted) =>
            wanted.toLowerCase() === language ||
            wanted.toLowerCase().startsWith(`${language}-`) ||
            wanted.toLowerCase().startsWith(`${language}_`),
        ),
        `Preserves Electron locale ${locale}`,
      );
    }
  });

  it.effect("uses the local development hook and an isolated fork identity", () =>
    Effect.gen(function* () {
      const config = yield* createBuildConfig(
        "mac",
        "dmg",
        "0.0.45-nightly.20261007.1",
        true,
        false,
        undefined,
        undefined,
      );
      const mac = config.mac as Record<string, unknown>;
      assert.equal(config.appId, "com.jason5545.t3code.nightly");
      assert.equal(config.productName, "T3 Code Jason (Nightly)");
      assert.equal(mac.type, "development");
      assert.equal(mac.notarize, false);
      assert.equal(mac.preAutoEntitlements, false);
      assert.notProperty(mac, "provisioningProfile");
      assert.match(String(mac.sign), /sign-macos-development\.ts$/);
      assert.deepEqual(config.publish, [
        {
          provider: "github",
          owner: "jason5545",
          repo: "t3code",
          releaseType: "prerelease",
          channel: "nightly",
        },
      ]);
    }).pipe(
      Effect.provide(
        ConfigProvider.layer(
          ConfigProvider.fromEnv({
            env: {
              T3CODE_MACOS_SIGNING_MODE: "development",
              T3CODE_MACOS_DEVELOPMENT_IDENTITY: "A".repeat(40),
              T3CODE_DESKTOP_UPDATE_REPOSITORY: "jason5545/t3code",
            },
          }),
        ),
      ),
    ),
  );
});
