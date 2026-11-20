#!/usr/bin/env node
/**
 * Claude 橋接程式（本機）
 *
 * 作用：讓儀表板網頁的 AI 功能，使用「你自己電腦上已登入的 Claude 帳號」（公司 Claude 企業版），
 *      不需要 API key。做法是代你執行 `claude -p`（Claude Code 的非互動模式）。
 *
 * 安全設計：
 *  - 只監聽 127.0.0.1（本機），外部網路連不到。
 *  - 每個請求都要帶「連線碼」（第一次啟動時自動產生，存在你的使用者資料夾）。
 *  - 執行 Claude 時關閉所有工具（不能讀檔、不能執行指令、不能上網），只做文字生成；
 *    並且在空的暫存資料夾執行、不留對話紀錄，避免看板內容裡的文字誘導它做別的事。
 *  - 不記錄任何提示詞或回覆內容。
 *
 * 需求：Node.js 18 以上；本機已登入 Claude（Claude 桌面 App 或 Claude Code）。
 * 啟動：雙擊 start-claude-bridge.bat，或執行 node claude-bridge.js
 */
'use strict';
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 8787);
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS || 180000);        // 單次呼叫最長等待
const MAX_BODY = 600 * 1024;                                         // 單次請求大小上限
const TOKEN_FILE = path.join(os.homedir(), '.cfdash-bridge-token');
const WORKDIR = path.join(os.tmpdir(), 'cfdash-bridge-empty');       // 空資料夾：不載入任何專案設定或記憶
fs.mkdirSync(WORKDIR, { recursive: true });

/* ── 連線碼 ── */
function loadToken() {
  if (process.env.BRIDGE_TOKEN) return process.env.BRIDGE_TOKEN;
  try { const t = fs.readFileSync(TOKEN_FILE, 'utf8').trim(); if (t.length >= 16) return t; } catch {}
  const t = crypto.randomBytes(16).toString('hex');
  try { fs.writeFileSync(TOKEN_FILE, t, { mode: 0o600 }); } catch (e) { console.error('無法儲存連線碼：', e.message); }
  return t;
}
const TOKEN = loadToken();
const safeEqual = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

/* ── 找 claude 執行檔：環境變數 → PATH → Claude 桌面 App 內嵌版本（Windows）── */
function findClaude() {
  if (process.env.CLAUDE_BIN && fs.existsSync(process.env.CLAUDE_BIN)) return process.env.CLAUDE_BIN;
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['claude'], { encoding: 'utf8' });
  if (probe.status === 0) { const first = (probe.stdout || '').split(/\r?\n/).map(s => s.trim()).find(Boolean); if (first) return first; }
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    const base = path.join(process.env.LOCALAPPDATA, 'Claude-Data'), found = [];
    try {
      for (const d of fs.readdirSync(base)) {
        const cc = path.join(base, d, 'claude-code');
        if (!fs.existsSync(cc)) continue;
        for (const ver of fs.readdirSync(cc)) for (const h of fs.readdirSync(path.join(cc, ver))) {
          const exe = path.join(cc, ver, h, 'claude.exe'); if (fs.existsSync(exe)) found.push({ ver, exe });
        }
      }
    } catch {}
    found.sort((a, b) => a.ver.localeCompare(b.ver, undefined, { numeric: true }));
    if (found.length) return found[found.length - 1].exe;                // 取最新版本
  }
  return null;
}
const CLAUDE = findClaude();
const useShell = () => /\.(cmd|bat)$/i.test(CLAUDE || '');

/* 登入狀態（Claude 桌面 App 的登入不會自動分享給單獨執行的 Claude Code，需要用 login-claude.bat 登入一次）*/
function loginState() {
  if (!CLAUDE) return null;
  const r = spawnSync(CLAUDE, ['auth', 'status'], { cwd: WORKDIR, encoding: 'utf8', timeout: 15000, windowsHide: true, shell: useShell() });
  try { return JSON.parse(r.stdout).loggedIn === true; } catch { return null; }
}

if (process.argv.includes('--login')) {                              // node claude-bridge.js --login：用公司帳號登入 Claude（只需一次）
  if (!CLAUDE) { console.error('找不到 Claude。請先安裝 Claude 桌面 App 或 Claude Code。'); process.exit(1); }
  console.log('即將開啟瀏覽器，請用「公司 Claude 企業版帳號」登入（SSO）。\n');
  const extra = process.argv.slice(process.argv.indexOf('--login') + 1).filter(a => /^[\w@.\-+]+$/.test(a));   // 例如 --sso --email you@company.com
  const c = spawn(CLAUDE, ['auth', 'login', ...extra], { stdio: 'inherit', shell: useShell() });
  c.on('close', code => { const s = loginState(); console.log(s ? '\n✔ 登入完成，可以啟動橋接程式了。' : '\n尚未確認登入成功，請重試一次。'); process.exit(code || 0); });
  return;
}

