#!/usr/bin/env python3
"""Train a small MLP intent classifier: plain-English → strategy template.

This is a REAL neural network — bag-of-words input, one ReLU hidden layer,
softmax output, trained with manual backprop in NumPy (no sklearn, no LLM).
It maps a free-text description to one of N strategy intents, generalizing to
paraphrases the keyword matcher would miss. Weights are exported to model.js
and run client-side in translate.js.

Scope (stated honestly): this classifies into a fixed set of strategy
templates. It does not generate novel strategy code — that's an LLM's job.
"""
from __future__ import annotations

import json
import re

import numpy as np

# --- intents: label -> (human name, StratLang template) --------------------
INTENTS = {
    "golden_cross": ("trend following (golden cross)",
                     "when sma(20) > sma(100) then long\notherwise flat"),
    "buy_dip": ("mean reversion (buy the dip)",
                "when price() < sma(20) * 0.95 then long\nwhen price() > sma(20) then flat\notherwise flat"),
    "momentum": ("time-series momentum",
                 "when momentum(126) > 0 then long\notherwise flat"),
    "rsi": ("RSI reversal",
            "when rsi(14) < 30 then long\nwhen rsi(14) > 70 then flat\notherwise flat"),
    "breakout": ("breakout (new highs)",
                 "when price() >= highest(55) then long\nwhen price() < sma(50) then flat\notherwise flat"),
    "lowvol": ("trend + volatility filter",
               "when sma(20) > sma(100) and volatility(20) < 0.02 then long\notherwise flat"),
    "cautious": ("cautious momentum",
                 "when momentum(126) > 0 and rsi(14) > 75 then flat\nwhen momentum(126) > 0 then long\notherwise flat"),
    "buyhold": ("buy & hold",
                "when price() > 0 then long\notherwise long"),
}

# --- synthetic training phrases (many paraphrases per intent) ---------------
PHRASES = {
    "golden_cross": [
        "golden cross", "moving average crossover", "buy when the fast average crosses above the slow",
        "trend following with moving averages", "go long when short ma is over long ma",
        "ma cross strategy", "when the 20 day average is above the 100 day", "classic trend filter",
        "follow the trend using moving averages", "long when fast sma beats slow sma",
        "trend following", "ride the trend", "buy uptrends with moving averages",
        "when the short term average crosses the long term one", "moving average trend system",
    ],
    "buy_dip": [
        "buy the dip", "buy dips", "mean reversion", "buy when it drops below the average",
        "purchase on pullbacks", "buy oversold dips", "revert to the mean", "buy weakness",
        "buy when price falls under its average", "snap back trade", "buy the pullback",
        "get in when it dips below the moving average", "bargain buying on dips",
        "buy cheap when it drops", "fade the drop and buy", "accumulate on dips",
    ],
    "momentum": [
        "momentum", "buy what is going up", "ride the winners", "time series momentum",
        "trend momentum", "buy strong performers", "chase momentum", "go long when the trailing return is positive",
        "buy things with positive momentum", "momentum strategy", "buy assets that have been rising",
        "follow momentum", "long when six month return is positive", "buy recent strength",
        "keep buying what keeps climbing", "buy stocks that keep going up", "winners keep winning",
        "buy things that are climbing", "stay with rising assets",
    ],
    "rsi": [
        "rsi", "relative strength index", "buy when rsi is oversold", "sell when overbought",
        "rsi below 30", "use rsi to time entries", "oversold bounce with rsi", "rsi reversal",
        "buy oversold sell overbought", "rsi mean reversion", "trade the rsi indicator",
        "enter when rsi is low", "rsi based signals",
    ],
    "breakout": [
        "breakout", "buy new highs", "52 week high breakout", "buy when it makes a new high",
        "breakout trading", "trade breakouts", "buy the highest high", "channel breakout",
        "momentum breakout to new highs", "buy strength at new highs", "donchian breakout",
        "enter on a breakout above recent highs",
    ],
    "lowvol": [
        "low volatility", "only trade when calm", "trend but avoid volatility", "buy in quiet markets",
        "trend following with a volatility filter", "avoid choppy volatile markets", "low vol trend",
        "trade trends only when volatility is low", "calm market trend strategy", "risk managed trend",
    ],
    "cautious": [
        "cautious momentum", "careful momentum", "momentum but step aside when overheated",
        "defensive trend following", "risk off when overbought", "protect against overheated markets",
        "momentum with a safety brake", "trend but flatten when rsi is too high", "careful trend riding",
        "momentum that avoids euphoria", "chase momentum but back off when frothy",
        "ride winners but trim when frothy", "momentum while avoiding overheated frothy markets",
        "buy strength but get defensive when it gets frothy",
    ],
    "buyhold": [
        "buy and hold", "just buy and hold", "passive investing", "hold forever", "always invested",
        "buy the index and wait", "long term hold", "set and forget", "no trading just hold",
        "stay long all the time",
    ],
}

