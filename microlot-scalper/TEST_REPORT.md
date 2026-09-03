# TEST_REPORT.md

## What was and was not verified — read this first

**The MQL5 project has NOT been compiled by MetaEditor.** MetaEditor is Windows-only and
is not present in this environment; there is no MQL5 compiler for Linux. Phase 2 §37 says
not to claim success merely because the EA compiles — here the stronger caveat applies:
**you must compile it in MetaEditor yourself before running anything.** I expect
MetaEditor to surface at most minor issues (the pure layer is machine-verified and the
adapter layer is symbol-checked), but I have not proven that, and I am not claiming it.

What I did instead, so the strategy rules are genuinely verified rather than merely
written:

| Layer | Files | How verified |
|---|---|---|
| **Strategy logic** (all trading rules) | 15 headers, ~1,900 lines | Compiled as C++ by g++ 13.3 with `-Wall -Wextra` under an MQL5 shim, and executed against synthetic market data — **165 assertions, all passing** |
| **MT5 adapters + EA** (terminal API) | 6 files, ~1,600 lines | Static analysis: symbol resolution, include graph, bracket balance, member/method existence, enum coverage — **0 errors** |

The pure headers are written in the MQL5 ∩ C++ subset (no `input`, no dynamic arrays, no
array-reference parameters, no templates) precisely so this dual compilation is sound.
They contain no `#ifdef` for the test build — the shim is force-included by g++ only.

Reproduce everything with:

```bash
cd microlot-scalper/tests && ./run_tests.sh
```

---

## Required test scenarios (Phase 2 §37)

| # | Scenario | Result | Where |
|---|---|---|---|
| 1 | Compile test | **Partial** — pure layer compiles clean under g++; MQL5 compile pending on your machine | `compile_check.cpp` |
| 2 | Static logic review | Pass — 0 errors | `static_check.py` |
| 3 | Strategy-state test | Pass — FORMING → ARMED → TRIGGERED/INVALIDATED/EXPIRED, one-way | `TEST 3+15` |
| 4 | Duplicate-entry test | Pass — same structure → same id; consumed id rejected on 5 re-evaluations | `TEST 4+5` |
| 5 | Restart/recovery test | Pass — id survives the signed-64-bit round trip; ring bounded and evicts in order | `TEST 4+5` |
| 6 | Invalid-volume test | Pass — 0.001, 500, and 0.01-on-a-0.10-step all refused, never resized | `TEST 6` |
| 7 | High-spread test | Pass — ATR ceiling, hourly-median ceiling, and fail-closed on no reference | `TEST 7` |
| 8 | Low-volatility test | Pass — A/A_ref < 0.60 rejected | `TEST 8+9` |
| 9 | High-volatility / shock test | Pass — A/A_ref > 2.50 rejected; >3×ATR bar detected; 6-bar latch holds | `TEST 8+9` |
| 10 | Target-cost infeasibility | Pass — budget gate, unreachable TargetNet, and the ATR feasibility ceiling | `TEST 10` |
| 11 | Daily-loss-limit test | Pass — `min(3 × avg loss, 2% equity)`, both terms exercised | `TEST 11+12+13` |
| 12 | Consecutive-loss test | Pass — 3 losses halt the day; a win resets the streak; new day clears | `TEST 11+12+13` |
| 13 | Cooldown test | Pass — 20 / 40 / 6 bars, and the escalation on a second loss | `TEST 11+12+13` |
| 14 | Setup-expiry test | Pass — valid for 4 bars, expires on the 5th, cannot re-arm | `TEST 14` |
| 15 | Setup-invalidation test | Pass — regime flip, opposing BOS, and price through `pb_low − 0.05×ATR` | `TEST 3+15` |
| 16 | Same-direction cluster test | Pass — all four locks individually, plus directional independence | `TEST 16` |
| 17 | Long/short symmetry test | Pass — mirrored data yields identical leg size, depth, ER, `d_tp`, `d_sl` | `TEST 17` |

