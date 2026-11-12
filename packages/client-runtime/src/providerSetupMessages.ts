/**
 * Fork: server-written text from provider sign-in, managed installation, updates and usage
 * limits, shown in Settings → Providers. `translateProviderStatusMessage` checks this table
 * first; text not listed here stays English.
 */

const EXACT: Readonly<Record<string, string>> = {
  // Extensions (Settings → Maintenance; fork patch 30)
  "Calls to your other machines": "呼叫你的其他機器",
  "The t3_machine_call tool, which lets agents use T3 tools on your other machines. Changes apply after the server restarts.":
    "t3_machine_call 工具，讓代理程式使用你其他機器上的 T3 工具。變更會在伺服器重新啟動後套用。",
  "Interface language selector": "介面語言選擇器",
  "The language section in Settings → General and Appearance.":
    "「設定 → 一般」和「外觀」裡的語言區塊。",
  "Tailnet server suggestions": "tailnet 伺服器建議",
  "Servers found on your tailnet, offered when you add an environment. The mobile app keeps showing them.":
    "新增環境時，列出在你的 tailnet 上找到的伺服器。行動版 App 仍會顯示。",
  "Summary badge": "摘要標記",
  "Marks a Claude update that is the provider's summary, not the agent's words.":
    "標出 Claude 的進度說明其實是供應商給的摘要，不是代理程式的原話。",
  "Ephemeral thread watcher": "無痕對話監看",
  "Keeps ephemeral threads out of this device's storage and window title.":
    "讓無痕對話不留在這部裝置的儲存空間和視窗標題裡。",
  "Extension manager": "擴充功能管理",
  "This list, and loading the extensions you install.": "這份清單，以及載入你安裝的擴充功能。",
  "The server could not be reached.": "無法連到伺服器。",
  "A built-in extension can be turned off, not removed.": "內建的擴充功能只能停用，不能移除。",
  "This extension cannot be turned off.": "這個擴充功能不能停用。",
  "The marketplace index is not in the expected format.": "市集索引的格式不符預期。",
  "This server does not manage extensions.": "這台伺服器不管理擴充功能。",
  "The extension list could not be saved.": "無法儲存擴充功能清單。",
  // Provider sign-in (ProviderAuthService)
  "This provider does not support sign-in in T3 Code.": "這個供應商不支援在 T3 Code 中登入。",
  "This provider instance is no longer available.": "這個供應商執行個體已不存在。",
  "Could not read the provider's active sessions. Try again.":
    "無法讀取這個供應商進行中的工作階段，請再試一次。",
  "Provider sign-in changed.": "供應商登入狀態已變更。",
  "Could not stop all sessions for this provider. Try again.":
    "無法停止這個供應商的所有工作階段，請再試一次。",
  "Another provider instance is changing this shared sign-in. Finish or cancel it first.":
    "另一個供應商執行個體正在變更這個共用的登入，請先完成或取消它。",
  "This provider does not support ChatGPT profile transfer.":
    "這個供應商不支援轉移 ChatGPT 設定檔。",
  "This provider does not accept this sign-in interaction.": "這個供應商不接受這種登入互動。",
  "This provider does not support removing saved sign-in methods.":
    "這個供應商不支援移除已儲存的登入方式。",
  "Sign-in is in progress in another client.": "另一個用戶端正在登入。",
  "This sign-in is no longer active in this client.": "這個登入在此用戶端已失效。",

  // Antigravity sign-in
  "Antigravity has not reached Google after 30 seconds. Check this machine's network connection. Broken IPv6 is a common cause.":
    "Antigravity 30 秒內仍連不到 Google。請檢查這台電腦的網路連線，IPv6 故障是常見原因。",
  "Antigravity could not reach Google. Check this machine's network connection, then start sign-in again.":
    "Antigravity 連不到 Google。請檢查這台電腦的網路連線，再重新登入。",
  "Could not deliver the sign-in response. Start sign-in again.": "無法送出登入回應，請重新登入。",
  "Google requires an eligible Antigravity subscription for this account.":
    "Google 要求這個帳號具備符合資格的 Antigravity 訂閱。",
  "Google sign-in was not approved. Start sign-in again.": "Google 登入未獲核准，請重新登入。",
  "Antigravity authenticated, but could not initialize a session or load models.":
    "Antigravity 已驗證，但無法初始化工作階段或載入模型。",
  "Antigravity rejected the configured credentials. Check the provider settings.":
    "Antigravity 拒絕了設定的憑證，請檢查供應商設定。",
  "Google sign-in failed. Start sign-in again.": "Google 登入失敗，請重新登入。",
  "Antigravity could not authenticate with the configured credentials.":
    "Antigravity 無法用設定的憑證驗證。",
  "Antigravity sign-in or sign-out is in progress. Try again after it finishes.":
    "Antigravity 正在登入或登出，完成後再試一次。",
  "Signed in with Google.": "已使用 Google 登入。",
  "Connected to Antigravity.": "已連線到 Antigravity。",
  "Antigravity started more than one Google sign-in request.":
    "Antigravity 發出了不只一個 Google 登入請求。",
  "Open the Google sign-in link. If you are remote, paste the redirect URL here.":
    "開啟 Google 登入連結。如果你在遠端，請把重新導向網址貼到這裡。",
  "Checking Antigravity access and models.": "正在檢查 Antigravity 存取權與模型。",
  "Google sign-in expired. Start sign-in again.": "Google 登入已過期，請重新登入。",
  "Antigravity setup is already in progress.": "Antigravity 已在設定中。",
  "Could not start Google sign-in. Try again.": "無法開始 Google 登入，請再試一次。",
  "Starting Google sign-in.": "正在開始 Google 登入。",
  "Checking credentials.": "正在檢查憑證。",
  "The sign-in response was already sent. Wait for Google to finish.":
    "登入回應已送出，請等 Google 完成。",
  "Wait for the Google sign-in link before you send a redirect URL.":
    "請等 Google 登入連結出現後再送出重新導向網址。",
  "Waiting for Google to finish sign-in.": "正在等 Google 完成登入。",
  "Google sign-in was cancelled.": "Google 登入已取消。",
  "Antigravity setup is already stopping.": "Antigravity 設定已在停止中。",
  "Google sign-in was cancelled by sign-out.": "Google 登入因登出而取消。",
  "This Antigravity version does not support sign-out. Update the provider.":
    "這個 Antigravity 版本不支援登出，請更新供應商。",
  "Antigravity sign-out timed out.": "Antigravity 登出逾時。",
  "Signed out of Google.": "已登出 Google。",
  "Antigravity sign-out failed. Try again.": "Antigravity 登出失敗，請再試一次。",
  "The sign-in response URL is too long.": "登入回應網址太長。",
  "Paste the complete redirect URL from the Google sign-in page.":
    "請貼上 Google 登入頁面的完整重新導向網址。",
  "This redirect URL does not belong to the current sign-in.": "這個重新導向網址不屬於目前的登入。",
  "The redirect URL must contain one Google sign-in response.":
    "重新導向網址必須包含一個 Google 登入回應。",
  "The redirect URL is not a Google sign-in response.": "這個重新導向網址不是 Google 登入回應。",
  "The sign-in response timed out. Start sign-in again.": "登入回應逾時，請重新登入。",

  // Antigravity managed runtime
  "The managed runtime record is invalid. Reinstall Antigravity.":
    "受管理的執行環境紀錄無效，請重新安裝 Antigravity。",
  "The managed Antigravity runtime is incomplete. Reinstall it.":
    "受管理的 Antigravity 執行環境不完整，請重新安裝。",
  "The custom Antigravity executable is missing or not executable, or it needs a localharness_external sibling. The agy CLI does not.":
    "自訂的 Antigravity 執行檔不存在或無法執行，或是旁邊缺少 localharness_external。agy CLI 不需要它。",
  "Antigravity ACP runtime is not installed. Install it in this environment's provider settings or set a custom ACP executable path. The Antigravity app, IDE, and CLI are separate installations.":
    "尚未安裝 Antigravity ACP 執行環境。請在這個環境的供應商設定中安裝，或設定自訂的 ACP 執行檔路徑。Antigravity App、IDE 與 CLI 是分開安裝的。",
  "Could not read the Antigravity installation. Reinstall it or set a custom executable path.":
    "無法讀取 Antigravity 安裝，請重新安裝或設定自訂執行檔路徑。",
  "The downloaded runtime did not identify as the expected Google Antigravity release.":
    "下載的執行環境不是預期的 Google Antigravity 版本。",
  "Antigravity requires IPv6 socket support. Enable IPv6 in this environment. On WSL, remove ipv6.disable=1 from .wslconfig and run wsl --shutdown.":
    "Antigravity 需要 IPv6 socket 支援，請在這個環境啟用 IPv6。WSL 上請從 .wslconfig 移除 ipv6.disable=1，再執行 wsl --shutdown。",
  "The downloaded Antigravity runtime could not start in this environment.":
    "下載的 Antigravity 執行環境無法在這個環境啟動。",
  "Could not activate Antigravity. The previous runtime is unchanged. Check for locked files and try again.":
    "無法啟用 Antigravity，先前的執行環境沒有變動。請檢查是否有被鎖定的檔案，再試一次。",
  "The existing managed release has the wrong version. Remove it before reinstalling.":
    "現有的受管理版本不對，請先移除再重新安裝。",
  "Checking the installed runtime.": "正在檢查已安裝的執行環境。",
  "Could not check free disk space.": "無法檢查可用磁碟空間。",
  "The Antigravity download size did not match the pinned release.":
    "Antigravity 下載的大小與指定版本不符。",
  "The Antigravity download exceeded the pinned release size.":
    "Antigravity 下載超過指定版本的大小。",
  "The Antigravity download failed its size or SHA-256 check. Nothing was installed.":
    "Antigravity 下載未通過大小或 SHA-256 檢查，沒有安裝任何東西。",
  "Extracting the verified runtime.": "正在解壓已驗證的執行環境。",
  "The archive must contain exactly the Antigravity executable and its harness.":
    "壓縮檔只能包含 Antigravity 執行檔與它的 harness。",
  "The archive contains an unexpected, unsafe, or incorrectly sized member.":
    "壓縮檔含有不預期、不安全或大小不對的項目。",
  "Could not extract the Antigravity runtime.": "無法解壓 Antigravity 執行環境。",
  "An archive member exceeded its pinned size.": "壓縮檔中的項目超過指定大小。",
  "An archive member was truncated.": "壓縮檔中的項目不完整。",
  "The archive is missing the Antigravity executable or its harness.":
    "壓縮檔缺少 Antigravity 執行檔或它的 harness。",
  "Could not prepare the Antigravity runtime for this Mac. Check that codesign is available.":
    "無法為這台 Mac 準備 Antigravity 執行環境，請確認 codesign 可以使用。",
  "Checking the downloaded runtime.": "正在檢查下載的執行環境。",
  "Another installation published a different Antigravity release.":
    "另一個安裝程序發布了不同的 Antigravity 版本。",
  "Could not publish the Antigravity runtime. The previous release is unchanged. Try again.":
    "無法發布 Antigravity 執行環境，先前的版本沒有變動。請再試一次。",
  "Could not install Antigravity. Check free disk space and directory access, then try again.":
    "無法安裝 Antigravity。請檢查可用磁碟空間與資料夾存取權，再試一次。",
  "Downloading Google's official Antigravity runtime.":
    "正在下載 Google 官方的 Antigravity 執行環境。",
  "Installation cancelled. The previous runtime is unchanged.":
    "已取消安裝，先前的執行環境沒有變動。",
  "Could not finish the Antigravity installation. Check disk space and directory access.":
    "無法完成 Antigravity 安裝，請檢查磁碟空間與資料夾存取權。",
  "Could not start the Antigravity installation.": "無法開始安裝 Antigravity。",
  "This installation is no longer current. Refresh its status before cancelling.":
    "這次安裝已不是最新狀態，請先重新整理狀態再取消。",
  "Stop Antigravity sessions and sign-in flows before removing its managed runtime.":
    "移除受管理的執行環境前，請先停止 Antigravity 的工作階段與登入流程。",
  "A provider instance has a custom path inside this managed runtime. Clear that path before removing it.":
    "有供應商執行個體的自訂路徑位在這個受管理的執行環境裡，請先清除該路徑再移除。",
  "Could not remove the managed Antigravity runtime. Check for open processes and try again.":
    "無法移除受管理的 Antigravity 執行環境，請檢查是否有開啟中的程序，再試一次。",
  "The managed Antigravity runtime is incomplete. Remove it and reinstall.":
    "受管理的 Antigravity 執行環境不完整，請移除後重新安裝。",

  // Codex managed runtime
  "The managed Codex installation record is invalid. Reinstall Codex.":
    "受管理的 Codex 安裝紀錄無效，請重新安裝 Codex。",
  "The downloaded Codex package does not match the expected release.":
    "下載的 Codex 套件與預期版本不符。",
  "The managed Codex package is incomplete. Reinstall Codex.":
    "受管理的 Codex 套件不完整，請重新安裝 Codex。",
  "The managed Codex installation record has the wrong version.":
    "受管理的 Codex 安裝紀錄版本不對。",
  "Update the managed Codex installation to continue.": "請更新受管理的 Codex 安裝後再繼續。",
  "Codex is not installed in T3 Code. Install it to continue.":
    "T3 Code 中尚未安裝 Codex，請先安裝再繼續。",
  "Could not unpack or start the downloaded Codex package.": "無法解開或啟動下載的 Codex 套件。",
  "The downloaded Codex executable has the wrong version.": "下載的 Codex 執行檔版本不對。",
  "The downloaded Codex runtime could not start.": "下載的 Codex 執行環境無法啟動。",
  "The existing managed Codex release differs from the official package. Remove it and reinstall.":
    "現有的受管理 Codex 版本與官方套件不同，請移除後重新安裝。",
  "The Codex download exceeded the expected release size.": "Codex 下載超過預期版本的大小。",
  "The Codex download timed out. Retry installation.": "Codex 下載逾時，請重新安裝。",
  "The Codex download failed its size or SHA-256 check. Nothing was installed.":
    "Codex 下載未通過大小或 SHA-256 檢查，沒有安裝任何東西。",
  "Extracting Codex.": "正在解壓 Codex。",
  "The Codex archive contains unsafe entries.": "Codex 壓縮檔含有不安全的項目。",
  "Checking Codex.": "正在檢查 Codex。",
  "The Codex download was interrupted. Check your internet connection, then retry installation.":
    "Codex 下載中斷。請檢查網路連線，再重新安裝。",
  "Could not install Codex. Check disk space and directory access, then try again.":
    "無法安裝 Codex。請檢查磁碟空間與資料夾存取權，再試一次。",
  "Downloading Codex.": "正在下載 Codex。",
  "Could not finish the Codex installation. Check disk space and directory access.":
    "無法完成 Codex 安裝，請檢查磁碟空間與資料夾存取權。",
  "Could not start the Codex installation.": "無法開始安裝 Codex。",
  "Stop Codex sessions and sign-in flows before removing its managed runtime.":
    "移除受管理的執行環境前，請先停止 Codex 的工作階段與登入流程。",
  "A provider instance uses a custom path inside managed Codex. Clear that path before removing it.":
    "有供應商執行個體使用受管理 Codex 裡的自訂路徑，請先清除該路徑再移除。",
  "Could not remove the managed Codex runtime. Check for open processes and try again.":
    "無法移除受管理的 Codex 執行環境，請檢查是否有開啟中的程序，再試一次。",
  "The managed Codex runtime is incomplete. Remove it and reinstall.":
    "受管理的 Codex 執行環境不完整，請移除後重新安裝。",
  "Could not read provider installation settings.": "無法讀取供應商安裝設定。",
  "Managed installation is not available for this provider instance.":
    "這個供應商執行個體不提供受管理的安裝。",
  "The provider instance configuration is invalid.": "供應商執行個體的設定無效。",
  "Choose managed setup to install Codex in T3 Code.":
    "請選擇受管理的設定，在 T3 Code 中安裝 Codex。",
  "This instance uses a custom executable. Clear its binary path to manage installation in T3 Code.":
    "這個執行個體使用自訂執行檔。清除它的執行檔路徑，才能由 T3 Code 管理安裝。",
  "Could not lock the ChatGPT connection for an update. Try again.":
    "無法鎖定 ChatGPT 連線來更新，請再試一次。",
  "Signed in with ChatGPT, but token sharing is disabled. Sign in again and enable token sharing, or use another provider.":
    "已使用 ChatGPT 登入，但權杖共用已停用。請重新登入並啟用權杖共用，或改用其他供應商。",
  "ChatGPT tracks subscription usage across connected apps. Open Usage settings with the account you connected to Codex.":
    "ChatGPT 會合計各個已連結 App 的訂閱用量。請用連結到 Codex 的帳號開啟用量設定。",
  "The ChatGPT connection changed while checking Codex. Retry.":
    "檢查 Codex 時 ChatGPT 連線變更了，請重試。",
  "Could not prepare managed Codex.": "無法準備受管理的 Codex。",
  "Could not prepare the private managed Codex token listener. Restart T3 and retry.":
    "無法準備受管理 Codex 的私有權杖監聽程序，請重新啟動 T3 再試一次。",
  "Set up managed Codex before starting a session.": "開始工作階段前，請先設定受管理的 Codex。",
  "Could not prepare the managed Codex runtime.": "無法準備受管理的 Codex 執行環境。",

  // Cursor sign-in
  "Could not read the Cursor sign-in. Try signing in again.": "無法讀取 Cursor 登入，請重新登入。",
  "Cursor sign-in or sign-out is in progress. Try again after it finishes.":
    "Cursor 正在登入或登出，完成後再試一次。",
  "Could not load the Cursor SDK. Try signing in again.": "無法載入 Cursor SDK，請重新登入。",
  "Open the Cursor sign-in page and finish signing in. This page updates automatically.":
    "開啟 Cursor 登入頁面並完成登入，這個頁面會自動更新。",
  "Cursor sign-in failed. Start sign-in again.": "Cursor 登入失敗，請重新登入。",
  "Checking Cursor sign-in.": "正在檢查 Cursor 登入。",
  "Could not save the Cursor sign-in. Try again.": "無法儲存 Cursor 登入，請再試一次。",
  "Could not clear the rejected Cursor sign-in. Try signing out.":
    "無法清除被拒絕的 Cursor 登入，請試著登出。",
  "Signed in with Cursor.": "已使用 Cursor 登入。",
  "Cursor sign-in expired. Start sign-in again.": "Cursor 登入已過期，請重新登入。",
  "Cursor sign-in failed or expired. Start sign-in again.": "Cursor 登入失敗或已過期，請重新登入。",
  "Enable Cursor before signing in.": "登入前請先啟用 Cursor。",
  "Remove CURSOR_API_KEY from this provider's environment before using browser sign-in.":
    "使用瀏覽器登入前，請先從這個供應商的環境變數移除 CURSOR_API_KEY。",
  "Cursor setup is already in progress.": "Cursor 已在設定中。",
  "Could not start Cursor sign-in. Try again.": "無法開始 Cursor 登入，請再試一次。",
  "Starting Cursor sign-in.": "正在開始 Cursor 登入。",
  "Finish signing in on the Cursor website. No redirect URL is needed.":
    "請在 Cursor 網站完成登入，不需要重新導向網址。",
  "Cursor sign-in was cancelled.": "Cursor 登入已取消。",
  "Remove CURSOR_API_KEY from this provider's environment to disconnect it.":
    "請從這個供應商的環境變數移除 CURSOR_API_KEY 來中斷連線。",
  "Cursor setup is already stopping.": "Cursor 設定已在停止中。",
  "Could not clear the Cursor sign-in. Try again.": "無法清除 Cursor 登入，請再試一次。",
  "Signed out of Cursor.": "已登出 Cursor。",
  "Cursor sign-out failed. Try again.": "Cursor 登出失敗，請再試一次。",

  // Updates and resets
  "OpenCode CLI updated. Restart the configured local OpenCode server to use the new version.":
    "OpenCode CLI 已更新。請重新啟動設定的本機 OpenCode 伺服器，才會使用新版本。",
  "Already up to date.": "已是最新版本。",
  "Claude could not redeem the reset.": "Claude 無法兌換重設額度。",
  "Codex could not redeem the reset credit.": "Codex 無法兌換重設額度。",
  "The reset was applied, but Claude could not confirm the new limits. Refresh to check.":
    "已套用重設，但 Claude 無法確認新的用量上限。請重新整理確認。",
  "The reset was applied, but Codex could not confirm the new limits. Refresh to check.":
    "已套用重設，但 Codex 無法確認新的用量上限。請重新整理確認。",

  // Antigravity usage limits
  "Sign in with Google to see Antigravity limits.":
    "使用 Google 登入後才能查看 Antigravity 用量上限。",
  "Antigravity did not return usable quota information.": "Antigravity 沒有回傳可用的配額資訊。",
  "Could not read Antigravity limits. Refresh provider status to retry.":
    "無法讀取 Antigravity 用量上限，請重新整理供應商狀態再試。",

  // Settings form text from provider and source control settings schemas (contracts and
  // provider packages), which the build-time pass does not reach. ProviderSettingsForm.fork.test.ts
  // fails when a schema gains text missing here.
  "Binary path": "執行檔路徑",
  "Path to the Codex binary used by this instance.": "這個執行個體使用的 Codex 執行檔路徑。",
  "CODEX_HOME path": "CODEX_HOME 路徑",
  "Custom Codex home and config directory.": "自訂的 Codex 主目錄與設定目錄。",
  "Shadow home path": "影子主目錄路徑",
  "Account-specific Codex home. Keeps auth.json separate while sharing state from CODEX_HOME.":
    "帳號專屬的 Codex 主目錄。auth.json 分開存放，其他狀態與 CODEX_HOME 共用。",
  "Launch arguments": "啟動參數",
  "Additional CLI arguments passed to codex app-server on session start.":
    "工作階段開始時，額外傳給 codex app-server 的 CLI 參數。",
  "Path to the Claude binary used by this instance.": "這個執行個體使用的 Claude 執行檔路徑。",
  "CLAUDE_CONFIG_DIR path": "CLAUDE_CONFIG_DIR 路徑",
  "Custom Claude home and config directory. Keeps .claude.json and .claude separate.":
    "自訂的 Claude 主目錄與設定目錄。.claude.json 和 .claude 分開存放。",
  "Auto-compact after": "自動壓縮門檻",
  "Compact after 100,000 to 1,000,000 tokens. Leave empty to use Claude's default.":
    "超過 100,000 到 1,000,000 個 token 後壓縮。留空則使用 Claude 的預設值。",
  "e.g. 300000": "例如：300000",
  "Compact idle threads": "壓縮閒置對話",
  "When to compact an idle thread over 200,000 tokens: after you return, just before its prompt cache expires, or never. Overrides the default in Providers > Advanced.":
    "閒置且超過 200,000 個 token 的對話何時壓縮：你回來之後、提示快取到期前，或永不壓縮。會覆寫「供應商 > 進階」裡的預設值。",
  "Use default": "使用預設值",
  "When you return": "你回來之後",
  "Before the cache expires (beta)": "快取到期前（Beta）",
  Never: "永不",
  "Additional CLI arguments passed on session start.": "工作階段開始時額外傳入的 CLI 參數。",
  "e.g. --chrome": "例如：--chrome",
  "Path to the Grok CLI binary.": "Grok CLI 執行檔路徑。",
  "Path to the fx binary. All fx instances on this machine share its fx login.":
    "fx 執行檔路徑。這台電腦上所有 fx 執行個體共用它的 fx 登入。",
  "Path to the OpenCode binary.": "OpenCode 執行檔路徑。",
  "Server URL": "伺服器網址",
  "Leave blank to let T3 Code spawn the server when needed.":
    "留空則由 T3 Code 在需要時自行啟動伺服器。",
  "Server password": "伺服器密碼",
  "Stored separately on the host.": "另外存放在主機上。",
  Optional: "選填",
  "Sign-in method": "登入方式",
  "Google accounts use your subscription; API keys and Agent Platform bill usage.":
    "Google 帳號使用你的訂閱；API 金鑰和 Agent Platform 依用量計費。",
  "Google account": "Google 帳號",
  "Gemini API key": "Gemini API 金鑰",
  "API key": "API 金鑰",
  "Gemini or Vertex AI express key. Stored separately on the host.":
    "Gemini 或 Vertex AI 快速金鑰，另外存放在主機上。",
  "GCP project": "GCP 專案",
  "Required for Gemini Enterprise. Agent Platform uses it when no API key is set.":
    "Gemini Enterprise 必填。沒有設定 API 金鑰時，Agent Platform 會使用它。",
  "GCP location": "GCP 區域",
  "Region for Gemini Enterprise or Agent Platform.": "Gemini Enterprise 或 Agent Platform 的區域。",
  "Custom ACP executable. Leave empty to select automatically.":
    "自訂的 ACP 執行檔。留空則自動選擇。",
  Automatic: "自動",
  "Path to the Kiro CLI binary.": "Kiro CLI 執行檔路徑。",
  "Path to the Muse Code binary on this environment. Sign in with muse login on that host.":
    "此環境上的 Muse Code 執行檔路徑。請在那台主機上用 muse login 登入。",
  "Path to the Pi coding agent binary.": "Pi 程式設計代理程式的執行檔路徑。",
  "Additional CLI arguments passed to pi --mode rpc on session start.":
    "工作階段開始時，額外傳給 pi --mode rpc 的 CLI 參數。",
  "ACP source": "ACP 來源",
  "Local command": "本機指令",
  "Registry agent ID": "Registry 代理程式 ID",
  "Agent identifier from the official ACP Registry, for example 'devin'.":
    "官方 ACP Registry 裡的代理程式 ID，例如「devin」。",
  "Executable override": "覆寫執行檔",
  "Executable on this environment. For registry agents, this overrides the distribution executable while keeping its arguments and environment.":
    "此環境上的執行檔。對 Registry 代理程式來說，這會取代發行版的執行檔，但保留它的參數和環境變數。",
  "Registry default": "Registry 預設值",
  "Authentication method": "驗證方式",
  "Optional ACP authentication method ID. By default, the first agent-managed method is selected.":
    "選填的 ACP 驗證方式 ID。預設會選第一個由代理程式管理的方式。",
  Executable: "執行檔",
  "Executable name or path on this environment.": "此環境上的執行檔名稱或路徑。",
  "e.g. dsh": "例如：dsh",
  Token: "權杖",
  "A git.cafe token, used before CAFE_TOKEN and the cafe login, so GitCafe works without the CLI signed in.":
    "git.cafe 權杖，優先於 CAFE_TOKEN 和 cafe 登入使用，所以 CLI 沒登入也能使用 GitCafe。",
  "Access token": "存取權杖",
  "Scoped to one repository, project, or workspace. Create it in that item's Bitbucket settings.":
    "範圍限於一個存放庫、專案或工作區。請在該項目的 Bitbucket 設定中建立。",
  "Atlassian account email": "Atlassian 帳號電子郵件",
  "With an API token instead of an access token.": "搭配 API 權杖使用，取代存取權杖。",
  "API token": "API 權杖",
  "Reaches every repository your Atlassian account can. Give it read and write access to repositories and pull requests, and read:user:bitbucket.":
    "可存取你的 Atlassian 帳號能存取的所有存放庫。請給它存放庫和提取請求的讀寫權限，以及 read:user:bitbucket。",
};