/* ── 執行 claude -p（一次只處理一個請求）── */
let busy = false;
function runClaude(text, model) {
  return new Promise((resolve, reject) => {
    const args = ['-p', '--output-format', 'text', '--tools', '', '--no-session-persistence'];
    if (model && /^[\w.\-\[\]]+$/.test(model)) args.push('--model', model);
    const child = spawn(CLAUDE, args, { cwd: WORKDIR, windowsHide: true, shell: useShell() });
    let out = '', err = '', done = false;
    const finish = (fn, v) => { if (!done) { done = true; clearTimeout(timer); fn(v); } };
    const timer = setTimeout(() => { try { child.kill(); } catch {} finish(reject, new Error('Claude 回應逾時（超過 ' + Math.round(TIMEOUT_MS / 1000) + ' 秒）')); }, TIMEOUT_MS);
    child.stdout.setEncoding('utf8').on('data', d => out += d);
    child.stderr.setEncoding('utf8').on('data', d => err += d);
    child.on('error', e => finish(reject, e));
    child.on('close', code => {
      if (code === 0 && out.trim()) return finish(resolve, out.trim());
      const msg = (err || out || '').trim().slice(0, 400);
      finish(reject, new Error(/login|log in|not logged|unauthorized|authentication|credential/i.test(msg)
        ? '本機的 Claude 尚未登入或登入已過期。請雙擊資料夾裡的 login-claude.bat，用公司 Claude 企業版帳號登入一次（SSO），完成後重新按 AI 按鈕。（' + msg + '）'
        : 'Claude 執行失敗（代碼 ' + code + '）：' + (msg || '沒有輸出')));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(text, 'utf8');
  });
}

/* ── HTTP 伺服器 ── */
const server = http.createServer((req, res) => {
  const origin = req.headers.origin;
  const cors = { 'Access-Control-Allow-Origin': origin || '*', 'Vary': 'Origin', 'Access-Control-Allow-Headers': 'authorization,content-type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Private-Network': 'true', 'Access-Control-Max-Age': '600' };
  const send = (code, obj) => { res.writeHead(code, { ...cors, 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }

  const given = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!safeEqual(given, TOKEN)) return send(401, { error: '連線碼不正確。請把橋接程式視窗顯示的連線碼，貼到儀表板「設定」的連線碼欄位。' });

  if (req.method === 'GET' && req.url.startsWith('/health')) return send(200, { ok: true, claude: !!CLAUDE, loggedIn: loginState(), busy });
  if (!(req.method === 'POST' && req.url.startsWith('/ask'))) return send(404, { error: '不支援的路徑' });
  if (!CLAUDE) return send(500, { error: '在這台電腦上找不到 Claude。請先安裝並登入 Claude 桌面 App 或 Claude Code，或設定環境變數 CLAUDE_BIN 指向 claude 執行檔。' });
  if (busy) return send(429, { error: '橋接程式正在處理上一個請求，請稍後再試。' });

  let size = 0; const chunks = [];
  req.on('data', c => { size += c.length; if (size > MAX_BODY) { send(413, { error: '內容太大（超過 ' + Math.round(MAX_BODY / 1024) + ' KB）' }); req.destroy(); } else chunks.push(c); });
  req.on('end', async () => {
    if (size > MAX_BODY) return;
    let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(400, { error: '請求格式不正確' }); }
    const system = typeof body.system === 'string' ? body.system : '', user = typeof body.user === 'string' ? body.user : '';
    if (!user.trim()) return send(400, { error: '缺少問題內容' });
    busy = true; const t0 = Date.now();
    try {
      const text = await runClaude((system ? system + '\n\n' : '') + user, body.model);
      console.log(`[${new Date().toLocaleTimeString()}] 完成：收 ${user.length} 字、回 ${text.length} 字、${((Date.now() - t0) / 1000).toFixed(1)} 秒`);   // 只記數字，不記內容
      send(200, { text });
    } catch (e) { console.log(`[${new Date().toLocaleTimeString()}] 失敗：${e.message.slice(0, 120)}`); send(502, { error: e.message }); }
    finally { busy = false; }
  });
});
server.on('error', e => {
  if (e.code === 'EADDRINUSE') console.error(`\n連接埠 ${PORT} 已被使用。橋接程式可能已經在執行；若不是，請用 set PORT=8788 換一個埠再啟動。`);
  else console.error('啟動失敗：', e.message);
  process.exit(1);
});
server.listen(PORT, HOST, () => {
  console.log('══════════════════════════════════════════════');
  console.log(' Claude 橋接程式 已啟動（只接受本機連線）');
  console.log('══════════════════════════════════════════════');
  console.log(' 網址：http://' + HOST + ':' + PORT);
  console.log(' 連線碼：' + TOKEN);
  console.log(' Claude：' + (CLAUDE || '找不到！請先安裝 Claude 桌面 App 或 Claude Code'));
  const li = loginState();
  console.log(' 登入狀態：' + (li === true ? '✔ 已登入' : li === false ? '✖ 尚未登入 → 請先雙擊 login-claude.bat 登入公司帳號（只需一次）' : '無法判斷'));
  console.log('\n 儀表板「設定」→ AI 類型選「Claude Code」，貼上上面的連線碼。');
  console.log(' 使用期間請保持這個視窗開著；關閉視窗即停止。\n');
});
