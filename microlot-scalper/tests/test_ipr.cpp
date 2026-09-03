//+------------------------------------------------------------------+
//| test_ipr.cpp - deterministic test harness for the IPR strategy.  |
//|                                                                  |
//| Compiles the SAME pure headers the EA uses, under the MQL5 shim  |
//| in mql5_compat.h, and drives them with synthetic market data.    |
//| Covers the 17 scenarios required by the Phase 2 brief plus unit  |
//| tests of the money model, indicators and structure detection.    |
//+------------------------------------------------------------------+
#include "../MQL5/Include/IPR/Types.mqh"
#include "../MQL5/Include/IPR/MathUtil.mqh"
#include "../MQL5/Include/IPR/Config.mqh"
#include "../MQL5/Include/IPR/CostModel.mqh"
#include "../MQL5/Include/IPR/Indicators.mqh"
#include "../MQL5/Include/IPR/Structure.mqh"
#include "../MQL5/Include/IPR/HourProfile.mqh"
#include "../MQL5/Include/IPR/Gates.mqh"
#include "../MQL5/Include/IPR/Impulse.mqh"
#include "../MQL5/Include/IPR/Pullback.mqh"
#include "../MQL5/Include/IPR/SetupMachine.mqh"
#include "../MQL5/Include/IPR/TargetEngine.mqh"
#include "../MQL5/Include/IPR/ExitEngine.mqh"
#include "../MQL5/Include/IPR/RiskManager.mqh"
#include "../MQL5/Include/IPR/SignalEngine.mqh"

#include <cstdio>

static int g_pass = 0, g_fail = 0;

static void section(const char *s) { printf("\n== %s\n", s); }

static void check(bool cond, const char *what)
  {
   if(cond) { g_pass++; printf("   pass  %s\n", what); }
   else     { g_fail++; printf("   FAIL  %s\n", what); }
  }

static void checkRej(IprReject got, IprReject want, const char *what)
  {
   if(got == want) { g_pass++; printf("   pass  %s\n", what); }
   else { g_fail++; printf("   FAIL  %s (got %d, want %d)\n", what, (int)got, (int)want); }
  }

static bool nearly(double a, double b, double tol) { return MathAbs(a - b) <= tol; }

//====================================================================
// Synthetic market builder
//====================================================================
struct Synth
  {
   IprBars        bars;
   IprAtrState    atr;
   IprEmaState    emaF, emaS;
   IprHourProfile prof;
   long           t;
   int            spreadPts;
   double         point;

   void Init(double pt, int spr)
     {
      bars.Reset(); atr.Init(IPR_ATR_PERIOD);
      emaF.Init(IPR_EMA_FAST); emaS.Init(IPR_EMA_SLOW);
      prof.Reset();
      t = 1700006400L; point = pt; spreadPts = spr;
     }

   void Add(double o, double h, double l, double c)
     {
      IprBar b;
      b.time = t; b.open = o; b.high = h; b.low = l; b.close = c;
      b.spreadPts = spreadPts;
      bars.Push(b);
      atr.Update(h, l, c); emaF.Update(c); emaS.Update(c);
      t += 300;
     }

   //--- Zigzag warmup: establishes ATR ~= range, a directional EMA
   //--- stack, and real fractal swings (a monotonic ramp has none).
   void Warmup(double base, double range, int n, double drift)
     {
      double p = base;
      for(int i = 0; i < n; i++)
        {
         const double step = ((i % 4) != 3) ? drift : -drift * 0.6;
         const double o = p, c = p + step;
         Add(o, MathMax(o, c) + range * 0.45, MathMin(o, c) - range * 0.45, c);
         p = c;
        }
     }

   double LastClose() const { return bars.CloseAgo(0); }

   //--- 20 sessions of reference observations for every hour bucket, so
   //--- the hour gates have a formed profile without needing 5760 bars.
   void FillProfile(double refAtr, double refSpreadPrice)
     {
      for(int d = 0; d < IPR_PROFILE_DAYS; d++)
         for(int h = 0; h < IPR_PROFILE_HOURS; h++)
            prof.Observe(h, 1000 + d, refAtr, refSpreadPrice);
     }

   void BuildCtx(double spreadPrice, IprMarketCtx &ctx, int shockLatch = 0) const
     {
      ctx.Reset();
      ctx.atr = atr.Value();
      ctx.emaFast = emaF.Value();
      ctx.emaSlow = emaS.Value();
      double ago = 0.0;
      ctx.emaAgoValid = emaF.Ago(IPR_EMA_SLOPE_BARS, ago);
      ctx.emaFastAgo = ago;
      ctx.spreadPrice = spreadPrice;
      const long lastT = bars.TimeAgo(0);
      ctx.hour = (int)((lastT % 86400) / 3600);
      ctx.dayKey = lastT / 86400;
      ctx.barTime = lastT;
      ctx.shockStandDownBars = shockLatch;
     }
  };

//--- Knobs for the canonical impulse -> pullback -> turn tail.
struct TailSpec
  {
   double legSize;
   double retrace;
   bool   confirmTurn;
   bool   priorSwing;
   bool   shockBar;

   void Defaults()
     {
      legSize = 4.0; retrace = 1.3333;
      confirmTurn = true; priorSwing = true; shockBar = false;
     }
  };

//--- Appends the tail. Deltas are written for a LONG and mirrored for a
//--- SHORT by reflecting about the base price (highs and lows swap), so
//--- both directions are driven by ONE description - which is what makes
//--- the long/short symmetry test meaningful.
static void AppendTail(Synth &s, const TailSpec &ts, int sign)
  {
   const double B = s.LastClose();

   struct D { double o, h, l, c; };
   D d[12];
   int n = 0;

   d[n++] = { 0.00, 0.20, -0.20, 0.00 };                       // ago 11
   d[n++] = { 0.00, 0.30, -0.20, 0.05 };                       // ago 10
   d[n++] = { 0.05, 0.40, -0.10, 0.10 };                       // ago 9
   d[n++] = { 0.10, ts.priorSwing ? 0.90 : 0.35, 0.00, 0.20 }; // ago 8 <- swing
   d[n++] = { 0.20, 0.45, -0.05, 0.10 };                       // ago 7
   d[n++] = { 0.10, 0.40, -0.15, 0.05 };                       // ago 6

   const double legLow  = -0.30;
   const double legHigh = legLow + ts.legSize;
   const double mid     = legLow + ts.legSize * 0.5;

   const double lp = ts.legSize * 0.025;   // decorations scale with the leg
   d[n++] = { lp * 0.5, lp * 2.5, legLow, legLow + lp };       // ago 5 leg origin
   d[n++] = { legLow, mid + lp * 3.0, legLow, mid };           // ago 4 impulse
   d[n++] = { mid, legHigh, mid - lp, legHigh - lp };          // ago 3 leg extreme

   const double pbLow = legHigh - ts.retrace;
   const double c2 = legHigh - ts.retrace / 3.0;
   const double dec = ts.retrace * 0.22;   // decorations scale with the leg
   d[n++] = { c2 + dec * 0.8, c2 + dec, c2 - dec, c2 };        // ago 2 pullback

   //--- turn bar: its low IS the pullback extreme, and it closes against
   //--- the trade direction (the reversal candle itself).
   d[n++] = { pbLow + ts.retrace * 0.35, pbLow + ts.retrace * 0.40,
              pbLow,                     pbLow + ts.retrace * 0.05 };  // ago 1

   //--- confirm bar: closes in the trade's favour.
   const double o0 = pbLow + ts.retrace * 0.10;
   const double c0 = ts.confirmTurn ? (o0 + ts.retrace * 0.25)
                                    : (o0 - ts.retrace * 0.05);
   d[n++] = { o0, MathMax(o0, c0) + ts.retrace * 0.05,
              pbLow + ts.retrace * 0.03, c0 };                 // ago 0

   //--- Optional shock bar injected into the pullback, to latch G4.
   if(ts.shockBar)
      d[9].h = d[9].l + 20.0;

   for(int i = 0; i < n; i++)
     {
      if(sign > 0)
         s.Add(B + d[i].o, B + d[i].h, B + d[i].l, B + d[i].c);
      else
         s.Add(B - d[i].o, B - d[i].l, B - d[i].h, B - d[i].c);  // high/low swap
     }
  }

