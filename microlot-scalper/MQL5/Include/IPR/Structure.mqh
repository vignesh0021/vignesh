//+------------------------------------------------------------------+
//| Structure.mqh - 2-bar fractal swings and break-of-structure.     |
//|                                                                  |
//| Fractal width is FIXED at 2 (Phase 1 section J). It is the one   |
//| parameter most likely to absorb noise if optimised, so it is a   |
//| compile-time constant and is not reachable from the inputs.      |
//|                                                                  |
//| A swing at bars-ago index `a` needs `width` bars on BOTH sides.  |
//| The newer side must already be closed, so a swing is only        |
//| "confirmed" once a >= width. That two-bar confirmation lag is    |
//| what keeps the detector free of look-ahead.                      |
//+------------------------------------------------------------------+
#ifndef IPR_STRUCTURE_MQH
#define IPR_STRUCTURE_MQH

#include "Types.mqh"

bool IprIsSwingHigh(const IprBars &bars, const int ago, const int width)
  {
   if(ago < width)
      return false;                      // not yet confirmed by newer bars
   if(!bars.Has(ago + width))
      return false;                      // not enough older bars

   const double h = bars.HighAgo(ago);
   for(int k = 1; k <= width; k++)
     {
      //--- Strict inequality on both sides: a tie is not a swing, which
      //--- keeps detection deterministic on flat//repeated highs.
      if(h <= bars.HighAgo(ago - k))
         return false;
      if(h <= bars.HighAgo(ago + k))
         return false;
     }
   return true;
  }

bool IprIsSwingLow(const IprBars &bars, const int ago, const int width)
  {
   if(ago < width)
      return false;
   if(!bars.Has(ago + width))
      return false;

   const double l = bars.LowAgo(ago);
   for(int k = 1; k <= width; k++)
     {
      if(l >= bars.LowAgo(ago - k))
         return false;
      if(l >= bars.LowAgo(ago + k))
         return false;
     }
   return true;
  }

//--- Most recent confirmed swing high at or older than `fromAgo`.
bool IprFindSwingHigh(const IprBars &bars, const int fromAgo, const int width,
                      double &level, int &ago)
  {
   level = 0.0;
   ago = -1;
   const int start = (fromAgo < width) ? width : fromAgo;
   for(int a = start; bars.Has(a + width); a++)
     {
      if(IprIsSwingHigh(bars, a, width))
        {
         level = bars.HighAgo(a);
         ago = a;
         return true;
        }
     }
   return false;
  }

bool IprFindSwingLow(const IprBars &bars, const int fromAgo, const int width,
                     double &level, int &ago)
  {
   level = 0.0;
   ago = -1;
   const int start = (fromAgo < width) ? width : fromAgo;
   for(int a = start; bars.Has(a + width); a++)
     {
      if(IprIsSwingLow(bars, a, width))
        {
         level = bars.LowAgo(a);
         ago = a;
         return true;
        }
     }
   return false;
  }

//+------------------------------------------------------------------+
//| Nearest opposing swing ahead of an entry, used as the structural |
//| cap on the target (Phase 1 8.2: the target may not be placed     |
//| beyond the level the move is likely to stall at).                |
//|                                                                  |
//| For a long this is the nearest confirmed swing HIGH above the    |
//| entry price; for a short, the nearest swing LOW below it.        |
//+------------------------------------------------------------------+
bool IprNearestOpposingLevel(const IprBars &bars, const IprDirection dir,
                             const double entryPrice, const int width,
                             const int maxLookback, double &level)
  {
   level = 0.0;
   bool found = false;

   for(int a = width; bars.Has(a + width) && a <= maxLookback; a++)
     {
      if(dir == IPR_DIR_LONG)
        {
         if(!IprIsSwingHigh(bars, a, width))
            continue;
         const double h = bars.HighAgo(a);
         if(h <= entryPrice)
            continue;
         //--- Nearest above entry.
         if(!found || h < level)
           {
            level = h;
            found = true;
           }
        }
      else
        {
         if(!IprIsSwingLow(bars, a, width))
            continue;
         const double l = bars.LowAgo(a);
         if(l >= entryPrice)
            continue;
         if(!found || l > level)
           {
            level = l;
            found = true;
           }
        }
     }
   return found;
  }

//+------------------------------------------------------------------+
//| Break of structure against an open long: a confirmed swing low   |
//| within `lookback` bars has been broken downward by a later close.|
//| Mirrored for shorts. Used both as an impulse precondition and as |
//| a setup invalidation trigger (Phase 1 5.7 rule 3).               |
//+------------------------------------------------------------------+
bool IprBearishBos(const IprBars &bars, const int width, const int lookback)
  {
   double level = 0.0;
   int ago = -1;
   if(!IprFindSwingLow(bars, width, width, level, ago))
      return false;
   if(ago > lookback)
      return false;
   for(int a = ago - 1; a >= 0; a--)
     {
      if(bars.CloseAgo(a) < level)
         return true;
     }
   return false;
  }

bool IprBullishBos(const IprBars &bars, const int width, const int lookback)
  {
   double level = 0.0;
   int ago = -1;
   if(!IprFindSwingHigh(bars, width, width, level, ago))
      return false;
   if(ago > lookback)
      return false;
   for(int a = ago - 1; a >= 0; a--)
     {
      if(bars.CloseAgo(a) > level)
         return true;
     }
   return false;
  }

#endif // IPR_STRUCTURE_MQH
