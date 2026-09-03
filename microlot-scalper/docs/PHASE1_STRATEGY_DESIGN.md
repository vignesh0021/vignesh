# Phase 1 — Micro-Lot Scalping Strategy: Research & Design

**Status:** Design only. No MQL5/Python written. Awaiting approval before Phase 2.
**Scope:** Symbol-agnostic MT5 strategy. Primary test symbol XAUUSD; expansion to BTCUSD/BTCUSDT and other CFD/FX/crypto instruments.
**Default volume:** 0.01 lot (user-configurable).
**Stated objective:** Net profit ≥ $1.00 per completed trade, after all costs.

---

## 0. Executive summary — the three findings that shape everything

Before any entry model is chosen, three results from the cost mathematics constrain the entire design. They are derived in §9 and §K.

**Finding 1 — Lot size is irrelevant to whether this works.**
Costs and targets both scale linearly with volume. The ratio that decides profitability is cost divided by barrier span *in price units*, which is invariant to lot size. Raising the lot to hit $1 with a smaller move makes the strategy strictly worse. Lowering it makes the required move larger and the strategy strictly better. **Micro-lot is therefore the correct configuration, not a compromise** — it forces a target distance large enough to escape the spread.

**Finding 2 — The whole problem reduces to one equation.**

```
Required edge over a driftless random walk  =  C / (d_tp + d_sl)
```

where `C` is round-turn cost and `d_tp`, `d_sl` are the target and stop distances in price units. Everything else — win rate, payoff ratio, target size — follows from this. Design work is therefore about **maximising barrier span relative to cost**, nothing else.

**Finding 3 — $1.00 net must be a floor, not a target.**
On XAUUSD at 0.01 lot, a $1.00 net target sits at ~1.2–1.4 in gold price units. Pairing that with any sane structural stop demands a **15–18 percentage point** edge over random — not realistic. Widening the target to ~2.0×ATR drops the requirement to **6–10 pp**, which is at the plausible limit of a real systematic edge. So the system should target `max($1-net-equivalent, 2.0 × ATR)` and *decline to trade* when the market cannot offer that span cheaply.

**Verdict on the core concept:** "Micro lot + frequent small moves + $1 net" is **viable only if the words "frequent" and "small" are dropped.** The workable version is *micro lot + selective, ATR-scaled moves + $1 net as a minimum acceptance floor*, at 2–5 trades/day/symbol. The high-frequency version is arithmetically dead.

---

## 1. Trading universe & symbol-agnostic contract

No pip/point constant may appear anywhere in the logic. Everything derives at runtime from MT5 symbol properties.

| MT5 property | Used for |
|---|---|
| `SYMBOL_POINT`, `SYMBOL_DIGITS` | price rounding, buffer quantisation |
| `SYMBOL_TRADE_TICK_SIZE`, `SYMBOL_TRADE_TICK_VALUE` | **money-per-price-unit** (the core conversion) |
| `SYMBOL_TRADE_CONTRACT_SIZE` | cross-checks, notional/margin |
| `SYMBOL_VOLUME_MIN/MAX/STEP` | volume validation, min-lot feasibility test |
| `SYMBOL_SPREAD` / live tick bid-ask | live cost gate |
| `SYMBOL_TRADE_STOPS_LEVEL`, `SYMBOL_TRADE_FREEZE_LEVEL` | minimum legal SL/TP distance |
| `SYMBOL_SWAP_LONG/SHORT`, `SYMBOL_SWAP_MODE`, rollover time | overnight cost, force-flat rule |
| `SYMBOL_SESSION_*` (quote/trade sessions) | session gating |
| `SYMBOL_TRADE_EXEMODE`, `SYMBOL_FILLING_MODE` | order placement mode |
| commission (deal history / account config) | cost model — **must be measured, not assumed** |

**The single conversion that makes the system symbol-agnostic:**

```
M  =  volume × TICK_VALUE / TICK_SIZE          [account currency per 1.0 price unit]
```

Every money↔price conversion in the strategy goes through `M`. Verified against three instrument shapes:

| Symbol | Contract | Tick size | Tick value | `M` at 0.01 lot | Move for $1 gross |
|---|---|---|---|---|---|
| XAUUSD | 100 oz | 0.01 | $1.00 | **$1.00 / price unit** | $1.00 of gold (100 pts) |
| BTCUSD | 1 BTC | 0.01 | $0.01 | **$0.01 / price unit** | $100 of BTC |
| EURUSD | 100 000 | 0.00001 | $1.00 | **$1000 / price unit** | 10.0 pips |

If `TICK_VALUE` is reported in a non-account currency, it must be converted via the current conversion-pair rate, re-read periodically (this is a common silent bug on non-USD accounts).

---

## 2. Entry model research — comparison of eight candidates

Assessed against: source of edge, regime dependence, frequency, false-signal rate, symbol fit, and — decisively — **whether the model naturally produces a barrier span large enough to absorb cost.** That last column is where most scalping models fail.

### A. Breakout + momentum
- **Edge source:** volatility clustering (expansion follows expansion) plus liquidity taken at stop clusters above/below obvious levels.
- **Works:** session opens, post-consolidation expansion, news-driven trend days.
- **Fails:** ranging markets. On XAUUSD M1/M5 the false-breakout rate in range conditions is the dominant loss mode; price pierces and reverts within 1–3 bars.
- **Frequency:** high (10–30/day if unfiltered).
- **False-signal risk:** **High.**
- **XAU:** good during London/NY open only. **BTC:** good — BTC trends cleanly after expansion. **Micro-lot:** fine.
- **$1-net exit compatibility:** poor-to-moderate. Entry is at the *worst* price of the leg (the extreme), so the stop must be wide to survive the retest, which compresses payoff.
- **R:R:** typically 0.8–1.2. **Verdict:** edge is real but entry location is cost-inefficient.

