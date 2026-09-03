//+------------------------------------------------------------------+
//| SymbolSpecMT5.mqh - the symbol specification engine (MT5-only).  |
//|                                                                  |
//| Phase 2 section 3: NOTHING about an instrument may be hardcoded. |
//| Everything below is read from the terminal at runtime, and the   |
//| money conversion M is cross-checked against the broker's own     |
//| OrderCalcProfit so a mis-reported tick value cannot silently     |
//| corrupt every cost calculation downstream.                       |
//+------------------------------------------------------------------+
#ifndef IPR_SYMBOLSPECMT5_MQH
#define IPR_SYMBOLSPECMT5_MQH

#include "Types.mqh"
#include "Config.mqh"
#include "CostModel.mqh"
#include "MathUtil.mqh"
#include "Logger.mqh"

bool IprLoadSymbolSpec(const string symbol, IprSymbolSpec &spec, string &err)
  {
   spec.Reset();
   err = "";

   if(!SymbolSelect(symbol, true))
     {
      err = "SymbolSelect failed for " + symbol;
      return false;
     }

   spec.digits       = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   spec.point        = SymbolInfoDouble(symbol, SYMBOL_POINT);
   spec.tickSize     = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_SIZE);
   spec.tickValue    = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_VALUE);
   spec.contractSize = SymbolInfoDouble(symbol, SYMBOL_TRADE_CONTRACT_SIZE);
   spec.volMin       = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
   spec.volMax       = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MAX);
   spec.volStep      = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);
   spec.swapLong     = SymbolInfoDouble(symbol, SYMBOL_SWAP_LONG);
   spec.swapShort    = SymbolInfoDouble(symbol, SYMBOL_SWAP_SHORT);

   const long stopsLevel  = SymbolInfoInteger(symbol, SYMBOL_TRADE_STOPS_LEVEL);
   const long freezeLevel = SymbolInfoInteger(symbol, SYMBOL_TRADE_FREEZE_LEVEL);
   spec.stopsLevelPrice  = (double)stopsLevel * spec.point;
   spec.freezeLevelPrice = (double)freezeLevel * spec.point;

   if(spec.point <= 0.0)      { err = "SYMBOL_POINT is zero";              return false; }
   if(spec.tickSize <= 0.0)   { err = "SYMBOL_TRADE_TICK_SIZE is zero";    return false; }
   if(spec.tickValue <= 0.0)  { err = "SYMBOL_TRADE_TICK_VALUE is zero";   return false; }
   if(spec.volStep <= 0.0)    { err = "SYMBOL_VOLUME_STEP is zero";        return false; }
   if(spec.volMin <= 0.0)     { err = "SYMBOL_VOLUME_MIN is zero";         return false; }

   spec.valid = true;
   return true;
  }

//+------------------------------------------------------------------+
//| Cross-check M against OrderCalcProfit.                           |
//|                                                                  |
//| OrderCalcProfit gives the account-currency result of a move from |
//| priceOpen to priceClose, so asking it for a move of exactly 1.0  |
//| price unit returns M directly. When the two disagree by more     |
//| than 1% the BROKER's answer wins: it is the number that will     |
//| actually settle, and the discrepancy usually means the tick      |
//| value needs currency conversion.                                 |
//+------------------------------------------------------------------+
bool IprValidateMoneyPerPriceUnit(const string symbol, const IprSymbolSpec &spec,
                                  const double volume, CIprLogger &log,
                                  double &mOut)
  {
   mOut = 0.0;
   const double mFormula = IprMoneyPerPriceUnit(spec, volume);
   if(mFormula <= 0.0)
      return false;

   const double px = SymbolInfoDouble(symbol, SYMBOL_ASK);
   if(px <= 0.0)
     {
      mOut = mFormula;
      return true;                     // no quote yet; formula is all we have
     }

   double profit = 0.0;
   if(!OrderCalcProfit(ORDER_TYPE_BUY, symbol, volume, px, px + 1.0, profit) || profit <= 0.0)
     {
      log.Warn("OrderCalcProfit unavailable; using tick-value formula for M");
      mOut = mFormula;
      return true;
     }

   const double diff = MathAbs(profit - mFormula) / mFormula;
   if(diff > 0.01)
     {
      log.Warn(StringFormat("M mismatch: formula=%.6f OrderCalcProfit=%.6f (%.2f%%). "
                            "Using the broker value.", mFormula, profit, diff * 100.0));
      mOut = profit;
     }
   else
      mOut = profit;

   return true;
  }

