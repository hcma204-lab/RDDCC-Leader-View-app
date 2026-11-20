---
name: claude-account-bridge
description: 讓網頁／儀表板的 AI 功能直接使用「使用者自己已登入的 Claude 帳號」（含公司 Claude 企業版 SSO），不需要 API key、不扣 API 額度。做法是本機橋接程式（127.0.0.1）代跑 `claude -p`，網頁用「一鍵配對」綁定。需要在新專案加入「用我的 Claude 帳號做網頁 AI」、或使用者說「不要 API key／用公司 Claude 帳號／一次性登入／橋接」時使用。
---

# 網頁 AI 綁定使用者自己的 Claude 帳號（本機橋接）

## 什麼時候用

- 網頁要有 AI 功能（摘要、問答、改寫、預審…），但使用者**沒有 API key**，只有 Claude 訂閱／公司企業版帳號。
- 不想把任何金鑰放在網頁或公開 repo。
- 使用者只有自己一人（或少數人各用各的電腦）用即時 AI。

**不適用**：要讓很多人共用同一個 AI、或伺服器端自動執行 → 改用 API key（Anthropic Console）或後端服務。
**要「主動、排程」的 AI（晨報、預警）** → 不要走網頁，改用 Claude 桌面 App 的「排程任務」（用同一個公司帳號、不需 key），見文末。

## 為什麼不能直接在網頁登入

- 網頁無法登入 Claude 訂閱／企業帳號；企業帳號只能在官方 App／Claude Code 登入。
- 訂閱帳號、Claude Code 登入權杖**都不能當 API key**（貼上會得到 `invalid x-api-key`）。
- 所以要有一個本機程式，用已登入的 Claude Code 代為回答。

## 架構

```
網頁（任何網址）──fetch──► 橋接程式 127.0.0.1:8787 ──spawn──► claude -p（已登入的 Claude Code）
        ▲                         │
        └──postMessage(連線碼)─────┘  ← 配對視窗 /pair（使用者按「允許」才傳）
```

三個端點：

| 端點 | 驗證 | 用途 |
|---|---|---|
| `GET /status` | 無（不含機密） | 網頁偵測橋接是否啟動、Claude 是否已登入 |
| `GET /pair?origin=` + `POST /pair/token`、`/pair/login` | 同源 | 配對視窗：登入 Claude、使用者按「允許」後把連線碼 postMessage 給該來源 |
| `POST /ask`、`GET /health` | `Authorization: Bearer <連線碼>` | 實際問答 |

## 加到新專案的步驟

1. **複製範本**（本 skill 的 `templates/`）到專案：
   - `claude-bridge.js`：橋接程式（Node 18+，無相依套件）。改常數：`TOKEN_FILE` 名稱、`PORT`。
   - `start-claude-bridge.bat`、`install-bridge-autostart.bat`、`login-claude.bat`：**必須純 ASCII＋CRLF**（見踩雷）。
   - `bridge-client.js`：網頁端程式片段（偵測狀態、開配對視窗、接收連線碼、呼叫 `/ask`）。
2. **網頁設定頁**加一個區塊：狀態文字 `#bindSt`、按鈕「綁定我的 Claude 帳號」`#btnBind`、「偵測狀態」`#btnBindCheck`，以及（進階）網址欄 `#fUrl`、連線碼欄 `#fKey`。把 `bridge-client.js` 貼進頁面並依你的 `S`（設定物件）／`saveSettings()` 調整。
3. **AI 呼叫**改成：`fetch(base + '/ask', { method:'POST', headers:{Authorization:'Bearer '+token}, body: JSON.stringify({system, user}) })`，回傳 `{text}`。
4. **使用者第一次**：啟動橋接 → 網頁按「綁定」→ 小視窗登入公司 Claude（SSO，只需一次）→ 按「允許」→ 自動填好。想開機自動啟動：執行 `install-bridge-autostart.bat`。
5. **驗證**（務必做）：
   - `node claude-bridge.js` 啟動後 `GET /status` 回 `loggedIn:true`。
   - 用替身 `claude`（`CLAUDE_BIN` 指向假的 `.cmd`）跑安全測試：錯誤 Host→403、跨站 POST `/pair/token`→403、`/pair?origin=` 只收乾淨的 http(s) origin、`/ask` 無連線碼→401。
   - 網頁：模擬 `MessageEvent`（來源＝橋接位址）可自動填好；來源不符必須被忽略。

