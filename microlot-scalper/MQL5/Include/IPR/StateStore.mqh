//+------------------------------------------------------------------+
//| StateStore.mqh - persistence and restart recovery.               |
//|                                                                  |
//| Phase 2 section 32. The EA must survive a terminal or VPS        |
//| restart, a chart reload and a connection loss WITHOUT ever       |
//| opening a duplicate trade.                                       |
//|                                                                  |
//| Two halves make that work:                                       |
//|   - Broker truth (open positions, live orders) is re-read from   |
//|     MT5 by magic+symbol. It is never persisted, because MT5 is   |
//|     already the authority and a stale file would fight it.       |
//|   - EA-only truth (consumed SetupIDs, cooldowns, daily counters, |
//|     loss streak, per-trade bookkeeping the broker doesn't hold)  |
//|     is written here, because nothing else can reconstruct it.    |
//|                                                                  |
//| The file is plain key=value text so a stuck state can be         |
//| inspected - and, if necessary, deleted - by hand.                |
//+------------------------------------------------------------------+
#ifndef IPR_STATESTORE_MQH
#define IPR_STATESTORE_MQH

#include "Types.mqh"
#include "SetupMachine.mqh"
#include "RiskManager.mqh"
#include "Logger.mqh"

#define IPR_STATE_VERSION 1

