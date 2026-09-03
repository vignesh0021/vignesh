//+------------------------------------------------------------------+
//| BarFeedMT5.mqh - bar feed, indicator state and hour profile.     |
//|                                                                  |
//| Owns everything that advances once per closed M5 bar. Two rules  |
//| govern this file:                                                |
//|                                                                  |
//|  1. NO LOOK-AHEAD. Only closed bars are ever fed in (CopyRates   |
//|     starts at index 1, never 0), and an hour is only recorded    |
//|     into the reference profile once it has fully elapsed.        |
//|  2. DETERMINISM ACROSS RESTARTS. Indicator state is rebuilt by   |
//|     replaying the same history, so a restarted EA computes the   |
//|     same ATR/EMA as one that has been running for days.          |
//+------------------------------------------------------------------+
#ifndef IPR_BARFEEDMT5_MQH
#define IPR_BARFEEDMT5_MQH

#include "Types.mqh"
#include "Indicators.mqh"
#include "HourProfile.mqh"
#include "Gates.mqh"
#include "Logger.mqh"

//--- Warmup depth: 20 sessions for the hour profile plus room for the
//--- EMA(50) to converge. 288 M5 bars per 24h session.
#define IPR_WARMUP_BARS (IPR_PROFILE_DAYS * 288 + 600)

