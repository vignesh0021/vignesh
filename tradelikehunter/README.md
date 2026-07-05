# TradeLikeHunter — India's Advanced Options Paper-Trading Platform

> Learn · Practice · Simulate · Adjust · Analyze · Improve — **without risking real money.**
>
> FrontPage polish · Sensibull option-chain depth · Opstra analytics · TradingView charts.

TradeLikeHunter is a production-grade, modular SaaS that lets Indian options traders
paper-trade the NSE derivatives market against **live/replayed data** using **simulated
orders**, with a professional option chain, a drag-and-drop strategy builder, a
continuous **Adjustment Assistant**, full Greeks analytics, a trade journal, performance
analytics, a learning center, community, and an AI coach.

This is a **monorepo** (pnpm + Turborepo) split into deployable apps and shared packages.
It is designed feature-first, with a service/repository backend and an atomic-design
frontend, to scale horizontally toward 1M users.

## Blueprint (read these first)

| # | Doc | Covers |
|---|-----|--------|
| 1 | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Folder structure, tech stack, layered architecture, **state management**, **component tree**, **user flows** |
| 2 | [`docs/DATABASE.md`](docs/DATABASE.md) | PostgreSQL **schema**, relations, partitioning, indexing |
| 3 | [`docs/API.md`](docs/API.md) | REST **API design** + WebSocket channels + contracts |
| 4 | [`docs/WIREFRAMES.md`](docs/WIREFRAMES.md) | **Wireframes** for every core screen (desktop + mobile) |
| 5 | [`docs/ROADMAP.md`](docs/ROADMAP.md) | **Development roadmap**, **milestones**, module → phase map |

## Apps & packages

```
apps/web       React + Vite + Tailwind SPA (the product)
apps/api       NestJS REST + WebSocket gateway (service/repository layers)
apps/workers   Market-data ingest, simulated matching engine, analytics & journal jobs
packages/domain    Pure, isomorphic options math + domain models (Black-Scholes, Greeks, POP, payoff, margin)
packages/contracts Zod schemas + shared DTOs (single source of truth FE ↔ BE)
packages/ui        Atomic design system (atoms → organisms), themeable (dark/light)
packages/db        Prisma schema, migrations, repositories
packages/config    Shared tsconfig, eslint, tailwind preset (design tokens)
infra/         Docker, compose, CI/CD
```

## Status

**Phase: architecture & scaffolding.** Modules are implemented per the roadmap, each
production-ready (no placeholders) before moving on. Start with **Milestone 0 — Foundation**.
