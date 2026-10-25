import { describe, expect, it } from "vite-plus/test";

import { withChineseChangeRequestTerms } from "./changeRequestTermText.ts";

const fill = (parts: ReadonlyArray<string | number>, values: ReadonlyArray<unknown>) =>
  withChineseChangeRequestTerms(parts, values)
    .map((part) => (typeof part === "number" ? String(values[part]) : part))
    .join("");

describe("change request terms in translated messages", () => {
  it("writes each host's term in Chinese without the space beside Chinese text", () => {
    expect(fill(["開啟 ", 0], ["pull request"])).toBe("開啟提取請求");
    expect(fill(["在 ", 0, " 留言"], ["merge request"])).toBe("在合併請求留言");
    expect(fill([0, " 已放進輸入框。"], ["pull request"])).toBe("提取請求已放進輸入框。");
    expect(fill([0, " 個 ", 1, " 依基底分支串接。"], [3, "pull requests"])).toBe(
      "3 個提取請求依基底分支串接。",
    );
  });

  it("keeps spaces beside Latin text and short labels", () => {
    expect(fill([0, " #", 1], ["Pull request", 12])).toBe("提取請求 #12");
    expect(fill(["推送或開啟 ", 0, " 前"], ["a PR"])).toBe("推送或開啟 PR 前");
    expect(fill(["說明這個 ", 0], ["MR"])).toBe("說明這個 MR");
  });

  it("leaves other values alone", () => {
    const parts = ["刪除 ", 0];
    expect(withChineseChangeRequestTerms(parts, ["pull request review"])).toBe(parts);
    expect(fill(parts, ["pull request review"])).toBe("刪除 pull request review");
  });
});
