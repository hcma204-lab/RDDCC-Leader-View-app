---
name: claude-account-bridge
description: 讓網頁／儀表板的 AI 功能直接使用「使用者自己已登入的 Claude 帳號」（含公司 Claude 企業版 SSO），不需要 API key、不扣 API 額度。做法是本機橋接程式（127.0.0.1）代跑 `claude -p`，本機版全自動綁定。也包含「單一 HTML 直接讀 monday 看板（使用者貼自己的 token）＋AI 分析」的完整範本。需要在新專案或其他 HTML 加入「用我的 Claude 帳號做網頁 AI」、「HTML 結合 monday 與 AI」，或使用者說「不要 API key／用公司 Claude 帳號／一次性登入／橋接／monday 儀表板加 AI」時使用。
---

# 網頁 AI 綁定使用者自己的 Claude 帳號（本機橋接）

## 什麼時候用

- 網頁要有 AI 功能（摘要、問答、改寫、預審…），但使用者**沒有 API key**，只有 Claude 訂閱／公司企業版帳號。
- 不想把任何金鑰放在網頁或公開 repo。
- 使用者只有自己一人（或少數人各用各的電腦）用即時 AI。

**不適用**：要讓很多人共用同一個 AI、或伺服器端自動執行 → 改用 API key（Anthropic Console）或後端服務。
**要「主動、排程」的 AI（晨報、預警）** → 不要走網頁，改用 Claude 桌面 App 的「排程任務」（用同一個公司帳號、不需 key），見文末。

## 最快上手：把另一個 HTML 變成「monday + AI」

已有一份可直接改的完整範本：`templates/monday-ai-page.html`（單一檔案：貼 monday token → 讀看板 → 表格 → AI 摘要 → 綁定自己的 Claude）。已實測：本機版自動綁定、AI 正常回覆。

1. 新資料夾放 `claude-bridge.js`、兩個 `.bat`＋`.ps1`（`templates/`），再把 `monday-ai-page.html` 存成同資料夾的 **`index.html`**（橋接只會提供這個檔名）。
2. 改頁面裡 `CONFIG`：`monday.boardId`、`columns`（欄位 ID，用 monday 的 `get_board_info` 或欄位設定 → 進階取得）。
3. 改 `render()`（你要的畫面）與 AI 提示詞（`askClaude(system, user)`）。
4. 雙擊 `install-bridge-autostart.bat` → 開 `http://127.0.0.1:8787/` → 貼 token → AI 自動綁定。
5. 發佈到 GitHub Pages 的話，公開網址只能用 monday 功能；AI 要用本機版（見踩雷）。

**已有 HTML 想加 monday／AI 時**：不要整頁重寫，只貼元件——
- 要 AI：貼 `templates/bridge-client.js`（需要頁面提供 `S`、`saveSettings()`、可選 `render()`，並加綁定區塊 `#bindSt`／`#btnBind`），用 `askClaude(system, user)` 呼叫。
- 要 monday：貼 `templates/monday-client.js`（`mondayQuery`、`fetchBoardItems`、`aiContext`），改 `CONFIG`。
- 兩個檔案可共存，函式名稱不衝突；`monday-ai-page.html` 就是由這兩個檔案原樣組成。

### 結合 monday 的設計原則

- **每人用自己的 monday token**：`Authorization` 直接放 token（不加 `Bearer`），加 `API-Version` 標頭；瀏覽器可直接呼叫 `api.monday.com/v2`（有 CORS），不需要後端。token 只存使用者自己的 `localStorage`，不寫進程式、網址、repo；要提供「登出」清除。使用者取得方式：monday 頭像 → Developers → My access tokens（沒有就請管理員開通）。
- **權限天然隔離**：用誰的 token 就看到誰有權限的看板，不用自己做權限；看不到看板時提示「確認是工作區成員」，不要假裝沒資料。
- **預設唯讀**：要寫回（改狀態、留言、建項目）一律先顯示將寫入的內容，讓使用者按確認才送出，並限制可寫的欄位。
- **分頁**：`items_page(limit:200)` ＋ `next_items_page(cursor)`，設頁數上限（範本 30 頁）避免無限迴圈；只拉需要的欄位（`column_values(ids:[…])`），別抓整個看板。
- **錯誤翻成人話**：401（token 錯）、`DAILY_LIMIT`、`COMPLEXITY`／429（限流）、403（無權限）各有明確處理，見 `mondayErr`。
- **給 AI 的資料要瘦身**：只傳判斷需要的欄位（項目｜負責人｜狀態｜到期…），限筆數（約 150），並在提示詞要求「只根據提供的資料、不要編造」；不要把整個看板 JSON 或含個資、客戶機密的欄位丟進去。
- **AI 只做判讀，數字自己算**：逾期天數、統計、排序用程式算好再給 AI；AI 負責找重點、寫建議。這樣結果可驗證、也省字數。
- **AI 是選填**：沒綁定也要能看完整的 monday 資料，AI 按鈕只在可用時提示，不能讓整頁因此報錯。

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
| `GET /` | 無 | 提供 `index.html`（本機版入口，與橋接同源，避開瀏覽器的本機網路限制） |
| `POST /ask`、`GET /health` | `Authorization: Bearer <連線碼>` | 實際問答 |

## 加到新專案的步驟

