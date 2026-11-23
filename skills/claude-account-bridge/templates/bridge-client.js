/**
 * 網頁端：綁定使用者自己的 Claude 帳號（本機橋接）— 貼進你的頁面 <script> 即可，無相依套件。
 * 這是目前實際運作版本：本機版（橋接自己提供頁面）全自動綁定；公開網址則走彈出視窗配對或顯示安裝引導。
 *
 * 需要的 HTML（id 可自行改）：
 *   <div id="bindSt"></div>                        狀態文字
 *   <button id="btnBind">綁定我的 Claude 帳號</button>
 *   <button id="btnBindCheck">偵測狀態</button>
 *   <div id="bindGuide">…安裝步驟（只在非本機版顯示）…</div>   （可省略）
 *
 * 你的頁面要提供：
 *   S            設定物件（含 aiProvider／aiUrl／aiKey）
 *   saveSettings()，以及可選的 render()（綁定完成後重畫）
 *   ST           執行期狀態物件（本檔會設 ST.localBridge）
 *
 * 把頁面放在橋接程式資料夾、檔名叫 index.html，使用者開 http://127.0.0.1:8787/ 就是「本機版」。
 */
const $ = s => document.querySelector(s);
const ST = window.ST || (window.ST = {});
const DEFAULT_BRIDGE = 'http://127.0.0.1:8787';
const cleanKey = s => String(s || '').replace(/[\s"'「」“”]/g, '');
const bridgeBase = () => ST.localBridge ? location.origin : (S.aiUrl || DEFAULT_BRIDGE).replace(/\/+$/, '').replace(/\/(ask|status|pair|health)$/, '');
const bindSay = (cls, txt) => { const el = $('#bindSt'); if (el) { el.className = 'bind-st ' + cls; el.textContent = txt; } };
const bindSleep = ms => new Promise(r => setTimeout(r, ms));
const syncBindUi = () => { const g = $('#bindGuide'); if (g) g.hidden = !!ST.localBridge; };
const aiReady = () => S.aiProvider === 'bridge' && !!S.aiKey;

function applyBinding(tok, url) {                                   // 綁定成功：存起來
  Object.assign(S, { aiProvider: 'bridge', aiUrl: url, aiKey: tok });
  saveSettings();
}

/* 偵測：橋接有沒有啟動 → Claude 有沒有登入 → 連線碼是否有效 */
async function bridgeStatus() {
  const base = bridgeBase(); bindSay('', '偵測中…');
  let s;
  try { const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 3000); const r = await fetch(base + '/status', { signal: ctl.signal }); clearTimeout(tm); s = await r.json(); }
  catch {
    if (ST.localBridge) bindSay('bad', '✖ 橋接程式沒有回應。請確認工作排程器的「ClaudeBridgeDashboard」在執行，或重新雙擊 install-bridge-autostart.bat。');
    else bindSay(S.aiProvider === 'bridge' ? 'bad' : '', '這個網址連不到你電腦上的橋接程式（還沒安裝，或瀏覽器擋住了公開網址連本機）。\n請照安裝步驟安裝並改用本機版：http://127.0.0.1:8787/\n（不需要 AI 的話可以忽略，其他功能都能正常使用。）');
    return 'down';
  }
  if (!s || !s.bridge) { bindSay('bad', '✖ ' + base + ' 有回應，但不是 Claude 橋接程式。'); return 'down'; }
  if (!s.claude) { bindSay('bad', '✖ 橋接已啟動，但這台電腦找不到 Claude。請先安裝 Claude 桌面 App 或 Claude Code。'); return 'noclaude'; }
  if (s.loggedIn !== true) { bindSay('', '橋接已啟動，尚未登入 Claude。按「綁定」會引導你登入（只需一次）。'); return 'nologin'; }
  const key = cleanKey(S.aiKey);
  if (S.aiProvider === 'bridge' && key) {
    try { const r = await fetch(base + '/health', { headers: { Authorization: 'Bearer ' + key } }); if (r.ok) { bindSay('ok', '✔ 已綁定，可以使用 AI（Claude 已登入）'); return 'bound'; } } catch {}
    bindSay('bad', '連線碼已失效（橋接重新產生過）。請按「綁定」重新綁定。'); return 'stale';
  }
  bindSay('', '✔ 橋接就緒、Claude 已登入。按「綁定」完成最後一步。'); return 'ready';
}

/* 本機版：全自動，不需要彈出視窗。allowLogin=true 時，未登入會自動開瀏覽器登入並輪詢 */
async function bindLocal(allowLogin) {
  const base = location.origin;
  let s; try { s = await (await fetch(base + '/status')).json(); } catch { return bridgeStatus(); }
  if (!s.claude) { bindSay('bad', '✖ 這台電腦找不到 Claude。請先安裝 Claude 桌面 App 或 Claude Code。'); return false; }
  if (s.loggedIn !== true) {
    if (!allowLogin) { bindSay('', '尚未登入 Claude。按「綁定」會自動開啟瀏覽器讓你用公司帳號登入（只需一次）。'); return false; }
    bindSay('', '已開啟瀏覽器，請用公司 Claude 帳號完成登入…完成後這裡會自動更新。\n（若瀏覽器要求貼上授權碼，請改在終端機執行 claude auth login --sso。）');
    try { await fetch(base + '/pair/login', { method: 'POST' }); } catch {}
    for (let i = 0; i < 150 && s.loggedIn !== true; i++) { await bindSleep(2000); try { s = await (await fetch(base + '/status')).json(); } catch {} }
    if (s.loggedIn !== true) { bindSay('bad', '等待登入逾時。請再按一次「綁定」。'); return false; }
  }
  let r, j; try { r = await fetch(base + '/pair/token', { method: 'POST' }); j = await r.json(); } catch { r = null; }
  if (!r || !r.ok || !j.token) { bindSay('bad', '✖ 綁定失敗：' + ((j && j.error) || '橋接程式沒有回應')); return false; }
  applyBinding(j.token, base); await bridgeStatus(); if (typeof render === 'function') render(); return true;
}

$('#btnBindCheck') && ($('#btnBindCheck').onclick = bridgeStatus);
$('#btnBind').onclick = async () => {
  if (ST.localBridge) return bindLocal(true);
  if (location.protocol === 'file:') { bindSay('', '用本機檔案（file://）開啟時，瀏覽器不允許自動綁定。請改用本機版網址 http://127.0.0.1:8787/。'); return; }
  const st = await bridgeStatus(); if (st === 'down' || st === 'noclaude') return;
  const w = window.open(bridgeBase() + '/pair?origin=' + encodeURIComponent(location.origin), 'bridge-pair', 'width=520,height=700');
  if (!w) bindSay('bad', '瀏覽器擋住了彈出視窗。請允許後再按一次。');
};

/* 接收連線碼：只信任「橋接位址」傳來的訊息（來源不符一律忽略）。公開網址＋瀏覽器允許本機網路時才會用到 */
window.addEventListener('message', async e => {
  const d = e.data; if (!d || d.type !== 'cfdash-bridge-pair' || typeof d.token !== 'string') return;
  let expected; try { expected = new URL(bridgeBase()).origin; } catch { return; }
  if (e.origin !== expected) return;
  applyBinding(cleanKey(d.token), bridgeBase()); await bridgeStatus(); if (typeof render === 'function') render();
});

/* 啟動：偵測是不是「本機版」；已登入 Claude 但還沒綁定／連線碼失效 → 靜默自動綁定 */
(async function initLocalBridge() {
  if (!/^https?:$/.test(location.protocol) || !/^(127\.0\.0\.1|localhost)$/.test(location.hostname)) return;
  let s; try { s = await (await fetch('/status')).json(); } catch { return; }
  if (!s || s.bridge !== true) return;
  ST.localBridge = true; syncBindUi();
  let ok = false;
  if (aiReady()) { try { ok = (await fetch('/health', { headers: { Authorization: 'Bearer ' + S.aiKey } })).ok; } catch {} }
  if (!ok && s.loggedIn === true) { await bindLocal(false); }
})();

/* 呼叫 AI：換掉你原本的 callLLM 即可 */
async function askClaude(system, user, model) {
  if (!aiReady()) throw new Error('尚未綁定 Claude。請到設定按「綁定我的 Claude 帳號」（不綁定也能使用其他功能）。');
  const base = bridgeBase();
  let r;
  try { r = await fetch(base + '/ask', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + S.aiKey }, body: JSON.stringify({ system, user, model: model || undefined }) }); }
  catch { throw new Error('連不到本機橋接程式（' + base + '）。請確認已啟動，或到設定按「綁定」檢查狀態。'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || ('橋接程式錯誤 HTTP ' + r.status));
  return j.text || '';
}
