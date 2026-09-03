//+------------------------------------------------------------------+
//|                                                  IPR_Scalper.mq5 |
//|      Impulse -> Pullback -> Resumption micro-lot scalper (M5)    |
//|                                                                  |
//| Faithful implementation of the approved Phase 1 specification.   |
//| The strategy rules live in the pure headers under Include/IPR;   |
//| this file is the MT5 shell around them: clock, quotes, orders,   |
//| position bookkeeping and persistence.                            |
//|                                                                  |
//| CONTAINS NO: martingale, grid, averaging, recovery sizing, or    |
//| any path whatsoever by which volume depends on prior results.    |
//| Volume is read once from the inputs and never recomputed.        |
//+------------------------------------------------------------------+
#property copyright "IPR Scalper"
#property version   "1.00"
#property strict
#property description "Impulse-Pullback-Resumption micro-lot scalper. Phase 1 spec, M5, symbol-agnostic."

#include <IPR/Types.mqh>
#include <IPR/Config.mqh>
#include <IPR/MathUtil.mqh>
#include <IPR/CostModel.mqh>
#include <IPR/SignalEngine.mqh>
#include <IPR/ExitEngine.mqh>
#include <IPR/RiskManager.mqh>
#include <IPR/Logger.mqh>
#include <IPR/SymbolSpecMT5.mqh>
#include <IPR/BarFeedMT5.mqh>
#include <IPR/Broker.mqh>
#include <IPR/StateStore.mqh>

//--- OPTIMISABLE SET (the only four; 81 combinations) -------------
input group "=== Optimisable (approved set only) ==="
input int    InpNImp              = 6;      // N_imp: impulse lookback bars (4/6/8)
input double InpLMinMult          = 1.2;    // L_min_mult: impulse size in ATR (1.0/1.2/1.5)
input double InpTpMult            = 2.0;    // TP_mult: target in ATR (1.5/2.0/2.5)
input double InpCostBudget        = 0.12;   // CostBudget: max cost/(dTp+dSl) (0.10/0.12/0.15)

//--- Instrument and account facts ---------------------------------
input group "=== Instrument / account ==="
input string InpSymbol            = "";     // Symbol ("" = chart symbol)
input double InpVolume            = 0.01;   // Volume in lots (never varied by results)
input double InpTargetNet         = 1.00;   // Net profit FLOOR per trade (account currency)
input double InpCommissionPerLot  = 0.0;    // Commission per 1.0 lot ROUND TURN (0 = auto-measure)
input double InpSlipEstSpreadMult = 0.25;   // Modelled slippage per side, as a fraction of spread

//--- Risk and operations ------------------------------------------
input group "=== Risk / operations ==="
input int    InpMaxTradesPerDay   = 4;      // Max trades per day per symbol
input double InpMaxDailyLossPct   = 2.0;    // Daily loss limit, % of equity
input int    InpMaxPositionsAcct  = 2;      // Max simultaneous positions account-wide
input bool   InpSessionFilter     = true;   // Enable the derived session filter
input string InpCorrelationGroups  = "XAU,XAG;BTC,ETH"; // Correlation groups (';' between groups)
input bool   InpBreakEven         = false;  // Break-even step (unproven; default OFF)
input int    InpRolloverHour      = 0;      // Broker server hour of daily rollover
input int    InpRolloverGuardMin  = 15;     // Force-flat / no-entry guard around rollover

//--- Housekeeping --------------------------------------------------
input group "=== Housekeeping ==="
input long   InpMagic             = 20260903; // Magic number
input int    InpLogLevel          = 3;        // 0=silent 1=error 2=warn 3=info 4=debug

//--- Globals -------------------------------------------------------
IprConfig        g_cfg;
IprSymbolSpec    g_spec;
CIprMarketData   g_md;
IprSetupMachine  g_machine;
IprRiskManager   g_risk;
CIprBroker       g_broker;
CIprLogger       g_log;
CIprStateStore   g_state;
IprTradeState    g_trade;

string           g_symbol;
double           g_volume        = 0.0;
double           g_mOverride     = 0.0;     // M validated against OrderCalcProfit
bool             g_enabled       = false;   // false = configuration refused this symbol
string           g_corrTokens[];            // tokens correlated with our own symbol
bool             g_feasible      = false;   // TargetNet reachable at current volatility
double           g_measuredCommRT= 0.0;     // per-lot round turn, learned from deal history
long             g_lastSyncedBar = 0;

//+------------------------------------------------------------------+
//| Clock helpers. All derived from broker server time; nothing here |
//| assumes the server runs on UTC.                                  |
//+------------------------------------------------------------------+
int MinutesOfDay(const datetime t)
  {
   MqlDateTime dt;
   TimeToStruct(t, dt);
   return dt.hour * 60 + dt.min;
  }

