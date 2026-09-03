# IMPLEMENTATION_NOTES.md

Ambiguities found while translating the Phase 1 specification into MQL5, and the
interpretation chosen for each. Per Phase 2 §38, no new trading rule was invented;
where the spec was silent, the safest deterministic reading consistent with Phase 1
intent was taken and recorded here.

**Two items are MATERIAL and need your explicit sign-off — §1 and §2 below.**
The rest are mechanical and need no decision.

---

## 1. MATERIAL — the structural cap searches from beyond the leg extreme

**Spec:** Phase 1 §8.2 — `d_struct = 0.90 × distance to next opposing fractal swing level`,
and "if the required target cannot fit inside the available structure, reject the trade".

**Ambiguity:** measured from where? The literal reading is "the next opposing swing above
the entry price".

**Why the literal reading is wrong here.** IPR enters on a pullback *resumption*. For a
long, the impulse leg's own high sits just above the entry by construction — typically
0.5–1.0 ATR. Under the literal reading that leg high is the "next opposing swing", so
`d_struct` is tiny and `d_struct < d_req` almost always. I verified this while building
test fixtures: **essentially every valid setup was vetoed.** That would not be a
conservative implementation — it would silently disable the strategy, which §38 forbids
("A strategy-changing implementation is NOT acceptable").

**Chosen interpretation.** The search *origin* is `max(entry, leg extreme)` for a long
(`min` for a short). The *distance* is still measured from the entry. Rationale: the leg
high is the level the trade exists to break, not resistance to it — the impulse already
took out everything up to there. Real opposing structure is the next swing beyond the leg.

**Effect:** when the impulse has broken to new local highs there is often no opposing
swing at all, so the cap does not bind and `d_tp = max(d_req, TP_mult × ATR)`.
Implemented in `TargetEngine.mqh`; see the block comment there.

**Decision needed:** confirm this reading, or tell me to measure from the entry (and
accept that the EA will take very few trades).

---

## 2. MATERIAL — feasibility is enforced per setup, not only at startup

**Spec:** Phase 2 §5 requires the feasibility test "at EA startup and whenever relevant
market conditions change", and §17 says to reject when the target cannot fit.

**Gap found by testing.** With no opposing swing to cap the target, nothing rejected an
economically impossible target. A test with `TargetNet = 500` on XAUUSD produced a valid
setup with a 500-dollar target: every gate passed (the cost budget *improves* as the
target grows), and the trade would simply be closed by the max-hold rule every time.

**Chosen interpretation.** The startup ceiling — required move ≤ `1.5 × ATR` — is applied
to **every setup**, not just at initialisation. `IPR_FEASIBILITY_MAX_ATR` was promoted
from the MT5 adapter to a fixed strategy constant in `Types.mqh`.

**Consequence worth knowing:** on XAUUSD at 0.01 lot this constant is what enforces the
Phase 1 finding that $1 net is unreachable in thin sessions. With a 10-point spread,
`d_req ≈ $1.175`; at an M5 ATR of 1.20 that is 0.98 ATR (fine), but at an ATR of 0.30
(Asia) it is 3.9 ATR and the EA refuses to trade. That is the intended behaviour.

**Decision needed:** confirm 1.5 × ATR is the right ceiling.

---

## 3. Pending stop orders vs "gates must hold at trigger time"

Phase 1 §5.6 specifies a buy-stop; §5.7 rule 6 requires the gates to hold *at the moment
the trigger fires*. These conflict: a resting stop order fills without consulting the EA.

**Resolution:** the order is placed at arm time, and the setup is continuously
re-validated. If any gate fails, the pending order is deleted before it can fill. Split
by cost so the tick path stays cheap:

- **every tick** — live spread vs ATR, spread vs hourly median, rollover/weekend proximity
- **every closed bar** — full gate set, structural invalidation, and a re-priced cost budget

This is the closest deterministic equivalent to gate-at-fill. It cannot cover a gate that
fails between the last tick and the fill; a market-order-on-touch design would, at the
cost of the slippage the spec's buy-stop avoids.

## 4. No opposing swing within the lookback

The structural cap does not bind (the move is unobstructed). Phase 1 §8.2 gate 1 is
vacuously satisfied. Lookback is 120 bars.

## 5. ATR and EMA are computed in-EA, not via `iATR` / `iMA`

Indicator handles depend on how much history the terminal has loaded, so a live value and
a tester value can differ for the same bar. Computing from our own bar stream makes every
number reproducible in both, removes handle-warmup races, and lets the g++ suite exercise
the exact production code. State is rebuilt by replaying history on restart, so a
restarted EA computes the same values as one running for days.

## 6. Hour-profile references need 5 completed sessions; gates fail closed

