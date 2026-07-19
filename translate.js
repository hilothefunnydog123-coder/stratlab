/* eslint-disable */
(function () {
/* Plain-English -> StratLang, powered by a trained neural net.
 *
 * Runs the MLP from ml/train.py (window.STRAT_MODEL) as a forward pass in the
 * browser: bag-of-words -> ReLU(24) -> softmax over strategy intents. No API,
 * no network, no LLM — a real classifier trained from scratch that generalizes
 * to phrasings it never saw. It maps a description to one of N strategy
 * templates (it does not generate novel code — that's an LLM's job). */
'use strict';

const CONFIDENCE_FLOOR = 0.35;

function tokenize(text) {
  return (text.toLowerCase().match(/[a-z0-9]+/g)) || [];
}

function featurize(text, vocab) {
  const x = new Float64Array(Object.keys(vocab).length);
  for (const w of tokenize(text)) {
    if (w in vocab) x[vocab[w]] = 1;
  }
  return x;
}

function forward(x, m) {
  const h = m.b1.length, k = m.b2.length, d = x.length;
  // hidden: a1 = relu(x·W1 + b1)
  const a1 = new Float64Array(h);
  for (let j = 0; j < h; j++) {
    let s = m.b1[j];
    for (let i = 0; i < d; i++) if (x[i]) s += x[i] * m.W1[i][j];
    a1[j] = s > 0 ? s : 0;
  }
  // logits = a1·W2 + b2
  const z = new Float64Array(k);
  let max = -Infinity;
  for (let c = 0; c < k; c++) {
    let s = m.b2[c];
    for (let j = 0; j < h; j++) s += a1[j] * m.W2[j][c];
    z[c] = s;
    if (s > max) max = s;
  }
  // softmax
  let sum = 0;
  for (let c = 0; c < k; c++) { z[c] = Math.exp(z[c] - max); sum += z[c]; }
  let best = 0;
  for (let c = 0; c < k; c++) { z[c] /= sum; if (z[c] > z[best]) best = c; }
  return { label: m.labels[best], confidence: z[best] };
}

function translate(text) {
  const m = window.STRAT_MODEL;
  const t = (text || '').trim();
  if (!m || t.length === 0) {
    return { code: 'when sma(20) > sma(100) then long\notherwise flat', name: 'trend following (default)', confidence: 0, matched: false };
  }
  const { label, confidence } = forward(featurize(t, m.vocab), m);
  return {
    code: m.templates[label],
    name: m.names[label],
    confidence,
    matched: confidence >= CONFIDENCE_FLOOR,
  };
}

window.translate = translate;

})();
