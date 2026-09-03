// funnel.cpp - rejection-funnel diagnostic.
//
// Runs the REAL strategy pipeline (same headers the EA uses) over a
// synthetic year of gold-like M5 bars and counts why each bar failed to
// produce a setup. Synthetic data is not real XAUUSD, but gross
// over-restriction shows up immediately: if a gate rejects ~100% of
// bars, that is a property of the rule, not of the data.
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
#include "../MQL5/Include/IPR/SignalEngine.mqh"

#include <cstdio>
#include <cstring>
#include <random>
#include <map>
#include <string>
#include <vector>
#include <set>

static const char *RejName(IprReject r)
  {
   switch(r)
     {
      case IPR_OK: return "OK";
      case IPR_REJ_NO_DATA: return "NO_DATA";
      case IPR_REJ_SESSION: return "SESSION";
      case IPR_REJ_VOLATILITY_TOO_LOW: return "VOLATILITY_TOO_LOW";
      case IPR_REJ_VOLATILITY_TOO_HIGH: return "VOLATILITY_TOO_HIGH";
      case IPR_REJ_SPREAD_TOO_HIGH: return "SPREAD_TOO_HIGH";
      case IPR_REJ_SPREAD_ABNORMAL: return "SPREAD_ABNORMAL";
      case IPR_REJ_SHOCK_FILTER: return "SHOCK_FILTER";
      case IPR_REJ_REGIME_FLAT: return "REGIME_FLAT";
      case IPR_REJ_NO_IMPULSE: return "NO_IMPULSE";
      case IPR_REJ_IMPULSE_TOO_SMALL: return "IMPULSE_TOO_SMALL";
      case IPR_REJ_ER_TOO_LOW: return "ER_TOO_LOW";
      case IPR_REJ_NO_BOS: return "NO_BOS";
      case IPR_REJ_NO_PULLBACK: return "NO_PULLBACK";
      case IPR_REJ_PULLBACK_TOO_SHALLOW: return "PULLBACK_TOO_SHALLOW";
      case IPR_REJ_PULLBACK_TOO_DEEP: return "PULLBACK_TOO_DEEP";
      case IPR_REJ_PULLBACK_TOO_LONG: return "PULLBACK_TOO_LONG";
      case IPR_REJ_PULLBACK_TOO_FAST: return "PULLBACK_TOO_FAST";
      case IPR_REJ_NO_TURN_BAR: return "NO_TURN_BAR";
      case IPR_REJ_DUPLICATE_SETUP: return "DUPLICATE_SETUP";
      case IPR_REJ_NO_STRUCTURE_ROOM: return "NO_STRUCTURE_ROOM";
      case IPR_REJ_TARGET_COST_INFEASIBLE: return "TARGET_COST_INFEASIBLE";
      case IPR_REJ_SL_TOO_TIGHT: return "SL_TOO_TIGHT";
      case IPR_REJ_SL_TOO_WIDE: return "SL_TOO_WIDE";
      case IPR_REJ_STOPS_LEVEL: return "STOPS_LEVEL";
      case IPR_REJ_FEASIBILITY: return "FEASIBILITY";
      default: return "OTHER";
     }
  }

// Gold-like intraday profile (server time assumed ~UTC).
static double VolMult(int h)
  {
   if(h < 6)  return 0.40;              // Asia
   if(h < 7)  return 0.60;
   if(h < 12) return 1.00;              // London
   if(h < 17) return 1.30;              // NY overlap
   if(h < 21) return 0.70;
   return 0.40;                         // late
  }
static double SpreadMult(int h)
  {
   if(h < 6)  return 2.5;
   if(h < 7)  return 1.6;
   if(h < 12) return 1.0;
   if(h < 17) return 1.0;
   if(h < 21) return 1.3;
   return 2.5;
  }

