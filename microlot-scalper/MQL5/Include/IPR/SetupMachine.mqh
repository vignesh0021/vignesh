//+------------------------------------------------------------------+
//| SetupMachine.mqh - setup identity, lifecycle and cluster locks.  |
//|                                                                  |
//| This is where "one setup = one trade" stops being a rule and     |
//| becomes a structural property (Phase 1 5.9). Three mechanisms:   |
//|                                                                  |
//|  1. SetupID is a hash of the STRUCTURE (leg extreme + turn bar), |
//|     so the same formation always produces the same id no matter  |
//|     how many ticks or bars re-evaluate it.                       |
//|  2. A consumed-id ring remembers every id that has left ARMED.   |
//|     Ids in the ring can never arm again - not after a fill, not  |
//|     after an invalidation, not after a terminal restart (the ring|
//|     is persisted).                                               |
//|  3. At most one ARMED setup exists per symbol at a time.         |
//|                                                                  |
//| Together these close the three duplicate-entry paths: repeated   |
//| ticks, repeated bars, and price crossing the trigger, retreating |
//| and crossing again.                                              |
//+------------------------------------------------------------------+
#ifndef IPR_SETUPMACHINE_MQH
#define IPR_SETUPMACHINE_MQH

#include "Types.mqh"
#include "Config.mqh"
#include "MathUtil.mqh"

//--- Fixed-size ring of consumed SetupIDs.
struct IprConsumedRing
  {
   ulong             m_ids[IPR_CONSUMED_RING];
   int               m_n;
   int               m_head;

   void              Reset()
     {
      m_n = 0; m_head = 0;
      for(int i = 0; i < IPR_CONSUMED_RING; i++)
         m_ids[i] = 0;
     }

   bool              Contains(const ulong id) const
     {
      for(int i = 0; i < m_n; i++)
        {
         if(m_ids[i] == id)
            return true;
        }
      return false;
     }

   void              Add(const ulong id)
     {
      if(id == 0 || Contains(id))
         return;
      m_ids[m_head] = id;
      m_head = (m_head + 1) % IPR_CONSUMED_RING;
      if(m_n < IPR_CONSUMED_RING)
         m_n++;
     }

   int               Count() const { return m_n; }
  };

//--- Per-direction memory of the last ENTERED setup, for the cluster
//--- locks. Index 0 = long, 1 = short; the two are fully independent so
//--- a long never blocks a short (Phase 2 section 16).
struct IprClusterState
  {
   bool              m_has[2];
   double            m_legExtreme[2];
   double            m_entryPrice[2];
   long              m_entryBarSeq[2];

   void              Reset()
     {
      for(int i = 0; i < 2; i++)
        {
         m_has[i] = false;
         m_legExtreme[i] = 0.0;
         m_entryPrice[i] = 0.0;
         m_entryBarSeq[i] = 0;
        }
     }

   static int        Slot(const IprDirection dir) { return (dir == IPR_DIR_LONG) ? 0 : 1; }

   void              RecordEntry(const IprDirection dir, const double legExtreme,
                                 const double entryPrice, const long barSeq)
     {
      const int s = Slot(dir);
      m_has[s] = true;
      m_legExtreme[s] = legExtreme;
      m_entryPrice[s] = entryPrice;
      m_entryBarSeq[s] = barSeq;
     }
  };