//--- Circular distance in minutes to the daily rollover instant.
int MinutesToRollover(const datetime now)
  {
   const int cur = MinutesOfDay(now);
   const int roll = g_cfg.rolloverHour * 60;
   int d = cur - roll;
   if(d < 0)
      d += 1440;
   //--- distance is symmetric around the instant
   return MathMin(d, 1440 - d);
  }

bool InRolloverWindow(const datetime now)
  {
   return (MinutesToRollover(now) <= g_cfg.rolloverGuardMinutes);
  }

//--- No NEW entries if the maximum hold would run into the rollover
//--- guard: entering there would only trigger an immediate force-flat.
bool TooCloseToRollover(const datetime now)
  {
   const int holdMinutes = IPR_MAXHOLD_BARS * 5;
   return (MinutesToRollover(now) <= g_cfg.rolloverGuardMinutes + holdMinutes);
  }

//--- Friday, within 30 minutes of the last trading session's end.
//--- Read from SYMBOL_SESSION_TRADE so it adapts to the instrument
//--- rather than assuming an FX week.
bool InWeekendCloseWindow(const datetime now)
  {
   MqlDateTime dt;
   TimeToStruct(now, dt);
   if(dt.day_of_week != FRIDAY)
      return false;

   datetime from = 0, to = 0, lastTo = 0;
   for(int i = 0; i < 8; i++)
     {
      if(!SymbolInfoSessionTrade(g_symbol, FRIDAY, i, from, to))
         break;
      lastTo = to;
     }
   if(lastTo <= 0)
      return false;

   const int endMin = (int)(lastTo / 60);
   return (MinutesOfDay(now) >= endMin - 30);
  }

//+------------------------------------------------------------------+
//| Live spread in price units.                                      |
//+------------------------------------------------------------------+
double LiveSpreadPrice()
  {
   const double ask = SymbolInfoDouble(g_symbol, SYMBOL_ASK);
   const double bid = SymbolInfoDouble(g_symbol, SYMBOL_BID);
   if(ask <= 0.0 || bid <= 0.0)
      return 0.0;
   return ask - bid;
  }

//--- Cost model at the current instant. Swap is charged as zero because
//--- TooCloseToRollover() prevents any position from reaching rollover.
bool BuildLiveCosts(IprCosts &costs)
  {
   IprConfig cfg = g_cfg;
   if(cfg.commissionPerLotRT <= 0.0 && g_measuredCommRT > 0.0)
      cfg.commissionPerLotRT = g_measuredCommRT;   // learned from deal history
   return IprBuildCosts(g_spec, cfg, g_volume, LiveSpreadPrice(), g_mOverride, 0.0, costs);
  }

//+------------------------------------------------------------------+
//| Correlation control (Phase 2 section 25).                        |
//|                                                                  |
//| Groups are configured as "XAU,XAG;BTC,ETH". At startup we find   |
//| the group our own symbol belongs to and remember its tokens; a   |
//| new entry is then refused while any OTHER position of ours sits  |
//| on a symbol from that same group. Substring matching keeps it    |
//| broker-agnostic ("XAUUSD.raw" and "XAUUSD_i" both match "XAU").  |
//+------------------------------------------------------------------+
void BuildCorrelationTokens()
  {
   ArrayResize(g_corrTokens, 0);
   if(!g_cfg.correlationFilterEnabled || InpCorrelationGroups == "")
      return;

   string groups[];
   const int ng = StringSplit(InpCorrelationGroups, ';', groups);
   for(int i = 0; i < ng; i++)
     {
      string toks[];
      const int nt = StringSplit(groups[i], ',', toks);

      //--- Does our symbol belong to this group?
      bool mine = false;
      for(int k = 0; k < nt; k++)
        {
         if(StringLen(toks[k]) > 0 && StringFind(g_symbol, toks[k]) >= 0)
           { mine = true; break; }
        }
      if(!mine)
         continue;

      for(int k = 0; k < nt; k++)
        {
         if(StringLen(toks[k]) == 0)
            continue;
         const int n = ArraySize(g_corrTokens);
         ArrayResize(g_corrTokens, n + 1);
         g_corrTokens[n] = toks[k];
        }
      break;                       // a symbol belongs to at most one group
     }
  }

//--- True when another of our positions is on a correlated instrument.
bool HasCorrelatedPosition()
  {
   const int nTok = ArraySize(g_corrTokens);
   if(nTok == 0)
      return false;

   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      if(PositionGetTicket(i) == 0)
         continue;
      if(PositionGetInteger(POSITION_MAGIC) != g_cfg.magic)
         continue;
      const string sym = PositionGetString(POSITION_SYMBOL);
      if(sym == g_symbol)
         continue;                 // our own symbol is handled separately
      for(int k = 0; k < nTok; k++)
        {
         if(StringFind(sym, g_corrTokens[k]) >= 0)
            return true;
        }
     }
   return false;
  }