### B. Pullback after momentum (continuation retracement)
- **Edge source:** short-horizon trend persistence + **entry location**. You enter near the retracement extreme, so the invalidation point is close and the run-room is large.
- **Works:** trending/impulsive sessions with orderly corrections.
- **Fails:** V-shaped moves that never retrace (missed trades, not losses) and at genuine reversals (the "pullback" is actually the new trend).
- **Frequency:** moderate (2–6/day filtered).
- **False-signal risk:** Moderate — and critically, **failures are cheap** because the stop sits just beyond the pullback extreme.
- **XAU:** excellent — gold retraces reliably inside impulses. **BTC:** good. **Micro-lot:** excellent.
- **$1-net exit compatibility:** **Best of the eight.** Tight structural stop + far target is the only geometry that produces a large `d_tp + d_sl` span without an absurd stop.
- **R:R:** 1.5–3.0. **Verdict: strongest single component.**

### C. Trend continuation (EMA stack / MA cross)
- **Edge source:** weak — mostly a restatement of autocorrelation already captured by B.
- **Works:** sustained trends. **Fails:** chop, and it is structurally late.
- **Frequency:** high, low specificity. **False-signal risk:** High.
- **$1-net compatibility:** poor — no natural stop location, so stops become arbitrary.
- **Verdict:** rejected as a primary trigger; **retained only as a directional filter** inside the hybrid.

### D. VWAP / EMA-based momentum
- **Edge source:** VWAP as an institutional reference price; genuine on centrally-cleared venues.
- **Fatal issue for us:** MT5 CFD "volume" is **broker tick count**, not traded contracts. It is not comparable across brokers or across XAU vs BTC. A VWAP built on it is not the VWAP anyone trades against.
- **XAU:** marginal (gold tick volume correlates loosely with COMEX futures volume). **BTC:** unreliable — CFD tick volume is a broker artefact.
- **Verdict: rejected on symbol-agnosticism grounds.** Violates the requirement directly.

### E. Volatility expansion (squeeze → release)
- **Edge source:** volatility is strongly autocorrelated; low-vol compression reliably precedes expansion. This is one of the better-documented short-horizon effects.
- **Works:** pre-session compression, post-news consolidation.
- **Fails:** direction is *not* predicted — expansion tells you a move is coming, not which way. Used alone it is a coin flip with good size.
- **Frequency:** low (1–3/day). **False-signal risk:** low on magnitude, high on direction.
- **$1-net compatibility:** **excellent on the magnitude axis** — expansion is precisely the condition under which a large target is reachable.
- **Verdict: keep as a regime gate, not as a direction signal.** It answers "can this market pay $1 net?" which is exactly the question §9 poses.

### F. Range breakout (opening range / session range)
- **Edge source:** session-open order flow imbalance; the best-documented of the set.
- **Works:** London and NY opens on XAUUSD. **Fails:** the rest of the day; also degrades badly on 24/7 BTC where "the open" is arbitrary.
- **Frequency:** very low (1–2/day). **False-signal risk:** moderate.
- **XAU:** very good. **BTC:** poor (no meaningful session open).
- **Verdict:** genuine edge but **not symbol-agnostic**. Rejected as core; the underlying insight is preserved by the empirical session-quality profile in §7.

### G. Market structure break (BOS / CHoCH)
- **Edge source:** regime-change detection — a broken swing high/low is a real transfer of control.
- **Works:** at turning points and trend initiations. **Fails:** definition-sensitive; results swing wildly with the swing-detection parameter, which is an overfitting magnet.
- **Frequency:** moderate. **False-signal risk:** moderate.
- **$1-net compatibility:** good — provides objective stop and target levels.
- **Verdict:** **keep as a structural confirmation and as the source of stop/target levels**, with swing detection fixed a priori (not optimised) to avoid curve-fitting.

### H. Multi-condition hybrid
- The only construction that can simultaneously satisfy: directional edge, cost-efficient entry location, and a guaranteed-large barrier span.
- Risk: each added condition cuts frequency and multiplies overfitting surface. Mitigated by keeping the component count to four and the optimisable parameter count to four.

### Recommendation

**Adopt B (pullback continuation) as the trigger, gated by E (volatility expansion), confirmed by G (structure break), filtered by C (EMA regime).** A and F are rejected as primary triggers because their entry location is cost-inefficient; D is rejected outright for symbol-dependence.

Name: **IPR — Impulse → Pullback → Resumption.**

Why this wins on the only metric that matters: the pullback entry places the stop at a *structurally meaningful and nearby* level while leaving the target far away. That maximises `d_tp + d_sl` for a given risk, which by Finding 2 minimises required edge. Breakout entries do the opposite.

---

## 3. Absolute rules — compliance statement

The design contains **none** of: martingale, lot multiplication, grid, averaging down/up, recovery orders, unlimited re-entry, multiple orders per signal, cluster orders from nearby candles, or revenge trading. Volume is **constant** and never a function of prior results. One setup → at most one trade → setup permanently consumed (§5.9–5.10). Enforcement is structural, via the setup-lifecycle state machine, not advisory.

---

## 4. Components — and why each one exists

Deliberately four. Each has a distinct, non-overlapping job; anything that duplicated an existing job was cut.

| Component | Job | Why not something else |
|---|---|---|
| **ATR(14), M5** | The universal unit. Normalises impulse size, stop, target, spread and volatility filters. | Nothing else converts across XAU/BTC/FX without constants. |
| **EMA(20) & EMA(50), M5** | Directional regime filter only. Never a trigger. | Cheap, stable, one concept. |
| **Fractal swing pivots (2-bar), M5** | Structure: impulse validation (BOS), pullback anchor, stop placement, opposing-level target cap. | Deterministic; no indicator lag. |
| **Kaufman Efficiency Ratio over the impulse window** | Replaces the phrase "strong momentum" with a scale-free number in [0,1]. | Does the job ADX does, but bounded, unitless, no smoothing lag, and needs no parameter tuning. |

