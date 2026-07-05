# @tlh/domain — pure options math & domain models

Framework-free, isomorphic (runs on client and server) so payoff/Greeks are instant in the UI
and authoritative on the API. No I/O, fully unit-tested.

- `options/blackScholes` — price (CE/PE), `impliedVol` (bisection)
- `options/greeks` — Δ Γ Θ(daily) ν(per 1% IV) ρ
- `options/payoff` — leg & portfolio payoff, expiry & T+0 curves, breakevens, max P/L
- `options/pop` — probability of profit / touch, expected return
- `options/margin` — SPAN-style span+exposure estimate for the sim
- `models/` — `Position`, `Strategy`, `OptionLeg`, `MarginModel` with behavior

The existing `options-analyzer/` Expo prototype's engine is the reference for these formulas.
Implemented in **M0**.
