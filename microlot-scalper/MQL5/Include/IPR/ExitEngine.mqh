//+------------------------------------------------------------------+
//| ExitEngine.mqh - the exit priority hierarchy (Phase 1 8.3).      |
//|                                                                  |
//|   1. broker-side protective stop   (passive - always attached)   |
//|   2. rollover / weekend force-flat                               |
//|   3. spread-blowout protection                                   |
//|   4. momentum failure                                            |
//|   5. no-progress                                                 |
//|   6. maximum holding time                                        |
//|   7. net-profit target             (passive - broker-side TP)    |
//|                                                                  |
//| Levels 1 and 7 are attached to the position at submission and are|
//| enforced by the broker, so they keep working if the terminal dies|
//| Levels 2..6 are evaluated here, strictly in order: the function  |
//| returns on the FIRST match, so a lower-priority rule can never    |
//| pre-empt a higher-priority safety rule.                          |
//+------------------------------------------------------------------+
#ifndef IPR_EXITENGINE_MQH
#define IPR_EXITENGINE_MQH

#include "Types.mqh"
#include "Config.mqh"

//--- Everything the exit rules need, gathered at one instant.
struct IprExitCtx
  {
   double            bid;
   double            ask;
   double            spreadPrice;
   double            spreadMedian;   // S_med for the current hour
   bool              spreadMedianValid;
   bool              inRolloverWindow;
   bool              inWeekendCloseWindow;

   void              Reset()
     {
      bid = 0.0; ask = 0.0; spreadPrice = 0.0; spreadMedian = 0.0;
      spreadMedianValid = false; inRolloverWindow = false;
      inWeekendCloseWindow = false;
     }
  };

//--- Current open profit in price units (favourable = positive).
double IprOpenProfitPrice(const IprTradeState &t, const IprExitCtx &ctx)
  {
   if(!t.active)
      return 0.0;
   //--- A long is closed at the bid, a short at the ask. Using the mid
   //--- here would systematically overstate profit by half a spread.
   if(t.dir == IPR_DIR_LONG)
      return ctx.bid - t.entryPrice;
   return t.entryPrice - ctx.ask;
  }

//--- Maximum favourable excursion so far, in price units.
double IprMfePrice(const IprTradeState &t)
  {
   if(!t.active || t.mfePrice <= 0.0)
      return 0.0;
   if(t.dir == IPR_DIR_LONG)
      return t.mfePrice - t.entryPrice;
   return t.entryPrice - t.mfePrice;
  }

//--- Called on every tick to advance the favourable-excursion high-water
//--- mark. Uses the price the position would actually be closed at.
void IprUpdateMfe(IprTradeState &t, const IprExitCtx &ctx)
  {
   if(!t.active)
      return;
   const double px = (t.dir == IPR_DIR_LONG) ? ctx.bid : ctx.ask;
   if(px <= 0.0)
      return;
   if(t.mfePrice <= 0.0)
     {
      t.mfePrice = px;
      return;
     }
   if(t.dir == IPR_DIR_LONG)
     {
      if(px > t.mfePrice)
         t.mfePrice = px;
     }
   else
     {
      if(px < t.mfePrice)
         t.mfePrice = px;
     }
  }

//--- Called once per newly closed M5 bar while a position is open.
//--- Momentum failure is counted here, against the EMA as it stood at
//--- each bar's close, so the test uses closed bars only (Phase 2 s.22).
void IprUpdateOnBar(IprTradeState &t, const double barClose, const double emaFast)
  {
   if(!t.active)
      return;
   t.barsHeld++;

   const bool against = (t.dir == IPR_DIR_LONG) ? (barClose < emaFast)
                                                : (barClose > emaFast);
   if(against)
      t.momFailCloses++;
   else
      t.momFailCloses = 0;
  }

//+------------------------------------------------------------------+
//| Evaluate levels 2..6 in priority order.                          |
//+------------------------------------------------------------------+
IprExitReason IprEvaluateExit(const IprTradeState &t, const IprExitCtx &ctx)
  {
   if(!t.active)
      return IPR_EXIT_NONE;

   //--- 2. Rollover / weekend. Unconditional: this is what keeps swap
   //--- out of the cost model and gap risk off the book.
   if(ctx.inRolloverWindow || ctx.inWeekendCloseWindow)
      return IPR_EXIT_ROLLOVER;

   //--- 3. Spread blowout. Only ever closes a WINNING position: if the
   //--- trade is losing, crossing a garbage spread is itself a loss
   //--- mechanism, so we leave it to the broker-side stop (Phase 1 8.3
   //--- rule 3 / Phase 2 section 21).
   if(ctx.spreadMedianValid && ctx.spreadMedian > 0.0)
     {
      const bool blown = (ctx.spreadPrice > IPR_SPREAD_PANIC_MULT * ctx.spreadMedian);
      if(blown)
        {
         const double profit = IprOpenProfitPrice(t, ctx);
         if(t.dTp > 0.0 && profit >= IPR_SPREAD_PANIC_PROFIT * t.dTp)
            return IPR_EXIT_SPREAD_BLOWOUT;
        }
     }

   //--- 4. Momentum failure: two consecutive closes against the EMA20.
   if(t.momFailCloses >= IPR_MOMFAIL_CLOSES)
      return IPR_EXIT_MOMENTUM_FAIL;

   //--- 5. No progress: after 4 bars the trade must have shown at least
   //--- 35% of its target as favourable excursion, or it is neither
   //--- working nor losing and is tying up the one position slot.
   if(t.barsHeld >= IPR_NOPROGRESS_BARS && t.dTp > 0.0)
     {
      if(IprMfePrice(t) < IPR_NOPROGRESS_FRAC * t.dTp)
         return IPR_EXIT_NO_PROGRESS;
     }

   //--- 6. Maximum holding time. This is the rule that stops the $1
   //--- objective from holding a dead scalp open indefinitely.
   if(t.barsHeld >= IPR_MAXHOLD_BARS)
      return IPR_EXIT_MAX_HOLD;

   return IPR_EXIT_NONE;
  }

//+------------------------------------------------------------------+
//| Optional break-even step (Phase 1 8.4). Default OFF: moving to   |
//| break-even converts winners into scratches and is unproven, so   |
//| it ships as a flag to be settled by backtest, not by belief.     |
//| Note that a partial close is NOT available at 0.01 lot - half a  |
//| minimum lot is not a tradeable volume - so this is the only      |
//| in-trade management step that exists.                            |
//+------------------------------------------------------------------+
bool IprBreakEvenStop(const IprTradeState &t, const IprConfig &cfg,
                      const IprCosts &costs, const IprSymbolSpec &spec,
                      double &newStop)
  {
   newStop = 0.0;
   if(!cfg.breakEvenEnabled || !t.active || t.dSl <= 0.0)
      return false;
   if(IprMfePrice(t) < t.dSl)          // not yet +1R
      return false;

   //--- Break-even means break-even NET: entry plus the round-turn cost,
   //--- otherwise "break-even" still books a loss.
   const double offset = costs.totalPrice;
   const double candidate = (t.dir == IPR_DIR_LONG) ? (t.entryPrice + offset)
                                                    : (t.entryPrice - offset);

   //--- Never move a stop backwards.
   if(t.dir == IPR_DIR_LONG && candidate <= t.stopPrice)
      return false;
   if(t.dir == IPR_DIR_SHORT && candidate >= t.stopPrice)
      return false;

   newStop = IprNormalizePrice(candidate, spec.tickSize, spec.digits);
   return true;
  }

#endif // IPR_EXITENGINE_MQH