**Explicitly excluded, with reasons:**
- **RSI** — at this horizon it is a monotone transform of information already in the impulse leg and ER. Adds a parameter, no orthogonal signal.
- **ADX** — superseded by ER (same purpose, fewer parameters, no Wilder smoothing lag).
- **Volume / relative volume** — MT5 CFD volume is broker tick count. Not comparable across symbols or brokers. Violates symbol-agnosticism. *May be logged as a diagnostic; must never gate a trade.*
- **VWAP** — depends on the same unreliable volume. Rejected.
- **Bollinger/Keltner squeeze** — the volatility-expansion role is served by the ATR-ratio gate (§7) with one fewer indicator.

---

## 5. Entry engine — deterministic specification

Bar index 0 = most recent **closed** M5 bar. All decisions are made on bar close except the trigger, which is intrabar. `A` = ATR(14) on M5 in price units. Long side stated; short side is the exact mirror.

### 5.1 What market condition must exist (regime gate — all must hold)
- **G1 Session:** current time is inside an allowed trading window (§7.4).
- **G2 Volatility band:** `0.60 ≤ A / A_ref ≤ 2.50`, where `A_ref` = median M5 ATR for this same hour-of-day over the trailing 20 sessions. Self-referential ⇒ symbol-agnostic. Below the band = dead market (target unreachable); above = news chaos (slippage and gap risk).
- **G3 Cost gate:** `S_live / A ≤ 0.15` **and** `S_live ≤ 2.5 × S_med(hour)`.
- **G4 Shock filter:** no bar among the last 3 has range > `3 × A`. If violated, stand down for 6 bars.
- **G5 Portfolio state:** no open position on this symbol, all cooldowns expired, all daily limits intact (§10).

### 5.2 What defines bullish conditions
- `EMA20 > EMA50` on M5, **and**
- `EMA20[0] − EMA20[5] > 0.10 × A` (slope must be materially positive, not merely non-negative).

### 5.3 What defines bearish conditions
Exact mirror: `EMA20 < EMA50` and `EMA20[5] − EMA20[0] > 0.10 × A`.

### 5.4 What creates a valid setup (the impulse leg)
Search bars 1..`N_imp+3` for a leg where the low precedes the high:
- **I1** `leg_low` = lowest low, `leg_high` = highest high, index(`leg_high`) < index(`leg_low`) in bars-ago terms (i.e. the high is more recent).
- **I2 Size:** `L = leg_high − leg_low ≥ L_min_mult × A` (default `L_min_mult = 1.2`). Guarantees the leg is large relative to noise.
- **I3 Directional efficiency:** `ER = |C_end − C_start| / Σ|C_i − C_{i−1}| ≥ ER_min` over the leg (default `0.50`). This is the numeric definition of "impulsive": half the movement must be net directional.
- **I4 Structure (BOS):** `leg_high` exceeds the most recent confirmed fractal swing high that preceded `leg_low`. Control has demonstrably changed hands.
- **I5** Regime bullish per §5.2.

### 5.5 What confirms the setup (the pullback)
After `leg_high` forms, let `pb_low` = lowest low since, `pb_bars` = bars elapsed since `leg_high`.
- **P1 Depth:** `R = (leg_high − pb_low) / L`, require `R_min ≤ R ≤ R_max` (defaults `0.20`, `0.618`).
- **P2 Duration:** `pb_bars ≤ N_imp`. A correction that takes longer than the impulse is a reversal, not a pause.
- **P3 Corrective velocity:** `(L × R) / pb_bars < 0.80 × (L / imp_bars)`. The pullback must be slower per bar than the impulse. This is the numeric replacement for "healthy retracement".
- **P4 Turn bar:** the pullback must show a turn — one closed M5 bar whose low is `pb_low` and which is followed by a bar closing above its own open. That bar is the **turn bar**.

### 5.6 What exact price triggers the entry
```
buffer  b   = max(0.10 × A, 2 × S_live, TRADE_STOPS_LEVEL × POINT, 1 tick)
P_trig      = high(turn_bar) + b
```
Entry is a **buy-stop** at `P_trig` (or an intrabar market order on the ask crossing `P_trig`, broker-dependent). The buffer is what prevents entry on a one-tick wick and is denominated in ATR and live spread — never in fixed points.

### 5.7 What invalidates the setup
Any one of these permanently kills the setup (state → `INVALIDATED`, never revived):
1. Price trades below `pb_low − 0.05 × A` before the trigger fires.
2. `R` exceeds `R_max` (retracement too deep).
3. A bearish BOS occurs (a confirmed fractal swing low is broken downward).
4. Regime flips (§5.2 ceases to hold).
5. Validity window expires (§5.8).
6. Any regime gate G1–G5 fails at the moment the trigger would fire.
7. The pre-trade feasibility gate (§8.2) fails at the moment the trigger would fire.

### 5.8 How long a setup is valid
`V = 5` M5 bars from the turn bar's close. Not optimisable — fixed at design time to avoid a parameter whose tuning would silently absorb noise. Rationale: beyond ~25 minutes the impulse's information has decayed and the setup is stale.

### 5.9 How duplicate entries are prevented
Each setup gets an immutable identity:
```
SetupID = hash(symbol, direction, time(leg_high), price(leg_high), time(turn_bar), price(pb_low))
```
State machine: `FORMING → ARMED → (TRIGGERED | INVALIDATED | EXPIRED)`. A SetupID that leaves `ARMED` can **never** re-enter it. At most one `ARMED` setup per symbol per direction exists at any time. This makes "one setup → one trade" a structural property, not a rule that could be violated by a race.

### 5.10 How cluster trades from nearby setups are prevented
Four independent locks; **all** must clear before a same-direction re-entry:
1. **Fresh-structure lock:** the new setup's `leg_high` must exceed the previous *entered* setup's `leg_high` by ≥ `0.5 × A`. Overlapping structure cannot re-fire.
2. **Time lock:** ≥ 12 M5 bars (60 min) since the previous entry on this symbol.
3. **Distance lock:** entry price must differ from the previous entry price by ≥ `1.0 × A`.
4. **Cooldown lock:** §10 cooldowns satisfied.

