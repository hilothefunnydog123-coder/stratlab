#!/usr/bin/env python3
"""Fetch real daily market data and write data.js for the static site.

Primary source: yfinance (no API key). If a FINNHUB_TOKEN env var is set, its
candles endpoint is used as a fallback. Run by the `data` GitHub Action daily;
the committed data.js makes StratLab run on real market history with zero
backend and no exposed key.
"""
from __future__ import annotations

import datetime as dt
import json
import os

TICKERS = {
    "SPY": "S&P 500 ETF",
    "QQQ": "Nasdaq-100 ETF",
    "AAPL": "Apple",
    "MSFT": "Microsoft",
    "NVDA": "NVIDIA",
    "TSLA": "Tesla",
}
YEARS = 4


def from_yfinance(symbol: str, start: str):
    import yfinance as yf
    df = yf.download(symbol, start=start, progress=False, auto_adjust=True)
    if df is None or len(df) == 0:
        raise RuntimeError("no data")
    closes = df["Close"]
    if hasattr(closes, "columns"):
        closes = closes[symbol]
    out = []
    for ts, c in closes.items():
        if c == c:  # not NaN
            out.append([ts.date().isoformat(), round(float(c), 2)])
    return out


def from_finnhub(symbol: str, start: str, token: str):
    import urllib.request
    frm = int(dt.datetime.fromisoformat(start).timestamp())
    to = int(dt.datetime.now().timestamp())
    url = (f"https://finnhub.io/api/v1/stock/candle?symbol={symbol}"
           f"&resolution=D&from={frm}&to={to}&token={token}")
    with urllib.request.urlopen(url, timeout=30) as r:
        j = json.loads(r.read().decode())
    if j.get("s") != "ok":
        raise RuntimeError(f"finnhub status {j.get('s')}")
    return [[dt.date.fromtimestamp(t).isoformat(), round(float(c), 2)]
            for t, c in zip(j["t"], j["c"])]


def main() -> None:
    start = (dt.date.today() - dt.timedelta(days=365 * YEARS)).isoformat()
    token = os.environ.get("FINNHUB_TOKEN", "")
    data, source = {}, "yfinance (real market data)"
    for sym, name in TICKERS.items():
        try:
            prices = from_yfinance(sym, start)
        except Exception as exc:
            print(f"{sym}: yfinance failed ({exc})")
            if not token:
                continue
            try:
                prices = from_finnhub(sym, start, token)
                source = "Finnhub (real market data)"
            except Exception as exc2:
                print(f"{sym}: finnhub failed ({exc2})")
                continue
        if len(prices) > 100:
            data[sym] = {"label": f"{sym} — {name}", "prices": prices}
            print(f"{sym}: {len(prices)} bars")

    if not data:
        raise SystemExit("no data fetched from any source — leaving data.js unchanged")

    meta = {"source": source, "asof": dt.date.today().isoformat()}
    with open("data.js", "w") as f:
        f.write("window.MARKET_META = " + json.dumps(meta) + ";\n")
        f.write("window.MARKET_DATA = " + json.dumps(data) + ";\n")
    print(f"wrote data.js — {len(data)} tickers from {source}")


if __name__ == "__main__":
    main()
