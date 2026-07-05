# Wireframes

Low-fidelity layouts for the core screens. Desktop = sidebar + content; mobile collapses to a
**bottom tab bar** (Dashboard · Markets · Trade · Portfolio · Learn/Profile). Dark theme default.

## Global shell (desktop)
```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ⌖ TradeLikeHunter    [ Search symbol ⌘K ]        VIX 13.4  NIFTY 24,180 ▲0.4% │
├───────────┬──────────────────────────────────────────────────────────────────┤
│ ◉ Dashboard│                                                                  │
│ ▤ Markets  │                      < ACTIVE MODULE >                            │
│ ⇄ Trade    │                                                                  │
│ ▦ Portfolio│                                                                  │
│ ∿ Analytics│                                                                  │
│ 🎓 Learn   │                                                                  │
│ 👥 Community│                                                                  │
│ ⚙ Settings │   Wallet: ₹9,84,220 · Margin ₹1,12,000 · Buying Pwr ₹8,72,220   │
└───────────┴──────────────────────────────────────────────────────────────────┘
```

## 1. Dashboard
```
┌ Today P&L ─────┐┌ Portfolio Val ┐┌ Margin Used ─┐┌ Buying Power ┐┌ Win Rate ┐
│ +₹4,210  ▲2.1% ││ ₹9,84,220     ││ ₹1,12,000    ││ ₹8,72,220    ││ 61%  ▓▓▓░ │
└────────────────┘└───────────────┘└──────────────┘└──────────────┘└──────────┘
┌ Portfolio Greeks ───────────────┐┌ Equity (today) ───────────────────────────┐
│ Δ +12.4  Γ 0.003  Θ -1,840  ν 320│ │      ╱╲   ╱╲___╱                          │
└─────────────────────────────────┘└────────────────────────────────────────────┘
┌ Open Positions (4) ─────────────────────────┐┌ Watchlist ───────┐┌ News ──────┐
│ NIFTY 24200 CE  -50  LTP 118  UPL +820  Δ-.. ││ NIFTY  24,180 ▲ ││ • RBI …    │
│ NIFTY 24000 PE  -50  LTP  96  UPL -140       ││ BANKNIFTY 51,2… ││ • FII buy… │
│ …                                            ││ RELIANCE 2,9..  ││            │
└──────────────────────────────────────────────┘└──────────────────┘└────────────┘
┌ Open Orders ─────────────────┐┌ Today's Trades ─────────────┐┌ Market Breadth ─┐
│ SL NIFTY 24000 PE @ 60  ⏳    ││ 3 closed · +₹3,390 net      ││ Adv 32 / Dec 18 │
└──────────────────────────────┘└─────────────────────────────┘└─────────────────┘
```

## 2. Trade — the 3-pane workspace (option chain + ticket)
```
┌ CHART ───────────────────────┐┌ OPTION CHAIN  NIFTY  28 Aug ▾ ──────────────┐┌ ORDER TICKET ─┐
│  NIFTY 24,180  1m ▾  �ind ▾    ││  CALLS          |STRIKE|        PUTS         ││ NIFTY 24200 CE │
│    ╱╲      ╱╲                  ││ OI  IV  LTP  Δ  |      |  Δ  LTP  IV  OI     ││ ○Buy  ●Sell    │
│  ╱    ╲__╱    ╲___             ││ 1.2m 12 138 .55|24100| .. 41  13 0.9m       ││ Qty  50 (1 lot)│
│                               ││ 0.9m 12 118 .48|24200|◀ATM 62 13 1.1m ◀MaxP ││ Type MARKET ▾  │
│  [ Δ Γ Θ ν overlay ]          ││ 0.7m 11  96 .40|24300| .. 88  14 1.4m       ││ Margin ₹41,300 │
│                               ││ ▓ OI bar  · ΔOI ↑ green/↓ red · IV-rank chip ││ [ PLACE ORDER ]│
└───────────────────────────────┘└─────────────────────────────────────────────┘└────────────────┘
┌ POSITIONS ──────────────────────────────┐┌ PAYOFF (current book) ───────────────┐
│ NIFTY 24200 CE -50  avg 120 LTP 118 +100 ││   profit ▔▔╲          ╱▔▔  (T+0 cyan) │
│ NIFTY 24000 PE -50  avg  98 LTP  96 +100 ││   ─────────╲________╱──── (expiry ora)│
│ [Add] [Close] [Payoff] [Adjust]          ││   BE 23,760 / 24,440   POP 68%        │
└──────────────────────────────────────────┘└──────────────────────────────────────┘
```