Opposite-direction re-entry additionally requires a confirmed BOS in the new direction — it can never be a reflex flip out of a loss.

---

## 6. Momentum confirmation — resolved

The question "what confirms momentum" is answered by exactly three numbers, all scale-free:

| Test | Rule | Replaces the vague phrase |
|---|---|---|
| Leg magnitude | `L ≥ 1.2 × A` | "significant breakout" |
| Leg efficiency | `ER ≥ 0.50` | "strong momentum" |
| Regime alignment | `EMA20 > EMA50` and slope `> 0.10 × A` per 5 bars | "good trend" |

Candle body/range ratios were evaluated and **dropped**: body/range is highly sensitive to the broker's bar-close timestamping and adds a parameter without adding information beyond `L` and `ER`.

---

## 7. Spread & volatility filters — normalised, no constants

All thresholds are ratios. No filter contains a number denominated in points.

### 7.1 Maximum acceptable spread
`S_live / A ≤ 0.15`. Rationale: spread alone must not consume more than ~15% of one ATR of the barrier span.

### 7.2 Abnormal spread protection
`S_live ≤ 2.5 × S_med(symbol, hour-of-day)`, where `S_med` is a rolling median over the trailing 20 sessions in the same hourly bucket. Catches rollover blowouts, news spikes and pre-weekend widening **without knowing anything about the symbol**.

### 7.3 Minimum & maximum volatility
`0.60 ≤ A / A_ref ≤ 2.50` (§5.1 G2). Lower bound protects against unreachable targets; upper bound against slippage and gapping.

### 7.4 Session gating — derived, not hardcoded
**Mechanism (primary, symbol-agnostic):** build a per-hour profile of `median(S / A)` from ≥ 20 sessions of history. Permit trading only in hours where that median is in the best 50% *and* below an absolute ceiling of 0.15. This automatically discovers London/NY for gold and the liquid hours for BTC, with no session constants in the code.

**Expected outcome (to be confirmed, not assumed):** XAUUSD ≈ 07:00–11:00 and 13:00–17:00 UTC; Asia and 21:00–01:00 UTC excluded. BTC ≈ most hours pass, with the broker rollover window and low-liquidity weekend hours excluded.

**Hard exclusions regardless of profile:** ±15 min around broker rollover (swap + spread blowout); Friday after 19:00 UTC; the first 2 minutes after the weekly market open (gap). DST is handled by deriving the broker's server-time-to-UTC offset at runtime, never by a compiled constant.

### 7.5 Abnormal volatility protection
Shock filter G4 (§5.1). Optional scheduled-news blackout of ±3 minutes if a calendar feed is available — treated as an enhancement, not a dependency, since a calendar is not symbol-agnostic.

---

## 8. Exit engine

### 8.1 Comparison of the five approaches

| Approach | Assessment |
|---|---|
| **A. Fixed monetary ($1)** | Simple and directly matches the stated objective, but ignores volatility: unreachable in quiet markets, leaves large amounts on the table in fast ones. Fixed-money targets also silently *shrink* in ATR terms as volatility rises — exactly backwards. **Rejected as sole rule.** |
| **B. ATR-based** | Adapts correctly to volatility, but can fall below the $1 net floor in quiet conditions, producing trades that cannot satisfy the objective. **Rejected alone.** |
| **C. Structure-based** | Correct logic (next opposing swing / measured move) and gives honest information about where the move will stall — but distance is uncontrolled and often unreachable. **Rejected alone; retained as a cap.** |
| **D. Dynamic / trailing** | Captures the tail but materially lowers hit rate, and at 0.01 lot there is no partial-close option to offset that. **Rejected as primary; testable as a variant.** |
| **E. Hybrid** | **Recommended.** |

### 8.2 Recommended exit — hybrid floor / scale / cap

Computed once, at the trigger moment, from live values:

```
M          = volume × TICK_VALUE / TICK_SIZE
C_money    = (S_live + Slip_est) × M + Commission_rt + Swap_expected
d_req      = (TargetNet + C_money) / M                       # the $1 NET floor, in price units
d_struct   = 0.90 × distance to next opposing fractal swing level
d_tp       = clamp( max(d_req, TP_mult × A),  lower = d_req,  upper = d_struct )
d_sl       = (P_entry − pb_low) + max(0.15 × A, 1.5 × S_live, STOPS_LEVEL)
```

**Pre-trade feasibility gate — the trade is rejected unless all four hold:**

1. **Structure permits payment:** `d_struct ≥ d_req`. If the nearest opposing level is closer than the distance needed to earn $1 net, the market is telling you it cannot pay. Skip.
2. **Stop is not in the noise:** `d_sl ≥ max(0.40 × A, 3 × S_live)`.
3. **Stop is not absurd:** `d_sl ≤ 1.20 × A`.
4. **Cost budget (the decisive gate):** `C_money / M ≤ CostBudget × (d_tp + d_sl)`, default `CostBudget = 0.12`.

Gate 4 is the operational form of Finding 2: it refuses any trade requiring more than 12 percentage points of edge over random. It simultaneously acts as a spread filter, a volatility floor, a target-sizing constraint and a symbol-suitability test — one rule replacing four. **Most candidate setups will die here. That is the intended behaviour.**

### 8.3 Protective exits (priority order, highest first)

1. **Emergency stop loss** — broker-side, attached at order send, never removed. Non-negotiable: it is the only protection that survives a VPS or connection failure.
2. **Rollover / weekend force-flat** — close unconditionally 5 min before broker rollover and 30 min before Friday close. Removes swap from the model entirely for intraday trades.
3. **Spread-expansion protection** — if `S_live > 4 × S_med(hour)`: if the trade is ≥ `0.5 × d_tp` in profit, close now; if it is in loss, **do not** cross a garbage spread — hold to the broker stop or the time exit. Panicking into a blown-out spread is itself a loss mechanism.
4. **Momentum-failure exit** — two consecutive M5 closes below `EMA20` (longs). The thesis was continuation; two closes against it means the thesis is dead.
5. **No-progress exit** — after 4 bars, if MFE < `0.35 × d_tp`, close at market. Kills trades that are neither working nor losing.
6. **Maximum holding time** — `T_max = 12` M5 bars (60 min) default, then market close.