int main(int argc, char **argv)
  {
   double baseSigma = 0.62;             // tuned so active-hour ATR ~ 1.2
   double baseSpread = 0.18;            // typical ECN gold
   int    nImp = 6;
   double lMin = 1.2, tpMult = 2.0, budget = 0.12;
   bool   noSession = false;

   for(int i = 1; i < argc; i++)
     {
      if(!strncmp(argv[i], "--spread=", 9))  baseSpread = atof(argv[i] + 9);
      if(!strncmp(argv[i], "--sigma=", 8))   baseSigma = atof(argv[i] + 8);
      if(!strncmp(argv[i], "--nimp=", 7))    nImp = atoi(argv[i] + 7);
      if(!strncmp(argv[i], "--lmin=", 7))    lMin = atof(argv[i] + 7);
      if(!strncmp(argv[i], "--tp=", 5))      tpMult = atof(argv[i] + 5);
      if(!strncmp(argv[i], "--budget=", 9))  budget = atof(argv[i] + 9);
      if(!strcmp(argv[i], "--nosession"))    noSession = true;
     }

   IprSymbolSpec spec; spec.Reset();
   spec.digits = 2; spec.point = 0.01; spec.tickSize = 0.01;
   spec.tickValue = 1.00; spec.contractSize = 100.0;
   spec.volMin = 0.01; spec.volMax = 100.0; spec.volStep = 0.01; spec.valid = true;

   IprConfig cfg; cfg.Reset();
   cfg.nImp = nImp; cfg.lMinMult = lMin; cfg.tpMult = tpMult; cfg.costBudget = budget;
   cfg.volume = 0.01; cfg.targetNet = 1.0; cfg.slipEstSpreadMult = 0.25;
   cfg.sessionFilterEnabled = !noSession;

   IprBars bars; bars.Reset();
   IprAtrState atr; atr.Init(IPR_ATR_PERIOD);
   IprEmaState emaF, emaS; emaF.Init(IPR_EMA_FAST); emaS.Init(IPR_EMA_SLOW);
   IprHourProfile prof; prof.Reset();
   IprSetupMachine machine; machine.Init(IprHashString("XAUUSD"));

   std::mt19937 rng(20260903);
   std::normal_distribution<double> N(0.0, 1.0);
   std::uniform_real_distribution<double> U(0.0, 1.0);

   double px = 2000.0;
   double drift = 0.0;                  // slow OU trend so real trends exist
   double volState = 0.0;               // AR(1) log-vol, i.e. volatility clustering

   long t = 1704067200L;                // 2024-01-01 00:00 UTC
   int curHour = -1; long curDay = 0;
   double hourEndAtr = 0.0, hourEndSpread = 0.0;
   int shockLatch = 0;

   std::map<std::string, long> gateRej, setupRej;
   long totalBars = 0, gatesPassed = 0, accepted = 0, warm = 0;
   long dirLong = 0, dirShort = 0;
   std::set<unsigned long long> uniqueSetups;

   const long BARS = 288L * 260L;       // ~1 trading year of M5

   for(long i = 0; i < BARS; i++, t += 300)
     {
      const int h = (int)((t % 86400) / 3600);
      const long day = t / 86400;
      const int dow = (int)((day + 4) % 7);          // 1970-01-01 was a Thursday
      if(dow == 6 || dow == 0) continue;             // skip weekends

      // hour boundary -> record the completed hour into the profile
      if(curHour >= 0 && h != curHour && hourEndAtr > 0.0)
         prof.Observe(curHour, curDay, hourEndAtr, hourEndSpread);
      curHour = h; curDay = day;

      // --- price process: OU drift + AR(1) stochastic volatility
      drift = 0.97 * drift + 0.03 * N(rng) * baseSigma * 0.45;
      volState = 0.98 * volState + 0.02 * N(rng);
      const double sig = baseSigma * VolMult(h) * exp(0.35 * volState);

      const double o = px;
      const double c = o + drift + sig * N(rng);
      const double wick = sig * 0.55;
      const double hi = std::max(o, c) + wick * fabs(N(rng));
      const double lo = std::min(o, c) - wick * fabs(N(rng));
      px = c;

      const double sprPrice = baseSpread * SpreadMult(h) * (1.0 + 0.25 * fabs(N(rng)));
      const int sprPts = (int)(sprPrice / spec.point + 0.5);

      IprBar b;
      b.time = t; b.open = o; b.high = hi; b.low = lo; b.close = c; b.spreadPts = sprPts;
      bars.Push(b);
      atr.Update(hi, lo, c); emaF.Update(c); emaS.Update(c);

      if(atr.Ready()) { hourEndAtr = atr.Value(); hourEndSpread = sprPrice; }
      if(shockLatch > 0) shockLatch--;
      if(atr.Ready() && (hi - lo) > IPR_SHOCK_ATR_MULT * atr.Value())
         shockLatch = IPR_SHOCK_STANDDOWN;

      if(!(atr.Ready() && emaF.Ready() && emaS.Ready())) { warm++; continue; }
      totalBars++;

      IprMarketCtx ctx; ctx.Reset();
      ctx.atr = atr.Value(); ctx.emaFast = emaF.Value(); ctx.emaSlow = emaS.Value();
      double ago = 0.0; ctx.emaAgoValid = emaF.Ago(IPR_EMA_SLOPE_BARS, ago);
      ctx.emaFastAgo = ago;
      ctx.spreadPrice = sprPrice; ctx.hour = h; ctx.dayKey = day; ctx.barTime = t;
      ctx.shockStandDownBars = shockLatch;

      IprDiagnostics diag;
      const IprReject g = IprCheckMarketGates(bars, cfg, ctx, prof, diag);
      if(g != IPR_OK) { gateRej[RejName(g)]++; continue; }
      gatesPassed++;
      if(diag.regimeDir == IPR_DIR_LONG) dirLong++; else dirShort++;

      IprCosts costs;
      IprBuildCosts(spec, cfg, cfg.volume, sprPrice, 0.0, 0.0, costs);

      IprSetup su; IprTargetPlan plan;
      const IprReject r = IprEvaluateSetup(bars, cfg, spec, costs, ctx, machine,
                                           diag.regimeDir, su, plan, diag);
      setupRej[RejName(r)]++;
      if(r == IPR_OK) { accepted++; uniqueSetups.insert((unsigned long long)su.setupId); }
     }

   printf("\n=== IPR rejection funnel: %ld synthetic M5 bars (~1 year, weekdays) ===\n", BARS);
   printf("config: nImp=%d lMin=%.2f tpMult=%.2f budget=%.2f spread=%.2f sigma=%.2f session=%s\n",
          nImp, lMin, tpMult, budget, baseSpread, baseSigma, noSession ? "OFF" : "ON");
   printf("realised ATR at end: %.3f\n", atr.Value());
   printf("warmup bars skipped : %ld\n", warm);
   printf("bars evaluated      : %ld\n", totalBars);

   printf("\n-- stage 1: market gates (G1..G4 + regime) --\n");
   long gr = 0; for(auto &kv : gateRej) gr += kv.second;
   for(auto &kv : gateRej)
      printf("   %-24s %8ld  (%5.1f%% of evaluated)\n",
             kv.first.c_str(), kv.second, 100.0 * kv.second / totalBars);
   printf("   %-24s %8ld  (%5.1f%%)\n", "PASSED GATES", gatesPassed,
          100.0 * gatesPassed / totalBars);
   printf("   regime split: LONG %ld / SHORT %ld\n", dirLong, dirShort);

   printf("\n-- stage 2: setup evaluation (of the %ld bars that passed) --\n", gatesPassed);
   for(auto &kv : setupRej)
      printf("   %-24s %8ld  (%5.1f%% of passed)\n",
             kv.first.c_str(), kv.second,
             gatesPassed ? 100.0 * kv.second / gatesPassed : 0.0);

   printf("\n-- per-hour reference profile (what the session gate actually sees) --\n");
   printf("   hour   medATR   medSPREAD   S/A     tradeable(<=0.15)?\n");
   for(int hh = 0; hh < 24; hh++)
     {
      double ma = 0.0, ms = 0.0;
      if(!prof.MedianAtr(hh, ma) || !prof.MedianSpread(hh, ms) || ma <= 0.0)
        { printf("   %02d     (no reference)\n", hh); continue; }
      const double ratio = ms / ma;
      printf("   %02d     %6.3f   %8.3f   %5.3f   %s\n", hh, ma, ms, ratio,
             (ratio <= 0.15) ? "yes" : "NO");
     }

   printf("\n>>> accepted bar-evaluations: %ld\n", accepted);
   printf(">>> DISTINCT SETUPS: %zu  (~%.2f per trading day)\n\n",
          uniqueSetups.size(), uniqueSetups.size() / 260.0);
   return 0;
  }
