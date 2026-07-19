/* StratLab quant engine — a browser port of the quantlang parser + quantsim
 * backtester. Same design principles as the Python originals:
 *   - recursive-descent parser with real precedence
 *   - NO LOOKAHEAD: the weight chosen from data through bar t earns the
 *     return from t to t+1, never t's own return
 *   - transaction costs charged on turnover
 * Zero dependencies. */
'use strict';

// ---------------------------------------------------------------------------
// Indicators — each: (closes array through today, window) -> number
// ---------------------------------------------------------------------------
const INDICATORS = {
  price:      { args: 0, warmup: () => 1,     fn: (c) => c[c.length - 1] },
  sma:        { args: 1, warmup: (n) => n,     fn: (c, n) => mean(c.slice(-n)) },
  ema:        { args: 1, warmup: (n) => n,     fn: (c, n) => ema(c.slice(-n), n) },
  rsi:        { args: 1, warmup: (n) => n + 1, fn: (c, n) => rsi(c, n) },
  momentum:   { args: 1, warmup: (n) => n + 1, fn: (c, n) => c[c.length - 1] / c[c.length - 1 - n] - 1 },
  highest:    { args: 1, warmup: (n) => n,     fn: (c, n) => Math.max(...c.slice(-n)) },
  lowest:     { args: 1, warmup: (n) => n,     fn: (c, n) => Math.min(...c.slice(-n)) },
  volatility: { args: 1, warmup: (n) => n + 1, fn: (c, n) => vol(c, n) },
};

function mean(a) { return a.reduce((s, x) => s + x, 0) / a.length; }
function ema(a, n) {
  const k = 2 / (n + 1);
  let v = a[0];
  for (let i = 1; i < a.length; i++) v = k * a[i] + (1 - k) * v;
  return v;
}
function rsi(c, n) {
  const w = c.slice(-n - 1);
  let gain = 0, loss = 0;
  for (let i = 1; i < w.length; i++) {
    const d = w[i] - w[i - 1];
    if (d > 0) gain += d; else loss -= d;
  }
  if (loss === 0) return 100;
  const rs = gain / loss;
  return 100 - 100 / (1 + rs);
}
function vol(c, n) {
  const w = c.slice(-n - 1);
  const rets = [];
  for (let i = 1; i < w.length; i++) rets.push(w[i] / w[i - 1] - 1);
  if (rets.length < 2) return 0;
  const m = mean(rets);
  return Math.sqrt(rets.reduce((s, r) => s + (r - m) ** 2, 0) / (rets.length - 1));
}

// ---------------------------------------------------------------------------
// Lexer
// ---------------------------------------------------------------------------
const KEYWORDS = new Set(['when', 'then', 'otherwise', 'and', 'or', 'not', 'long', 'short', 'flat']);
const POSITIONS = { long: 1, short: -1, flat: 0 };

function tokenize(src) {
  const toks = [];
  let i = 0, line = 1, col = 1;
  const two = ['>=', '<=', '==', '!='];
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\n') { line++; col = 1; i++; continue; }
    if (ch === ' ' || ch === '\t' || ch === '\r') { i++; col++; continue; }
    if (ch === '#') { while (i < src.length && src[i] !== '\n') i++; continue; }
    const sc = col;
    if (/[0-9.]/.test(ch)) {
      let j = i, dot = false;
      while (j < src.length && (/[0-9]/.test(src[j]) || (src[j] === '.' && !dot))) { if (src[j] === '.') dot = true; j++; }
      toks.push({ t: 'num', v: parseFloat(src.slice(i, j)), line, col: sc }); col += j - i; i = j; continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      let j = i;
      while (j < src.length && /[a-zA-Z0-9_]/.test(src[j])) j++;
      const w = src.slice(i, j);
      toks.push({ t: KEYWORDS.has(w) ? 'kw' : 'id', v: w, line, col: sc }); col += j - i; i = j; continue;
    }
    if (two.includes(src.slice(i, i + 2))) { toks.push({ t: 'op', v: src.slice(i, i + 2), line, col: sc }); i += 2; col += 2; continue; }
    if ('><+-*/'.includes(ch)) { toks.push({ t: 'op', v: ch, line, col: sc }); i++; col++; continue; }
    if ('(),'.includes(ch)) { toks.push({ t: ch, v: ch, line, col: sc }); i++; col++; continue; }
    throw err(`unexpected character '${ch}'`, line, sc);
  }
  toks.push({ t: 'eof', v: '', line, col });
  return toks;
}

