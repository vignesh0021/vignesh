# ICT Master Pro — All-in-One ICT / SMC Confluence Indicator

A single Pine Script v6 indicator that fuses every major ICT / SMC concept from the
five reference scripts (Macro Zone Boxes, Advanced ICT Theory, Master Suite, SMC
Toolkit, Weekly Profiles) into one clean tool with **confluence-scored BUY / SELL
signals and complete trade plans (Entry · SL · TP1 · TP2 · TP3)**.

The goal is simple: **fewer, higher-probability trades**, no chart clutter, no
guesswork on stop-loss or targets.

---

## What's Inside

| ICT Concept             | Status | Notes                                                  |
|-------------------------|:------:|--------------------------------------------------------|
| Market Structure (BOS / CHoCH) | ✓ | Pivot-based, with explicit CHoCH = trend reversal     |
| Order Blocks (graded A / B / C) | ✓ | A = swept liquidity + displacement                    |
| Fair Value Gaps          | ✓ | 3-candle imbalance, auto-mitigation                    |
| Buy-Side / Sell-Side Liquidity | ✓ | Lines drawn at swing highs/lows                  |
| Liquidity Sweeps         | ✓ | Wick + close-back-through detection (5-bar memory)     |
| Premium / Discount       | ✓ | Daily / Weekly / AM-Session range, with equilibrium   |
| OTE (0.62 / 0.705 / 0.79) | ✓ | Auto-calculated optimal trade entry zone              |
| HTF Bias filter          | ✓ | EMA20/EMA50 alignment on selectable HTF                |
| Weekly Profile bias      | ✓ | Above / below previous-week midpoint                   |
| ICT Macro Sessions (NSE) | ✓ | AM, Mid, Lunch, PM, Expiry — all in IST                |
| Volume confirmation      | ✓ | Signals require volume >= MA                           |
| Confluence scoring       | ✓ | 0-7 scale, configurable threshold                      |
| Trade plan (E/SL/TP1-3)  | ✓ | Structure / ATR / Fixed% SL · 1R/2R/3R targets         |
| Dashboard                | ✓ | At-a-glance bias · zone · session · scores · plan      |
| Alerts                   | ✓ | Buy, Sell, BOS, CHoCH, SSL/BSL sweeps                  |

---

## Quick Start (3 steps)

1. **Open TradingView Pine Editor** → New blank indicator → paste contents of
   `ICT_Master_Pro.pine` → **Save** → **Add to chart**.
2. Set chart **timezone to Asia/Kolkata** (right-click chart → Settings →
   Symbol → Timezone). Defaults are NSE 09:15-15:30 IST.
3. Apply on **5m chart for execution** (HTF bias auto-pulls 1H). Done.

---

## How to Read a Signal

When you see a **▲ BUY (n/7)** label below a bar, the indicator has confirmed:

- ✓ HTF bias bullish (1H trend up)
- ✓ Recent SSL sweep (sell-side liquidity grabbed → smart money loaded longs)
- ✓ Bullish CHoCH or BOS (structure flipped up)
- ✓ Price tagged a bullish Order Block or FVG
- ✓ In Discount zone or OTE (buying cheap)
- ✓ Volume above average
- ✓ Inside a tradable session (not lunch)

The chart simultaneously plots:

```
ENTRY  ────────────────  (green solid)
TP1    - - - - - - - - -  (bright green, 1R)
TP2    - - - - - - - - -  (medium green, 2R)
TP3    - - - - - - - - -  (faded green,  3R)
SL     - - - - - - - - -  (red, beyond swept low + buffer)
```

Take the trade at entry, place SL exactly where shown, scale out at TP1/TP2/TP3.
**Default risk = TP1 (1R). Anything beyond is house money.**

The same logic mirrored for **▼ SELL** signals.

---

## Recommended Settings by Instrument

### NIFTY / BANKNIFTY / FINNIFTY (intraday)
| Input | Value |
|-------|-------|
| Timeframe (chart) | **5m** |
| HTF Timeframe    | `60` (1H) |
| Pivot Length     | 5 |
| Min Confluence Score | 4 |
| Require OTE      | ON |
| Require Volume   | ON (BANKNIFTY: turn OFF if using index feed without volume) |
| Block Lunch      | ON |
| OB Min Grade     | A+B |
| SL Mode          | Structure |
| Range Source (P/D) | Session |

