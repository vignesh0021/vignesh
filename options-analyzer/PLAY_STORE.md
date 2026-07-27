# Publishing TradeLikeHunter to the Google Play Store

This build targets the **Indian market only** (NSE/BSE indices + F&O stocks via
Fyers). It is a **paper-trading / options-analytics** app — no real orders are
placed. Keep that framing in the store listing; it matters for review.

---

## 0. What I can and can't do for you

- ✅ The app builds a Play-ready **Android App Bundle (.aab)** — via EAS
  (recommended) or Gradle.
- ✅ This checklist + ready-to-paste store copy is below.
- ❌ I can't create your Play Console account, generate your private signing
  key, or upload on your behalf — those need your Google account and are
  secrets that must stay with you.

---

## 1. Prerequisites

- **Google Play Console account** — one-time US $25 (https://play.google.com/console).
- **A privacy policy URL** (mandatory for finance apps). Host a simple page; a
  template is in section 6.
- Node 20 + the app's deps (`npm install` in `options-analyzer/`).
- Either an **Expo/EAS account** (easiest signing) or a local JDK 17 + Android SDK.

---

## 2. Versioning (bump every upload)

In `app.json`:
- `expo.version` — user-facing (e.g. `1.11.0`).
- `expo.android.versionCode` — integer, **must increase for every upload**.
- Package id: `com.tradelikehunter.app` (final — cannot change after first upload).

---

## 3. Build the AAB

### Option A — EAS Build (recommended: EAS manages the signing key)

```bash
cd options-analyzer
npm i -g eas-cli
eas login
eas build -p android --profile production   # produces a signed .aab
```
Download the `.aab` from the EAS build page. Later, `eas submit -p android`
can upload it for you.

### Option B — Local Gradle with your own upload keystore

```bash
# 1. Create an upload keystore (keep this file + passwords SAFE and BACKED UP)
keytool -genkeypair -v -keystore upload.keystore \
  -alias upload -keyalg RSA -keysize 2048 -validity 9000

# 2. Generate the native project and build the bundle
cd options-analyzer
npx expo prebuild --platform android --clean
# Configure signing in android/app/build.gradle (release signingConfig) to use
# upload.keystore, then:
cd android && ./gradlew bundleRelease
# → android/app/build/outputs/bundle/release/app-release.aab
```

> The CI workflow `build-options-aab.yml` produces a **debug-signed** `.aab`
> artifact for inspection only — Play will reject it for release. Use A or B for
> a real upload, and enable **Play App Signing** (Google holds the app key; you
> keep the upload key).

---

## 4. Store listing (ready to paste)

- **App name:** TradeLikeHunter — Options Paper Trading
- **Short description (≤80 chars):**
  `Practice NSE/BSE options: live chain, scanner, paper trades, analytics.`
- **Full description:**
  ```
  TradeLikeHunter is a paper-trading and options-analytics app for the Indian
  market (NIFTY, BANKNIFTY, FINNIFTY, SENSEX and F&O stocks).

  • Market-Pulse-style option chain with live prices (connect your own Fyers
    account for real data).
  • Connect your Indian broker to monitor real positions & live PnL — Fyers,
    plus Dhan, Upstox, Zerodha Kite and Angel One (beta). Read-only; keys stay
    on your device.
  • Paper trading with real fill mechanics — market/limit orders, partial exits,
    stop-loss, target and trailing SL, MIS auto-square-off — and a virtual
    balance. No real money, no real orders.
  • Option-buyer scanner (price-action + OI) and a strategy deployer.
  • Analytics: Max Pain, PCR, OI build-up, support/resistance, IV smile,
    expected move, GEX, gamma density, volatility surface and a synthetic-
    futures arbitrage scan.
  • Live candlestick chart with EMA, VWAP, RSI and MACD.
  • Payoff, Greeks and a trade journal (win rate, profit factor, equity curve).

  TradeLikeHunter is for education and practice only. It does not place real
  orders, is not investment advice, and is not affiliated with Fyers or any
  exchange.
  ```
- **Category:** Finance · **Tags:** options, trading, paper trading, NSE
- **Contact email / website:** yours.

---

## 5. Play Console setup checklist

- [ ] Create app → default language English (India), app type **App**, **Free**.
- [ ] **Data safety** form: declare that broker credentials/tokens (Fyers,
      Dhan, Upstox, Zerodha, Angel One) are stored **on-device only** and not
      shared; the app makes network calls only to those brokers' own API
      endpoints and market-data endpoints.
- [ ] **Content rating** questionnaire (finance, no gambling — it's simulated).
- [ ] **Target audience:** 18+.
- [ ] **Privacy policy URL** (section 6).
- [ ] **Ads:** none (unless you add them).
- [ ] Upload the `.aab` to the **Internal testing** track first; add testers.
- [ ] Screenshots: at least 2 phone screenshots (Chain, Scanner, Analytics,
      Chart, Journal are good picks). Feature graphic 1024×500.
- [ ] App icon 512×512 (already in `assets/`).
- [ ] Roll out Internal → Closed → Production after testing.

---

## 6. Privacy policy (starter template — host at a public URL)

```
TradeLikeHunter Privacy Policy
TradeLikeHunter is a paper-trading and options-analytics app. We do not run
servers that store your data. If you connect a Fyers account, your API
credentials and access token are stored only on your device and are sent only
to Fyers' own API to fetch your market data and positions. We do not collect,
transmit, or sell personal data. Market data is fetched from public endpoints
and your connected broker. Contact: <your email>.
```

---

## 7. Review-risk notes (read before submitting)

- **Financial-app policy:** clearly state it's **simulated/paper trading, not
  investment advice** (done in the description) to avoid rejections.
- **Trademarks:** "Fyers", "NIFTY", "SENSEX" are third-party marks — use them
  only descriptively ("connect your Fyers account"), never implying endorsement.
- **Real trading disclaimer** is shown in-app on the paper-trade and scanner
  screens; keep it.
