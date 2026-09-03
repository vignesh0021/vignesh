//+------------------------------------------------------------------+
//| MathUtil.mqh - small numeric helpers shared by the pure logic.   |
//| Deliberately dependency-free so the unit tests can exercise them.|
//+------------------------------------------------------------------+
#ifndef IPR_MATHUTIL_MQH
#define IPR_MATHUTIL_MQH

#include "Types.mqh"

//--- Prices are compared with a tolerance of half a tick. Comparing raw
//--- doubles for equality would make the turn-bar match (Phase 1 P4)
//--- brittle against broker price normalisation.
bool IprPriceEq(const double a, const double b, const double tickSize)
  {
   const double tol = (tickSize > 0.0) ? tickSize * 0.5 : 1e-9;
   return (MathAbs(a - b) <= tol);
  }

double IprClamp(const double v, const double lo, const double hi)
  {
   if(v < lo)
      return lo;
   if(v > hi)
      return hi;
   return v;
  }

//--- A small fixed sample set. Arrays are NOT passed as parameters
//--- anywhere in the pure layer: MQL5 spells that `const double &a[]`,
//--- which is not valid C++, and it would break the g++ test build.
struct IprSampleSet
  {
   double            v[IPR_PROFILE_DAYS];
   int               n;

   void              Reset() { n = 0; }
   bool              Add(const double x)
     {
      if(n >= IPR_PROFILE_DAYS)
         return false;
      v[n] = x;
      n++;
      return true;
     }
  };

//--- Median of a sample set. n is at most IPR_PROFILE_DAYS (20), so an
//--- insertion sort on a local copy is cheaper and more predictable
//--- than anything smarter.
bool IprMedian(const IprSampleSet &s, double &out)
  {
   out = 0.0;
   const int n = s.n;
   if(n <= 0 || n > IPR_PROFILE_DAYS)
      return false;

   double tmp[IPR_PROFILE_DAYS];
   for(int i = 0; i < n; i++)
      tmp[i] = s.v[i];

   for(int i = 1; i < n; i++)
     {
      const double key = tmp[i];
      int j = i - 1;
      while(j >= 0 && tmp[j] > key)
        {
         tmp[j + 1] = tmp[j];
         j--;
        }
      tmp[j + 1] = key;
     }

   if((n % 2) == 1)
      out = tmp[n / 2];
   else
      out = 0.5 * (tmp[n / 2 - 1] + tmp[n / 2]);
   return true;
  }

//--- Round a price to the instrument's tick grid. Brokers reject orders
//--- whose price is not a multiple of tickSize, so every price the EA
//--- sends passes through here first.
double IprNormalizePrice(const double price, const double tickSize, const int digits)
  {
   if(tickSize <= 0.0)
      return NormalizeDouble(price, digits);
   const double steps = MathRound(price / tickSize);
   return NormalizeDouble(steps * tickSize, digits);
  }

//--- Snap a requested volume DOWN to the broker's volume grid. Returns
//--- false when the result is not tradeable; the caller must then refuse
//--- to trade rather than silently substituting a different size
//--- (Phase 2 section 3).
bool IprNormalizeVolume(const double requested, const IprSymbolSpec &spec, double &out)
  {
   out = 0.0;
   if(!spec.valid || spec.volStep <= 0.0)
      return false;
   if(requested < spec.volMin - 1e-12)
      return false;
   if(requested > spec.volMax + 1e-12)
      return false;

   const double steps = MathFloor((requested - spec.volMin) / spec.volStep + 1e-9);
   double v = spec.volMin + steps * spec.volStep;

   //--- Re-round to the step's own decimal grid to kill accumulated FP
   //--- error (0.01 + 71*0.01 must be 0.72, not 0.7200000000000001).
   const double inv = 1.0 / spec.volStep;
   v = MathRound(v * inv) / inv;

   if(v < spec.volMin - 1e-12 || v > spec.volMax + 1e-12)
      return false;
   out = v;
   return true;
  }

//--- FNV-1a. Used only for the symbol name, which is hashed once and
//--- then carried as a number, so no string formatting is needed on the
//--- hot path (and none of it depends on 64-bit printf specifiers, which
//--- differ between MQL5 and C++).
#define IPR_FNV_OFFSET 1469598103934665603
#define IPR_FNV_PRIME  1099511628211

ulong IprHashString(const string s)
  {
   ulong h = IPR_FNV_OFFSET;
   const int n = StringLen(s);
   for(int i = 0; i < n; i++)
     {
      h = h ^ (ulong)StringGetCharacter(s, i);
      h = h * IPR_FNV_PRIME;
     }
   return h;
  }

//--- Mix one 64-bit value into a running FNV-1a hash, byte by byte.
ulong IprHashMix(const ulong h0, const ulong v)
  {
   ulong h = h0;
   for(int i = 0; i < 8; i++)
     {
      h = h ^ ((v >> (i * 8)) & 0xFF);
      h = h * IPR_FNV_PRIME;
     }
   return h;
  }

//+------------------------------------------------------------------+
//| Immutable SetupID (Phase 1 5.9).                                 |
//|                                                                  |
//| Identity is the STRUCTURE that produced the setup, not the time  |
//| it was noticed. Prices are quantised to 1e-8 first so that        |
//| floating-point noise can never yield two different ids for the   |
//| same structure - that would defeat the one-setup-one-trade rule. |
//+------------------------------------------------------------------+
ulong IprMakeSetupId(const ulong symbolHash, const int dir,
                     const long legTime, const double legPrice,
                     const long turnTime, const double pbPrice)
  {
   const long lp = (long)MathRound(legPrice * 100000000.0);
   const long pp = (long)MathRound(pbPrice * 100000000.0);

   ulong h = IPR_FNV_OFFSET;
   h = IprHashMix(h, symbolHash);
   h = IprHashMix(h, (ulong)dir);
   h = IprHashMix(h, (ulong)legTime);
   h = IprHashMix(h, (ulong)lp);
   h = IprHashMix(h, (ulong)turnTime);
   h = IprHashMix(h, (ulong)pp);

   //--- Clamp to 63 bits. The id is persisted as text and read back with
   //--- StringToInteger, which parses SIGNED 64-bit; a value above
   //--- LONG_MAX would not survive the round trip, and a consumed id
   //--- that fails to reload is a duplicate trade waiting to happen.
   //--- 63 bits leaves collision probability entirely negligible here.
   return (h & 0x7FFFFFFFFFFFFFFF);
  }

#endif // IPR_MATHUTIL_MQH