class CIprStateStore
  {
private:
   string            m_file;
   CIprLogger       *m_log;

   static string     JoinULong(const IprConsumedRing &ring)
     {
      string s = "";
      for(int i = 0; i < ring.m_n; i++)
        {
         if(i > 0)
            s += ",";
         s += StringFormat("%I64u", ring.m_ids[i]);
        }
      return s;
     }

public:
   void              Init(const string symbol, const long magic, CIprLogger *log)
     {
      m_log = log;
      //--- One state file per symbol AND magic, so two instances of the
      //--- EA on different charts can never share or clobber state.
      m_file = StringFormat("IPR_%s_%I64d.state", symbol, magic);
     }

   string            FileName() const { return m_file; }

   bool              Save(const IprSetupMachine &machine, const IprRiskManager &risk,
                          const IprTradeState &trade)
     {
      const int h = FileOpen(m_file, FILE_WRITE | FILE_TXT | FILE_ANSI);
      if(h == INVALID_HANDLE)
        {
         if(m_log != NULL)
            m_log.Warn(StringFormat("state save failed: cannot open %s (err %d)",
                                    m_file, GetLastError()));
         return false;
        }

      FileWriteString(h, StringFormat("V=%d\n", IPR_STATE_VERSION));
      FileWriteString(h, StringFormat("BARSEQ=%I64d\n", machine.m_barSeq));
      FileWriteString(h, StringFormat("CONSUMED=%s\n", JoinULong(machine.m_consumed)));

      for(int s = 0; s < 2; s++)
         FileWriteString(h, StringFormat("CL%d=%d,%.10f,%.10f,%I64d\n", s,
                                         machine.m_cluster.m_has[s] ? 1 : 0,
                                         machine.m_cluster.m_legExtreme[s],
                                         machine.m_cluster.m_entryPrice[s],
                                         machine.m_cluster.m_entryBarSeq[s]));

      FileWriteString(h, StringFormat("RISK=%I64d,%d,%.6f,%d,%I64d,%d,%d,%d,%d\n",
                                      risk.m_dayKey, risk.m_tradesToday,
                                      risk.m_realisedToday, risk.m_consecLosses,
                                      risk.m_cooldownUntilBarSeq,
                                      risk.m_dayHalted ? 1 : 0,
                                      risk.m_execHalted ? 1 : 0,
                                      risk.m_orderFailures, risk.m_slipEvents));

      string losses = "";
      for(int i = 0; i < risk.m_lossN; i++)
        {
         if(i > 0)
            losses += ",";
         losses += StringFormat("%.6f", risk.m_losses[i]);
        }
      FileWriteString(h, StringFormat("LOSSES=%s\n", losses));

      //--- Per-trade bookkeeping MT5 does not hold for us: the planned
      //--- target/stop distances, bars held and the favourable-excursion
      //--- high-water mark that the no-progress exit depends on.
      FileWriteString(h, StringFormat("TRADE=%d,%I64u,%d,%.10f,%.10f,%.10f,%.10f,%.10f,%I64d,%d,%.10f,%d,%I64u\n",
                                      trade.active ? 1 : 0, trade.positionTicket,
                                      (int)trade.dir, trade.entryPrice, trade.stopPrice,
                                      trade.targetPrice, trade.dTp, trade.dSl,
                                      trade.entryTime, trade.barsHeld, trade.mfePrice,
                                      trade.momFailCloses, trade.setupId));
      FileClose(h);
      return true;
     }

   bool              Load(IprSetupMachine &machine, IprRiskManager &risk,
                          IprTradeState &trade)
     {
      if(!FileIsExist(m_file))
         return false;

      const int h = FileOpen(m_file, FILE_READ | FILE_TXT | FILE_ANSI);
      if(h == INVALID_HANDLE)
         return false;

      while(!FileIsEnding(h))
        {
         const string line = FileReadString(h);
         if(StringLen(line) < 2)
            continue;

         string kv[];
         if(StringSplit(line, '=', kv) != 2)
            continue;
         const string key = kv[0];
         const string val = kv[1];

         if(key == "V")
           {
            if((int)StringToInteger(val) != IPR_STATE_VERSION)
              {
               //--- A version change means the layout may have moved.
               //--- Starting clean is strictly safer than mis-parsing
               //--- cooldowns or consumed ids.
               FileClose(h);
               if(m_log != NULL)
                  m_log.Warn("state file version mismatch - starting with clean state");
               return false;
              }
            continue;
           }

         if(key == "BARSEQ")
           { machine.m_barSeq = (long)StringToInteger(val); continue; }

         if(key == "CONSUMED")
           {
            if(StringLen(val) == 0)
               continue;
            string ids[];
            const int n = StringSplit(val, ',', ids);
            for(int i = 0; i < n; i++)
              {
               if(StringLen(ids[i]) > 0)
                  machine.m_consumed.Add((ulong)StringToInteger(ids[i]));
              }
            continue;
           }

         if(key == "CL0" || key == "CL1")
           {
            const int s = (key == "CL0") ? 0 : 1;
            string f[];
            if(StringSplit(val, ',', f) != 4)
               continue;
            machine.m_cluster.m_has[s] = (StringToInteger(f[0]) != 0);
            machine.m_cluster.m_legExtreme[s] = StringToDouble(f[1]);
            machine.m_cluster.m_entryPrice[s] = StringToDouble(f[2]);
            machine.m_cluster.m_entryBarSeq[s] = (long)StringToInteger(f[3]);
            continue;
           }

         if(key == "RISK")
           {
            string f[];
            if(StringSplit(val, ',', f) != 9)
               continue;
            risk.m_dayKey = (long)StringToInteger(f[0]);
            risk.m_tradesToday = (int)StringToInteger(f[1]);
            risk.m_realisedToday = StringToDouble(f[2]);
            risk.m_consecLosses = (int)StringToInteger(f[3]);
            risk.m_cooldownUntilBarSeq = (long)StringToInteger(f[4]);
            risk.m_dayHalted = (StringToInteger(f[5]) != 0);
            risk.m_execHalted = (StringToInteger(f[6]) != 0);
            risk.m_orderFailures = (int)StringToInteger(f[7]);
            risk.m_slipEvents = (int)StringToInteger(f[8]);
            continue;
           }

         if(key == "LOSSES")
           {
            if(StringLen(val) == 0)
               continue;
            string f[];
            const int n = StringSplit(val, ',', f);
            for(int i = 0; i < n && i < IPR_LOSS_HISTORY; i++)
              {
               risk.m_losses[i] = StringToDouble(f[i]);
               risk.m_lossN = i + 1;
               risk.m_lossHead = (i + 1) % IPR_LOSS_HISTORY;
              }
            continue;
           }

         if(key == "TRADE")
           {
            string f[];
            if(StringSplit(val, ',', f) != 13)
               continue;
            trade.active = (StringToInteger(f[0]) != 0);
            trade.positionTicket = (ulong)StringToInteger(f[1]);
            trade.dir = (IprDirection)((int)StringToInteger(f[2]));
            trade.entryPrice = StringToDouble(f[3]);
            trade.stopPrice = StringToDouble(f[4]);
            trade.targetPrice = StringToDouble(f[5]);
            trade.dTp = StringToDouble(f[6]);
            trade.dSl = StringToDouble(f[7]);
            trade.entryTime = (long)StringToInteger(f[8]);
            trade.barsHeld = (int)StringToInteger(f[9]);
            trade.mfePrice = StringToDouble(f[10]);
            trade.momFailCloses = (int)StringToInteger(f[11]);
            trade.setupId = (ulong)StringToInteger(f[12]);
            continue;
           }
        }

      FileClose(h);
      return true;
     }
  };

#endif // IPR_STATESTORE_MQH