1. **複製範本**（本 skill 的 `templates/`）到專案：
   - `claude-bridge.js`：橋接程式（Node 18+，無相依套件）。改常數：`TOKEN_FILE` 名稱、`PORT`。
   - `start-claude-bridge.bat`、`install-bridge-autostart.bat`＋`.ps1`、`login-claude.bat`：**必須純 ASCII＋CRLF**（見踩雷）。
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

- **`.bat` 一開就閃退**：含中文的 UTF-8、LF 換行的批次檔在中文版 Windows 會解析失敗。`.bat` 一律**純 ASCII＋CRLF**，中文說明放網頁或 README。寫完用程式轉 CRLF 並檢查沒有 >127 的位元組。**放進 git 時要加 `.gitattributes`：`*.bat -text`、`*.ps1 -text`**（`eol=crlf` 不會套用到 GitHub 的 ZIP 下載，會變回 LF；必須讓倉庫直接存 CRLF 原樣），並實際下載 ZIP 檢查換行。
- **找不到 `claude`**：Claude 桌面 App 內嵌版不在 PATH，位於 `%LOCALAPPDATA%\Claude-Data\*\claude-code\<ver>\*\claude.exe`；程式依序找 `CLAUDE_BIN` → PATH → 這個資料夾（取最新版）。
- **桌面 App 已登入 ≠ 單獨執行的 `claude` 已登入**：會顯示 `Not logged in`，需 `claude auth login --sso` 一次（配對視窗的「用公司帳號登入」按鈕會代跑；若瀏覽器要求貼授權碼，改在終端機手動執行）。
- **企業版登入用 SSO**：`claude auth login --sso`（可加 `--email`）。
- **https 公開網頁連 `http://127.0.0.1` 常被瀏覽器擋（Local Network Access）**：Chrome／Edge 近期版本會詢問或直接擋（`ERR_BLOCKED_BY_CLIENT`／`Failed to fetch`），企業電腦還可能被原則禁止。**最穩的解法：讓橋接程式自己提供儀表板頁面**（`GET /` 回傳同資料夾的 `index.html`），使用者改開 `http://127.0.0.1:8787/`，網頁與橋接同源，完全不受影響；公開網址仍可用於不需要 AI 的功能。
  - **本機版全自動**：網頁啟動時 `fetch('/status')` 偵測自己是不是橋接提供的頁面（`ST.localBridge`）；是的話，已登入 Claude 就**靜默自動綁定**（同源 `POST /pair/token`，不用彈出視窗、不用按任何鈕）；未登入時按「綁定」→ `POST /pair/login` 並輪詢 `/status`，登入完成自動綁定。
  - **公開網址上的其他人**：連不到橋接時**不要顯示紅色錯誤**（他們多半沒安裝）；改顯示中性的安裝引導（下載 ZIP → 雙擊 install 檔 → 開本機版網址），並註明「不用 AI 也能使用所有分析」。需求要寫清楚：Node.js 18+、Claude 桌面 App 或 Claude Code、公司 Claude 帳號；下載的 `.bat` 可能被 Windows SmartScreen 警告。
- **橋接會自己停掉**：從 Claude／IDE 的工具程序啟動的背景程式，會在工作階段結束時被一起關閉。要長駐請用 **Windows 工作排程器**（`install-bridge-autostart.ps1`：登入時啟動、隱藏視窗、失敗自動重啟、不需系統管理員），不要靠 Startup 捷徑或手動開視窗。
- **預覽視窗（內嵌瀏覽器）限制**：`window.open` 會變成同一分頁導覽、無 opener；本機 fetch 可能被擋。測試配對用「模擬 MessageEvent」與替身橋接，真機再測一次。
- **`/health` 與 `claude auth status` 會 spawn 子程序**：用短時間快取，避免每次輪詢都卡住。
- **Windows 上 `spawn` 的 `.cmd/.bat`** 需 `shell:true`；一次只處理一個請求（`busy` 旗標，回 429）。
- **別用「貼 API key」當預設**：使用者常把訂閱帳號或 Claude Code 權杖誤當 key；介面上要明講「這不是 API key」。

## 搭配：主動／排程的 AI（不經網頁）

晨報、到期預警、週報這類「定時主動」的 AI，用 Claude 桌面 App 的**排程任務**（`mcp__scheduled-tasks`）：用同一個公司帳號、不需 key，由腳本（Node CLI）算數字＋Claude 寫判讀，結果發到 monday／Slack／Windows 通知，網頁只負責讀取顯示。App 需開著才會執行。

## 範本檔

見 `templates/`：
- `claude-bridge.js`：橋接程式（Node 18+）
- `bridge-client.js`：網頁端綁定與 `askClaude()`（本機版自動綁定＋公開網址的中性引導）
- `monday-client.js`：網頁端讀 monday（`mondayQuery`、`fetchBoardItems`、`aiContext`）
- `monday-ai-page.html`：上面兩者組成的完整單檔範本（存成 `index.html` 即為本機版入口）
- `start-claude-bridge.bat`、`install-bridge-autostart.bat`／`.ps1`、`login-claude.bat`：純 ASCII＋CRLF

- `build-monday-ai-page.js`：重組腳本。`monday-ai-page.html` 由 `bridge-client.js` 與 `monday-client.js` 原樣內嵌組成；改了這兩個元件檔，在 `templates` 資料夾執行 `node build-monday-ai-page.js` 重新產生範本頁，避免兩邊不一致。
