import { usesChineseDurations } from "./durationFormat.ts";

/**
 * zh-TW text for T3 tool calls in the work log. The English titles and summaries are
 * assembled from verb and object parts, counts and plurals in `packages/shared` and
 * `client-runtime`, which the build-time translation pass cannot reach; this follows the
 * clients' startup locale through `setChineseDurations`. The server never sets it, so
 * provider-facing text stays English.
 */

interface ToolText {
  /** Verb and object; `{target}` marks where a pull request number replaces the object. */
  readonly phrase: string;
  readonly target?: string;
  /** Completed form when 已 + phrase misreads: a watch that only starts, or a request. */
  readonly completed?: string;
}

const PR = { target: "提取請求" } as const;

const TOOLS: Readonly<Record<string, ToolText>> = {
  link_pull_request: { phrase: "連結{target}", ...PR },
  unlink_pull_request: { phrase: "取消連結{target}", ...PR },
  list_thread_pull_requests: { phrase: "查看已連結的提取請求" },
  watch_pull_request: { phrase: "監看{target}", completed: "已開始監看{target}", ...PR },
  unwatch_pull_request: { phrase: "停止監看{target}", ...PR },
  write_pull_request_guides: { phrase: "撰寫審查指南", completed: "已開始撰寫審查指南" },
  read_pull_request_guide: { phrase: "讀取審查指南" },
  orchestrator_capabilities: { phrase: "取得協調能力" },
  delegate_task: { phrase: "委派子任務" },
  task_status: { phrase: "查看委派任務狀態" },
  task_cancel: { phrase: "取消委派任務", completed: "已要求取消委派任務" },
  schedule_task: { phrase: "排程週期任務" },
  list_scheduled_tasks: { phrase: "列出排程任務" },
  update_scheduled_task: { phrase: "更新排程任務" },
  delete_scheduled_task: { phrase: "刪除排程任務", completed: "已要求刪除排程任務" },
  request_secret: { phrase: "索取密鑰" },
  create_threads: { phrase: "建立 T3 對話" },
  t3_thread_start: { phrase: "啟動 T3 對話" },
  t3_thread_list: { phrase: "列出 T3 對話" },
  t3_thread_read: { phrase: "讀取 T3 對話" },
  t3_thread_send: { phrase: "傳送訊息到 T3 對話" },
  t3_thread_wait: { phrase: "等候 T3 對話" },
  t3_background_wait: { phrase: "更新背景等候" },
  t3_workflow_stop: { phrase: "停止工作流程", completed: "已要求停止工作流程" },
  t3_thread_interrupt: { phrase: "中斷 T3 對話", completed: "已要求中斷 T3 對話" },
  t3_worktree_handoff: { phrase: "把對話交接到工作樹" },
  t3_worktree_status: { phrase: "取得對話的工作樹狀態" },
  preview_status: { phrase: "取得預覽瀏覽器狀態" },
  preview_open: { phrase: "開啟預覽瀏覽器頁面" },
  preview_navigate: { phrase: "切換預覽瀏覽器頁面" },
  preview_dialog: { phrase: "回應預覽瀏覽器對話框" },
  preview_snapshot: { phrase: "擷取預覽頁面快照" },
  preview_click: { phrase: "點擊預覽瀏覽器" },
  preview_press: { phrase: "對預覽瀏覽器按鍵" },
  preview_type: { phrase: "對預覽瀏覽器輸入文字" },
  preview_hover: { phrase: "懸停預覽瀏覽器元素" },
  preview_select: { phrase: "選擇預覽瀏覽器選項" },
  preview_drag: { phrase: "拖曳預覽瀏覽器元素" },
  preview_upload: { phrase: "上傳檔案到預覽瀏覽器" },
  preview_scroll: { phrase: "捲動預覽瀏覽器" },
  preview_resize: { phrase: "調整預覽瀏覽器大小" },
  preview_evaluate: { phrase: "執行預覽瀏覽器腳本" },
  preview_wait_for: { phrase: "等候預覽頁面" },
  preview_set_appearance: { phrase: "設定預覽瀏覽器外觀" },
  preview_recording_start: { phrase: "開始錄製預覽瀏覽器" },
  preview_recording_stop: { phrase: "停止錄製預覽瀏覽器" },
  device_list: { phrase: "列出模擬器" },
  device_open: { phrase: "開啟裝置" },
  device_screenshot: { phrase: "擷取裝置截圖" },
  device_close: { phrase: "關閉裝置" },
  run_scheduled_task_now: { phrase: "執行排程任務", completed: "已要求執行排程任務" },
  t3_queue_list: { phrase: "列出佇列訊息" },
  t3_queue_read: { phrase: "讀取佇列訊息" },
  t3_queue_edit: { phrase: "編輯佇列訊息" },
  t3_queue_cancel: { phrase: "取消佇列中的執行", completed: "已要求取消佇列中的執行" },
  t3_queue_reorder: { phrase: "重新排序佇列中的執行" },
  t3_queue_promote_to_steer: { phrase: "用佇列訊息引導", completed: "已要求用佇列訊息引導" },
  t3_pending_request_list: { phrase: "列出待處理的問題" },
  t3_pending_request_read: { phrase: "讀取待處理的問題" },
  t3_pending_request_respond: { phrase: "回答待處理的問題" },
  t3_thread_configuration: { phrase: "讀取對話設定" },
  t3_thread_configure: { phrase: "設定對話模型" },
  t3_thread_fork: { phrase: "分支這個對話", completed: "已要求分支這個對話" },
  t3_thread_merge_back: { phrase: "合併對話脈絡", completed: "已要求合併對話脈絡" },
  t3_thread_search: { phrase: "搜尋對話內容" },
  t3_thread_transfers: { phrase: "讀取對話轉移紀錄" },
  t3_thread_organize: { phrase: "整理對話" },
  t3_thread_update: { phrase: "更新 T3 對話資訊" },
  t3_worktree_list: { phrase: "列出工作區分支" },
  t3_preview_list: { phrase: "列出預覽分頁" },
  t3_preview_close: { phrase: "關閉預覽分頁" },
  t3_environment_read: { phrase: "讀取環境偏好設定" },
  t3_environment_preferences_update: { phrase: "更新環境偏好設定" },
  t3_thread_launch: { phrase: "啟動專案對話" },
  t3_project_list: { phrase: "列出專案" },
  t3_project_read: { phrase: "讀取專案" },
  t3_project_create: { phrase: "註冊專案" },
  t3_project_update: { phrase: "更新專案" },
  t3_project_delete: { phrase: "刪除專案" },
  t3_project_clone: { phrase: "複製存放庫" },
  t3_attachment_prepare_upload: { phrase: "準備上傳附件" },
  t3_attachment_discard: { phrase: "捨棄待傳附件" },
  t3_thread_send_attachments: { phrase: "傳送附件" },
  html_preview: { phrase: "預覽 HTML 頁面" },
  html_render: { phrase: "轉譯 HTML 頁面" },
};

