# API Design

Base: `/api/v1`. JSON. Auth via short-lived **JWT access token** (Authorization: Bearer) +
**httpOnly refresh cookie**. Every request/response validated by **Zod schemas from
`packages/contracts`** (shared with the client). Errors: `{ error: { code, message, details? } }`,
RFC-style status codes. Rate-limited per user via Redis. Idempotency-Key header on order writes.

## REST endpoints

### Auth & account
```
POST   /auth/register           {email,password,displayName}         → {user, tokens}
POST   /auth/login              {email,password}                      → {user, tokens}
POST   /auth/refresh            (cookie)                              → {accessToken}
POST   /auth/logout
GET    /auth/me                                                        → {user, settings}
GET    /account                                                        → {cash,marginUsed,buyingPower,realizedPnl}
GET    /account/ledger?cursor=                                         → paginated
POST   /account/reset           {startingCapital?}                    → wipes positions, refunds virtual capital
PUT    /account/risk-limits     {maxLossDay,…}
```

### Market data & option chain (module 7, 8)
```
GET /market/underlyings                                → [{symbol,lotSize,…}]
GET /market/:symbol/expiries                           → [{date,kind}]
GET /market/:symbol/quote                              → {ltp, futLtp, change, ivRank}
GET /market/:symbol/chain?expiry=YYYY-MM-DD            → rows[{strike, ce:{ltp,oi,oiChg,vol,iv,bid,ask,delta,gamma,theta,vega}, pe:{…}}], meta{maxPain, pcr, atmIv}
GET /market/:symbol/analytics                          → {indiaVix, pcr, maxPain, oiBuildup, gammaWalls, fiiDii, breadth}
GET /market/breadth                                    → {advDec, sectors[]}
GET /market/news?symbol=                               → [{ts,headline,source,url}]
CRUD /watchlists  /watchlists/:id/items
```

### Orders & positions (module 2)
```
POST   /orders                 OrderInput (MARKET|LIMIT|SL|SL_M, lots, product, tif)  → {order}
POST   /orders/bracket         {entry, target, stopLoss, trailAmount?}                → {group}
GET    /orders?status=&day=                                                            → [orders]
PATCH  /orders/:id             {price?, triggerPrice?, lots?}   (modify)
DELETE /orders/:id             (cancel)
GET    /positions?status=open                                                          → [positions w/ liveGreeks]
POST   /positions/:id/close                                                            → market-exit
POST   /positions/:id/exit-partial   {lots}
POST   /positions/:id/scale          {lots, side}          -- scale in / out
```

### Strategy builder & library (module 3, 4)
```
GET  /strategies/library?view=&category=&iv=                    → [templateCards]   (100+)
GET  /strategies/library/:slug                                  → full template + adjustment rules + example
POST /strategies                 {underlying,expiry,legs[]}     → {userStrategy}    (build / draft)
POST /strategies/from-template   {slug, underlying, expiry, atm}→ {userStrategy}    (materialize)
GET  /strategies/:id                                            → strategy + legs + live valuation
POST /strategies/:id/execute                                   → simulates all legs atomically (one trade group)
GET  /strategies/:id/payoff?spots=&t=&iv=                       → {expiryCurve[], t0Curve[], breakevens[], maxProfit, maxLoss}
GET  /strategies/:id/metrics                                    → {pop, expectedReturn, rewardRisk, netGreeks}
```
> Payoff/POP/Greeks also compute **client-side instantly** via `packages/domain`; the server
> endpoint is the authority and powers shareable links.

### Adjustments & AI coach (module 5, 15)
```
GET  /strategies/:id/adjustments                → ranked suggestions[{kind,rationale,deltaImpact,thetaImpact,marginImpact,popBefore,popAfter,riskBefore,riskAfter,legs}]
POST /adjustments/:id/apply                     → simulates the adjustment legs
POST /adjustments/:id/dismiss
GET  /coach/feed?tradeId=                        → AI coach messages (rules + optional LLM narration)
```

### Greeks, risk, journal, performance (6, 13, 9, 10)
```
GET  /portfolio/greeks                           → {delta,gamma,theta,vega,rho} + per-position breakdown
POST /portfolio/greeks/what-if   {spot?,iv?,t?}  → recomputed portfolio Greeks/PnL (simulator)
GET  /risk/summary                               → {marginUsed,exposure,maxLoss,var95,health}
POST /risk/stress-test           {kind,params}   → MonteCarlo/Scenario result
CRUD /journal   (auto-created on trade close; user enriches)
GET  /performance?range=1M|3M|1Y|ALL             → {equityCurve[], winRate, profitFactor, expectancy, sharpe, sortino, maxDrawdown, avgWin, avgLoss}
GET  /performance/calendar?year=                 → daily pnl heatmap
```

### Learn, community, replay (11, 12, 14)
```
GET  /courses  /lessons/:slug   POST /lessons/:slug/complete
GET  /quizzes/:id   POST /quizzes/:id/submit  → {score, passed, certificateId?}
GET  /community/strategies  POST /community/strategies  (share)   likes/comments
GET  /leaderboard?window=DAY|WEEK|ALL            → Redis ZSET ranks
GET/POST /competitions  /competitions/:id/join
POST /replay/sessions  {date,symbol}   GET /replay/sessions/:id   POST /replay/sessions/:id/control {play|pause|seek|speed}
```

## WebSocket (socket.io, Redis-adapter fan-out)

Client connects with the access token; joins rooms on demand.

```
namespace /market
  → subscribe   { tokens: string[] }        // option/future/index tokens
  ← tick        { token, ltp, bid, ask, oi, oiChg, iv, volume, ts }
  ← greeks      { token, delta, gamma, theta, vega }        // for subscribed contracts

namespace /account   (auto-joined per authenticated user)
  ← order.update      { order }
  ← position.update   { position }
  ← greeks.update     { portfolioGreeks }
  ← ledger.update     { balanceAfter, entry }
  ← risk.alert        { health, breachedLimit? }
  ← coach.message     { severity, message }
  ← notification      { … }

namespace /replay
  → control    { sessionId, action }
  ← replay.tick { …same shape as /market tick, server-driven playback }
```

**Scale:** API nodes are stateless; socket.io uses the **Redis adapter** so any node can emit
to a user's room. Market ingest workers publish once to Redis; a fan-out service broadcasts to
subscribed rooms. Backpressure via throttled tick batching (e.g. 4–10 Hz per client).