//+------------------------------------------------------------------+
//| Position / order discovery, always by magic AND symbol so the EA |
//| can never act on something it does not own.                      |
//+------------------------------------------------------------------+
bool FindOurPosition(ulong &ticket)
  {
   ticket = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      const ulong t = PositionGetTicket(i);
      if(t == 0)
         continue;
      if(PositionGetString(POSITION_SYMBOL) != g_symbol)
         continue;
      if(PositionGetInteger(POSITION_MAGIC) != g_cfg.magic)
         continue;
      ticket = t;
      return true;
     }
   return false;
  }

int CountOurPositionsAccountWide()
  {
   int n = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      if(PositionGetTicket(i) == 0)
         continue;
      if(PositionGetInteger(POSITION_MAGIC) == g_cfg.magic)
         n++;
     }
   return n;
  }

bool FindOurPendingOrder(ulong &ticket)
  {
   ticket = 0;
   for(int i = OrdersTotal() - 1; i >= 0; i--)
     {
      const ulong t = OrderGetTicket(i);
      if(t == 0)
         continue;
      if(OrderGetString(ORDER_SYMBOL) != g_symbol)
         continue;
      if(OrderGetInteger(ORDER_MAGIC) != g_cfg.magic)
         continue;
      ticket = t;
      return true;
     }
   return false;
  }

//+------------------------------------------------------------------+
//| Net result of a closed position, summed across its deals.        |
//| Commission and swap are included: gross profit is not what the   |
//| risk model is allowed to see.                                    |
//+------------------------------------------------------------------+
bool ClosedPositionResult(const ulong positionTicket, double &net, double &commission,
                          double &volume)
  {
   net = 0.0;
   commission = 0.0;
   volume = 0.0;

   const datetime from = (datetime)(TimeCurrent() - 7 * 24 * 3600);
   if(!HistorySelect(from, TimeCurrent() + 60))
      return false;

   bool found = false;
   for(int i = HistoryDealsTotal() - 1; i >= 0; i--)
     {
      const ulong d = HistoryDealGetTicket(i);
      if(d == 0)
         continue;
      if((ulong)HistoryDealGetInteger(d, DEAL_POSITION_ID) != positionTicket)
         continue;

      net += HistoryDealGetDouble(d, DEAL_PROFIT)
             + HistoryDealGetDouble(d, DEAL_COMMISSION)
             + HistoryDealGetDouble(d, DEAL_SWAP);
      commission += MathAbs(HistoryDealGetDouble(d, DEAL_COMMISSION));
      volume = MathMax(volume, HistoryDealGetDouble(d, DEAL_VOLUME));
      found = true;
     }
   return found;
  }

//--- Learn the real per-lot round-turn commission from closed deals.
//--- Phase 2 section 4 forbids assuming commission is zero; if the user
//--- left the input at 0 we measure it and use the measurement.
void UpdateMeasuredCommission(const double commission, const double volume)
  {
   if(commission <= 0.0 || volume <= 0.0)
      return;
   const double perLot = commission / volume;
   //--- Exponential blend so one odd fill cannot swing the cost model.
   g_measuredCommRT = (g_measuredCommRT <= 0.0) ? perLot
                      : (0.7 * g_measuredCommRT + 0.3 * perLot);
  }

