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

  it("translates provider update progress and failures", () => {
    expect(translateProviderStatusMessage("Running npm install -g @openai/codex@latest")).toBe(
      "正在執行 npm install -g @openai/codex@latest",
    );
    expect(translateProviderStatusMessage("Update command exited with code 1.")).toBe(
      "更新指令以代碼 1 結束。",
    );
    expect(translateProviderStatusMessage("Update timed out — try again.")).toBe(
      "更新逾時，請再試一次。",
    );
  });

  it("returns null for unknown text", () => {
    expect(translateProviderStatusMessage("spawn omp ENOENT")).toBeNull();
  });
});
