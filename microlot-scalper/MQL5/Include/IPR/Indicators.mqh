//+------------------------------------------------------------------+
//| Indicators.mqh - ATR(14), EMA20/50 and the Efficiency Ratio.     |
//|                                                                  |
//| These are computed in-EA rather than through iATR/iMA handles on |
//| purpose. Indicator handles depend on how much history the        |
//| terminal happens to have loaded, which makes a live value and a  |
//| tester value diverge for the same bar. Computing from our own    |
//| bar stream makes every number reproducible in both, and lets the |
//| g++ test harness exercise the exact same code.                   |
//|                                                                  |
//| Phase 1 section 4 fixes the component list: ATR, EMA20/50,       |
//| fractals and ER. Nothing else may be added here.                 |
//+------------------------------------------------------------------+
#ifndef IPR_INDICATORS_MQH
#define IPR_INDICATORS_MQH

#include "Types.mqh"
#include "MathUtil.mqh"

double IprTrueRange(const double high, const double low, const double prevClose)
  {
   const double a = high - low;
   const double b = MathAbs(high - prevClose);
   const double c = MathAbs(low - prevClose);
   return MathMax(a, MathMax(b, c));
  }

//+------------------------------------------------------------------+
//| Wilder ATR, updated one closed bar at a time.                    |
//| Seeded with a simple average of the first `period` true ranges,  |
//| then smoothed. State is rebuilt by replaying history on restart, |
//| so it is deterministic across sessions.                          |
//+------------------------------------------------------------------+
struct IprAtrState
  {
   double            m_atr;
   double            m_seedSum;
   double            m_prevClose;
   int               m_count;
   bool              m_hasPrev;
   int               m_period;

   void              Init(const int period)
     {
      m_atr = 0.0; m_seedSum = 0.0; m_prevClose = 0.0;
      m_count = 0; m_hasPrev = false;
      m_period = (period > 0) ? period : IPR_ATR_PERIOD;
     }

   bool              Ready() const { return (m_count >= m_period); }
   double            Value() const { return m_atr; }

   void              Update(const double high, const double low, const double close)
     {
      if(!m_hasPrev)
        {
         //--- First bar: no previous close, so TR degenerates to range.
         m_prevClose = close;
         m_hasPrev = true;
         m_seedSum += (high - low);
         m_count = 1;
         if(m_count >= m_period)
            m_atr = m_seedSum / m_period;
         return;
        }

      const double tr = IprTrueRange(high, low, m_prevClose);
      m_prevClose = close;

      if(m_count < m_period)
        {
         m_seedSum += tr;
         m_count++;
         if(m_count == m_period)
            m_atr = m_seedSum / m_period;
         return;
        }

      m_atr = (m_atr * (m_period - 1) + tr) / m_period;
      m_count++;
     }
  };

//+------------------------------------------------------------------+
//| EMA over closes, plus a short history of past EMA values so the  |
//| regime slope test (EMA20[0] - EMA20[5]) can be evaluated without |
//| recomputing the whole series.                                    |
//+------------------------------------------------------------------+
struct IprEmaState
  {
   double            m_ema;
   double            m_hist[IPR_EMA_SLOPE_BARS + 1]; // m_hist[0] = newest
   int               m_histN;
   int               m_count;
   int               m_period;
   double            m_k;

   void              Init(const int period)
     {
      m_ema = 0.0; m_histN = 0; m_count = 0;
      m_period = (period > 0) ? period : IPR_EMA_FAST;
      m_k = 2.0 / (m_period + 1.0);
      for(int i = 0; i <= IPR_EMA_SLOPE_BARS; i++)
         m_hist[i] = 0.0;
     }

   //--- The EMA is an IIR filter: after a few hundred bars the seed is
   //--- numerically irrelevant, so seeding on the first close is safe
   //--- provided the caller replays enough warmup history.
   bool              Ready() const { return (m_count >= m_period * 3); }
   double            Value() const { return m_ema; }

   //--- EMA as it stood `ago` bars back (0 = current).
   bool              Ago(const int ago, double &out) const
     {
      out = 0.0;
      if(ago < 0 || ago > IPR_EMA_SLOPE_BARS || ago >= m_histN)
         return false;
      out = m_hist[ago];
      return true;
     }

   void              Update(const double close)
     {
      if(m_count == 0)
         m_ema = close;
      else
         m_ema = close * m_k + m_ema * (1.0 - m_k);
      m_count++;

      for(int i = IPR_EMA_SLOPE_BARS; i > 0; i--)
         m_hist[i] = m_hist[i - 1];
      m_hist[0] = m_ema;
      if(m_histN <= IPR_EMA_SLOPE_BARS)
         m_histN++;
     }
  };

//+------------------------------------------------------------------+
//| Kaufman Efficiency Ratio across a bars-ago span.                 |
//|                                                                  |
//|   ER = |close(newer) - close(older)| / sum of |bar-to-bar moves| |
//|                                                                  |
//| Bounded in [0,1] and unitless, which is why Phase 1 section 4    |
//| uses it in place of ADX: it needs no smoothing period and no     |
//| per-symbol scaling. olderAgo must be the LARGER bars-ago index.  |
//+------------------------------------------------------------------+
bool IprEfficiencyRatio(const IprBars &bars, const int olderAgo,
                        const int newerAgo, double &out)
  {
   out = 0.0;
   if(olderAgo <= newerAgo || newerAgo < 0)
      return false;
   if(!bars.Has(olderAgo) || !bars.Has(newerAgo))
      return false;

   const double net = MathAbs(bars.CloseAgo(newerAgo) - bars.CloseAgo(olderAgo));

   double sum = 0.0;
   for(int a = olderAgo; a > newerAgo; a--)
      sum += MathAbs(bars.CloseAgo(a - 1) - bars.CloseAgo(a));

   if(sum <= 0.0)
      return false;
   out = net / sum;
   return true;
  }

#endif // IPR_INDICATORS_MQH
