#!/usr/bin/env node
/**
 * 儀表板排程工具（給 Claude 排程任務呼叫）
 *
 * 分工：這支程式負責「算」——讀 monday、用和儀表板同一套引擎做分析，數字不會和儀表板不一致；
 *      Claude 排程任務負責「判讀與寫作」，再用這支程式把結果存回 monday、發 Windows 通知。
 *
 * 指令：
 *   node brief-cli.js setup                      一次性：輸入 monday API token（隱藏輸入，存在你的使用者資料夾）
 *   node brief-cli.js analyze --scope daily|alert|weekly [--today YYYY-MM-DD]
 *                                                讀取 monday 並輸出分析結果（JSON）
 *        離線測試：--file 進行中.json --done 已完成.json
 *   node brief-cli.js publish --kind daily|alert|silent|meeting|gm [--toast]
 *                                                從標準輸入讀文字（第 1 行＝一句話摘要，其餘＝內文），
 *                                                發佈到 monday 輸出看板；加 --toast 同時發 Windows 通知
 *   node brief-cli.js toast --kind daily|alert|silent|meeting|gm
 *                                                只發 Windows 通知（標準輸入第 1 行為內容）
 *
 * 安全：只讀取來源看板；只寫入「主管晨報與預警」輸出看板；token 只存在 ~/.cfdash-monday-token。
 */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm'), readline = require('readline');
const { spawnSync } = require('child_process');

const HTML = path.join(__dirname, 'index.html');
const TOKEN_FILE = path.join(os.homedir(), '.cfdash-monday-token');
const STATE_FILE = path.join(os.homedir(), '.cfdash-alert-state.json');
const TITLES = { daily:'研發文管課晨報', alert:'到期預警', silent:'靜默風險週報', meeting:'週會摘要', gm:'總經理摘要' };

/* ── 參數 ── */
const argv = process.argv.slice(2), cmd = argv[0];
const opt = n => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null; };
const flag = n => argv.includes('--' + n);
const out = o => console.log(JSON.stringify(o, null, 1));
const fail = (msg, code = 1) => { console.error(JSON.stringify({ error: msg })); process.exit(code); };

/* ── 載入儀表板的分析引擎（index.html 第 7 節「畫面」之前的所有程式，不含任何 DOM）── */
function loadEngine() {
  const html = fs.readFileSync(HTML, 'utf8'), script = html.split('<script>')[1].split('</script>')[0];
  const cut = script.indexOf('7. 畫面'), head = script.slice(0, script.lastIndexOf('/*', cut));
  const ctx = { location: { hash: '' }, console, Intl, Date, JSON, Math, Object, Array, String, Number, RegExp, Set, Map, Promise, fetch, URL, setTimeout, clearTimeout };
  vm.createContext(ctx);
  vm.runInContext(head + `\nCONFIG.activeStatuses = Object.values(CONFIG.statusLabels);\nthis.E = { CONFIG, S, normalize, analyze, reasonCount, weeklyModel, gmModel, ownerHealth, flowModel, fetchActive, fetchDone, todayStr, shortName, dueText, mmdd, itemRisk, diffDays, addDays };`, ctx);
  return ctx.E;
}

/* ── token ── */
function loadToken() {
  if (process.env.MONDAY_API_TOKEN) return process.env.MONDAY_API_TOKEN.trim();
  try { return fs.readFileSync(TOKEN_FILE, 'utf8').trim(); } catch { return null; }
}
async function gql(token, query, variables) {
  const r = await fetch('https://api.monday.com/v2', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: token, 'API-Version': '2025-04' }, body: JSON.stringify({ query, variables }) });
  const j = await r.json().catch(() => null);
  if (!j) throw new Error('monday 回應不是 JSON（HTTP ' + r.status + '）');
  if (j.errors && j.errors.length) throw new Error(j.errors.map(e => e.message).join('；'));
  return j.data;
}

