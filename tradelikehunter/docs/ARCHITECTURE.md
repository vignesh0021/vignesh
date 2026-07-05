# Architecture

## 0. Principles & key decisions

| Decision | Choice | Why |
|---|---|---|
| Client | **Responsive web SPA** (React + Vite) that is mobile-first, installable (PWA); native shell via Capacitor later | Matches the required stack (React/Vite/Tailwind); one codebase for desktop + mobile + tablet |
| Backend | **NestJS** (modular DI) with **service + repository** layers over **Prisma** | Enforces the requested modular / service / repository / domain-model architecture; scales |
| Realtime | **WebSocket** (socket.io) with **Redis adapter** for horizontal fan-out | 1M concurrent clients need stateless API nodes + Redis pub/sub |
| Jobs | **BullMQ** on Redis (workers app) | Market ingest, matching, analytics, journal, notifications off the request path |
| Shared logic | **`packages/domain`** — pure TS options math runs **identically on client and server** | Instant client-side payoff/Greeks + authoritative server valuation |
| Contracts | **`packages/contracts`** — Zod schemas generate types + runtime validation for both sides | One source of truth, no FE/BE drift |
| Market data | **Provider abstraction** (`MarketDataProvider`): Fyers (live NSE) · Delta (crypto) · Replay · Synthetic | Works with the user's own broker keys; degrades to replay/synthetic; paper fills use live/last quote + configurable slippage |
| AI (Adjustment Assistant / Coach) | **Deterministic rules engine** first; **Claude API** layer for natural-language explanations, cost-guarded and optional | Suggestions must be reliable & free to run; LLM only narrates |
| Money | **100% simulated.** Virtual wallet + ledger; no real orders ever leave the system | Core promise of the product |

**Non-goals:** real order routing, real funds, tax/PnL statements for filing.

---

## 1. Folder structure (monorepo)

```
tradelikehunter/
├─ apps/
│  ├─ web/                                   # React + Vite + Tailwind SPA
│  │  ├─ src/
│  │  │  ├─ app/                             # router, providers, layouts, error boundaries
│  │  │  │  ├─ router.tsx                    # React Router v6 route tree (lazy per feature)
│  │  │  │  ├─ providers.tsx                 # QueryClient, theme, WS, auth providers
│  │  │  │  └─ layouts/                      # AppShell, AuthLayout, TradeLayout
│  │  │  ├─ features/                        # FEATURE-FIRST — one folder per module
│  │  │  │  ├─ dashboard/
│  │  │  │  │  ├─ components/                # widgets: PnlTile, GreeksSummary, WatchlistCard…
│  │  │  │  │  ├─ hooks/                     # useDashboardQuery, useMarketBreadth…
│  │  │  │  │  ├─ api/                        # dashboard.api.ts (TanStack Query fns)
│  │  │  │  │  └─ DashboardPage.tsx
│  │  │  │  ├─ trade/                        # option chain + order ticket + positions
│  │  │  │  ├─ strategy-builder/             # drag-drop canvas, payoff, POP
│  │  │  │  ├─ strategy-library/
│  │  │  │  ├─ adjustments/                  # Adjustment Assistant
│  │  │  │  ├─ greeks/                       # Greeks Center, what-if, heatmap
│  │  │  │  ├─ option-chain/
│  │  │  │  ├─ analytics/                    # market analytics (OI, PCR, max-pain, gamma walls)
│  │  │  │  ├─ journal/
│  │  │  │  ├─ performance/
│  │  │  │  ├─ learn/
│  │  │  │  ├─ community/
│  │  │  │  ├─ risk/
│  │  │  │  ├─ replay/
│  │  │  │  ├─ coach/                        # AI coach feed
│  │  │  │  └─ auth/
│  │  │  ├─ shared/
│  │  │  │  ├─ ws/                           # socket client, channel hooks (useTicks, useOrderStream)
│  │  │  │  ├─ stores/                       # Zustand slices (market, portfolio-rt, ui, builder, replay)
│  │  │  │  ├─ lib/                          # http client, formatters, query-keys, feature-flags
│  │  │  │  └─ hooks/                        # useMediaQuery, useTheme, useDebounce…
│  │  │  └─ main.tsx
│  │  ├─ index.html, vite.config.ts, tailwind.config.ts
│  ├─ api/                                   # NestJS
│  │  ├─ src/
│  │  │  ├─ modules/                         # one Nest module per domain (mirrors features)
│  │  │  │  ├─ auth/  account/  market/  orders/  positions/
│  │  │  │  ├─ strategies/  adjustments/  greeks/  risk/
│  │  │  │  ├─ journal/  performance/  analytics/
│  │  │  │  ├─ learn/  community/  replay/  coach/  notifications/
│  │  │  │  └─ each: *.controller.ts · *.service.ts · *.repository.ts · dto/ · *.gateway.ts (WS)
│  │  │  ├─ common/                          # guards, interceptors, filters, pipes (Zod), decorators
│  │  │  ├─ infra/                           # prisma, redis, ws-adapter, market-providers, queue
│  │  │  └─ main.ts
│  ├─ workers/                               # BullMQ processors
│  │  └─ src/jobs/  market-ingest/ matching-engine/ greeks-snapshot/ eod-analytics/ journal/ notifications/
├─ packages/
│  ├─ domain/       src/ options/ (blackScholes, greeks, iv, payoff, pop, margin)  models/  index.ts
│  ├─ contracts/    src/ schemas/*.ts (zod)  dto types
│  ├─ ui/           src/ atoms/ molecules/ organisms/ templates/ theme/ tokens.css  (Storybook)
│  ├─ db/           prisma/schema.prisma  migrations/  src/repositories/
│  └─ config/       tsconfig/  eslint/  tailwind-preset.cjs
├─ infra/           docker/ (Dockerfiles, compose)  ci/ (gh actions)  k8s/ (later)
├─ pnpm-workspace.yaml  turbo.json  package.json  tsconfig.base.json
```

