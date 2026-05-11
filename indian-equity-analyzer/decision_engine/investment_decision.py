"""
Investment Decision Engine.

Composite signal integrates:
  1. BharatQuant: Piotroski F-Score + Relative Strength + Trend stage  (35%)
  2. Monte Carlo DCF upside probability                                  (20%)
  3. Reverse DCF valuation gap                                          (15%)
  4. Accounting quality: Beneish M-Score + Altman Z + DuPont            (10%)
  5. Capital allocation: ROIC vs WACC + capex efficiency                (10%)
  6. Technical indicators: MACD + Bollinger + Stochastic + OBV          (5%)
  7. Institutional activity: block/bulk deals + FII/DII trend            (2%)
  8. Regulatory: ASM/GSM surveillance list flag                          (2%)
  9. News catalyst signal                                                (1%)

Per-signal weights sum to 1.0. Each sub-signal is normalised to [-1, +1].
Decision thresholds: ≥+0.6 STRONG_BUY | ≥+0.2 BUY | ≥-0.2 HOLD
                     ≥-0.6 AVOID       | <-0.6 STRONG_AVOID
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

# ── Composite scoring weights (must sum to 1.0) ─────────────────────────────
_W_QUANT    = 0.35   # F-Score + RS + Trend
_W_DCF      = 0.20   # Monte Carlo upside probability
_W_RDCF     = 0.15   # Reverse DCF gap
_W_ACCTG    = 0.10   # Accounting quality (Beneish + Altman + DuPont)
_W_CAPALLOC = 0.10   # Capital allocation (ROIC vs WACC)
_W_TECH     = 0.05   # Advanced technicals (MACD / BB / Stoch / OBV)
_W_INST     = 0.02   # Institutional activity
_W_REGUL    = 0.02   # Regulatory flag
_W_NEWS     = 0.01   # News catalyst


@dataclass
class InvestmentDecision:
    """Structured output of the full analysis pipeline."""

    symbol:        str
    decision:      str   = "HOLD"
    confidence:    int   = 50
    key_reasons:   List[str] = field(default_factory=list)
    risks:         List[str] = field(default_factory=list)
    target_price:  float = 0.0
    stop_loss:     float = 0.0
    position_size: str   = "None"
    time_horizon:  str   = "Medium"
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

    # Advanced analysis (new modules)
    beneish_m_score:       float = -2.5
    altman_z_score:        float = 3.0
    altman_zone:           str   = "SAFE"
    dupont:                Dict  = field(default_factory=dict)
    roic:                  float = 0.0
    roic_wacc_spread:      float = 0.0
    fcf_conversion:        float = 0.0
    ccc_days:              float = 0.0
    wc_trend:              str   = "STABLE"
    tech_signal:           str   = "NEUTRAL"
    atr:                   float = 0.0
    atr_pct:               float = 0.0
    macd_signal:           str   = "NEUTRAL"
    on_asm:                bool  = False
    on_gsm:                bool  = False
    fii_trend:             str   = "STABLE"
    dii_trend:             str   = "STABLE"
    bulk_deals:            List  = field(default_factory=list)
    earnings_surprise_trend: str = "UNKNOWN"
    days_to_next_result:   Optional[int] = None

    # Corporate actions & news
    corporate_actions: List[Dict] = field(default_factory=list)
    recent_news:       List[Dict] = field(default_factory=list)

    # Meta
    analyzed_at:     str   = field(default_factory=lambda: datetime.now().isoformat())
    composite_score: float = 0.0
    sub_scores:      Dict  = field(default_factory=dict)


class InvestmentDecisionEngine:
    """
    Orchestrates all analysis modules into a single structured decision.

    All new modules are optional — if not provided, their signal defaults to 0.0
    so the engine degrades gracefully.
    """

    def __init__(
        self,
        data_manager,
        fundamental_manager,
        screener,
        dcf_engine,
        reverse_dcf,
        news_monitor,
        db:                   Optional[AnalysisDatabase]    = None,
        tech_analyzer=None,
        accounting_analyzer=None,
        wc_analyzer=None,
        capital_allocator=None,
        inst_tracker=None,
        regulatory_monitor=None,
        earnings_calendar=None,
    ):
        self.data_mgr    = data_manager
        self.fund_mgr    = fundamental_manager
        self.screener    = screener
        self.dcf_engine  = dcf_engine
        self.rev_dcf     = reverse_dcf
        self.news        = news_monitor
        self._db         = db or AnalysisDatabase()

        # New optional modules
        self.tech        = tech_analyzer
        self.acctg       = accounting_analyzer
        self.wc          = wc_analyzer
        self.capalloc    = capital_allocator
        self.inst        = inst_tracker
        self.regul       = regulatory_monitor
        self.earnings    = earnings_calendar

    # ------------------------------------------------------------------
    # Main entry point
    # ------------------------------------------------------------------

    def analyze_stock(self, symbol: str) -> InvestmentDecision:
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
        f_r: Dict  = {}
        rs_r: Dict = {}
        tr_r: Dict = {}
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

            f_norm    = (d.f_score - 4.5) / 4.5
            rs_norm   = max(-1.0, min(1.0, d.rs_score / 30))
            trend_norm = {2: 1.0, 1: 0.0, 3: -0.3, 4: -1.0, 0: 0.0}.get(tr_r.get("stage", 0), 0.0)
            quant_norm = (f_norm + rs_norm + trend_norm) / 3

        except Exception as exc:
            logger.error("BharatQuant screen failed for %s: %s", symbol, exc)

        # ── 4. Beta + Monte Carlo DCF ──────────────────────────────────
        dcf_norm = 0.0
        wacc     = 0.12  # default; will be overwritten
        try:
            d.beta = self.data_mgr.calculate_beta(symbol)

            market_cap_cr = ratios.get("market_cap", 0.0) or d.current_price * 100
            de        = max(ratios.get("debt_equity", 0.0), 0.0)
            equity_cr = market_cap_cr
            debt_cr   = equity_cr * de

            wacc = self.dcf_engine.calculate_wacc(
                beta=d.beta, cost_of_debt=0.09, debt=debt_cr, equity=equity_cr,
            )

            cash_flows = statements.get("cash_flow", [])
            hist_fcf   = [float(r.get("free_cash_flow", 0) or 0) for r in cash_flows]

            if hist_fcf and any(f != 0 for f in hist_fcf) and d.current_price > 0:
                shares_cr = shares_cr_from_mktcap(market_cap_cr, d.current_price)
                mc = self.dcf_engine.run_monte_carlo(
                    historical_fcf=hist_fcf, wacc=wacc,
                    current_market_cap=market_cap_cr,
                    shares_outstanding=shares_cr, n_simulations=5_000,
                )
                d.dcf_median = mc.get("per_share_median", 0.0)
                d.dcf_p75    = mc.get("per_share_p75", 0.0)
                if d.current_price > 0 and d.dcf_median > 0:
                    d.upside_pct = (d.dcf_median - d.current_price) / d.current_price * 100
                prob_up  = mc.get("probability_of_upside", 50.0)
                dcf_norm = (prob_up - 50) / 50

        except Exception as exc:
            logger.error("Monte Carlo DCF failed for %s: %s", symbol, exc)

        # ── 5. Reverse DCF ─────────────────────────────────────────────
        rdcf_norm = 0.0
        try:
            rdcf = self.rev_dcf.compare_to_historical_growth(symbol, d.current_price)
            d.implied_growth       = rdcf.get("implied_growth")
            d.actual_growth        = max(
                rdcf.get("actual_sales_growth", 0.0),
                rdcf.get("actual_profit_growth", 0.0),
            )
            d.valuation_assessment = rdcf.get("assessment", "INDETERMINATE")
            rdcf_norm = {
                "CHEAP": 1.0, "FAIR": 0.0, "EXPENSIVE": -1.0, "INDETERMINATE": 0.0
            }.get(d.valuation_assessment, 0.0)
        except Exception as exc:
            logger.error("Reverse DCF failed for %s: %s", symbol, exc)

        # ── 6. Accounting quality ─────────────────────────────────────
        acctg_norm = 0.0
        try:
            if self.acctg is not None:
                aq = self.acctg.analyze(symbol, statements)
                d.beneish_m_score = aq.get("beneish_m_score", -2.5)
                d.altman_z_score  = aq.get("altman_z_score", 3.0)
                d.altman_zone     = aq.get("altman_zone", "SAFE")
                d.dupont          = aq.get("dupont", {})
                acctg_norm        = aq.get("quality_score", 0.0)
        except Exception as exc:
            logger.error("Accounting quality failed for %s: %s", symbol, exc)

        # ── 7. Capital allocation ─────────────────────────────────────
        capalloc_norm = 0.0
        try:
            if self.capalloc is not None:
                ca = self.capalloc.analyze(symbol, statements, wacc=wacc)
                d.roic             = ca.get("roic", 0.0)
                d.roic_wacc_spread = ca.get("roic_wacc_spread", 0.0)
                d.fcf_conversion   = ca.get("fcf_conversion", 0.0)
                capalloc_norm      = ca.get("ca_score", 0.0)
        except Exception as exc:
            logger.error("Capital allocation failed for %s: %s", symbol, exc)

        # ── 8. Working capital ────────────────────────────────────────
        try:
            if self.wc is not None:
                wc = self.wc.analyze(symbol, statements)
                d.ccc_days  = wc.get("latest", {}).get("ccc", 0.0)
                d.wc_trend  = wc.get("trend", "STABLE")
        except Exception as exc:
            logger.error("Working capital failed for %s: %s", symbol, exc)

        # ── 9. Advanced technicals ────────────────────────────────────
        tech_norm = 0.0
        try:
            if self.tech is not None:
                ti = self.tech.analyze(symbol)
                d.atr        = ti.get("atr", 0.0)
                d.atr_pct    = ti.get("atr_pct", 0.0)
                d.macd_signal = ti.get("macd_signal", "NEUTRAL")
                d.tech_signal = _tech_label(ti.get("composite_signal", 0.0))
                tech_norm     = ti.get("composite_signal", 0.0)
        except Exception as exc:
            logger.error("Technical indicators failed for %s: %s", symbol, exc)

        # ── 10. Institutional activity ────────────────────────────────
        inst_norm = 0.0
        try:
            if self.inst is not None:
                ia = self.inst.analyze(symbol, ratios)
                d.fii_trend   = ia.get("fii_trend", "STABLE")
                d.dii_trend   = ia.get("dii_trend", "STABLE")
                d.bulk_deals  = ia.get("bulk_deals", [])
                inst_norm     = ia.get("net_institutional_signal", 0.0)
        except Exception as exc:
            logger.error("Institutional activity failed for %s: %s", symbol, exc)

        # ── 11. Regulatory monitoring ─────────────────────────────────
        regul_norm = 0.0
        try:
            if self.regul is not None:
                rg = self.regul.analyze(symbol)
                d.on_asm   = rg.get("on_asm", False)
                d.on_gsm   = rg.get("on_gsm", False)
                regul_norm = rg.get("regulatory_score", 0.0)
        except Exception as exc:
            logger.error("Regulatory monitor failed for %s: %s", symbol, exc)

        # ── 12. Earnings calendar ─────────────────────────────────────
        try:
            if self.earnings is not None:
                ec = self.earnings.analyze(symbol, statements)
                d.earnings_surprise_trend = ec.get("surprise_trend", "UNKNOWN")
                d.days_to_next_result     = ec.get("days_to_next_result")
        except Exception as exc:
            logger.error("Earnings calendar failed for %s: %s", symbol, exc)

        # ── 13. News signal ───────────────────────────────────────────
        news_norm = 0.0
        try:
            d.corporate_actions = self.news.get_corporate_actions(symbol)
            d.recent_news       = self.news.fetch_news(symbol=symbol, days=7, min_impact=4)[:5]
            if d.recent_news:
                sentiments = [n.get("sentiment", "neutral") for n in d.recent_news[:3]]
                pos = sentiments.count("positive")
                neg = sentiments.count("negative")
                news_norm = 0.5 if pos > neg else (-0.5 if neg > pos else 0.0)
        except Exception as exc:
            logger.error("News fetch failed for %s: %s", symbol, exc)

        # ── 14. Sector-relative PE (baked into quant, kept for display) ──
        sector_pe_norm = 0.0
        try:
            if 1 < d.pe < 200:
                nifty_pe   = 22.0
                premium    = (d.pe - nifty_pe) / nifty_pe
                sector_pe_norm = max(-1.0, min(1.0, -premium))
        except Exception:
            pass

        # ── 15. Composite score ───────────────────────────────────────
        composite = (
            _W_QUANT    * quant_norm
            + _W_DCF      * dcf_norm
            + _W_RDCF     * rdcf_norm
            + _W_ACCTG    * acctg_norm
            + _W_CAPALLOC * capalloc_norm
            + _W_TECH     * tech_norm
            + _W_INST     * inst_norm
            + _W_REGUL    * regul_norm
            + _W_NEWS     * news_norm
        )
        d.composite_score = round(composite, 4)
        d.sub_scores = {
            "quant":     round(quant_norm, 4),
            "dcf":       round(dcf_norm, 4),
            "rdcf":      round(rdcf_norm, 4),
            "acctg":     round(acctg_norm, 4),
            "capalloc":  round(capalloc_norm, 4),
            "tech":      round(tech_norm, 4),
            "inst":      round(inst_norm, 4),
            "regul":     round(regul_norm, 4),
            "news":      round(news_norm, 4),
        }

        # Map score → decision
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

        # Override: hard block if on ASM/GSM
        if d.on_asm or d.on_gsm:
            d.decision    = "STRONG_AVOID"
            d.position_size = "None"
            d.confidence  = 95
            d.key_reasons = ["SEBI surveillance list (ASM/GSM) – DO NOT BUY"]
            d.risks       = ["Regulatory risk is extremely high; forced exits possible"]
        else:
            # Target from DCF p75; ATR-based stop if available
            if d.atr > 0 and d.current_price > 0:
                d.stop_loss = round(d.current_price - 2.0 * d.atr, 2)
            else:
                d.stop_loss = round(d.current_price * 0.85, 2)
            d.target_price = d.dcf_p75 if d.dcf_p75 > 0 else round(d.current_price * 1.15, 2)

            d.key_reasons = _build_reasons(d, f_r, rs_r, tr_r)
            d.risks       = _build_risks(d, ratios)

        logger.info(
            "◀ %s → %s  confidence=%d%%  composite=%.4f  beta=%.3f",
            symbol, d.decision, d.confidence, composite, d.beta,
        )

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
        next_result = f"{d.days_to_next_result}d" if d.days_to_next_result is not None else "Unknown"

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

        dupont_roe  = d.dupont.get("roe", 0.0)
        dupont_nm   = d.dupont.get("net_margin", 0.0)
        dupont_at   = d.dupont.get("asset_turnover", 0.0)
        dupont_em   = d.dupont.get("equity_multiplier", 1.0)

        asm_flag    = "⚠ YES – HIGH RISK" if d.on_asm else "No"
        gsm_flag    = "⚠ YES – HIGH RISK" if d.on_gsm else "No"

        sub_str = "  ".join(
            f"{k.upper()}={v:+.3f}" for k, v in d.sub_scores.items()
        )

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
Stop Loss:      ₹{d.stop_loss:,.2f}   (2× ATR: {d.atr:.2f})
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

{thin}
VALUATION:
{thin}
Monte Carlo Median:    ₹{d.dcf_median:,.2f}  (upside {d.upside_pct:+.1f}%)
Implied Growth:        {ig}
Actual Growth:         {d.actual_growth:.1f}%
Assessment:            {d.valuation_assessment}
ROIC:                  {d.roic:.1f}%  (WACC spread {d.roic_wacc_spread:+.1f}%)
FCF Conversion:        {d.fcf_conversion:.2f}x

{thin}
ACCOUNTING QUALITY:
{thin}
Beneish M-Score:       {d.beneish_m_score:.3f}  ({'MANIPULATION RISK' if d.beneish_m_score > -1.78 else 'CLEAN'})
Altman Z-Score:        {d.altman_z_score:.3f}  ({d.altman_zone})
DuPont (ROE={dupont_roe:.1f}%): NM {dupont_nm:.1f}% × AT {dupont_at:.3f}× × EM {dupont_em:.2f}×

{thin}
TECHNICAL SNAPSHOT:
{thin}
Trend Stage:   {d.trend_stage}
50 DMA:        ₹{d.ma50:,.2f}
200 DMA:       ₹{d.ma200:,.2f}
RSI (14):      {d.rsi:.1f}
Beta (3Y):     {d.beta:.3f}
ATR:           ₹{d.atr:.2f}  ({d.atr_pct:.1f}% of price)
MACD:          {d.macd_signal}
Tech Signal:   {d.tech_signal}
RS Score:      {d.rs_score:+.1f}% vs Nifty

{thin}
WORKING CAPITAL:
{thin}
Cash Conversion Cycle: {d.ccc_days:.0f} days  (trend: {d.wc_trend})

{thin}
INSTITUTIONAL & REGULATORY:
{thin}
FII Trend:     {d.fii_trend}
DII Trend:     {d.dii_trend}
Bulk Deals:    {len(d.bulk_deals)} in last 90 days
On ASM List:   {asm_flag}
On GSM List:   {gsm_flag}
Earnings Surprise: {d.earnings_surprise_trend}
Next Result:   {next_result}

{thin}
RECENT CORPORATE ACTIONS:
{thin}
{ca_text}

{thin}
RECENT NEWS:
{thin}
{news_text}

{thin}
COMPOSITE SCORE BREAKDOWN:
{thin}
{sub_str}

{sep}
Report generated: {d.analyzed_at[:19]}
Composite Score:  {d.composite_score:+.4f}
{sep}
""".strip()

    # ------------------------------------------------------------------
    # Decision history
    # ------------------------------------------------------------------

    def get_decision_history(self, symbol: str, limit: int = 10) -> List[Dict]:
        return self._db.get_decision_history(symbol, limit)


