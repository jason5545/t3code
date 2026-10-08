import { describe, expect, it } from "@effect/vitest";

import { translateProviderStatusMessage } from "./providerStatusMessages.ts";

describe("translateProviderStatusMessage", () => {
  it("translates known provider status messages and keeps their values", () => {
    expect(translateProviderStatusMessage("Checking OMP CLI availability...")).toBe(
      "正在檢查 OMP CLI 是否可用…",
    );
    expect(
      translateProviderStatusMessage("Pi 0.9.1 is unsupported. Update to Pi 0.10.0 or newer."),
    ).toBe("不支援 Pi 0.9.1。請更新到 Pi 0.10.0 或更新版本。");
  });

  it("returns null for unknown text", () => {
    expect(translateProviderStatusMessage("spawn omp ENOENT")).toBeNull();
  });
});
