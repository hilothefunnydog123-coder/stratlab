/* StratLab UI glue: wires the editor, translator, engine and chart together. */
'use strict';

const $ = (id) => document.getElementById(id);
const DATA = window.MARKET_DATA;

// populate ticker dropdown
const tickerSel = $('ticker');
for (const [key, val] of Object.entries(DATA)) {
  const opt = document.createElement('option');
  opt.value = key;
  opt.textContent = val.label;
  tickerSel.appendChild(opt);
}

function fmtPct(x) { return `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`; }

function showError(msg) {
  const box = $('error');
  box.textContent = msg;
}

function renderMetrics(m) {
  const beat = m.totalReturn > m.benchReturn;
  const cards = [
    { k: 'Total return', v: fmtPct(m.totalReturn), cls: m.totalReturn >= 0 ? 'pos' : 'neg', cmp: `buy & hold ${fmtPct(m.benchReturn)}` },
    { k: 'Sharpe', v: m.sharpe.toFixed(2), cls: m.sharpe >= 0 ? 'pos' : 'neg', cmp: 'risk-adjusted' },
    { k: 'Max drawdown', v: fmtPct(m.maxDrawdown), cls: 'neg', cmp: `vs ${fmtPct(m.benchMaxDrawdown)}` },
    { k: 'Time in market', v: `${Math.round(m.exposure * 100)}%`, cls: '', cmp: `${m.trades} trades` },
  ];
  $('metrics').innerHTML = cards.map((c) =>
    `<div class="metric"><div class="k">${c.k}</div><div class="v ${c.cls}">${c.v}</div><div class="cmp">${c.cmp}</div></div>`
  ).join('');
  const verdict = beat ? '✅ beating buy & hold' : '▪️ trailing buy & hold';
  $('asof').textContent = verdict;
}

function drawChart(res) {
  const canvas = $('chart');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height, pad = 34;
  ctx.clearRect(0, 0, W, H);

  const all = res.equity.concat(res.bench);
  let lo = Math.min(...all), hi = Math.max(...all);
  const span = (hi - lo) || 1;
  const n = res.equity.length;
  const x = (i) => pad + (i / (n - 1)) * (W - 2 * pad);
  const y = (v) => pad + (1 - (v - lo) / span) * (H - 2 * pad);

  // grid
  ctx.strokeStyle = '#1b2230'; ctx.lineWidth = 1;
  for (let g = 0; g <= 4; g++) {
    const gy = pad + (g / 4) * (H - 2 * pad);
    ctx.beginPath(); ctx.moveTo(pad, gy); ctx.lineTo(W - pad, gy); ctx.stroke();
  }
  // starting-capital baseline
  ctx.strokeStyle = '#2b3444'; ctx.setLineDash([4, 4]);
  const by = y(res.equity[0]);
  ctx.beginPath(); ctx.moveTo(pad, by); ctx.lineTo(W - pad, by); ctx.stroke();
  ctx.setLineDash([]);

  const line = (series, color, width) => {
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = 'round';
    ctx.beginPath();
    series.forEach((v, i) => { const px = x(i), py = y(v); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
    ctx.stroke();
  };
  line(res.bench, '#58a6ff', 1.6);
  // strategy area fill
  ctx.fillStyle = 'rgba(63,185,80,0.12)';
  ctx.beginPath();
  res.equity.forEach((v, i) => { const px = x(i), py = y(v); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
  ctx.lineTo(x(n - 1), H - pad); ctx.lineTo(x(0), H - pad); ctx.closePath(); ctx.fill();
  line(res.equity, '#3fb950', 2.4);

  // y labels
  ctx.fillStyle = '#8b949e'; ctx.font = '11px system-ui'; ctx.textAlign = 'left';
  ctx.fillText('$' + Math.round(hi).toLocaleString(), 4, pad + 4);
  ctx.fillText('$' + Math.round(lo).toLocaleString(), 4, H - pad + 4);
}

function run() {
  showError('');
  try {
    const prog = window.StratLab.compile($('code').value);
    const prices = DATA[tickerSel.value].prices;
    const res = window.StratLab.backtest(prog, prices, { initial: 10000, costBps: 1 });
    renderMetrics(res.metrics);
    drawChart(res);
  } catch (e) {
    const loc = e.line ? ` (line ${e.line})` : '';
    showError('⚠ ' + e.message + loc);
  }
}

function doTranslate() {
  const out = window.translate($('nl').value);
  $('code').value = out.code;
  $('aiNote').textContent = out.matched
    ? `✨ Matched: ${out.name} — generated StratLang below. Edit it, then Backtest.`
    : `✨ No exact match — starting you with ${out.name}. Edit it, then Backtest.`;
  run();
}

// events
$('run').addEventListener('click', run);
$('translate').addEventListener('click', doTranslate);
$('nl').addEventListener('keydown', (e) => { if (e.key === 'Enter') doTranslate(); });
tickerSel.addEventListener('change', run);
$('code').addEventListener('input', () => { $('aiNote').textContent = ''; });
document.querySelectorAll('.ex').forEach((b) =>
  b.addEventListener('click', () => { $('code').value = b.dataset.code; run(); })
);

// first render
run();
