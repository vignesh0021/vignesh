"""
Investment Decision Engine.

Production fixes applied:
  1. Beta calculated from 3-year weekly returns regression (not hardcoded 1.0).
  2. All monetary values in ₹ Crores consistently; per-share prices in ₹.
  3. Shares outstanding = market_cap_cr / price (units now match).
  4. Composite scoring uses explicit weights (not equal sum).
  5. Removed duplicate static method definition.
  6. Decisions are persisted to SQLite via AnalysisDatabase.
"""
import logging
import math
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional

from utils.database import AnalysisDatabase
from utils.units import shares_cr_from_mktcap

logger = logging.getLogger(__name__)

DECISION_LABELS = ["STRONG_BUY", "BUY", "HOLD", "AVOID", "STRONG_AVOID"]

# ── Composite scoring weights ───────────────────────────────────────────────
_W_QUANT  = 0.35  # BharatQuant: F-Score + RS + Trend
_W_DCF    = 0.25  # Monte Carlo DCF upside probability
_W_RDCF   = 0.20  # Reverse DCF growth gap
_W_SECTOR = 0.10  # Sector-relative PE premium
_W_NEWS   = 0.10  # News catalyst signal


@dataclass
class InvestmentDecision:
    """Structured output of the full analysis pipeline."""

    symbol:        str
    decision:      str   = "HOLD"   # STRONG_BUY / BUY / HOLD / AVOID / STRONG_AVOID
    confidence:    int   = 50        # 0-100
    key_reasons:   List[str] = field(default_factory=list)
    risks:         List[str] = field(default_factory=list)
    target_price:  float = 0.0
    stop_loss:     float = 0.0
    position_size: str   = "None"   # Full / Half / Quarter / None
    time_horizon:  str   = "Medium" # Short / Medium / Long
    current_price: float = 0.0

    # Fundamentals
    pe:                float = 0.0
    pb:                float = 0.0
    roe:               float = 0.0
    roce:              float = 0.0
    debt_equity:       float = 0.0
    promoter_holding:  float = 0.0
    fii_holding:       float = 0.0
    sales_growth:      float = 0.0
    profit_growth:     float = 0.0
    f_score:           int   = 0
    rs_score:          float = 0.0
    trend_stage:       str   = "Unknown"
    ma50:              float = 0.0
    ma200:             float = 0.0
    rsi:               float = 50.0
    beta:              float = 1.0

    # Valuation
    dcf_median:            float         = 0.0
    dcf_p75:               float         = 0.0
    upside_pct:            float         = 0.0
    implied_growth:        Optional[float] = None
    actual_growth:         float         = 0.0
    valuation_assessment:  str           = "INDETERMINATE"

    # Corporate actions & news
    corporate_actions: List[Dict] = field(default_factory=list)
    recent_news:       List[Dict] = field(default_factory=list)

    # Meta
    analyzed_at:     str   = field(default_factory=lambda: datetime.now().isoformat())
    composite_score: float = 0.0