const RULES: ReadonlyArray<readonly [RegExp, (match: RegExpExecArray) => string]> = [
  [
    /^Google does not publish an Antigravity runtime for (\S+)\. Use a supported (remote )?environment or a custom executable\.$/,
    (m) =>
      `Google 沒有提供 ${m[1]} 的 Antigravity 執行環境。請改用支援的${m[2] ? "遠端" : ""}環境或自訂執行檔。`,
  ],
  [
    /^OpenAI does not publish a Codex runtime for (\S+)\. Use a supported remote environment or a custom executable\.$/,
    (m) => `OpenAI 沒有提供 ${m[1]} 的 Codex 執行環境。請改用支援的遠端環境或自訂執行檔。`,
  ],
  [
    /^Antigravity needs at least (\d+) MiB of free space to install\.$/,
    (m) => `安裝 Antigravity 至少需要 ${m[1]} MiB 的可用空間。`,
  ],
  [
    /^The Codex download server returned HTTP (\d+)\. Try again later\.$/,
    (m) => `Codex 下載伺服器回傳 HTTP ${m[1]}，請稍後再試。`,
  ],
];

/** The zh-TW text for a known provider setup message, or null. */
export function translateProviderSetupMessage(message: string): string | null {
  const exact = EXACT[message];
  if (exact !== undefined) return exact;
  for (const [pattern, chinese] of RULES) {
    const match = pattern.exec(message);
    if (match) return chinese(match);
  }
  return null;
}