struct IprSetupMachine
  {
   IprSetup          m_active;
   IprConsumedRing   m_consumed;
   IprClusterState   m_cluster;
   long              m_barSeq;        // monotonic count of closed bars seen
   ulong             m_symbolHash;

   void              Init(const ulong symbolHash)
     {
      m_active.Reset();
      m_consumed.Reset();
      m_cluster.Reset();
      m_barSeq = 0;
      m_symbolHash = symbolHash;
     }

   bool              HasArmed() const { return (m_active.state == IPR_STATE_ARMED); }

   //--- Called once per newly closed bar, before any signal work.
   void              OnNewBar()
     {
      m_barSeq++;
      if(m_active.state == IPR_STATE_ARMED)
         m_active.barsSinceArm++;
     }

   //--- Phase 1 5.8: a setup is valid for 5 bars from the turn bar's
   //--- close. FIXED, deliberately not an input.
   bool              IsExpired() const
     {
      if(m_active.state != IPR_STATE_ARMED)
         return false;
      return (m_active.barsSinceArm >= IPR_SETUP_VALID_BARS);
     }

   //--- The one-way door. Every path out of ARMED goes through here, so
   //--- there is exactly one place that can retire a setup.
   void              Consume(const IprSetupState finalState)
     {
      if(m_active.setupId != 0)
         m_consumed.Add(m_active.setupId);
      m_active.state = finalState;
     }

   void              Clear()
     {
      const ulong id = m_active.setupId;
      m_active.Reset();
      m_active.setupId = id;   // keep id visible for logging until overwritten
      m_active.state = IPR_STATE_NONE;
     }

   bool              CanArm(const ulong id) const
     {
      if(id == 0)
         return false;
      if(m_active.state == IPR_STATE_ARMED)
         return false;               // one armed setup at a time
      return !m_consumed.Contains(id);
     }

   void              Arm(const IprSetup &s)
     {
      m_active = s;
      m_active.state = IPR_STATE_ARMED;
      m_active.barsSinceArm = 0;
     }

   //+---------------------------------------------------------------+
   //| Cluster locks (Phase 1 5.10). All must clear for a same-       |
   //| direction re-entry. The opposite-direction case needs no extra |
   //| test here: a reversal already requires a confirmed BOS in the  |
   //| new direction, enforced by the impulse detector's I4.          |
   //+---------------------------------------------------------------+
   IprReject         CheckClusterLocks(const IprDirection dir, const double legExtreme,
                                       const double entryPrice, const double atr) const
     {
      const int s = IprClusterState::Slot(dir);
      if(!m_cluster.m_has[s])
         return IPR_OK;                 // no prior entry in this direction

      //--- 1. Fresh structure: the new leg must extend beyond the last
      //--- entered leg by at least half an ATR. Overlapping structure
      //--- cannot re-fire.
      const double need = IPR_CLUSTER_STRUCT_ATR * atr;
      if(dir == IPR_DIR_LONG)
        {
         if(legExtreme < m_cluster.m_legExtreme[s] + need)
            return IPR_REJ_CLUSTER_STRUCTURE;
        }
      else
        {
         if(legExtreme > m_cluster.m_legExtreme[s] - need)
            return IPR_REJ_CLUSTER_STRUCTURE;
        }

      //--- 2. Time lock: at least 12 closed bars since the last entry.
      if(m_barSeq - m_cluster.m_entryBarSeq[s] < IPR_CLUSTER_BARS)
         return IPR_REJ_CLUSTER_TIME;

      //--- 3. Distance lock: entries must be at least one ATR apart.
      if(MathAbs(entryPrice - m_cluster.m_entryPrice[s]) < IPR_CLUSTER_DIST_ATR * atr)
         return IPR_REJ_CLUSTER_DISTANCE;

      return IPR_OK;
     }

   //+---------------------------------------------------------------+
   //| Invalidation (Phase 1 5.7). Returns true when the armed setup  |
   //| must die. Conditions 5 (expiry) and 6/7 (gates and feasibility |
   //| at trigger time) are checked by the caller, which owns the     |
   //| clock and the live quote.                                      |
   //+---------------------------------------------------------------+
   bool              CheckInvalidation(const IprBars &bars, const IprDirection regimeDir,
                                       const bool opposingBos, IprReject &why) const
     {
      why = IPR_OK;
      if(m_active.state != IPR_STATE_ARMED)
         return false;

      //--- 1. Price traded beyond the pullback extreme plus buffer.
      if(bars.Has(0))
        {
         if(m_active.dir == IPR_DIR_LONG && bars.LowAgo(0) < m_active.invalidLevel)
           { why = IPR_REJ_PULLBACK_TOO_DEEP; return true; }
         if(m_active.dir == IPR_DIR_SHORT && bars.HighAgo(0) > m_active.invalidLevel)
           { why = IPR_REJ_PULLBACK_TOO_DEEP; return true; }
        }

      //--- 3. Break of structure against the setup.
      if(opposingBos)
        { why = IPR_REJ_REGIME_FLIP; return true; }

      //--- 4. Regime no longer supports the direction.
      if(regimeDir != m_active.dir)
        { why = IPR_REJ_REGIME_FLIP; return true; }

      return false;
     }
  };

#endif // IPR_SETUPMACHINE_MQH
