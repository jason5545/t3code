import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("./locale", () => ({ readLocalePreference: () => "zh-TW" }));

const { localizeServerMessage } = await import("./serverMessages");

describe("localizeServerMessage", () => {
  it("translates known provider status messages and keeps their values", () => {
    expect(localizeServerMessage("Checking OMP CLI availability...")).toBe(
      "正在檢查 OMP CLI 是否可用…",
    );
    expect(localizeServerMessage("Pi 0.9.1 is unsupported. Update to Pi 0.10.0 or newer.")).toBe(
      "不支援 Pi 0.9.1。請更新到 Pi 0.10.0 或更新版本。",
    );
  });

  it("leaves unknown text and empty values alone", () => {
    expect(localizeServerMessage("spawn omp ENOENT")).toBe("spawn omp ENOENT");
    expect(localizeServerMessage(null)).toBeNull();
  });
});