# ------------------------------------------------------------------
# Helper functions
# ------------------------------------------------------------------

def _tech_label(score: float) -> str:
    if score >= 0.5:
        return "STRONG_BULLISH"
    if score >= 0.2:
        return "BULLISH"
    if score <= -0.5:
        return "STRONG_BEARISH"
    if score <= -0.2:
        return "BEARISH"
    return "NEUTRAL"


def _build_reasons(d: InvestmentDecision, f_r: Dict, rs_r: Dict, tr_r: Dict) -> List[str]:
    reasons = []

    if d.f_score >= 7:
        reasons.append(f"Strong Piotroski F-Score {d.f_score}/9 – excellent financial health")
    elif d.f_score >= 5:
        reasons.append(f"Solid Piotroski F-Score {d.f_score}/9 – above-average quality")

    if d.rs_score > 10:
        reasons.append(f"Outperforming Nifty by {d.rs_score:.1f}% – strong momentum")
    elif d.rs_score > 0:
        reasons.append(f"Marginally outperforming Nifty (+{d.rs_score:.1f}%)")

    if tr_r.get("stage") == 2:
        reasons.append("Stage 2 Advancing trend – golden cross active")

    if d.sales_growth > 20:
        reasons.append(f"Revenue growing {d.sales_growth:.1f}% YoY – above-market pace")

    if d.profit_growth > 20:
        reasons.append(f"Profit growth {d.profit_growth:.1f}% YoY – strong operating leverage")

    if d.roe > 18:
        reasons.append(f"High ROE {d.roe:.1f}% – capital deployed efficiently")

    if d.roce > 20:
        reasons.append(f"ROCE {d.roce:.1f}% above cost of capital – value creating")

    if d.roic_wacc_spread > 5:
        reasons.append(f"ROIC {d.roic:.1f}% well above WACC (spread {d.roic_wacc_spread:+.1f}%) – value creator")

    if d.beneish_m_score < -2.5:
        reasons.append(f"Clean Beneish M-Score {d.beneish_m_score:.2f} – no earnings manipulation")

    if d.altman_zone == "SAFE":
        reasons.append(f"Altman Z {d.altman_z_score:.2f} – low bankruptcy risk")

    if d.valuation_assessment == "CHEAP" and d.implied_growth is not None:
        reasons.append(
            f"Market prices in only {d.implied_growth:.1f}% growth vs "
            f"{d.actual_growth:.1f}% historical – undervalued"
        )

    if d.upside_pct > 20:
        reasons.append(f"DCF suggests {d.upside_pct:.1f}% upside to intrinsic value")

    if d.promoter_holding > 50:
        reasons.append(f"High promoter conviction – {d.promoter_holding:.1f}% stake")

    if d.fii_trend == "BUYING":
        reasons.append("FII net buying – institutional accumulation signal")

    if d.earnings_surprise_trend == "CONSISTENT_BEAT":
        reasons.append("Consistent earnings beats – management track record strong")

    if d.macd_signal == "BULLISH_STRONG":
        reasons.append("MACD momentum building – strong bullish crossover")

    return reasons[:8] or ["Composite signal is positive but data coverage is limited"]


