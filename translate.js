/* Plain-English -> StratLang translator.
 *
 * DEMO IMPLEMENTATION: a deterministic, rules-based intent matcher — no API
 * key, no network, works offline, and is perfectly reproducible for a live
 * demo. In production this is where an LLM slots in (the rest of the app is
 * unchanged: it just needs valid StratLang text back). That swap is one
 * function. */
'use strict';

const PATTERNS = [
  {
    match: /(golden cross|moving average cross|ma cross|trend follow|when.*above.*average)/i,
    name: 'trend following (golden cross)',
    code: 'when sma(20) > sma(100) then long\notherwise flat',
  },
  {
    match: /(buy the dip|buy dips|mean reversion|revert|oversold bounce|dip)/i,
    name: 'mean reversion (buy the dip)',
    code: 'when price() < sma(20) * 0.95 then long\nwhen price() > sma(20) then flat\notherwise flat',
  },
  {
    match: /(momentum|winners|whats going up|what is going up|riding)/i,
    name: 'time-series momentum',
    code: 'when momentum(126) > 0 then long\notherwise flat',
  },
  {
    match: /(rsi|overbought|relative strength)/i,
    name: 'RSI reversal',
    code: 'when rsi(14) < 30 then long\nwhen rsi(14) > 70 then flat\notherwise flat',
  },
  {
    match: /(breakout|new high|52 week|highest)/i,
    name: 'breakout (new highs)',
    code: 'when price() >= highest(55) then long\nwhen price() < sma(50) then flat\notherwise flat',
  },
  {
    match: /(low vol|calm|avoid volatility|quiet)/i,
    name: 'trend + volatility filter',
    code: 'when sma(20) > sma(100) and volatility(20) < 0.02 then long\notherwise flat',
  },
  {
    match: /(cautious|careful|risk off|protect|defensive)/i,
    name: 'cautious momentum',
    code: 'when momentum(126) > 0 and rsi(14) > 75 then flat\nwhen momentum(126) > 0 then long\notherwise flat',
  },
  {
    match: /(buy.*hold|hold forever|just buy|passive)/i,
    name: 'buy & hold',
    code: 'when price() > 0 then long\notherwise long',
  },
];

function translate(text) {
  const t = (text || '').trim();
  for (const p of PATTERNS) {
    if (p.match.test(t)) return { code: p.code, name: p.name, matched: true };
  }
  // sensible default so the demo never dead-ends
  return {
    code: 'when sma(20) > sma(100) then long\notherwise flat',
    name: 'trend following (default)',
    matched: false,
  };
}

window.translate = translate;
