import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { ServerSettings, ServerSettingsPatch } from "./settings.ts";

const decodeServerSettings = Schema.decodeUnknownSync(ServerSettings);
const decodeServerSettingsPatch = Schema.decodeUnknownSync(ServerSettingsPatch);

describe("ServerSettings.providerInstances (fork)", () => {
  it("preserves explicitly empty maps rather than restoring OMP", () => {
    expect(decodeServerSettings({ providerInstances: {} }).providerInstances).toEqual({});
    expect(decodeServerSettingsPatch({ providerInstances: {} }).providerInstances).toEqual({});
  });
});
