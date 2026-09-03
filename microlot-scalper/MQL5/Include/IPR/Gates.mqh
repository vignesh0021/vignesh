//+------------------------------------------------------------------+
//| Gates.mqh - the regime, volatility, spread and shock filters.    |
//|                                                                  |
//| Phase 1 5.1 (G1..G5). Every threshold here is a RATIO. Nothing   |
//| is denominated in points, which is what lets XAUUSD and BTCUSD   |
//| run the identical code path.                                     |
//|                                                                  |
//| All gates FAIL CLOSED: if a reference is missing (not enough     |
//| session history yet) the answer is "no trade", never "assume     |
//| it's fine".                                                      |
//+------------------------------------------------------------------+
#ifndef IPR_GATES_MQH
#define IPR_GATES_MQH

#include "Types.mqh"
#include "Config.mqh"
#include "Indicators.mqh"
#include "HourProfile.mqh"

//--- A snapshot of everything the gates need, assembled once per
//--- evaluation so that no gate can accidentally read a different
//--- moment in time than its neighbours.
struct IprMarketCtx
  {
   double            atr;
   double            emaFast;
   double            emaSlow;
   double            emaFastAgo;    // EMA20 five bars back
   bool              emaAgoValid;
   double            spreadPrice;
   int               hour;
   long              dayKey;
   long              barTime;
   int               shockStandDownBars; // >0 while the shock filter is latched

   void              Reset()
     {
      atr = 0.0; emaFast = 0.0; emaSlow = 0.0; emaFastAgo = 0.0;
      emaAgoValid = false; spreadPrice = 0.0; hour = -1; dayKey = 0;
      barTime = 0; shockStandDownBars = 0;
     }
  };

//+------------------------------------------------------------------+
//| G2 - volatility band, 0.60 <= A / A_ref <= 2.50.                 |
//| A_ref is the median ATR for this hour-of-day over the trailing   |
//| 20 sessions, so the band means "normal FOR THIS HOUR".           |
//+------------------------------------------------------------------+
IprReject IprGateVolatility(const IprMarketCtx &ctx, const IprHourProfile &prof,
                            double &ratio)
  {
   ratio = 0.0;
   if(ctx.atr <= 0.0)
      return IPR_REJ_NO_DATA;

   double aRef = 0.0;
   if(!prof.MedianAtr(ctx.hour, aRef) || aRef <= 0.0)
      return IPR_REJ_NO_DATA;          // reference not formed yet -> stand down

   ratio = ctx.atr / aRef;
   if(ratio < IPR_VOL_RATIO_MIN)
      return IPR_REJ_VOLATILITY_TOO_LOW;
   if(ratio > IPR_VOL_RATIO_MAX)
      return IPR_REJ_VOLATILITY_TOO_HIGH;
   return IPR_OK;
  }

//+------------------------------------------------------------------+
//| G3 - spread must be small against BOTH volatility and its own    |
//| history: S/A <= 0.15 and S <= 2.5 * S_med(hour).                 |
//| The first test keeps cost proportional to the move we are after; |
//| the second catches rollover and news blowouts without knowing    |
//| anything about the instrument.                                   |
//+------------------------------------------------------------------+
IprReject IprGateSpread(const IprMarketCtx &ctx, const IprHourProfile &prof,
                        double &spreadAtr, double &spreadMedMult)
  {
   spreadAtr = 0.0;
   spreadMedMult = 0.0;
   if(ctx.atr <= 0.0)
      return IPR_REJ_NO_DATA;

   spreadAtr = ctx.spreadPrice / ctx.atr;
   if(spreadAtr > IPR_SPREAD_ATR_MAX)
      return IPR_REJ_SPREAD_TOO_HIGH;

   double sMed = 0.0;
   if(!prof.MedianSpread(ctx.hour, sMed) || sMed <= 0.0)
      return IPR_REJ_NO_DATA;

   spreadMedMult = ctx.spreadPrice / sMed;
   if(spreadMedMult > IPR_SPREAD_MED_MULT)
      return IPR_REJ_SPREAD_ABNORMAL;
   return IPR_OK;
  }

//+------------------------------------------------------------------+
//| G4 - shock filter. Any of the last 3 closed bars with a range    |
//| over 3 x ATR means the book has just been disorderly; Phase 1    |
//| 5.1 stands down for 6 bars afterwards. The caller owns the latch |
//| counter so the stand-down survives across evaluations.           |
//+------------------------------------------------------------------+
bool IprShockDetected(const IprBars &bars, const double atr)
  {
   if(atr <= 0.0)
      return false;
   const double limit = IPR_SHOCK_ATR_MULT * atr;
   for(int a = 0; a < 3; a++)
     {
      if(!bars.Has(a))
         break;
      if(bars.RangeAgo(a) > limit)
         return true;
     }
   return false;
  }

//+------------------------------------------------------------------+
//| 5.2 / 5.3 - directional regime.                                  |
//| Long  : EMA20 > EMA50 AND EMA20[0] - EMA20[5] >  0.10 * ATR      |
//| Short : EMA20 < EMA50 AND EMA20[5] - EMA20[0] >  0.10 * ATR      |
//| The slope term is what stops the EA from trading a flat stack.   |
//+------------------------------------------------------------------+
IprDirection IprRegimeDirection(const IprMarketCtx &ctx)
  {
   if(ctx.atr <= 0.0 || !ctx.emaAgoValid)
      return IPR_DIR_NONE;

   const double slope = ctx.emaFast - ctx.emaFastAgo;
   const double minSlope = IPR_EMA_SLOPE_ATR * ctx.atr;

   if(ctx.emaFast > ctx.emaSlow && slope > minSlope)
      return IPR_DIR_LONG;
   if(ctx.emaFast < ctx.emaSlow && -slope > minSlope)
      return IPR_DIR_SHORT;
   return IPR_DIR_NONE;
  }

//+------------------------------------------------------------------+
//| G1 - session. Phase 1 7.4 derives tradeable hours from the       |
//| instrument's own median spread/ATR profile rather than hardcoded |
//| session times, so the same code finds London/NY on gold and the  |
//| liquid hours on BTC. Hard exclusions (rollover, weekend) are     |
//| applied by the caller, which owns the clock.                     |
//+------------------------------------------------------------------+
IprReject IprGateSession(const IprMarketCtx &ctx, const IprHourProfile &prof,
                         const bool enabled)
  {
   if(!enabled)
      return IPR_OK;
   if(ctx.hour < 0 || ctx.hour >= IPR_PROFILE_HOURS)
      return IPR_REJ_NO_DATA;
   if(!prof.Ready(ctx.hour))
      return IPR_REJ_NO_DATA;
   if(!prof.HourTradeable(ctx.hour, IPR_SPREAD_ATR_MAX))
      return IPR_REJ_SESSION;
   return IPR_OK;
  }

#endif // IPR_GATES_MQH
