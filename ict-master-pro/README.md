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

## Trading Modes — one engine, five personalities

Set **Trading Mode** in the inputs to make the same ICT engine adapt its
sensitivity to your style. The mode controls pivot length, score threshold,
ATR SL multiple, structure/sweep memory windows, OTE/HTF/Lunch filters and
risk %. The currently active mode is always shown on the dashboard.

| Mode | Pivot | Min Score | ATR SL | Risk % | OTE | HTF | Lunch Block | Best for |
|---|---:|---:|---:|---:|:---:|:---:|:---:|---|
| **Scalper** | 2 | 4/7 | 0.8x | 0.75% | off | off | block | 1m / 3m / 5m |
| **Intraday** | 5 | 6/7 | 1.5x | 1.5% | on | on | block | 5m / 15m |
| **Swing** | 10 | 7/7 | 3.0x | 2.5% | on | on | allow | 1H / 4H / D |
| **Auto Adaptive** | — | — | — | — | — | — | — | picks Scalper / Intraday / Swing from the chart timeframe (≤5m → Scalper, ≤30m → Intraday, > 30m → Swing) |
| **Custom** | input | input | input | input | input | input | input | every per-feature input is used verbatim — no mode override |

Toggles in the **═══ Trading Mode ═══** group:

- **Auto-tune Risk % by Mode** — when ON, Risk % follows the table above; when OFF, the Risk-group input wins.
- **Mode also controls OTE/HTF/Lunch filters** — when OFF, the mode only adjusts pivot/score/ATR/risk and your OTE/HTF/Lunch toggles stay as-set.

The Mode dashboard row shows: `<MODE> (auto)  pv 5  sc 6/7  ATR x1.5  risk 1.50%`
— so you can see at a glance how the engine is currently configured.

Mode-specific alerts (`Scalper Buy Setup` / `Intraday Sell Setup` / `Swing Buy Setup` etc.)
fire only when both the signal AND the active mode match — useful when
multiple charts share one webhook bridge.

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

## Chart & Candle Patterns + High-Volume Bars

Beyond the ICT engine, the indicator also surfaces **classical price-action
context** directly on the chart (no dashboard rows). Settings live under
**═══ Chart & Candle Patterns ═══**.

### Candle patterns (23 supported)

When **Show Candle Pattern Markers** is on, every bar that prints one of the
following classical patterns gets a tiny 2-letter tag above (bearish) or
below (bullish) the bar:

| Reversal (bullish) | Reversal (bearish) | Neutral / continuation |
|---|---|---|
| Bull Engulfing (BE), Hammer (H), Inv Hammer (iH), Dragonfly Doji (Df), Bull Marubozu (M), Bull Pin Bar (P), Bull Harami (BH), Tweezer Bottom (Tw), Morning Star (MS), 3 White Soldiers (3S) | Bear Engulfing (BE), Shooting Star (SS), Hanging Man (HM), Gravestone Doji (Gv), Bear Marubozu (M), Bear Pin Bar (P), Bear Harami (BH), Tweezer Top (Tw), Evening Star (ES), 3 Black Crows (3C) | Doji (Dj), Inside Bar (IB), Outside Bar (OB) |

Toggle **Reversal Patterns Only** to hide patterns that fire mid-move
without trend context — bullish patterns then require a local downtrend
(EMA20 < EMA50, close < EMA20) and vice versa for bearish.

### Chart patterns

Turn on **Show Chart Patterns** to draw the following classical chart
patterns directly from the swing pivots:

| Pattern | Trigger | Drawing |
|---|---|---|
| **Double Top / Double Bottom** | Two consecutive swings ≤ 0.2% apart | Dotted line + `DT` / `DB` |
| **Triple Top / Triple Bottom** | Three consecutive swings ≤ 0.3% apart | Dotted line + `TRIPLE TOP` / `TRIPLE BOT` |
| **Head & Shoulders** | Mid swing-high > both sides, sides ≤ 0.6% apart | Two trendlines + `H&S` |
| **Inverse Head & Shoulders** | Mid swing-low < both sides, sides ≤ 0.6% apart | Two trendlines + `Inv H&S` |
| **Ascending Triangle** | Flat tops + rising bottoms | Two trendlines (extend right) + `Asc Tri` |
| **Descending Triangle** | Falling tops + flat bottoms | Two trendlines (extend right) + `Desc Tri` |
| **Symmetric Triangle** | Falling tops + rising bottoms | Two trendlines (extend right) + `Sym Tri` |
| **Rising Wedge** (bearish) | Both lines up, bottoms rising faster | Two trendlines + `Rising Wedge` |
| **Falling Wedge** (bullish) | Both lines down, tops falling faster | Two trendlines + `Falling Wedge` |

