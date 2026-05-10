"""
Investment Decision Engine.
Combines Piotroski F-Score, Monte Carlo DCF, Reverse DCF, and news signals
into a single structured STRONG_BUY → STRONG_AVOID recommendation.
"""
import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

DECISION_LABELS = ["STRONG_BUY", "BUY", "HOLD", "AVOID", "STRONG_AVOID"]


@dataclass
class InvestmentDecision:
    """Structured output of a full stock analysis."""

    symbol: str
    decision: str  # STRONG_BUY / BUY / HOLD / AVOID / STRONG_AVOID
    confidence: int  # 0-100
    key_reasons: List[str] = field(default_factory=list)
    risks: List[str] = field(default_factory=list)
    target_price: float = 0.0
    stop_loss: float = 0.0
    position_size: str = "None"   # Full / Half / Quarter / None
    time_horizon: str = "Medium"  # Short / Medium / Long
    current_price: float = 0.0

    # Snapshot data (populated by engine)
    pe: float = 0.0
    pb: float = 0.0
    roe: float = 0.0
    roce: float = 0.0
    debt_equity: float = 0.0
    promoter_holding: float = 0.0
    fii_holding: float = 0.0
    sales_growth: float = 0.0
    profit_growth: float = 0.0
    f_score: int = 0
    rs_score: float = 0.0
    trend_stage: str = "Unknown"
    ma50: float = 0.0
    ma200: float = 0.0
    rsi: float = 50.0

    # Valuation
    dcf_median: float = 0.0
    dcf_p75: float = 0.0
    upside_pct: float = 0.0
    implied_growth: Optional[float] = None
    actual_growth: float = 0.0
    valuation_assessment: str = "INDETERMINATE"

    # Corporate actions and news
    corporate_actions: List[Dict] = field(default_factory=list)
    recent_news: List[Dict] = field(default_factory=list)

    # Meta
    analyzed_at: str = field(default_factory=lambda: datetime.now().isoformat())
    composite_score: float = 0.0


