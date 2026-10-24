import { describe, expect, it } from "@effect/vitest";

import {
  translateAgentNotice,
  translateProviderOptionLabel,
  translateProviderStatusMessage,
} from "./providerStatusMessages.ts";

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

  it("translates approval option labels from adapters", () => {
    expect(translateProviderStatusMessage("Approve")).toBe("核准");
    expect(translateProviderStatusMessage("Decline")).toBe("拒絕");
    expect(translateProviderStatusMessage("Allow every bash request this session")).toBe(
      "在此工作階段允許所有 bash 請求",
    );
    expect(translateProviderStatusMessage("Allow git *, ls * this session")).toBe(
      "在此工作階段允許 git *, ls *",
    );
  });

  it("returns null for unknown text", () => {
    expect(translateProviderStatusMessage("spawn omp ENOENT")).toBeNull();
  });
});

describe("translateProviderOptionLabel", () => {
  it("translates known reasoning and speed labels only", () => {
    expect(translateProviderOptionLabel("Extra High")).toBe("超高");
    expect(translateProviderOptionLabel("Reasoning")).toBe("推理");
    expect(translateProviderOptionLabel("gpt-6-sol")).toBeNull();
  });
});

describe("translateAgentNotice", () => {
  it("translates kimi-code's compaction notices and splits the joined end notice", () => {
    expect(
      translateAgentNotice(
        "Context compaction started — it runs in the background and the compacted context applies once it finishes.Compaction completed.\n- Messages compacted: 603\n- Tokens before: 810,262\n- Tokens after: 90,714",
      ),
    ).toBe(
      "已開始壓縮上下文，會在背景執行，完成後才套用壓縮後的上下文。\n\n壓縮完成。\n- 已壓縮訊息：603\n- 壓縮前 token：810,262\n- 壓縮後 token：90,714",
    );
    expect(translateAgentNotice("Compaction cancelled.")).toBe("壓縮已取消。");
  });

  it("leaves an answer that only mentions the notice as written", () => {
    expect(translateAgentNotice("Kimi printed Compaction completed. after the run.")).toBeNull();
  });
});
