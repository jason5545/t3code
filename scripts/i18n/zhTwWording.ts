/**
 * Mainland wording that OpenCC `s2twp` leaves in place, with the word Taiwan software uses. Every
 * entry is safe to replace without reading the English; a reviewer decides the rest per entry
 * (策略 is 原則 only for a policy, 條 is 則 only for messages, 地址 is 位址 for network and email
 * addresses but stays for a postal one).
 */
export const MAINLAND_WORDING: ReadonlyArray<readonly [RegExp, string]> = [
  [/已不可用/g, "已無法使用"],
  [/不可用/g, "無法使用"],
  [/當前/g, "目前"],
  [/審批/g, "審核"],
  [/批准/g, "核准"],
  [/超時/g, "逾時"],
  [/憑據/g, "憑證"],
  [/響應/g, "回應"],
  [/詳情/g, "詳細資料"],
  [/跟蹤/g, "追蹤"],
  [/自定義/g, "自訂"],
  [/(?<!通行)密鑰/g, "金鑰"],
  [/執行例項/g, "執行個體"],
  [/例項/g, "執行個體"],
  [/點贊/g, "讚"],
  [/點踩/g, "倒讚"],
  [/只讀/g, "唯讀"],
  [/字節/g, "位元組"],
  [/列表/g, "清單"],
  [/空閒/g, "閒置"],
  [/反饋/g, "意見回饋"],
  [/校驗和/g, "總和檢查碼"],
  [/校驗/g, "驗證"],
  [/跳轉(?:到|至)?/g, "前往"],
  [/套餐/g, "方案"],
  [/閾值/g, "門檻"],
  [/聯結器/g, "連接器"],
  [/卸載/g, "卸除"],
  [/解壓(?!縮)/g, "解壓縮"],
  [/信號/g, "訊號"],
  [/導航/g, "導覽"],
  [/回合併/g, "回合並"],
  [/概覽/g, "總覽"],
  [/滾動/g, "捲動"],
  [/對話框/g, "對話方塊"],
  [/點擊/g, "按一下"],
  [/輕點/g, "點一下"],
  [/選中/g, "選取"],
  [/佔位符/g, "預留位置"],
  [/腳本/g, "指令碼"],
  [/保存/g, "儲存"],
  [/沙箱/g, "沙盒"],
  [/回車/g, "Enter"],
  [/掛起/g, "暫停"],
  [/轉發/g, "轉送"],
  [/協議/g, "通訊協定"],
  [/行動數據/g, "行動網路"],
  [/數據/g, "資料"],
  [/查看/g, "檢視"],
  [/共享/g, "共用"],
  [/前綴/g, "字首"],
  [/後綴/g, "字尾"],
  [/設置/g, "設定"],
  [/懸停/g, "暫留"],
  [/(安裝|應用|監聽)程序/g, "$1程式"],
  [/(?<!處理|安裝|應用|監聽)程序(?!碼)/g, "處理程序"],
  [/合並/g, "合併"],
  [/快進/g, "快轉"],
  [/檢出/g, "checkout"],
  [/更新頻道/g, "更新通道"],
  [/臺/g, "台"],
  [/占(?!卜)/g, "佔"],
  [/正在在/g, "正在"],
  [/時間窗(?!口)/g, "時間視窗"],
  [/虛擬機(?!器)/g, "虛擬機器"],
  [/全不選/g, "取消全選"],
  [/去重(?!複)/g, "去除重複"],
];

export const toTaiwanWording = (text: string) =>
  MAINLAND_WORDING.reduce(
    (result, [pattern, replacement]) => result.replace(pattern, replacement),
    text,
  );

/**
 * Textbook Chinese for Git and developer terms, which the catalogs keep in English (pull request,
 * worktree, checkout, rebase, stash, token, fork, secret, squash), as Taiwan developers say them
 * (owner decision, 2026-11-27). Detected only: the English depends on the sentence, so a reviewer
 * writes it.
 */
const TEXTBOOK_GIT_TERMS: ReadonlyArray<RegExp> = [
  /提取要求/g,
  /合併要求/g,
  /工作樹/g,
  /簽出/g,
  /工作複本/g,
  /重定基底/g,
  /貯存/g,
  /權杖/g,
  /分岔/g,
  /祕密/g,
  /壓縮合併/g,
];

/** Mainland and textbook Git words in `text`, empty when it reads as Taiwan software does. */
export function avoidedWording(text: string): ReadonlyArray<string> {
  const found: string[] = [];
  for (const pattern of [...MAINLAND_WORDING.map(([pattern]) => pattern), ...TEXTBOOK_GIT_TERMS]) {
    for (const match of text.matchAll(pattern)) found.push(match[0]);
  }
  return found;
}