/* ── Windows 通知（toast）── */
function toast(title, body) {
  if (process.platform !== 'win32') return false;
  const ps = `
$ErrorActionPreference = 'Stop'
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null
$x = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$n = $x.GetElementsByTagName('text')
$n.Item(0).AppendChild($x.CreateTextNode($env:TOAST_TITLE)) > $null
$n.Item(1).AppendChild($x.CreateTextNode($env:TOAST_BODY)) > $null
$app = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show((New-Object Windows.UI.Notifications.ToastNotification $x))
`;
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps],
    { env: { ...process.env, TOAST_TITLE: title, TOAST_BODY: body.slice(0, 180) }, encoding: 'utf8', timeout: 20000, windowsHide: true });
  return r.status === 0;
}

const readStdin = () => new Promise(res => { let d = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', c => d += c); process.stdin.on('end', () => res(d)); if (process.stdin.isTTY) res(''); });
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const toHtml = t => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').split(/\r?\n/).join('<br>');

/* ── setup：存 token ── */
async function setup() {
  console.log('請貼上你的 monday API token（個人 token；輸入時不會顯示，貼上後按 Enter）。');
  console.log('取得方式：monday 右上頭像 → Developers → My access tokens。\n');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  let muted = false; const w = rl._writeToOutput;
  rl._writeToOutput = s => { if (muted) return; w.call(rl, s); };
  const token = await new Promise(res => { rl.question('token: ', a => { rl.close(); res(a.replace(/[\s"'「」“”]/g, '')); }); muted = true; });
  console.log('');
  if (!token) { console.error('✖ 沒有收到任何字元：可能貼上沒成功，或還沒貼就按了 Enter。請重新執行一次，並在 token: 後面按右鍵貼上（畫面不會顯示內容，這是正常的），再按 Enter。'); process.exitCode = 1; return; }
  console.log('已收到 ' + token.length + ' 個字元' + (token.length < 100 ? '（偏短：一般 monday token 約 200 個字元以上，可能複製到別的東西了）' : '') + '，驗證中…');
  try {
    const d = await gql(token, 'query{ me{ name } }');
    fs.writeFileSync(TOKEN_FILE, token, { mode: 0o600 });
    console.log('✔ 連線成功：' + d.me.name + '\n  token 已存到：' + TOKEN_FILE + '（只在你的使用者資料夾，不在專案資料夾）');
  } catch (e) {
    console.error('✖ 驗證失敗（monday 回覆：' + e.message + '）。\n  請確認複製的是 monday「Developers → My access tokens」裡的 API token，完整、前後沒有多餘文字；若公司關閉了個人 token，需要請管理員開放。');
    process.exitCode = 1;     // 不用 process.exit，避免 Windows 上 Node 結束時的當機訊息
  }
}

/* ── analyze ── */
const rd = f => JSON.parse(fs.readFileSync(f, 'utf8')).boards[0].items_page.items;
async function analyze() {
  const scope = opt('scope') || 'daily', E = loadEngine();
  let items, done = [];
  if (opt('file')) { items = rd(opt('file')).map(E.normalize); if (opt('done')) done = rd(opt('done')).map(E.normalize); }
  else {
    const token = loadToken();
    if (!token) { toast('儀表板排程無法執行', '尚未設定 monday token。請雙擊 setup-monday-token.bat 設定一次。'); fail('NEED_TOKEN：尚未設定 monday token。請雙擊 setup-monday-token.bat 設定一次。', 2); }
    E.S.token = token; E.S.boardId = String(E.CONFIG.monday.boardId);
    try { items = await E.fetchActive(); done = await E.fetchDone().catch(() => []); }
    catch (e) { toast('儀表板排程讀取失敗', e.message); fail('讀取 monday 失敗：' + e.message); }
  }
  const today = opt('today') || E.todayStr(), A = E.analyze(items, today), K = E.CONFIG.rules;
  const wd = '日一二三四五六'[new Date(today + 'T00:00:00Z').getUTCDay()];
  const sm = i => ({ id: i.id, name: i.name, owner: E.shortName(i.owner), status: i.status, due: i.end || null, dueText: E.dueText(i), overdueDays: i.overdue || 0, inactiveDays: i.inactive, noUpdateRecord: !!i.noRecord, priority: i.prioLabel, url: i.url });
  const base = { today, weekday: '週' + wd, kpis: A.kpis };

  if (scope === 'daily') {
    return out({ ...base,
      decisions: A.decisions.slice(0, 8).map(d => d.kind === 'review'
        ? { type: 'review_backlog', severity: d.sev, headline: d.headline, byOwner: Object.fromEntries(Object.entries(d.dist).map(([o, n]) => [E.shortName(o), n])) }
        : { type: 'item', severity: d.sev, headline: d.headline, ...sm(d.item) }),
      reviewOldest: A.review.slice(0, 5).map(i => ({ ...sm(i), waitingDaysEstimate: i.reviewWait, holdReason: i.reviewReason || '未標示' })),
      reviewByHoldReason: Object.fromEntries(E.reasonCount(A.review)),                    // 審核等待原因分佈（monday「✏️審核等待原因」欄）
      queuedOver5Days: A.review.filter(i => i.reviewReason === '排隊待審' && i.reviewWait > 5).map(i => ({ ...sm(i), waitingDaysEstimate: i.reviewWait })),
      overdueBands: { mild: A.bands.mild.length, mid: A.bands.mid.length, severe: A.bands.severe.length },
      upcoming: A.upcoming.map(sm), likelyLate: A.forecast.slice(0, 8).map(f => ({ ...sm(f.item), reasons: f.why })), silent: A.silent.slice(0, 8).map(i => ({ ...sm(i), level: i.silent })),
      health: E.ownerHealth(A).map(h => ({ owner: E.shortName(h.owner), level: h.level, reasons: h.why, counts: h.counts, allWaitingForManager: !!h.waiting })),
      flow: (f => ({ recent3Weeks: f.recent3, weekly: f.rows.map(r => ({ weekStart: r.start, created: r.created, done: r.done })) }))(E.flowModel(items, done, today, 10)),
      note: '到期天數以預計時程結束日計算；審核等待天數為估計值（看板沒有送審時間）；看板無法判斷項目是否已線下審過。' });
  }

  if (scope === 'alert') {
    const L = E.CONFIG.statusLabels, live = A.act.filter(i => i.dueIn !== null && i.status !== L.notStarted && i.status !== L.paused);
    const cats = {
      dueToday: live.filter(i => i.dueIn === 0),
      dueSoonNoUpdate: live.filter(i => i.dueIn >= 1 && i.dueIn <= 3 && i.isRunning && i.inactive >= K.preDueNoUpdateDays),
      newlyOverdue: live.filter(i => i.dueIn === -1) };
    let st = {}; try { st = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch {}
    const recent = new Set(Object.entries(st).filter(([d]) => E.diffDays(d, today) <= 3 && d !== today).flatMap(([, v]) => v));   // 近 3 天已預警過的（id|類別）
    const result = {}, nowKeys = [];
    for (const [c, arr] of Object.entries(cats)) result[c] = arr.map(i => { const k = i.id + '|' + c, repeat = recent.has(k); nowKeys.push(k); return { ...sm(i), alreadyAlerted: repeat }; });
    const fresh = Object.values(result).flat().filter(x => !x.alreadyAlerted).length;
    if (!flag('no-state')) { st[today] = nowKeys; for (const d of Object.keys(st)) if (E.diffDays(d, today) > 7) delete st[d]; fs.writeFileSync(STATE_FILE, JSON.stringify(st)); }
    return out({ ...base, alertCount: fresh, alerts: result, note: 'alertCount 為「新的」預警數（近 3 天沒預警過）；為 0 時請不要發送任何訊息。' });
  }

  if (scope === 'weekly') {
    const W = E.weeklyModel(items, done, today, { win: 7, routine: false }), G = E.gmModel(A, items, done, today);
    const snip = s => (s || '').trim().slice(0, 400);
    return out({ ...base,
      silentRisk: A.silent.map(i => ({ ...sm(i), level: i.silent })),
      reviewQueue: { count: A.review.length, oldest: A.review.slice(0, 8).map(i => ({ ...sm(i), waitingDaysEstimate: i.reviewWait })) },
      meeting: { totals: W.totals, owners: W.owners.map(o => ({ owner: E.shortName(o.owner), reportCount: o.report.length, updatedLast7Days: o.fresh, notUpdated: o.stale,
        items: o.report.map(i => ({ ...sm(i), keyPoints: i.kpEmpty ? null : snip(i.keyPoints), keyPointsUpdatedDaysAgo: i.kpAge, updatedLast7Days: i.kpFresh })),
        pausedOrNotStarted: o.held.map(i => ({ name: i.name, status: i.status, dueText: E.dueText(i) })), doneLast7Days: o.done.map(i => i.name) })) },
      gm: { overallLevel: G.level, counts: G.c, projects: G.scope.map(i => ({ ...sm(i), riskLevel: i.risk.level, riskReasons: i.risk.why, timeElapsedPercent: i.timePct, latestProgress: i.latest || null })),
        doneLast14Days: G.doneRecent.map(i => ({ name: i.name, owner: E.shortName(i.owner), doneDate: i.doneDate })),
        flow: { recent3Weeks: G.flow.recent3, last4Weeks: G.flow.last4 } },
      health: G.health.map(h => ({ owner: E.shortName(h.owner), level: h.level, reasons: h.why, counts: h.counts, allWaitingForManager: !!h.waiting })),
      note: 'gm.projects 的 timeElapsedPercent 是「今天落在預計時程的位置」，不是工作完成度；看板沒有工作完成百分比。' });
  }
  fail('scope 必須是 daily、alert 或 weekly');
}

/* ── publish / toast ── */
async function publish() {
  const kind = opt('kind'); if (!TITLES[kind]) fail('kind 必須是 ' + Object.keys(TITLES).join('、'));
  const E = loadEngine(), itemId = E.CONFIG.aiOutput.items[kind], text = (await readStdin()).replace(/^﻿/, '').trim();
  if (!text) fail('標準輸入沒有內容');
  const token = loadToken(); if (!token) { toast('儀表板排程無法發佈', '尚未設定 monday token。請雙擊 setup-monday-token.bat。'); fail('NEED_TOKEN', 2); }
  const lines = text.split(/\r?\n/), summary = lines[0].replace(/\*\*/g, '').trim(), body = lines.slice(1).join('\n').trim() || summary;
  try {
    const d = await gql(token, 'mutation($i:ID!,$b:String!){ create_update(item_id:$i, body:$b){ id } }', { i: String(itemId), b: `<b>${esc(TITLES[kind])}｜${E.todayStr()}</b><br><br>${toHtml(summary)}<br><br>${toHtml(body)}` });
    const t = flag('toast') ? toast(TITLES[kind], summary) : null;
    out({ ok: true, kind, updateId: d.create_update.id, toast: t });
  } catch (e) { fail('發佈到 monday 失敗：' + e.message); }
}
async function toastCmd() {
  const kind = opt('kind'); if (!TITLES[kind]) fail('kind 必須是 ' + Object.keys(TITLES).join('、'));
  const text = (await readStdin()).replace(/^﻿/, '').trim().split(/\r?\n/)[0].replace(/\*\*/g, '');
  if (!text) fail('標準輸入沒有內容'); out({ ok: toast(TITLES[kind], text) });
}

(async () => {
  try {
    if (cmd === 'setup') await setup();
    else if (cmd === 'analyze') await analyze();
    else if (cmd === 'publish') await publish();
    else if (cmd === 'toast') await toastCmd();
    else { console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^[\s\S]*?\/\*\*/, '')); process.exit(cmd ? 1 : 0); }
  } catch (e) { fail(e.message); }
})();
