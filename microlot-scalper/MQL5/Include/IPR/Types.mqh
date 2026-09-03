//+------------------------------------------------------------------+
//| Types.mqh - core data types for the IPR scalping strategy.       |
//|                                                                  |
//| This file (and every other "pure" header in this folder) is      |
//| written in the intersection of MQL5 and C++ so that the decision |
//| logic can be compiled and unit-tested with g++ under the shim in |
//| tests/mql5_compat.h. That is the only way to get real            |
//| compile-and-run verification of the strategy rules on a machine  |
//| without MetaEditor. Keep this file free of:                      |
//|   - input / #property / #include <...>                           |
//|   - dynamic arrays, templates, STL                               |
//|   - default member initialisers (use Reset())                    |
//| Structs are always passed by reference; results come back via    |
//| out-parameters rather than by-value struct returns.              |
//+------------------------------------------------------------------+
#ifndef IPR_TYPES_MQH
#define IPR_TYPES_MQH

//--- Size of the rolling window of closed M5 bars kept for structure
//--- lookups. 600 bars = ~50 hours, far more than any rule reaches back
//--- (deepest is N_imp+3 = 11 bars plus fractal confirmation).
#define IPR_MAX_BARS        600
//--- Rolling per-hour reference profile: 24 hour buckets x 20 sessions.
#define IPR_PROFILE_HOURS   24
#define IPR_PROFILE_DAYS    20
//--- Ring of consumed SetupIDs. A setup that leaves ARMED can never be
//--- re-armed; this ring is what enforces that across restarts.
#define IPR_CONSUMED_RING   64

//--- Fixed strategy constants. Phase 1 section J lists these as FIXED
//--- LOGIC: they are deliberately NOT inputs, because exposing them
//--- would let the optimiser absorb noise through them.
#define IPR_ATR_PERIOD          14
#define IPR_EMA_FAST            20
#define IPR_EMA_SLOW            50
#define IPR_FRACTAL_WIDTH       2
#define IPR_ER_MIN              0.50
#define IPR_PULLBACK_MIN        0.20
#define IPR_PULLBACK_MAX        0.618
#define IPR_PULLBACK_VEL_FACTOR 0.80
#define IPR_SETUP_VALID_BARS    5
#define IPR_SHOCK_ATR_MULT      3.0
#define IPR_SHOCK_STANDDOWN     6
#define IPR_EMA_SLOPE_ATR       0.10
#define IPR_EMA_SLOPE_BARS      5
#define IPR_VOL_RATIO_MIN       0.60
#define IPR_VOL_RATIO_MAX       2.50
#define IPR_SPREAD_ATR_MAX      0.15
#define IPR_SPREAD_MED_MULT     2.5
#define IPR_TRIG_BUFFER_ATR     0.10
#define IPR_INVALID_BUFFER_ATR  0.05
#define IPR_SL_BUFFER_ATR       0.15
#define IPR_SL_BUFFER_SPREAD    1.5
#define IPR_SL_MIN_ATR          0.40
#define IPR_SL_MIN_SPREAD       3.0
#define IPR_SL_MAX_ATR          1.20
#define IPR_STRUCT_CAP          0.90
//--- Startup AND per-setup feasibility ceiling: the move required for
//--- TargetNet may not exceed this many ATRs. Phase 2 section 5 - the EA
//--- must prefer NO TRADE over an economically impossible scalp.
#define IPR_FEASIBILITY_MAX_ATR 1.5
#define IPR_MAXHOLD_BARS        12
#define IPR_NOPROGRESS_BARS     4
#define IPR_NOPROGRESS_FRAC     0.35
#define IPR_MOMFAIL_CLOSES      2
#define IPR_SPREAD_PANIC_MULT   4.0
#define IPR_SPREAD_PANIC_PROFIT 0.5
#define IPR_CLUSTER_STRUCT_ATR  0.5
#define IPR_CLUSTER_BARS        12
#define IPR_CLUSTER_DIST_ATR    1.0
#define IPR_COOLDOWN_LOSS       20
#define IPR_COOLDOWN_LOSS2      40
#define IPR_COOLDOWN_WIN        6
#define IPR_MAX_CONSEC_LOSSES   3
#define IPR_MAX_TRADES_DAY      4
#define IPR_DAILY_LOSS_AVGMULT  3.0
#define IPR_DAILY_LOSS_EQFRAC   0.02
#define IPR_MAX_ORDER_FAILURES  3
#define IPR_MAX_SLIP_EVENTS     5
#define IPR_SLIP_EVENT_MULT     2.0

