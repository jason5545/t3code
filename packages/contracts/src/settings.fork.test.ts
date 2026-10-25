import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { DEFAULT_SERVER_SETTINGS, ServerSettings, ServerSettingsPatch } from "./settings.ts";

const decodeServerSettings = Schema.decodeUnknownSync(ServerSettings);
const decodeServerSettingsPatch = Schema.decodeUnknownSync(ServerSettingsPatch);

describe("ServerSettings.providerInstances (fork)", () => {
  // OMP is added per machine; a server without `omp` showed it as not installed.
  it("adds no OMP instance when settings omit the key", () => {
    expect(DEFAULT_SERVER_SETTINGS.providerInstances).toEqual({});
    expect(decodeServerSettings({}).providerInstances).toEqual({});
  });

  it("preserves explicitly empty maps", () => {
    expect(decodeServerSettings({ providerInstances: {} }).providerInstances).toEqual({});
    expect(decodeServerSettingsPatch({ providerInstances: {} }).providerInstances).toEqual({});
  });
});
