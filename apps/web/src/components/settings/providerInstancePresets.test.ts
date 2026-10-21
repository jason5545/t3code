import { describe, expect, it } from "vite-plus/test";
import { ProviderDriverKind } from "@t3tools/contracts";

import { providerClients } from "./providerDriverMeta";
import {
  presetConfigDraft,
  providerInstanceClients,
  providerInstancePreset,
} from "./providerInstancePresets";

const PI = ProviderDriverKind.make("pi");
const OMP = ProviderDriverKind.make("omp");

describe("provider instance creation presets", () => {
  it("offers Pi and OMP independently without adding a protocol driver", () => {
    expect(providerInstanceClients.get(PI)?.label).toBe("Pi");
    expect(providerInstanceClients.get(OMP)?.label).toBe("OMP");
    expect(
      providerInstanceClients.definitions.filter((option) => option.driverKind === OMP),
    ).toHaveLength(1);
    expect(providerClients.get(OMP)).toBeUndefined();
    expect(providerInstancePreset(OMP).driver).toBe("pi");
    expect(providerInstancePreset(PI)).toEqual({ driver: "pi" });
  });

  it("starts an OMP draft from the omp CLI and keeps other drafts as they are", () => {
    expect(presetConfigDraft(OMP, undefined)).toMatchObject({
      binaryPath: "omp",
      launchArgs: "",
      customModels: [],
    });
    expect(presetConfigDraft(OMP, { launchArgs: "--x" })).toMatchObject({
      binaryPath: "omp",
      launchArgs: "--x",
    });
    const draft = { binaryPath: "pi" };
    expect(presetConfigDraft(PI, draft)).toBe(draft);
    expect(presetConfigDraft(PI, undefined)).toBeUndefined();
  });
});
