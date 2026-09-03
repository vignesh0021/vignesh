//+------------------------------------------------------------------+
//| SignalEngine.mqh - orchestration of the IPR decision pipeline.   |
//|                                                                  |
//| Split into two entry points so that each can be tested and       |
//| logged independently:                                            |
//|                                                                  |
//|   IprCheckMarketGates()  G1..G4 - is the market tradeable at all?|
//|   IprEvaluateSetup()     impulse -> pullback -> id -> cluster    |
//|                          -> target/cost. Produces an armable     |
//|                          setup or the reason there isn't one.    |
//|                                                                  |
//| G5 (portfolio state: open positions, cooldowns, daily limits) is |
//| owned by IprRiskManager and is asked separately by the EA, which |
//| keeps the risk model independent of the entry model exactly as   |
//| Phase 1 section 10 requires.                                     |
//|                                                                  |
//| Nothing in this file touches MT5. It is pure, deterministic and  |
//| exercised directly by the g++ test suite.                        |
//+------------------------------------------------------------------+
#ifndef IPR_SIGNALENGINE_MQH
#define IPR_SIGNALENGINE_MQH

#include "Types.mqh"
#include "Config.mqh"
#include "CostModel.mqh"
#include "Gates.mqh"
#include "Impulse.mqh"
#include "Pullback.mqh"
#include "SetupMachine.mqh"
#include "TargetEngine.mqh"

//--- Numbers worth logging whether or not a setup was produced.
struct IprDiagnostics
  {
   double            volRatio;
   double            spreadAtr;
   double            spreadMedMult;
   IprDirection      regimeDir;
   double            legSize;
   double            er;
   double            depth;
   double            bosLevel;

   void              Reset()
     {
      volRatio = 0.0; spreadAtr = 0.0; spreadMedMult = 0.0;
      regimeDir = IPR_DIR_NONE; legSize = 0.0; er = 0.0; depth = 0.0;
      bosLevel = 0.0;
     }
  };

//+------------------------------------------------------------------+
//| G1..G4. Returns IPR_OK only when every market gate passes.       |
//| shockLatched is the caller-owned stand-down counter: the shock   |
//| filter latches for 6 bars after a >3xATR bar (Phase 1 5.1 G4).   |
//+------------------------------------------------------------------+
IprReject IprCheckMarketGates(const IprBars &bars, const IprConfig &cfg,
                              const IprMarketCtx &ctx, const IprHourProfile &prof,
                              IprDiagnostics &diag)
  {
   diag.Reset();

   if(bars.Count() < IPR_ATR_PERIOD + 2 || ctx.atr <= 0.0)
      return IPR_REJ_NO_DATA;

   //--- G1 session
   const IprReject sess = IprGateSession(ctx, prof, cfg.sessionFilterEnabled);
   if(sess != IPR_OK)
      return sess;

   //--- G2 volatility band
   const IprReject vol = IprGateVolatility(ctx, prof, diag.volRatio);
   if(vol != IPR_OK)
      return vol;

   //--- G3 spread, against both ATR and its own hourly history
   const IprReject spr = IprGateSpread(ctx, prof, diag.spreadAtr, diag.spreadMedMult);
   if(spr != IPR_OK)
      return spr;

   //--- G4 shock filter, including the 6-bar stand-down latch
   if(ctx.shockStandDownBars > 0)
      return IPR_REJ_SHOCK_FILTER;
   if(IprShockDetected(bars, ctx.atr))
      return IPR_REJ_SHOCK_FILTER;

   diag.regimeDir = IprRegimeDirection(ctx);
   if(diag.regimeDir == IPR_DIR_NONE)
      return IPR_REJ_REGIME_FLAT;

   return IPR_OK;
  }

//+------------------------------------------------------------------+
//| The trigger buffer (Phase 1 5.6).                                |
//|   b = max(0.10*ATR, 2*spread, stops_level, 1 tick)               |
//| Expressed only in ATR, live spread and broker limits, so it      |
//| scales across instruments without a single point constant.       |
//+------------------------------------------------------------------+
double IprTriggerBuffer(const double atr, const double spreadPrice,
                        const IprSymbolSpec &spec)
  {
   double b = IPR_TRIG_BUFFER_ATR * atr;
   b = MathMax(b, 2.0 * spreadPrice);
   b = MathMax(b, spec.stopsLevelPrice);
   b = MathMax(b, spec.tickSize);
   return b;
  }