//+------------------------------------------------------------------+
//| Volume validation. Phase 2 section 3 is explicit: if the         |
//| configured volume is not tradeable, DO NOT silently substitute   |
//| another one. Log the reason and refuse to trade the symbol.      |
//+------------------------------------------------------------------+
bool IprValidateVolume(const IprSymbolSpec &spec, const double requested,
                       double &normalized, string &err)
  {
   normalized = 0.0;
   err = "";

   if(!IprNormalizeVolume(requested, spec, normalized))
     {
      err = StringFormat("volume %.4f is not tradeable (min=%.4f max=%.4f step=%.4f)",
                         requested, spec.volMin, spec.volMax, spec.volStep);
      return false;
     }

   //--- Snapping DOWN to the volume grid must not change the user's
   //--- intent. If it would, that is a configuration error, not
   //--- something to paper over.
   if(MathAbs(normalized - requested) > 1e-9)
     {
      err = StringFormat("volume %.4f does not sit on the broker's volume step "
                         "(nearest valid below is %.4f). Set a valid volume explicitly.",
                         requested, normalized);
      return false;
     }
   return true;
  }

//+------------------------------------------------------------------+
//| Startup feasibility report (Phase 2 section 5).                  |
//|                                                                  |
//| Answers, in the log, whether TargetNet is reachable at all for   |
//| this symbol/volume given current costs and volatility. The EA    |
//| prefers NO TRADE over an economically impossible scalp.          |
//+------------------------------------------------------------------+
bool IprLogFeasibility(const string symbol, const IprSymbolSpec &spec,
                       const IprConfig &cfg, const IprCosts &costs,
                       const double atr, CIprLogger &log)
  {
   double ratio = 0.0;
   const bool ok = IprFeasible(costs, atr, IPR_FEASIBILITY_MAX_ATR, ratio);

   log.Info("---------------- FEASIBILITY ----------------");
   log.Info(StringFormat("SYMBOL                  = %s", symbol));
   log.Info(StringFormat("VOLUME                  = %.4f", cfg.volume));
   log.Info(StringFormat("ATR(M5,14)              = %.*f", spec.digits, atr));
   log.Info(StringFormat("SPREAD                  = %.*f", spec.digits, costs.spreadPrice));
   log.Info(StringFormat("M (money per 1.0 move)  = %.6f", costs.moneyPerPriceUnit));
   log.Info(StringFormat("ESTIMATED COST          = %.4f (spread %.*f + slip %.*f + comm %.4f)",
                         costs.totalMoney, spec.digits, costs.spreadPrice,
                         spec.digits, costs.slipPrice, costs.commissionMoney));
   log.Info(StringFormat("REQUIRED $%.2f-NET MOVE  = %.*f",
                         cfg.targetNet, spec.digits, costs.reqMovePrice));
   log.Info(StringFormat("ATR RATIO               = %.2f (limit %.2f)",
                         ratio, IPR_FEASIBILITY_MAX_ATR));
   log.Info(StringFormat("FEASIBILITY RESULT      = %s", ok ? "FEASIBLE" : "NOT FEASIBLE"));
   if(!ok)
      log.Error(StringFormat("REJECTION REASON        = required move is %.2f x ATR; "
                             "TargetNet %.2f is not achievable at volume %.4f on %s. "
                             "Trading disabled for this symbol.",
                             ratio, cfg.targetNet, cfg.volume, symbol));
   log.Info("---------------------------------------------");
   return ok;
  }

#endif // IPR_SYMBOLSPECMT5_MQH
