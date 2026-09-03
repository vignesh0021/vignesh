# IPR Scalper — Impulse → Pullback → Resumption (MT5, M5)

Production implementation of the approved Phase 1 design: a symbol-agnostic micro-lot
scalper that enters on a confirmed pullback resumption inside a structurally-validated
impulse, and refuses to trade whenever costs are too large a fraction of the barrier span.

> **Status.** The strategy logic is machine-verified (165 assertions, all passing).
> **The project has not been compiled by MetaEditor** — that is Windows-only and
> unavailable here. Compile it yourself before running anything. See `TEST_REPORT.md`.
>
> **No profitability claim is made.** No backtest has been run. Phase 1 put the required
> edge at 6–10 percentage points over a driftless random walk and stated that this has not
> been demonstrated. That is still true.

---

## What it does

On each closed M5 bar, in order:

1. **Gates** — session (derived from the instrument's own hourly spread/ATR profile),
   volatility band `0.60 ≤ A/A_ref ≤ 2.50`, spread `S/A ≤ 0.15` and `S ≤ 2.5 × S_med(hour)`,
   shock filter (no bar in the last 3 above `3 × ATR`, then a 6-bar stand-down), and the
   EMA20/50 regime with a slope of at least `0.10 × ATR` over 5 bars.
2. **Impulse** — a leg at least `L_min_mult × ATR`, efficiency ratio ≥ 0.50, breaking the
   most recent confirmed 2-bar fractal swing that preceded the leg's origin.
3. **Pullback** — retracement 0.20–0.618 of the leg, no longer than `N_imp` bars, slower
   per bar than the impulse, ending in a turn bar confirmed by the next close.
4. **Trigger** — a stop order at `turn bar extreme ± max(0.10×ATR, 2×spread, stops level, 1 tick)`.
5. **Target and stop** — `d_tp = clamp(max(d_req, TP_mult×ATR), d_req, d_struct)` where
   `d_req = (TargetNet + C_money) / M`; stop just beyond the pullback extreme.
6. **The cost-budget gate** — reject unless `C_money/M ≤ CostBudget × (d_tp + d_sl)`.
   This is the operational form of the Phase 1 result that required edge equals
   `C/(d_tp + d_sl)`. Most candidate setups die here, by design.

One setup produces at most one trade, enforced by an immutable SetupID and a persisted
consumed-id ring. Four independent locks gate any same-direction re-entry.

**Contains no** martingale, grid, averaging, recovery sizing, or any code path by which
volume depends on prior results. Volume is read once from the inputs and never recomputed.

---

## Layout

```
MQL5/Experts/IPR/IPR_Scalper.mq5     EA shell: clock, quotes, orders, positions
MQL5/Include/IPR/
    Types.mqh          data types + every FIXED strategy constant
    Config.mqh         the tunable surface (4 optimisable parameters)
    MathUtil.mqh       median, price/volume normalisation, SetupID hashing
    CostModel.mqh      M = volume x tick_value / tick_size; C_money; d_req
    Indicators.mqh     ATR(14) Wilder, EMA20/50, Kaufman efficiency ratio
    Structure.mqh      2-bar fractal swings, break of structure, opposing levels
    HourProfile.mqh    rolling per-hour ATR/spread medians (no look-ahead)
    Gates.mqh          G1..G4
    Impulse.mqh        impulse leg detection
    Pullback.mqh       retracement + turn bar
    SetupMachine.mqh   SetupID, lifecycle, cluster locks
    TargetEngine.mqh   d_tp / d_sl / structural cap / cost-budget gate
    ExitEngine.mqh     the 7-level exit priority hierarchy
    RiskManager.mqh    limits, streaks, cooldowns, execution health
    SignalEngine.mqh   pipeline orchestration
    Logger.mqh         structured diagnostics          (MT5-only)
    SymbolSpecMT5.mqh  symbol spec + feasibility report (MT5-only)
    BarFeedMT5.mqh     bar feed and indicator state     (MT5-only)
    Broker.mqh         execution with retcode handling  (MT5-only)
    StateStore.mqh     persistence and restart recovery (MT5-only)
tests/                 g++ harness, MQL5 shim, static checker
```

The first 15 headers are **pure**: no MT5 calls, no `input`, deterministic. That is what
makes them testable off-terminal, and it is the reason the strategy rules could be verified
at all without MetaEditor.

---

## Install and compile

1. In MetaTrader 5: **File → Open Data Folder**.
2. Copy `MQL5/Include/IPR/` → `<data folder>/MQL5/Include/IPR/`.
3. Copy `MQL5/Experts/IPR/IPR_Scalper.mq5` → `<data folder>/MQL5/Experts/IPR/`.
4. Open `IPR_Scalper.mq5` in MetaEditor and press **F7**.
5. Expected: 0 errors, 0 warnings. If anything appears, send me the exact messages.

Requires build 3000+ (uses `input group`).

---

## Strategy Tester setup

| Setting | Value | Why |
|---|---|---|
| Symbol | XAUUSD (your broker's exact name) | |
| Period | **M5** | the strategy's only timeframe |
| Modelling | **Every tick based on real ticks** | **mandatory** — spread is the dominant variable and modelled ticks fabricate it |
| Period from | at least 24 months | Phase 1 §12.1 |
| Deposit / leverage | your real values | the risk caps are equity-relative |
| Optimisation | Disabled for the first run | |
| Forward | None for the first run | |

Before the first run, load M5 history for the symbol (`Ctrl+U` → select symbol → request
bars) — the EA replays ~20 sessions at startup and will refuse to trade without them.

**Expect no trades until the hour profile has formed** (5 completed sessions per hour
bucket). This is intentional: the gates fail closed rather than trade against an unformed
reference.

### Walk-forward, when you get there

Phase 1 §12: in-sample months 1–18, OOS-1 months 19–30, OOS-2 months 31–36 **sealed** —
touched once, and if it fails the strategy is rejected rather than re-tuned. Rolling 6/3
walk-forward, ≥ 8 folds, accept at WFE ≥ 0.5 and ≥ 70% of folds profitable. Only the four
parameters below may be optimised: 3 × 3 × 3 × 3 = 81 combinations.

---

## Inputs

### Optimisable — the approved set, and only these

| Input | Values | Default |
|---|---|---|
| `InpNImp` | 4 / 6 / 8 | 6 |
| `InpLMinMult` | 1.0 / 1.2 / 1.5 | 1.2 |
| `InpTpMult` | 1.5 / 2.0 / 2.5 | 2.0 |
| `InpCostBudget` | 0.10 / 0.12 / 0.15 | 0.12 |

### Instrument / account facts — set these, do not optimise them

| Input | Default | Notes |
|---|---|---|
| `InpSymbol` | `""` | empty = chart symbol |
| `InpVolume` | 0.01 | never varied by results; refused if not on the broker's volume step |
| `InpTargetNet` | 1.00 | a **floor**, not a fixed target |
| `InpCommissionPerLot` | 0.0 | round turn per 1.0 lot. **0 = auto-measure from deal history, with a warning** |
| `InpSlipEstSpreadMult` | 0.25 | modelled slippage per side as a fraction of spread — re-fit from your fills |

### Risk / operations

| Input | Default | Notes |
|---|---|---|
| `InpMaxTradesPerDay` | 4 | the primary quality control |
| `InpMaxDailyLossPct` | 2.0 | limit is `min(3 × avg loss, this % of equity)` |
| `InpMaxPositionsAcct` | 2 | account-wide, counted by magic |
| `InpSessionFilter` | true | derived from the hourly spread/ATR profile |
| `InpCorrelationGroups` | `XAU,XAG;BTC,ETH` | substring-matched, so broker suffixes still match |
| `InpBreakEven` | **false** | unproven; Phase 1 §8.4 — settle by backtest, not belief |
| `InpRolloverHour` | 0 | broker **server** hour of daily rollover — check yours |
| `InpRolloverGuardMin` | 15 | no entries within guard + 60 min; force-flat inside the guard |
| `InpMagic` | 20260903 | identifies our positions and orders |
| `InpLogLevel` | 3 | 0 silent · 1 error · 2 warn · 3 info · 4 debug (per-bar rejections) |

Everything else — ATR 14, EMA 20/50, fractal width 2, ER 0.50, pullback 0.20–0.618,
velocity 0.80, 5-bar validity, 3×ATR shock, cooldowns, cluster locks, the exit hierarchy —
is a compile-time constant in `Types.mqh`, deliberately out of the optimiser's reach.

---

## Example diagnostic log

```
[IPR XAUUSD] INFO  | === IPR Scalper starting ===
[IPR XAUUSD] INFO  | Warmup: 6360 M5 bars replayed, ATR=1.24, profile hours ready=24
[IPR XAUUSD] WARN  | CommissionPerLot is 0. The cost model will UNDERSTATE costs until
                     commission is measured from closed deals.
[IPR XAUUSD] INFO  | ---------------- FEASIBILITY ----------------
[IPR XAUUSD] INFO  | SYMBOL                  = XAUUSD
[IPR XAUUSD] INFO  | VOLUME                  = 0.0100
[IPR XAUUSD] INFO  | ATR(M5,14)              = 1.24
[IPR XAUUSD] INFO  | SPREAD                  = 0.18
[IPR XAUUSD] INFO  | M (money per 1.0 move)  = 1.000000
[IPR XAUUSD] INFO  | ESTIMATED COST          = 0.3150 (spread 0.18 + slip 0.14 + comm 0.0000)
[IPR XAUUSD] INFO  | REQUIRED $1.00-NET MOVE  = 1.32
[IPR XAUUSD] INFO  | ATR RATIO               = 1.06 (limit 1.50)
[IPR XAUUSD] INFO  | FEASIBILITY RESULT      = FEASIBLE
[IPR XAUUSD] INFO  | ---------------------------------------------
[IPR XAUUSD] INFO  | Ready. volume=0.0100 nImp=6 lMin=1.20 tpMult=2.00 budget=0.12 profileHours=24

[IPR XAUUSD] REJECT| SPREAD_TOO_HIGH | volRatio=1.02 spreadAtr=0.191
[IPR XAUUSD] REJECT| NO_IMPULSE | dir=LONG leg=0.00 er=0.00 depth=0.00
[IPR XAUUSD] REJECT| PULLBACK_TOO_DEEP | dir=LONG leg=2.91 er=0.72 depth=0.71
[IPR XAUUSD] REJECT| TARGET_COST_INFEASIBLE | dir=SHORT leg=2.44 er=0.63 depth=0.38

[IPR XAUUSD] INFO  | ACCEPT setup=4418201773355401 dir=LONG | legSize=3.86 atr=1.24 er=0.81
                     bos=2648.10 depth=0.34 turnTime=2026.02.11 09:35 | trigger=2651.44
                     sl=2650.31 tp=2653.92 | cost=0.3150 reqMove=1.32 tpAtr=2.00
                     riskDist=1.13 payoff=1.55 budget=0.087
[IPR XAUUSD] INFO  | FILLED setup=4418201773355401 LONG entry=2651.47 slip=0.03 dTp=2.48 dSl=1.13
[IPR XAUUSD] INFO  | EXIT MOMENTUM_FAILURE #218440913 barsHeld=7 mfe=1.02 dTp=2.48
[IPR XAUUSD] INFO  | CLOSED #218440913 net=-0.41 | consecLosses=1 tradesToday=1
                     realisedToday=-0.41 cooldownUntilBar=1284
```

Reject codes: `NO_DATA · SESSION · VOLATILITY_TOO_LOW/HIGH · SPREAD_TOO_HIGH ·
SPREAD_ABNORMAL · SHOCK_FILTER · REGIME_FLAT/FLIP · NO_IMPULSE · IMPULSE_TOO_SMALL ·
ER_TOO_LOW · NO_BOS · PULLBACK_TOO_SHALLOW/DEEP/LONG/FAST · NO_TURN_BAR ·
DUPLICATE_SETUP · NO_STRUCTURE_ROOM · TARGET_COST_INFEASIBLE · SL_TOO_TIGHT/WIDE ·
STOPS_LEVEL · COOLDOWN · CLUSTER_STRUCTURE/TIME/DISTANCE · MAX_DAILY_TRADES · RISK_LIMIT ·
DAILY_LOSS_LIMIT · CONSEC_LOSSES · POSITION_OPEN · MAX_POSITIONS · CORRELATION ·
EXEC_HALTED · ROLLOVER_WINDOW · SETUP_EXPIRED · FEASIBILITY · INVALID_VOLUME`

---

## Known limitations

1. **Not compiled by MetaEditor.** Do this first.
2. **Two interpretations need your sign-off** — `IMPLEMENTATION_NOTES.md` §1 (structural
   cap origin) and §2 (per-setup feasibility ceiling). Both are material to how often the
   EA trades.
3. **Slippage and commission are modelled, not measured.** Re-fit before trusting numbers.
4. **Gate-at-fill is approximated.** A resting stop order can fill between ticks; the EA
   re-validates continuously and pulls the order, but cannot cover that gap.
5. **No partial exits are possible at 0.01 lot** — half a minimum lot is not tradeable.
   The only in-trade management is the optional break-even step.
6. **Standing down is the normal state.** Long quiet periods are the design working, not a
   fault. Raise `InpLogLevel` to 4 to see why each bar was rejected.
7. **Single symbol per chart.** Multi-symbol means one chart each, sharing a magic number.
8. **Correlation control requires the same magic** across those charts.
9. **The hour profile needs history.** Without ~20 sessions of M5 bars the EA refuses to
   trade rather than guess.

## Verification

```bash
cd tests && ./run_tests.sh
```

Compiles the pure headers under g++, static-checks the MT5 layer, and runs 165 assertions.
See `TEST_REPORT.md` for coverage, mutation-testing evidence, and an explicit statement of
what these tests do *not* establish.
