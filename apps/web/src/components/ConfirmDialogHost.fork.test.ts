import { describe, expect, it } from "vite-plus/test";

import { resolveConfirmDialogCopy } from "./ConfirmDialogHost";

describe("confirmation copy in Traditional Chinese", () => {
  it("takes the question before a full-width question mark as the title", () => {
    expect(resolveConfirmDialogCopy("要刪除這個無痕對話嗎？對話會立即清除，無法復原。")).toEqual({
      title: "要刪除這個無痕對話嗎？",
      description: "對話會立即清除，無法復原。",
    });
    expect(
      resolveConfirmDialogCopy("要刪除 2 個對話嗎？\n這會永久清除這些對話的歷史紀錄。"),
    ).toEqual({ title: "要刪除 2 個對話嗎？", description: "這會永久清除這些對話的歷史紀錄。" });
  });
});
