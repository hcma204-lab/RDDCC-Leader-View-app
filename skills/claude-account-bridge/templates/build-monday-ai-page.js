const fs = require('fs'), path = require('path');
const dir = process.argv[2] || __dirname;   // 用法：node build-monday-ai-page.js（在 templates 資料夾內）
const bridge = fs.readFileSync(path.join(dir, 'bridge-client.js'), 'utf8').replace(/^\/\*\*[\s\S]*?\*\/\n/, '');
const monday = fs.readFileSync(path.join(dir, 'monday-client.js'), 'utf8').replace(/^\/\*\*[\s\S]*?\*\/\n/, '');
const html = `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>monday + Claude AI 範本</title>
<!-- 範本：把這個檔存成橋接程式資料夾裡的 index.html，開 http://127.0.0.1:8787/ 就是「本機版」（AI 自動綁定）。
     改 CONFIG（看板 ID、欄位 ID）、把 render() 換成你要的畫面、把 AI 提示詞換成你的需求。 -->
<style>
  :root{--bg:#f6f7f9;--card:#fff;--ink:#1c2430;--mute:#5b6675;--line:#e1e5ea;--ok:#157347;--bad:#b3261e;--acc:#2b5fd9}
  @media (prefers-color-scheme:dark){:root{--bg:#14181e;--card:#1d232c;--ink:#e8ecf1;--mute:#9aa6b4;--line:#2d3640;--ok:#5cc28a;--bad:#ff8a80;--acc:#7da7ff}}
  *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 system-ui,"Microsoft JhengHei",sans-serif}
  main{max-width:960px;margin:0 auto;padding:16px}
  h1{font-size:20px;margin:8px 0 14px} h2{font-size:16px;margin:0 0 10px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px;margin-bottom:14px}
  label{display:block;font-size:13px;color:var(--mute);margin:8px 0 4px}
  input{width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--ink);font:inherit}
  button{padding:8px 14px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--ink);font:inherit;cursor:pointer}
  button.primary{background:var(--acc);border-color:var(--acc);color:#fff} button[disabled]{opacity:.5;cursor:not-allowed}
  .row{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
  .bind-st{white-space:pre-wrap;font-size:13px;color:var(--mute);margin-top:8px} .bind-st.ok{color:var(--ok)} .bind-st.bad{color:var(--bad)}
  table{width:100%;border-collapse:collapse;font-size:14px} th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line)} th{color:var(--mute);font-weight:600}
  pre.ai{white-space:pre-wrap;margin:0;font:inherit} .err{color:var(--bad);white-space:pre-wrap}
  .guide{font-size:13px;color:var(--mute);margin-top:8px}
</style>
</head>
<body>
<main>
  <h1>monday + Claude AI 範本</h1>

  <section class="card">
    <h2>設定</h2>
    <label for="fToken">monday API token（只存在你自己的瀏覽器）</label>
    <input id="fToken" type="password" autocomplete="off" placeholder="monday → 頭像 → Developers → My access tokens">
    <label for="fBoard">看板 ID</label>
    <input id="fBoard" inputmode="numeric" placeholder="看板網址 /boards/ 後面那串數字">
    <div class="row"><button id="btnSave" class="primary">儲存並載入</button><button id="btnLogout">登出（清除 token）</button></div>
    <div id="msg" class="err"></div>
  </section>

  <section class="card">
    <h2>AI（選填，用你自己的 Claude 帳號）</h2>
    <div id="bindSt" class="bind-st"></div>
    <div class="row"><button id="btnBind">綁定我的 Claude 帳號</button><button id="btnBindCheck">偵測狀態</button></div>
    <div id="bindGuide" class="guide">要用 AI：下載專案 ZIP → 雙擊 install-bridge-autostart.bat → 改開 http://127.0.0.1:8787/ 。不用 AI 也能使用其他功能。</div>
  </section>

  <section class="card"><h2>看板項目 <small id="cnt"></small></h2><div id="list">尚未載入。</div></section>

  <section class="card">
    <h2>AI 摘要</h2>
    <div class="row"><button id="btnAI" class="primary">請 AI 找出需要注意的項目</button></div>
    <pre id="aiOut" class="ai"></pre>
  </section>
</main>

<script>
/* ── 1. 設定與狀態（bridge-client.js 需要 S、saveSettings、render）── */
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const S = Object.assign({ token: '', boardId: '', aiProvider: 'none', aiUrl: '', aiKey: '' }, (() => { try { return JSON.parse(lsGet('app.settings') || '{}'); } catch { return {}; } })());
const saveSettings = () => lsSet('app.settings', JSON.stringify(S));
let ITEMS = [];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ── 2. Claude 橋接（原樣來自 templates/bridge-client.js）── */
${bridge}
/* ── 3. monday 讀取（原樣來自 templates/monday-client.js）── */
${monday}
/* ── 4. 你的畫面與流程（改這裡）── */
function render() {
  $('#cnt').textContent = ITEMS.length ? '（' + ITEMS.length + ' 筆）' : '';
  if (!ITEMS.length) { $('#list').textContent = S.token ? '沒有項目。' : '請先貼上 monday token 並儲存。'; return; }
  const cols = Object.keys(CONFIG.columns);
  $('#list').innerHTML = '<table><thead><tr><th>項目</th>' + cols.map(c => '<th>' + esc(c) + '</th>').join('') + '</tr></thead><tbody>' +
    ITEMS.slice(0, 200).map(it => '<tr><td><a href="' + esc(it.url) + '" target="_blank" rel="noopener">' + esc(it.name) + '</a></td>' + cols.map(c => '<td>' + esc(it.cols[CONFIG.columns[c]]) + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
}
async function load() {
  $('#msg').textContent = '';
  if (!S.token) { render(); return; }
  try { $('#list').textContent = '載入中…'; ITEMS = await fetchBoardItems(S.boardId); } catch (e) { ITEMS = []; $('#msg').textContent = e.message; }
  render();
}
$('#btnSave').onclick = () => { S.token = cleanKey($('#fToken').value); S.boardId = $('#fBoard').value.trim(); saveSettings(); load(); };
$('#btnLogout').onclick = () => { S.token = ''; saveSettings(); ITEMS = []; $('#fToken').value = ''; render(); };
$('#btnAI').onclick = async () => {
  const out = $('#aiOut'); if (!ITEMS.length) { out.textContent = '請先載入看板項目。'; return; }
  out.textContent = 'AI 思考中…'; $('#btnAI').disabled = true;
  try {
    out.textContent = await askClaude('你是專案進度助理。用繁體中文、條列、不超過 8 點，只根據提供的資料，不要編造。',
      '今天是 ' + new Date().toISOString().slice(0, 10) + '。以下是看板項目（項目|負責人|狀態|時程）：\\n' + aiContext(ITEMS) + '\\n請找出需要主管注意的項目並說明原因。');
  } catch (e) { out.textContent = '✖ ' + e.message; }
  $('#btnAI').disabled = false;
};
$('#fToken').value = S.token; $('#fBoard').value = S.boardId || String(CONFIG.monday.boardId || '');
if (!S.boardId && CONFIG.monday.boardId) S.boardId = String(CONFIG.monday.boardId);
load();
if (S.aiProvider === 'bridge') bridgeStatus(); else bindSay('', '尚未綁定 AI（選填）。');
</script>
</body>
</html>
`;
fs.writeFileSync(path.join(dir, 'monday-ai-page.html'), html);
console.log('ok', html.length);