//+------------------------------------------------------------------+
//| INITIALISATION                                                   |
//+------------------------------------------------------------------+
int OnInit()
  {
   g_symbol = (InpSymbol == "") ? _Symbol : InpSymbol;

   g_cfg.Reset();
   g_cfg.nImp = InpNImp;
   g_cfg.lMinMult = InpLMinMult;
   g_cfg.tpMult = InpTpMult;
   g_cfg.costBudget = InpCostBudget;
   g_cfg.volume = InpVolume;
   g_cfg.targetNet = InpTargetNet;
   g_cfg.commissionPerLotRT = InpCommissionPerLot;
   g_cfg.slipEstSpreadMult = InpSlipEstSpreadMult;
   g_cfg.magic = InpMagic;
   g_cfg.sessionFilterEnabled = InpSessionFilter;
   g_cfg.correlationFilterEnabled = (InpCorrelationGroups != "");
   g_cfg.breakEvenEnabled = InpBreakEven;
   g_cfg.maxPositionsAccount = InpMaxPositionsAcct;
   g_cfg.maxTradesPerDay = InpMaxTradesPerDay;
   g_cfg.maxDailyLossEquityFrac = InpMaxDailyLossPct / 100.0;
   g_cfg.rolloverHour = InpRolloverHour;
   g_cfg.rolloverGuardMinutes = InpRolloverGuardMin;
   g_cfg.logLevel = (IprLogLevel)InpLogLevel;

   g_log.Init(g_cfg.logLevel, "[IPR " + g_symbol + "]");
   g_log.Info("=== IPR Scalper starting ===");

   string err = "";
   if(!g_cfg.Validate(err))
     {
      g_log.Error("Configuration rejected: " + err);
      return INIT_PARAMETERS_INCORRECT;
     }

   if(!IprLoadSymbolSpec(g_symbol, g_spec, err))
     {
      g_log.Error("Symbol specification unavailable: " + err);
      return INIT_FAILED;
     }

   //--- Volume validation. Phase 2 section 3: never silently substitute
   //--- a different size; log and disable instead.
   if(!IprValidateVolume(g_spec, g_cfg.volume, g_volume, err))
     {
      g_log.Error("REJECT: INVALID_VOLUME | " + err);
      g_log.Error("Trading DISABLED for " + g_symbol
                  + ". Set a volume valid for this symbol and reload the EA.");
      g_enabled = false;
      return INIT_SUCCEEDED;         // stay loaded so the reason stays visible
     }

   g_md.Init(g_symbol, g_spec.point);
   if(!g_md.Warmup(g_log))
     {
      g_log.Error("Trading DISABLED: insufficient M5 history.");
      g_enabled = false;
      return INIT_SUCCEEDED;
     }

   if(!IprValidateMoneyPerPriceUnit(g_symbol, g_spec, g_volume, g_log, g_mOverride))
     {
      g_log.Error("Trading DISABLED: cannot establish money-per-price-unit.");
      g_enabled = false;
      return INIT_SUCCEEDED;
     }

   if(g_cfg.commissionPerLotRT <= 0.0)
      g_log.Warn("CommissionPerLot is 0. The cost model will UNDERSTATE costs until "
                 "commission is measured from closed deals. Set it explicitly if your "
                 "account charges commission.");

   BuildCorrelationTokens();
   if(ArraySize(g_corrTokens) > 0)
      g_log.Info(StringFormat("Correlation group active: %d token(s) block concurrent entries.",
                              ArraySize(g_corrTokens)));

   g_machine.Init(IprHashString(g_symbol));
   g_risk.Init();
   g_broker.Init(g_symbol, g_cfg.magic, GetPointer(g_log));
   g_state.Init(g_symbol, g_cfg.magic, GetPointer(g_log));
   g_trade.Reset();

   //--- Feasibility report before anything else is allowed to happen.
   IprCosts costs;
   if(!BuildLiveCosts(costs))
     {
      g_log.Error("Trading DISABLED: cost model could not be built.");
      g_enabled = false;
      return INIT_SUCCEEDED;
     }
   g_feasible = IprLogFeasibility(g_symbol, g_spec, g_cfg, costs, g_md.Atr(), g_log);

   //--- Restore EA-only state, then reconcile against broker truth.
   if(g_state.Load(g_machine, g_risk, g_trade))
      g_log.Info("State restored from " + g_state.FileName());
   RecoverFromBroker();

   g_enabled = true;
   g_log.Info(StringFormat("Ready. volume=%.4f nImp=%d lMin=%.2f tpMult=%.2f budget=%.2f "
                           "profileHours=%d", g_volume, g_cfg.nImp, g_cfg.lMinMult,
                           g_cfg.tpMult, g_cfg.costBudget, g_md.ReadyHourCount()));
   return INIT_SUCCEEDED;
  }

//+------------------------------------------------------------------+
//| Restart recovery (Phase 2 section 32).                           |
//|                                                                  |
//| MT5 is the authority on what is open. Three cases:               |
//|   - a position exists that we have no record of -> adopt it,     |
//|     rebuilding the plan from its own SL/TP.                      |
//|   - we have a record but no position -> it closed while we were  |
//|     away; book the result.                                       |
//|   - a stale pending order exists -> delete it. Its setup is      |
//|     already consumed, and re-validating it against a setup we no |
//|     longer hold would risk an unvetted entry.                    |
//+------------------------------------------------------------------+
void RecoverFromBroker()
  {
   ulong posTicket = 0;
   const bool hasPos = FindOurPosition(posTicket);

   if(hasPos && !g_trade.active)
     {
      PositionSelectByTicket(posTicket);
      g_trade.Reset();
      g_trade.active = true;
      g_trade.positionTicket = posTicket;
      g_trade.dir = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY)
                    ? IPR_DIR_LONG : IPR_DIR_SHORT;
      g_trade.entryPrice = PositionGetDouble(POSITION_PRICE_OPEN);
      g_trade.stopPrice = PositionGetDouble(POSITION_SL);
      g_trade.targetPrice = PositionGetDouble(POSITION_TP);
      g_trade.entryTime = (long)PositionGetInteger(POSITION_TIME);

      //--- Rebuild the planned distances from the live SL/TP so the
      //--- no-progress and spread-blowout rules keep working.
      if(g_trade.stopPrice > 0.0)
         g_trade.dSl = MathAbs(g_trade.entryPrice - g_trade.stopPrice);
      if(g_trade.targetPrice > 0.0)
         g_trade.dTp = MathAbs(g_trade.targetPrice - g_trade.entryPrice);

      //--- Bars held is derived from the clock, never from a counter we
      //--- may have lost, so the max-hold limit survives a restart.
      const long elapsed = (long)TimeCurrent() - g_trade.entryTime;
      g_trade.barsHeld = (int)(elapsed / 300);
      g_trade.mfePrice = (g_trade.dir == IPR_DIR_LONG)
                         ? SymbolInfoDouble(g_symbol, SYMBOL_BID)
                         : SymbolInfoDouble(g_symbol, SYMBOL_ASK);

      g_log.Warn(StringFormat("Adopted existing position #%I64u %s entry=%.*f "
                              "barsHeld=%d (rebuilt after restart)",
                              posTicket, IprDirName(g_trade.dir), g_spec.digits,
                              g_trade.entryPrice, g_trade.barsHeld));
     }
   else
      if(!hasPos && g_trade.active)
        {
         g_log.Warn(StringFormat("Position #%I64u closed while the EA was down; booking result.",
                                 g_trade.positionTicket));
         BookClosedTrade(g_trade.positionTicket);
        }

   //--- Any pending order left behind belongs to a setup we can no
   //--- longer validate. Remove it rather than let it fire unvetted.
   ulong ordTicket = 0;
   if(FindOurPendingOrder(ordTicket))
     {
      g_log.Warn(StringFormat("Deleting stale pending order #%I64u left from a previous session.",
                              ordTicket));
      g_broker.DeleteOrder(ordTicket);
      if(g_machine.HasArmed())
         g_machine.Consume(IPR_STATE_INVALIDATED);
     }

   g_state.Save(g_machine, g_risk, g_trade);
  }

