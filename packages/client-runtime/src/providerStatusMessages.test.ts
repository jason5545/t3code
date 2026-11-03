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

  it("translates notifications the server writes into the timeline", () => {
    expect(translateProviderStatusMessage("T3 Code restarted and resumed this turn")).toBe(
      "T3 Code 重新啟動了，已接續這一輪",
    );
    expect(translateProviderStatusMessage("Continue where you left off.")).toBe(
      "從中斷的地方繼續。",
    );
    expect(translateProviderStatusMessage("Background activity updated")).toBe("背景活動已更新");
    expect(translateProviderStatusMessage('Delegated task "Fix CI" has a question')).toBe(
      "委派的工作「Fix CI」有問題要問",
    );
    expect(translateProviderStatusMessage("#42: closed, stopped watching")).toBe(
      "#42：已關閉，停止監看",
    );
    expect(translateProviderStatusMessage("Could not link agent-fr")).toBe("無法連結 agent-fr");
  });

  it("translates background work notifications and keeps their labels", () => {
    expect(translateProviderStatusMessage('Command "vp run typecheck" finished (exit 0)')).toBe(
      "指令「vp run typecheck」已完成（結束代碼 0）",
    );
    expect(translateProviderStatusMessage("Command finished")).toBe("指令已完成");
    expect(translateProviderStatusMessage('Subagent "Review" was stopped')).toBe(
      "子代理程式「Review」已停止",
    );
    expect(translateProviderStatusMessage('Monitor "logs" reported new output')).toBe(
      "監控器「logs」有新的輸出",
    );
    expect(translateProviderStatusMessage("4 commands failed")).toBe("4 個指令失敗");
    expect(
      translateProviderStatusMessage(
        'Command "a" (exit 1), subagent "b" and monitor "c" were stopped',
      ),
    ).toBe("指令「a」（結束代碼 1）、子代理程式「b」和監控器「c」已停止");
    expect(
      translateProviderStatusMessage('Command "a", subagent "b" and monitor "c" finished'),
    ).toBe("指令「a」、子代理程式「b」和監控器「c」已完成");
    expect(translateProviderStatusMessage("Command and background task finished")).toBe(
      "指令和背景工作已完成",
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
