# Options Payoff Analyzer

A cross-platform (Android/iOS) mobile app for options traders: an interactive
**payoff analyzer**, **Greeks risk matrix**, and **backtesting / forward-testing**
tool in the spirit of Opstra and Delta Exchange. All pricing and risk math runs
100% client-side.

<p align="center">
  <em>React Native · Expo · TypeScript · Zustand · react-native-svg</em>
</p>

---

## Feature modules

| Module | What it does | Key files |
| --- | --- | --- |
| **1. Black-Scholes engine** | Analytical pricing + full Greeks (Δ, Γ, Θ daily, 𝒱 per 1% IV), pure TS, no deps | `src/hooks/useBlackScholes.ts` |
| **2. Portfolio store + Closed-Position Baseline** | `openPositions` / `closedPositions` slices; closing a leg freezes realized PNL and zeroes its Greeks; curves shift by the cumulative closed offset | `src/store/usePortfolioStore.ts`, `src/utils/payoff.ts` |
| **3. Interactive UI** | Dual-line payoff canvas (orange = expiry, cyan = T+0) with profit/loss shading + draggable crosshair; spot / date / IV simulation sliders; risk matrix (Max P/L, R:R, break-evens); Greeks & PNL tables; slide-up add/edit sheet | `src/components/*`, `src/screens/AnalyzerScreen.tsx` |
| **4. Backtesting & Forward testing** | `papaparse` CSV ingestion of option-chain snapshots; backtest → cumulative equity curve; forward test → tick-by-tick stepping into the live graph/Greeks | `src/components/TestingEngine.tsx` |
| **5. Paper Trading** | Market-Pulse-style one-screen option chain (real Fyers expiries/LTP/OI when connected) + virtual order engine; market & limit orders with margin checks, SL/Target auto-exits, MIS auto-square-off, one-tap strategy deploy at live strikes, live MTM + payoff, trade journal with win rate/profit factor/equity curve | `src/components/PaperTradingScreen.tsx`, `src/store/usePaperStore.ts`, `src/services/liveFeed.ts`, `src/components/PaperJournal.tsx` |
| **6. Automated APK build** | GitHub Actions → `expo prebuild` + Gradle `assembleRelease`; `eas.json` for EAS cloud builds | `.github/workflows/build-options-apk.yml`, `eas.json` |

---

## The math (Module 1)

Standard Black-Scholes-Merton with continuous compounding, `T = days / 365`:

```
d1 = (ln(S/K) + (r + σ²/2)·T) / (σ·√T)
d2 = d1 − σ·√T
Call = S·N(d1) − K·e^(−rT)·N(d2)
Put  = K·e^(−rT)·N(−d2) − S·N(−d1)
```

Greeks are position-scaled by `sign · lots · lotSize` (BUY = +1, SELL = −1) and
reported in trader-friendly units: **Theta as daily decay** and **Vega per 1
vol point (1% IV)**. `N(x)` uses the Abramowitz-Stegun erf approximation.

## The Closed-Position Baseline (Module 2)

When a leg is closed it moves from `openPositions` to `closedPositions`; its
realized PNL is frozen and it contributes **exactly 0** to every live Greek. The
payoff curves are then vertically offset by:

```
ClosedOffset   = Σ realizedPnl(closedPositions)
Portfolio(X)   = ActivePositionsPayoff(X) + ClosedOffset
```

so both the expiry line and the T+0 line reflect already-banked P&L.

## Paper Trading (Module 5)

The **📝 Paper Trade** tab is a full trading simulator built around a
Market-Pulse-style option chain — Call LTP · **STRIKE** · Put LTP with OI on the
outer columns. Tap any strike to open an order ticket and place a simulated
BUY/SELL (market or resting limit), then watch positions mark to market tick by
tick with zero money at risk.

**Live tape.** A single [`liveFeed`](src/services/liveFeed.ts) singleton is the
source of the underlying spot. It always runs a synthetic random-walk engine so
the tape is live 24/7 (nights, weekends, no broker). When a **Fyers** account is
connected (Brokers tab), [`fyersSocket`](src/services/brokers/fyersSocket.ts)
attaches the Fyers v3 data WebSocket and real last-traded prices seamlessly
override the walk; if the socket goes quiet the walk resumes. The whole chain and
every open position are **repriced from that one spot via Black-Scholes**, so
calls, puts and P&L stay mutually consistent exactly like a real option tape.

**Real fill mechanics.** [`usePaperStore`](src/store/usePaperStore.ts) mirrors a
broker: weighted-average entries, reduce/close/flip on the opposite side, frozen
realized P&L on closed quantity, resting limit orders that fill when price is
hit, optional estimated brokerage + STT, and margin/available accounting.

```
equity      = startingFunds + realizedPnl + Σ unrealised MTM
usedMargin  = premium debit (longs) + SPAN-style block (shorts)
available   = startingFunds + realizedPnl − usedMargin
```

Everything persists on-device (AsyncStorage). Connect Fyers for a real live feed,
or just open the tab and trade against the simulated tape.

---

## Running locally

```bash
cd options-analyzer
npm install
npx expo start        # scan the QR with Expo Go (SDK 51)
```

## Building the APK

### Option A — GitHub Actions (no secrets required, default)

Pushing to the feature branch (or running the workflow manually) triggers
**Build Options Analyzer APK**. It runs `expo prebuild` then Gradle
`assembleRelease`. The Expo Android template signs the release build with the
bundled debug keystore, so the resulting `app-release.apk` is directly
installable — no Expo account or signing secrets needed. Download it from the
run's **Artifacts** (`options-analyzer-apk`).

### Option B — EAS Build (cloud)

`eas.json` is provided with an APK-producing `preview`/`production` profile:

```bash
npm i -g eas-cli
eas login
eas build -p android --profile preview
```

---

## CSV format for backtesting (Module 4)

```
Timestamp,Spot Price,Strike,Call/Put,Bid,Ask,IV
2026-07-01T09:15:00Z,62000,68000,Call,850,930,55
...
```

`IV` is accepted as either a percentage (`55`) or a decimal (`0.55`). Use the
**Load Sample** button to generate a demo chain from your current portfolio if
you don't have a file handy.

---

## Tech notes

- **Charting** uses `react-native-svg` with memoised path strings and a
  `react-native-gesture-handler` crosshair. This keeps interaction smooth while
  guaranteeing a reliable, secret-free automated Gradle build (Skia/victory-native
  add native-build surface without changing the analytics).
- **State** is a single Zustand store with narrow selectors so slider drags
  don't cascade re-renders across the whole tree.