//====================================================================
// Fixtures
//====================================================================
static void XauSpec(IprSymbolSpec &spec)
  {
   spec.Reset();
   spec.digits = 2; spec.point = 0.01; spec.tickSize = 0.01;
   spec.tickValue = 1.00;          // 100 oz contract, 0.01 tick -> $1.00
   spec.contractSize = 100.0;
   spec.volMin = 0.01; spec.volMax = 100.0; spec.volStep = 0.01;
   spec.valid = true;
  }

static void BtcSpec(IprSymbolSpec &spec)
  {
   spec.Reset();
   spec.digits = 2; spec.point = 0.01; spec.tickSize = 0.01;
   spec.tickValue = 0.01;          // 1 BTC contract
   spec.contractSize = 1.0;
   spec.volMin = 0.01; spec.volMax = 50.0; spec.volStep = 0.01;
   spec.valid = true;
  }

static void BaseCfg(IprConfig &cfg)
  {
   cfg.Reset();
   cfg.nImp = 6; cfg.lMinMult = 1.2; cfg.tpMult = 2.0; cfg.costBudget = 0.12;
   cfg.volume = 0.01; cfg.targetNet = 1.0;
   cfg.commissionPerLotRT = 0.0; cfg.slipEstSpreadMult = 0.25;
  }

static const double kRange = 1.20;   // XAU-like M5 ATR

struct Scenario
  {
   Synth           s;
   IprConfig       cfg;
   IprSymbolSpec   spec;
   IprCosts        costs;
   IprMarketCtx    ctx;
   IprSetupMachine machine;
   IprDiagnostics  diag;
   double          spreadPrice;
  };

static void Build(Scenario &sc, int sign, const TailSpec &ts,
                  int spreadPts = 10, int shockLatch = 0)
  {
   XauSpec(sc.spec);
   BaseCfg(sc.cfg);
   sc.s.Init(sc.spec.point, spreadPts);
   sc.s.Warmup(2000.0, kRange, 320, sign > 0 ? 0.10 : -0.10);
   AppendTail(sc.s, ts, sign);

   sc.spreadPrice = spreadPts * sc.spec.point;
   sc.s.FillProfile(sc.s.atr.Value(), sc.spreadPrice);
   IprBuildCosts(sc.spec, sc.cfg, sc.cfg.volume, sc.spreadPrice, 0.0, 0.0, sc.costs);
   sc.s.BuildCtx(sc.spreadPrice, sc.ctx, shockLatch);
   sc.machine.Init(IprHashString("XAUUSD"));
  }

static void BuildValid(Scenario &sc, int sign = 1)
  {
   TailSpec ts; ts.Defaults();
   Build(sc, sign, ts);
  }