//+------------------------------------------------------------------+
//| Full setup evaluation for one direction.                         |
//|                                                                  |
//| On IPR_OK, outSetup is fully populated and ready to arm; the     |
//| caller still owns the decision to arm it and to place the order. |
//+------------------------------------------------------------------+
IprReject IprEvaluateSetup(const IprBars &bars, const IprConfig &cfg,
                           const IprSymbolSpec &spec, const IprCosts &costs,
                           const IprMarketCtx &ctx, const IprSetupMachine &machine,
                           const IprDirection dir, IprSetup &outSetup,
                           IprTargetPlan &outPlan, IprDiagnostics &diag)
  {
   outSetup.Reset();
   outPlan.Reset();

   if(dir == IPR_DIR_NONE)
      return IPR_REJ_REGIME_FLAT;

   //--- Impulse (I1..I4)
   IprImpulse imp;
   const IprReject impRes = IprDetectImpulse(bars, cfg, dir, ctx.atr, imp);
   if(impRes != IPR_OK)
      return impRes;
   diag.legSize = imp.legSize;
   diag.er = imp.er;
   diag.bosLevel = imp.bosLevel;

   //--- Pullback (P1..P4)
   IprPullback pb;
   const IprReject pbRes = IprDetectPullback(bars, cfg, dir, imp, spec.tickSize, pb);
   if(pbRes != IPR_OK)
      return pbRes;
   diag.depth = pb.depth;

   //--- Trigger price sits beyond the turn bar's extreme.
   const double buffer = IprTriggerBuffer(ctx.atr, ctx.spreadPrice, spec);
   const double trigger = (dir == IPR_DIR_LONG) ? (pb.turnPrice + buffer)
                                                : (pb.turnPrice - buffer);
   const double trigNorm = IprNormalizePrice(trigger, spec.tickSize, spec.digits);

   //--- Identity is derived from the structure, so re-evaluating the
   //--- same formation on a later tick or bar yields the same id and is
   //--- rejected as a duplicate rather than arming twice.
   const ulong id = IprMakeSetupId(machine.m_symbolHash, (int)dir,
                                   bars.TimeAgo(imp.highAgo), imp.legHigh,
                                   pb.turnTime, pb.pbExtreme);
   if(!machine.CanArm(id))
      return IPR_REJ_DUPLICATE_SETUP;

   //--- Cluster locks before any expensive work.
   const IprReject cl = machine.CheckClusterLocks(dir, imp.legHigh, trigNorm, ctx.atr);
   if(cl != IPR_OK)
      return cl;

   //--- Target, stop, structural cap and the cost-budget gate.
   const IprReject tgt = IprBuildTargetPlan(bars, cfg, spec, costs, dir, trigNorm,
                                            pb.pbExtreme, imp.legHigh, ctx.atr,
                                            ctx.spreadPrice, outPlan);
   if(tgt != IPR_OK)
      return tgt;

   outSetup.setupId = id;
   outSetup.state = IPR_STATE_FORMING;
   outSetup.dir = dir;
   outSetup.armTime = ctx.barTime;
   outSetup.barsSinceArm = 0;
   outSetup.triggerPrice = trigNorm;
   outSetup.stopPrice = outPlan.stopPrice;
   outSetup.targetPrice = outPlan.targetPrice;
   outSetup.dTp = outPlan.dTp;
   outSetup.dSl = outPlan.dSl;
   outSetup.atrAtArm = ctx.atr;
   outSetup.legExtreme = imp.legHigh;
   outSetup.pbExtreme = pb.pbExtreme;
   outSetup.invalidLevel = (dir == IPR_DIR_LONG)
                           ? (pb.pbExtreme - IPR_INVALID_BUFFER_ATR * ctx.atr)
                           : (pb.pbExtreme + IPR_INVALID_BUFFER_ATR * ctx.atr);
   outSetup.depth = pb.depth;
   outSetup.er = imp.er;
   outSetup.legSize = imp.legSize;
   outSetup.bosLevel = imp.bosLevel;
   outSetup.turnTime = pb.turnTime;
   outSetup.costMoney = costs.totalMoney;
   outSetup.reqMovePrice = costs.reqMovePrice;
   outSetup.orderTicket = 0;

   return IPR_OK;
  }

#endif // IPR_SIGNALENGINE_MQH
