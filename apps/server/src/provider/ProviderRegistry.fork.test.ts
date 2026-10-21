import { assert, describe, it } from "@effect/vitest";
import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";

import * as ProviderRegistry from "./ProviderRegistry.ts";

// OMP shares the Pi driver, so it rides upstream's Pi model-retention rule.
describe("ProviderRegistry OMP snapshots", () => {
  it("drops deleted OMP models missing from a completed Pi discovery probe", () => {
    const previousProvider = {
      instanceId: ProviderInstanceId.make("omp"),
      driver: ProviderDriverKind.make("pi"),
      status: "ready",
      enabled: true,
      installed: true,
      auth: { status: "authenticated", type: "pi", label: "OMP" },
      checkedAt: "2026-10-10T11:45:07.808Z",
      version: "18.8.7",
      models: [
        { slug: "omlx/Qwen3.8-Flash-Next", name: "Qwen3.8", isCustom: false, capabilities: null },
        {
          slug: "omlx/OrcaSAQ-2-Cyber-27B",
          name: "OrcaSAQ",
          isCustom: false,
          capabilities: null,
        },
      ],
      slashCommands: [],
      skills: [],
    } as const satisfies ServerProvider;
    const refreshedProvider = {
      ...previousProvider,
      checkedAt: "2026-10-11T02:00:00.000Z",
      models: [
        { slug: "omlx/Qwen3.8-Flash-Next", name: "Qwen3.8", isCustom: false, capabilities: null },
      ],
    } satisfies ServerProvider;

    assert.deepStrictEqual(
      ProviderRegistry.mergeProviderSnapshot(previousProvider, refreshedProvider).models,
      [...refreshedProvider.models],
    );
  });

  it("retains OMP models when Pi discovery could not refresh them", () => {
    const previousProvider = {
      instanceId: ProviderInstanceId.make("omp"),
      driver: ProviderDriverKind.make("pi"),
      status: "ready",
      enabled: true,
      installed: true,
      auth: { status: "authenticated", type: "pi", label: "OMP" },
      checkedAt: "2026-10-10T11:45:07.808Z",
      version: "18.8.7",
      models: [
        { slug: "omlx/Qwen3.8-Flash-Next", name: "Qwen3.8", isCustom: false, capabilities: null },
      ],
      slashCommands: [],
      skills: [],
    } as const satisfies ServerProvider;
    const rpcFailedProvider = {
      ...previousProvider,
      checkedAt: "2026-10-11T02:00:00.000Z",
      auth: { status: "unknown" },
      models: [],
    } satisfies ServerProvider;

    assert.deepStrictEqual(
      ProviderRegistry.mergeProviderSnapshot(previousProvider, rpcFailedProvider).models,
      [...previousProvider.models],
    );
  });
});