class InvestmentDecisionEngine:
    """
    Orchestrates all analysis modules into a single structured decision.

    Composite score formula:
      C = W_quant * quant + W_dcf * dcf + W_rdcf * rdcf
          + W_sector * sector + W_news * news

    Each sub-signal is normalised to [-1, +1] before weighting.
    Final score maps to:
      ≥ +0.6 → STRONG_BUY  | ≥ +0.2 → BUY  | ≥ -0.2 → HOLD
      ≥ -0.6 → AVOID       | < -0.6 → STRONG_AVOID
    """

    def __init__(
        self,
        data_manager,
        fundamental_manager,
        screener,
        dcf_engine,
        reverse_dcf,
        news_monitor,
        db: Optional[AnalysisDatabase] = None,
    ):
        self.data_mgr   = data_manager
        self.fund_mgr   = fundamental_manager
        self.screener   = screener
        self.dcf_engine = dcf_engine
        self.rev_dcf    = reverse_dcf
        self.news       = news_monitor
        self._db        = db or AnalysisDatabase()

    # ------------------------------------------------------------------
    # Main entry point
    # ------------------------------------------------------------------

    def analyze_stock(self, symbol: str) -> InvestmentDecision:
        """
        Run the complete 6-step pipeline and return a populated
        :class:`InvestmentDecision`.
        """
        logger.info("▶ Starting full analysis for %s", symbol)
        d = InvestmentDecision(symbol=symbol)

        # ── 1. Live price ──────────────────────────────────────────────
        try:
            q = self.data_mgr.get_live_quote(symbol)
            d.current_price = float(q.get("last_price", 0.0))
            logger.info("%s  current price ₹%.2f", symbol, d.current_price)
        except Exception as exc:
            logger.error("Live quote failed for %s: %s", symbol, exc)

        # ── 2. Fundamental data ────────────────────────────────────────
        ratios:     Dict[str, Any] = {}
        growth:     Dict[str, Any] = {}
        statements: Dict[str, Any] = {}
        try:
            ratios     = self.fund_mgr.get_key_ratios(symbol)
            growth     = self.fund_mgr.get_growth_metrics(symbol)
            statements = self.fund_mgr.get_financial_statements(symbol)

            d.pe               = ratios.get("pe", 0.0)
            d.pb               = ratios.get("pb", 0.0)
            d.roe              = ratios.get("roe", 0.0)
            d.roce             = ratios.get("roce", 0.0)
            d.debt_equity      = ratios.get("debt_equity", 0.0)
            d.promoter_holding = ratios.get("promoter_holding", 0.0)
            d.fii_holding      = ratios.get("fii_holding", 0.0)
            d.sales_growth     = growth.get("sales_growth_yoy", 0.0)
            d.profit_growth    = growth.get("profit_growth_yoy", 0.0)
        except Exception as exc:
            logger.error("Fundamental fetch failed for %s: %s", symbol, exc)

        # ── 3. BharatQuant screen ──────────────────────────────────────
        quant_norm = 0.0
        try:
            f_r  = self.screener.calculate_piotroski_f_score(symbol)
            rs_r = self.screener.calculate_relative_strength(symbol)
            tr_r = self.screener.detect_trend_stage(symbol)

            d.f_score     = f_r["score"]
            d.rs_score    = rs_r["rs_score"]
            d.trend_stage = tr_r["stage_name"]
            d.ma50        = tr_r.get("ma50", 0.0)
            d.ma200       = tr_r.get("ma200", 0.0)
            d.rsi         = tr_r.get("rsi", 50.0)

            # Normalise each sub-signal to [-1, +1]
            f_norm  = (d.f_score - 4.5) / 4.5          # 0→-1, 9→+1
            rs_norm = max(-1.0, min(1.0, d.rs_score / 30))  # ±30% → ±1
            trend_norm = {2: 1.0, 1: 0.0, 3: -0.3, 4: -1.0, 0: 0.0}.get(
                tr_r.get("stage", 0), 0.0
            )
            quant_norm = (f_norm + rs_norm + trend_norm) / 3

        except Exception as exc:
            logger.error("BharatQuant screen failed for %s: %s", symbol, exc)

        # ── 4. Beta calculation + Monte Carlo DCF ─────────────────────
        dcf_norm = 0.0
        try:
            # Calculate actual beta from price history
            d.beta = self.data_mgr.calculate_beta(symbol)

            market_cap_cr = ratios.get("market_cap", 0.0) or (
                d.current_price * 100  # very rough estimate
            )
            de        = max(ratios.get("debt_equity", 0.0), 0.0)
            equity_cr = market_cap_cr
            debt_cr   = equity_cr * de

            wacc = self.dcf_engine.calculate_wacc(
                beta=d.beta,
                cost_of_debt=0.09,
                debt=debt_cr,
                equity=equity_cr,
            )

            # FCF list in Crores (statements already in Cr)
            cash_flows = statements.get("cash_flow", [])
            hist_fcf   = [
                float(r.get("free_cash_flow", 0) or 0)
                for r in cash_flows
            ]

            if hist_fcf and any(f != 0 for f in hist_fcf) and d.current_price > 0:
                # shares in Crore units so per_share_value = DCF_Cr / shares_Cr = ₹/share ✓
                shares_cr = shares_cr_from_mktcap(market_cap_cr, d.current_price)

                mc = self.dcf_engine.run_monte_carlo(
                    historical_fcf   = hist_fcf,
                    wacc             = wacc,
                    current_market_cap = market_cap_cr,
                    shares_outstanding = shares_cr,
                    n_simulations    = 5_000,
                )
                d.dcf_median = mc.get("per_share_median", 0.0)
                d.dcf_p75    = mc.get("per_share_p75", 0.0)

                if d.current_price > 0 and d.dcf_median > 0:
                    d.upside_pct = (
                        (d.dcf_median - d.current_price) / d.current_price * 100
                    )

                # Normalise: probability of upside → [-1, +1]
                prob_up = mc.get("probability_of_upside", 50.0)
                dcf_norm = (prob_up - 50) / 50  # 100% → +1, 0% → -1

        except Exception as exc:
            logger.error("Monte Carlo DCF failed for %s: %s", symbol, exc)

        # ── 5. Reverse DCF ────────────────────────────────────────────
        rdcf_norm = 0.0
        try:
            rdcf = self.rev_dcf.compare_to_historical_growth(symbol, d.current_price)
            d.implied_growth       = rdcf.get("implied_growth")
            d.actual_growth        = max(
                rdcf.get("actual_sales_growth", 0.0),
                rdcf.get("actual_profit_growth", 0.0),
            )
            d.valuation_assessment = rdcf.get("assessment", "INDETERMINATE")
            rdcf_norm = {"CHEAP": 1.0, "FAIR": 0.0, "EXPENSIVE": -1.0,
                         "INDETERMINATE": 0.0}.get(d.valuation_assessment, 0.0)
        except Exception as exc:
            logger.error("Reverse DCF failed for %s: %s", symbol, exc)

        # ── 6a. Sector-relative PE ─────────────────────────────────────
        sector_norm = 0.0
        try:
            pe = d.pe
            if 1 < pe < 200:
                # Simple heuristic: compare against Nifty 50 avg PE (~22)
                nifty_pe = 22.0
                premium  = (pe - nifty_pe) / nifty_pe
                sector_norm = max(-1.0, min(1.0, -premium))  # high PE → negative signal
        except Exception:
            pass

        # ── 6b. News signal ───────────────────────────────────────────
        news_norm = 0.0
        try:
            d.corporate_actions = self.news.get_corporate_actions(symbol)
            d.recent_news       = self.news.fetch_news(symbol=symbol, days=7, min_impact=4)[:5]

            if d.recent_news:
                sentiments = [n.get("sentiment", "neutral") for n in d.recent_news[:3]]
                pos = sentiments.count("positive")
                neg = sentiments.count("negative")
                if pos > neg:
                    news_norm = 0.5
                elif neg > pos:
                    news_norm = -0.5
        except Exception as exc:
            logger.error("News fetch failed for %s: %s", symbol, exc)

        # ── 7. Composite score → decision ─────────────────────────────
        composite = (
            _W_QUANT  * quant_norm
            + _W_DCF    * dcf_norm
            + _W_RDCF   * rdcf_norm
            + _W_SECTOR * sector_norm
            + _W_NEWS   * news_norm
        )
        d.composite_score = round(composite, 4)

        if composite >= 0.6:
            d.decision, d.position_size, d.time_horizon = "STRONG_BUY", "Full",    "Long"
            d.confidence = min(95, 85 + int((composite - 0.6) * 25))
        elif composite >= 0.2:
            d.decision, d.position_size, d.time_horizon = "BUY",        "Half",    "Medium"
            d.confidence = min(80, 65 + int((composite - 0.2) * 37))
        elif composite >= -0.2:
            d.decision, d.position_size, d.time_horizon = "HOLD",       "Quarter", "Medium"
            d.confidence = 50
        elif composite >= -0.6:
            d.decision, d.position_size, d.time_horizon = "AVOID",      "None",    "Short"
            d.confidence = min(80, 65 + int((-composite - 0.2) * 37))
        else:
            d.decision, d.position_size, d.time_horizon = "STRONG_AVOID","None",   "Short"
            d.confidence = min(95, 85 + int((-composite - 0.6) * 25))

        # Target from DCF p75; stop 15% below current price
        d.target_price = d.dcf_p75 if d.dcf_p75 > 0 else round(d.current_price * 1.15, 2)
        d.stop_loss    = round(d.current_price * 0.85, 2)

        d.key_reasons = _build_reasons(d, f_r if "f_r" in dir() else {}, rs_r if "rs_r" in dir() else {}, tr_r if "tr_r" in dir() else {})
        d.risks       = _build_risks(d, ratios)

        logger.info(
            "◀ %s → %s  confidence=%d%%  composite=%.4f  beta=%.3f",
            symbol, d.decision, d.confidence, composite, d.beta,
        )

        # Persist to DB
        self._db.save_decision(symbol, {
            "decision": d.decision, "confidence": d.confidence,
            "composite_score": d.composite_score, "current_price": d.current_price,
            "target_price": d.target_price, "stop_loss": d.stop_loss,
            "position_size": d.position_size, "beta": d.beta,
        })
        return d

    # ------------------------------------------------------------------
    # Report formatter
    # ------------------------------------------------------------------

    def generate_report(self, d: InvestmentDecision) -> str:
        sep  = "=" * 64
        thin = "-" * 64

        ig = f"{d.implied_growth:.1f}%" if d.implied_growth is not None else "N/A"

        ca_text = (
            "\n".join(
                f"  {a['action_type']} – Ex-date: {a['ex_date']}  {a['details']}"
                for a in d.corporate_actions[:3]
            ) or "  None in recent history"
        )
        news_text = (
            "\n".join(
                f"  [{n['impact_score']}/10] [{n.get('sentiment','?')[:3].upper()}] "
                f"{n['title'][:72]}  ({n['source']})"
                for n in d.recent_news[:3]
            ) or "  No high-impact news in last 7 days"
        )
        reasons = "\n".join(f"{i+1}. {r}" for i, r in enumerate(d.key_reasons)) or "  Insufficient data"
        risks   = "\n".join(f"{i+1}. {r}" for i, r in enumerate(d.risks))       or "  Standard market risks apply"

        return f"""
{sep}
INVESTMENT DECISION REPORT: {d.symbol}
{sep}

DECISION: {d.decision}
CONFIDENCE: {d.confidence}%

{thin}
KEY REASONS TO CONSIDER:
{thin}
{reasons}

{thin}
KEY RISKS:
{thin}
{risks}

{thin}
TRADING PARAMETERS:
{thin}
Current Price:  ₹{d.current_price:,.2f}
Target Price:   ₹{d.target_price:,.2f}
Stop Loss:      ₹{d.stop_loss:,.2f}
Position Size:  {d.position_size}
Time Horizon:   {d.time_horizon}

{thin}
FUNDAMENTAL SNAPSHOT:
{thin}
P/E Ratio:             {d.pe:.1f}
P/B Ratio:             {d.pb:.2f}
ROE:                   {d.roe:.1f}%
ROCE:                  {d.roce:.1f}%
Debt/Equity:           {d.debt_equity:.2f}
Promoter Holding:      {d.promoter_holding:.1f}%
FII Holding:           {d.fii_holding:.1f}%
Sales Growth (YoY):    {d.sales_growth:.1f}%
Profit Growth (YoY):   {d.profit_growth:.1f}%
F-Score:               {d.f_score}/9
RS Score:              {d.rs_score:+.1f}% vs Nifty

{thin}
VALUATION ANALYSIS:
{thin}
Monte Carlo Median Value: ₹{d.dcf_median:,.2f}
Upside Potential:         {d.upside_pct:+.1f}%
Implied Growth (Market):  {ig}
Actual Growth (Hist.):    {d.actual_growth:.1f}%
Valuation Assessment:     {d.valuation_assessment}

{thin}
TECHNICAL SNAPSHOT:
{thin}
Trend Stage:  {d.trend_stage}
50 DMA:       ₹{d.ma50:,.2f}
200 DMA:      ₹{d.ma200:,.2f}
RSI (14):     {d.rsi:.1f}
Beta (3Y):    {d.beta:.3f}

{thin}
RECENT CORPORATE ACTIONS:
{thin}
{ca_text}

{thin}
RECENT NEWS:
{thin}
{news_text}

{sep}
Report generated: {d.analyzed_at[:19]}
Composite Score:  {d.composite_score:+.4f}
{sep}
""".strip()

    # ------------------------------------------------------------------
    # Decision history
    # ------------------------------------------------------------------

    def get_decision_history(self, symbol: str, limit: int = 10) -> List[Dict]:
        """Return the last *limit* decisions for *symbol* from the DB."""
        return self._db.get_decision_history(symbol, limit)