**Rules:** features never import each other's internals (only `shared/*`, `packages/*`).
Domain math lives only in `packages/domain`. DB access only via `packages/db` repositories.
DTOs/validation only via `packages/contracts`.

---

## 2. Layered backend architecture

```
HTTP / WS  →  Controller/Gateway  →  Service (use-cases, domain orchestration)
                                        ↓
                            Repository (packages/db)  →  Prisma  →  Postgres
                                        ↓
                            Domain (packages/domain: pure math & rules)
Cross-cutting: Redis (cache, pub/sub, locks), BullMQ (jobs), MarketDataProvider (ports/adapters)
```

- **Controllers/Gateways**: transport only; validate with Zod pipe; no business logic.
- **Services**: use-cases (e.g. `PlaceOrderService`), transaction boundaries, emit domain events.
- **Repositories**: the only place Prisma is touched; return domain models, not Prisma rows.
- **Domain**: framework-free (`Position.netGreeks()`, `Strategy.payoff()`, `MarginModel.span()`).
- **Ports & adapters**: `MarketDataProvider`, `Broker`, `AiExplainer` are interfaces with swappable impls.

---

## 3. The simulation core (what makes it a paper-trading platform)

1. **Market feed** → `MarketDataProvider` publishes normalized ticks (`ltp, bid, ask, oi, iv`) to Redis `market:<token>`.
2. **Order intake** → `OrdersService` validates margin (`MarginModel`), persists `PENDING`, pushes to the matching queue.
3. **Matching engine (worker)** → fills market orders at best quote ± slippage; watches limit/SL/trigger levels against the live tick stream; supports **bracket / OCO / trailing-SL / partial-exit / scale-in-out**.
4. **Fills** → write `executions`, update `positions` (netting) & `accounts` (cash/margin) inside one DB transaction; append `account_ledger`.
5. **Realtime** → emit `order.update`, `position.update`, `greeks.update` over WS (Redis-fanned).
6. **Valuation** → portfolio Greeks & PnL recomputed from `packages/domain` on every tick batch (throttled), snapshotted for the Greeks time-series.

Replay mode swaps the live provider for a **ReplayProvider** that streams a chosen historical
day at a controllable speed into the exact same pipeline — identical code path, deterministic practice.

---

## 4. State management (frontend)

Three tiers, strict boundaries:

