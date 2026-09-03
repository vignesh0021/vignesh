//+------------------------------------------------------------------+
//| RiskManager.mqh - risk controls, fully decoupled from the entry. |
//|                                                                  |
//| Phase 1 section 10. This component consumes only fill prices,    |
//| realised P&L and the clock. It knows nothing about impulses,     |
//| pullbacks or structure, which is what makes it replaceable and   |
//| independently testable.                                          |
//|                                                                  |
//| Volume is NEVER a function of results. There is no code path     |
//| here that changes trade size for any reason - no martingale, no  |
//| recovery, no drawdown scaling.                                   |
//+------------------------------------------------------------------+
#ifndef IPR_RISKMANAGER_MQH
#define IPR_RISKMANAGER_MQH

#include "Types.mqh"
#include "Config.mqh"

#define IPR_LOSS_HISTORY 50

struct IprRiskManager
  {
   long              m_dayKey;
   int               m_tradesToday;
   double            m_realisedToday;
   int               m_consecLosses;
   long              m_cooldownUntilBarSeq;
   bool              m_dayHalted;
   bool              m_execHalted;
   int               m_orderFailures;
   int               m_slipEvents;

   double            m_losses[IPR_LOSS_HISTORY];
   int               m_lossN;
   int               m_lossHead;

   void              Init()
     {
      m_dayKey = -1;
      m_tradesToday = 0;
      m_realisedToday = 0.0;
      m_consecLosses = 0;
      m_cooldownUntilBarSeq = 0;
      m_dayHalted = false;
      m_execHalted = false;
      m_orderFailures = 0;
      m_slipEvents = 0;
      m_lossN = 0;
      m_lossHead = 0;
      for(int i = 0; i < IPR_LOSS_HISTORY; i++)
         m_losses[i] = 0.0;
     }

   //--- Daily counters reset on the broker's date, not on a timer.
   void              OnNewDay(const long dayKey)
     {
      if(m_dayKey == dayKey)
         return;
      m_dayKey = dayKey;
      m_tradesToday = 0;
      m_realisedToday = 0.0;
      m_dayHalted = false;
      //--- Consecutive losses deliberately persist across the date
      //--- boundary: a streak is a property of the strategy's recent
      //--- behaviour, not of the calendar.
     }

   double            AverageLoss() const
     {
      if(m_lossN <= 0)
         return 0.0;
      double sum = 0.0;
      for(int i = 0; i < m_lossN; i++)
         sum += m_losses[i];
      return sum / m_lossN;
     }

   //--- min(3 x average loss, 2% of equity). Before any loss history
   //--- exists only the equity term binds.
   double            DailyLossLimit(const double equity, const IprConfig &cfg) const
     {
      const double byEquity = cfg.maxDailyLossEquityFrac * equity;
      const double avg = AverageLoss();
      if(avg <= 0.0)
         return byEquity;
      const double byAvg = IPR_DAILY_LOSS_AVGMULT * avg;
      return MathMin(byAvg, byEquity);
     }

   void              RecordResult(const double netProfit, const long barSeq)
     {
      m_tradesToday++;
      m_realisedToday += netProfit;

      if(netProfit < 0.0)
        {
         m_consecLosses++;
         m_losses[m_lossHead] = -netProfit;   // stored positive
         m_lossHead = (m_lossHead + 1) % IPR_LOSS_HISTORY;
         if(m_lossN < IPR_LOSS_HISTORY)
            m_lossN++;

         //--- Cooldown lengthens on a second consecutive loss. This is a
         //--- brake, not a recovery mechanism: nothing about the next
         //--- trade's size or target changes.
         const int bars = (m_consecLosses >= 2) ? IPR_COOLDOWN_LOSS2 : IPR_COOLDOWN_LOSS;
         m_cooldownUntilBarSeq = barSeq + bars;

         if(m_consecLosses >= IPR_MAX_CONSEC_LOSSES)
            m_dayHalted = true;
        }
      else
        {
         m_consecLosses = 0;
         m_cooldownUntilBarSeq = barSeq + IPR_COOLDOWN_WIN;
        }
     }

   void              RecordOrderFailure()
     {
      m_orderFailures++;
      if(m_orderFailures >= IPR_MAX_ORDER_FAILURES)
         m_execHalted = true;
     }

   //--- A fill that slipped more than twice the modelled estimate is an
   //--- execution-quality event. Five of them means the broker is not
   //--- delivering the conditions the cost model assumes.
   void              RecordSlippage(const double actualSlipPrice, const double estimatedSlipPrice)
     {
      if(estimatedSlipPrice <= 0.0)
         return;
      if(actualSlipPrice > IPR_SLIP_EVENT_MULT * estimatedSlipPrice)
        {
         m_slipEvents++;
         if(m_slipEvents >= IPR_MAX_SLIP_EVENTS)
            m_execHalted = true;
        }
     }

   void              ResetExecutionHealth()
     {
      m_orderFailures = 0;
      m_slipEvents = 0;
      m_execHalted = false;
     }

   //+---------------------------------------------------------------+
   //| The single question the signal path asks: may we open a new    |
   //| position right now? Ordered so the most serious blocker is the |
   //| one reported.                                                  |
   //+---------------------------------------------------------------+
   IprReject         CanTrade(const IprConfig &cfg, const double equity,
                              const long barSeq, const int openOnSymbol,
                              const int openAccount) const
     {
      if(m_execHalted)
         return IPR_REJ_EXEC_HALTED;
      if(m_dayHalted)
        {
         if(m_consecLosses >= IPR_MAX_CONSEC_LOSSES)
            return IPR_REJ_CONSEC_LOSSES;
         return IPR_REJ_DAILY_LOSS_LIMIT;
        }
      if(m_realisedToday <= -DailyLossLimit(equity, cfg))
         return IPR_REJ_DAILY_LOSS_LIMIT;
      if(openOnSymbol > 0)
         return IPR_REJ_POSITION_OPEN;
      if(openAccount >= cfg.maxPositionsAccount)
         return IPR_REJ_MAX_POSITIONS;
      if(m_tradesToday >= cfg.maxTradesPerDay)
         return IPR_REJ_MAX_DAILY_TRADES;
      if(barSeq < m_cooldownUntilBarSeq)
         return IPR_REJ_COOLDOWN;
      return IPR_OK;
     }

   //--- Hard cap on per-trade money risk. At minimum volume the size
   //--- cannot be reduced, so when the stop implies more risk than the
   //--- cap allows the only correct action is to SKIP the trade
   //--- (Phase 1 section 10, "min volume forces a larger loss").
   bool              RiskWithinCap(const double dSl, const double moneyPerPriceUnit,
                                   const double equity, const IprConfig &cfg,
                                   double &riskMoney) const
     {
      riskMoney = dSl * moneyPerPriceUnit;
      const double cap = cfg.maxDailyLossEquityFrac * equity;
      return (riskMoney <= cap);
     }
  };

#endif // IPR_RISKMANAGER_MQH