Rules 4–6 are what guarantee a losing scalp is never held indefinitely waiting for $1.

### 8.4 Breakeven / partial management
**At 0.01 lot a partial close is impossible** — 0.005 is below `VOLUME_MIN` on every broker. This is a real and under-appreciated constraint of micro-lot trading: the usual "take half at 1R" risk management is simply unavailable. The only available step is a breakeven stop move (to entry + cost) once price reaches `+1.0 × d_sl`. Breakeven stops usually *reduce* expectancy by converting winners into scratches, so this ships as a **flag defaulting to OFF, to be settled by backtest rather than belief.**

---

## 9. Profit-target feasibility — worked numbers

### 9.1 XAUUSD at 0.01 lot (`M` = $1.00 per price unit)

| Account type | Spread | Slippage | Comm. (rt) | **C** | Move for $1 NET | vs M5 ATR ≈ 1.2 |
|---|---|---|---|---|---|---|
| Raw/ECN, tight | 0.10 | 0.06 | $0.06 | **$0.22** | 1.22 | 1.02 × ATR |
| ECN, typical | 0.18 | 0.10 | $0.07 | **$0.35** | 1.35 | 1.13 × ATR |
| Standard (no comm.) | 0.35 | 0.12 | — | **$0.47** | 1.47 | 1.23 × ATR |
| Asia session, thin | 0.55 | 0.20 | $0.07 | **$0.82** | 1.82 | **3.03 × ATR** |

**Conclusions.**
- $1 net at 0.01 lot needs roughly **122–147 gold points** in tradeable conditions. Achievable — this is a normal 10–40 minute move during London/NY.
- **It is not achievable in the Asia session.** At 3× ATR the required move is a session-sized range. §7.4 excludes those hours automatically.
- Costs consume **18–32%** of the $1 gross target. This is the central problem, and it is why the target must be allowed to scale up (§8.2).

### 9.2 BTCUSD at 0.01 lot (`M` = $0.01 per price unit ⇒ $1 needs a $100 BTC move)

| Condition | Spread | Slippage | **C** | Move for $1 NET | vs M5 ATR |
|---|---|---|---|---|---|
| Tight CFD | $15 | $8 | **$0.23** | $123 | **0.49 × ATR (250)** |
| Typical | $35 | $15 | **$0.50** | $150 | 0.60 × ATR (250) |
| Wide / weekend | $90 | $40 | **$1.30** | $230 | 1.53 × ATR (150) |

**BTC is structurally the *better* symbol for this objective**, which is counter-intuitive and worth stating plainly: $1 net at 0.01 BTC is only ~0.5 × M5 ATR, versus ~1.1 × ATR for gold. The trade-offs are wider spread dispersion, 24/7 operation with no natural session, weekend/broker-hours gap mismatch, and materially larger swap if a position ever survives rollover.

### 9.3 Where $1 NET is *not* realistic — say so explicitly
- **XAUUSD Asia session** (required move ≈ 3 × ATR) — excluded by the session/volatility gates.
- **Any symbol where `1.0/M` exceeds ~1.5 × M5 ATR at minimum volume.** For example most FX minors and low-value CFDs at 0.01 lot. EURUSD at 0.01 lot needs 10 pips gross (~12 pips net) against an M5 ATR of ~5–8 pips ⇒ ~1.7 × ATR — **marginal, and the system should decline it at 0.01 lot** rather than force trades.
- The EA must therefore run a **startup feasibility report per symbol** and *refuse to trade*, with a logged explanation, rather than lowering standards to satisfy the objective. This directly implements "do not force the strategy to trade merely to satisfy the $1 objective."

---

## 10. Risk model (fully independent of the entry model)

Consumes only: fill price, stop distance, realised P&L, clock. Knows nothing about impulses or pullbacks — so it can be tested, replaced or tightened without touching entry logic.

| Control | Setting | Notes |
|---|---|---|
| Max loss per trade | `d_sl ≤ 1.2 × A`, and money-loss ≤ `RiskPct × equity` | **If min volume forces a larger loss than the cap, skip the trade.** Volume cannot go below `VOLUME_MIN`; the only correct response is not to trade. |
| Max simultaneous positions | 1 per symbol; 2 account-wide | Never two correlated symbols concurrently (XAU/XAG, BTC/ETH) — correlation group defined in config. |
| Daily loss limit | min(3 × avg net loss, 2% equity) | Halt for the session on breach. |
| Max consecutive losses | 3 → stop for the day; 5 within 3 days → halt pending manual review | |
| Cooldown after loss | 20 M5 bars (100 min) on that symbol; 40 bars after a 2nd consecutive loss | Anti-revenge, structurally enforced. |
| Cooldown after win | 6 M5 bars (30 min) | Prevents re-entering an exhausted move. |
| Max trades / day | 4 per symbol | The primary quality control. Deliberately binding. |
| Max holding time | 12 M5 bars | §8.3 |
| Spread emergency | §8.3 rule 3 | |
| Abnormal market halt | 3 consecutive order failures/requotes, **or** 5 consecutive fills with slippage > 2 × estimate → halt for the session | Detects broker-side degradation, which is a real and common failure mode. |
| Equity floor | Halt if equity < `StartEquity × (1 − MaxDDPct)` | Default 15%. |

**Note on volume:** volume is a constant input. It is never modified by prior outcomes, drawdown, or streaks in either direction.

---

## 11. Trade frequency — what the constraints actually cost

Applying one-setup/one-entry + cooldowns + fresh-structure + the cost gate is expected to cut raw candidate setups by roughly an order of magnitude, from ~25–40/day of loose momentum signals to **2–5/day/symbol**.

This is the intended trade-off and it is favourable, because by Finding 2 every trade taken below the cost budget carries a *negative* expected contribution. Filtering does not merely reduce noise; it removes structurally losing trades. The relevant metric is expectancy per trade × trades, never trade count.