| Tier | Tool | Holds | Notes |
|---|---|---|---|
| **Server state** | **TanStack Query** | REST resources: account, positions, orders, chain snapshot, strategies, journal, performance | Cache + retries + optimistic order placement; invalidated/patched by WS events |
| **Realtime/high-freq** | **Zustand** | live ticks map, live position/greek deltas, order-book updates, replay cursor | Never put ticks in Query cache (too churny); components subscribe to narrow selectors |
| **Client/UI** | **Zustand** | theme, layout, active symbol/expiry, modals, builder canvas legs, watchlist focus | Persisted (localStorage) where useful |
| **Forms** | **React Hook Form + Zod** | order ticket, builder legs, journal, auth | Zod schemas shared from `packages/contracts` |

**WS ↔ Query bridge:** a single socket client dispatches events; handlers call
`queryClient.setQueryData` (positions/orders) and update Zustand tick store, keeping one
source of truth. Framer Motion drives transitions (payoff morphs, panel slides, number rolls).

Zustand slices: `useMarketStore` (subscribe/unsubscribe tokens, `ticks[token]`),
`usePortfolioLiveStore` (positions, orders, portfolioGreeks), `useUiStore`,
`useBuilderStore` (legs, selected expiry, presets), `useReplayStore`.

---

## 5. Component tree (atomic design)

`packages/ui` — reusable, themed, Storybook-documented:

```
atoms      Button Icon Input Select Toggle Badge Tag Chip Skeleton Spinner Tooltip
           Money PnlText GreekPill Sparkline ProgressMeter Avatar KBD
molecules  StatTile FormField SegmentedControl RangeSlider DatePicker SearchBox
           OptionChainCell OrderTicketRow GreekBadgeRow PayoffLegend Toast StepIndicator
organisms  DataTable OptionChainTable PayoffChart CandleChart(TradingView-lite) PositionsTable
           OrdersTable StrategyCanvas AdjustmentCard GreeksHeatmap EquityCurve CalendarHeatmap
           Watchlist NewsFeed LeaderboardTable RiskMeter
templates  AppShell (sidebar+topbar+content) TradeLayout(3-pane) DashboardGrid AuthLayout MobileTabsLayout
```

Example — **Dashboard** feature tree:

```
DashboardPage
 └ DashboardGrid (template)
    ├ PnlTile ×4            (Today P&L, Portfolio Value, Margin Used, Buying Power)
    ├ WinRateTile · GreeksSummaryCard (Δ Γ Θ ν)
    ├ PositionsTable (organism) · OpenOrdersTable
    ├ MiniChart (CandleChart) · MarketBreadthCard
    ├ WatchlistCard (Watchlist organism)
    └ NewsFeed
```

Example — **Trade** feature (the core screen):

```
TradeLayout (3-pane, collapses to tabs on mobile)
 ├ left:   SymbolBar → CandleChart + timeframe/indicator controls
 ├ center: OptionChainTable  (OI, ΔOI, Vol, IV, IV-Rank, bid/ask, Greeks, Max-Pain marker)
 └ right:  OrderTicket (RHF) + PositionsTable + OrdersTable + PayoffChart (mini)
```

---

## 6. User flows (key paths)

**Onboarding →** sign up → verify → **virtual account funded** (₹10,00,000 default) → guided tour → land on Dashboard.

**Place a paper trade →** pick symbol/expiry → Option Chain → click a strike (buy/sell) → Order Ticket
(qty in lots, type MARKET/LIMIT/SL, product) → **margin preview** → Confirm → optimistic `PENDING`
→ WS `order.update` FILLED → position appears → PnL/Greeks update live.

**Build a strategy →** Strategy Builder → drag legs (or load a Library template) → live Payoff + POP +
breakevens + net Greeks → "Simulate" places all legs atomically as one trade group.

**Manage & adjust →** open trade → **Adjustment Assistant** continuously scores it → shows ranked
suggestions (Roll ↑/↓, convert to Iron Fly/Condor, add hedge, take profit, exit) with Δ/Θ/margin
impact + POP-before/after + risk comparison + **why** → one-tap "Apply" simulates the adjustment legs.

**Review →** on close, **Trade Journal** auto-captures entry/exit/screenshot; user adds emotion,
confidence, mistakes, lessons, rating → feeds **Performance Analytics** (equity curve, win rate,
profit factor, expectancy, drawdown) and the **AI Coach** feedback feed.

**Practice with Replay →** pick a past expiry day → Replay Engine streams it at chosen speed →
trade it live as if it were happening → compare outcomes.

Full ASCII wireframes for each screen: [`WIREFRAMES.md`](WIREFRAMES.md).
