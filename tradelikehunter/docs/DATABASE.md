# Database Schema (PostgreSQL + Prisma)

Conventions: `uuid` PKs, `created_at/updated_at` on every table, soft-delete where noted,
money as `numeric(18,2)` (INR) / `numeric(18,4)` (prices), enums in Postgres. High-volume,
time-series tables are **partitioned by day** and pruned by retention jobs. Live ticks are
**not** stored per-row — they live in Redis; only periodic snapshots/candles persist.

## Domains & tables

### Identity & account
```
users(id, email ⋈uniq, phone, password_hash, display_name, avatar_url,
      role[USER|ADMIN], email_verified, created_at)
refresh_tokens(id, user_id→users, token_hash, user_agent, expires_at, revoked_at)
user_settings(user_id→users PK, theme[dark|light|system], prefs jsonb)

accounts(id, user_id→users, name, base_currency='INR',
         cash numeric(18,2), margin_used numeric(18,2), realized_pnl numeric(18,2),
         starting_capital numeric(18,2), is_active)            -- the virtual wallet
account_ledger(id, account_id→accounts, ts, type[FUND|FEE|REALIZED_PNL|ADJUST|RESET],
               amount, ref_type, ref_id, balance_after)         -- audit of every ₹ move
risk_limits(account_id→accounts PK, max_loss_day, max_loss_week, max_positions,
            max_margin_pct, max_lots_per_order, daily_locked bool)
```

### Instruments & market
```
underlyings(id, symbol ⋈uniq[NIFTY|BANKNIFTY|FINNIFTY|<stock>], name, exchange[NSE|BSE],
            kind[INDEX|STOCK], lot_size, tick_size, segment)
expiries(id, underlying_id→underlyings, expiry_date, kind[WEEKLY|MONTHLY], ⋈uniq(underlying,expiry))
option_contracts(id, underlying_id, expiry_id, strike numeric(18,2), opt_type[CE|PE],
                 exchange_token ⋈uniq, lot_size, ⋈uniq(underlying,expiry,strike,opt_type))
futures_contracts(id, underlying_id, expiry_id, exchange_token ⋈uniq, lot_size)

candles(instrument_token, tf[1m|5m|15m|1d], ts, o,h,l,c, volume, oi)   -- PARTITION BY RANGE(ts)
        PK(instrument_token, tf, ts)
option_snapshots(id, contract_id→option_contracts, ts, ltp, bid, ask, iv,
                 oi, oi_change, volume, delta, gamma, theta, vega)      -- PARTITION BY RANGE(ts), day
watchlists(id, user_id, name, sort)
watchlist_items(id, watchlist_id, instrument_kind, instrument_ref, sort)
```

### Trading (the simulation)
```
orders(id, account_id→accounts, instrument_kind[OPTION|FUTURE], instrument_ref,
       side[BUY|SELL], product[NRML|MIS], type[MARKET|LIMIT|SL|SL_M],
       qty_lots int, price, trigger_price, tif[DAY|IOC],
       status[PENDING|OPEN|PARTIAL|FILLED|CANCELLED|REJECTED|TRIGGER_PENDING],
       filled_lots int, avg_fill_price, reject_reason,
       parent_order_id→orders, group_id, trail_amount, placed_at, updated_at)
       idx(account_id,status), idx(group_id)
executions(id, order_id→orders, ts, lots, price, fees, slippage)        -- fills
positions(id, account_id, instrument_kind, instrument_ref, net_lots int,
          avg_price, realized_pnl, status[OPEN|CLOSED], opened_at, closed_at,
          strategy_id→user_strategies, mark_price, unrealized_pnl)       -- netted; mark cached
          ⋈uniq(account_id, instrument_ref, status=OPEN)
```