/** Taiwan style puts a half-width space between Chinese and Latin letters or digits. */
function spaced(text: string): string {
  return text
    .replace(/([㐀-鿿])([A-Za-z0-9#])/g, "$1 $2")
    .replace(/([A-Za-z0-9])([㐀-鿿])/g, "$1 $2");
}

function toolText(toolId: string | null): ToolText | null {
  return toolId !== null && usesChineseDurations() ? (TOOLS[toolId] ?? null) : null;
}

/** Tool ids with zh-TW text, for the fork test that keeps this table complete. */
export const LOCALIZED_T3_MCP_TOOL_IDS: ReadonlySet<string> = new Set(Object.keys(TOOLS));

/** The tool's name, as `displayName` gives it in English. Null in English or for an unknown tool. */
export function localizedT3McpToolName(toolId: string | null): string | null {
  const text = toolText(toolId);
  return text ? spaced(text.phrase.replace("{target}", text.target ?? "")) : null;
}

/**
 * A work log row's title. `target` is the pull request (`PR #12`) that replaced the English
 * object, or null. Null in English or for an unknown tool.
 */
export function localizedT3McpToolTitle(
  toolId: string | null,
  status: string | undefined,
  target: string | null,
): string | null {
  const text = toolText(toolId);
  if (!text) return null;
  const object = target ?? text.target ?? "";
  const phrase = text.phrase.replace("{target}", object);
  switch (status) {
    case "completed":
      return spaced(text.completed?.replace("{target}", object) ?? `已${phrase}`);
    case "failed":
      return spaced(`無法${phrase}`);
    case "declined":
      return spaced(`已拒絕${phrase}`);
    case "stopped":
      return spaced(`已停止${phrase}`);
    default:
      return spaced(`正在${phrase}`);
  }
}

/** Completed summaries by the English verb that opens them; `{o}` is the translated object. */
const DONE: ReadonlyArray<readonly [english: string, chinese: string]> = [
  ["Requested cancellation of", "已要求取消{o}"],
  ["Requested deletion of", "已要求刪除{o}"],
  ["Requested interrupts for", "已要求中斷{o}"],
  ["Requested steering with", "已要求用{o}引導"],
  ["Requested stops for", "已要求停止{o}"],
  ["Requested", "已要求{o}"],
  ["Stopped watching", "停止監看了{o}"],
  ["Started writing", "已開始撰寫{o}"],
  ["Started", "已開始{o}"],
  ["Handed off to", "已交接到{o}"],
  ["Waited on", "等候了{o}"],
  ["Asked for", "索取了{o}"],
  ["Delegated", "委派了{o}"],
  ["Sent", "傳送了{o}"],
  ["Read", "讀取了{o}"],
  ["Listed", "列出了{o}"],
  ["Checked", "查看了{o}"],
  ["Scheduled", "排程了{o}"],
  ["Updated", "更新了{o}"],
  ["Set", "設定了{o}"],
  ["Searched", "搜尋了{o}"],
  ["Organized", "整理了{o}"],
  ["Edited", "編輯了{o}"],
  ["Reordered", "重新排序了{o}"],
  ["Answered", "回答了{o}"],
  ["Registered", "註冊了{o}"],
  ["Deleted", "刪除了{o}"],
  ["Cloned", "複製了{o}"],
  ["Prepared", "準備了{o}"],
  ["Discarded", "捨棄了{o}"],
  ["Unlinked", "取消連結了{o}"],
  ["Linked", "連結了{o}"],
  ["Watching", "開始監看{o}"],
  ["Used", "使用了{o}"],
  ["Previewed", "預覽了{o}"],
  ["Rendered", "轉譯了{o}"],
];

/** `Tried to …` summaries by the English infinitive. */
const TRIED: ReadonlyArray<readonly [english: string, chinese: string]> = [
  ["stop watching", "停止監看{o}"],
  ["start writing", "開始撰寫{o}"],
  ["hand off to", "交接到{o}"],
  ["steer with", "用{o}引導"],
  ["wait on", "等候{o}"],
  ["ask for", "索取{o}"],
  ["interrupt", "中斷{o}"],
  ["delegate", "委派{o}"],
  ["schedule", "排程{o}"],
  ["register", "註冊{o}"],
  ["organize", "整理{o}"],
  ["discard", "捨棄{o}"],
  ["prepare", "準備{o}"],
  ["preview", "預覽{o}"],
  ["reorder", "重新排序{o}"],
  ["request", "要求{o}"],
  ["unlink", "取消連結{o}"],
  ["update", "更新{o}"],
  ["search", "搜尋{o}"],
  ["cancel", "取消{o}"],
  ["delete", "刪除{o}"],
  ["answer", "回答{o}"],
  ["render", "轉譯{o}"],
  ["clone", "複製{o}"],
  ["check", "查看{o}"],
  ["start", "開始{o}"],
  ["watch", "監看{o}"],
  ["edit", "編輯{o}"],
  ["list", "列出{o}"],
  ["link", "連結{o}"],
  ["read", "讀取{o}"],
  ["send", "傳送{o}"],
  ["stop", "停止{o}"],
  ["set", "設定{o}"],
  ["use", "使用{o}"],
];

/** Counted nouns: singular, plural, measure word, noun. */
const COUNTED: ReadonlyArray<readonly [string, string, string, string]> = [
  ["scheduled task run", "scheduled task runs", "次", "排程任務執行"],
  ["scheduled task", "scheduled tasks", "個", "排程任務"],
  ["pending question request", "pending question requests", "個", "待處理的問題"],
  ["queued message", "queued messages", "則", "佇列訊息"],
  ["queued run", "queued runs", "個", "佇列中的執行"],
  ["attachment upload", "attachment uploads", "個", "附件上傳"],
  ["pending attachment", "pending attachments", "個", "待傳附件"],
  ["attachment", "attachments", "個", "附件"],
  ["pull request", "pull requests", "個", "提取請求"],
  ["review guide", "review guides", "份", "審查指南"],
  ["context merge", "context merges", "次", "脈絡合併"],
  ["thread fork", "thread forks", "次", "對話分支"],
  ["HTML page", "HTML pages", "個", "HTML 頁面"],
  ["repository", "repositories", "個", "存放庫"],
  ["workflow", "workflows", "個", "工作流程"],
  ["worktree", "worktrees", "個", "工作樹"],
  ["message", "messages", "則", "訊息"],
  ["project", "projects", "個", "專案"],
  ["thread", "threads", "個", "對話"],
  ["secret", "secrets", "個", "密鑰"],
  ["task", "tasks", "個", "任務"],
];

/** Uncounted objects, followed by `N times` or standing alone. */
const OBJECTS: Readonly<Record<string, string>> = {
  "orchestration capabilities": "協調能力",
  "environment preferences": "環境偏好設定",
  "linked pull requests": "已連結的提取請求",
  "thread configuration": "對話設定",
  "workspace branches": "工作區分支",
  "pending questions": "待處理的問題",
  "thread transfers": "對話轉移紀錄",
  "queued messages": "佇列訊息",
  "scheduled tasks": "排程任務",
  "worktree status": "工作樹狀態",
  "device controls": "裝置控制",
  "review guides": "審查指南",
  "thread model": "對話模型",
  "task status": "任務狀態",
  "background waits": "背景等候",
  attachments: "附件",
  messages: "訊息",
  projects: "專案",
  threads: "對話",
  browser: "瀏覽器",
};

function translateObject(object: string): string | null {
  const times = /^(.+) (\d+) times?$/.exec(object);
  if (times) {
    const rest = translateObject(times[1]!);
    return rest === null ? null : `${rest} ${times[2]} 次`;
  }
  const failed = /^(.+), (\d+) failed$/.exec(object);
  if (failed) {
    const rest = translateObject(failed[1]!);
    return rest === null ? null : `${rest}，${failed[2]} 個失敗`;
  }
  const to = /^(.+) to (\d+) threads?$/.exec(object);
  if (to) {
    const rest = translateObject(to[1]!);
    return rest === null ? null : `${rest}到 ${to[2]} 個對話`;
  }
  const counted = /^(\d+) (.+)$/.exec(object);
  if (counted) {
    const noun = COUNTED.find(([one, many]) => counted[2] === one || counted[2] === many);
    return noun ? `${counted[1]} ${noun[2]}${noun[3]}` : null;
  }
  return OBJECTS[object] ?? null;
}

/**
 * A summary from `summarizeT3ToolCalls`, such as `Delegated 2 tasks` or `Tried to read
 * threads 3 times`. Null in English, or when a sentence has no translation, so a reworded
 * upstream summary stays whole English instead of half translated.
 */
export function localizedT3ToolSummary(label: string): string | null {
  if (!usesChineseDurations()) return null;
  const whole =
    /^Created (\d+) threads?$/.exec(label) ??
    /^Requested thread creation (\d+) times?$/.exec(label) ??
    /^Could not start (\d+) review guides?$/.exec(label);
  if (whole) {
    const count = whole[1]!;
    if (label.startsWith("Created")) return `建立了 ${count} 個對話`;
    if (label.startsWith("Requested")) return `已要求建立對話 ${count} 次`;
    return `無法開始 ${count} 份審查指南`;
  }
  let template: string | undefined;
  let object = "";
  if (label.startsWith("Tried to ")) {
    const rest = label.slice("Tried to ".length);
    const match = TRIED.find(([verb]) => rest.startsWith(`${verb} `));
    if (match) {
      template = `嘗試${match[1]}`;
      object = rest.slice(match[0].length + 1);
    }
  } else {
    const match = DONE.find(([verb]) => label.startsWith(`${verb} `));
    if (match) {
      template = match[1];
      object = label.slice(match[0].length + 1);
    }
  }
  if (template === undefined) return null;
  const translated = translateObject(object);
  return translated === null ? null : spaced(template.replace("{o}", translated));
}

/** Joins a work log group's summaries. Null in English, which joins with commas and `and`. */
export function localizedWorkLogSummaryJoin(labels: ReadonlyArray<string>): string | null {
  return usesChineseDurations() ? labels.join("、") : null;
}

/** A group of reasoning entries only, `Thought (×3)` in English. */
export function localizedThoughtGroupSummary(count: number): string | null {
  if (!usesChineseDurations()) return null;
  return count === 1 ? "已思考" : `已思考（×${count}）`;
}
