"""
Capital Allocation Quality Analysis.

Metrics:
  - ROIC vs WACC spread (value creation check)
  - Capex efficiency (revenue / gross capex trend)
  - Dividend consistency and payout ratio
  - Free cash flow conversion (FCF / Net Income)
  - Capital allocation score [-1, +1]
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


class CapitalAllocationAnalyzer:
    """
    Evaluates quality of management's capital allocation decisions.
    Requires financial statements in Crores (consistent with codebase).
    """

    def __init__(self, fundamental_manager=None, dcf_engine=None):
        self.fund_mgr   = fundamental_manager
        self.dcf_engine = dcf_engine

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def analyze(
        self,
        symbol: str,
        statements: Optional[Dict] = None,
        wacc: float = 0.12,
    ) -> Dict:
        """
        Returns:
          roic, wacc, roic_wacc_spread, capex_efficiency_trend,
          fcf_conversion, dividend_consistency,
          ca_score [-1, +1], summary
        """
        if statements is None and self.fund_mgr is not None:
            try:
                statements = self.fund_mgr.get_financial_statements(symbol)
            except Exception as exc:
                logger.warning("CapAlloc: statements fetch failed for %s: %s", symbol, exc)
                statements = {}

        if not statements:
            return self._empty(wacc)

        pl = statements.get("profit_loss", [])
        bs = statements.get("balance_sheet", [])
        cf = statements.get("cash_flow", [])

        roic               = self._roic(pl, bs)
        spread             = round(roic - wacc * 100, 2)
        capex_eff_trend    = self._capex_efficiency_trend(pl, cf)
        fcf_conversion     = self._fcf_conversion(pl, cf)
        div_consistency    = self._dividend_consistency(cf)
        ca_score           = self._score(spread, capex_eff_trend, fcf_conversion, div_consistency)

        return {
            "roic":                    round(roic, 2),
            "wacc_pct":                round(wacc * 100, 2),
            "roic_wacc_spread":        spread,
            "capex_efficiency_trend":  capex_eff_trend,
            "fcf_conversion":          round(fcf_conversion, 2),
            "dividend_consistency":    div_consistency,
            "ca_score":                round(ca_score, 4),
            "summary":                 self._summary(roic, wacc, spread, capex_eff_trend),
        }

    # ------------------------------------------------------------------
    # ROIC
    # ------------------------------------------------------------------

    @staticmethod
    def _roic(pl: List[Dict], bs: List[Dict]) -> float:
        if not pl or not bs:
            return 0.0
        ebit     = _lv(pl, -1, "ebit") or (_lv(pl, -1, "net_profit") + _lv(pl, -1, "tax") + _lv(pl, -1, "interest"))
        tax_rate = 0.25
        nopat    = ebit * (1 - tax_rate)

        # Invested Capital = Total Equity + Total Debt - Cash
        equity   = _lv(bs, -1, "total_equity") or _lv(bs, -1, "reserves")
        debt     = _lv(bs, -1, "total_debt") or _lv(bs, -1, "long_term_debt")
        cash     = _lv(bs, -1, "cash")
        ic       = equity + debt - cash

        if ic <= 0:
            return 0.0
        return _safe(nopat / ic * 100)

    # ------------------------------------------------------------------
    # Capex efficiency trend
    # ------------------------------------------------------------------

    @staticmethod
    def _capex_efficiency_trend(pl: List[Dict], cf: List[Dict]) -> str:
        n = min(len(pl), len(cf))
        if n < 3:
            return "STABLE"

        ratios = []
        for i in range(-n, 0):
            rev   = _lv(pl, i, "sales")
            capex = abs(_lv(cf, i, "capex"))
            if rev > 0 and capex > 0:
                ratios.append(rev / capex)

        if len(ratios) < 2:
            return "STABLE"

        # Improving = ratio rising (getting more revenue per unit capex)
        recent = ratios[-3:]
        if all(recent[i] >= recent[i - 1] for i in range(1, len(recent))):
            return "IMPROVING"
        if all(recent[i] <= recent[i - 1] for i in range(1, len(recent))):
            return "DETERIORATING"
        return "STABLE"

    # ------------------------------------------------------------------
    # FCF conversion
    # ------------------------------------------------------------------

    @staticmethod
    def _fcf_conversion(pl: List[Dict], cf: List[Dict]) -> float:
        """FCF / Net Income over last 3 years average."""
        n = min(len(pl), len(cf), 3)
        if n == 0:
            return 0.0
        total_ni, total_fcf = 0.0, 0.0
        for i in range(-n, 0):
            total_ni  += _lv(pl, i, "net_profit")
            total_fcf += _lv(cf, i, "free_cash_flow")
        return _safe(total_fcf / max(total_ni, 1))

    # ------------------------------------------------------------------
    # Dividend consistency
    # ------------------------------------------------------------------

    @staticmethod
    def _dividend_consistency(cf: List[Dict]) -> str:
        if len(cf) < 3:
            return "UNKNOWN"
        divs_paid = [
            abs(_lv(cf, i, "dividends_paid") or _lv(cf, i, "dividend"))
            for i in range(-min(len(cf), 5), 0)
        ]
        paid_years = sum(1 for d in divs_paid if d > 0)
        pct = paid_years / len(divs_paid)
        if pct >= 0.8:
            return "CONSISTENT"
        if pct >= 0.4:
            return "IRREGULAR"
        return "NONE"

    # ------------------------------------------------------------------
    # Score
    # ------------------------------------------------------------------

    @staticmethod
    def _score(
        spread: float,
        capex_trend: str,
        fcf_conv: float,
        div_consistency: str,
    ) -> float:
        score = 0.0

        # ROIC vs WACC spread
        if spread > 10:
            score += 0.4
        elif spread > 5:
            score += 0.25
        elif spread > 0:
            score += 0.1
        elif spread > -5:
            score -= 0.2
        else:
            score -= 0.4

        # Capex efficiency
        capex_pts = {"IMPROVING": 0.2, "STABLE": 0.0, "DETERIORATING": -0.2}.get(capex_trend, 0.0)
        score += capex_pts

        # FCF conversion
        if fcf_conv >= 0.8:
            score += 0.2
        elif fcf_conv >= 0.5:
            score += 0.1
        elif fcf_conv < 0:
            score -= 0.2

        # Dividend consistency
        div_pts = {"CONSISTENT": 0.1, "IRREGULAR": 0.0, "NONE": -0.05, "UNKNOWN": 0.0}.get(div_consistency, 0.0)
        score += div_pts

        return max(-1.0, min(1.0, score))

    @staticmethod
    def _summary(roic: float, wacc: float, spread: float, capex_trend: str) -> str:
        direction = "ABOVE" if spread > 0 else "BELOW"
        return (
            f"ROIC {roic:.1f}% vs WACC {wacc*100:.1f}% "
            f"(spread {spread:+.1f}%, {direction} cost of capital) | "
            f"Capex efficiency: {capex_trend}"
        )

    @staticmethod
    def _empty(wacc: float) -> Dict:
        return {
            "roic":                   0.0,
            "wacc_pct":               round(wacc * 100, 2),
            "roic_wacc_spread":       0.0,
            "capex_efficiency_trend": "STABLE",
            "fcf_conversion":         0.0,
            "dividend_consistency":   "UNKNOWN",
            "ca_score":               0.0,
            "summary":                "Insufficient data for capital allocation analysis",
        }
