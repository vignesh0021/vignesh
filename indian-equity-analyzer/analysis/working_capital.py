"""
Working Capital Cycle Analysis.

Metrics:
  - Debtor Days (DSO)   = Receivables / Revenue × 365
  - Creditor Days (DPO) = Payables / COGS × 365
  - Inventory Days (DIO)= Inventory / COGS × 365
  - Cash Conversion Cycle (CCC) = DSO + DIO - DPO

Trend analysis over available years identifies deterioration or improvement.
"""
import logging
import math
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)


def _lv(lst: List[Dict], idx: int, key: str, default: float = 0.0) -> float:
    try:
        return float(lst[idx].get(key, default) or default)
    except (IndexError, TypeError, ValueError):
        return default


def _safe(val, default: float = 0.0) -> float:
    try:
        v = float(val)
        return v if math.isfinite(v) else default
    except (TypeError, ValueError):
        return default


class WorkingCapitalAnalyzer:
    """Analyses cash conversion cycle and working capital efficiency trends."""

    def __init__(self, fundamental_manager=None):
        self.fund_mgr = fundamental_manager

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def analyze(self, symbol: str, statements: Optional[Dict] = None) -> Dict:
        """
        Compute CCC and trend for *symbol*.

        Returns:
          latest: {dso, dpo, dio, ccc}
          trend:  "IMPROVING" | "STABLE" | "DETERIORATING"
          history: list of annual CCC dicts
          wc_score: [-1, +1]
          summary: str
        """
        if statements is None and self.fund_mgr is not None:
            try:
                statements = self.fund_mgr.get_financial_statements(symbol)
            except Exception as exc:
                logger.warning("WC: statements fetch failed for %s: %s", symbol, exc)
                statements = {}

        if not statements:
            return self._empty()

        pl = statements.get("profit_loss", [])
        bs = statements.get("balance_sheet", [])

        if len(pl) < 2 or len(bs) < 2:
            return self._empty()

        n = min(len(pl), len(bs))
        history = []

        for i in range(-n, 0):
            row = self._compute_period(pl, bs, i)
            if row:
                history.append(row)

        if not history:
            return self._empty()

        latest = history[-1]
        trend  = self._trend(history)
        score  = self._score(latest, trend)

        return {
            "latest":   latest,
            "trend":    trend,
            "history":  history,
            "wc_score": round(score, 4),
            "summary":  self._summary(latest, trend),
        }

    # ------------------------------------------------------------------
    # Per-period computation
    # ------------------------------------------------------------------

    @staticmethod
    def _compute_period(pl: List[Dict], bs: List[Dict], idx: int) -> Optional[Dict]:
        rev     = _lv(pl, idx, "sales")
        cogs    = _lv(pl, idx, "expenses") or _lv(pl, idx, "cost_of_goods_sold")

        # From balance sheet
        rec     = _lv(bs, idx, "trade_receivables") or _lv(bs, idx, "debtors")
        inv     = _lv(bs, idx, "inventories") or _lv(bs, idx, "inventory")
        pay     = _lv(bs, idx, "trade_payables") or _lv(bs, idx, "creditors")

        if rev <= 0 or cogs <= 0:
            return None

        dso = _safe(rec / rev * 365)
        dpo = _safe(pay / cogs * 365) if cogs > 0 else 0.0
        dio = _safe(inv / cogs * 365) if cogs > 0 else 0.0
        ccc = dso + dio - dpo

        year_label = pl[idx].get("year") or bs[idx].get("year") or str(idx)

        return {
            "year": year_label,
            "dso":  round(dso, 1),
            "dpo":  round(dpo, 1),
            "dio":  round(dio, 1),
            "ccc":  round(ccc, 1),
        }

    # ------------------------------------------------------------------
    # Trend classification
    # ------------------------------------------------------------------

    @staticmethod
    def _trend(history: List[Dict]) -> str:
        if len(history) < 2:
            return "STABLE"
        recent = history[-3:] if len(history) >= 3 else history
        cccs   = [r["ccc"] for r in recent]
        if all(cccs[i] <= cccs[i - 1] for i in range(1, len(cccs))):
            return "IMPROVING"   # CCC falling = better
        if all(cccs[i] >= cccs[i - 1] for i in range(1, len(cccs))):
            return "DETERIORATING"
        return "STABLE"

    # ------------------------------------------------------------------
    # Score
    # ------------------------------------------------------------------

    @staticmethod
    def _score(latest: Dict, trend: str) -> float:
        ccc = latest.get("ccc", 90)
        # Shorter CCC is better
        if ccc < 0:
            base = 0.8    # negative CCC = customers pay before suppliers
        elif ccc < 30:
            base = 0.6
        elif ccc < 60:
            base = 0.3
        elif ccc < 90:
            base = 0.0
        elif ccc < 120:
            base = -0.3
        else:
            base = -0.6

        trend_adj = {"IMPROVING": 0.2, "STABLE": 0.0, "DETERIORATING": -0.2}.get(trend, 0.0)
        return max(-1.0, min(1.0, base + trend_adj))

    @staticmethod
    def _summary(latest: Dict, trend: str) -> str:
        return (
            f"CCC {latest['ccc']:.0f} days (DSO {latest['dso']:.0f}d, "
            f"DIO {latest['dio']:.0f}d, DPO {latest['dpo']:.0f}d) — {trend}"
        )

    @staticmethod
    def _empty() -> Dict:
        return {
            "latest":   {"year": "N/A", "dso": 0.0, "dpo": 0.0, "dio": 0.0, "ccc": 0.0},
            "trend":    "STABLE",
            "history":  [],
            "wc_score": 0.0,
            "summary":  "Insufficient data for working capital analysis",
        }