**Explicit design instruction for Phase 2 testing:** the ablation must be measured, not assumed. Backtest with each of the four cluster locks disabled individually to quantify what each contributes. If a lock costs expectancy, it should be dropped.

---

## 12. Backtest protocol

### 12.1 Data
- **Real tick data with real historical spread.** MT5 "Every tick based on real ticks", or an external tick source (Dukascopy/broker export). **M1-modelled backtests are invalid for this strategy** — spread is the dominant variable and modelled ticks fabricate it.
- Minimum 24 months per symbol; the spread series must be genuine, not a constant fill-in.

### 12.2 Periods
| Segment | Purpose |
|---|---|
| In-sample: months 1–18 | development and parameter selection |
| OOS-1: months 19–30 | single validation pass |
| OOS-2: months 31–36 | **sealed.** Touched exactly once, at the end. If it fails, the strategy is rejected — not re-tuned. |

### 12.3 Walk-forward
Rolling 6-month train / 3-month test, ≥ 8 folds. Acceptance: **walk-forward efficiency ≥ 0.5** and **≥ 70% of folds profitable**.

### 12.4 Required metrics (all reported per symbol and per session bucket)
Total trades · net profit · gross profit · gross loss · profit factor · win rate · average win · average loss · expectancy per trade · maximum drawdown (money and %) · maximum consecutive losses · average holding time · median holding time · trades per day · **$1-NET target hit rate** · stop-loss rate · time-expiry exit rate · momentum-failure exit rate · no-progress exit rate · **realised C as % of barrier span** (the Finding-2 diagnostic) · MAE/MFE distributions.

### 12.5 Robustness (acceptance gates, not diagnostics)
- **Cost sensitivity:** re-run at spread × {1, 1.5, 2}, commission × {1, 2}, slippage × {0, 1, 2, 3}. **Must remain positive at spread × 1.5 with slippage × 2.** A strategy that only works at advertised spreads will not survive live.
- **Parameter sensitivity:** for each optimisable parameter, plot expectancy across its range. The chosen value must sit on a **plateau** — both neighbours within 25% of its performance. A solitary spike is rejected as overfitting regardless of its returns.
- **Random-entry control:** run identical filters, exits and risk rules with a *random* entry direction over the same periods. The strategy must beat this control with statistical significance. This is the direct empirical test of `p* − p_rw = C/span` and is the single most informative test in the protocol — it isolates whether the entry model has any directional edge at all, as opposed to the exits and filters doing all the work.
- **Monte Carlo:** 1000 trade-order reshuffles → 5th-percentile max drawdown and probability of breaching the equity floor.
- **Minimum sample:** ≥ 300 trades overall, ≥ 100 in each OOS segment. Below that, no conclusion is drawn in either direction.

### 12.6 Anti-overfitting rules
Only 4 optimisable parameters (§J). `ER_min`, `R_max`, pullback velocity, validity window and all buffer coefficients are **fixed a priori from reasoning, never optimised**. No parameter may be tuned per-symbol; the whole point is symbol-agnosticism. Any lookback statistic (`A_ref`, `S_med`) uses strictly trailing data — a rolling median that peeks at the test window is silent look-ahead bias and would invalidate everything.

---

## 13. Challenging the core concept — honest assessment

The user asked not to assume this is profitable. It should not be assumed.

### 13.1 The cost-drag paradox — and why the "obvious" fix is a trap
Since required edge is `C / (d_tp + d_sl)`, the cheapest configuration on paper is a **small target with a very wide stop**: $1.35 target against a $5.00 stop needs only **5.5 pp** of edge and shows an 84% breakeven win rate.

This is a trap, and the arithmetic proving it is worth stating. That configuration is only cheap **under a driftless random walk**. Real gold and BTC exhibit trend persistence and fat tails. A first-passage simulation with regime drift and 2% fat-tail shocks gives:

| Configuration | Driftless E/trade | Trending + fat tails E/trade |
|---|---|---|
| A: $1.35 TP / $5.00 SL | −$0.35 | **−$2.17** |
| B: $1.80 TP / $0.90 SL | −$0.34 | +$0.09 |
| **C: $2.40 TP / $1.00 SL** | −$0.35 | **+$0.36** |

The wide-stop configuration **collapses** exactly when the market does something interesting, because its rare loss is 6× its typical win and trends make that loss far less rare than the random-walk model predicts. It also produces the classic equity curve that climbs smoothly for months and then gives everything back. **Rejected — and this is precisely the shape most $1-target retail EAs take.**

### 13.2 Required edge, by configuration (XAUUSD 0.01 lot, C = $0.35)

| Configuration | `d_tp` | `d_sl` | Random-walk win% | Breakeven win% | **Edge required** | Payoff |
|---|---|---|---|---|---|---|
| $1 floor TP, structural SL | 1.35 | 0.90 | 40.0% | 55.6% | **15.6 pp** | 0.80 |
| $1 floor TP, tight SL | 1.35 | 0.60 | 30.8% | 48.7% | **17.9 pp** | 1.05 |
| 1.5×ATR TP | 1.80 | 0.90 | 33.3% | 46.3% | **13.0 pp** | 1.16 |
| **2.0×ATR TP (typical ECN)** | 2.40 | 1.00 | 29.4% | 39.7% | **10.3 pp** | 1.52 |
| **2.0×ATR TP (raw ECN)** | 2.40 | 1.00 | 29.4% | 35.9% | **6.5 pp** | 1.79 |
| 2.0×ATR TP (standard acct) | 2.40 | 1.00 | 29.4% | 43.2% | 13.8 pp | 1.31 |

**Broker choice moves the required edge from 6.5 pp to 13.8 pp — a larger effect than any entry-model refinement available.** This is the highest-leverage decision in the project and it is made before a line of code is written.

