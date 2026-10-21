import { describe, expect, it } from "vite-plus/test";

import { providerIconKind } from "./providerInstanceDisplay.ts";

describe("providerIconKind", () => {
  it("draws the OMP glyph only for Pi instances named OMP", () => {
    expect(providerIconKind("pi", "OMP")).toBe("omp");
    expect(providerIconKind("pi", " omp work ")).toBe("omp");
    expect(providerIconKind("pi", "Pi")).toBe("pi");
    expect(providerIconKind("pi", "Ompa")).toBe("pi");
    expect(providerIconKind("codex", "OMP")).toBe("codex");
    expect(providerIconKind(undefined, "OMP")).toBeUndefined();
  });
});