//+------------------------------------------------------------------+
//| Book a finished trade into the risk model.                       |
//+------------------------------------------------------------------+
void BookClosedTrade(const ulong positionTicket)
  {
   double net = 0.0, commission = 0.0, volume = 0.0;
   if(ClosedPositionResult(positionTicket, net, commission, volume))
     {
      UpdateMeasuredCommission(commission, volume);
      g_risk.RecordResult(net, g_machine.m_barSeq);
      g_log.Info(StringFormat("CLOSED #%I64u net=%.2f | consecLosses=%d tradesToday=%d "
                              "realisedToday=%.2f cooldownUntilBar=%I64d",
                              positionTicket, net, g_risk.m_consecLosses,
                              g_risk.m_tradesToday, g_risk.m_realisedToday,
                              g_risk.m_cooldownUntilBarSeq));
     }
   else
      g_log.Warn(StringFormat("Could not read deal history for #%I64u; "
                              "result NOT booked into the risk model.", positionTicket));

   g_trade.Reset();
   g_state.Save(g_machine, g_risk, g_trade);
  }

//+------------------------------------------------------------------+
//| MAIN LOOP                                                        |
//+------------------------------------------------------------------+
void OnTick()
  {
   if(!g_enabled)
      return;

   const bool newBar = g_md.Poll();

   SyncPositionState();

   if(newBar)
      OnNewClosedBar();

   if(g_trade.active)
     {
      ManageOpenPosition();
      return;                 // one position per symbol; nothing else to do
     }

   if(g_machine.HasArmed())
      ValidateArmedOnTick();
  }

//+------------------------------------------------------------------+
//| Detect fills and closes by polling, not by trade events.         |
//| Polling is restart-safe by construction: it compares the world   |
//| against our record every tick, so a missed event cannot leave    |
//| the two permanently out of step.                                 |
//+------------------------------------------------------------------+
void SyncPositionState()
  {
   ulong posTicket = 0;
   const bool hasPos = FindOurPosition(posTicket);

   if(hasPos && !g_trade.active)
     {
      OnPositionOpened(posTicket);
      return;
     }
   if(!hasPos && g_trade.active)
      BookClosedTrade(g_trade.positionTicket);
  }

