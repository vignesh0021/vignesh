//+------------------------------------------------------------------+
//| Logger.mqh - structured diagnostics (MT5-only).                  |
//|                                                                  |
//| Phase 2 section 31: every rejected setup must carry a reason and |
//| every accepted setup must be fully described. Log lines are      |
//| pipe-delimited key=value so they can be pasted straight into a   |
//| spreadsheet when analysing a tester run.                         |
//+------------------------------------------------------------------+
#ifndef IPR_LOGGER_MQH
#define IPR_LOGGER_MQH

#include "Types.mqh"

string IprRejectName(const IprReject r)
  {
   switch(r)
     {
      case IPR_OK:                        return "OK";
      case IPR_REJ_NO_DATA:               return "NO_DATA";
      case IPR_REJ_INVALID_VOLUME:        return "INVALID_VOLUME";
      case IPR_REJ_SESSION:               return "SESSION";
      case IPR_REJ_VOLATILITY_TOO_LOW:    return "VOLATILITY_TOO_LOW";
      case IPR_REJ_VOLATILITY_TOO_HIGH:   return "VOLATILITY_TOO_HIGH";
      case IPR_REJ_SPREAD_TOO_HIGH:       return "SPREAD_TOO_HIGH";
      case IPR_REJ_SPREAD_ABNORMAL:       return "SPREAD_ABNORMAL";
      case IPR_REJ_SHOCK_FILTER:          return "SHOCK_FILTER";
      case IPR_REJ_REGIME_FLAT:           return "REGIME_FLAT";
      case IPR_REJ_REGIME_FLIP:           return "REGIME_FLIP";
      case IPR_REJ_NO_IMPULSE:            return "NO_IMPULSE";
      case IPR_REJ_IMPULSE_TOO_SMALL:     return "IMPULSE_TOO_SMALL";
      case IPR_REJ_ER_TOO_LOW:            return "ER_TOO_LOW";
      case IPR_REJ_NO_BOS:                return "NO_BOS";
      case IPR_REJ_NO_PULLBACK:           return "NO_PULLBACK";
      case IPR_REJ_PULLBACK_TOO_SHALLOW:  return "PULLBACK_TOO_SHALLOW";
      case IPR_REJ_PULLBACK_TOO_DEEP:     return "PULLBACK_TOO_DEEP";
      case IPR_REJ_PULLBACK_TOO_LONG:     return "PULLBACK_TOO_LONG";
      case IPR_REJ_PULLBACK_TOO_FAST:     return "PULLBACK_TOO_FAST";
      case IPR_REJ_NO_TURN_BAR:           return "NO_TURN_BAR";
      case IPR_REJ_DUPLICATE_SETUP:       return "DUPLICATE_SETUP";
      case IPR_REJ_NO_STRUCTURE_ROOM:     return "NO_STRUCTURE_ROOM";
      case IPR_REJ_TARGET_COST_INFEASIBLE:return "TARGET_COST_INFEASIBLE";
      case IPR_REJ_SL_TOO_TIGHT:          return "SL_TOO_TIGHT";
      case IPR_REJ_SL_TOO_WIDE:           return "SL_TOO_WIDE";
      case IPR_REJ_STOPS_LEVEL:           return "STOPS_LEVEL";
      case IPR_REJ_COOLDOWN:              return "COOLDOWN";
      case IPR_REJ_CLUSTER_STRUCTURE:     return "CLUSTER_STRUCTURE";
      case IPR_REJ_CLUSTER_TIME:          return "CLUSTER_TIME";
      case IPR_REJ_CLUSTER_DISTANCE:      return "CLUSTER_DISTANCE";
      case IPR_REJ_MAX_DAILY_TRADES:      return "MAX_DAILY_TRADES";
      case IPR_REJ_RISK_LIMIT:            return "RISK_LIMIT";
      case IPR_REJ_DAILY_LOSS_LIMIT:      return "DAILY_LOSS_LIMIT";
      case IPR_REJ_CONSEC_LOSSES:         return "CONSEC_LOSSES";
      case IPR_REJ_POSITION_OPEN:         return "POSITION_OPEN";
      case IPR_REJ_MAX_POSITIONS:         return "MAX_POSITIONS";
      case IPR_REJ_CORRELATION:           return "CORRELATION";
      case IPR_REJ_EXEC_HALTED:           return "EXEC_HALTED";
      case IPR_REJ_ROLLOVER_WINDOW:       return "ROLLOVER_WINDOW";
      case IPR_REJ_SETUP_EXPIRED:         return "SETUP_EXPIRED";
      case IPR_REJ_FEASIBILITY:           return "FEASIBILITY";
     }
   return "UNKNOWN";
  }

string IprExitName(const IprExitReason r)
  {
   switch(r)
     {
      case IPR_EXIT_NONE:            return "NONE";
      case IPR_EXIT_ROLLOVER:        return "ROLLOVER_FORCE_FLAT";
      case IPR_EXIT_SPREAD_BLOWOUT:  return "SPREAD_BLOWOUT";
      case IPR_EXIT_MOMENTUM_FAIL:   return "MOMENTUM_FAILURE";
      case IPR_EXIT_NO_PROGRESS:     return "NO_PROGRESS";
      case IPR_EXIT_MAX_HOLD:        return "MAX_HOLD";
     }
   return "UNKNOWN";
  }

string IprDirName(const IprDirection d)
  {
   if(d == IPR_DIR_LONG)  return "LONG";
   if(d == IPR_DIR_SHORT) return "SHORT";
   return "NONE";
  }

class CIprLogger
  {
private:
   IprLogLevel       m_level;
   string            m_tag;

public:
   void              Init(const IprLogLevel level, const string tag)
     {
      m_level = level;
      m_tag = tag;
     }

   void              SetLevel(const IprLogLevel level) { m_level = level; }
   bool              Enabled(const IprLogLevel lvl) const { return (m_level >= lvl); }

   void              Error(const string msg) { if(m_level >= IPR_LOG_ERROR) Print(m_tag, " ERROR | ", msg); }
   void              Warn(const string msg)  { if(m_level >= IPR_LOG_WARN)  Print(m_tag, " WARN  | ", msg); }
   void              Info(const string msg)  { if(m_level >= IPR_LOG_INFO)  Print(m_tag, " INFO  | ", msg); }
   void              Debug(const string msg) { if(m_level >= IPR_LOG_DEBUG) Print(m_tag, " DEBUG | ", msg); }

   //--- Rejections are logged at DEBUG because on a quiet instrument
   //--- there is one per bar; raise LogLevel to Debug when tuning.
   void              Reject(const IprReject r, const string extra)
     {
      if(m_level < IPR_LOG_DEBUG)
         return;
      Print(m_tag, " REJECT| ", IprRejectName(r), (extra == "" ? "" : " | " + extra));
     }
  };

#endif // IPR_LOGGER_MQH
