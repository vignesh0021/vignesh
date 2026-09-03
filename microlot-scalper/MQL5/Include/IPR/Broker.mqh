//+------------------------------------------------------------------+
//| Broker.mqh - MT5 execution with explicit retcode handling.       |
//|                                                                  |
//| Phase 2 section 33. Deliberately built on raw OrderSend rather   |
//| than CTrade so that every retcode is visible and the retry       |
//| policy is explicit: TRANSIENT errors (requote, price moved,      |
//| timeout) may be retried a bounded number of times; everything    |
//| else - invalid stops, no money, market closed - is a real        |
//| condition that a retry would only repeat.                        |
//|                                                                  |
//| Every failure is logged with the full context the spec lists.    |
//+------------------------------------------------------------------+
#ifndef IPR_BROKER_MQH
#define IPR_BROKER_MQH

#include "Types.mqh"
#include "Config.mqh"
#include "Logger.mqh"

#define IPR_MAX_SEND_RETRIES 2

//--- Only these are worth sending again.
bool IprIsTransientRetcode(const uint rc)
  {
   return (rc == TRADE_RETCODE_REQUOTE
           || rc == TRADE_RETCODE_PRICE_CHANGED
           || rc == TRADE_RETCODE_PRICE_OFF
           || rc == TRADE_RETCODE_TIMEOUT
           || rc == TRADE_RETCODE_CONNECTION
           || rc == TRADE_RETCODE_TOO_MANY_REQUESTS);
  }

//--- Filling mode that the symbol actually permits.
ENUM_ORDER_TYPE_FILLING IprPickFilling(const string symbol, const bool pending)
  {
   const long modes = SymbolInfoInteger(symbol, SYMBOL_FILLING_MODE);
   if(pending)
     {
      //--- Pending orders normally sit on the book until triggered.
      if((modes & SYMBOL_FILLING_FOK) != 0)
         return ORDER_FILLING_RETURN;
      if((modes & SYMBOL_FILLING_IOC) != 0)
         return ORDER_FILLING_RETURN;
      return ORDER_FILLING_RETURN;
     }
   if((modes & SYMBOL_FILLING_FOK) != 0)
      return ORDER_FILLING_FOK;
   if((modes & SYMBOL_FILLING_IOC) != 0)
      return ORDER_FILLING_IOC;
   return ORDER_FILLING_RETURN;
  }

