//+------------------------------------------------------------------+
//| TargetEngine.mqh - target, stop and the cost-budget gate.        |
//|                                                                  |
//| Phase 1 8.2. The $1 objective is a NET FLOOR, never a fixed      |
//| distance:                                                        |
//|                                                                  |
//|   d_req  = (TargetNet + C_money) / M                              |
//|   d_tp   = clamp( max(d_req, TP_mult*ATR), d_req, d_struct )      |
//|   d_sl   = (entry - pb_extreme) + max(.15A, 1.5S, stops_level)    |
//|                                                                  |
//| and then four gates, of which the last is the important one:      |
//|                                                                  |
//|   C_money / M  <=  CostBudget * (d_tp + d_sl)                     |
//|                                                                  |
//| That is the operational form of the Phase 1 result that required  |
//| edge equals C/(d_tp+d_sl). It refuses any trade demanding more    |
//| than CostBudget of edge over a driftless random walk, and in one  |
//| rule replaces a spread filter, a volatility floor and a symbol    |
//| suitability test. Most candidate setups die here by design.       |
//+------------------------------------------------------------------+
#ifndef IPR_TARGETENGINE_MQH
#define IPR_TARGETENGINE_MQH

#include "Types.mqh"
#include "Config.mqh"
#include "CostModel.mqh"
#include "Structure.mqh"
#include "MathUtil.mqh"

//--- How far back to look for the opposing swing that caps the target.
#define IPR_STRUCT_LOOKBACK 120

struct IprTargetPlan
  {
   double            entryPrice;
   double            stopPrice;
   double            targetPrice;
   double            dTp;
   double            dSl;
   double            dReq;
   double            dStruct;        // 0 when no opposing level was found
   bool              structCapped;
   double            costPrice;
   double            costBudgetUsed; // C/(d_tp+d_sl); compare with cfg.costBudget
   double            payoff;         // net win / net loss

   void              Reset()
     {
      entryPrice = 0.0; stopPrice = 0.0; targetPrice = 0.0; dTp = 0.0; dSl = 0.0;
      dReq = 0.0; dStruct = 0.0; structCapped = false; costPrice = 0.0;
      costBudgetUsed = 0.0; payoff = 0.0;
     }
  };