## 3. Strategy Builder (drag & drop)
```
┌ LEGS PALETTE ─┐┌ CANVAS ──────────────────────────────┐┌ ANALYSIS ───────────────┐
│ + Buy Call    ││  ○ SELL 24200 CE ×1   [Δ][×]         ││ Max Profit  ₹6,250      │
│ + Sell Call   ││  ○ SELL 24000 PE ×1   [Δ][×]         ││ Max Loss    Unlimited   │
│ + Buy Put     ││  ○ BUY  24400 CE ×1   [Δ][×]         ││ POP         64%         │
│ + Sell Put    ││  ○ BUY  23800 PE ×1   [Δ][×]         ││ Breakevens  23.7k/24.4k │
│ + Future      ││  + drag leg / adjust strike & ratio  ││ Net Δ +2  Θ -1,120  ν.. │
│ ── Presets ── ││                                       ││ Expected Return +₹2,140 │
│ Iron Condor   ││  ┌ PAYOFF (live) ──────────────────┐ ││ Margin ₹1,08,000        │
│ Iron Fly …    ││  │  ▔▔╲__________╱▔▔  green/red zones│ ││ [ Simulate this book ]  │
└───────────────┘└──┴───────────────────────────────────┘└─────────────────────────┘
```

## 4. Adjustment Assistant (the heart)
```
┌ TRADE: Short Strangle · NIFTY 28 Aug ─────────────────────────────────────────┐
│ Health ▓▓▓▓░ AMBER   Δ +18 (too directional)   POP 58% ↓   Margin 71% used    │
├───────────────────────────────────────────────────────────────────────────────┤
│ SUGGESTED ADJUSTMENTS                                             sort: best ▾  │
│ ① Roll 24000 PE → 23800 PE            score ●●●●○                              │
│    Why: price drifted up; recentre deltas, collect ₹18 credit.                 │
│    Δ -12  ·  Θ +140  ·  Margin -₹6k  ·  POP 58% → 66%  ·  MaxLoss ∞ → ∞        │
│    [ Apply ]  [ Preview payoff ]  [ Dismiss ]                                   │
│ ② Convert to Iron Condor (buy 24500 CE / 23500 PE)   score ●●●○○               │
│    Why: caps tail risk before expiry-week gamma. POP 58%→61%, MaxLoss ∞→₹42k. │
│ ③ Take profit — 52% of max credit captured           score ●●●○○               │
└───────────────────────────────────────────────────────────────────────────────┘
```

## 5. Performance & Journal
```
┌ Equity Curve ───────────────────────────┐┌ Stats ───────────────┐┌ Calendar ──────┐
│        ╱╲    ╱╲___╱                       ││ Win% 61  PF 1.8      ││ M T W T F      │
│   ____╱  ╲__╱                             ││ Expectancy +₹640     ││ ▢▣▣▢▣  (green   │
│                                           ││ Sharpe 1.4  DD -8%   ││ ▣▣▢▣▣   = +day) │
└───────────────────────────────────────────┘└──────────────────────┘└────────────────┘
┌ Journal — Trade #142 Iron Condor +₹3,110 ─────────────────────────────────────┐
│ Emotion: Calm   Confidence 4/5   Rating ★★★★☆                                   │
│ Mistakes: [entered too early]   Lessons: [wait for IV crush]   📎 screenshot    │
└───────────────────────────────────────────────────────────────────────────────┘
```

## Mobile (bottom-nav)
```
┌───────────────┐   Trade screen collapses the 3 panes into swipe tabs:
│  < content >  │   [ Chart | Chain | Ticket | Positions ]
│               │
│               │   Order ticket becomes a bottom sheet.
├───────────────┤   Payoff & Greeks are full-width cards.
│ ◉  ▤  ⇄  ▦  🎓│   ← Dashboard Markets Trade Portfolio Learn
└───────────────┘
```