class CIprBroker
  {
private:
   string            m_symbol;
   long              m_magic;
   CIprLogger       *m_log;

   void              LogFailure(const string what, const MqlTradeRequest &req,
                                const MqlTradeResult &res, const double atr)
     {
      if(m_log == NULL)
         return;
      const int digits = (int)SymbolInfoInteger(m_symbol, SYMBOL_DIGITS);
      const double spread = SymbolInfoDouble(m_symbol, SYMBOL_ASK)
                            - SymbolInfoDouble(m_symbol, SYMBOL_BID);
      m_log.Error(StringFormat(
                     "%s FAILED | retcode=%u (%s) | symbol=%s vol=%.4f price=%.*f "
                     "sl=%.*f tp=%.*f spread=%.*f atr=%.*f | comment=%s",
                     what, res.retcode, IprRetcodeText(res.retcode), m_symbol,
                     req.volume, digits, req.price, digits, req.sl, digits, req.tp,
                     digits, spread, digits, atr, res.comment));
     }

public:
   void              Init(const string symbol, const long magic, CIprLogger *log)
     {
      m_symbol = symbol;
      m_magic = magic;
      m_log = log;
     }

   static string     IprRetcodeText(const uint rc)
     {
      switch(rc)
        {
         case TRADE_RETCODE_DONE:            return "DONE";
         case TRADE_RETCODE_PLACED:          return "PLACED";
         case TRADE_RETCODE_REQUOTE:         return "REQUOTE";
         case TRADE_RETCODE_PRICE_CHANGED:   return "PRICE_CHANGED";
         case TRADE_RETCODE_PRICE_OFF:       return "PRICE_OFF";
         case TRADE_RETCODE_TIMEOUT:         return "TIMEOUT";
         case TRADE_RETCODE_CONNECTION:      return "CONNECTION";
         case TRADE_RETCODE_INVALID_STOPS:   return "INVALID_STOPS";
         case TRADE_RETCODE_INVALID_VOLUME:  return "INVALID_VOLUME";
         case TRADE_RETCODE_INVALID_PRICE:   return "INVALID_PRICE";
         case TRADE_RETCODE_NO_MONEY:        return "NO_MONEY";
         case TRADE_RETCODE_MARKET_CLOSED:   return "MARKET_CLOSED";
         case TRADE_RETCODE_TRADE_DISABLED:  return "TRADE_DISABLED";
         case TRADE_RETCODE_TOO_MANY_REQUESTS: return "TOO_MANY_REQUESTS";
         case TRADE_RETCODE_INVALID_FILL:    return "INVALID_FILL";
         case TRADE_RETCODE_POSITION_CLOSED: return "POSITION_CLOSED";
         case TRADE_RETCODE_INVALID_EXPIRATION: return "INVALID_EXPIRATION";
         case TRADE_RETCODE_ORDER_CHANGED:   return "ORDER_CHANGED";
         case TRADE_RETCODE_LIMIT_ORDERS:    return "LIMIT_ORDERS";
         case TRADE_RETCODE_LIMIT_VOLUME:    return "LIMIT_VOLUME";
        }
      return StringFormat("RC_%u", rc);
     }

   //+---------------------------------------------------------------+
   //| Preconditions that must hold before any order is attempted.    |
   //+---------------------------------------------------------------+
   bool              CanTrade(string &why) const
     {
      why = "";
      if(!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED))
        { why = "terminal: algo trading disabled"; return false; }
      if(!MQLInfoInteger(MQL_TRADE_ALLOWED))
        { why = "EA: algo trading not allowed on this chart"; return false; }
      if(!AccountInfoInteger(ACCOUNT_TRADE_ALLOWED))
        { why = "account: trading disabled"; return false; }
      if(!AccountInfoInteger(ACCOUNT_TRADE_EXPERT))
        { why = "account: expert trading disabled"; return false; }

      const ENUM_SYMBOL_TRADE_MODE mode =
         (ENUM_SYMBOL_TRADE_MODE)SymbolInfoInteger(m_symbol, SYMBOL_TRADE_MODE);
      if(mode != SYMBOL_TRADE_MODE_FULL && mode != SYMBOL_TRADE_MODE_LONGONLY
         && mode != SYMBOL_TRADE_MODE_SHORTONLY)
        { why = "symbol: trading disabled or close-only"; return false; }
      return true;
     }

   //--- Margin check before committing to an order.
   bool              HasMargin(const IprDirection dir, const double volume,
                               const double price) const
     {
      const ENUM_ORDER_TYPE t = (dir == IPR_DIR_LONG) ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
      double required = 0.0;
      if(!OrderCalcMargin(t, m_symbol, volume, price, required))
         return false;
      return (required <= AccountInfoDouble(ACCOUNT_MARGIN_FREE));
     }

   //+---------------------------------------------------------------+
   //| Place the entry stop order with SL and TP attached AT          |
   //| SUBMISSION. Phase 2 section 19: the protective stop must exist |
   //| from the moment the order does, so that a terminal or VPS      |
   //| failure between placement and fill cannot leave a naked        |
   //| position.                                                      |
   //+---------------------------------------------------------------+
   bool              PlaceEntryStop(const IprDirection dir, const double volume,
                                    const double price, const double sl, const double tp,
                                    const double atr, ulong &ticket, uint &retcode)
     {
      ticket = 0;
      retcode = 0;

      MqlTradeRequest req;
      MqlTradeResult  res;
      ZeroMemory(req);
      ZeroMemory(res);

      req.action = TRADE_ACTION_PENDING;
      req.symbol = m_symbol;
      req.volume = volume;
      req.type = (dir == IPR_DIR_LONG) ? ORDER_TYPE_BUY_STOP : ORDER_TYPE_SELL_STOP;
      req.price = price;
      req.sl = sl;
      req.tp = tp;
      req.magic = (ulong)m_magic;
      req.type_time = ORDER_TIME_GTC;
      req.type_filling = IprPickFilling(m_symbol, true);
      req.comment = "IPR";

      for(int attempt = 0; attempt <= IPR_MAX_SEND_RETRIES; attempt++)
        {
         if(!OrderSend(req, res))
           {
            retcode = res.retcode;
            LogFailure("PLACE_STOP", req, res, atr);
            if(!IprIsTransientRetcode(res.retcode))
               return false;
            continue;
           }

         retcode = res.retcode;
         if(res.retcode == TRADE_RETCODE_PLACED || res.retcode == TRADE_RETCODE_DONE)
           {
            ticket = res.order;
            return true;
           }

         LogFailure("PLACE_STOP", req, res, atr);
         if(!IprIsTransientRetcode(res.retcode))
            return false;
        }
      return false;
     }

   bool              DeleteOrder(const ulong ticket)
     {
      if(!OrderSelect(ticket))
         return true;                    // already gone

      MqlTradeRequest req;
      MqlTradeResult  res;
      ZeroMemory(req);
      ZeroMemory(res);

      req.action = TRADE_ACTION_REMOVE;
      req.order = ticket;

      if(!OrderSend(req, res))
        {
         m_log.Warn(StringFormat("DELETE_ORDER failed ticket=%I64u retcode=%u (%s)",
                                 ticket, res.retcode, IprRetcodeText(res.retcode)));
         return false;
        }
      return (res.retcode == TRADE_RETCODE_DONE || res.retcode == TRADE_RETCODE_PLACED);
     }

   bool              ModifyStop(const ulong positionTicket, const double newSl,
                                const double tp)
     {
      if(!PositionSelectByTicket(positionTicket))
         return false;

      MqlTradeRequest req;
      MqlTradeResult  res;
      ZeroMemory(req);
      ZeroMemory(res);

      req.action = TRADE_ACTION_SLTP;
      req.symbol = m_symbol;
      req.position = positionTicket;
      req.sl = newSl;
      req.tp = tp;

      if(!OrderSend(req, res))
        {
         m_log.Warn(StringFormat("MODIFY_SL failed ticket=%I64u retcode=%u (%s)",
                                 positionTicket, res.retcode, IprRetcodeText(res.retcode)));
         return false;
        }
      return (res.retcode == TRADE_RETCODE_DONE);
     }

   bool              ClosePosition(const ulong positionTicket, const double atr,
                                   const string reason)
     {
      if(!PositionSelectByTicket(positionTicket))
         return true;                    // already closed

      const double volume = PositionGetDouble(POSITION_VOLUME);
      const long type = PositionGetInteger(POSITION_TYPE);

      MqlTradeRequest req;
      MqlTradeResult  res;
      ZeroMemory(req);
      ZeroMemory(res);

      req.action = TRADE_ACTION_DEAL;
      req.symbol = m_symbol;
      req.position = positionTicket;
      req.volume = volume;
      req.magic = (ulong)m_magic;
      //--- Deviation derived from the live spread rather than a fixed
      //--- point count: 20 points means something different on XAUUSD,
      //--- BTCUSD and EURUSD, and this file must stay symbol-agnostic.
      req.deviation = (ulong)MathMax(10.0,
                        3.0 * (double)SymbolInfoInteger(m_symbol, SYMBOL_SPREAD));
      req.type_filling = IprPickFilling(m_symbol, false);
      req.comment = "IPR " + reason;

      for(int attempt = 0; attempt <= IPR_MAX_SEND_RETRIES; attempt++)
        {
         //--- Re-read the price each attempt: a stale close price is the
         //--- most common cause of a repeated PRICE_CHANGED rejection.
         if(type == POSITION_TYPE_BUY)
           {
            req.type = ORDER_TYPE_SELL;
            req.price = SymbolInfoDouble(m_symbol, SYMBOL_BID);
           }
         else
           {
            req.type = ORDER_TYPE_BUY;
            req.price = SymbolInfoDouble(m_symbol, SYMBOL_ASK);
           }

         if(OrderSend(req, res) && res.retcode == TRADE_RETCODE_DONE)
            return true;

         LogFailure("CLOSE", req, res, atr);
         if(!IprIsTransientRetcode(res.retcode))
            return false;
        }
      return false;
     }
  };

#endif // IPR_BROKER_MQH
