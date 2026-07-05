# Development Roadmap & Milestones

Reality check: 16 production modules for 1M users is a **program**, not one sprint. We build in
vertical slices — each milestone is shippable, tested, and demo-able before the next. Modules 1–16
map to phases below. "Mobile UX (16)" and "Testing/CI-CD" are **cross-cutting from M0**.

Legend for each milestone: **Goal · Deliverables · Definition of Done (DoD)**.

---

### M0 — Foundation  *(enables everything)*
- **Goal:** a running skeleton: monorepo, design system, auth, DB, realtime, virtual account, CI/CD.
- **Deliverables:** pnpm+Turbo monorepo · `packages/domain` (Black-Scholes/Greeks/payoff/POP/margin, unit-tested) · `packages/ui` design tokens + core atoms + Storybook · `packages/contracts` (Zod) · Prisma schema + migrations + seed (underlyings, expiries) · NestJS API with auth (JWT+refresh), account, health · socket.io + Redis adapter · Docker Compose (pg, redis, api, web) · GitHub Actions (lint/typecheck/test/build) · web AppShell + theme switch + bottom nav.
- **DoD:** `docker compose up` boots the stack; sign-up → funded ₹10L virtual account → themed dashboard shell; domain math 100% unit-tested; CI green.

### M1 — Market Data + Option Chain + Paper-Trading core  *(modules 7, 2)*
- **Goal:** see live/replayed chain and place simulated orders that fill and net into positions.
- **Deliverables:** `MarketDataProvider` (Fyers live + Synthetic + Replay) → Redis ticks → `/market` WS · Option Chain organism (OI/ΔOI/Vol/IV/bid-ask/Greeks/max-pain) · Order Ticket · Orders service + **matching-engine worker** (MARKET/LIMIT/SL/SL-M) · positions/executions/ledger with transactional fills · margin simulation.
- **DoD:** place market & SL orders on NIFTY chain; fills stream over WS; positions & wallet update transactionally; order + execution logs correct.

### M2 — Dashboard + Greeks Center  *(modules 1, 6)*
- **Deliverables:** dashboard tiles (P&L, portfolio value, margin, buying power, win-rate) · live portfolio Greeks (Δ Γ Θ ν) time-series · Greek simulator / what-if · Greek heatmap · theta calendar.
- **DoD:** dashboard updates live from WS; what-if recomputes portfolio Greeks client-side instantly and matches server.

### M3 — Strategy Builder + Library  *(modules 3, 4)*
- **Deliverables:** drag-drop canvas (unlimited legs) · live payoff/POP/breakevens/expected-return/net-Greeks (from `packages/domain`) · "Simulate" executes legs atomically · Strategy Library (100+ templates in DB) with description/risk/reward/ideal-IV/ideal-market/adjustment-rules/example · one-tap materialize around ATM.
- **DoD:** build an Iron Condor, see correct payoff/POP, simulate it as one trade; load 5+ library strategies.

### M4 — Adjustment Assistant + Risk Engine + advanced orders  *(modules 5, 13, + 2 cont.)*
- **Deliverables:** rules engine scoring every open trade → ranked suggestions with Δ/Θ/margin impact + POP-before/after + risk comparison + why · one-tap apply · bracket/OCO/trailing-SL/partial-exit/scale-in-out in the matching engine · Risk engine (margin monitor, limits, risk meter, exposure, **Monte-Carlo & scenario** stress tests, daily/weekly loss lock).
- **DoD:** an open strangle produces correct ranked adjustments; applying one simulates the legs; breaching a daily-loss limit locks new risk.

### M5 — Trade Journal + Performance Analytics  *(modules 9, 10)*
- **Deliverables:** auto-journal on close (entry/exit/screenshot) + emotion/confidence/mistakes/lessons/rating/replay link · performance: equity curve, win-rate, profit-factor, Sharpe/Sortino, expectancy, max-DD, avg/large win-loss, calendar heatmap (daily/weekly/monthly/yearly).
- **DoD:** closing trades populates journal & performance; metrics verified against a fixture ledger.

### M6 — Market Analytics  *(module 8)*
- **Deliverables:** India VIX, PCR, OI build-up (long/short build-up, short-covering, long-unwinding), max-pain, **gamma walls / GEX**, FII/DII, sector rotation, market breadth, expiry analysis — computed by intraday/EOD workers into `market_analytics`.
- **DoD:** analytics dashboard renders live/EOD values; gamma walls overlay on the chain.

### M7 — Learning Center + AI Coach  *(modules 11, 15)*
- **Deliverables:** interactive MDX lessons (basics → Greeks → adjustments → risk) · quizzes + progress + certificates · AI Coach feed (rules + optional Claude narration) giving per-trade feedback ("Iron Condor too narrow", "Δ risk high", "exit before IV crush") with reasoning.
- **DoD:** complete a lesson+quiz → certificate; coach posts contextual feedback on live trades.

### M8 — Community + Replay + Scale hardening  *(modules 12, 14)*
- **Deliverables:** shared strategies, likes/comments, leaderboard (Redis ZSET), paper-trading competitions · **Replay Engine** (pick a past day, speed/pause/seek, trade it live through the same pipeline) · load testing + Redis fan-out tuning + horizontal-scale validation toward 1M.
- **DoD:** replay a historical expiry and trade it; leaderboard ranks; k6 load test meets latency SLOs.

---

## Module → phase map
| Module | Phase |
|---|---|
| 2 Paper-Trading Engine · 7 Option Chain | **M1** |
| 1 Dashboard · 6 Greeks Center | **M2** |
| 3 Strategy Builder · 4 Strategy Library | **M3** |
| 5 Adjustment Assistant · 13 Risk Engine | **M4** |
| 9 Journal · 10 Performance | **M5** |
| 8 Market Analytics | **M6** |
| 11 Learning · 15 AI Coach | **M7** |
| 12 Community · 14 Replay | **M8** |
| 16 Mobile UX · Testing · CI/CD | **M0 → cross-cutting** |

## Engineering standards (every milestone)
- Unit tests for all `packages/domain` math + services; Playwright e2e for critical flows; contract tests on API.
- No feature merges without: types (no `any`), Zod validation, error states, loading skeletons, empty states, a11y, dark+light.
- Observability: pino structured logs, OpenTelemetry traces, Prometheus metrics, Sentry.
- Performance budgets: option-chain render < 16ms/frame; WS→UI < 100ms; API p95 < 150ms.
