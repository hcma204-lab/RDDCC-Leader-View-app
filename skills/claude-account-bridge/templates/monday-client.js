/**
 * 網頁端：直接從瀏覽器讀 monday 看板（每個使用者貼自己的 API token）— 貼進頁面 <script>，無相依套件。
 * 實測可行：api.monday.com 允許瀏覽器跨網域呼叫（CORS），不需要後端。
 *
 * 你的頁面要提供：S（設定物件，含 token、boardId），以及 CONFIG（見下方範例）。
 * 原則：
 *   - token 只存在使用者自己的瀏覽器（localStorage），不放進程式、不放網址、不進 repo。
 *   - 預設唯讀。要寫回 monday（改狀態、留言）時，一律先顯示內容並讓使用者按確認。
 *   - 傳給 AI 前先「瘦身」（只留判斷需要的欄位），不要把整個看板 JSON 丟進去。
 */
const CONFIG = {
  monday: { apiUrl: 'https://api.monday.com/v2', apiVersion: '2025-04', boardId: 0 /* ← 改成你的看板 ID */ },
  // 要讀的欄位 ID（monday 看板欄位設定 → 進階 可看到；或用 get_board_info 取得）
  columns: { owner: 'person', status: 'status', timeline: 'timeline' },
  // 只抓「進行中」等狀態時用：status 欄位的 index 清單（可省略，省略就抓全部）
  statusFilterIndexes: null,
};

/* 單次查詢：回傳 data；錯誤一律翻成看得懂的中文 */
async function mondayQuery(query, variables) {
  let r;
  try {
    r = await fetch(CONFIG.monday.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': S.token, 'API-Version': CONFIG.monday.apiVersion },   // 注意：Authorization 直接放 token，不加 Bearer
      body: JSON.stringify({ query, variables }),
    });
  } catch (e) { throw new Error('連不到 monday（網路或公司防火牆擋住 api.monday.com）：' + e.message); }
  const j = await r.json().catch(() => null);
  if (!j) throw new Error(r.status === 401 ? mondayErr(401, '') : 'monday 回應不是 JSON（HTTP ' + r.status + '）');
  if (j.errors && j.errors.length) throw new Error(mondayErr(r.status, j.errors.map(e => e.message).join('；')));
  if (j.error_message) throw new Error(mondayErr(r.status, j.error_message));
  return j.data;
}
function mondayErr(status, raw) {
  raw = String(raw || '');
  if (status === 401 || /not authenticated|invalid token/i.test(raw)) return 'monday 拒絕了這組 token（貼錯、已被重新產生，或被管理員撤銷）。請重新貼上新的 token。';
  if (/DAILY_LIMIT/i.test(raw)) return '今天 monday 的 API 呼叫次數已用完，明天（UTC 午夜後）會重置。';
  if (/COMPLEXITY|rate limit|minute limit|429/i.test(raw) || status === 429) return 'monday 暫時限流，請等一分鐘後再試。';
  if (/permission|not allowed|forbidden|unauthorized/i.test(raw) || status === 403) return '你的 monday 帳號沒有權限讀取這個資料（' + raw + '）。請確認你是該工作區的成員。';
  return raw || ('monday 回應錯誤（HTTP ' + status + '）');
}

/* 讀整個看板（自動翻頁）。回傳 [{id,name,url,group,cols:{欄位ID: 文字}}] */
async function fetchBoardItems(boardId) {
  const ids = Object.values(CONFIG.columns);
  const F = `id name url group{title} column_values(ids:${JSON.stringify(ids)}){id text}`;
  const rules = CONFIG.statusFilterIndexes
    ? `, query_params:{rules:[{column_id:"${CONFIG.columns.status}", compare_value:${JSON.stringify(CONFIG.statusFilterIndexes)}, operator:any_of}]}` : '';
  let d = await mondayQuery(`query($b:[ID!]){ boards(ids:$b){ items_page(limit:200${rules}){ cursor items{ ${F} } } } }`, { b: [boardId || CONFIG.monday.boardId] });
  let page = d.boards && d.boards[0] && d.boards[0].items_page;
  if (!page) throw new Error('看不到看板 ' + boardId + '：請確認看板 ID 正確，而且你的 monday 帳號是該工作區的成員。');
  const raw = [...page.items];
  for (let n = 0; page.cursor && n < 30; n++) {                        // cursor 翻頁，最多 30 頁（6000 筆）
    d = await mondayQuery(`query($c:String!){ next_items_page(limit:200, cursor:$c){ cursor items{ ${F} } } }`, { c: page.cursor });
    page = d.next_items_page; raw.push(...page.items);
  }
  return raw.map(it => ({ id: it.id, name: it.name, url: it.url, group: it.group && it.group.title,
    cols: Object.fromEntries(it.column_values.map(c => [c.id, c.text || ''])) }));
}

/* 測試 token 是否可用 */
async function testMonday() { const d = await mondayQuery('query{ me{ name } }'); return d.me.name; }

/* 給 AI 的內容：瘦身 + 限量。AI 只需要判斷用的欄位，不要整包丟 */
const slimItem = it => [it.name, it.cols[CONFIG.columns.owner], it.cols[CONFIG.columns.status], it.cols[CONFIG.columns.timeline]].filter(Boolean).join('|');
const aiContext = (items, limit = 150) => items.slice(0, limit).map(slimItem).join('\n');

/* 用法範例（接 bridge-client.js 的 askClaude）：
 *   const items = await fetchBoardItems();
 *   const text = await askClaude('你是專案進度助理，用繁體中文、條列、不超過 8 點。', '今天是 ' + new Date().toISOString().slice(0,10) + '，以下是看板項目：\n' + aiContext(items) + '\n請找出需要主管注意的項目。');
 */