class CIprMarketData
  {
public:
   //--- Public by design: IprBars is ~26KB and MQL5 can neither take a
   //--- pointer to a struct (GetPointer works on classes only) nor
   //--- return a reference, so the alternative would be copying it on
   //--- every bar. Callers pass these straight into the pure functions.
   string            m_symbol;
   double            m_point;
   IprBars           m_bars;
   IprAtrState       m_atr;
   IprEmaState       m_emaFast;
   IprEmaState       m_emaSlow;
   IprHourProfile    m_profile;

   long              m_lastBarTime;
   int               m_curHour;
   long              m_curDayKey;
   double            m_hourEndAtr;
   double            m_hourEndSpread;
   int               m_shockStandDown;

   static long       DayKeyOf(const long t)  { return t / 86400; }
   static int        HourOf(const long t)    { return (int)((t % 86400) / 3600); }

   //--- Feed one closed bar through every stateful component, in the
   //--- one order that keeps them consistent with each other.
   void              Ingest(const MqlRates &r)
     {
      const int hour = HourOf((long)r.time);
      const long dayKey = DayKeyOf((long)r.time);

      //--- An hour boundary means the PREVIOUS hour is now complete, so
      //--- its final ATR/spread become a reference observation. Doing it
      //--- here (rather than on the current bar) is what keeps the
      //--- current hour out of its own median.
      if(m_curHour >= 0 && hour != m_curHour && m_hourEndAtr > 0.0)
         m_profile.Observe(m_curHour, m_curDayKey, m_hourEndAtr, m_hourEndSpread);

      m_curHour = hour;
      m_curDayKey = dayKey;

      IprBar bar;
      bar.time = (long)r.time;
      bar.open = r.open;
      bar.high = r.high;
      bar.low = r.low;
      bar.close = r.close;
      bar.spreadPts = (int)r.spread;
      m_bars.Push(bar);

      m_atr.Update(r.high, r.low, r.close);
      m_emaFast.Update(r.close);
      m_emaSlow.Update(r.close);

      if(m_atr.Ready())
        {
         m_hourEndAtr = m_atr.Value();
         m_hourEndSpread = (double)r.spread * m_point;
        }

      //--- Shock latch: a >3xATR bar stands the strategy down for 6
      //--- bars (Phase 1 5.1 G4).
      if(m_shockStandDown > 0)
         m_shockStandDown--;
      if(m_atr.Ready() && (r.high - r.low) > IPR_SHOCK_ATR_MULT * m_atr.Value())
         m_shockStandDown = IPR_SHOCK_STANDDOWN;

      m_lastBarTime = (long)r.time;
     }

   void              Init(const string symbol, const double point)
     {
      m_symbol = symbol;
      m_point = point;
      m_bars.Reset();
      m_atr.Init(IPR_ATR_PERIOD);
      m_emaFast.Init(IPR_EMA_FAST);
      m_emaSlow.Init(IPR_EMA_SLOW);
      m_profile.Reset();
      m_lastBarTime = 0;
      m_curHour = -1;
      m_curDayKey = 0;
      m_hourEndAtr = 0.0;
      m_hourEndSpread = 0.0;
      m_shockStandDown = 0;
     }

   bool              Ready() const
     {
      return (m_atr.Ready() && m_emaFast.Ready() && m_emaSlow.Ready()
              && m_bars.Count() >= IPR_ATR_PERIOD + 10);
     }

   double            Atr() const { return m_atr.Value(); }
   long              LastBarTime() const { return m_lastBarTime; }
   int               BarCount() const { return m_bars.Count(); }

   bool              MedianSpread(const int hour, double &out) const
     {
      return m_profile.MedianSpread(hour, out);
     }

   //+---------------------------------------------------------------+
   //| Replay history to seed every stateful component.               |
   //+---------------------------------------------------------------+
   bool              Warmup(CIprLogger &log)
     {
      MqlRates rates[];
      ArraySetAsSeries(rates, false);          // index 0 = oldest

      //--- start_pos 1 excludes the currently forming bar.
      const int copied = CopyRates(m_symbol, PERIOD_M5, 1, IPR_WARMUP_BARS, rates);
      if(copied <= 0)
        {
         log.Error(StringFormat("CopyRates(%s,M5) returned %d - no history available",
                                m_symbol, copied));
         return false;
        }

      for(int i = 0; i < copied; i++)
         Ingest(rates[i]);

      log.Info(StringFormat("Warmup: %d M5 bars replayed, ATR=%.*f, profile hours ready=%d",
                            copied, (int)SymbolInfoInteger(m_symbol, SYMBOL_DIGITS),
                            m_atr.Value(), ReadyHourCount()));

      if(!Ready())
        {
         log.Error("Warmup incomplete: not enough M5 history to seed ATR/EMA. "
                   "Load more history for this symbol before trading.");
         return false;
        }
      return true;
     }

   int               ReadyHourCount() const
     {
      int n = 0;
      for(int h = 0; h < IPR_PROFILE_HOURS; h++)
        {
         if(m_profile.Ready(h))
            n++;
        }
      return n;
     }

   //+---------------------------------------------------------------+
   //| Pull any bars that closed since the last call. Returns true if |
   //| at least one new bar was ingested.                             |
   //+---------------------------------------------------------------+
   bool              Poll()
     {
      MqlRates rates[];
      ArraySetAsSeries(rates, false);
      const int copied = CopyRates(m_symbol, PERIOD_M5, 1, 8, rates);
      if(copied <= 0)
         return false;

      bool advanced = false;
      for(int i = 0; i < copied; i++)
        {
         if((long)rates[i].time <= m_lastBarTime)
            continue;                          // already ingested
         Ingest(rates[i]);
         advanced = true;
        }
      return advanced;
     }

   //+---------------------------------------------------------------+
   //| Assemble the gate context for the just-closed bar.              |
   //+---------------------------------------------------------------+
   void              BuildCtx(const double spreadPrice, IprMarketCtx &ctx) const
     {
      ctx.Reset();
      ctx.atr = m_atr.Value();
      ctx.emaFast = m_emaFast.Value();
      ctx.emaSlow = m_emaSlow.Value();

      double ago = 0.0;
      ctx.emaAgoValid = m_emaFast.Ago(IPR_EMA_SLOPE_BARS, ago);
      ctx.emaFastAgo = ago;

      ctx.spreadPrice = spreadPrice;
      ctx.hour = m_curHour;
      ctx.dayKey = m_curDayKey;
      ctx.barTime = m_lastBarTime;
      ctx.shockStandDownBars = m_shockStandDown;
     }

   double            EmaFast() const { return m_emaFast.Value(); }
   double            LastClose() const
     {
      return (m_bars.Count() > 0) ? m_bars.CloseAgo(0) : 0.0;
     }
  };

#endif // IPR_BARFEEDMT5_MQH