### Strategies & adjustments
```
strategy_templates(id, slug ⋈uniq, name, view[BULLISH|BEARISH|NEUTRAL|VOLATILE],
                   categories text[]  {income,hedging,lowIV,highIV,weekly,monthly},
                   description, risk, reward, ideal_iv, ideal_market,
                   adjustment_rules jsonb, example jsonb, popularity int)      -- the 100+ library
strategy_template_legs(id, template_id, opt_type[CE|PE], action[BUY|SELL],
                       strike_offset int, ratio numeric, dte_offset int)

user_strategies(id, user_id, account_id, underlying_id, expiry_id, name,
                status[DRAFT|ACTIVE|CLOSED], template_slug, created_at)
user_strategy_legs(id, user_strategy_id, contract_id→option_contracts,
                   action, lots, entry_price, order_id→orders)
trades(id, account_id, user_strategy_id, opened_at, closed_at,
       gross_pnl, fees, net_pnl, r_multiple, status)                          -- closed trade record

adjustment_suggestions(id, user_strategy_id, ts,
       kind[ROLL_UP|ROLL_DOWN|ROLL_FWD|TO_IRON_FLY|TO_CONDOR|ADD_HEDGE|BUY_PROTECTION|
            REMOVE_HEDGE|TAKE_PROFIT|REDUCE_RISK|EXIT],
       rationale, delta_impact, theta_impact, margin_impact,
       pop_before, pop_after, max_loss_before, max_loss_after,
       legs jsonb, score, status[SUGGESTED|APPLIED|DISMISSED])
```

### Greeks / risk / analytics
```
portfolio_greeks(id, account_id, ts, delta, gamma, theta, vega, rho, beta_weighted_delta) -- series
risk_snapshots(id, account_id, ts, margin_used, exposure, max_loss, var_95, health[GREEN|AMBER|RED])
stress_runs(id, account_id, ts, kind[MONTE_CARLO|SCENARIO], params jsonb, result jsonb)
market_analytics(id, underlying_id, ts, pcr, max_pain, india_vix,
                 oi_buildup jsonb, gamma_walls jsonb, fii_dii jsonb)          -- computed by EOD/intraday jobs
```

### Journal & performance
```
journal_entries(id, trade_id→trades, user_id, ts, note, emotion[FEAR|GREED|FOMO|CALM|…],
                confidence int, mistakes text[], lessons text[], rating int, screenshots text[])
performance_daily(id, account_id, date, pnl, trades, wins, losses,
                  gross_profit, gross_loss, fees, equity_close, max_drawdown)  -- ⋈uniq(account,date)
        → equity curve, win-rate, profit-factor, expectancy, Sharpe/Sortino derived on read
```

### Learn / community / replay / system
```
courses(id, slug, title, level, sort)
lessons(id, course_id, slug ⋈uniq, title, body_mdx, media jsonb, sort)
quizzes(id, lesson_id, questions jsonb, pass_pct)
user_progress(id, user_id, lesson_id, status[LOCKED|IN_PROGRESS|DONE], score)
certificates(id, user_id, course_id, issued_at, serial ⋈uniq)

shared_strategies(id, user_id, snapshot jsonb, title, tags text[], likes_count, comments_count)
likes(user_id, target_type, target_id, PK(user_id,target_type,target_id))
comments(id, user_id, target_type, target_id, body, created_at)
competitions(id, name, starts_at, ends_at, rules jsonb)
competition_entries(id, competition_id, account_id, pnl, rank)               -- rank via Redis ZSET

replay_sessions(id, user_id, underlying_id, session_date, speed, cursor_ts, state jsonb)
ai_feedback(id, user_id, trade_id, ts, severity[INFO|WARN|CRIT], message, reasoning, tags text[])
notifications(id, user_id, type, payload jsonb, read_at, created_at)
```

## Indexing & scale notes
- Hot reads: `positions(account_id,status)`, `orders(account_id,status)`, `option_snapshots(contract_id,ts)`, `candles(instrument_token,tf,ts)`.
- **Partition** `candles`, `option_snapshots`, `portfolio_greeks`, `account_ledger` by day/month; attach/detach via a maintenance job; retention tiers (hot 90d in PG, cold in object storage/parquet).
- Leaderboards & live "top movers": **Redis sorted sets**, not SQL.
- Read-heavy analytics use **materialized views** refreshed by workers.
- Every write in the trading path is **transactional** (`orders`+`executions`+`positions`+`accounts`+`ledger`) with row locks per account to prevent double-spend of virtual margin.