class InvestmentDecisionEngine:
    """
    Orchestrates all analysis modules and produces an :class:`InvestmentDecision`.

    Composite scoring weights:
      BharatQuant screen   → normalised bull points  (−2 … +2)
      Monte Carlo DCF      → upside signal            (−1 … +1)
      Reverse DCF          → growth gap               (−1 … +1)
      News / Catalysts     → impact signal             (−0.5 … +0.5)
    """

    def __init__(
        self,
        data_manager,
        fundamental_manager,
        screener,
        dcf_engine,
        reverse_dcf,
        news_monitor,
    ):
        self.data_mgr = data_manager
        self.fund_mgr = fundamental_manager
        self.screener = screener
        self.dcf_engine = dcf_engine
        self.reverse_dcf = reverse_dcf
        self.news_monitor = news_monitor

    # ------------------------------------------------------------------
    # Main entry point
    # ------------------------------------------------------------------

    def analyze_stock(self, symbol: str) -> InvestmentDecision:
        """
        Run the complete analysis pipeline for *symbol*.

        Steps:
          1. Live quote (current price, sector, valuation multiples).
          2. Fundamental data (ratios, statements).
          3. BharatQuant screen (F-Score, RS, Trend).
          4. Monte Carlo DCF valuation.
          5. Reverse DCF implied growth comparison.
          6. News / corporate action scan.
          7. Composite scoring → decision.

        Returns:
            :class:`InvestmentDecision` with all fields populated.
        """
        logger.info("Starting full analysis for %s", symbol)
        decision = InvestmentDecision(symbol=symbol)

        # ---- 1. Live quote ----
        try:
            quote = self.data_mgr.get_live_quote(symbol)
            decision.current_price = quote.get("last_price", 0.0)
            logger.info("%s current price: ₹%.2f", symbol, decision.current_price)
        except Exception as exc:
            logger.error("Live quote failed for %s: %s", symbol, exc)

        # ---- 2. Fundamental data ----
        ratios: Dict[str, Any] = {}
        growth: Dict[str, Any] = {}
        statements: Dict[str, Any] = {}
        try:
            ratios = self.fund_mgr.get_key_ratios(symbol)
            growth = self.fund_mgr.get_growth_metrics(symbol)
            statements = self.fund_mgr.get_financial_statements(symbol)

            decision.pe = ratios.get("pe", 0.0)
            decision.pb = ratios.get("pb", 0.0)
            decision.roe = ratios.get("roe", 0.0)
            decision.roce = ratios.get("roce", 0.0)
            decision.debt_equity = ratios.get("debt_equity", 0.0)
            decision.promoter_holding = ratios.get("promoter_holding", 0.0)
            decision.fii_holding = ratios.get("fii_holding", 0.0)
            decision.sales_growth = growth.get("sales_growth_yoy", 0.0)
            decision.profit_growth = growth.get("profit_growth_yoy", 0.0)
        except Exception as exc:
            logger.error("Fundamental fetch failed for %s: %s", symbol, exc)

        # ---- 3. BharatQuant screen ----
        bull_points = 0
        try:
            f_result = self.screener.calculate_piotroski_f_score(symbol)
            rs_result = self.screener.calculate_relative_strength(symbol)
            trend_result = self.screener.detect_trend_stage(symbol)

            decision.f_score = f_result.get("score", 0)
            decision.rs_score = rs_result.get("rs_score", 0.0)
            decision.trend_stage = trend_result.get("stage_name", "Unknown")
            decision.ma50 = trend_result.get("ma50", 0.0)
            decision.ma200 = trend_result.get("ma200", 0.0)
            decision.rsi = trend_result.get("rsi", 50.0)

            # Bull points (same logic as screener)
            if decision.rs_score > 0:
                bull_points += 1
            if decision.f_score >= 7:
                bull_points += 1
            if decision.sales_growth > 20:
                bull_points += 1
            if decision.profit_growth > 20:
                bull_points += 1
            if decision.roe > 15:
                bull_points += 1
            if trend_result.get("stage") == 2:
                bull_points += 1
            if decision.f_score <= 3:
                bull_points -= 2
            if decision.sales_growth < 0:
                bull_points -= 1
            if decision.profit_growth < 0:
                bull_points -= 1
            if decision.debt_equity > 2:
                bull_points -= 1
        except Exception as exc:
            logger.error("BharatQuant screen failed for %s: %s", symbol, exc)

        # ---- 4. Monte Carlo DCF ----
        mc_result: Dict[str, Any] = {}
        dcf_signal = 0.0
        try:
            cash_flows = statements.get("cash_flow", [])
            hist_fcf = [float(r.get("free_cash_flow", 0) or 0) for r in cash_flows]
            market_cap = ratios.get("market_cap", 0.0) or (
                decision.current_price * 100  # rough estimate in crore
            )
            de = ratios.get("debt_equity", 0.5)
            equity_est = market_cap
            debt_est = equity_est * de
            wacc = self.dcf_engine.calculate_wacc(
                beta=1.0, cost_of_debt=0.09, debt=debt_est, equity=equity_est
            )

            if hist_fcf and any(f != 0 for f in hist_fcf):
                shares = market_cap / decision.current_price if decision.current_price > 0 else 1.0
                mc_result = self.dcf_engine.run_monte_carlo(
                    historical_fcf=hist_fcf,
                    wacc=wacc,
                    current_market_cap=market_cap,
                    shares_outstanding=shares,
                    n_simulations=5000,  # reduced for speed in single-stock mode
                )
                decision.dcf_median = mc_result.get("per_share_median", 0.0)
                decision.dcf_p75 = mc_result.get("per_share_p75", 0.0)

                if decision.current_price > 0 and decision.dcf_median > 0:
                    decision.upside_pct = (
                        (decision.dcf_median - decision.current_price)
                        / decision.current_price * 100
                    )

                prob_up = mc_result.get("probability_of_upside", 50.0)
                if prob_up > 65:
                    dcf_signal = 1.0
                elif prob_up > 50:
                    dcf_signal = 0.5
                elif prob_up < 35:
                    dcf_signal = -1.0
                elif prob_up < 50:
                    dcf_signal = -0.5

        except Exception as exc:
            logger.error("Monte Carlo DCF failed for %s: %s", symbol, exc)

        # ---- 5. Reverse DCF ----
        rdcf_signal = 0.0
        try:
            rdcf = self.reverse_dcf.compare_to_historical_growth(
                symbol, decision.current_price
            )
            decision.implied_growth = rdcf.get("implied_growth")
            decision.actual_growth = max(
                rdcf.get("actual_sales_growth", 0.0),
                rdcf.get("actual_profit_growth", 0.0),
            )
            decision.valuation_assessment = rdcf.get("assessment", "INDETERMINATE")

            if rdcf["assessment"] == "CHEAP":
                rdcf_signal = 1.0
            elif rdcf["assessment"] == "FAIR":
                rdcf_signal = 0.0
            elif rdcf["assessment"] == "EXPENSIVE":
                rdcf_signal = -1.0
        except Exception as exc:
            logger.error("Reverse DCF failed for %s: %s", symbol, exc)

        # ---- 6. News & Corporate Actions ----
        news_signal = 0.0
        try:
            decision.corporate_actions = self.news_monitor.get_corporate_actions(symbol)
            decision.recent_news = self.news_monitor.fetch_news(
                symbol=symbol, days=7, min_impact=4
            )[:5]

            if decision.recent_news:
                top_impact = decision.recent_news[0]["impact_score"]
                if top_impact >= 8:
                    # Check for negative vs positive keywords
                    title = decision.recent_news[0]["title"].lower()
                    negative_kw = ["default", "fraud", "penalty", "npa", "raid", "investigation"]
                    news_signal = -0.5 if any(k in title for k in negative_kw) else 0.5
        except Exception as exc:
            logger.error("News fetch failed for %s: %s", symbol, exc)

        # ---- 7. Composite score → Decision ----
        # Normalise bull_points to [-2, +2] range
        quant_signal = max(-2.0, min(2.0, bull_points / 3.0))
        composite = quant_signal + dcf_signal + rdcf_signal + news_signal
        decision.composite_score = round(composite, 3)

        if composite >= 1.5:
            decision.decision = "STRONG_BUY"
            decision.confidence = min(95, 85 + int((composite - 1.5) * 10))
            decision.position_size = "Full"
            decision.time_horizon = "Long"
        elif composite >= 0.5:
            decision.decision = "BUY"
            decision.confidence = min(80, 65 + int((composite - 0.5) * 15))
            decision.position_size = "Half"
            decision.time_horizon = "Medium"
        elif composite >= -0.5:
            decision.decision = "HOLD"
            decision.confidence = 50
            decision.position_size = "Quarter"
            decision.time_horizon = "Medium"
        elif composite >= -1.5:
            decision.decision = "AVOID"
            decision.confidence = min(80, 65 + int((-composite - 0.5) * 15))
            decision.position_size = "None"
            decision.time_horizon = "Short"
        else:
            decision.decision = "STRONG_AVOID"
            decision.confidence = min(95, 85 + int((-composite - 1.5) * 10))
            decision.position_size = "None"
            decision.time_horizon = "Short"

        # Target price from DCF p75; stop loss 15% below current
        decision.target_price = decision.dcf_p75 if decision.dcf_p75 > 0 else (
            decision.current_price * 1.15
        )
        decision.stop_loss = round(decision.current_price * 0.85, 2)

        # Build reasons and risks
        decision.key_reasons = self._build_reasons(decision, f_result, rs_result, trend_result)
        decision.risks = self._build_risks(decision, ratios)

        logger.info(
            "%s → %s (confidence %d%%, composite %.2f)",
            symbol, decision.decision, decision.confidence, composite,
        )
        return decision

    # ------------------------------------------------------------------
    # Report generator
    # ------------------------------------------------------------------

    def generate_report(self, decision: InvestmentDecision) -> str:
        """
        Format an :class:`InvestmentDecision` into the canonical text report.
        """
        sep = "=" * 64
        thin = "-" * 64

        ig = (
            f"{decision.implied_growth:.1f}%"
            if decision.implied_growth is not None else "N/A"
        )
        ca_text = (
            "\n".join(
                f"  {a['action_type']} – Ex-date: {a['ex_date']}  {a['details']}"
                for a in decision.corporate_actions[:3]
            ) or "  None in recent history"
        )
        news_text = (
            "\n".join(
                f"  [{n['impact_score']}/10] {n['title'][:75]}"
                f"  ({n['source']})"
                for n in decision.recent_news[:3]
            ) or "  No high-impact news in last 7 days"
        )

        reasons = "\n".join(
            f"{i + 1}. {r}" for i, r in enumerate(decision.key_reasons)
        ) or "  Insufficient data for reasons"
        risks = "\n".join(
            f"{i + 1}. {r}" for i, r in enumerate(decision.risks)
        ) or "  Insufficient data for risks"

        report = f"""
{sep}
INVESTMENT DECISION REPORT: {decision.symbol}
{sep}

DECISION: {decision.decision}
CONFIDENCE: {decision.confidence}%

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
Current Price:  ₹{decision.current_price:,.2f}
Target Price:   ₹{decision.target_price:,.2f}
Stop Loss:      ₹{decision.stop_loss:,.2f}
Position Size:  {decision.position_size}
Time Horizon:   {decision.time_horizon}

{thin}
FUNDAMENTAL SNAPSHOT:
{thin}
P/E Ratio:             {decision.pe:.1f}
P/B Ratio:             {decision.pb:.2f}
ROE:                   {decision.roe:.1f}%
ROCE:                  {decision.roce:.1f}%
Debt/Equity:           {decision.debt_equity:.2f}
Promoter Holding:      {decision.promoter_holding:.1f}%
FII Holding:           {decision.fii_holding:.1f}%
Sales Growth (YoY):    {decision.sales_growth:.1f}%
Profit Growth (YoY):   {decision.profit_growth:.1f}%
F-Score:               {decision.f_score}/9
RS Score:              {decision.rs_score:+.1f}% vs Nifty

{thin}
VALUATION ANALYSIS:
{thin}
Monte Carlo Median Value: ₹{decision.dcf_median:,.2f}
Upside Potential:         {decision.upside_pct:+.1f}%
Implied Growth (Market):  {ig}
Actual Growth (Hist.):    {decision.actual_growth:.1f}%
Valuation Assessment:     {decision.valuation_assessment}

{thin}
TECHNICAL SNAPSHOT:
{thin}
Trend Stage:  {decision.trend_stage}
50 DMA:       ₹{decision.ma50:,.2f}
200 DMA:      ₹{decision.ma200:,.2f}
RSI (14):     {decision.rsi:.1f}

{thin}
RECENT CORPORATE ACTIONS:
{thin}
{ca_text}

{thin}
RECENT NEWS:
{thin}
{news_text}

{sep}
Report generated: {decision.analyzed_at[:19]}
Composite Score:  {decision.composite_score:+.3f}
{sep}
""".strip()

        return report

    # ------------------------------------------------------------------
    # Reason / Risk builders
    # ------------------------------------------------------------------

    @staticmethod
    def _build_reasons(
        d: InvestmentDecision,
        f_result: Dict,
        rs_result: Dict,
        trend_result: Dict,
    ) -> List[str]:
        reasons = []

        if d.f_score >= 7:
            reasons.append(
                f"Strong Piotroski F-Score of {d.f_score}/9 signals excellent financial health"
            )
        elif d.f_score >= 5:
            reasons.append(f"Solid Piotroski F-Score of {d.f_score}/9 – above average quality")

        if d.rs_score > 10:
            reasons.append(
                f"Outperforming Nifty by {d.rs_score:.1f}% over last year – strong relative strength"
            )
        elif d.rs_score > 0:
            reasons.append(f"Marginally outperforming Nifty (+{d.rs_score:.1f}%) in last 12 months")

        if trend_result.get("stage") == 2:
            reasons.append("Stage 2 Advancing trend – price above 50-DMA with golden cross active")

        if d.sales_growth > 20:
            reasons.append(f"Revenue growing at {d.sales_growth:.1f}% YoY – above-market pace")
        elif d.sales_growth > 10:
            reasons.append(f"Healthy revenue growth of {d.sales_growth:.1f}% YoY")

        if d.profit_growth > 20:
            reasons.append(f"Profit growth of {d.profit_growth:.1f}% YoY demonstrates operational leverage")

        if d.roe > 18:
            reasons.append(f"High ROE of {d.roe:.1f}% – strong capital efficiency")

        if d.valuation_assessment == "CHEAP":
            reasons.append(
                f"Reverse DCF: market implies only {d.implied_growth:.1f}% growth vs "
                f"{d.actual_growth:.1f}% historical – stock appears undervalued"
            )

        if d.upside_pct > 20:
            reasons.append(
                f"Monte Carlo DCF suggests {d.upside_pct:.1f}% upside to median intrinsic value"
            )

        if d.promoter_holding > 50:
            reasons.append(f"High promoter conviction – {d.promoter_holding:.1f}% holding")

        return reasons[:6] or ["Composite signal is positive but reasons are data-limited"]

    @staticmethod
    def _build_risks(d: InvestmentDecision, ratios: Dict) -> List[str]:
        risks = []

        if d.debt_equity > 1.5:
            risks.append(
                f"High debt/equity ratio of {d.debt_equity:.2f}x – elevated financial leverage"
            )

        pledged = ratios.get("pledged_pct", 0.0)
        if pledged > 20:
            risks.append(f"Promoter pledging at {pledged:.1f}% – risk of forced selling")

        if d.pe > 40:
            risks.append(
                f"Premium valuation (P/E {d.pe:.1f}x) leaves little margin of safety"
            )

        if d.rsi > 70:
            risks.append(f"Technically overbought (RSI {d.rsi:.1f}) – pullback risk near-term")
        elif d.rsi < 30:
            risks.append(f"Technically oversold (RSI {d.rsi:.1f}) – potential further downside")

        if d.f_score <= 3:
            risks.append(f"Weak F-Score ({d.f_score}/9) signals deteriorating fundamentals")

        if d.sales_growth < 0:
            risks.append(f"Revenue declining {d.sales_growth:.1f}% YoY – demand concerns")

        if d.profit_growth < -10:
            risks.append(f"Profit contraction of {d.profit_growth:.1f}% YoY – margin pressure")

        if d.valuation_assessment == "EXPENSIVE":
            risks.append(
                f"Market pricing in {d.implied_growth:.1f}% growth vs "
                f"{d.actual_growth:.1f}% historical – execution risk"
            )

        if "Stage 4" in d.trend_stage:
            risks.append("Stage 4 declining trend – technically in a downtrend")

        return risks[:5] or ["Standard market, regulatory, and macro risks apply"]