# ------------------------------------------------------------------
# Reason / Risk builders (pure functions)
# ------------------------------------------------------------------

def _build_reasons(d: InvestmentDecision, f_r: Dict, rs_r: Dict, tr_r: Dict) -> List[str]:
    reasons = []

    if d.f_score >= 7:
        reasons.append(f"Strong Piotroski F-Score {d.f_score}/9 – excellent financial health")
    elif d.f_score >= 5:
        reasons.append(f"Solid Piotroski F-Score {d.f_score}/9 – above-average quality")

    if d.rs_score > 10:
        reasons.append(f"Outperforming Nifty by {d.rs_score:.1f}% over last year – strong RS")
    elif d.rs_score > 0:
        reasons.append(f"Marginally outperforming Nifty (+{d.rs_score:.1f}%) in last 12 months")

    if tr_r.get("stage") == 2:
        reasons.append("Stage 2 Advancing trend – price above 50-DMA with golden cross active")

    if d.sales_growth > 20:
        reasons.append(f"Revenue growing {d.sales_growth:.1f}% YoY – above-market pace")
    elif d.sales_growth > 10:
        reasons.append(f"Healthy revenue growth of {d.sales_growth:.1f}% YoY")

    if d.profit_growth > 20:
        reasons.append(f"Profit growth {d.profit_growth:.1f}% YoY – strong operating leverage")

    if d.roe > 18:
        reasons.append(f"High ROE of {d.roe:.1f}% – capital deployed efficiently")

    if d.roce > 20:
        reasons.append(f"ROCE of {d.roce:.1f}% above cost of capital – value creating")

    if d.valuation_assessment == "CHEAP" and d.implied_growth is not None:
        reasons.append(
            f"Market prices in only {d.implied_growth:.1f}% growth vs "
            f"{d.actual_growth:.1f}% historical – undervalued"
        )

    if d.upside_pct > 20:
        reasons.append(f"DCF suggests {d.upside_pct:.1f}% upside to median intrinsic value")

    if d.promoter_holding > 50:
        reasons.append(f"High promoter conviction – {d.promoter_holding:.1f}% stake")

    if 0.7 < d.beta < 1.1:
        reasons.append(f"Defensive beta of {d.beta:.2f} – low sensitivity to market swings")

    return reasons[:6] or ["Composite signal is positive but data coverage is limited"]