//--- Trade direction. IPR_DIR_NONE means "no setup".
enum IprDirection
  {
   IPR_DIR_NONE = 0,
   IPR_DIR_LONG = 1,
   IPR_DIR_SHORT = -1
  };

//--- Setup lifecycle. Phase 1 5.9: once a setup leaves ARMED it can
//--- never re-enter it, so these transitions are one-way.
enum IprSetupState
  {
   IPR_STATE_NONE = 0,
   IPR_STATE_FORMING,
   IPR_STATE_ARMED,
   IPR_STATE_TRIGGERED,
   IPR_STATE_INVALIDATED,
   IPR_STATE_EXPIRED
  };

//--- Every rejection path has its own code so that the log can always
//--- answer "why did this bar not produce a trade?".
enum IprReject
  {
   IPR_OK = 0,
   IPR_REJ_NO_DATA,
   IPR_REJ_INVALID_VOLUME,
   IPR_REJ_SESSION,
   IPR_REJ_VOLATILITY_TOO_LOW,
   IPR_REJ_VOLATILITY_TOO_HIGH,
   IPR_REJ_SPREAD_TOO_HIGH,
   IPR_REJ_SPREAD_ABNORMAL,
   IPR_REJ_SHOCK_FILTER,
   IPR_REJ_REGIME_FLAT,
   IPR_REJ_REGIME_FLIP,
   IPR_REJ_NO_IMPULSE,
   IPR_REJ_IMPULSE_TOO_SMALL,
   IPR_REJ_ER_TOO_LOW,
   IPR_REJ_NO_BOS,
   IPR_REJ_NO_PULLBACK,
   IPR_REJ_PULLBACK_TOO_SHALLOW,
   IPR_REJ_PULLBACK_TOO_DEEP,
   IPR_REJ_PULLBACK_TOO_LONG,
   IPR_REJ_PULLBACK_TOO_FAST,
   IPR_REJ_NO_TURN_BAR,
   IPR_REJ_DUPLICATE_SETUP,
   IPR_REJ_NO_STRUCTURE_ROOM,
   IPR_REJ_TARGET_COST_INFEASIBLE,
   IPR_REJ_SL_TOO_TIGHT,
   IPR_REJ_SL_TOO_WIDE,
   IPR_REJ_STOPS_LEVEL,
   IPR_REJ_COOLDOWN,
   IPR_REJ_CLUSTER_STRUCTURE,
   IPR_REJ_CLUSTER_TIME,
   IPR_REJ_CLUSTER_DISTANCE,
   IPR_REJ_MAX_DAILY_TRADES,
   IPR_REJ_RISK_LIMIT,
   IPR_REJ_DAILY_LOSS_LIMIT,
   IPR_REJ_CONSEC_LOSSES,
   IPR_REJ_POSITION_OPEN,
   IPR_REJ_MAX_POSITIONS,
   IPR_REJ_CORRELATION,
   IPR_REJ_EXEC_HALTED,
   IPR_REJ_ROLLOVER_WINDOW,
   IPR_REJ_SETUP_EXPIRED,
   IPR_REJ_FEASIBILITY
  };