Patterns fire once when the defining swings line up; line / label
objects are recycled via a bounded pool (max 50 lines, 25 labels) so the
chart never hits TV's object cap regardless of how long the indicator
runs. Combined with the ICT swing labels (HH/HL/LL/LH/EH/EL) the chart
gives a complete view of structure: which swings are forming familiar
classical patterns versus building fresh ICT levels.

### Anti-clutter controls

The pattern engine has four filters layered on top of detection so the
chart stays clean even on choppy 5m sessions:

| Filter | What it does |
|---|---|
| **Strong Patterns Only** (on by default) | Drops Doji, Inside Bar, Outside Bar, Inv Hammer, Hanging Man, Harami — the patterns most prone to noise. Keeps 12 high-edge ones (Engulfing, Hammer, Shooting Star, Marubozu, Pin Bar, Tweezer, Dragonfly/Gravestone, 3 Soldiers/Crows, Morning/Evening Star). |
| **ICT Context Only** (on by default) | Bullish patterns only print when the bar is inside a fresh OB / unmitigated FVG / right after a SSL sweep. Bearish patterns require the equivalent bearish context. **This single filter typically removes 80%+ of pattern noise** — patterns now only appear at structurally meaningful moments. |
| **Reversal Patterns Only** (on by default) | Bullish patterns require local downtrend context (EMA20 < EMA50, close < EMA20). Bearish require the inverse. Filters mid-trend continuation fakes. |
| **Pattern Cooldown** (default 4 bars) | After a same-side pattern fires, suppresses further same-side markers for N bars. Stops 3-4 markers stacking on consecutive bars in the same setup zone. |

Chart-pattern markers (Triangles, Wedges, H&S, etc.) have their own
**Chart-Pattern Cooldown** (default 15 bars) — the same pattern type
can't redraw within that window so consecutive pivots don't keep
retriggering identical shapes.

### High-volume bar coloring

**Color High-Volume Bars** tints any bar whose volume exceeds the
multiplier x the 20-bar SMA:

- **High** (`volume ≥ 2.0x avg`) — bar tinted bull-green or bear-red.
- **Extreme** (`volume ≥ 3.5x avg`) — bar painted bright neon green or red.

Both multipliers are configurable. Use this to spot institutional
accumulation/distribution at structure points (sweep highs/lows, OB
mitigations) instantly without staring at the volume pane.

---

## Fyers Auto-Trading (TradingView → Webhook → Fyers)

Turn on **Fyers JSON Webhook** (under ═══ Fyers Auto-Trading ═══) and
every signal alert will emit a Fyers-API-ready JSON payload with
intelligent routing:

| Chart symbol | Routed as | BUY signal → | SELL signal → |
|---|---|---|---|
| `NIFTY` / `BANKNIFTY` / `FINNIFTY` / `SENSEX` | **OPTIONS** | BUY <ATM+offset> **CE** | BUY <ATM+offset> **PE** |
| Any stock (`RELIANCE`, `TCS`, etc.) | **EQUITY** | BUY `NSE:RELIANCE-EQ` | SELL `NSE:RELIANCE-EQ` |
| Stock or index futures | **FUTURES** | BUY future | SELL future |

For index symbols you always **BUY** the option — you express the
bearish view by buying a **PE** (put), not by selling a call. This
matches retail/intraday risk management practice.

### Setup

1. **Run the bridge** — Fyers does not accept TradingView webhooks directly. Use the included `fyers_bridge.py` (FastAPI + fyers-apiv3) as a starting point, or any equivalent service. Set environment variables:
   - `FYERS_CLIENT_ID`
   - `FYERS_ACCESS_TOKEN` (regenerated daily via the Fyers login flow)
2. **Expose it over HTTPS** — use ngrok / Cloudflare Tunnel / your VPS to get a public URL like `https://<your-tunnel>/webhook`.
3. **Wire the alert** — when creating the alert in TradingView, set the **Webhook URL** to the bridge endpoint. The alert message is the auto-built JSON.
4. **Test on Fyers paper / small qty first.** The strike resolution in the sample bridge is simplified — production code should query Fyers' `/option-chain` to get the exact weekly expiry symbol format.

### Inputs

| Input | Effect |
|---|---|
| Product | INTRADAY (MIS), MARGIN, CNC, BO (bracket — auto SL+TP), CO (cover) |
| Option Strike Offset | 0 = ATM, -1 = one strike ITM, +1 = OTM, etc. |
| Option Expiry | WEEKLY or MONTHLY — bridge resolves the symbol at trade time |
| Stock Exchange | NSE or BSE — applied to the `NSE:SYMBOL-EQ` format |
| Order Type | MARKET (enter now) or LIMIT (bridge sets price = signal entry) |

The JSON payload also carries the calculated SL, TP1, TP2, TP3, lots,
qty, and confluence score — so a sophisticated bridge can place a
bracket order with the full plan in one API call.

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
├── fyers_bridge.py                 ← Sample FastAPI bridge: TV → Fyers
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