IprReject IprBuildTargetPlan(const IprBars &bars, const IprConfig &cfg,
                             const IprSymbolSpec &spec, const IprCosts &costs,
                             const IprDirection dir, const double entryPrice,
                             const double pbExtreme, const double legExtreme,
                             const double atr, const double spreadPrice,
                             IprTargetPlan &out)
  {
   out.Reset();
   if(atr <= 0.0 || entryPrice <= 0.0 || costs.moneyPerPriceUnit <= 0.0)
      return IPR_REJ_NO_DATA;

   out.entryPrice = entryPrice;
   out.dReq = costs.reqMovePrice;
   out.costPrice = costs.totalPrice;
   if(out.dReq <= 0.0)
      return IPR_REJ_FEASIBILITY;

   //--- Per-setup feasibility (Phase 2 section 5). The startup report
   //--- screens the symbol, but volatility moves: a target needing more
   //--- than IPR_FEASIBILITY_MAX_ATR ATRs is not a scalp, and without
   //--- this test an unobstructed market (no opposing swing to cap the
   //--- target) would let an arbitrarily large TargetNet through, to be
   //--- closed later by the max-hold rule every single time.
   if(out.dReq > IPR_FEASIBILITY_MAX_ATR * atr)
      return IPR_REJ_FEASIBILITY;

   //--- Structural cap: 90% of the distance to the next opposing swing.
   //---
   //--- IMPORTANT READING OF PHASE 1 8.2 (see IMPLEMENTATION_NOTES.md):
   //--- "opposing structure" is searched from BEYOND THE LEG EXTREME,
   //--- not from the entry. On a pullback continuation the leg's own
   //--- high sits just above a long entry, and it is the level the
   //--- trade exists to break - not resistance. Measuring the cap from
   //--- the entry would veto virtually every valid setup and silently
   //--- turn the strategy off, which would be a strategy change by
   //--- implementation accident. The distance is still measured FROM
   //--- the entry; only the search origin moves.
   //---
   //--- If no opposing swing exists within the lookback the move is
   //--- unobstructed, so the cap simply does not bind.
   const double searchFrom = (dir == IPR_DIR_LONG)
                             ? MathMax(entryPrice, legExtreme)
                             : MathMin(entryPrice, legExtreme);
   double oppLevel = 0.0;
   const bool haveOpp = IprNearestOpposingLevel(bars, dir, searchFrom,
                                                IPR_FRACTAL_WIDTH,
                                                IPR_STRUCT_LOOKBACK, oppLevel);
   if(haveOpp)
     {
      const double room = (dir == IPR_DIR_LONG) ? (oppLevel - entryPrice)
                                                : (entryPrice - oppLevel);
      out.dStruct = IPR_STRUCT_CAP * room;
      //--- Gate 1: if structure cannot pay the floor, the market is
      //--- telling us it will stall first. Skip rather than shrink.
      if(out.dStruct < out.dReq)
         return IPR_REJ_NO_STRUCTURE_ROOM;
     }

   //--- Target: the larger of the net floor and the ATR-scaled target,
   //--- then capped by structure.
   double dTp = MathMax(out.dReq, cfg.tpMult * atr);
   if(haveOpp && dTp > out.dStruct)
     {
      dTp = out.dStruct;
      out.structCapped = true;
     }
   out.dTp = dTp;

   //--- Stop: just beyond the pullback extreme, with a buffer that is
   //--- itself expressed in ATR / spread / broker stops level.
   const double raw = (dir == IPR_DIR_LONG) ? (entryPrice - pbExtreme)
                                            : (pbExtreme - entryPrice);
   if(raw <= 0.0)
      return IPR_REJ_SL_TOO_TIGHT;

   const double buf = MathMax(IPR_SL_BUFFER_ATR * atr,
                              MathMax(IPR_SL_BUFFER_SPREAD * spreadPrice,
                                      spec.stopsLevelPrice));
   out.dSl = raw + buf;

   //--- Gate 2: the stop must sit outside the noise.
   if(out.dSl < MathMax(IPR_SL_MIN_ATR * atr, IPR_SL_MIN_SPREAD * spreadPrice))
      return IPR_REJ_SL_TOO_TIGHT;

   //--- Gate 3: and it must not be absurd. Phase 2 section 19: never
   //--- widen the stop merely to inflate the theoretical win rate.
   if(out.dSl > IPR_SL_MAX_ATR * atr)
      return IPR_REJ_SL_TOO_WIDE;

   //--- Broker minimum distances must hold for BOTH legs or the order
   //--- will simply be rejected.
   if(spec.stopsLevelPrice > 0.0)
     {
      if(out.dSl < spec.stopsLevelPrice || out.dTp < spec.stopsLevelPrice)
         return IPR_REJ_STOPS_LEVEL;
     }

   //--- Gate 4: the cost-budget gate.
   const double span = out.dTp + out.dSl;
   if(span <= 0.0)
      return IPR_REJ_FEASIBILITY;
   out.costBudgetUsed = out.costPrice / span;
   if(out.costBudgetUsed > cfg.costBudget)
      return IPR_REJ_TARGET_COST_INFEASIBLE;

   //--- Prices, snapped to the broker's tick grid.
   if(dir == IPR_DIR_LONG)
     {
      out.stopPrice = IprNormalizePrice(entryPrice - out.dSl, spec.tickSize, spec.digits);
      out.targetPrice = IprNormalizePrice(entryPrice + out.dTp, spec.tickSize, spec.digits);
     }
   else
     {
      out.stopPrice = IprNormalizePrice(entryPrice + out.dSl, spec.tickSize, spec.digits);
      out.targetPrice = IprNormalizePrice(entryPrice - out.dTp, spec.tickSize, spec.digits);
     }

   //--- Reported for the accepted-setup log line, not used as a gate:
   //--- net win over net loss, both after costs.
   const double netWin = (out.dTp - out.costPrice) * costs.moneyPerPriceUnit;
   const double netLoss = (out.dSl + out.costPrice) * costs.moneyPerPriceUnit;
   out.payoff = (netLoss > 0.0) ? (netWin / netLoss) : 0.0;

   return IPR_OK;
  }

#endif // IPR_TARGETENGINE_MQH