### 13.3 Enumerated problems
1. **Cost drag is the primary risk**, not signal quality. 18–32% of a $1 gross target is friction on gold.
2. **Spread widens exactly when signals fire.** Momentum ignition and spread expansion are the same event. Backtests using average spread systematically overstate results; this is why §12.1 demands real tick spread.
3. **Slippage is asymmetric.** Stops slip; limit-based targets do not. Modelling symmetric slippage flatters results. Model stop-exit slippage at ~2× entry slippage.
4. **Low volatility:** the target becomes unreachable; the system correctly stops trading, but then produces no return at all. Extended quiet regimes = long flat periods.
5. **High volatility:** stops are jumped, slippage explodes, spread multiplies. The vol ceiling helps but cannot prevent gap-throughs.
6. **Min-lot floor:** below 0.01 lot there is nothing. On a small account, risk % per trade is *forced* by the instrument, and partial exits are impossible (§8.4).
7. **Probability of hitting $1 before the stop** is `d_sl/(d_tp+d_sl)` absent edge — for the recommended geometry that is **29%**, not the intuitive "small target so it hits often". The intuition that a small dollar target is easy to hit is wrong once the stop is placed sanely.
8. **The $1 target manufactures misleading statistics.** Paired with a loose stop it yields a high win rate and negative expectancy — the single most common way this concept fails in practice.
9. **Execution risk:** stop-order slippage, requotes, and last-look rejection on fast breaks are concentrated precisely in the conditions the strategy seeks.
10. **Regime dependence:** gold trended strongly through 2024–25. A prolonged range year could halve the edge. Walk-forward across regimes is mandatory, not optional.
11. **Scale reality (must be stated plainly):** Monte Carlo at 3 trades/day, 250 days, the recommended geometry:

| True win rate | Median annual net | 5th pct | Median max DD |
|---|---|---|---|
| 36% (≈ breakeven) | −$94 | −$166 | $111 |
| 40% | +$8 | −$71 | $48 |
| 45% | **+$137** | +$55 | $25 |

**At 0.01 lot this is a validation vehicle, not an income vehicle.** A genuinely good outcome is roughly **$100–150 per year**. That is the correct expectation. The purpose of trading it at 0.01 lot is to establish whether the edge is real at negligible cost; scaling is a separate, later decision that requires the OOS evidence first.

### 13.4 Is positive expectancy actually attainable?
**Yes, conditionally.** It requires *all* of:
- a raw-spread/ECN account on XAUUSD (standard accounts: no);
- a true win rate above ~40% at 2.4:1.0 geometry;
- disciplined refusal to trade outside the cost budget;
- and an entry model with a genuine 6–10 pp directional edge.

That last condition is demanding but not fantastical — it is roughly what a well-executed pullback-continuation model with a session filter has historically delivered. **It is, however, exactly the thing that has not yet been demonstrated, and Phase 2's job is to test it honestly rather than to make it appear true.**

### 13.5 If $1 net proves unsuitable — the alternative
Preserve micro-lot scalping; replace the fixed dollar target with a **cost-multiple target**:

> **Target = whichever is larger of ($1.00 net) and (8 × total round-trip cost).**

This is symbol-agnostic by construction, automatically scales with spread and volatility, caps required edge at 12.5 pp minus the stop's contribution, and preserves the user's intent (a small, defined, per-trade profit) while removing the arbitrary constant. **Recommended as the primary formulation, with $1.00 retained as the absolute floor.**

---

## 14. Final deliverable

### A. Recommended strategy
**IPR — Impulse → Pullback → Resumption, with a Cost-Budget Gate.**
On M5, wait for a structurally-confirmed impulse leg (size ≥ 1.2 ATR, efficiency ≥ 0.50, breaking a prior swing) in the direction of the EMA20/50 regime. Wait for a shallow, slow retracement (20–61.8% of the leg, slower per bar than the impulse). Enter on a stop order above the turn bar's high. Stop just beyond the pullback extreme; target the larger of the $1-net distance and 2.0 × ATR, capped by the next opposing structure. **Refuse the trade unless total cost is ≤ 12% of the total barrier span.** One setup, one trade, then four independent locks before anything similar can fire again.

### B. Exact entry rules
§5.1–5.10. Every condition is numeric and computable from closed-bar data plus the live tick.

### C. Exact exit rules
§8.2 (target/stop construction with the $1-NET calculation) and §8.3 (six-level protective hierarchy).

### D. Risk rules
§10. Fully decoupled from the entry model.

### E. XAUUSD adaptation
No special-casing. The symbol's behaviour enters only through `A`, `S_med`, `M`, and the empirical session profile. Expected outcome: trading confined to London/NY, 2–4 trades/day, target 1.3–2.6 gold points, stop ~1.0, holding time 15–45 min. **Requires a raw-spread account** (§13.2).

### F. BTC adaptation
No special-casing either. Expected: $1 net ≈ 0.5 × M5 ATR (easier than gold); wider spread dispersion handled by the same normalised gates; hard exclusion of the rollover window (crypto swap is punitive); weekend and broker-hours-gap behaviour to be validated as a **separate** OOS segment, since a CFD broker's BTC hours differ from the underlying 24/7 market. Verify `VOLUME_MIN` and contract size — these vary substantially between brokers and 0.01 lot is not universally available.

### G. Symbol-agnostic architecture
Four layers, cleanly separated so any layer can be replaced independently:
1. **Symbol Info Layer** — reads MT5 properties, computes `M`, validates volume, produces the startup feasibility report, refuses unsuitable symbol/volume combinations.
2. **Cost Model Layer** — live `C_money` from spread, measured slippage, actual commission, projected swap.
3. **Signal Layer** — IPR state machine; emits normalised, unitless setups.
4. **Risk & Execution Layer** — gates, sizing validation, order placement, protective exits.
Layers 1–2 and 4 contain no strategy logic. Layer 3 contains no symbol constants.

### H. Backtest protocol
§12.

### I. Failure modes
§13.3 (eleven enumerated) plus: look-ahead in the rolling medians; survivorship in the session profile; broker execution degradation; and over-tuning the pullback ratios.

### J. Parameters

