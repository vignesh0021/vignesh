//+------------------------------------------------------------------+
//| Impulse.mqh - impulse leg detection (Phase 1 5.4).               |
//|                                                                  |
//| A leg qualifies when ALL of these hold:                          |
//|   I1  the direction-relative extreme is MORE RECENT than the     |
//|       origin (for a long: the high came after the low)           |
//|   I2  L >= L_min_mult * ATR                                      |
//|   I3  ER >= 0.50 across the leg                                  |
//|   I4  the leg broke the most recent confirmed swing that PRECEDED |
//|       the leg origin (break of structure)                        |
//|                                                                  |
//| The search walks an end-lag of 0..3 bars so that a leg which     |
//| finished a couple of bars ago is still eligible - that lag is    |
//| what leaves room for the pullback to form. The FIRST (most       |
//| recent) qualifying lag wins, which keeps the result deterministic|
//| when several windows would qualify.                              |
//+------------------------------------------------------------------+
#ifndef IPR_IMPULSE_MQH
#define IPR_IMPULSE_MQH

#include "Types.mqh"
#include "Config.mqh"
#include "Indicators.mqh"
#include "Structure.mqh"

#define IPR_IMPULSE_MAX_LAG 3

IprReject IprDetectImpulse(const IprBars &bars, const IprConfig &cfg,
                           const IprDirection dir, const double atr,
                           IprImpulse &out)
  {
   out.Reset();
   if(dir == IPR_DIR_NONE || atr <= 0.0)
      return IPR_REJ_NO_IMPULSE;
   if(bars.Count() < cfg.nImp + IPR_IMPULSE_MAX_LAG + IPR_FRACTAL_WIDTH * 2 + 2)
      return IPR_REJ_NO_DATA;

   //--- Track the best reason seen so we can report WHY nothing armed,
   //--- rather than a generic "no impulse".
   IprReject lastReason = IPR_REJ_NO_IMPULSE;

   for(int lag = 0; lag <= IPR_IMPULSE_MAX_LAG; lag++)
     {
      const int newest = lag;
      const int oldest = lag + cfg.nImp - 1;
      if(!bars.Has(oldest))
         continue;

      //--- Locate the window's extremes.
      int hiAgo = newest, loAgo = newest;
      double hi = bars.HighAgo(newest), lo = bars.LowAgo(newest);
      for(int a = newest; a <= oldest; a++)
        {
         if(bars.HighAgo(a) > hi) { hi = bars.HighAgo(a); hiAgo = a; }
         if(bars.LowAgo(a)  < lo) { lo = bars.LowAgo(a);  loAgo = a; }
        }

      //--- I1: direction-relative extreme must be the more recent one.
      //--- Bars-ago counts DOWN as time moves forward, so "more recent"
      //--- means the smaller index.
      const int extremeAgo = (dir == IPR_DIR_LONG) ? hiAgo : loAgo;
      const int originAgo  = (dir == IPR_DIR_LONG) ? loAgo : hiAgo;
      if(originAgo <= extremeAgo)
         continue;                       // leg runs the wrong way

      const double legSize = hi - lo;
      if(legSize <= 0.0)
         continue;

      //--- I2: leg must be large relative to prevailing volatility.
      if(legSize < cfg.lMinMult * atr)
        {
         lastReason = IPR_REJ_IMPULSE_TOO_SMALL;
         continue;
        }

      //--- I3: at least half of the travel must be net directional.
      double er = 0.0;
      if(!IprEfficiencyRatio(bars, originAgo, extremeAgo, er))
        {
         lastReason = IPR_REJ_ER_TOO_LOW;
         continue;
        }
      if(er < IPR_ER_MIN)
        {
         lastReason = IPR_REJ_ER_TOO_LOW;
         continue;
        }

      //--- I4: break of structure. The reference swing must have formed
      //--- BEFORE the leg's origin, otherwise the leg would be breaking
      //--- a level it created itself.
      double bosLevel = 0.0;
      int bosAgo = -1;
      bool bos = false;
      if(dir == IPR_DIR_LONG)
        {
         if(IprFindSwingHigh(bars, originAgo + 1, IPR_FRACTAL_WIDTH, bosLevel, bosAgo))
            bos = (hi > bosLevel);
        }
      else
        {
         if(IprFindSwingLow(bars, originAgo + 1, IPR_FRACTAL_WIDTH, bosLevel, bosAgo))
            bos = (lo < bosLevel);
        }
      if(!bos)
        {
         lastReason = IPR_REJ_NO_BOS;
         continue;
        }

      out.found = true;
      out.highAgo = extremeAgo;
      out.lowAgo = originAgo;
      out.legHigh = (dir == IPR_DIR_LONG) ? hi : lo;   // direction-relative extreme
      out.legLow = (dir == IPR_DIR_LONG) ? lo : hi;    // direction-relative origin
      out.legSize = legSize;
      out.er = er;
      out.impBars = originAgo - extremeAgo;
      out.bosLevel = bosLevel;
      return IPR_OK;
     }

   return lastReason;
  }

#endif // IPR_IMPULSE_MQH