Phase 1 §5.1 specifies medians over 20 trailing sessions but not what to do before 20
exist. `IPR_PROFILE_MIN_OBS = 5`; below that the volatility, spread and session gates
return `NO_DATA` and no trade is taken. Failing closed is the conservative reading — the
EA never trades against an unformed reference. A fresh chart therefore stands down until
roughly five sessions of M5 history have been replayed (warmup loads ~20 sessions, so in
practice this is satisfied immediately if history is available).

## 7. Stale pending orders are deleted on restart

An order left by a previous session belongs to a setup whose invalidation state we can no
longer reconstruct. It is deleted and its setup marked consumed, rather than left to fire
unvetted. Open *positions* are adopted (see §8).

## 8. Adopted positions rebuild their plan from the broker's SL/TP

If a position exists with our magic but no matching EA state, `d_tp`/`d_sl` are
reconstructed from the live SL/TP, and `barsHeld` from the clock (`elapsed / 300`) rather
than a counter that may have been lost — so the max-hold limit survives a restart.

## 9. Slippage model

Phase 1 §12.5 requires slippage to be *measured*, which cannot be done before any trades
exist. Modelled as a fraction of the live spread so it is symbol-agnostic and widens
exactly when execution degrades: `slip = SlipEstSpreadMult × spread × 3`, i.e. 0.25 spread
on entry plus 0.50 on exit at the default, reflecting Phase 1 §13.3 note 3 (stop exits slip
harder than entries). Actual fills are compared against this estimate and five fills
slipping >2× halt trading. **Re-fit `SlipEstSpreadMult` from your own fill data before
drawing conclusions from any backtest.**

## 10. Commission is measured when the input is zero

§4 forbids assuming commission is zero. If `InpCommissionPerLot = 0`, the EA logs a
prominent warning and then learns the real per-lot round-turn figure from closed deals
(`DEAL_COMMISSION`), blending 70/30 so one odd fill cannot swing the model. Set the input
explicitly if you know it — the first trades otherwise run on an understated cost model.

## 11. Swap is charged as zero

No position can reach rollover: new entries are blocked within
`rolloverGuard + 12 bars (60 min)` of it, and any open position is force-flatted inside the
guard. The parameter exists in `IprBuildCosts` so this can be revisited if the force-flat
rule is ever relaxed.

## 12. SetupID is clamped to 63 bits

Persisted as text and reloaded with `StringToInteger`, which parses *signed* 64-bit. A
value above `LONG_MAX` would not survive the round trip, and a consumed id that fails to
reload is a duplicate trade waiting to happen. 63 bits leaves collision probability
negligible. Covered by a test.

## 13. A rejected order retires the setup

If `OrderSend` fails, the setup is consumed rather than retried on the next tick — a retry
would be an unvetted second entry attempt from the same structure. The failure is counted
toward the 3-failure execution halt.

## 14. Cluster locks: four tests, not five

Phase 2 §16 lists five conditions; Phase 1 §5.10 lists four. "Fresh structure" and
"structure separation ≥ 0.5 ATR" are the same test (a new leg extreme at least 0.5 ATR
beyond the last entered one), so four are implemented, matching Phase 1.

## 15. The consecutive-loss streak persists across the date boundary

`OnNewDay` resets trade count, realised P&L and the day-halt, but not the streak: a streak
is a property of recent behaviour, not of the calendar. A new day therefore clears a
3-loss halt — otherwise the EA could never resume.

## 16. Correlation groups

§25 requires correlation control but does not define groups. Implemented as a configurable
string, `"XAU,XAG;BTC,ETH"`, matched as a substring against symbol names so broker suffixes
(`XAUUSD.raw`, `XAUUSD_i`) still match. At startup the EA finds the group its own symbol
belongs to; a new entry is refused while any other position with the same magic sits on a
symbol from that group. Requires the EA to be running with the same magic on both charts.

## 17. Session filter is derived, not hardcoded

Phase 1 §7.4 prefers an empirical per-hour `median(spread/ATR)` profile over session
constants. Implemented: an hour is tradeable when its median spread/ATR is at or below the
same 0.15 ceiling the live gate uses. This discovers London/NY on gold and the liquid hours
on BTC with no session constants. Hard exclusions (rollover, Friday close) are applied
separately from the clock, with the Friday session end read from `SYMBOL_SESSION_TRADE`
rather than assumed.

## 18. `IprBars` and the hour profile are public members

MQL5 cannot take a pointer to a struct (`GetPointer` works on classes only) and cannot
return a reference, so encapsulating them behind accessors would mean copying ~26KB per
bar. They are public members passed by reference into the pure functions.

## 19. Fill and close detection is by polling, not `OnTradeTransaction`

Polling compares the world against our record on every tick, so a missed or out-of-order
trade event cannot leave the two permanently out of step — which also makes restart
recovery and the tester behave identically. `OnTradeTransaction` is not used.