### Stocks (intraday swing)
| Input | Value |
|-------|-------|
| Timeframe (chart) | **15m** |
| HTF Timeframe    | `240` (4H) or `D` |
| Pivot Length     | 7 |
| Min Confluence Score | 4 |
| SL Mode          | ATR (1.5x) |
| Range Source (P/D) | Daily |

### Crypto / FX (24-hour)
| Input | Value |
|-------|-------|
| Timeframe (chart) | 5m / 15m |
| HTF Timeframe    | `60` / `240` |
| Block Lunch      | OFF |
| Avoid Sessions   | Customise IST sessions to your market hours |

---

## The Confluence Score Explained (0-7)

The **Buy Score** in the dashboard is the sum of these checks:

| Pt | Check                                                          |
|----|----------------------------------------------------------------|
| +1 | HTF bias bullish (price > HTF EMA50 + EMA20 > EMA50)           |
| +1 | SSL sweep within last 5 bars                                   |
| +1 | Bullish BOS or CHoCH on the trigger bar                        |
| +1 | Price currently inside an unmitigated bullish OB               |
| +1 | Price currently inside an unmitigated bullish FVG              |
| +1 | Inside Discount zone (or OTE if "Require OTE" is ON)           |
| +1 | Volume on this bar >= 20-bar volume MA                         |

Set **Min Score = 4** for balanced frequency, **5** for selective, **6+** for
sniper mode. Below 4 not recommended.

A signal also requires a **structural trigger** (sweep+structure or OB/FVG+structure)
even if score is above threshold — this prevents lukewarm "score-only" entries.

---

## Dashboard Cheat-Sheet

| Cell | What it tells you |
|------|-------------------|
| HTF Bias | Whether 1H/4H trend is up, down, or neutral |
| Weekly Bias | Position vs previous-week midpoint (WPG concept) |
| Dealing Range Zone | Are we in Discount (buy zone), Premium (sell zone), or Equilibrium |
| OTE | Whether price is in the optimal entry band |
| Session | Current ICT macro window (AM, Mid, Lunch, PM, Expiry) |
| Recent Sweep | Last liquidity sweep direction (≤5 bars old) |
| Volume | Above or below 20-MA |
| Buy Score / Sell Score | Live confluence score for each side |
| Last Signal | Direction + entry price of the most recent fired signal |
| Active Plan | Entry & SL of the currently active trade |
| Targets | TP1 / TP2 / TP3 levels |
| **STATUS** | "BUY READY" / "SELL READY" / "Scanning…" |

Watch the **STATUS** cell — when it lights up green or red, a trade is imminent.

---

## Position Sizing (institutional-grade)

The indicator's **Position Sizing** module computes the exact qty / lots /
actual risk / unused-risk for every signal — based on your account capital,
risk %, the SL distance, and the instrument type. Settings live under
**═══ Position Sizing ═══**.

| Input | What it does |
|---|---|
| Instrument Type | Auto = detect from syminfo + ticker. Equity = whole shares. Index/Stock Options or Futures = lot-rounded contracts. |
| Lot Size Override | Force a custom lot size. 0 = auto. Auto-detected NSE defaults: NIFTY 75, BANKNIFTY 35, FINNIFTY 65, MIDCPNIFTY 120, SENSEX 20, BANKEX 30. |
| Minimum Equity Order Qty | Smallest tradable share count (Equity only). |
| Show Position Sizing on Dashboard | Adds a "Position" row to the dashboard. |
| Use Position Sizing for strategy.entry() | (Strategy file only) — backtest with the lot-rounded qty instead of TradingView's default 1% of equity. |

### Worked examples

| Capital | Risk % | SL distance | Instrument | Output |
|---|---|---|---|---|
| ₹1,00,000 | 2% | ₹5 | Equity (TCS, INFY, etc.) | **Qty: 400 sh · Risk ₹2,000 · unused ₹0** |
| ₹1,00,000 | 2% | ₹13 | NIFTY Options (lot 75) | **2 lots × 75 = 150 qty · Risk ₹1,950 · unused ₹50** |
| ₹1,00,000 | 1% | ₹100 | NIFTY Options (lot 75) | **0 lots · SL too wide for risk budget** (warning shown) |
| ₹3,50,000 | 1% | ₹100 | BANKNIFTY Futures (lot 35) | **1 lot × 35 = 35 qty · Risk ₹3,500 · unused ₹0** |

