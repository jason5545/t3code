/**
 * Fork: zh-TW reset credit choices. The build-time pass does not reach this package, and the
 * option labels come from the server, so `resetCreditChoices` hands over here when clients run
 * in Chinese (`setChineseDurations`).
 */
import type {
  ProviderConsumeResetCreditInput,
  ServerProviderResetCredits,
} from "@t3tools/contracts";

import type { ResetCreditChoice } from "./usageLimits.ts";

// Claude's reset kinds, as `claudeResetCredits.ts` labels them on the server.
const RESET_OPTION_TEXT: Readonly<Record<string, readonly [label: string, description: string]>> = {
  "5-hour reset": ["5 小時重設", "補滿你的 5 小時用量上限。"],
  "Weekly reset": ["每週重設", "補滿你的每週用量上限。"],
  "Fable reset": [
    "Fable 重設",
    "補滿你的 Fable 額度，並退回 Fable 在每週上限用掉的部分，不會重設整週。",
  ],
  "Full reset": ["完整重設", "補滿你的 5 小時與每週用量上限。"],
};

export function chineseResetCreditChoices(
  credits: ServerProviderResetCredits,
  input: ProviderConsumeResetCreditInput,
  expiresIn: (at: string | undefined) => string | null,
  compact: boolean,
): ReadonlyArray<ResetCreditChoice> {
  if (credits.options && "instanceId" in input) {
    return credits.options.map((option) => {
      const expires = expiresIn(option.expiresAt);
      const [label, description] = RESET_OPTION_TEXT[option.label] ?? [
        option.label,
        option.description,
      ];
      return {
        key: option.creditId,
        summary: `${label} · 剩 ${option.availableCount} 個${expires ? ` · ${expires}後到期` : ""}`,
        actionLabel: "使用",
        confirmDescription: `${label}：${description}此動作無法復原。`,
        availableCount: option.availableCount,
        input: { ...input, creditId: option.creditId },
      };
    });
  }
  const count = credits.availableCount;
  const expires = expiresIn(credits.nextExpiresAt);
  return [
    {
      key: "next",
      summary:
        count === 0
          ? "沒有累積的重設額度"
          : compact
            ? `已累積 ${count} 個${expires ? ` · ${expires}後到期` : ""}`
            : `已累積 ${count} 個重設額度${expires ? ` · 下一個 ${expires}後到期` : ""}`,
      actionLabel: "使用重設",
      confirmDescription: "這會兌換你帳號中的一個額度，並清除目前的速率限制時段。此動作無法復原。",
      availableCount: count,
      input,
    },
  ];
}
