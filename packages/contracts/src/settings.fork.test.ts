import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { DEFAULT_PROVIDER_INSTANCES } from "./providerInstance.ts";
import { DEFAULT_SERVER_SETTINGS, ServerSettings, ServerSettingsPatch } from "./settings.ts";

const decodeServerSettings = Schema.decodeUnknownSync(ServerSettings);
const decodeServerSettingsPatch = Schema.decodeUnknownSync(ServerSettingsPatch);

describe("ServerSettings.providerInstances (fork)", () => {
  it("defaults to OMP on the Pi driver when legacy configs omit the key", () => {
    expect(DEFAULT_SERVER_SETTINGS.providerInstances).toEqual(DEFAULT_PROVIDER_INSTANCES);
  });

  it("preserves explicitly empty maps rather than restoring OMP", () => {
    expect(decodeServerSettings({ providerInstances: {} }).providerInstances).toEqual({});
    expect(decodeServerSettingsPatch({ providerInstances: {} }).providerInstances).toEqual({});
  });
});