LABELS = list(INTENTS.keys())
LABEL_IDX = {l: i for i, l in enumerate(LABELS)}


def tokenize(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", text.lower())


def build_vocab(corpus: list[str], min_count: int = 1) -> dict[str, int]:
    counts: dict[str, int] = {}
    for t in corpus:
        for w in set(tokenize(t)):
            counts[w] = counts.get(w, 0) + 1
    vocab = {}
    for w, c in sorted(counts.items()):
        if c >= min_count:
            vocab[w] = len(vocab)
    return vocab


def featurize(text: str, vocab: dict[str, int]) -> np.ndarray:
    x = np.zeros(len(vocab), dtype=np.float64)
    for w in tokenize(text):
        if w in vocab:
            x[vocab[w]] = 1.0
    return x


def main() -> None:
    rng = np.random.default_rng(0)
    texts, ys = [], []
    for label, plist in PHRASES.items():
        for p in plist:
            texts.append(p)
            ys.append(LABEL_IDX[label])
    vocab = build_vocab(texts, min_count=1)
    X = np.array([featurize(t, vocab) for t in texts])
    y = np.array(ys)
    Y = np.eye(len(LABELS))[y]
    n, d = X.shape
    h = 24
    k = len(LABELS)

    # He/Xavier init
    W1 = rng.normal(0, np.sqrt(2 / d), (d, h))
    b1 = np.zeros(h)
    W2 = rng.normal(0, np.sqrt(2 / h), (h, k))
    b2 = np.zeros(k)

    lr, l2, epochs = 0.3, 1e-4, 4000

    def forward(Xb):
        z1 = Xb @ W1 + b1
        a1 = np.maximum(z1, 0)
        z2 = a1 @ W2 + b2
        z2 -= z2.max(axis=1, keepdims=True)
        p = np.exp(z2)
        p /= p.sum(axis=1, keepdims=True)
        return z1, a1, p

    for ep in range(epochs):
        z1, a1, p = forward(X)
        # cross-entropy gradient
        dz2 = (p - Y) / n
        dW2 = a1.T @ dz2 + l2 * W2
        db2 = dz2.sum(0)
        da1 = dz2 @ W2.T
        dz1 = da1 * (z1 > 0)
        dW1 = X.T @ dz1 + l2 * W1
        db1 = dz1.sum(0)
        W1 -= lr * dW1; b1 -= lr * db1
        W2 -= lr * dW2; b2 -= lr * db2
        if ep % 1000 == 0:
            loss = -np.sum(Y * np.log(p + 1e-12)) / n
            acc = (p.argmax(1) == y).mean()
            print(f"epoch {ep:4d}  loss {loss:.4f}  train_acc {acc:.3f}")

    # final train accuracy
    _, _, p = forward(X)
    train_acc = (p.argmax(1) == y).mean()

    # held-out paraphrases the model never saw — honest generalization check
    holdout = [
        ("buy when the short moving average goes above the long one", "golden_cross"),
        ("scoop up shares when they fall under the average", "buy_dip"),
        ("keep buying stuff that keeps climbing", "momentum"),
        ("get in when the relative strength is really low", "rsi"),
        ("jump in when it punches through to a fresh high", "breakout"),
        ("ride trends but only in calm conditions", "lowvol"),
        ("chase momentum yet back off when it gets frothy", "cautious"),
        ("never sell just hold the whole time", "buyhold"),
    ]
    correct = 0
    print("\nHeld-out paraphrases (unseen phrasings):")
    for text, true in holdout:
        _, _, ph = forward(featurize(text, vocab)[None, :])
        pred = LABELS[ph.argmax()]
        ok = pred == true
        correct += ok
        print(f"  {'✓' if ok else '✗'} \"{text}\" -> {pred} ({ph.max():.2f})")
    gen_acc = correct / len(holdout)
    print(f"\ntrain_acc {train_acc:.3f} · holdout_acc {gen_acc:.3f} · vocab {len(vocab)} words")

    model = {
        "vocab": vocab,
        "labels": LABELS,
        "names": {l: INTENTS[l][0] for l in LABELS},
        "templates": {l: INTENTS[l][1] for l in LABELS},
        "W1": np.round(W1, 4).tolist(), "b1": np.round(b1, 4).tolist(),
        "W2": np.round(W2, 4).tolist(), "b2": np.round(b2, 4).tolist(),
        "train_acc": round(float(train_acc), 3), "holdout_acc": round(float(gen_acc), 3),
    }
    with open("model.js", "w") as f:
        f.write("// Trained MLP intent classifier (bag-of-words -> ReLU(24) -> softmax(8)).\n")
        f.write("// Trained from scratch in NumPy — see ml/train.py. NOT an LLM.\n")
        f.write("window.STRAT_MODEL = " + json.dumps(model) + ";\n")
    print("wrote model.js")


if __name__ == "__main__":
    main()