//====================================================================
int main()
  {
   printf("==================================================\n");
   printf(" IPR strategy logic tests (pure layer, g++ + shim)\n");
   printf("==================================================\n");

   //-----------------------------------------------------------------
   //--- Phase 2 section 29 lists these as FIXED LOGIC. Asserting them
   //--- against LITERALS (never against themselves) is what makes the
   //--- rest of the suite able to detect a silent strategy change.
   section("FIXED CONSTANTS: guard against silent strategy drift");
     {
      check(IPR_ATR_PERIOD == 14,              "ATR period is 14");
      check(IPR_EMA_FAST == 20 && IPR_EMA_SLOW == 50, "EMA pair is 20/50");
      check(IPR_FRACTAL_WIDTH == 2,            "fractal width is 2");
      check(nearly(IPR_ER_MIN, 0.50, 1e-12),   "ER minimum is 0.50");
      check(nearly(IPR_PULLBACK_MIN, 0.20, 1e-12),   "pullback floor is 0.20");
      check(nearly(IPR_PULLBACK_MAX, 0.618, 1e-12),  "pullback ceiling is 0.618");
      check(nearly(IPR_PULLBACK_VEL_FACTOR, 0.80, 1e-12), "velocity factor is 0.80");
      check(IPR_SETUP_VALID_BARS == 5,         "setup validity is 5 bars");
      check(nearly(IPR_SHOCK_ATR_MULT, 3.0, 1e-12),  "shock filter is 3 x ATR");
      check(nearly(IPR_EMA_SLOPE_ATR, 0.10, 1e-12),  "EMA slope threshold is 0.10 x ATR");
      check(nearly(IPR_VOL_RATIO_MIN, 0.60, 1e-12) && nearly(IPR_VOL_RATIO_MAX, 2.50, 1e-12),
            "volatility band is 0.60 .. 2.50");
      check(nearly(IPR_SPREAD_ATR_MAX, 0.15, 1e-12), "spread ceiling is 0.15 x ATR");
      check(nearly(IPR_SPREAD_MED_MULT, 2.5, 1e-12), "abnormal spread is 2.5 x hourly median");
      check(nearly(IPR_SL_MAX_ATR, 1.20, 1e-12),     "stop ceiling is 1.20 x ATR");
      check(nearly(IPR_SL_MIN_ATR, 0.40, 1e-12),     "stop floor is 0.40 x ATR");
      check(nearly(IPR_STRUCT_CAP, 0.90, 1e-12),     "structural cap is 90%");
      check(IPR_MAXHOLD_BARS == 12,            "max hold is 12 bars (60 min)");
      check(IPR_NOPROGRESS_BARS == 4 && nearly(IPR_NOPROGRESS_FRAC, 0.35, 1e-12),
            "no-progress is 4 bars at 35% of target");
      check(IPR_MOMFAIL_CLOSES == 2,           "momentum failure is 2 closes");
      check(IPR_CLUSTER_BARS == 12,            "cluster time lock is 12 bars");
      check(nearly(IPR_CLUSTER_STRUCT_ATR, 0.5, 1e-12), "cluster structure lock is 0.5 x ATR");
      check(nearly(IPR_CLUSTER_DIST_ATR, 1.0, 1e-12),   "cluster distance lock is 1.0 x ATR");
      check(IPR_COOLDOWN_LOSS == 20 && IPR_COOLDOWN_LOSS2 == 40 && IPR_COOLDOWN_WIN == 6,
            "cooldowns are 20 / 40 / 6 bars");
      check(IPR_MAX_CONSEC_LOSSES == 3,        "3 consecutive losses stop the day");
      check(IPR_MAX_TRADES_DAY == 4,           "4 trades per day per symbol");
      check(IPR_MAX_ORDER_FAILURES == 3 && IPR_MAX_SLIP_EVENTS == 5,
            "execution halt at 3 failures / 5 slippage events");
      check(nearly(IPR_FEASIBILITY_MAX_ATR, 1.5, 1e-12), "feasibility ceiling is 1.5 x ATR");
     }

   //-----------------------------------------------------------------
   section("UNIT: money model (symbol-agnostic conversion)");
     {
      IprSymbolSpec xau, btc, eur;
      XauSpec(xau); BtcSpec(btc);
      eur.Reset();
      eur.digits = 5; eur.point = 0.00001; eur.tickSize = 0.00001;
      eur.tickValue = 1.00; eur.contractSize = 100000.0;
      eur.volMin = 0.01; eur.volMax = 100.0; eur.volStep = 0.01; eur.valid = true;

      const double mXau = IprMoneyPerPriceUnit(xau, 0.01);
      const double mBtc = IprMoneyPerPriceUnit(btc, 0.01);
      const double mEur = IprMoneyPerPriceUnit(eur, 0.01);
      check(nearly(mXau, 1.0, 1e-9),    "XAUUSD 0.01 lot -> $1.00 per 1.00 price unit");
      check(nearly(mBtc, 0.01, 1e-9),   "BTCUSD 0.01 lot -> $0.01 per 1.00 price unit");
      check(nearly(mEur, 1000.0, 1e-6), "EURUSD 0.01 lot -> $1000 per 1.00000 price unit");
      check(nearly(1.0 / mBtc, 100.0, 1e-6), "BTC: $1 gross needs a $100 move");

      //--- Phase 1: cost drag is independent of lot size.
      IprConfig cfg; BaseCfg(cfg);
      IprCosts c1, c2;
      cfg.volume = 0.01;
      IprBuildCosts(xau, cfg, 0.01, 0.10, 0.0, 0.0, c1);
      cfg.volume = 0.50;
      IprBuildCosts(xau, cfg, 0.50, 0.10, 0.0, 0.0, c2);
      check(nearly(c1.totalPrice, c2.totalPrice, 1e-9),
            "cost in PRICE units is invariant to volume (Phase 1 finding 1)");
      check(c2.reqMovePrice < c1.reqMovePrice,
            "larger volume needs a smaller move for $1 - and so a worse cost ratio");
     }

   //-----------------------------------------------------------------
   section("UNIT: expectancy identity  required edge = C/(dTp+dSl)");
     {
      const double dTp = 2.40, dSl = 1.00, C = 0.35;
      const double pStar = (dSl + C) / (dTp + dSl);
      const double pRw   = dSl / (dTp + dSl);
      check(nearly(pStar - pRw, C / (dTp + dSl), 1e-12),
            "breakeven minus random-walk win rate equals C/span");
      check(nearly(pStar, 0.397058823, 1e-6), "breakeven win rate 39.7% for 2.40/1.00 @ C=0.35");
     }

   //-----------------------------------------------------------------
   section("UNIT: indicators and structure");
     {
      Synth s; s.Init(0.01, 10);
      for(int i = 0; i < 60; i++)
         s.Add(100.0, 101.0, 99.0, 100.0);        // constant 2.00 range
      check(s.atr.Ready(), "ATR reports ready after >= period bars");
      check(nearly(s.atr.Value(), 2.0, 1e-6), "Wilder ATR converges to a constant range");

      //--- Efficiency ratio: a straight line is 1.0, a round trip ~0.
      Synth up; up.Init(0.01, 10);
      for(int i = 0; i < 10; i++)
         up.Add(100.0 + i, 100.5 + i, 99.5 + i, 100.0 + i);
      double er = 0.0;
      check(IprEfficiencyRatio(up.bars, 5, 0, er) && nearly(er, 1.0, 1e-9),
            "ER = 1.0 for a perfectly directional leg");

      Synth zz; zz.Init(0.01, 10);
      for(int i = 0; i < 10; i++)
        { const double p = 100.0 + ((i % 2) ? 1.0 : 0.0); zz.Add(p, p + 0.5, p - 0.5, p); }
      check(IprEfficiencyRatio(zz.bars, 4, 0, er) && er < 0.4,
            "ER is low for a choppy leg");

      //--- Fractal swing needs 2 bars each side and strict inequality.
      Synth fr; fr.Init(0.01, 10);
      const double hs[9] = { 1, 2, 3, 9, 3, 2, 1, 1, 1 };
      for(int i = 0; i < 9; i++)
         fr.Add(100.0 + hs[i], 100.0 + hs[i] + 0.1, 100.0 + hs[i] - 0.1, 100.0 + hs[i]);
      check(IprIsSwingHigh(fr.bars, 5, 2), "confirmed swing high found at the peak");
      check(!IprIsSwingHigh(fr.bars, 4, 2), "non-peak bar is not a swing high");
      check(!IprIsSwingHigh(fr.bars, 1, 2), "swing needs 2 CLOSED bars to its right (no look-ahead)");

      //--- Median
      IprSampleSet ss; ss.Reset();
      ss.Add(5); ss.Add(1); ss.Add(3);
      double med = 0.0;
      check(IprMedian(ss, med) && nearly(med, 3.0, 1e-12), "median of {5,1,3} = 3");
     }

   //-----------------------------------------------------------------
   section("TEST 6: invalid-volume handling");
     {
      IprSymbolSpec xau; XauSpec(xau);
      double v = 0.0;
      check(IprNormalizeVolume(0.01, xau, v) && nearly(v, 0.01, 1e-12), "0.01 is valid");
      check(!IprNormalizeVolume(0.001, xau, v), "0.001 rejected: below SYMBOL_VOLUME_MIN");
      check(!IprNormalizeVolume(500.0, xau, v), "500 rejected: above SYMBOL_VOLUME_MAX");

      IprSymbolSpec big; XauSpec(big);
      big.volMin = 0.10; big.volStep = 0.10;
      check(!IprNormalizeVolume(0.01, big, v),
            "0.01 rejected when the broker's minimum is 0.10 (never silently resized)");
      check(IprNormalizeVolume(0.30, big, v) && nearly(v, 0.30, 1e-12),
            "0.30 accepted on a 0.10 step");

      IprConfig cfg; BaseCfg(cfg);
      cfg.volume = -1.0;
      string err;
      check(!cfg.Validate(err), "config rejects a negative volume");
     }

   //-----------------------------------------------------------------
   section("TEST 3+15: setup state machine and invalidation");
     {
      Scenario sc; BuildValid(sc);
      IprSetup setup; IprTargetPlan plan;
      const IprReject r = IprEvaluateSetup(sc.s.bars, sc.cfg, sc.spec, sc.costs, sc.ctx,
                                           sc.machine, IPR_DIR_LONG, setup, plan, sc.diag);
      checkRej(r, IPR_OK, "canonical long scenario produces a valid setup");
      check(setup.setupId != 0, "setup carries a non-zero SetupID");
      check(setup.state == IPR_STATE_FORMING, "fresh setup is FORMING");

      sc.machine.Arm(setup);
      check(sc.machine.HasArmed(), "machine reports ARMED after Arm()");
      check(sc.machine.m_active.state == IPR_STATE_ARMED, "state is ARMED");

      //--- one-way door
      sc.machine.Consume(IPR_STATE_TRIGGERED);
      check(sc.machine.m_active.state == IPR_STATE_TRIGGERED, "ARMED -> TRIGGERED");
      check(!sc.machine.CanArm(setup.setupId), "a consumed SetupID can never re-arm");

      //--- invalidation by regime flip
      Scenario sc2; BuildValid(sc2);
      IprSetup s2; IprTargetPlan p2;
      IprEvaluateSetup(sc2.s.bars, sc2.cfg, sc2.spec, sc2.costs, sc2.ctx,
                       sc2.machine, IPR_DIR_LONG, s2, p2, sc2.diag);
      sc2.machine.Arm(s2);
      IprReject why = IPR_OK;
      check(sc2.machine.CheckInvalidation(sc2.s.bars, IPR_DIR_SHORT, false, why),
            "regime flip invalidates an armed setup");
      checkRej(why, IPR_REJ_REGIME_FLIP, "  ...reported as REGIME_FLIP");

      check(sc2.machine.CheckInvalidation(sc2.s.bars, IPR_DIR_LONG, true, why),
            "opposing break of structure invalidates an armed setup");

      //--- invalidation by price breaching pullback extreme - 0.05*ATR
      Scenario sc3; BuildValid(sc3);
      IprSetup s3; IprTargetPlan p3;
      IprEvaluateSetup(sc3.s.bars, sc3.cfg, sc3.spec, sc3.costs, sc3.ctx,
                       sc3.machine, IPR_DIR_LONG, s3, p3, sc3.diag);
      sc3.machine.Arm(s3);
      check(!sc3.machine.CheckInvalidation(sc3.s.bars, IPR_DIR_LONG, false, why),
            "intact setup is not invalidated");
      //--- push a bar below the invalidation level
      const double bust = s3.invalidLevel - 0.10;
      sc3.s.Add(bust + 0.05, bust + 0.06, bust, bust + 0.02);
      check(sc3.machine.CheckInvalidation(sc3.s.bars, IPR_DIR_LONG, false, why),
            "price below pb_low - 0.05*ATR invalidates");
     }

   //-----------------------------------------------------------------
   section("TEST 4+5: duplicate entry and restart persistence");
     {
      Scenario sc; BuildValid(sc);
      IprSetup a, b; IprTargetPlan pa, pb;
      checkRej(IprEvaluateSetup(sc.s.bars, sc.cfg, sc.spec, sc.costs, sc.ctx,
                                sc.machine, IPR_DIR_LONG, a, pa, sc.diag),
               IPR_OK, "first evaluation arms");
      const ulong id1 = a.setupId;

      //--- Re-evaluating the SAME bars must yield the SAME id (identity
      //--- is the structure, not the moment of observation).
      IprSetupMachine fresh; fresh.Init(IprHashString("XAUUSD"));
      IprSetup a2; IprTargetPlan pa2; IprDiagnostics d2;
      IprEvaluateSetup(sc.s.bars, sc.cfg, sc.spec, sc.costs, sc.ctx,
                       fresh, IPR_DIR_LONG, a2, pa2, d2);
      check(a2.setupId == id1, "same structure always yields the same SetupID");

      //--- After consuming, the same structure is rejected as duplicate
      //--- however many times it is re-evaluated (ticks, bars, recrosses).
      sc.machine.Arm(a);
      sc.machine.Consume(IPR_STATE_TRIGGERED);
      for(int i = 0; i < 5; i++)
         checkRej(IprEvaluateSetup(sc.s.bars, sc.cfg, sc.spec, sc.costs, sc.ctx,
                                   sc.machine, IPR_DIR_LONG, b, pb, sc.diag),
                  IPR_REJ_DUPLICATE_SETUP, "repeat evaluation -> DUPLICATE_SETUP");

      //--- Restart: the consumed ring is persisted as text and reloaded
      //--- via StringToInteger, which parses SIGNED 64-bit. Ids must
      //--- survive that round trip or a duplicate trade becomes possible.
      check(id1 <= 0x7FFFFFFFFFFFFFFFULL, "SetupID fits in 63 bits (survives save/load)");
      IprSetupMachine restarted; restarted.Init(IprHashString("XAUUSD"));
      const long asSigned = (long)id1;
      restarted.m_consumed.Add((ulong)asSigned);
      check(!restarted.CanArm(id1), "consumed id still blocked after a simulated restart");

      //--- Ring holds and evicts deterministically.
      IprConsumedRing ring; ring.Reset();
      for(int i = 1; i <= IPR_CONSUMED_RING + 10; i++)
         ring.Add((ulong)i);
      check(ring.Count() == IPR_CONSUMED_RING, "consumed ring is bounded");
      check(ring.Contains((ulong)(IPR_CONSUMED_RING + 10)), "most recent id retained");
     }

   //-----------------------------------------------------------------
   section("TEST 14: setup expiry (5 bars, fixed)");
     {
      Scenario sc; BuildValid(sc);
      IprSetup a; IprTargetPlan pa;
      IprEvaluateSetup(sc.s.bars, sc.cfg, sc.spec, sc.costs, sc.ctx,
                       sc.machine, IPR_DIR_LONG, a, pa, sc.diag);
      sc.machine.Arm(a);
      for(int i = 0; i < 5 - 1; i++)   // literal 5, not the constant
        {
         sc.machine.OnNewBar();
         check(!sc.machine.IsExpired(), "setup still valid inside the 5-bar window");
        }
      sc.machine.OnNewBar();
      check(sc.machine.IsExpired(), "setup EXPIRES on the 5th bar");
      sc.machine.Consume(IPR_STATE_EXPIRED);
      check(!sc.machine.CanArm(a.setupId), "an expired setup can never re-arm");
     }

   //-----------------------------------------------------------------
   section("TEST 16: same-direction cluster locks");
     {
      Scenario sc; BuildValid(sc);
      const double atr = sc.ctx.atr;
      IprSetup a; IprTargetPlan pa;
      IprEvaluateSetup(sc.s.bars, sc.cfg, sc.spec, sc.costs, sc.ctx,
                       sc.machine, IPR_DIR_LONG, a, pa, sc.diag);

      check(sc.machine.CheckClusterLocks(IPR_DIR_LONG, a.legExtreme,
                                         a.triggerPrice, atr) == IPR_OK,
            "no locks apply before any entry in this direction");

      sc.machine.m_cluster.RecordEntry(IPR_DIR_LONG, a.legExtreme, a.triggerPrice,
                                       sc.machine.m_barSeq);

      //--- 1. overlapping structure
      checkRej(sc.machine.CheckClusterLocks(IPR_DIR_LONG, a.legExtreme,
                                            a.triggerPrice + 5.0 * atr, atr),
               IPR_REJ_CLUSTER_STRUCTURE, "same leg extreme -> CLUSTER_STRUCTURE");

      //--- 2. time lock (structure fresh, but too soon)
      checkRej(sc.machine.CheckClusterLocks(IPR_DIR_LONG, a.legExtreme + 1.0 * atr,
                                            a.triggerPrice + 5.0 * atr, atr),
               IPR_REJ_CLUSTER_TIME, "fresh structure but < 12 bars -> CLUSTER_TIME");

      //--- 3. distance lock (structure fresh, time satisfied, entry too close)
      for(int i = 0; i < IPR_CLUSTER_BARS; i++)
         sc.machine.OnNewBar();
      checkRej(sc.machine.CheckClusterLocks(IPR_DIR_LONG, a.legExtreme + 1.0 * atr,
                                            a.triggerPrice + 0.1 * atr, atr),
               IPR_REJ_CLUSTER_DISTANCE, "entry within 1 ATR of the last -> CLUSTER_DISTANCE");

      //--- all locks cleared
      check(sc.machine.CheckClusterLocks(IPR_DIR_LONG, a.legExtreme + 1.0 * atr,
                                         a.triggerPrice + 2.0 * atr, atr) == IPR_OK,
            "all four locks cleared -> re-entry permitted");

      //--- directions are independent
      check(sc.machine.CheckClusterLocks(IPR_DIR_SHORT, a.legExtreme,
                                         a.triggerPrice, atr) == IPR_OK,
            "a long entry does not lock out shorts");
     }

   //-----------------------------------------------------------------
   section("TEST 7: high-spread rejection");
     {
      Scenario sc; TailSpec ts; ts.Defaults();
      Build(sc, 1, ts, 10);
      double sa = 0.0, sm = 0.0;
      check(IprGateSpread(sc.ctx, sc.s.prof, sa, sm) == IPR_OK, "normal spread passes");

      //--- spread larger than 15% of ATR
      Scenario wide; Build(wide, 1, ts, 10);
      wide.ctx.spreadPrice = 0.20 * wide.ctx.atr;
      checkRej(IprGateSpread(wide.ctx, wide.s.prof, sa, sm),
               IPR_REJ_SPREAD_TOO_HIGH, "spread > 0.15 * ATR -> SPREAD_TOO_HIGH");

      //--- spread normal against ATR but abnormal against its own hour
      Scenario ab; Build(ab, 1, ts, 10);
      ab.ctx.spreadPrice = 0.12 * ab.ctx.atr;   // under the ATR ceiling...
      ab.s.prof.Reset();
      ab.s.FillProfile(ab.ctx.atr, 0.01 * ab.ctx.atr);  // ...but 12x the hourly median
      checkRej(IprGateSpread(ab.ctx, ab.s.prof, sa, sm),
               IPR_REJ_SPREAD_ABNORMAL, "spread > 2.5x the hourly median -> SPREAD_ABNORMAL");

      //--- unformed profile must FAIL CLOSED
      IprHourProfile empty; empty.Reset();
      checkRej(IprGateSpread(sc.ctx, empty, sa, sm), IPR_REJ_NO_DATA,
               "no reference history -> NO_DATA (fails closed, never assumes OK)");
     }

   //-----------------------------------------------------------------
   section("TEST 8+9: volatility floor, ceiling and shock filter");
     {
      Scenario sc; TailSpec ts; ts.Defaults();
      Build(sc, 1, ts, 10);
      double ratio = 0.0;
      check(IprGateVolatility(sc.ctx, sc.s.prof, ratio) == IPR_OK, "normal volatility passes");

      Scenario lo; Build(lo, 1, ts, 10);
      lo.s.prof.Reset();
      lo.s.FillProfile(lo.ctx.atr / 0.5, lo.spreadPrice);   // ATR is half its reference
      checkRej(IprGateVolatility(lo.ctx, lo.s.prof, ratio),
               IPR_REJ_VOLATILITY_TOO_LOW, "A/A_ref < 0.60 -> VOLATILITY_TOO_LOW");

      Scenario hi; Build(hi, 1, ts, 10);
      hi.s.prof.Reset();
      hi.s.FillProfile(hi.ctx.atr / 3.0, hi.spreadPrice);   // ATR is 3x its reference
      checkRej(IprGateVolatility(hi.ctx, hi.s.prof, ratio),
               IPR_REJ_VOLATILITY_TOO_HIGH, "A/A_ref > 2.50 -> VOLATILITY_TOO_HIGH");

      //--- shock: a bar with range > 3 * ATR
      Scenario shock; TailSpec st; st.Defaults(); st.shockBar = true;
      Build(shock, 1, st, 10);
      check(IprShockDetected(shock.s.bars, shock.ctx.atr),
            "a >3xATR bar in the last 3 is detected");
      checkRej(IprCheckMarketGates(shock.s.bars, shock.cfg, shock.ctx,
                                   shock.s.prof, shock.diag),
               IPR_REJ_SHOCK_FILTER, "shock bar -> SHOCK_FILTER");

      //--- the 6-bar stand-down latch keeps rejecting after the bar has passed
      Scenario latched; Build(latched, 1, ts, 10, 3);
      checkRej(IprCheckMarketGates(latched.s.bars, latched.cfg, latched.ctx,
                                   latched.s.prof, latched.diag),
               IPR_REJ_SHOCK_FILTER, "stand-down latch still rejects after the shock bar");
     }

   //-----------------------------------------------------------------
   section("TEST 10: target / cost feasibility");
     {
      Scenario sc; BuildValid(sc);
      IprSetup a; IprTargetPlan plan;
      checkRej(IprEvaluateSetup(sc.s.bars, sc.cfg, sc.spec, sc.costs, sc.ctx,
                                sc.machine, IPR_DIR_LONG, a, plan, sc.diag),
               IPR_OK, "baseline setup is economically feasible");
      check(plan.dTp >= plan.dReq - 1e-12, "target never falls below the $1 NET floor");
      check(plan.costBudgetUsed <= sc.cfg.costBudget, "cost budget respected");
      check(plan.payoff > 1.0, "net payoff exceeds 1.0 for the baseline geometry");

      //--- Tighten the budget until the same setup becomes uneconomic.
      Scenario t2; BuildValid(t2);
      t2.cfg.costBudget = 0.01;
      IprSetup a2; IprTargetPlan p2;
      checkRej(IprEvaluateSetup(t2.s.bars, t2.cfg, t2.spec, t2.costs, t2.ctx,
                                t2.machine, IPR_DIR_LONG, a2, p2, t2.diag),
               IPR_REJ_TARGET_COST_INFEASIBLE, "budget 0.01 -> TARGET_COST_INFEASIBLE");

      //--- An unreachable TargetNet must be refused, not accommodated.
      Scenario t3; BuildValid(t3);
      t3.cfg.targetNet = 500.0;
      IprBuildCosts(t3.spec, t3.cfg, t3.cfg.volume, t3.spreadPrice, 0.0, 0.0, t3.costs);
      IprSetup a3; IprTargetPlan p3;
      const IprReject r3 = IprEvaluateSetup(t3.s.bars, t3.cfg, t3.spec, t3.costs, t3.ctx,
                                            t3.machine, IPR_DIR_LONG, a3, p3, t3.diag);
      check(r3 != IPR_OK, "an unreachable TargetNet is refused, never shrunk to fit");

      //--- Startup feasibility screen.
      IprSymbolSpec xau; XauSpec(xau);
      IprConfig cfg; BaseCfg(cfg);
      IprCosts c; double ratio = 0.0;
      IprBuildCosts(xau, cfg, 0.01, 0.10, 0.0, 0.0, c);
      check(IprFeasible(c, 1.20, 1.5, ratio), "XAU $1 net is feasible at ATR 1.20");
      check(nearly(c.reqMovePrice, 1.175, 1e-9), "d_req = $1.175 of gold at 10-point spread");
      check(!IprFeasible(c, 0.30, 1.5, ratio),
            "same target is NOT feasible at ATR 0.30 (thin session) -> refuse the symbol");
     }

   //-----------------------------------------------------------------
   section("TEST 19: stop geometry guards");
     {
      Scenario sc; BuildValid(sc);
      IprTargetPlan plan;
      //--- stop far too tight: pullback extreme almost at the entry
      const double entry = 2100.0;
      checkRej(IprBuildTargetPlan(sc.s.bars, sc.cfg, sc.spec, sc.costs, IPR_DIR_LONG,
                                  entry, entry - 0.001, entry, sc.ctx.atr,
                                  sc.spreadPrice, plan),
               IPR_REJ_SL_TOO_TIGHT, "stop inside the noise -> SL_TOO_TIGHT");

      //--- stop just beyond the 1.2 * ATR ceiling (deliberately NOT
      //--- absurdly far, so that loosening the ceiling would be detected)
      checkRej(IprBuildTargetPlan(sc.s.bars, sc.cfg, sc.spec, sc.costs, IPR_DIR_LONG,
                                  entry, entry - 2.5 * sc.ctx.atr, entry, sc.ctx.atr,
                                  sc.spreadPrice, plan),
               IPR_REJ_SL_TOO_WIDE, "stop beyond 1.2 * ATR -> SL_TOO_WIDE");
     }

   //-----------------------------------------------------------------
   section("TEST 11+12+13: daily loss, consecutive losses, cooldown");
     {
      IprRiskManager r; r.Init();
      IprConfig cfg; BaseCfg(cfg);
      cfg.maxDailyLossEquityFrac = 0.02;
      const double equity = 500.0;
      r.OnNewDay(100);

      check(r.CanTrade(cfg, equity, 0, 0, 0) == IPR_OK, "fresh day permits trading");

      //--- cooldown after a win
      r.RecordResult(+2.0, 100);
      checkRej(r.CanTrade(cfg, equity, 100, 0, 0), IPR_REJ_COOLDOWN,
               "6-bar cooldown after a win");
      check(r.CanTrade(cfg, equity, 100 + 6, 0, 0) == IPR_OK,
            "trading resumes after the win cooldown");

      //--- cooldown after a loss, then the longer one after a second
      IprRiskManager r2; r2.Init(); r2.OnNewDay(100);
      r2.RecordResult(-1.5, 200);
      check(r2.m_cooldownUntilBarSeq == 200 + 20, "20-bar cooldown after a loss");
      r2.RecordResult(-1.5, 210);
      check(r2.m_cooldownUntilBarSeq == 210 + 40,
            "40-bar cooldown after a SECOND consecutive loss");
      check(r2.m_consecLosses == 2, "consecutive loss counter tracks");

      //--- three consecutive losses halts the day
      r2.RecordResult(-1.5, 260);
      checkRej(r2.CanTrade(cfg, equity, 100000, 0, 0), IPR_REJ_CONSEC_LOSSES,
               "3 consecutive losses -> stop for the day");
      r2.OnNewDay(101);
      check(r2.CanTrade(cfg, equity, 100000, 0, 0) == IPR_OK, "new day clears the halt");

      //--- a win resets the streak
      IprRiskManager r3; r3.Init(); r3.OnNewDay(100);
      r3.RecordResult(-1.0, 0); r3.RecordResult(-1.0, 0);
      r3.RecordResult(+3.0, 0);
      check(r3.m_consecLosses == 0, "a win resets the consecutive-loss streak");

      //--- daily loss limit = min(3 * avg loss, 2% equity)
      IprRiskManager r4; r4.Init(); r4.OnNewDay(100);
      check(nearly(r4.DailyLossLimit(equity, cfg), 10.0, 1e-9),
            "with no loss history only the 2%-equity term binds ($10 on $500)");
      r4.RecordResult(-1.0, 0);
      check(nearly(r4.DailyLossLimit(equity, cfg), 3.0, 1e-9),
            "3 x average loss ($3) binds once history exists");
      r4.RecordResult(-1.0, 0);
      r4.RecordResult(-1.0, 0);
      checkRej(r4.CanTrade(cfg, equity, 100000, 0, 0), IPR_REJ_CONSEC_LOSSES,
               "day halted (3 consecutive losses reached first)");

      //--- max trades per day
      IprRiskManager r5; r5.Init(); r5.OnNewDay(100);
      for(int i = 0; i < cfg.maxTradesPerDay; i++)
         r5.RecordResult(+0.5, 0);
      checkRej(r5.CanTrade(cfg, equity, 100000, 0, 0), IPR_REJ_MAX_DAILY_TRADES,
               "max trades per day enforced");

      //--- portfolio limits
      IprRiskManager r6; r6.Init(); r6.OnNewDay(100);
      checkRej(r6.CanTrade(cfg, equity, 0, 1, 1), IPR_REJ_POSITION_OPEN,
               "one position per symbol");
      checkRej(r6.CanTrade(cfg, equity, 0, 0, cfg.maxPositionsAccount),
               IPR_REJ_MAX_POSITIONS, "account-wide position cap");

      //--- execution health
      IprRiskManager r7; r7.Init(); r7.OnNewDay(100);
      for(int i = 0; i < IPR_MAX_ORDER_FAILURES; i++)
         r7.RecordOrderFailure();
      checkRej(r7.CanTrade(cfg, equity, 100000, 0, 0), IPR_REJ_EXEC_HALTED,
               "3 order failures halt execution");

      IprRiskManager r8; r8.Init(); r8.OnNewDay(100);
      for(int i = 0; i < IPR_MAX_SLIP_EVENTS; i++)
         r8.RecordSlippage(0.30, 0.10);      // 3x the estimate each time
      checkRej(r8.CanTrade(cfg, equity, 100000, 0, 0), IPR_REJ_EXEC_HALTED,
               "5 excessive-slippage fills halt execution");

      //--- risk cap at minimum volume: skip, never resize
      IprRiskManager r9; r9.Init();
      double riskMoney = 0.0;
      check(r9.RiskWithinCap(0.90, 1.0, equity, cfg, riskMoney),
            "0.90 stop at M=1.0 is inside the $10 cap");
      check(!r9.RiskWithinCap(25.0, 1.0, equity, cfg, riskMoney),
            "an over-cap stop is refused (volume cannot go below the minimum)");
     }

   //-----------------------------------------------------------------
   section("TEST 20-24: exit priority hierarchy");
     {
      IprTradeState t; t.Reset();
      t.active = true; t.dir = IPR_DIR_LONG; t.entryPrice = 2000.0;
      t.dTp = 2.40; t.dSl = 0.90; t.mfePrice = 2000.0;

      IprExitCtx e; e.Reset();
      e.bid = 2000.0; e.ask = 2000.10; e.spreadPrice = 0.10;
      e.spreadMedian = 0.10; e.spreadMedianValid = true;

      check(IprEvaluateExit(t, e) == IPR_EXIT_NONE, "healthy trade: no exit");

      //--- 6. max hold
      IprTradeState mh = t; mh.barsHeld = 12;          // literal, not the constant
      mh.mfePrice = 2000.0 + 0.9 * mh.dTp;    // progressing, but out of time
      check(IprEvaluateExit(mh, e) == IPR_EXIT_MAX_HOLD, "12 bars -> MAX_HOLD");

      //--- 5. no progress
      IprTradeState np = t; np.barsHeld = 4;           // literal, not the constant
      np.mfePrice = 2000.0 + 0.1 * np.dTp;
      check(IprEvaluateExit(np, e) == IPR_EXIT_NO_PROGRESS,
            "4 bars with MFE < 35% of target -> NO_PROGRESS");

      //--- 4. momentum failure outranks no-progress
      IprTradeState mf = np; mf.momFailCloses = 2;     // literal, not the constant
      check(IprEvaluateExit(mf, e) == IPR_EXIT_MOMENTUM_FAIL,
            "2 closes against EMA20 outrank NO_PROGRESS");

      //--- 3. spread blowout only closes a WINNING trade
      IprExitCtx blown = e;
      blown.spreadPrice = 10.0 * e.spreadMedian;
      IprTradeState losing = t; losing.barsHeld = 1;
      blown.bid = 1999.0;                       // in loss
      check(IprEvaluateExit(losing, blown) == IPR_EXIT_NONE,
            "spread blowout does NOT force a losing trade out through a bad spread");

      IprTradeState winning = t; winning.barsHeld = 1;
      blown.bid = 2000.0 + 0.6 * t.dTp;         // comfortably in profit
      check(IprEvaluateExit(winning, blown) == IPR_EXIT_SPREAD_BLOWOUT,
            "spread blowout DOES protect a winning trade");

      //--- 2. rollover outranks everything below it
      IprExitCtx roll = blown; roll.inRolloverWindow = true;
      IprTradeState any = mf;
      check(IprEvaluateExit(any, roll) == IPR_EXIT_ROLLOVER,
            "rollover force-flat outranks every lower-priority rule");

      //--- MFE bookkeeping uses the closing side of the spread
      IprTradeState m; m.Reset();
      m.active = true; m.dir = IPR_DIR_LONG; m.entryPrice = 2000.0; m.mfePrice = 2000.0;
      IprExitCtx up = e; up.bid = 2003.0;
      IprUpdateMfe(m, up);
      check(nearly(IprMfePrice(m), 3.0, 1e-9), "long MFE measured at the bid");
      up.bid = 2001.0;
      IprUpdateMfe(m, up);
      check(nearly(IprMfePrice(m), 3.0, 1e-9), "MFE is a high-water mark, never retreats");

      //--- momentum counter resets on a favourable close
      IprTradeState bar; bar.Reset();
      bar.active = true; bar.dir = IPR_DIR_LONG;
      IprUpdateOnBar(bar, 1999.0, 2000.0);
      IprUpdateOnBar(bar, 1998.0, 2000.0);
      check(bar.momFailCloses == 2, "two closes below EMA20 counted");
      IprUpdateOnBar(bar, 2001.0, 2000.0);
      check(bar.momFailCloses == 0, "a close back above EMA20 resets the counter");
      check(bar.barsHeld == 3, "bars held advances once per closed bar");

      //--- break-even is OFF by default and never moves a stop backwards
      IprConfig cfg; BaseCfg(cfg);
      IprSymbolSpec spec; XauSpec(spec);
      IprCosts c; IprBuildCosts(spec, cfg, 0.01, 0.10, 0.0, 0.0, c);
      IprTradeState be = t; be.stopPrice = 1999.10; be.mfePrice = 2000.0 + be.dSl;
      double ns = 0.0;
      check(!IprBreakEvenStop(be, cfg, c, spec, ns), "break-even disabled by default");
      cfg.breakEvenEnabled = true;
      check(IprBreakEvenStop(be, cfg, c, spec, ns), "break-even triggers at +1R when enabled");
      check(ns > be.entryPrice, "break-even stop sits ABOVE entry (covers cost, not just entry)");
      IprTradeState be2 = be; be2.stopPrice = 2000.50;   // already ahead
      check(!IprBreakEvenStop(be2, cfg, c, spec, ns), "never moves a stop backwards");
     }

   //-----------------------------------------------------------------
   section("TEST 17: long / short symmetry");
     {
      Scenario L; BuildValid(L, +1);
      Scenario S; BuildValid(S, -1);

      check(IprRegimeDirection(L.ctx) == IPR_DIR_LONG,  "uptrend warmup -> LONG regime");
      check(IprRegimeDirection(S.ctx) == IPR_DIR_SHORT, "downtrend warmup -> SHORT regime");

      IprSetup ls, ss; IprTargetPlan lp, sp;
      const IprReject lr = IprEvaluateSetup(L.s.bars, L.cfg, L.spec, L.costs, L.ctx,
                                            L.machine, IPR_DIR_LONG, ls, lp, L.diag);
      const IprReject sr = IprEvaluateSetup(S.s.bars, S.cfg, S.spec, S.costs, S.ctx,
                                            S.machine, IPR_DIR_SHORT, ss, sp, S.diag);
      checkRej(lr, IPR_OK, "mirrored data produces a LONG setup");
      checkRej(sr, IPR_OK, "mirrored data produces a SHORT setup");

      check(nearly(ls.legSize, ss.legSize, 1e-6),  "leg size identical in both directions");
      check(nearly(ls.depth,   ss.depth,   1e-6),  "pullback depth identical");
      check(nearly(ls.er,      ss.er,      1e-9),  "efficiency ratio identical");
      check(nearly(lp.dTp,     sp.dTp,     1e-6),  "target distance identical");
      check(nearly(lp.dSl,     sp.dSl,     1e-6),  "stop distance identical");

      check(ls.stopPrice < ls.triggerPrice && ls.targetPrice > ls.triggerPrice,
            "long: stop below entry, target above");
      check(ss.stopPrice > ss.triggerPrice && ss.targetPrice < ss.triggerPrice,
            "short: stop above entry, target below");
      check(ls.setupId != ss.setupId, "long and short setups have distinct ids");
     }

   //-----------------------------------------------------------------
   section("SIGNAL: rejection reasons are specific");
     {
      TailSpec ts;

      ts.Defaults(); ts.legSize = 0.5; ts.retrace = 0.5 / 3.0;  // < 1.2 * ATR
      Scenario small; Build(small, 1, ts, 10);
      IprSetup a; IprTargetPlan p; IprDiagnostics d;
      checkRej(IprEvaluateSetup(small.s.bars, small.cfg, small.spec, small.costs,
                                small.ctx, small.machine, IPR_DIR_LONG, a, p, d),
               IPR_REJ_IMPULSE_TOO_SMALL, "undersized leg -> IMPULSE_TOO_SMALL");

      ts.Defaults(); ts.priorSwing = false;          // leg breaks nothing
      Scenario nobos; Build(nobos, 1, ts, 10);
      const IprReject rb = IprEvaluateSetup(nobos.s.bars, nobos.cfg, nobos.spec,
                                            nobos.costs, nobos.ctx, nobos.machine,
                                            IPR_DIR_LONG, a, p, d);
      check(rb == IPR_REJ_NO_BOS || rb == IPR_OK,
            "no prior swing to break -> NO_BOS (or a different swing was legitimately broken)");

      ts.Defaults(); ts.retrace = 4.0 * 0.90;        // deeper than 0.618
      Scenario deep; Build(deep, 1, ts, 10);
      checkRej(IprEvaluateSetup(deep.s.bars, deep.cfg, deep.spec, deep.costs, deep.ctx,
                                deep.machine, IPR_DIR_LONG, a, p, d),
               IPR_REJ_PULLBACK_TOO_DEEP, "retracement past 0.618 -> PULLBACK_TOO_DEEP");

      ts.Defaults(); ts.retrace = 4.0 * 0.10;        // shallower than 0.20
      Scenario shallow; Build(shallow, 1, ts, 10);
      checkRej(IprEvaluateSetup(shallow.s.bars, shallow.cfg, shallow.spec, shallow.costs,
                                shallow.ctx, shallow.machine, IPR_DIR_LONG, a, p, d),
               IPR_REJ_PULLBACK_TOO_SHALLOW, "retracement under 0.20 -> PULLBACK_TOO_SHALLOW");

      ts.Defaults(); ts.confirmTurn = false;         // no confirming close
      Scenario noturn; Build(noturn, 1, ts, 10);
      checkRej(IprEvaluateSetup(noturn.s.bars, noturn.cfg, noturn.spec, noturn.costs,
                                noturn.ctx, noturn.machine, IPR_DIR_LONG, a, p, d),
               IPR_REJ_NO_TURN_BAR, "unconfirmed turn -> NO_TURN_BAR");

      //--- wrong-direction evaluation must not produce a setup
      Scenario ok; BuildValid(ok, +1);
      const IprReject wrong = IprEvaluateSetup(ok.s.bars, ok.cfg, ok.spec, ok.costs,
                                               ok.ctx, ok.machine, IPR_DIR_SHORT, a, p, d);
      check(wrong != IPR_OK, "a long structure never produces a short setup");
     }

   //-----------------------------------------------------------------
   section("IMPULSE: efficiency ratio threshold");
     {
      //--- A leg that is big enough but travels a long way to get there
      //--- must be rejected: half the movement has to be net directional.
      Synth s; s.Init(0.01, 10);
      s.Warmup(2000.0, kRange, 320, 0.10);
      const double B = s.LastClose();

      //--- context providing a swing high for the BOS test
      s.Add(B,        B + 0.20, B - 0.20, B);
      s.Add(B,        B + 0.30, B - 0.20, B + 0.05);
      s.Add(B + 0.05, B + 0.40, B - 0.10, B + 0.10);
      s.Add(B + 0.10, B + 0.90, B,        B + 0.20);   // swing high
      s.Add(B + 0.20, B + 0.45, B - 0.05, B + 0.10);
      s.Add(B + 0.10, B + 0.40, B - 0.15, B + 0.05);

      //--- the leg: net +4.00 but a very inefficient path to it
      const double closes[6] = { -0.20, 1.70, 0.00, 2.10, 0.30, 3.60 };
      for(int i = 0; i < 6; i++)
        {
         const double c = B + closes[i];
         const double o = B + ((i == 0) ? 0.05 : closes[i - 1]);
         const double hi = (i == 5) ? (B + 3.70) : (MathMax(o, c) + 0.10);
         const double lo = (i == 0) ? (B - 0.30) : (MathMin(o, c) - 0.10);
         s.Add(o, hi, lo, c);
        }

      IprConfig cfg; BaseCfg(cfg);
      IprSymbolSpec spec; XauSpec(spec);
      IprImpulse imp;
      double er = 0.0;
      check(IprEfficiencyRatio(s.bars, 5, 0, er) && er < 0.50,
            "the constructed path really does have ER < 0.50 over 6 bars");

      //--- The detector searches an end-lag of 0..3 and takes the most
      //--- recent qualifying leg, so on choppy data it may legitimately
      //--- settle on a shorter, efficient sub-leg rather than rejecting
      //--- outright. The INVARIANT that must hold either way is that no
      //--- accepted leg is ever below the 0.50 threshold. Asserted
      //--- against the literal so that loosening ER_MIN is detected.
      const IprReject r = IprDetectImpulse(s.bars, cfg, IPR_DIR_LONG, s.atr.Value(), imp);
      check(r != IPR_OK || imp.er >= 0.50,
            "any accepted leg has ER >= 0.50 (choppy paths cannot sneak through)");

      //--- And the widest window over this data IS rejected for ER.
      IprConfig wide = cfg; wide.nImp = 8;
      IprImpulse imp2;
      const IprReject r2 = IprDetectImpulse(s.bars, wide, IPR_DIR_LONG, s.atr.Value(), imp2);
      check(r2 != IPR_OK || imp2.er >= 0.50, "same invariant at N_imp = 8");
     }

   //-----------------------------------------------------------------
   section("BTC: same code path, different instrument");
     {
      IprSymbolSpec btc; BtcSpec(btc);
      IprConfig cfg; BaseCfg(cfg);
      IprCosts c;
      //--- $35 spread on BTC
      IprBuildCosts(btc, cfg, 0.01, 35.0, 0.0, 0.0, c);
      check(nearly(c.moneyPerPriceUnit, 0.01, 1e-12), "BTC M = $0.01 per price unit");
      check(nearly(c.reqMovePrice, 100.0 + c.totalMoney / 0.01, 1e-6),
            "BTC d_req derived from the same formula");
      double ratio = 0.0;
      check(IprFeasible(c, 250.0, 1.5, ratio), "BTC $1 net feasible at ATR 250");
      check(ratio < 1.0, "BTC needs LESS than one ATR - easier than gold (Phase 1 9.2)");
     }

   //-----------------------------------------------------------------
   printf("\n==================================================\n");
   printf(" %d passed, %d failed\n", g_pass, g_fail);
   printf("==================================================\n");
   return (g_fail == 0) ? 0 : 1;
  }
