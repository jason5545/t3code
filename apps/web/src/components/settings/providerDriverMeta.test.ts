import { describe, expect, it } from "vite-plus/test";
import { ProviderDriverKind } from "@t3tools/contracts";
import {
  getProviderInstanceOption,
  getDriverOption,
  PROVIDER_INSTANCE_OPTIONS,
} from "./providerDriverMeta";

describe("provider instance creation presets", () => {
  it("offers Pi and OMP independently without adding a protocol driver", () => {
    const pi = getProviderInstanceOption("pi");
    const omp = getProviderInstanceOption("omp");
    expect(pi.driver).toBe("pi");
    expect(pi.label).toBe("Pi");
    expect(omp.driver).toBe("pi");
    expect(omp.label).toBe("OMP");
    expect(omp.defaultConfig).toMatchObject({
      binaryPath: "omp",
      launchArgs: "",
      customModels: [],
    });
    expect(pi.defaultConfig).toBeUndefined();
    expect(getDriverOption(ProviderDriverKind.make("omp"))).toBeUndefined();
    expect(PROVIDER_INSTANCE_OPTIONS.filter((option) => option.value === "omp")).toHaveLength(1);
  });
  it("preserves a safe fallback for unknown creation choices", () => {
    expect(getProviderInstanceOption("unknown").driver).toBe("codex");
  });
});