function err(msg, line, col) { const e = new Error(msg); e.line = line; e.col = col; return e; }

// ---------------------------------------------------------------------------
// Parser (recursive descent, precedence: or < and < not < cmp < +- < */ )
// ---------------------------------------------------------------------------
function parse(src) {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  const expect = (t, v) => {
    const tok = peek();
    if (tok.t !== t || (v !== undefined && tok.v !== v)) {
      throw err(`expected '${v || t}' but got '${tok.v || 'end'}'`, tok.line, tok.col);
    }
    return next();
  };

  function rules() {
    const rs = [];
    while (peek().t === 'kw' && peek().v === 'when') {
      next();
      const cond = expr();
      expect('kw', 'then');
      rs.push({ cond, action: action() });
    }
    expect('kw', 'otherwise');
    const fallback = action();
    if (peek().t !== 'eof') { const tk = peek(); throw err(`unexpected '${tk.v}' after otherwise`, tk.line, tk.col); }
    if (rs.length === 0) throw err('need at least one "when ... then ..." rule', 1, 1);
    return { rules: rs, otherwise: fallback };
  }
  function action() {
    const tok = peek();
    if (tok.t === 'kw' && tok.v in POSITIONS) { next(); return { type: 'num', v: POSITIONS[tok.v] }; }
    return expr();
  }
  function expr() { let n = andE(); while (peek().t === 'kw' && peek().v === 'or') { next(); n = { type: 'logic', op: 'or', l: n, r: andE() }; } return n; }
  function andE() { let n = notE(); while (peek().t === 'kw' && peek().v === 'and') { next(); n = { type: 'logic', op: 'and', l: n, r: notE() }; } return n; }
  function notE() { if (peek().t === 'kw' && peek().v === 'not') { next(); return { type: 'not', x: notE() }; } return cmp(); }
  function cmp() {
    let n = sum();
    if (peek().t === 'op' && ['>', '<', '>=', '<=', '==', '!='].includes(peek().v)) {
      const op = next().v; return { type: 'cmp', op, l: n, r: sum() };
    }
    return n;
  }
  function sum() { let n = term(); while (peek().t === 'op' && ['+', '-'].includes(peek().v)) { const op = next().v; n = { type: 'bin', op, l: n, r: term() }; } return n; }
  function term() { let n = unary(); while (peek().t === 'op' && ['*', '/'].includes(peek().v)) { const op = next().v; n = { type: 'bin', op, l: n, r: unary() }; } return n; }
  function unary() { if (peek().t === 'op' && peek().v === '-') { next(); return { type: 'neg', x: unary() }; } return primary(); }
  function primary() {
    const tok = peek();
    if (tok.t === 'num') { next(); return { type: 'num', v: tok.v }; }
    if (tok.t === 'id') return call();
    if (tok.t === '(') { next(); const n = expr(); expect(')'); return n; }
    throw err(`expected a number, indicator or '(' but got '${tok.v || 'end'}'`, tok.line, tok.col);
  }
  function call() {
    const id = expect('id');
    const args = [];
    if (peek().t === '(') { next(); if (peek().t !== ')') { args.push(expr()); while (peek().t === ',') { next(); args.push(expr()); } } expect(')'); }
    return { type: 'call', name: id.v, args, line: id.line, col: id.col };
  }
  return rules();
}

// ---------------------------------------------------------------------------
// Validate (compile-time) + warmup
// ---------------------------------------------------------------------------
function validate(node) {
  if (node.type === 'num') return 0;
  if (node.type === 'call') {
    const ind = INDICATORS[node.name];
    if (!ind) {
      const near = Object.keys(INDICATORS).find((k) => k[0] === node.name[0]);
      throw err(`unknown indicator '${node.name}'${near ? ` — did you mean '${near}'?` : ''}`, node.line, node.col);
    }
    if (node.args.length !== ind.args) throw err(`${node.name} takes ${ind.args} argument(s), got ${node.args.length}`, node.line, node.col);
    let w = 0;
    if (ind.args === 1) {
      const a = node.args[0];
      if (a.type !== 'num' || a.v < 1 || a.v !== Math.floor(a.v)) throw err(`${node.name} window must be a positive whole number`, node.line, node.col);
      w = ind.warmup(a.v);
    }
    return w;
  }
  if (node.type === 'bin' || node.type === 'cmp' || node.type === 'logic') return Math.max(validate(node.l), validate(node.r));
  if (node.type === 'not' || node.type === 'neg') return validate(node.x);
  return 0;
}