void OnPositionOpened(const ulong posTicket)
  {
   PositionSelectByTicket(posTicket);

   g_trade.Reset();
   g_trade.active = true;
   g_trade.positionTicket = posTicket;
   g_trade.dir = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY)
                 ? IPR_DIR_LONG : IPR_DIR_SHORT;
   g_trade.entryPrice = PositionGetDouble(POSITION_PRICE_OPEN);
   g_trade.stopPrice = PositionGetDouble(POSITION_SL);
   g_trade.targetPrice = PositionGetDouble(POSITION_TP);
   g_trade.entryTime = (long)PositionGetInteger(POSITION_TIME);
   g_trade.mfePrice = g_trade.entryPrice;

   //--- Prefer the planned distances from the setup that produced this
   //--- fill; fall back to the live SL/TP if the setup is gone.
   if(g_machine.HasArmed() && g_machine.m_active.dir == g_trade.dir)
     {
      g_trade.dTp = g_machine.m_active.dTp;
      g_trade.dSl = g_machine.m_active.dSl;
      g_trade.setupId = g_machine.m_active.setupId;

      //--- Execution quality: how far the fill slipped from the trigger.
      const double slip = MathAbs(g_trade.entryPrice - g_machine.m_active.triggerPrice);
      IprCosts costs;
      if(BuildLiveCosts(costs))
         g_risk.RecordSlippage(slip, costs.slipPrice);

      //--- The setup has now produced its one trade. Consume it, and
      //--- record the entry for the cluster locks.
      g_machine.m_cluster.RecordEntry(g_trade.dir, g_machine.m_active.legExtreme,
                                      g_trade.entryPrice, g_machine.m_barSeq);
      g_machine.Consume(IPR_STATE_TRIGGERED);

      g_log.Info(StringFormat("FILLED setup=%I64u %s entry=%.*f slip=%.*f dTp=%.*f dSl=%.*f",
                              g_trade.setupId, IprDirName(g_trade.dir), g_spec.digits,
                              g_trade.entryPrice, g_spec.digits, slip, g_spec.digits,
                              g_trade.dTp, g_spec.digits, g_trade.dSl));
     }
   else
     {
      if(g_trade.stopPrice > 0.0)
         g_trade.dSl = MathAbs(g_trade.entryPrice - g_trade.stopPrice);
      if(g_trade.targetPrice > 0.0)
         g_trade.dTp = MathAbs(g_trade.targetPrice - g_trade.entryPrice);
      g_log.Warn(StringFormat("Position #%I64u opened without a matching armed setup; "
                              "plan rebuilt from SL/TP.", posTicket));
     }

   g_state.Save(g_machine, g_risk, g_trade);
  }

//+------------------------------------------------------------------+
//| Once per newly closed M5 bar.                                    |
//+------------------------------------------------------------------+
void OnNewClosedBar()
  {
   g_machine.OnNewBar();
   g_risk.OnNewDay((long)TimeCurrent() / 86400);

   if(g_trade.active)
     {
      IprUpdateOnBar(g_trade, g_md.LastClose(), g_md.EmaFast());
      g_state.Save(g_machine, g_risk, g_trade);
      return;
     }

   //--- Expire an armed setup whose 5-bar window has run out.
   if(g_machine.HasArmed() && g_machine.IsExpired())
     {
      g_log.Debug(StringFormat("Setup %I64u EXPIRED after %d bars",
                               g_machine.m_active.setupId, g_machine.m_active.barsSinceArm));
      CancelArmedSetup(IPR_STATE_EXPIRED, IPR_REJ_SETUP_EXPIRED);
      return;
     }

   if(g_machine.HasArmed())
     {
      //--- An armed setup owns the symbol until it resolves. Structure
      //--- can only change on a bar close, so the expensive checks
      //--- belong here rather than on every tick.
      ValidateArmedOnBar();
      return;
     }

   EvaluateNewSetup();
  }

//+------------------------------------------------------------------+
//| Delete the pending order and retire the setup permanently.       |
//+------------------------------------------------------------------+
void CancelArmedSetup(const IprSetupState finalState, const IprReject why)
  {
   if(g_machine.m_active.orderTicket != 0)
      g_broker.DeleteOrder(g_machine.m_active.orderTicket);
   else
     {
      ulong t = 0;
      if(FindOurPendingOrder(t))
         g_broker.DeleteOrder(t);
     }

   g_log.Debug(StringFormat("Setup %I64u retired: %s",
                            g_machine.m_active.setupId, IprRejectName(why)));
   g_machine.Consume(finalState);
   g_state.Save(g_machine, g_risk, g_trade);
  }

//+------------------------------------------------------------------+
//| Armed-setup validation, split by cost.                           |
//|                                                                  |
//| Phase 1 5.7 requires the gates to hold AT TRIGGER TIME, but a    |
//| pending stop order fills without asking us. Continuously         |
//| re-checking and pulling the order is the closest deterministic    |
//| equivalent, so the cheap, fast-moving conditions (spread, clock) |
//| are tested on every tick...                                      |
//+------------------------------------------------------------------+
void ValidateArmedOnTick()
  {
   const double spread = LiveSpreadPrice();
   if(spread <= 0.0)
      return;

   const double atr = g_md.Atr();
   if(atr <= 0.0)
      return;

   //--- G3, live: spread against ATR, and against its own hourly median.
   if((spread / atr) > IPR_SPREAD_ATR_MAX)
     {
      CancelArmedSetup(IPR_STATE_INVALIDATED, IPR_REJ_SPREAD_TOO_HIGH);
      return;
     }

   double sMed = 0.0;
   IprMarketCtx ctx;
   g_md.BuildCtx(spread, ctx);
   if(g_md.MedianSpread(ctx.hour, sMed) && sMed > 0.0
      && (spread / sMed) > IPR_SPREAD_MED_MULT)
     {
      CancelArmedSetup(IPR_STATE_INVALIDATED, IPR_REJ_SPREAD_ABNORMAL);
      return;
     }

   //--- A fill this close to rollover would only be force-flatted.
   if(TooCloseToRollover(TimeCurrent()) || InWeekendCloseWindow(TimeCurrent()))
      CancelArmedSetup(IPR_STATE_INVALIDATED, IPR_REJ_ROLLOVER_WINDOW);
  }