**FIXED LOGIC (never optimised — changing these means designing a different strategy):**
the `M` conversion; the cost formula; the cost-budget gate mechanism; setup lifecycle and SetupID; the four cluster locks; the exit priority hierarchy; the entire risk model; `ER_min = 0.50`; `R_min = 0.20`, `R_max = 0.618`; pullback velocity factor 0.80; setup validity `V = 5` bars; all buffer coefficients (0.10 ATR / 0.15 ATR / 0.05 ATR); ATR period 14; EMA periods 20/50; fractal width 2.

**OPTIMISABLE — exactly four:**

| # | Parameter | Range | Default | Rationale for optimising |
|---|---|---|---|---|
| 1 | `N_imp` — impulse lookback (bars) | 4 / 6 / 8 | 6 | Genuinely instrument- and regime-dependent |
| 2 | `L_min_mult` — impulse size in ATR | 1.0 / 1.2 / 1.5 | 1.2 | Selectivity vs. sample size |
| 3 | `TP_mult` — target in ATR | 1.5 / 2.0 / 2.5 | 2.0 | The dominant expectancy lever |
| 4 | `CostBudget` | 0.10 / 0.12 / 0.15 | 0.12 | Direct control of required edge |

81 combinations — small enough for honest walk-forward validation. **Resisting parameter proliferation is itself a design decision**; every added parameter shrinks the evidence per parameter.

**User-configurable (not optimised):** volume (default 0.01), `TargetNet` (default $1.00), symbol list, `RiskPct`, `MaxDDPct`, session overrides.

### K. Mathematical expectancy

```
E  =  P(win) × AvgNetWin  −  P(loss) × AvgNetLoss

     AvgNetWin  = d_tp − C
     AvgNetLoss = d_sl + C          (both × M for money terms)

Breakeven win rate:      p*    = (d_sl + C) / (d_tp + d_sl)
Driftless random walk:   p_rw  =  d_sl      / (d_tp + d_sl)

  ⇒  REQUIRED EDGE  =  p* − p_rw  =  C / (d_tp + d_sl)
```

**What this means, and why it drove every decision above:**
- Required edge depends **only** on cost relative to total barrier span. Not on lot size, not on the dollar target, not on the indicator set.
- Increasing lot size to hit $1 with a smaller move raises `C/span` and makes things worse. **Micro-lot is correct.**
- The only two levers are **reduce C** (broker selection: 13.8 pp → 6.5 pp) and **increase span** (target sizing: 17.9 pp → 6.5 pp). Between them they span the entire difference between an unworkable and a workable system.
- Recommended geometry (2.40 / 1.00, C = $0.22–0.35): breakeven win rate **36–40%**, payoff **1.5–1.8**, required edge **6.5–10.3 pp**.
- Sanity check on the arithmetic: at a 45% true win rate, `E = 0.45 × $2.05 − 0.55 × $1.35 = +$0.18/trade`. At 4 trades/day ≈ **$0.72/day**, ≈ $180/year at 0.01 lot. Consistent with the Monte Carlo in §13.3, and a realistic upper expectation for this size.

---

## 15. Phase 1 close-out

### 1. Proposed strategy
IPR (Impulse → Pullback → Resumption) on M5 with a Cost-Budget Gate; $1.00 net as a **floor**, actual target `max($1-net, 2.0 × ATR)` capped by structure; single entry per setup; 2–5 trades/day/symbol.

### 2. Why this one
It is the only candidate whose entry geometry maximises barrier span per unit of risk, which is the only quantity that governs profitability once costs are accounted for. Breakout entries (A, F) buy at the leg extreme and need wide stops; VWAP-based models (D) rely on broker tick volume and are not symbol-agnostic; trend-following (C) has no natural stop location. The pullback entry is the only one that places a *close, meaningful* invalidation next to a *far* target.

### 3. Complete rule set
§5 (entry), §7 (filters), §8 (exits), §10 (risk), §J (parameters).

### 4. Risks and weaknesses
§13. In one line: **the edge required is 6–10 percentage points over random, this has not yet been demonstrated, and costs plus broker choice matter more than any refinement of the entry logic.**

### 5. Backtest methodology
§12, with the random-entry control as the decisive test.

### 6. Decisions requiring your approval

| # | Question | Why it matters | My recommendation |
|---|---|---|---|
| 1 | **Broker and account type?** Actual XAUUSD spread and commission, live-measured. | Moves required edge from 6.5 pp to 13.8 pp — the single biggest factor in the project. | Raw-spread/ECN. On a standard 35-point gold account I would advise **not proceeding**. |
| 2 | **Is $1.00 net a hard target or a floor?** | Hard target ⇒ ~15.6 pp edge required (unrealistic). Floor ⇒ ~6.5–10.3 pp (plausible). | **Floor**, with actual target `max($1-net, 2.0 × ATR)`. |
| 3 | **Account size and currency?** | Determines whether the risk caps bind before the strategy caps, and whether `TICK_VALUE` needs currency conversion. | Need the number before finalising §10. |
| 4 | **Accept 2–5 trades/day rather than many?** | The whole design rests on selectivity; high frequency is arithmetically incompatible with the cost structure. | Accept. |
| 5 | **Your BTCUSD contract specs** (contract size, `VOLUME_MIN`, tick value, swap, trading hours). | These vary widely between brokers; 0.01 lot is not universally available. | Provide before Phase 2 BTC work. |
| 6 | **Tick data source for backtesting?** | M1-modelled backtests are invalid here — spread is the dominant variable. | Real tick data with real spread, ≥ 24 months. |
| 7 | **Netting or hedging account? Multi-symbol concurrently?** | Affects position management and the correlation cap. | Hedging, 1 position/symbol, max 2 account-wide. |
| 8 | **Accept that at 0.01 lot the realistic good outcome is ~$100–150/year?** | Sets expectations correctly before effort is invested. | Accept, and treat 0.01 lot as validation before any scaling decision. |

**Stopping here.** No code will be written until these are answered and the design is approved.