## 安全設計（不要省略）

- 只監聽 `127.0.0.1`；**Host 白名單**（`127.0.0.1:PORT`、`localhost:PORT`）擋 DNS rebinding。
- `/pair/*` 的 POST 必須 **同源**（`Origin` ＝橋接自己、`Sec-Fetch-Site` 為 same-origin 或缺省），且**不回 CORS 標頭**；連線碼**不寫進 HTML**，只經由使用者按「允許」後的同源 POST 取得。
- 配對 postMessage 的 `targetOrigin` ＝ 網頁來源（不用 `*`）；`origin` 參數只接受 `http(s)://host[:port]`，`file://`／`null` 一律拒絕（改手動貼連線碼）。
- 配對頁：`X-Frame-Options: DENY`、CSP `frame-ancestors 'none'`、`Referrer-Policy: no-referrer`、`no-store`。
- 網頁端只信任 `event.origin ＝ 橋接位址` 的配對訊息。
- 執行 Claude：`claude -p --output-format text --tools "" --no-session-persistence`、在**空的暫存資料夾**、**不記錄提示詞與回覆**（只記字數與秒數），避免網頁內容誘導它做別的事。
- 連線碼存使用者資料夾（`~/.xxx-bridge-token`，權限 600），**不進 repo**；公開 repo 只放程式，不放連線碼／token。

## 踩過的雷（省你重走一遍）

- **`.bat` 一開就閃退**：含中文的 UTF-8、LF 換行的批次檔在中文版 Windows 會解析失敗。`.bat` 一律**純 ASCII＋CRLF**，中文說明放網頁或 README。寫完用程式轉 CRLF 並檢查沒有 >127 的位元組。
- **找不到 `claude`**：Claude 桌面 App 內嵌版不在 PATH，位於 `%LOCALAPPDATA%\Claude-Data\*\claude-code\<ver>\*\claude.exe`；程式依序找 `CLAUDE_BIN` → PATH → 這個資料夾（取最新版）。
- **桌面 App 已登入 ≠ 單獨執行的 `claude` 已登入**：會顯示 `Not logged in`，需 `claude auth login --sso` 一次（配對視窗的「用公司帳號登入」按鈕會代跑；若瀏覽器要求貼授權碼，改在終端機手動執行）。
- **企業版登入用 SSO**：`claude auth login --sso`（可加 `--email`）。
- **https 網頁連 `http://127.0.0.1`**：瀏覽器允許（loopback），但可能詢問「是否允許存取本機網路」，要選允許。
- **預覽視窗（內嵌瀏覽器）限制**：`window.open` 會變成同一分頁導覽、無 opener；本機 fetch 可能被擋。測試配對用「模擬 MessageEvent」與替身橋接，真機再測一次。
- **`/health` 與 `claude auth status` 會 spawn 子程序**：用短時間快取，避免每次輪詢都卡住。
- **Windows 上 `spawn` 的 `.cmd/.bat`** 需 `shell:true`；一次只處理一個請求（`busy` 旗標，回 429）。
- **別用「貼 API key」當預設**：使用者常把訂閱帳號或 Claude Code 權杖誤當 key；介面上要明講「這不是 API key」。

## 搭配：主動／排程的 AI（不經網頁）

晨報、到期預警、週報這類「定時主動」的 AI，用 Claude 桌面 App 的**排程任務**（`mcp__scheduled-tasks`）：用同一個公司帳號、不需 key，由腳本（Node CLI）算數字＋Claude 寫判讀，結果發到 monday／Slack／Windows 通知，網頁只負責讀取顯示。App 需開著才會執行。

## 範本檔

見 `templates/`：`claude-bridge.js`、`bridge-client.js`、`start-claude-bridge.bat`、`install-bridge-autostart.bat`、`login-claude.bat`。