//+------------------------------------------------------------------+
//| ...while the structural checks, which can only change when a bar |
//| closes, run once per bar.                                        |
//+------------------------------------------------------------------+
void ValidateArmedOnBar()
  {
   const double spread = LiveSpreadPrice();
   if(spread <= 0.0)
      return;

   IprMarketCtx ctx;
   g_md.BuildCtx(spread, ctx);

   IprDiagnostics diag;
   const IprReject gate = IprCheckMarketGates(g_md.m_bars, g_cfg, ctx, g_md.m_profile, diag);
   if(gate != IPR_OK)
     {
      CancelArmedSetup(IPR_STATE_INVALIDATED, gate);
      return;
     }

   //--- Structural invalidation: price beyond the pullback extreme, an
   //--- opposing break of structure, or the regime flipping.
   const bool opposingBos = (g_machine.m_active.dir == IPR_DIR_LONG)
                            ? IprBearishBos(g_md.m_bars, IPR_FRACTAL_WIDTH, g_cfg.nImp + 4)
                            : IprBullishBos(g_md.m_bars, IPR_FRACTAL_WIDTH, g_cfg.nImp + 4);

   IprReject why = IPR_OK;
   if(g_machine.CheckInvalidation(g_md.m_bars, diag.regimeDir, opposingBos, why))
     {
      CancelArmedSetup(IPR_STATE_INVALIDATED, why);
      return;
     }

   //--- Re-price the cost gate: the setup was vetted at arm time, and
   //--- costs may have drifted since.
   IprCosts costs;
   if(BuildLiveCosts(costs))
     {
      const double span = g_machine.m_active.dTp + g_machine.m_active.dSl;
      if(span > 0.0 && (costs.totalPrice / span) > g_cfg.costBudget)
         CancelArmedSetup(IPR_STATE_INVALIDATED, IPR_REJ_TARGET_COST_INFEASIBLE);
     }
  }

//+------------------------------------------------------------------+
//| Look for a new setup on the just-closed bar.                     |
//+------------------------------------------------------------------+
void EvaluateNewSetup()
  {
   if(!g_feasible)
      return;                    // startup feasibility already said no

   const double spread = LiveSpreadPrice();
   if(spread <= 0.0)
      return;

   string why = "";
   if(!g_broker.CanTrade(why))
     {
      g_log.Debug("Trading not currently permitted: " + why);
      return;
     }

   if(TooCloseToRollover(TimeCurrent()) || InWeekendCloseWindow(TimeCurrent()))
     {
      g_log.Reject(IPR_REJ_ROLLOVER_WINDOW, "");
      return;
     }

   //--- G5: portfolio state, owned by the risk model.
   const IprReject risk = g_risk.CanTrade(g_cfg, AccountInfoDouble(ACCOUNT_EQUITY),
                                          g_machine.m_barSeq,
                                          g_trade.active ? 1 : 0,
                                          CountOurPositionsAccountWide());
   if(risk != IPR_OK)
     {
      g_log.Reject(risk, "");
      return;
     }

   if(HasCorrelatedPosition())
     {
      g_log.Reject(IPR_REJ_CORRELATION, "a correlated instrument already holds a position");
      return;
     }

   IprMarketCtx ctx;
   g_md.BuildCtx(spread, ctx);

   IprDiagnostics diag;
   const IprReject gate = IprCheckMarketGates(g_md.m_bars, g_cfg, ctx, g_md.m_profile, diag);
   if(gate != IPR_OK)
     {
      g_log.Reject(gate, StringFormat("volRatio=%.2f spreadAtr=%.3f", diag.volRatio, diag.spreadAtr));
      return;
     }

   IprCosts costs;
   if(!BuildLiveCosts(costs))
      return;

   IprSetup setup;
   IprTargetPlan plan;
   const IprReject res = IprEvaluateSetup(g_md.m_bars, g_cfg, g_spec, costs, ctx,
                                          g_machine, diag.regimeDir, setup, plan, diag);
   if(res != IPR_OK)
     {
      g_log.Reject(res, StringFormat("dir=%s leg=%.*f er=%.2f depth=%.2f",
                                     IprDirName(diag.regimeDir), g_spec.digits,
                                     diag.legSize, diag.er, diag.depth));
      return;
     }

   //--- Per-trade money risk cannot be reduced below minimum volume, so
   //--- an over-cap risk means SKIP, never resize (Phase 1 section 10).
   double riskMoney = 0.0;
   if(!g_risk.RiskWithinCap(plan.dSl, costs.moneyPerPriceUnit,
                            AccountInfoDouble(ACCOUNT_EQUITY), g_cfg, riskMoney))
     {
      g_log.Reject(IPR_REJ_RISK_LIMIT,
                   StringFormat("risk=%.2f exceeds cap at minimum volume", riskMoney));
      return;
     }

   if(!g_broker.HasMargin(setup.dir, g_volume, setup.triggerPrice))
     {
      g_log.Reject(IPR_REJ_RISK_LIMIT, "insufficient free margin");
      return;
     }

   ArmSetup(setup, plan, costs, ctx);
  }