def _build_risks(d: InvestmentDecision, ratios: Dict) -> List[str]:
    risks = []

    if d.debt_equity > 1.5:
        risks.append(f"High debt/equity {d.debt_equity:.2f}x – elevated financial leverage")

    pledged = ratios.get("pledged_pct", 0.0)
    if pledged > 20:
        risks.append(f"Promoter pledging {pledged:.1f}% – risk of forced selling")

    if d.pe > 40:
        risks.append(f"Premium valuation P/E {d.pe:.1f}x – limited margin of safety")

    if d.rsi > 70:
        risks.append(f"Technically overbought RSI {d.rsi:.1f} – near-term pullback risk")
    elif d.rsi < 30:
        risks.append(f"Technically oversold RSI {d.rsi:.1f} – potential further downside")

    if d.f_score <= 3:
        risks.append(f"Weak F-Score {d.f_score}/9 – deteriorating fundamentals")

    if d.sales_growth < 0:
        risks.append(f"Revenue declining {d.sales_growth:.1f}% YoY – demand concerns")

    if d.profit_growth < -10:
        risks.append(f"Profit contracting {d.profit_growth:.1f}% YoY – margin pressure")

    if d.valuation_assessment == "EXPENSIVE" and d.implied_growth is not None:
        risks.append(
            f"Market prices in {d.implied_growth:.1f}% growth vs "
            f"{d.actual_growth:.1f}% historical – execution risk is high"
        )

    if "Stage 4" in d.trend_stage:
        risks.append("Stage 4 declining trend – stock technically in a downtrend")

    if d.beta > 1.5:
        risks.append(f"High beta {d.beta:.2f} – amplified drawdown in market corrections")

    return risks[:5] or ["Standard market, regulatory, and macro risks apply"]
