//+------------------------------------------------------------------+
//| Pullback.mqh - retracement and turn-bar detection (Phase 1 5.5). |
//|                                                                  |
//|   P1 depth      0.20 <= R <= 0.618 of the impulse leg            |
//|   P2 duration   pb_bars <= N_imp                                 |
//|   P3 velocity   (L*R)/pb_bars < 0.80 * (L/imp_bars)              |
//|   P4 turn bar   a closed bar whose extreme IS the pullback       |
//|                 extreme, followed by a bar closing in our favour |
//|                                                                  |
//| P3 reduces to R/pb_bars < 0.80/imp_bars once L cancels, but it   |
//| is written out in full below to stay readable against the spec.  |
//+------------------------------------------------------------------+
#ifndef IPR_PULLBACK_MQH
#define IPR_PULLBACK_MQH

#include "Types.mqh"
#include "Config.mqh"
#include "MathUtil.mqh"

IprReject IprDetectPullback(const IprBars &bars, const IprConfig &cfg,
                            const IprDirection dir, const IprImpulse &imp,
                            const double tickSize, IprPullback &out)
  {
   out.Reset();
   if(!imp.found || imp.legSize <= 0.0)
      return IPR_REJ_NO_PULLBACK;

   //--- The pullback spans every bar after the leg extreme, up to and
   //--- including the most recently closed bar.
   const int pbBars = imp.highAgo;
   if(pbBars < 1)
      return IPR_REJ_NO_PULLBACK;       // extreme is the latest bar: nothing yet

   //--- P2: a correction slower than the impulse is a reversal.
   if(pbBars > cfg.nImp)
      return IPR_REJ_PULLBACK_TOO_LONG;

   //--- Pullback extreme, searched over the bars since the leg extreme.
   int pbAgo = imp.highAgo - 1;
   double pbExtreme = (dir == IPR_DIR_LONG) ? bars.LowAgo(pbAgo) : bars.HighAgo(pbAgo);
   for(int a = imp.highAgo - 1; a >= 0; a--)
     {
      if(dir == IPR_DIR_LONG)
        {
         if(bars.LowAgo(a) < pbExtreme) { pbExtreme = bars.LowAgo(a); pbAgo = a; }
        }
      else
        {
         if(bars.HighAgo(a) > pbExtreme) { pbExtreme = bars.HighAgo(a); pbAgo = a; }
        }
     }

   //--- P1: depth as a fraction of the leg.
   const double retrace = (dir == IPR_DIR_LONG)
                          ? (imp.legHigh - pbExtreme)
                          : (pbExtreme - imp.legHigh);
   const double depth = retrace / imp.legSize;
   if(depth < IPR_PULLBACK_MIN)
      return IPR_REJ_PULLBACK_TOO_SHALLOW;
   if(depth > IPR_PULLBACK_MAX)
      return IPR_REJ_PULLBACK_TOO_DEEP;

   //--- P3: corrective velocity must be below the impulse's.
   if(imp.impBars <= 0)
      return IPR_REJ_NO_PULLBACK;
   const double pbVel = (imp.legSize * depth) / (double)pbBars;
   const double impVel = imp.legSize / (double)imp.impBars;
   if(pbVel >= IPR_PULLBACK_VEL_FACTOR * impVel)
      return IPR_REJ_PULLBACK_TOO_FAST;

   //--- P4: the turn. Find the most recent bar whose extreme equals the
   //--- pullback extreme and which is followed by a closed bar that
   //--- closed in our favour. It must be at least 1 bar old so that the
   //--- confirming bar exists and is itself closed.
   int turnAgo = -1;
   for(int a = 1; a <= imp.highAgo - 1 && bars.Has(a); a++)
     {
      const double ext = (dir == IPR_DIR_LONG) ? bars.LowAgo(a) : bars.HighAgo(a);
      if(!IprPriceEq(ext, pbExtreme, tickSize))
         continue;

      const int confirmAgo = a - 1;
      if(!bars.Has(confirmAgo))
         continue;
      const bool confirmed = (dir == IPR_DIR_LONG)
                             ? (bars.CloseAgo(confirmAgo) > bars.OpenAgo(confirmAgo))
                             : (bars.CloseAgo(confirmAgo) < bars.OpenAgo(confirmAgo));
      if(!confirmed)
         continue;

      turnAgo = a;
      break;                            // most recent qualifying turn wins
     }

   if(turnAgo < 0)
      return IPR_REJ_NO_TURN_BAR;

   out.found = true;
   out.pbExtreme = pbExtreme;
   out.pbAgo = pbAgo;
   out.pbBars = pbBars;
   out.depth = depth;
   out.turnAgo = turnAgo;
   out.turnPrice = (dir == IPR_DIR_LONG) ? bars.HighAgo(turnAgo) : bars.LowAgo(turnAgo);
   out.turnTime = bars.TimeAgo(turnAgo);
   return IPR_OK;
  }

#endif // IPR_PULLBACK_MQH
