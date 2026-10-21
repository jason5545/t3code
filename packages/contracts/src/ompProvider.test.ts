import { describe, expect, it } from "vite-plus/test";

import { OMP_ICON_URL, providerIconKind } from "./ompProvider.ts";

describe("providerIconKind", () => {
  it("draws the OMP glyph only for Pi instances named OMP", () => {
    expect(providerIconKind("pi", "OMP")).toBe("omp");
    expect(providerIconKind("pi", " omp work ")).toBe("omp");
    expect(providerIconKind("pi", "Pi")).toBe("pi");
    expect(providerIconKind("pi", "Ompa")).toBe("pi");
    expect(providerIconKind("codex", "OMP")).toBe("codex");
    expect(providerIconKind(undefined, "OMP")).toBeUndefined();
  });

  it("recognizes the icon the server sends for an OMP instance", () => {
    expect(providerIconKind("pi", null, OMP_ICON_URL)).toBe("omp");
    expect(providerIconKind("pi", null, "https://example.com/pi.svg")).toBe("pi");
    expect(providerIconKind("acpRegistry", null, OMP_ICON_URL)).toBe("acpRegistry");
    expect(OMP_ICON_URL.length).toBeLessThanOrEqual(2_048);
  });
});