//--- Reasons a live position is closed by the EA (as opposed to being
//--- closed by the broker-side SL/TP, which are passive).
enum IprExitReason
  {
   IPR_EXIT_NONE = 0,
   IPR_EXIT_ROLLOVER,
   IPR_EXIT_SPREAD_BLOWOUT,
   IPR_EXIT_MOMENTUM_FAIL,
   IPR_EXIT_NO_PROGRESS,
   IPR_EXIT_MAX_HOLD
  };

enum IprLogLevel
  {
   IPR_LOG_SILENT = 0,
   IPR_LOG_ERROR  = 1,
   IPR_LOG_WARN   = 2,
   IPR_LOG_INFO   = 3,
   IPR_LOG_DEBUG  = 4
  };

//--- One closed M5 bar. spreadPts is MqlRates.spread (points), which is
//--- what makes a look-ahead-free historical spread profile possible in
//--- both live trading and the Strategy Tester.
struct IprBar
  {
   long              time;
   double            open;
   double            high;
   double            low;
   double            close;
   int               spreadPts;
  };

//--- Rolling window of closed bars, stored chronologically:
//--- m_b[0] is the OLDEST, m_b[m_n-1] the newest closed bar.
//--- All strategy rules speak in "bars ago", so use Ago()/HighAgo()/...
//--- and never index m_b directly outside this struct.
struct IprBars
  {
   IprBar            m_b[IPR_MAX_BARS];
   int               m_n;

   void              Reset() { m_n = 0; }
   int               Count() const { return m_n; }
   bool              Has(const int ago) const { return (ago >= 0 && ago < m_n); }

   //--- ago = 0 is the most recently closed bar.
   int               Idx(const int ago) const { return m_n - 1 - ago; }
   double            HighAgo(const int ago) const { return m_b[Idx(ago)].high; }
   double            LowAgo(const int ago)  const { return m_b[Idx(ago)].low; }
   double            OpenAgo(const int ago) const { return m_b[Idx(ago)].open; }
   double            CloseAgo(const int ago) const { return m_b[Idx(ago)].close; }
   long              TimeAgo(const int ago) const { return m_b[Idx(ago)].time; }
   int               SpreadAgo(const int ago) const { return m_b[Idx(ago)].spreadPts; }
   double            RangeAgo(const int ago) const { return m_b[Idx(ago)].high - m_b[Idx(ago)].low; }

   //--- Append one closed bar, dropping the oldest when full.
   void              Push(const IprBar &bar)
     {
      if(m_n < IPR_MAX_BARS)
        {
         m_b[m_n] = bar;
         m_n++;
         return;
        }
      for(int i = 0; i < IPR_MAX_BARS - 1; i++)
         m_b[i] = m_b[i + 1];
      m_b[IPR_MAX_BARS - 1] = bar;
     }
  };

//--- Everything the strategy needs to know about the instrument. Filled
//--- from MT5 by SymbolSpecMT5.mqh; the pure logic never calls MT5.
struct IprSymbolSpec
  {
   int               digits;
   double            point;
   double            tickSize;
   double            tickValue;      // account currency per tickSize move, per 1.0 lot
   double            contractSize;
   double            volMin;
   double            volMax;
   double            volStep;
   double            stopsLevelPrice; // SYMBOL_TRADE_STOPS_LEVEL converted to price
   double            freezeLevelPrice;
   double            swapLong;
   double            swapShort;
   bool              valid;

   void              Reset()
     {
      digits = 0; point = 0.0; tickSize = 0.0; tickValue = 0.0; contractSize = 0.0;
      volMin = 0.0; volMax = 0.0; volStep = 0.0; stopsLevelPrice = 0.0;
      freezeLevelPrice = 0.0; swapLong = 0.0; swapShort = 0.0; valid = false;
     }
  };

//--- Result of the cost model for a specific volume at a moment in time.
struct IprCosts
  {
   double            moneyPerPriceUnit; // M = volume * tickValue / tickSize
   double            spreadPrice;
   double            slipPrice;         // modelled round-turn slippage, price units
   double            commissionMoney;   // round-turn, account currency
   double            swapMoney;
   double            totalMoney;        // C_money
   double            totalPrice;        // C_money / M
   double            reqMovePrice;      // d_req for TargetNet

   void              Reset()
     {
      moneyPerPriceUnit = 0.0; spreadPrice = 0.0; slipPrice = 0.0;
      commissionMoney = 0.0; swapMoney = 0.0; totalMoney = 0.0;
      totalPrice = 0.0; reqMovePrice = 0.0;
     }
  };

