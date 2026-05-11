"""
Accounting Quality: Beneish M-Score, Altman Z-Score, DuPont Analysis.

Beneish M-Score > -1.78 → probable earnings manipulator.
Altman Z-Score < 1.81 → distress zone; 1.81–2.99 → grey; > 2.99 → safe.
DuPont: ROE = Net Margin × Asset Turnover × Equity Multiplier.
"""
import logging
import math
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

_BENEISH_THRESHOLD  = -1.78
_ALTMAN_DISTRESS    = 1.81
_ALTMAN_SAFE        = 2.99


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


class AccountingQualityAnalyzer:
    """
    Detects earnings manipulation and financial distress from financial statements.
    All monetary inputs expected in ₹ Crores (consistent with the rest of the codebase).
    """

    def __init__(self, fundamental_manager=None):
        self.fund_mgr = fundamental_manager

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def analyze(self, symbol: str, statements: Optional[Dict] = None) -> Dict:
        """
        Run Beneish, Altman Z, and DuPont for *symbol*.

        Returns:
          beneish_m_score, beneish_flag, altman_z_score, altman_zone,
          dupont, quality_score [-1, +1], summary
        """
        if statements is None and self.fund_mgr is not None:
            try:
                statements = self.fund_mgr.get_financial_statements(symbol)
            except Exception as exc:
                logger.warning("Accounting quality: statements fetch failed for %s: %s", symbol, exc)
                statements = {}

        if not statements:
            return self._empty()

        pl  = statements.get("profit_loss", [])
        bs  = statements.get("balance_sheet", [])
        cf  = statements.get("cash_flow", [])

        m_score   = self._beneish(pl, bs, cf)
        z_score   = self._altman_z(pl, bs)
        dupont    = self._dupont(pl, bs)
        q_score   = self._quality_score(m_score, z_score, dupont)

        beneish_flag = m_score > _BENEISH_THRESHOLD
        altman_zone  = (
            "DISTRESS" if z_score < _ALTMAN_DISTRESS else
            "GREY"     if z_score < _ALTMAN_SAFE     else
            "SAFE"
        )

        summary_parts = []
        if beneish_flag:
            summary_parts.append(f"M-Score {m_score:.2f} > -1.78: MANIPULATION RISK")
        else:
            summary_parts.append(f"M-Score {m_score:.2f}: low manipulation risk")
        summary_parts.append(f"Z-Score {z_score:.2f}: {altman_zone}")
        summary_parts.append(
            f"DuPont ROE = {dupont['net_margin']:.1f}% NM × "
            f"{dupont['asset_turnover']:.2f}x AT × "
            f"{dupont['equity_multiplier']:.2f}x EM"
        )

        return {
            "beneish_m_score":  round(m_score, 4),
            "beneish_flag":     beneish_flag,
            "altman_z_score":   round(z_score, 4),
            "altman_zone":      altman_zone,
            "dupont":           dupont,
            "quality_score":    round(q_score, 4),
            "summary":          " | ".join(summary_parts),
        }

    # ------------------------------------------------------------------
    # Beneish M-Score (8-variable model, 1999)
    # ------------------------------------------------------------------

    def _beneish(self, pl: List[Dict], bs: List[Dict], cf: List[Dict]) -> float:
        """
        Compute Beneish M-Score. Requires two periods.
        Returns 0.0 (neutral) when data is insufficient.
        """
        if len(pl) < 2 or len(bs) < 2:
            return -2.5  # assume clean when no data

        # Period t = current, t-1 = prior year
        rev_t    = _lv(pl, -1, "sales")
        rev_t1   = _lv(pl, -2, "sales")
        cogs_t   = _lv(pl, -1, "expenses")        # raw material + mfg expenses as proxy
        cogs_t1  = _lv(pl, -2, "expenses")
        ni_t     = _lv(pl, -1, "net_profit")
        ni_t1    = _lv(pl, -2, "net_profit")
        dep_t    = _lv(pl, -1, "depreciation")
        dep_t1   = _lv(pl, -2, "depreciation")

        ta_t     = _lv(bs, -1, "total_assets")
        ta_t1    = _lv(bs, -2, "total_assets")
        fa_t     = _lv(bs, -1, "fixed_assets")
        fa_t1    = _lv(bs, -2, "fixed_assets")
        lt_debt_t  = _lv(bs, -1, "long_term_debt")
        lt_debt_t1 = _lv(bs, -2, "long_term_debt")
        ca_t     = _lv(bs, -1, "current_assets")
        ca_t1    = _lv(bs, -2, "current_assets")
        cl_t     = _lv(bs, -1, "current_liabilities")
        cl_t1    = _lv(bs, -2, "current_liabilities")
        cash_t   = _lv(bs, -1, "cash")
        cash_t1  = _lv(bs, -2, "cash")
        rec_t    = ca_t - cash_t    # trade receivables proxy
        rec_t1   = ca_t1 - cash_t1

        # DSRI – Days' Sales in Receivables Index
        dsri = ((rec_t / max(rev_t, 1)) / max(rec_t1 / max(rev_t1, 1), 1e-9))

        # GMI – Gross Margin Index
        gm_t  = (rev_t  - cogs_t)  / max(rev_t, 1)
        gm_t1 = (rev_t1 - cogs_t1) / max(rev_t1, 1)
        gmi   = gm_t1 / max(gm_t, 1e-9)

        # AQI – Asset Quality Index (non-current non-PPE assets / total assets)
        # Proxy: 1 - (current assets + fixed assets) / total assets
        aq_t  = 1 - (ca_t  + fa_t)  / max(ta_t,  1)
        aq_t1 = 1 - (ca_t1 + fa_t1) / max(ta_t1, 1)
        aqi   = aq_t / max(aq_t1, 1e-9)

        # SGI – Sales Growth Index
        sgi = rev_t / max(rev_t1, 1)

        # DEPI – Depreciation Index
        dep_rate_t  = dep_t  / max(dep_t  + fa_t,  1)
        dep_rate_t1 = dep_t1 / max(dep_t1 + fa_t1, 1)
        depi = dep_rate_t1 / max(dep_rate_t, 1e-9)

        # SGAI – SG&A Expense Index (no direct SGA in Screener – use admin/other expenses proxy)
        # If missing, default to 1.0 (no change)
        sgai = 1.0

        # LVGI – Leverage Index
        lev_t  = (lt_debt_t  + cl_t)  / max(ta_t,  1)
        lev_t1 = (lt_debt_t1 + cl_t1) / max(ta_t1, 1)
        lvgi   = lev_t / max(lev_t1, 1e-9)

        # TATA – Total Accruals to Total Assets
        op_cf_t = _lv(cf, -1, "operating_cash_flow")
        tata    = (ni_t - op_cf_t) / max(ta_t, 1)

        # Clip extreme values
        def clip(v: float) -> float:
            return max(-10.0, min(10.0, _safe(v, 0.0)))

        dsri = clip(dsri); gmi  = clip(gmi);  aqi  = clip(aqi)
        sgi  = clip(sgi);  depi = clip(depi); sgai = clip(sgai)
        lvgi = clip(lvgi); tata = clip(tata)

        m = (
            -4.840
            + 0.920 * dsri
            + 0.528 * gmi
            + 0.404 * aqi
            + 0.892 * sgi
            + 0.115 * depi
            - 0.172 * sgai
            + 4.679 * tata
            - 0.327 * lvgi
        )
        return _safe(m, -2.5)

    # ------------------------------------------------------------------
    # Altman Z-Score (modified for non-US emerging markets)
    # ------------------------------------------------------------------

    def _altman_z(self, pl: List[Dict], bs: List[Dict]) -> float:
        """
        Altman Z-Score using modified formula for emerging markets (no market value term).
        Z' = 0.717*X1 + 0.847*X2 + 3.107*X3 + 0.420*X4 + 0.998*X5
        """
        if not pl or not bs:
            return 3.0  # default to safe

        ta   = _lv(bs, -1, "total_assets")
        cl   = _lv(bs, -1, "current_liabilities")
        ca   = _lv(bs, -1, "current_assets")
        re   = _lv(bs, -1, "reserves")
        ebit = _lv(pl, -1, "ebit") or (_lv(pl, -1, "net_profit") + _lv(pl, -1, "tax") + _lv(pl, -1, "interest"))
        rev  = _lv(pl, -1, "sales")
        ltd  = _lv(bs, -1, "long_term_debt") or _lv(bs, -1, "total_debt")
        bve  = _lv(bs, -1, "total_equity")

        if ta <= 0:
            return 3.0

        x1 = (ca - cl) / ta                        # working capital / TA
        x2 = re / ta                                # retained earnings / TA
        x3 = ebit / ta                              # EBIT / TA
        x4 = bve / max(ltd + cl, 1)                 # equity / total liabilities
        x5 = rev / ta                               # sales / TA

        z = 0.717*x1 + 0.847*x2 + 3.107*x3 + 0.420*x4 + 0.998*x5
        return round(_safe(z, 3.0), 4)

    # ------------------------------------------------------------------
    # DuPont Analysis (3-factor)
    # ------------------------------------------------------------------

    def _dupont(self, pl: List[Dict], bs: List[Dict]) -> Dict:
        if not pl or not bs:
            return {"net_margin": 0.0, "asset_turnover": 0.0, "equity_multiplier": 1.0, "roe": 0.0}

        ni   = _lv(pl, -1, "net_profit")
        rev  = _lv(pl, -1, "sales")
        ta   = _lv(bs, -1, "total_assets")
        eq   = _lv(bs, -1, "total_equity") or _lv(bs, -1, "reserves")

        net_margin      = (ni / max(rev, 1)) * 100
        asset_turnover  = rev / max(ta, 1)
        equity_mult     = ta  / max(eq, 1)
        roe             = net_margin * asset_turnover * equity_mult / 100

        return {
            "net_margin":       round(_safe(net_margin, 0.0), 2),
            "asset_turnover":   round(_safe(asset_turnover, 0.0), 4),
            "equity_multiplier":round(_safe(equity_mult, 1.0), 4),
            "roe":              round(_safe(roe * 100, 0.0), 2),  # as percentage
        }

    # ------------------------------------------------------------------
    # Composite quality score [-1, +1]
    # ------------------------------------------------------------------

    @staticmethod
    def _quality_score(m_score: float, z_score: float, dupont: Dict) -> float:
        score = 0.0

        # Beneish component
        if m_score < -2.5:
            score += 0.4   # very clean
        elif m_score < _BENEISH_THRESHOLD:
            score += 0.2   # clean
        else:
            score -= 0.5   # manipulation risk

        # Altman component
        if z_score > _ALTMAN_SAFE:
            score += 0.4
        elif z_score > _ALTMAN_DISTRESS:
            score += 0.1   # grey zone
        else:
            score -= 0.5   # distress

        # DuPont: high ROE with low leverage is ideal
        roe = dupont.get("roe", 0.0)
        em  = dupont.get("equity_multiplier", 1.0)
        at  = dupont.get("asset_turnover", 0.0)
        nm  = dupont.get("net_margin", 0.0)

        if roe > 20 and em < 3:
            score += 0.2   # ROE driven by margins/turnover, not leverage

        return max(-1.0, min(1.0, score))

    @staticmethod
    def _empty() -> Dict:
        return {
            "beneish_m_score":  -2.5,
            "beneish_flag":     False,
            "altman_z_score":   3.0,
            "altman_zone":      "SAFE",
            "dupont":           {"net_margin": 0.0, "asset_turnover": 0.0, "equity_multiplier": 1.0, "roe": 0.0},
            "quality_score":    0.0,
            "summary":          "Insufficient data for accounting quality analysis",
        }
