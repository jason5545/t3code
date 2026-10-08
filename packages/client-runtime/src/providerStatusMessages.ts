/**
 * Provider status text is written by the server in English, so build-time
 * translation never sees it. Web and mobile wrap this with their own locale
 * check; text without a matching pattern stays English.
 */

type Rule = readonly [pattern: RegExp, chinese: (match: RegExpExecArray) => string];

const NAME = String.raw`(.+?)`;
const rule = (source: string, chinese: (match: RegExpExecArray) => string): Rule => [
  new RegExp(`^${source}$`),
  chinese,
];

const RULES: ReadonlyArray<Rule> = [
  rule(`${NAME} is disabled in T3 Code settings\\.`, (m) => `${m[1]} 已在 T3 Code 設定中停用。`),
  rule(
    `Checking ${NAME} (CLI|SDK) availability\\.\\.\\.`,
    (m) => `正在檢查 ${m[1]} ${m[2]} 是否可用…`,
  ),
  rule(
    `${NAME} provider status has not been checked in this session yet\\.`,
    (m) => `本次工作階段尚未檢查 ${m[1]} 供應商狀態。`,
  ),
  rule(`${NAME} CLI is installed but failed to run\\.`, (m) => `${m[1]} CLI 已安裝，但無法執行。`),
  rule(
    `${NAME} CLI is installed but failed to run\\. Timed out while running command\\.`,
    (m) => `${m[1]} CLI 已安裝，但無法執行：執行指令逾時。`,
  ),
  rule(
    `${NAME} CLI is installed but timed out while running \`(.+)\`\\.`,
    (m) => `${m[1]} CLI 已安裝，但執行 \`${m[2]}\` 時逾時。`,
  ),
  rule(
    `${NAME} CLI is installed but not logged in\\. Run \`(.+)\`\\.`,
    (m) => `${m[1]} CLI 已安裝，但尚未登入。請執行 \`${m[2]}\`。`,
  ),
  rule(
    `${NAME} CLI is installed but ACP initialize failed\\. Model options may be incomplete\\.`,
    (m) => `${m[1]} CLI 已安裝，但 ACP 初始化失敗。模型選項可能不完整。`,
  ),
  rule(
    `${NAME} CLI is not authenticated\\. Run \`(.+)\` and try again\\.`,
    (m) => `${m[1]} CLI 尚未驗證。請執行 \`${m[2]}\` 後再試一次。`,
  ),
  rule(
    `Timed out while checking ${NAME} provider status\\.`,
    (m) => `檢查 ${m[1]} 供應商狀態時逾時。`,
  ),
  rule(
    `Could not verify ${NAME} authentication status from initialization result\\.`,
    (m) => `無法從初始化結果確認 ${m[1]} 的驗證狀態。`,
  ),
  rule(
    `${NAME} is available, but T3 Code could not refresh its models and commands\\. The live session will retry startup\\.`,
    (m) => `${m[1]} 可以使用，但 T3 Code 無法重新整理它的模型和指令。執行中的工作階段會重試啟動。`,
  ),
  rule(
    `${NAME} is available, but model and command discovery needs interactive input\\. The live session will handle it\\.`,
    (m) => `${m[1]} 可以使用，但探索模型和指令需要互動輸入，會交給執行中的工作階段處理。`,
  ),
  rule(
    `${NAME} (\\S+) is unsupported\\. Update to ${NAME} (\\S+) or newer\\.`,
    (m) => `不支援 ${m[1]} ${m[2]}。請更新到 ${m[3]} ${m[4]} 或更新版本。`,
  ),
  rule(
    `${NAME} v(\\S+) is too old\\. Upgrade to v(\\S+) or newer\\.`,
    (m) => `${m[1]} v${m[2]} 版本過舊。請升級到 v${m[3]} 或更新版本。`,
  ),
  rule(
    `${NAME} SDK catalog request timed out after (\\d+)ms\\.`,
    (m) => `${m[1]} SDK 目錄請求在 ${m[2]} 毫秒後逾時。`,
  ),
  rule(
    `Sign in with Cursor or add CURSOR_API_KEY in provider settings\\.`,
    () => "請登入 Cursor，或在供應商設定中加入 CURSOR_API_KEY。",
  ),
  rule(
    `OpenCode server rejected authentication\\. Check the server URL and password\\.`,
    () => "OpenCode 伺服器拒絕驗證。請檢查伺服器網址和密碼。",
  ),
  rule(
    `Couldn't reach the configured OpenCode server at (.+)\\. Check that the server is running and the URL is correct\\.`,
    (m) => `無法連到設定的 OpenCode 伺服器 ${m[1]}。請確認伺服器正在執行且網址正確。`,
  ),
  rule(
    `Failed to connect to the configured OpenCode server\\.`,
    () => "無法連線到設定的 OpenCode 伺服器。",
  ),
  rule(
    "OpenCode CLI \\(`opencode`\\) is not installed or not on PATH\\.",
    () => "OpenCode CLI（`opencode`）未安裝，或不在 PATH 中。",
  ),
  rule(`Failed to load OpenCode provider inventory(?:: (.+)|\\.)`, (m) =>
    m[1] ? `無法載入 OpenCode 供應商清單：${m[1]}` : "無法載入 OpenCode 供應商清單。",
  ),
  rule(`Failed to execute OpenCode CLI health check(?:: (.+)|\\.)`, (m) =>
    m[1] ? `無法執行 OpenCode CLI 健康檢查：${m[1]}` : "無法執行 OpenCode CLI 健康檢查。",
  ),
  rule(
    `Select an ACP Registry agent or configure a local ACP executable before starting a thread\\.`,
    () => "開始對話前，請選取一個 ACP Registry 代理程式，或設定本機 ACP 執行檔。",
  ),
  rule(
    `Checking ACP authentication, models, and commands in the background\\.\\.\\.`,
    () => "正在背景檢查 ACP 驗證、模型和指令…",
  ),
  rule(`Set up Codex to get started\\.`, () => "設定 Codex 即可開始使用。"),
  rule(`Sign in with ChatGPT to use Codex\\.`, () => "使用 ChatGPT 登入以使用 Codex。"),
  rule(
    `Could not check Codex right now\\. Retry, or reconnect in provider settings\\.`,
    () => "目前無法檢查 Codex。請重試，或在供應商設定中重新連線。",
  ),
  rule(`Waiting for another provider update to finish\\.`, () => "正在等待另一個供應商更新完成。"),
  rule(
    `Provider installation changed\\. Refresh and try again\\.`,
    () => "供應商安裝已變更。請重新整理後再試一次。",
  ),
];

/** The zh-TW text for a known server provider status message, or null. */
export function translateProviderStatusMessage(message: string): string | null {
  for (const [pattern, chinese] of RULES) {
    const match = pattern.exec(message);
    if (match) return chinese(match);
  }
  return null;
}