The dashboard **Position** row shows the live trade size when a plan is
active, and a *projected* size for the next signal otherwise — so you can
verify your risk inputs before any trade fires. The alert message includes
the same fields (`qty`, `lots`, `lotSize`, `instrument`, `actualRisk`,
`unusedRisk`) so a webhook bridge can pass them straight to the broker.

In **Strategy mode**, when `Use Position Sizing for strategy.entry()` is ON,
the backtest sends each entry with `qty = tpQty` instead of TradingView's
default `% of equity`, so backtest P/L reflects what real lot-rounded
trades would have made.

---

## Setting Alerts

After loading the indicator, click the **Alarm clock icon** → Create Alert:

- **ICT Buy Signal** / **ICT Sell Signal** — main trade alerts
- **Bullish CHoCH** / **Bearish CHoCH** — early structure-shift warnings
- **SSL** / **BSL Liquidity Sweep** — pre-signal liquidity grab heads-up

For algo automation, the alert message includes ticker + close. Wire to your
broker's webhook (Zerodha Kite Connect, Dhan, Fyers etc.) via a simple
Python/Node bridge.

---

## Important Notes

1. This indicator does **NOT** repaint signal labels — once a BUY/SELL prints
   on a closed bar, it stays. HTF bias uses `lookahead_off`.
2. Weekly OHLC plot lines DO use `lookahead_on` for visual continuity (showing
   the current week's high/low across the week). They are reference levels,
   not signal triggers.
3. Volume on TradingView's NIFTY/BANKNIFTY index feed is often zero. Either
   apply on the underlying futures (e.g. `NIFTY1!`) or **turn OFF "Require
   Volume Confirmation"** to avoid filtering out all signals.
4. The script is self-contained — no companion indicators required. You CAN
   still run separate macro-zone-boxes etc. but it's redundant.
5. **This is not financial advice.** ICT setups are probabilistic; always
   forward-test on paper for 2-3 weeks before risking capital. Stick to
   pre-defined SL — the indicator's edge depends on it.

---

## File Layout

```
ict-master-pro/
├── ICT_Master_Pro.pine             ← INDICATOR — live charting & alerts
├── ICT_Master_Pro_Strategy.pine    ← STRATEGY  — backtestable twin
└── README.md                       ← this file
```

### When to use which file

| File | Purpose |
|---|---|
| `ICT_Master_Pro.pine` | Live charting, dashboard, alerts, webhook automation. **Use this on real charts.** |
| `ICT_Master_Pro_Strategy.pine` | Same engine but declared as `strategy()`. Use this in TradingView's **Strategy Tester** to backtest the signals — profit factor, Sharpe, max drawdown, equity curve, monthly returns. |

Pine Script does not allow runtime switching between `indicator()` and
`strategy()` (script type is fixed at compile time), so both files are
shipped side-by-side. **Settings, dashboard, and signals are identical**;
the strategy file simply forwards each fired signal to TradingView's
strategy engine with `strategy.entry()` and a bracket exit
(`stop = SL, limit = TP3`). When Smart Trade Management is on, the
bracket SL is re-issued whenever TP1 or TP2 is reached, mirroring the
indicator's break-even / lock-in behaviour.

### Strategy defaults

| Setting | Value |
|---|---|
| Initial capital | 100,000 |
| Order size | 1% of equity per trade |
| Commission | 0.03% (Zerodha intraday equivalent) |
| Slippage | 1 tick |
| Pyramiding | 0 (one trade at a time) |
| Process orders on close | Yes (cleaner backtest, no lookahead) |

Adjust the strategy properties in TradingView **Settings → Properties** to match your account / instrument. The defaults are conservative.

---

## Source Concepts Credit

Built on ICT (Inner Circle Trader) public concepts and synthesised from these
open-source community references:

- ICT Macro Zone Boxes w/ Individual H/L Tracking v3.1 (MrWoof888)
- Advanced ICT Theory A-ICT (DskyzInvestments)
- ICT Master Suite (Trading IQ)
- ICT SMC Toolkit Companions (MrWoof888)
- ICT Weekly Profiles Go - WPG (CandelaCharts)

This implementation is original Pine v6 code combining the modular ideas of
the above scripts into a single, signal-producing tool.