def _build_risks(d: InvestmentDecision, ratios: Dict) -> List[str]:
    risks = []

    if d.debt_equity > 1.5:
        risks.append(f"High debt/equity {d.debt_equity:.2f}x – elevated leverage")

    pledged = ratios.get("pledged_pct", 0.0)
    if pledged > 20:
        risks.append(f"Promoter pledging {pledged:.1f}% – forced selling risk")

    if d.pe > 40:
        risks.append(f"Premium P/E {d.pe:.1f}x – limited margin of safety")

    if d.beneish_m_score > -1.78:
        risks.append(f"Beneish M-Score {d.beneish_m_score:.2f} > -1.78 – EARNINGS MANIPULATION RISK")

    if d.altman_zone == "DISTRESS":
        risks.append(f"Altman Z {d.altman_z_score:.2f} – FINANCIAL DISTRESS ZONE")
    elif d.altman_zone == "GREY":
        risks.append(f"Altman Z {d.altman_z_score:.2f} – grey zone, monitor leverage")

    if d.roic_wacc_spread < -5:
        risks.append(f"ROIC {d.roic:.1f}% well below WACC – value destruction")

    if d.rsi > 70:
        risks.append(f"Technically overbought RSI {d.rsi:.1f}")
    elif d.rsi < 30:
        risks.append(f"Technically oversold RSI {d.rsi:.1f} – potential further downside")

    if d.f_score <= 3:
        risks.append(f"Weak F-Score {d.f_score}/9 – deteriorating fundamentals")

    if d.sales_growth < 0:
        risks.append(f"Revenue declining {d.sales_growth:.1f}% YoY")

    if d.profit_growth < -10:
        risks.append(f"Profit contracting {d.profit_growth:.1f}% YoY")

    if d.valuation_assessment == "EXPENSIVE" and d.implied_growth is not None:
        risks.append(
            f"Market prices in {d.implied_growth:.1f}% growth vs "
            f"{d.actual_growth:.1f}% historical – execution risk"
        )

    if "Stage 4" in d.trend_stage:
        risks.append("Stage 4 declining trend – avoid new positions")

    if d.beta > 1.5:
        risks.append(f"High beta {d.beta:.2f} – amplified drawdown in corrections")

    if d.wc_trend == "DETERIORATING":
        risks.append(f"Working capital cycle deteriorating (CCC {d.ccc_days:.0f}d)")

    if d.fii_trend == "SELLING":
        risks.append("FII net selling – institutional distribution underway")

    if d.earnings_surprise_trend == "CONSISTENT_MISS":
        risks.append("Consistent earnings misses – management guidance credibility at risk")

    if d.macd_signal == "BEARISH_STRONG":
        risks.append("MACD bearish momentum accelerating")

    return risks[:7] or ["Standard market, regulatory, and macro risks apply"]