Additional coverage beyond the required list: the money model on three instrument shapes
(XAUUSD / BTCUSD / EURUSD), the Phase 1 expectancy identity, ATR/EMA/ER/fractal/median
units, the seven-level exit priority ordering, break-even semantics, stop-geometry guards,
and per-reason rejection specificity.

**Total: 165 assertions, 0 failures.**

---

## Mutation testing — is the suite load-bearing?

A passing suite proves nothing if its assertions are tautological. I mutated ten FIXED
strategy constants and confirmed each is caught:

| Mutation | Caught |
|---|---|
| `IPR_PULLBACK_MAX` 0.618 → 0.95 | yes (2 assertions) |
| `IPR_MAXHOLD_BARS` 12 → 99 | yes (2) |
| `IPR_COOLDOWN_LOSS2` 40 → 20 | yes (2) |
| `IPR_ER_MIN` 0.50 → 0.05 | yes (3) |
| `IPR_SL_MAX_ATR` 1.20 → 9.00 | yes (2) |
| `IPR_MAX_CONSEC_LOSSES` 3 → 99 | yes (3) |
| `IPR_FRACTAL_WIDTH` 2 → 3 | yes (1) |
| `IPR_SETUP_VALID_BARS` 5 → 20 | yes (2) |
| `IPR_MOMFAIL_CLOSES` 2 → 9 | yes (2) |
| `IPR_CLUSTER_BARS` 12 → 0 | yes (2) |

The first run of this exercise caught **four survivors** — assertions written against the
constant under test rather than against its literal Phase 1 value. Those were rewritten to
compare against literals, and a `FIXED CONSTANTS` block was added asserting every value in
Phase 2 §29. That block is the guard against silent strategy drift.

The static checker was self-tested the same way (a bad method call, a dropped enum case
and an unbalanced brace were each injected and caught).

---

## Two defects the tests found in the implementation

Both are documented in `IMPLEMENTATION_NOTES.md` §1 and §2 and **need your sign-off.**

1. **The structural cap vetoed essentially every valid setup.** Reading "next opposing
   swing" as measured from the entry meant the impulse leg's own high — which sits just
   above a long entry by construction — capped the target below the $1 floor almost every
   time. Left alone this would have silently disabled the strategy. The search origin now
   starts beyond the leg extreme; the distance is still measured from the entry.

2. **An economically impossible target could pass every gate.** With no opposing swing to
   cap it, `TargetNet = 500` on XAUUSD produced a valid setup with a 500-dollar target —
   the cost-budget gate *improves* as the target grows, so nothing objected. The startup
   feasibility ceiling (required move ≤ 1.5 × ATR) is now enforced per setup.

---

## What these tests do NOT establish

- **Nothing about profitability.** No backtest has been run. No claim is made, in either
  direction, about whether this strategy makes money. Phase 1 §13 put the required edge at
  6–10 percentage points over a driftless random walk and stated plainly that this has not
  been demonstrated. That remains true.
- **Nothing about MQL5 compilation.** See the caveat at the top.
- **Nothing about live execution.** Order placement, fills, retcodes, requotes and
  partial-fill behaviour are exercised by static review only; no broker was contacted.
- **Nothing about real market structure.** Every test drives synthetic bars built to
  isolate one rule. They prove the rules behave as specified; they say nothing about how
  often those rules fire on real XAUUSD data, or with what result.
- **Slippage and commission assumptions are unvalidated.** Both are modelled. Re-fit them
  from your own fill data before trusting any backtest number.

## Suggested first checks on your machine

1. Compile in MetaEditor; fix anything it reports (please send me the messages).
2. Run in the Strategy Tester on XAUUSD M5, **every tick based on real ticks**, one month,
   `LogLevel = 4`. Expect *no trades at all* until the hour profile has formed.
3. Read the `FEASIBILITY` block in the log first — it tells you whether $1 net is
   reachable on your broker's spread at all, and that determines whether anything else is
   worth doing.
4. Count the `REJECT:` reasons over a week. A healthy distribution is dominated by
   `NO_IMPULSE` / `PULLBACK_*`; heavy `SPREAD_TOO_HIGH` or `TARGET_COST_INFEASIBLE` means
   your account's costs are too high for this design, which is the Phase 1 §13.2 finding.