//+------------------------------------------------------------------+
//| Place the entry stop and arm the setup.                          |
//+------------------------------------------------------------------+
void ArmSetup(IprSetup &setup, const IprTargetPlan &plan, const IprCosts &costs,
              const IprMarketCtx &ctx)
  {
   ulong ticket = 0;
   uint retcode = 0;

   if(!g_broker.PlaceEntryStop(setup.dir, g_volume, setup.triggerPrice,
                               setup.stopPrice, setup.targetPrice, ctx.atr,
                               ticket, retcode))
     {
      g_risk.RecordOrderFailure();
      //--- A setup whose order was rejected is retired, not retried on
      //--- the next tick: retrying would be an unvetted second entry
      //--- attempt from the same structure.
      g_machine.Arm(setup);
      g_machine.Consume(IPR_STATE_INVALIDATED);
      g_state.Save(g_machine, g_risk, g_trade);
      return;
     }

   setup.orderTicket = ticket;
   g_machine.Arm(setup);
   g_state.Save(g_machine, g_risk, g_trade);

   g_log.Info(StringFormat(
                 "ACCEPT setup=%I64u dir=%s | legSize=%.*f atr=%.*f er=%.2f bos=%.*f "
                 "depth=%.2f turnTime=%s | trigger=%.*f sl=%.*f tp=%.*f | "
                 "cost=%.4f reqMove=%.*f tpAtr=%.2f riskDist=%.*f payoff=%.2f budget=%.3f",
                 setup.setupId, IprDirName(setup.dir),
                 g_spec.digits, setup.legSize, g_spec.digits, ctx.atr, setup.er,
                 g_spec.digits, setup.bosLevel, setup.depth,
                 TimeToString((datetime)setup.turnTime, TIME_DATE | TIME_MINUTES),
                 g_spec.digits, setup.triggerPrice, g_spec.digits, setup.stopPrice,
                 g_spec.digits, setup.targetPrice,
                 costs.totalMoney, g_spec.digits, costs.reqMovePrice,
                 (ctx.atr > 0.0 ? plan.dTp / ctx.atr : 0.0),
                 g_spec.digits, plan.dSl, plan.payoff, plan.costBudgetUsed));
  }

//+------------------------------------------------------------------+
//| Open-position management: exits in strict priority order.        |
//+------------------------------------------------------------------+
void ManageOpenPosition()
  {
   IprExitCtx ectx;
   ectx.Reset();
   ectx.bid = SymbolInfoDouble(g_symbol, SYMBOL_BID);
   ectx.ask = SymbolInfoDouble(g_symbol, SYMBOL_ASK);
   ectx.spreadPrice = ectx.ask - ectx.bid;

   double sMed = 0.0;
   IprMarketCtx mctx;
   g_md.BuildCtx(ectx.spreadPrice, mctx);
   ectx.spreadMedianValid = g_md.MedianSpread(mctx.hour, sMed);
   ectx.spreadMedian = sMed;
   ectx.inRolloverWindow = InRolloverWindow(TimeCurrent());
   ectx.inWeekendCloseWindow = InWeekendCloseWindow(TimeCurrent());

   IprUpdateMfe(g_trade, ectx);

   const IprExitReason reason = IprEvaluateExit(g_trade, ectx);
   if(reason != IPR_EXIT_NONE)
     {
      g_log.Info(StringFormat("EXIT %s #%I64u barsHeld=%d mfe=%.*f dTp=%.*f",
                              IprExitName(reason), g_trade.positionTicket,
                              g_trade.barsHeld, g_spec.digits, IprMfePrice(g_trade),
                              g_spec.digits, g_trade.dTp));
      if(!g_broker.ClosePosition(g_trade.positionTicket, mctx.atr, IprExitName(reason)))
         g_risk.RecordOrderFailure();
      return;
     }

   //--- Optional break-even step. Never removes the protective stop;
   //--- only ever moves it forward.
   if(g_cfg.breakEvenEnabled)
     {
      IprCosts costs;
      double newStop = 0.0;
      if(BuildLiveCosts(costs)
         && IprBreakEvenStop(g_trade, g_cfg, costs, g_spec, newStop))
        {
         if(g_broker.ModifyStop(g_trade.positionTicket, newStop, g_trade.targetPrice))
           {
            g_trade.stopPrice = newStop;
            g_log.Info(StringFormat("Break-even stop moved to %.*f", g_spec.digits, newStop));
           }
        }
     }
  }

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
  {
   g_state.Save(g_machine, g_risk, g_trade);
   g_log.Info(StringFormat("=== IPR Scalper stopped (reason %d) ===", reason));
  }
//+------------------------------------------------------------------+
