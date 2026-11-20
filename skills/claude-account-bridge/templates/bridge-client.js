/**
 * 網頁端：綁定使用者自己的 Claude 帳號（本機橋接）— 貼進你的頁面 <script> 即可，無相依套件。
 *
 * 需要的 HTML（id 可自行改，下面 $() 對應）：
 *   <div id="bindSt"></div>                       狀態文字
 *   <button id="btnBind">綁定我的 Claude 帳號</button>
 *   <button id="btnBindCheck">偵測狀態</button>
 *   <input id="fUrl" placeholder="http://127.0.0.1:8787">   （進階，可省略；省略則用預設）
 *   <input id="fKey" type="password">             連線碼（綁定後自動填）
 *
 * 你的頁面要提供：S（設定物件，含 aiUrl／aiKey／aiProvider）、saveSettings()、可選的 render()。
 */
const $ = s => document.querySelector(s);
const DEFAULT_BRIDGE = 'http://127.0.0.1:8787';
const cleanKey = s => String(s || '').replace(/[\s"'「」“”]/g, '');
const bridgeBase = () => (($('#fUrl') && $('#fUrl').value.trim()) || S.aiUrl || DEFAULT_BRIDGE).replace(/\/+$/, '').replace(/\/(ask|status|pair|health)$/, '');
const bindSay = (cls, txt) => { const el = $('#bindSt'); el.className = 'bind-st ' + cls; el.textContent = txt; };

/* 偵測：橋接有沒有啟動 → Claude 有沒有登入 → 連線碼是否有效 */
async function bridgeStatus() {
  const base = bridgeBase(); bindSay('', '偵測中…');
  let s;
  try { const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 3000); const r = await fetch(base + '/status', { signal: ctl.signal }); clearTimeout(tm); s = await r.json(); }
  catch { bindSay('bad', '✖ 找不到橋接程式（' + base + '）。請先啟動 start-claude-bridge.bat，再按「偵測狀態」。\n（網頁若是 https，瀏覽器可能詢問是否允許存取本機網路，請選允許。）'); return 'down'; }
  if (!s || !s.bridge) { bindSay('bad', '✖ ' + base + ' 有回應，但不是 Claude 橋接程式。'); return 'down'; }
  if (!s.claude) { bindSay('bad', '✖ 橋接已啟動，但這台電腦找不到 Claude。請先安裝 Claude 桌面 App 或 Claude Code。'); return 'noclaude'; }
  if (s.loggedIn !== true) { bindSay('', '橋接已啟動，尚未登入 Claude。按「綁定」會引導你登入（只需一次）。'); return 'nologin'; }
  const key = cleanKey($('#fKey') ? $('#fKey').value : S.aiKey);
  if (key) {
    try { const r = await fetch(base + '/health', { headers: { Authorization: 'Bearer ' + key } }); if (r.ok) { bindSay('ok', '✔ 已綁定，可以使用 AI（Claude 已登入）'); return 'bound'; } } catch {}
    bindSay('bad', '連線碼已失效（橋接重新產生過）。請按「綁定」重新綁定。'); return 'stale';
  }
  bindSay('', '✔ 橋接就緒、Claude 已登入。按「綁定」完成最後一步。'); return 'ready';
}

/* 綁定：開配對小視窗（登入＋使用者按「允許」）*/
$('#btnBindCheck').onclick = bridgeStatus;
$('#btnBind').onclick = async () => {
  if (location.protocol === 'file:') { bindSay('bad', '用本機檔案（file://）開啟時瀏覽器不允許自動綁定。請改用網址開啟，或手動貼上橋接視窗顯示的連線碼。'); return; }
  const st = await bridgeStatus(); if (st === 'down' || st === 'noclaude') return;
  const w = window.open(bridgeBase() + '/pair?origin=' + encodeURIComponent(location.origin), 'bridge-pair', 'width=520,height=700');
  if (!w) bindSay('bad', '瀏覽器擋住了彈出視窗。請允許後再按一次。');
};

/* 接收連線碼：只信任「橋接位址」傳來的訊息（來源不符一律忽略）*/
window.addEventListener('message', async e => {
  const d = e.data; if (!d || d.type !== 'cfdash-bridge-pair' || typeof d.token !== 'string') return;
  let expected; try { expected = new URL(bridgeBase()).origin; } catch { return; }
  if (e.origin !== expected) return;
  const tok = cleanKey(d.token), url = bridgeBase();
  if ($('#fUrl')) $('#fUrl').value = url; if ($('#fKey')) $('#fKey').value = tok;
  Object.assign(S, { aiProvider: 'bridge', aiUrl: url, aiKey: tok });
  saveSettings(); await bridgeStatus(); if (typeof render === 'function') render();
});

/* 呼叫 AI：換掉你原本的 callLLM 即可 */
async function askClaude(system, user, model) {
  const base = bridgeBase();
  let r;
  try { r = await fetch(base + '/ask', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + S.aiKey }, body: JSON.stringify({ system, user, model: model || undefined }) }); }
  catch { throw new Error('連不到本機橋接程式（' + base + '）。請確認已啟動，或到設定按「綁定」檢查狀態。'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || ('橋接程式錯誤 HTTP ' + r.status));
  return j.text || '';
}