function compile(src) {
  const prog = parse(src);
  let warmup = 1;
  for (const r of prog.rules) warmup = Math.max(warmup, validate(r.cond), validate(r.action));
  warmup = Math.max(warmup, validate(prog.otherwise));
  prog.warmup = warmup;
  return prog;
}

// ---------------------------------------------------------------------------
// Evaluate
// ---------------------------------------------------------------------------
function evalNode(node, closes) {
  switch (node.type) {
    case 'num': return node.v;
    case 'call': { const ind = INDICATORS[node.name]; return ind.args ? ind.fn(closes, node.args[0].v) : ind.fn(closes); }
    case 'bin': {
      const l = evalNode(node.l, closes), r = evalNode(node.r, closes);
      return node.op === '+' ? l + r : node.op === '-' ? l - r : node.op === '*' ? l * r : (r === 0 ? 0 : l / r);
    }
    case 'cmp': {
      const l = evalNode(node.l, closes), r = evalNode(node.r, closes);
      return { '>': l > r, '<': l < r, '>=': l >= r, '<=': l <= r, '==': l === r, '!=': l !== r }[node.op];
    }
    case 'logic': return node.op === 'and' ? (evalNode(node.l, closes) && evalNode(node.r, closes)) : (evalNode(node.l, closes) || evalNode(node.r, closes));
    case 'not': return !evalNode(node.x, closes);
    case 'neg': return -evalNode(node.x, closes);
  }
}

function targetWeight(prog, closes) {
  for (const r of prog.rules) if (evalNode(r.cond, closes)) return clamp(evalNode(r.action, closes));
  return clamp(evalNode(prog.otherwise, closes));
}
function clamp(w) { return Math.max(-1, Math.min(1, w)); }

// ---------------------------------------------------------------------------
// Backtest — no lookahead, turnover costs
// ---------------------------------------------------------------------------
function backtest(prog, prices, opts = {}) {
  const initial = opts.initial ?? 10000;
  const costBps = opts.costBps ?? 1;
  const closes = prices.map((p) => p[1]);
  const n = closes.length;
  if (n < prog.warmup + 2) throw err(`need ${prog.warmup + 2} bars for this strategy, only ${n} available`, 1, 1);

  const weights = new Array(n - 1).fill(0);
  for (let t = prog.warmup; t < n - 1; t++) weights[t] = targetWeight(prog, closes.slice(0, t + 1));

  const equity = [initial];
  const bench = [initial];
  let prevW = 0;
  for (let t = 0; t < n - 1; t++) {
    const barRet = closes[t + 1] / closes[t] - 1;
    const turnover = Math.abs(weights[t] - prevW);
    const stratRet = weights[t] * barRet - turnover * (costBps / 1e4);
    equity.push(equity[equity.length - 1] * (1 + stratRet));
    bench.push(initial * closes[t + 1] / closes[0]);
    prevW = weights[t];
  }
  return { equity, bench, weights, dates: prices.map((p) => p[0]), metrics: metrics(equity, bench, weights) };
}

function metrics(equity, bench, weights) {
  const ret = (s) => s[s.length - 1] / s[0] - 1;
  const rets = [];
  for (let i = 1; i < equity.length; i++) rets.push(equity[i] / equity[i - 1] - 1);
  const m = mean(rets);
  const sd = Math.sqrt(rets.reduce((s, r) => s + (r - m) ** 2, 0) / Math.max(rets.length - 1, 1));
  const sharpe = sd > 0 ? (m / sd) * Math.sqrt(252) : 0;
  let peak = equity[0], mdd = 0;
  for (const e of equity) { peak = Math.max(peak, e); mdd = Math.min(mdd, e / peak - 1); }
  let bpeak = bench[0], bmdd = 0;
  for (const e of bench) { bpeak = Math.max(bpeak, e); bmdd = Math.min(bmdd, e / bpeak - 1); }
  const exposure = weights.filter((w) => w !== 0).length / weights.length;
  let trades = 0, prev = 0;
  for (const w of weights) { if (w !== prev) trades++; prev = w; }
  return {
    totalReturn: ret(equity), benchReturn: ret(bench), sharpe,
    maxDrawdown: mdd, benchMaxDrawdown: bmdd, exposure, trades,
    finalEquity: equity[equity.length - 1], benchFinal: bench[bench.length - 1],
  };
}

window.StratLab = { compile, backtest, parse, tokenize };
