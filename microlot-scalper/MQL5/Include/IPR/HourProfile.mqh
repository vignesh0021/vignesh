//+------------------------------------------------------------------+
//| HourProfile.mqh - rolling per-hour ATR and spread references.    |
//|                                                                  |
//| Phase 1 gates G2 and G3 compare the current ATR and spread with  |
//| the median for the SAME hour-of-day over the trailing 20         |
//| sessions. That self-referential form is what makes the filters   |
//| symbol-agnostic: no threshold is denominated in points.          |
//|                                                                  |
//| LOOK-AHEAD SAFETY: an observation is only recorded when an hour  |
//| has fully elapsed, using the values as they stood at that hour's |
//| last closed bar. The current hour never contributes to its own   |
//| reference, and no future bar can.                                |
//+------------------------------------------------------------------+
#ifndef IPR_HOURPROFILE_MQH
#define IPR_HOURPROFILE_MQH

#include "Types.mqh"
#include "MathUtil.mqh"

//--- Minimum completed sessions before a bucket may be trusted. With
//--- fewer than this the gates fail CLOSED (no trade) rather than
//--- letting the EA trade against an unformed reference.
#define IPR_PROFILE_MIN_OBS 5

struct IprHourProfile
  {
   double            m_atr[IPR_PROFILE_HOURS][IPR_PROFILE_DAYS];
   double            m_spr[IPR_PROFILE_HOURS][IPR_PROFILE_DAYS];
   int               m_count[IPR_PROFILE_HOURS];
   int               m_head[IPR_PROFILE_HOURS];
   long              m_lastDay[IPR_PROFILE_HOURS];

   void              Reset()
     {
      for(int h = 0; h < IPR_PROFILE_HOURS; h++)
        {
         m_count[h] = 0;
         m_head[h] = 0;
         m_lastDay[h] = -1;
         for(int d = 0; d < IPR_PROFILE_DAYS; d++)
           {
            m_atr[h][d] = 0.0;
            m_spr[h][d] = 0.0;
           }
        }
     }

   //--- Record one completed hour. dayKey is days-since-epoch, which
   //--- makes the "one observation per hour per session" rule trivial
   //--- to enforce and idempotent if history is replayed on restart.
   void              Observe(const int hour, const long dayKey,
                             const double atr, const double spreadPrice)
     {
      if(hour < 0 || hour >= IPR_PROFILE_HOURS)
         return;
      if(atr <= 0.0)
         return;
      if(m_lastDay[hour] == dayKey)
         return;                      // already have this session's sample

      m_lastDay[hour] = dayKey;
      const int slot = m_head[hour];
      m_atr[hour][slot] = atr;
      m_spr[hour][slot] = spreadPrice;
      m_head[hour] = (slot + 1) % IPR_PROFILE_DAYS;
      if(m_count[hour] < IPR_PROFILE_DAYS)
         m_count[hour]++;
     }

   bool              Ready(const int hour) const
     {
      if(hour < 0 || hour >= IPR_PROFILE_HOURS)
         return false;
      return (m_count[hour] >= IPR_PROFILE_MIN_OBS);
     }

   bool              MedianAtr(const int hour, double &out) const
     {
      out = 0.0;
      if(!Ready(hour))
         return false;
      IprSampleSet s;
      s.Reset();
      for(int i = 0; i < m_count[hour]; i++)
         s.Add(m_atr[hour][i]);
      return IprMedian(s, out);
     }

   bool              MedianSpread(const int hour, double &out) const
     {
      out = 0.0;
      if(!Ready(hour))
         return false;
      IprSampleSet s;
      s.Reset();
      for(int i = 0; i < m_count[hour]; i++)
         s.Add(m_spr[hour][i]);
      return IprMedian(s, out);
     }

   //--- The hour's typical cost-to-volatility ratio, median(S)/median(A).
   //--- This single number is what the session filter ranks hours by.
   bool              HourRatio(const int hour, double &out) const
     {
      out = 0.0;
      double ma = 0.0, ms = 0.0;
      if(!MedianAtr(hour, ma) || !MedianSpread(hour, ms))
         return false;
      if(ma <= 0.0)
         return false;
      out = ms / ma;
      return true;
     }

   //--- How many hours currently have a formed reference.
   int               FormedHours() const
     {
      int n = 0;
      for(int h = 0; h < IPR_PROFILE_HOURS; h++)
        {
         if(Ready(h))
            n++;
        }
      return n;
     }

   //+---------------------------------------------------------------+
   //| Derived session filter (Phase 1 7.4): permit trading only in    |
   //| hours whose median spread/ATR is BOTH in the best 50% for this  |
   //| instrument AND below an absolute ceiling.                       |
   //|                                                                 |
   //| The relative half is the discovery mechanism - it is what finds  |
   //| London/NY on gold and the liquid hours on BTC from the           |
   //| instrument's own history, with no session constants. The         |
   //| absolute ceiling is the backstop that refuses an instrument      |
   //| which is expensive in every hour.                                |
   //+---------------------------------------------------------------+
   bool              HourTradeable(const int hour, const double ceiling) const
     {
      double r = 0.0;
      if(!HourRatio(hour, r))
         return false;
      if(r > ceiling)
         return false;

      //--- Rank against the other hours that have a formed reference.
      int formed = 0, better = 0;
      for(int h = 0; h < IPR_PROFILE_HOURS; h++)
        {
         double rh = 0.0;
         if(!HourRatio(h, rh))
            continue;
         formed++;
         if(rh < r)
            better++;
        }
      if(formed <= 1)
         return true;
      return (better * 2 < formed);      // strictly in the better half
     }

   int               TradeableHours(const double ceiling) const
     {
      int n = 0;
      for(int h = 0; h < IPR_PROFILE_HOURS; h++)
        {
         if(HourTradeable(h, ceiling))
            n++;
        }
      return n;
     }
  };

#endif // IPR_HOURPROFILE_MQH
