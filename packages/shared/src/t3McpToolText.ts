import { usesChineseDurations } from "./durationFormat.ts";

/**
 * zh-TW names for T3 tools, including the fork's own, ahead of gt-react's catalog. It follows the
 * clients' locale through `setChineseDurations`; the server never sets it, so agents read English.
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
  link_pull_requests: { phrase: "連結提取請求" },
  unlink_pull_requests: { phrase: "依狀態取消連結提取請求" },
  list_thread_pull_requests: { phrase: "查看已連結的提取請求" },
  watch_pull_request: { phrase: "監看{target}", completed: "已開始監看{target}", ...PR },
  unwatch_pull_request: { phrase: "停止監看{target}", ...PR },
  write_pull_request_guides: { phrase: "撰寫審查指南", completed: "已開始撰寫審查指南" },
  read_pull_request_guide: { phrase: "讀取審查指南" },
  orchestrator_capabilities: { phrase: "取得協調能力" },
  provider_usage: { phrase: "取得供應商用量" },
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
  preview_act: { phrase: "操作預覽瀏覽器" },
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
  t3_queue: { phrase: "管理佇列訊息" },
  t3_queue_list: { phrase: "列出佇列訊息" },
  t3_queue_read: { phrase: "讀取佇列訊息" },
  t3_queue_edit: { phrase: "編輯佇列訊息" },
  t3_queue_cancel: { phrase: "取消佇列中的執行", completed: "已要求取消佇列中的執行" },
  t3_queue_reorder: { phrase: "重新排序佇列中的執行" },
  t3_queue_promote_to_steer: { phrase: "用佇列訊息引導", completed: "已要求用佇列訊息引導" },
  t3_pending_request: { phrase: "處理待回覆的問題" },
  t3_pending_request_list: { phrase: "列出待處理的問題" },
  t3_pending_request_read: { phrase: "讀取待處理的問題" },
  t3_pending_request_respond: { phrase: "回答待處理的問題" },
  t3_thread_configuration: { phrase: "讀取對話設定" },
  t3_thread_configure: { phrase: "設定對話模型" },
  t3_thread_fork: { phrase: "分支這個對話", completed: "已要求分支這個對話" },
  t3_thread_merge_back: { phrase: "合併對話脈絡", completed: "已要求合併對話脈絡" },
  t3_thread_search: { phrase: "搜尋對話內容" },
  t3_thread_transfer: { phrase: "處理對話轉移" },
  t3_thread_transfers: { phrase: "讀取對話轉移紀錄" },
  t3_thread_organize: { phrase: "整理對話" },
  t3_thread_update: { phrase: "更新 T3 對話資訊" },
  t3_worktree_list: { phrase: "列出工作區分支" },
  t3_preview_list: { phrase: "列出預覽分頁" },
  t3_preview_close: { phrase: "關閉預覽分頁" },
  t3_environment_read: { phrase: "讀取環境偏好設定" },
  t3_environment_links: { phrase: "列出已連結的環境" },
  t3_environment_link: { phrase: "要求連結環境" },
  t3_environment_unlink: { phrase: "移除已連結的環境" },
  t3_environment_preferences_update: { phrase: "更新環境偏好設定" },
  t3_machine_call: { phrase: "呼叫其他機器的工具" },
  t3_theme_read: { phrase: "讀取主題" },
  t3_theme_set: { phrase: "設定主題" },
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
  send_to_user: { phrase: "傳送訊息" },
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

/** The tool's name, as `displayName` gives it in English. Null in English or for an unknown tool. */
export function localizedT3McpToolName(toolId: string | null): string | null {
  const text = toolText(toolId);
  return text ? spaced(text.phrase.replace("{target}", text.target ?? "")) : null;
}
