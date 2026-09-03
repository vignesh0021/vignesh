//+------------------------------------------------------------------+
//| Config.mqh - the complete tunable surface of the strategy.       |
//|                                                                  |
//| Only the four fields marked OPTIMISABLE belong to the approved   |
//| optimisation set (Phase 1 section J). Everything else is either  |
//| an account/broker fact (volume, commission) or an operational    |
//| switch. The fixed strategy constants live in Types.mqh as        |
//| #defines specifically so they cannot be reached by the optimiser.|
//+------------------------------------------------------------------+
#ifndef IPR_CONFIG_MQH
#define IPR_CONFIG_MQH

#include "Types.mqh"

struct IprConfig
  {
   //--- OPTIMISABLE (4 parameters, 81 combinations)
   int               nImp;          // 4 / 6 / 8
   double            lMinMult;      // 1.0 / 1.2 / 1.5
   double            tpMult;        // 1.5 / 2.0 / 2.5
   double            costBudget;    // 0.10 / 0.12 / 0.15

   //--- Account / instrument facts
   double            volume;
   double            targetNet;             // net profit floor, account currency
   double            commissionPerLotRT;    // round turn, account currency per 1.0 lot
   double            slipEstSpreadMult;     // modelled slippage per side, as a fraction of spread

   //--- Operational
   long              magic;
   bool              sessionFilterEnabled;
   bool              breakEvenEnabled;
   bool              correlationFilterEnabled;
   int               maxPositionsAccount;
   int               maxTradesPerDay;
   double            maxDailyLossEquityFrac;
   int               rolloverHour;          // broker server hour of daily rollover
   int               rolloverGuardMinutes;  // no new entries / force flat around it
   IprLogLevel       logLevel;

   void              Reset()
     {
      nImp = 6;
      lMinMult = 1.2;
      tpMult = 2.0;
      costBudget = 0.12;
      volume = 0.01;
      targetNet = 1.0;
      commissionPerLotRT = 0.0;
      slipEstSpreadMult = 0.25;
      magic = 20260903;
      sessionFilterEnabled = true;
      breakEvenEnabled = false;      // Phase 1 8.4: default OFF, unproven
      correlationFilterEnabled = true;
      maxPositionsAccount = 2;
      maxTradesPerDay = IPR_MAX_TRADES_DAY;
      maxDailyLossEquityFrac = IPR_DAILY_LOSS_EQFRAC;
      rolloverHour = 0;
      rolloverGuardMinutes = 15;
      logLevel = IPR_LOG_INFO;
     }

   //--- Reject nonsense before it can silently distort the strategy.
   bool              Validate(string &err) const
     {
      err = "";
      if(nImp < 2 || nImp > 50)
        { err = "nImp out of range (2..50)"; return false; }
      if(lMinMult <= 0.0 || lMinMult > 10.0)
        { err = "lMinMult out of range (0..10]"; return false; }
      if(tpMult <= 0.0 || tpMult > 20.0)
        { err = "tpMult out of range (0..20]"; return false; }
      if(costBudget <= 0.0 || costBudget > 1.0)
        { err = "costBudget out of range (0..1]"; return false; }
      if(volume <= 0.0)
        { err = "volume must be positive"; return false; }
      if(targetNet <= 0.0)
        { err = "targetNet must be positive"; return false; }
      if(commissionPerLotRT < 0.0)
        { err = "commissionPerLotRT must be >= 0"; return false; }
      if(slipEstSpreadMult < 0.0 || slipEstSpreadMult > 5.0)
        { err = "slipEstSpreadMult out of range [0..5]"; return false; }
      if(maxPositionsAccount < 1 || maxPositionsAccount > 10)
        { err = "maxPositionsAccount out of range (1..10)"; return false; }
      if(maxTradesPerDay < 1 || maxTradesPerDay > 100)
        { err = "maxTradesPerDay out of range (1..100)"; return false; }
      if(maxDailyLossEquityFrac <= 0.0 || maxDailyLossEquityFrac > 1.0)
        { err = "maxDailyLossEquityFrac out of range (0..1]"; return false; }
      if(rolloverHour < 0 || rolloverHour > 23)
        { err = "rolloverHour out of range (0..23)"; return false; }
      if(rolloverGuardMinutes < 0 || rolloverGuardMinutes > 240)
        { err = "rolloverGuardMinutes out of range (0..240)"; return false; }
      return true;
     }
  };

#endif // IPR_CONFIG_MQH