//--- A detected impulse leg.
struct IprImpulse
  {
   bool              found;
   int               highAgo;    // bars-ago index of leg extreme in trade direction
   int               lowAgo;     // bars-ago index of the leg origin
   double            legHigh;    // for shorts: the leg LOW  (direction-relative extreme)
   double            legLow;     // for shorts: the leg HIGH (direction-relative origin)
   double            legSize;    // L, always positive
   double            er;
   int               impBars;
   double            bosLevel;   // swing level the leg broke

   void              Reset()
     {
      found = false; highAgo = -1; lowAgo = -1; legHigh = 0.0; legLow = 0.0;
      legSize = 0.0; er = 0.0; impBars = 0; bosLevel = 0.0;
     }
  };

//--- A detected pullback plus its turn bar.
struct IprPullback
  {
   bool              found;
   double            pbExtreme;  // pullback low (long) / high (short)
   int               pbAgo;
   int               pbBars;
   double            depth;      // R
   int               turnAgo;
   double            turnPrice;  // turn bar high (long) / low (short)
   long              turnTime;

   void              Reset()
     {
      found = false; pbExtreme = 0.0; pbAgo = -1; pbBars = 0; depth = 0.0;
      turnAgo = -1; turnPrice = 0.0; turnTime = 0;
     }
  };

//--- An armed setup. setupId is an immutable hash of the structure that
//--- produced it, so the same structure can never arm twice.
struct IprSetup
  {
   ulong             setupId;
   IprSetupState     state;
   IprDirection      dir;
   long              armTime;
   int               barsSinceArm;
   double            triggerPrice;
   double            stopPrice;
   double            targetPrice;
   double            dTp;
   double            dSl;
   double            atrAtArm;
   double            legExtreme;   // for the cluster fresh-structure lock
   double            pbExtreme;
   double            invalidLevel; // pb_extreme -/+ 0.05 * ATR
   double            depth;
   double            er;
   double            legSize;
   double            bosLevel;
   long              turnTime;
   double            costMoney;
   double            reqMovePrice;
   ulong             orderTicket;

   void              Reset()
     {
      setupId = 0; state = IPR_STATE_NONE; dir = IPR_DIR_NONE; armTime = 0;
      barsSinceArm = 0; triggerPrice = 0.0; stopPrice = 0.0; targetPrice = 0.0;
      dTp = 0.0; dSl = 0.0; atrAtArm = 0.0; legExtreme = 0.0; pbExtreme = 0.0;
      invalidLevel = 0.0; depth = 0.0; er = 0.0; legSize = 0.0; bosLevel = 0.0;
      turnTime = 0; costMoney = 0.0; reqMovePrice = 0.0; orderTicket = 0;
     }
  };

//--- Live position bookkeeping owned by the EA (not the broker).
struct IprTradeState
  {
   bool              active;
   ulong             positionTicket;
   IprDirection      dir;
   double            entryPrice;
   double            stopPrice;
   double            targetPrice;
   double            dTp;
   double            dSl;
   long              entryTime;
   int               barsHeld;
   double            mfePrice;      // best price reached in the favourable direction
   int               momFailCloses;
   ulong             setupId;

   void              Reset()
     {
      active = false; positionTicket = 0; dir = IPR_DIR_NONE; entryPrice = 0.0;
      stopPrice = 0.0; targetPrice = 0.0; dTp = 0.0; dSl = 0.0; entryTime = 0;
      barsHeld = 0; mfePrice = 0.0; momFailCloses = 0; setupId = 0;
     }
  };

#endif // IPR_TYPES_MQH
