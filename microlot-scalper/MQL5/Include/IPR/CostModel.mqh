//+------------------------------------------------------------------+
//| CostModel.mqh - the account-currency cost model.                 |
//|                                                                  |
//| Everything money-related in this strategy flows through M, the   |
//| account-currency value of a 1.0 move in price:                   |
//|                                                                  |
//|     M = volume * TICK_VALUE / TICK_SIZE                          |
//|                                                                  |
//| Phase 1 section 1 verified this against three instrument shapes  |
//| (XAUUSD 100oz, BTCUSD 1 coin, EURUSD 100k). No symbol constants  |
//| appear anywhere. The EA cross-checks M against OrderCalcProfit at|
//| startup (SymbolSpecMT5.mqh) and prefers the broker's own answer  |
//| when the two disagree.                                           |
//+------------------------------------------------------------------+
#ifndef IPR_COSTMODEL_MQH
#define IPR_COSTMODEL_MQH

#include "Types.mqh"
#include "Config.mqh"

//--- Account currency per 1.0 price unit for the given volume.
double IprMoneyPerPriceUnit(const IprSymbolSpec &spec, const double volume)
  {
   if(!spec.valid || spec.tickSize <= 0.0)
      return 0.0;
   return volume * spec.tickValue / spec.tickSize;
  }

//+------------------------------------------------------------------+
//| Build the full round-turn cost picture at a moment in time.      |
//|                                                                  |
//| spreadPrice  live spread in price units                          |
//| mOverride    M from OrderCalcProfit; <= 0 means "use the formula"|
//| swapMoney    expected swap. Intraday trades are force-flat before|
//|              rollover (Phase 1 8.3 rule 2) so this is normally 0,|
//|              but it is a parameter rather than a hard zero so the |
//|              caller can charge it when a hold could cross over.  |
//+------------------------------------------------------------------+
bool IprBuildCosts(const IprSymbolSpec &spec,
                   const IprConfig &cfg,
                   const double volume,
                   const double spreadPrice,
                   const double mOverride,
                   const double swapMoney,
                   IprCosts &out)
  {
   out.Reset();
   if(!spec.valid || volume <= 0.0 || spreadPrice < 0.0)
      return false;

   double m = (mOverride > 0.0) ? mOverride : IprMoneyPerPriceUnit(spec, volume);
   if(m <= 0.0)
      return false;

   out.moneyPerPriceUnit = m;
   out.spreadPrice = spreadPrice;

   //--- Slippage is modelled as a fraction of the live spread on each
   //--- side. Expressing it that way keeps it symbol-agnostic and makes
   //--- it widen automatically exactly when execution actually degrades.
   //--- Phase 1 13.3 note 3: stop exits slip harder than entries, so the
   //--- exit side carries twice the entry estimate (0.25 + 0.50 = 0.75
   //--- of one spread at the default multiplier).
   out.slipPrice = cfg.slipEstSpreadMult * spreadPrice * 3.0;

   out.commissionMoney = cfg.commissionPerLotRT * volume;
   out.swapMoney = swapMoney;

   out.totalMoney = (out.spreadPrice + out.slipPrice) * m
                    + out.commissionMoney + out.swapMoney;
   out.totalPrice = out.totalMoney / m;

   //--- d_req: the favourable move that yields TargetNet AFTER costs.
   out.reqMovePrice = (cfg.targetNet + out.totalMoney) / m;
   return true;
  }

//+------------------------------------------------------------------+
//| Startup feasibility test (Phase 2 section 5 / Phase 1 9.3).      |
//|                                                                  |
//| Answers: can this symbol/volume pair plausibly pay TargetNet at  |
//| the volatility currently on offer? A required move of more than  |
//| maxAtrRatio ATRs means no - and the correct response is to refuse|
//| the symbol, never to shrink the target until it fits.            |
//+------------------------------------------------------------------+
bool IprFeasible(const IprCosts &costs, const double atr,
                 const double maxAtrRatio, double &atrRatio)
  {
   atrRatio = 0.0;
   if(atr <= 0.0 || costs.reqMovePrice <= 0.0)
      return false;
   atrRatio = costs.reqMovePrice / atr;
   return (atrRatio <= maxAtrRatio);
  }

#endif // IPR_COSTMODEL_MQH
