const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE_DIR = __dirname;
const TRADES_DIR = path.join(BASE_DIR, 'trades');
const STATS_FILE = path.join(BASE_DIR, 'stats', 'performance.json');
const PORT = 3456;

function readStats() {
  try {
    return JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
  } catch {
    return { total_trades: 0, win_rate: 0, streak_current: 0, streak_type: null, avg_rr_realized: 0 };
  }
}

function parseTrade(filename, content) {
  const name = path.basename(filename, '.md');
  const parts = name.split('_');
  const date = parts[0] || '';
  const symbol = parts[1] || '';
  const direction = parts[2] || '';

  const get = (pattern) => { const m = content.match(pattern); return m ? m[1].trim() : ''; };

  const entry   = get(/Entry:\s*([\d,]+)/);
  const sl      = get(/SL:\s*([\d,]+)/);
  const tp      = get(/TP1?:\s*([\d,]+)/);
  const rrPlan  = get(/R:R מתוכנן:\s*([\d.]+)/);
  const rrReal  = get(/R realized:\s*\*\*([^*]+)\*\*/) || get(/R realized:\s*([^\n]+)/);
  const contracts    = get(/חוזים:\s*\**(\d+)/);
  const actualRisk   = get(/ריסק בפועל:\s*\$([\d,]+)/);
  const portfolioVal = get(/תיק אחרי עסקה:\s*\*\*\$([\d,]+)\*\*/);
  const killzone     = get(/Kill Zone:\s*([^\n|]+)/);

  // Result
  const closureRaw = get(/סגירה:\s*\*\*([^*]+)\*\*/);
  let result = closureRaw || 'UNKNOWN';

  // P&L
  const pnlMatch = content.match(/\*\*([-+]?\$[\d,]+)\*\*/);
  let pnlUsd = 0;
  if (pnlMatch) pnlUsd = parseFloat(pnlMatch[1].replace(/[$,]/g, '')) || 0;

  // Analysis sections
  const analysisSec = (content.match(/## ניתוח שהוביל להחלטה\n([\s\S]+?)(?=\n## )/) || [])[1] || '';
  const lessonsSec  = (content.match(/## לקחים\n([\s\S]+?)$/) || [])[1] || '';
  const whatHappened = (content.match(/## מה קרה בפועל\n([\s\S]+?)(?=\n## )/) || [])[1] || '';

  const isWin = result === 'TP1' || result === 'TP2' || (rrReal && !rrReal.startsWith('-') && rrReal !== '0');

  return {
    filename: name, date, symbol, direction,
    entry: entry.replace(',', ''),
    sl: sl.replace(',', ''),
    tp: tp.replace(',', ''),
    rrPlan, rrReal, result, pnlUsd,
    contracts, actualRisk: actualRisk ? actualRisk.replace(',','') : '',
    portfolioVal: portfolioVal ? parseInt(portfolioVal.replace(/,/g,'')) : null,
    killzone: killzone.trim(),
    isWin, analysisSec: analysisSec.trim(),
    lessonsSec: lessonsSec.trim(),
    whatHappened: whatHappened.trim()
  };
}

function readTrades() {
  try {
    if (!fs.existsSync(TRADES_DIR)) return [];
    return fs.readdirSync(TRADES_DIR)
      .filter(f => f.endsWith('.md'))
      .map(f => parseTrade(f, fs.readFileSync(path.join(TRADES_DIR, f), 'utf8')))
      .sort((a, b) => b.date.localeCompare(a.date));
  } catch { return []; }
}

function fmtDate(d) {
  const p = (d || '').split('-');
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0].slice(2)}` : d;
}

function buildPage(stats, trades) {
  const wins = trades.filter(t => t.isWin).length;
  const losses = trades.length - wins;
  const totalPnl = trades.reduce((s, t) => s + (t.pnlUsd || 0), 0);
  const wr = trades.length ? Math.round(wins / trades.length * 100) : 0;

  // portfolio progression from performance.json (balance, not just P&L)
  const STARTING = (stats.account && stats.account.starting_balance) || 50000;
  const currentBalance = (stats.account && stats.account.current_balance) || (STARTING + totalPnl);
  const totalPnlPct = ((currentBalance - STARTING) / STARTING * 100).toFixed(2);

  const progData = (stats.portfolio_progression || []);
  const equityPoints = progData.length
    ? progData.map(p => ({ label: p.date === 'start' ? 'פתיחה' : fmtDate(p.date), value: p.balance }))
    : [{ label: 'פתיחה', value: STARTING }, ...(() => { let b = STARTING; return [...trades].reverse().map(t => { b += t.pnlUsd || 0; return { label: fmtDate(t.date), value: b }; }); })()];

  // legacy cumulative P&L (still used for donut / tooltip)
  let cum = 0;
  const pnlPoints = [...trades].reverse().map(t => {
    cum += t.pnlUsd || 0;
    return { label: fmtDate(t.date), value: cum };
  });

  const kzRows = Object.entries(stats.by_kill_zone || {}).map(([k, v]) => {
    const kzNames = { ny_open: 'NY Open 16:30', london: 'London 10:30', ny_pm: 'NY PM 20:30', asia: 'Asia 02:00' };
    const pct = v.count > 0 ? Math.round(v.wins / v.count * 100) : 0;
    return `<div class="bar-row">
      <span class="bar-label">${kzNames[k] || k}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
      <span class="bar-pct">${pct}% <span class="bar-sub">(${v.wins}/${v.count})</span></span>
    </div>`;
  }).join('') || '<p class="empty-txt">אין נתונים עדיין</p>';

  const setupRows = Object.entries(stats.by_setup || {}).map(([k, v]) => {
    const pct = v.count > 0 ? Math.round(v.wins / v.count * 100) : 0;
    return `<div class="bar-row">
      <span class="bar-label">${k}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
      <span class="bar-pct">${pct}% <span class="bar-sub">(${v.wins}/${v.count})</span></span>
    </div>`;
  }).join('') || '<p class="empty-txt">אין נתונים עדיין</p>';

  const tradeRows = trades.map((t, i) => {
    const dir = t.direction.toLowerCase();
    const res = t.result.toLowerCase();
    const portfolioStr = t.portfolioVal ? '$' + t.portfolioVal.toLocaleString('en-US') : '—';
    return `<tr class="tr-row" onclick="openModal(${i})">
      <td>${fmtDate(t.date)}</td>
      <td><strong>${t.symbol}</strong></td>
      <td><span class="badge dir-${dir}">${t.direction}</span></td>
      <td class="num">${t.entry}</td>
      <td class="num red">${t.sl}</td>
      <td class="num green">${t.tp}</td>
      <td><span class="badge res-${res}">${t.result}</span></td>
      <td class="${t.isWin ? 'green' : 'red'}">${t.rrReal || '—'}</td>
      <td class="contracts">${t.contracts ? t.contracts + ' MNQ' : '—'}</td>
      <td class="${t.pnlUsd >= 0 ? 'green' : 'red'} bold">${t.pnlUsd >= 0 ? '+' : ''}$${Math.abs(t.pnlUsd)}</td>
      <td class="${t.isWin ? 'green' : 'red'} num" style="font-size:12px">${portfolioStr}</td>
    </tr>`;
  }).join('');

  const tradesJson = JSON.stringify(trades).replace(/</g, '\\u003c');
  const pnlJson    = JSON.stringify(pnlPoints);

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Trading Dashboard</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"><\/script>
<style>
:root{
  --bg:#131722;--surface:#1e222d;--surface2:#2a2e39;--border:#2a2e39;
  --text:#d1d4dc;--muted:#787b86;--green:#26a69a;--red:#ef5350;
  --blue:#2196f3;--yellow:#f7a600;--purple:#ab47bc;
}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--text);font-family:'Segoe UI',system-ui,sans-serif;min-height:100vh;direction:rtl}
a{color:inherit;text-decoration:none}

/* HEADER */
.header{
  background:var(--surface);border-bottom:1px solid var(--border);
  padding:14px 28px;display:flex;align-items:center;justify-content:space-between;
  position:sticky;top:0;z-index:50;
}
.header-left{display:flex;align-items:center;gap:12px}
.header-logo{font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.5px}
.header-logo span{color:var(--green)}
.live-pill{
  background:#26a69a18;border:1px solid var(--green);color:var(--green);
  padding:3px 12px;border-radius:20px;font-size:11px;font-weight:600;letter-spacing:1px
}
.header-time{color:var(--muted);font-size:13px}

/* STATS ROW */
.stats-row{
  display:grid;grid-template-columns:repeat(5,1fr);gap:14px;
  padding:20px 28px;
}
.scard{
  background:var(--surface);border:1px solid var(--border);border-radius:10px;
  padding:18px 20px;position:relative;overflow:hidden;
  transition:border-color 0.2s;
}
.scard:hover{border-color:var(--blue)}
.scard::before{
  content:'';position:absolute;top:0;right:0;width:3px;height:100%;
  border-radius:0 10px 10px 0;
}
.scard.blue::before{background:var(--blue)}
.scard.green::before{background:var(--green)}
.scard.red::before{background:var(--red)}
.scard.yellow::before{background:var(--yellow)}
.scard.purple::before{background:var(--purple)}
.scard-label{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px}
.scard-val{font-size:28px;font-weight:800;line-height:1}
.scard-val.c-blue{color:var(--blue)}
.scard-val.c-green{color:var(--green)}
.scard-val.c-red{color:var(--red)}
.scard-val.c-yellow{color:var(--yellow)}
.scard-val.c-purple{color:var(--purple)}
.scard-sub{font-size:12px;color:var(--muted);margin-top:6px}

/* TABS */
.tabs{
  display:flex;padding:0 28px;
  border-bottom:1px solid var(--border);gap:2px;background:var(--bg);
}
.tab{
  padding:13px 22px;cursor:pointer;border-bottom:2px solid transparent;
  color:var(--muted);font-size:14px;font-weight:500;
  transition:all 0.2s;border-radius:4px 4px 0 0;
  display:flex;align-items:center;gap:8px;
}
.tab:hover{color:var(--text);background:var(--surface)}
.tab.active{color:#fff;border-bottom-color:var(--blue);background:var(--surface)}

/* CONTENT */
.content{padding:24px 28px;display:none}
.content.active{display:block}

/* CHARTS GRID */
.charts-grid{display:grid;grid-template-columns:3fr 1.4fr;gap:18px;margin-bottom:18px}
.info-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}
.card{
  background:var(--surface);border:1px solid var(--border);
  border-radius:10px;padding:20px;
}
.card h3{font-size:13px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:18px}

/* BAR ROWS */
.bar-row{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid #2a2e3955}
.bar-row:last-child{border-bottom:none}
.bar-label{width:120px;font-size:13px;color:var(--text);flex-shrink:0}
.bar-track{flex:1;height:6px;background:var(--surface2);border-radius:3px;overflow:hidden}
.bar-fill{height:100%;background:var(--blue);border-radius:3px;transition:width 0.6s ease}
.bar-pct{width:70px;font-size:13px;color:var(--text);text-align:left;flex-shrink:0}
.bar-sub{color:var(--muted);font-size:11px}
.empty-txt{color:var(--muted);font-size:13px;padding:12px 0}

/* LESSONS */
.lesson-list{display:flex;flex-direction:column;gap:8px}
.lesson-item{
  display:flex;align-items:flex-start;gap:10px;
  font-size:13px;color:var(--text);padding:8px 10px;
  background:var(--surface2);border-radius:6px;
}
.lesson-icon{flex-shrink:0;font-size:15px}

/* TABLE */
.table-wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse}
thead th{
  padding:10px 14px;font-size:11px;font-weight:700;
  text-transform:uppercase;letter-spacing:0.5px;
  color:var(--muted);background:var(--surface2);
  white-space:nowrap;
}
thead th:first-child{border-radius:8px 0 0 8px}
thead th:last-child{border-radius:0 8px 8px 0}
.tr-row td{padding:13px 14px;font-size:14px;border-bottom:1px solid #2a2e3940}
.tr-row{cursor:pointer;transition:background 0.15s}
.tr-row:hover{background:var(--surface2)}
.tr-row:last-child td{border-bottom:none}
.num{font-family:monospace;font-size:13px}
.bold{font-weight:700}
.green{color:var(--green)}
.red{color:var(--red)}
.contracts{color:var(--muted);font-size:13px}

/* BADGES */
.badge{
  display:inline-block;padding:3px 9px;border-radius:5px;
  font-size:11px;font-weight:700;letter-spacing:0.5px;
}
.dir-long{background:#26a69a1a;color:var(--green);border:1px solid #26a69a30}
.dir-short{background:#ef53501a;color:var(--red);border:1px solid #ef535030}
.res-sl{background:#ef53501a;color:var(--red);border:1px solid #ef535030}
.res-tp1{background:#26a69a1a;color:var(--green);border:1px solid #26a69a30}
.res-tp2{background:#00bcd41a;color:#00bcd4;border:1px solid #00bcd430}
.res-manual{background:#f7a6001a;color:var(--yellow);border:1px solid #f7a60030}
.res-unknown{background:#78787818;color:var(--muted);border:1px solid #78787830}

/* MODAL */
.overlay{
  display:none;position:fixed;inset:0;
  background:rgba(0,0,0,0.75);backdrop-filter:blur(4px);
  z-index:200;align-items:center;justify-content:center;
}
.overlay.open{display:flex}
.modal{
  background:var(--surface);border:1px solid var(--border);
  border-radius:14px;width:680px;max-width:95vw;
  max-height:88vh;overflow-y:auto;
  padding:30px;position:relative;
  animation:slideUp 0.2s ease;
}
@keyframes slideUp{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}
.modal-close{
  position:sticky;top:0;float:left;
  background:var(--surface2);border:1px solid var(--border);
  color:var(--muted);font-size:16px;cursor:pointer;
  padding:5px 10px;border-radius:6px;margin-bottom:4px;
  transition:all 0.15s;
}
.modal-close:hover{background:var(--red);color:#fff;border-color:var(--red)}
.modal-title{font-size:20px;font-weight:800;color:#fff;margin-bottom:4px}
.modal-sub{color:var(--muted);font-size:13px;margin-bottom:20px}
.result-banner{
  padding:13px 18px;border-radius:8px;margin-bottom:22px;
  font-size:15px;font-weight:700;display:flex;align-items:center;gap:10px;
}
.result-banner.win{background:#26a69a15;color:var(--green);border:1px solid #26a69a30}
.result-banner.loss{background:#ef535015;color:var(--red);border:1px solid #ef535030}
.param-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:22px}
.param-box{
  background:var(--surface2);border:1px solid var(--border);
  border-radius:8px;padding:14px;
}
.param-key{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px}
.param-val{font-size:18px;font-weight:700;color:#fff}
.param-val.green{color:var(--green)}
.param-val.red{color:var(--red)}
.section{margin-bottom:18px}
.section h4{
  font-size:11px;font-weight:700;text-transform:uppercase;
  letter-spacing:1px;color:var(--blue);margin-bottom:10px;
  display:flex;align-items:center;gap:8px;
}
.section h4::after{content:'';flex:1;height:1px;background:var(--border)}
.section pre{
  font-family:'Segoe UI',sans-serif;font-size:13px;
  color:var(--muted);line-height:1.7;white-space:pre-wrap;
  background:var(--surface2);border-radius:8px;padding:14px;
}

/* EMPTY STATE */
.empty-state{
  text-align:center;padding:80px 20px;
  display:flex;flex-direction:column;align-items:center;gap:14px;
}
.empty-state .icon{font-size:52px}
.empty-state p{color:var(--muted);font-size:15px}

/* REFRESH */
.refresh-btn{
  background:var(--surface2);border:1px solid var(--border);
  color:var(--muted);padding:6px 14px;border-radius:6px;
  font-size:12px;cursor:pointer;transition:all 0.15s;
}
.refresh-btn:hover{background:var(--blue);color:#fff;border-color:var(--blue)}

/* scrollbar */
::-webkit-scrollbar{width:6px;height:6px}
::-webkit-scrollbar-track{background:var(--bg)}
::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px}
::-webkit-scrollbar-thumb:hover{background:var(--muted)}
</style>
</head>
<body>

<div class="header">
  <div class="header-left">
    <div class="header-logo">📊 Trading<span>Bot</span></div>
    <span class="live-pill">● LIVE LOCAL</span>
  </div>
  <div style="display:flex;align-items:center;gap:14px">
    <button class="refresh-btn" onclick="location.reload()">🔄 רענון</button>
    <span class="header-time" id="clock"></span>
  </div>
</div>

<div class="stats-row">
  <div class="scard ${totalPnl >= 0 ? 'green' : 'red'}">
    <div class="scard-label">שווי תיק (סימולציה)</div>
    <div class="scard-val ${totalPnl >= 0 ? 'c-green' : 'c-red'}">$${currentBalance.toLocaleString('en-US')}</div>
    <div class="scard-sub">פתיחה $${STARTING.toLocaleString('en-US')} | ${totalPnl >= 0 ? '+' : ''}${totalPnlPct}%</div>
  </div>
  <div class="scard ${totalPnl >= 0 ? 'green' : 'red'}">
    <div class="scard-label">P&L כולל</div>
    <div class="scard-val ${totalPnl >= 0 ? 'c-green' : 'c-red'}">${totalPnl >= 0 ? '+' : ''}$${Math.abs(totalPnl).toLocaleString('en-US')}</div>
    <div class="scard-sub">${wins} רווח / ${losses} הפסד</div>
  </div>
  <div class="scard ${wr >= 50 ? 'green' : 'red'}">
    <div class="scard-label">אחוז הצלחה</div>
    <div class="scard-val ${wr >= 50 ? 'c-green' : 'c-red'}">${wr}%</div>
    <div class="scard-sub">${trades.length} עסקאות | יעד: 40%+</div>
  </div>
  <div class="scard ${(stats.avg_rr_realized || 0) >= 2 ? 'green' : 'yellow'}">
    <div class="scard-label">R:R ממוצע בפועל</div>
    <div class="scard-val ${(stats.avg_rr_realized || 0) >= 2 ? 'c-green' : 'c-yellow'}">${stats.avg_rr_realized || 0}R</div>
    <div class="scard-sub">יעד: 2:1 לפחות</div>
  </div>
  <div class="scard ${stats.streak_type === 'win' ? 'green' : stats.streak_type === 'loss' ? 'red' : 'purple'}">
    <div class="scard-label">רצף נוכחי</div>
    <div class="scard-val ${stats.streak_type === 'win' ? 'c-green' : stats.streak_type === 'loss' ? 'c-red' : 'c-purple'}">${stats.streak_current || 0} ${stats.streak_type === 'win' ? '🟢' : stats.streak_type === 'loss' ? '🔴' : '—'}</div>
    <div class="scard-sub">${stats.streak_type === 'loss' && (stats.streak_current || 0) >= 2 ? '⚠️ עצור לשארית היום!' : 'עקוב אחר הרצף'}</div>
  </div>
</div>

<div class="tabs">
  <div class="tab active" onclick="switchTab('stats',this)">📈 סטטיסטיקות</div>
  <div class="tab" onclick="switchTab('journal',this)">📋 יומן עסקאות</div>
</div>

<!-- ===== STATS TAB ===== -->
<div id="tab-stats" class="content active">
  <div class="charts-grid">
    <div class="card">
      <h3>עקומת הון — שווי תיק בפועל ($)</h3>
      <canvas id="pnlChart" height="85"></canvas>
    </div>
    <div class="card">
      <h3>ניצחון / הפסד</h3>
      <canvas id="donutChart" height="180"></canvas>
    </div>
  </div>
  <div class="info-grid">
    <div class="card">
      <h3>אחוז הצלחה לפי Kill Zone</h3>
      ${kzRows}
    </div>
    <div class="card">
      <h3>אחוז הצלחה לפי סטאפ</h3>
      ${setupRows}
    </div>
  </div>
  ${(stats.lessons_applied && stats.lessons_applied.length) ? `
  <div class="card" style="margin-top:18px">
    <h3>כללים שיושמו עד כה</h3>
    <div class="lesson-list">
      ${stats.lessons_applied.map(l => `<div class="lesson-item"><span class="lesson-icon">✅</span><span>${l}</span></div>`).join('')}
    </div>
  </div>` : ''}
</div>

<!-- ===== JOURNAL TAB ===== -->
<div id="tab-journal" class="content">
  ${trades.length === 0 ? `
  <div class="empty-state">
    <div class="icon">📭</div>
    <p>אין עסקאות מתועדות עדיין — בצע עסקה ראשונה</p>
  </div>` : `
  <div class="card">
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>תאריך</th><th>סימבול</th><th>כיוון</th>
            <th>כניסה</th><th>SL</th><th>TP</th>
            <th>תוצאה</th><th>R:R</th><th>חוזים</th><th>P&L</th><th>שווי תיק</th>
          </tr>
        </thead>
        <tbody>${tradeRows}</tbody>
      </table>
    </div>
  </div>`}
</div>

<!-- ===== MODAL ===== -->
<div class="overlay" id="overlay" onclick="closeOnBg(event)">
  <div class="modal">
    <button class="modal-close" onclick="closeModal()">✕ סגור</button>
    <div id="modalBody"></div>
  </div>
</div>

<script>
const TRADES = ${tradesJson};
const PNL_PTS = ${pnlJson};
const EQUITY_PTS = ${JSON.stringify(equityPoints)};
const STARTING_BAL = ${STARTING};

// Clock
function tick(){
  const n=new Date();
  document.getElementById('clock').textContent=
    n.toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit',second:'2-digit'})+' IL';
}
tick(); setInterval(tick,1000);

// Tabs
function switchTab(id, el) {
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  document.querySelectorAll('.content').forEach(c=>c.classList.remove('active'));
  document.getElementById('tab-'+id).classList.add('active');
}

// Charts
Chart.defaults.color = '#787b86';
Chart.defaults.borderColor = '#2a2e39';

const lastEquity = EQUITY_PTS.length ? EQUITY_PTS[EQUITY_PTS.length-1].value : STARTING_BAL;
const equityColor = lastEquity >= STARTING_BAL ? '#26a69a' : '#ef5350';
const equityBg    = lastEquity >= STARTING_BAL ? '#26a69a15' : '#ef535015';

new Chart(document.getElementById('pnlChart'), {
  type: 'line',
  data: {
    labels: EQUITY_PTS.map(p=>p.label),
    datasets: [{
      data: EQUITY_PTS.map(p=>p.value),
      borderColor: equityColor, backgroundColor: equityBg,
      fill: true, tension: 0.35, pointRadius: 6,
      pointBackgroundColor: '#1e222d', pointBorderColor: equityColor, pointBorderWidth: 2,
      pointHoverRadius: 9
    }]
  },
  options: {
    responsive:true,
    plugins:{
      legend:{display:false},
      tooltip:{callbacks:{label:c=>' $'+c.parsed.y.toLocaleString('en-US')}}
    },
    scales:{
      x:{grid:{color:'#2a2e3960'},ticks:{color:'#787b86'}},
      y:{
        grid:{color:'#2a2e3960'},
        ticks:{color:'#787b86',callback:v=>'$'+v.toLocaleString('en-US')},
        min: Math.floor(Math.min(...EQUITY_PTS.map(p=>p.value)) * 0.998)
      }
    }
  }
});

new Chart(document.getElementById('donutChart'), {
  type: 'doughnut',
  data: {
    labels: ['ניצחונות','הפסדים'],
    datasets:[{
      data: [${wins || 0}, ${losses || 1}],
      backgroundColor:['#26a69a','#ef5350'],
      borderColor:['#26a69a55','#ef535055'],
      borderWidth:2
    }]
  },
  options: {
    responsive:true, cutout:'68%',
    plugins:{
      legend:{position:'bottom',labels:{color:'#d1d4dc',padding:20,font:{size:13}}},
      tooltip:{callbacks:{label:c=>' '+c.label+': '+c.parsed}}
    }
  }
});

// Modal
function fmtDate(d){
  const p=(d||'').split('-');
  return p.length===3?p[2]+'/'+p[1]+'/'+p[0].slice(2):d;
}

function openModal(idx) {
  const t = TRADES[idx];
  const win = t.isWin;
  document.getElementById('modalBody').innerHTML = \`
    <div class="modal-title">\${t.symbol} \${t.direction} — \${fmtDate(t.date)}</div>
    <div class="modal-sub">עסקה #\${idx+1}\${t.contracts?' | '+t.contracts+' חוזים':''}\${t.killzone?' | Kill Zone: '+t.killzone:''}</div>
    <div class="result-banner \${win?'win':'loss'}">
      \${win?'✅ רווח':'❌ הפסד'} &nbsp;|&nbsp; תוצאה: \${t.result} &nbsp;|&nbsp; P&L: \${t.pnlUsd>=0?'+':''}\$\${Math.abs(t.pnlUsd)} &nbsp;|&nbsp; R realized: \${t.rrReal||'—'}
    </div>
    <div class="param-grid">
      <div class="param-box"><div class="param-key">כניסה</div><div class="param-val">\${t.entry||'—'}</div></div>
      <div class="param-box"><div class="param-key">Stop Loss</div><div class="param-val red">\${t.sl||'—'}</div></div>
      <div class="param-box"><div class="param-key">Take Profit</div><div class="param-val green">\${t.tp||'—'}</div></div>
      <div class="param-box"><div class="param-key">R:R מתוכנן</div><div class="param-val">\${t.rrPlan?t.rrPlan+':1':'—'}</div></div>
      <div class="param-box"><div class="param-key">R:R בפועל</div><div class="param-val \${win?'green':'red'}">\${t.rrReal||'—'}</div></div>
      <div class="param-box"><div class="param-key">חוזים</div><div class="param-val">\${t.contracts?t.contracts+' MNQ':'—'}</div></div>
      <div class="param-box"><div class="param-key">ריסק בפועל</div><div class="param-val red">\${t.actualRisk?'$'+parseInt(t.actualRisk).toLocaleString('en-US'):'—'}</div></div>
      <div class="param-box"><div class="param-key">שווי תיק אחרי עסקה</div><div class="param-val \${win?'green':'red'}">\${t.portfolioVal?'$'+t.portfolioVal.toLocaleString('en-US'):'—'}</div></div>
    </div>
    \${t.analysisSec?\`<div class="section"><h4>ניתוח שהוביל להחלטה</h4><pre>\${t.analysisSec}</pre></div>\`:''}
    \${t.whatHappened?\`<div class="section"><h4>מה קרה בפועל</h4><pre>\${t.whatHappened}</pre></div>\`:''}
    \${t.lessonsSec?\`<div class="section"><h4>לקחים</h4><pre>\${t.lessonsSec}</pre></div>\`:''}
  \`;
  document.getElementById('overlay').classList.add('open');
}
function closeModal(){document.getElementById('overlay').classList.remove('open')}
function closeOnBg(e){if(e.target===document.getElementById('overlay'))closeModal()}
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal()})
<\/script>
</body>
</html>`;
}

const server = http.createServer((req, res) => {
  if (req.url === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  const stats = readStats();
  const trades = readTrades();
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(buildPage(stats, trades));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('  ┌─────────────────────────────────────────┐');
  console.log('  │  📊 Trading Dashboard — פעיל            │');
  console.log(`  │  http://localhost:${PORT}                  │`);
  console.log('  │  Ctrl+C לעצירה                           │');
  console.log('  └─────────────────────────────────────────┘');
  console.log('');
});
