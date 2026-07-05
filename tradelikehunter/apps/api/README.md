# @tlh/api — NestJS REST + WebSocket

Modular backend: one Nest module per domain (auth, account, market, orders, positions,
strategies, adjustments, greeks, risk, journal, performance, analytics, learn, community,
replay, coach). Each module = controller/gateway → service → repository (`@tlh/db`) → domain
(`@tlh/domain`). Redis for cache/pub-sub/locks; socket.io with the Redis adapter for WS
fan-out; BullMQ hands heavy work to `@tlh/workers`. Zod (`@tlh/contracts`) validates all I/O.

Implemented starting **M0** (auth, account, health, WS bootstrap). See [`../../docs/API.md`](../../docs/API.md).
