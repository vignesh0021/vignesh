"""
Indian Equity Analyzer – Main Orchestrator
==========================================

Integrates all analysis modules:
  - Historical/live data (Jugaad-Data / NSEPython / yfinance)
  - Fundamentals via Screener.in
  - BharatQuant screening (Piotroski F-Score, RS, Weinstein)
  - Monte Carlo + Reverse DCF valuation
  - Accounting quality (Beneish M-Score, Altman Z, DuPont)
  - Capital allocation quality (ROIC vs WACC)
  - Working capital cycle analysis
  - Advanced technicals (ATR, MACD, Bollinger, Stochastic, OBV)
  - Institutional activity (block/bulk deals, FII/DII flow)
  - Regulatory monitoring (ASM/GSM surveillance)
  - Earnings calendar and surprise tracking
  - News/RSS sentiment monitor
  - Strategy backtesting with walk-forward analysis
  - Portfolio risk (Kelly, ATR sizing, VaR, Sharpe/Sortino)
  - SQLite-backed decision persistence

Usage:
    python main.py

Programmatic:
    from main import IndianEquityAnalyzer
    analyzer = IndianEquityAnalyzer()
    print(analyzer.full_analysis("RELIANCE"))
"""
import json
import logging
import sys
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from typing import List, Optional

import pandas as pd

# ── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)-30s  %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("./data/analyzer.log", mode="a"),
    ],
)
logger = logging.getLogger("IndianEquityAnalyzer")

# ── Core module imports ───────────────────────────────────────────────────────
from data_collection.historical_data import HistoricalDataManager
from data_collection.live_data import LiveDataManager
from fundamental_data.jufinance_adapter import FundamentalDataManager
from screening.bharatquant_adapter import BharatQuantScreener
from valuation.dcf_engine import MonteCarloDCF
from valuation.reverse_dcf import ReverseDCF
from monitoring.news_monitor import IndianStockMonitor
from decision_engine.investment_decision import InvestmentDecisionEngine
from utils.database import AnalysisDatabase

# ── New analysis module imports ───────────────────────────────────────────────
from analysis.technical_indicators import TechnicalAnalyzer
from analysis.accounting_quality import AccountingQualityAnalyzer
from analysis.working_capital import WorkingCapitalAnalyzer
from analysis.capital_allocation import CapitalAllocationAnalyzer
from analysis.institutional_activity import InstitutionalActivityTracker
from monitoring.earnings_calendar import EarningsCalendar
from monitoring.regulatory_monitor import RegulatoryMonitor
from backtesting.strategy_backtester import StrategyBacktester
from risk.portfolio_risk import PortfolioRiskManager


def _load_config() -> dict:
    cfg_path = Path(__file__).parent / "config" / "india_market_params.json"
    try:
        with cfg_path.open() as f:
            return json.load(f).get("india", {})
    except Exception as exc:
        logger.warning("Config load failed (%s). Using defaults.", exc)
        return {
            "risk_free_rate": 0.07,
            "market_risk_premium": 0.08,
            "tax_rate": 0.25,
            "terminal_growth_rate": 0.04,
        }


class IndianEquityAnalyzer:
    """
    Top-level façade wiring together all analysis modules.

    Public methods:
      full_analysis(symbol)          → str  (formatted report)
      screen_universe(symbols)       → pd.DataFrame (ranked)
      monitor_portfolio(portfolio)   → str  (daily briefing)
      get_decision_history(symbol)   → list (past decisions)
      backtest(symbol)               → dict (backtest results)
      portfolio_risk(symbols)        → dict (risk metrics)
      portfolio_kelly(symbol, ...)   → dict (position sizing)
    """

    _SCREEN_WORKERS = 5

    def __init__(self):
        cfg = _load_config()
        logger.info("Initialising Indian Equity Analyzer…")

        self._db       = AnalysisDatabase("./data/market.db")

        self.data_mgr  = HistoricalDataManager(cache_dir="./data/historical")
        self.live_mgr  = LiveDataManager()
        self.fund_mgr  = FundamentalDataManager(cache_dir="./data/fundamentals", db=self._db)

        self.screener  = BharatQuantScreener(
            data_manager=self.data_mgr,
            fundamental_manager=self.fund_mgr,
        )

        self.dcf_engine = MonteCarloDCF(
            risk_free_rate       = cfg.get("risk_free_rate", 0.07),
            market_risk_premium  = cfg.get("market_risk_premium", 0.08),
            tax_rate             = cfg.get("tax_rate", 0.25),
            terminal_growth_rate = cfg.get("terminal_growth_rate", 0.04),
        )
        self.reverse_dcf = ReverseDCF(
            fundamental_manager = self.fund_mgr,
            risk_free_rate      = cfg.get("risk_free_rate", 0.07),
            market_risk_premium = cfg.get("market_risk_premium", 0.08),
            tax_rate            = cfg.get("tax_rate", 0.25),
        )

        self.news_monitor = IndianStockMonitor(live_data_manager=self.live_mgr)

        # ── New analysis modules ────────────────────────────────────────
        self.tech_analyzer   = TechnicalAnalyzer(data_manager=self.data_mgr)
        self.acctg_analyzer  = AccountingQualityAnalyzer(fundamental_manager=self.fund_mgr)
        self.wc_analyzer     = WorkingCapitalAnalyzer(fundamental_manager=self.fund_mgr)
        self.cap_allocator   = CapitalAllocationAnalyzer(fundamental_manager=self.fund_mgr)
        self.inst_tracker    = InstitutionalActivityTracker(fundamental_manager=self.fund_mgr)
        self.reg_monitor     = RegulatoryMonitor()
        self.earnings_cal    = EarningsCalendar()
        self.backtester      = StrategyBacktester(data_manager=self.data_mgr)
        self.risk_mgr        = PortfolioRiskManager(
            data_manager=self.data_mgr,
            risk_free_rate=cfg.get("risk_free_rate", 0.07),
        )

        self.decision_engine = InvestmentDecisionEngine(
            data_manager         = self.data_mgr,
            fundamental_manager  = self.fund_mgr,
            screener             = self.screener,
            dcf_engine           = self.dcf_engine,
            reverse_dcf          = self.reverse_dcf,
            news_monitor         = self.news_monitor,
            db                   = self._db,
            tech_analyzer        = self.tech_analyzer,
            accounting_analyzer  = self.acctg_analyzer,
            wc_analyzer          = self.wc_analyzer,
            capital_allocator    = self.cap_allocator,
            inst_tracker         = self.inst_tracker,
            regulatory_monitor   = self.reg_monitor,
            earnings_calendar    = self.earnings_cal,
        )

        logger.info("All modules initialised successfully")

    # ------------------------------------------------------------------
    # Public API – Core
    # ------------------------------------------------------------------

    def full_analysis(self, symbol: str) -> str:
        """Run the complete pipeline for *symbol* and return a formatted report."""
        symbol = symbol.upper().strip()
        logger.info("Running full analysis for %s", symbol)
        try:
            decision = self.decision_engine.analyze_stock(symbol)
            report   = self.decision_engine.generate_report(decision)

            report_dir = Path("./data/reports")
            report_dir.mkdir(parents=True, exist_ok=True)
            ts   = datetime.now().strftime("%Y%m%d_%H%M")
            path = report_dir / f"{symbol}_{ts}.txt"
            path.write_text(report, encoding="utf-8")
            logger.info("Report saved to %s", path)

            return report

        except Exception as exc:
            logger.exception("Full analysis failed for %s: %s", symbol, exc)
            return (
                f"ERROR: Analysis failed for {symbol}.\n"
                f"Reason: {exc}\n"
                "Check network connectivity and data source availability."
            )

    def screen_universe(
        self, symbols: List[str], max_workers: int = None
    ) -> pd.DataFrame:
        """Screen *symbols* concurrently and rank by conviction score."""
        symbols = [s.upper().strip() for s in symbols]
        workers = max_workers or self._SCREEN_WORKERS
        logger.info("Screening %d stocks with %d workers…", len(symbols), workers)

        rows = []
        with ThreadPoolExecutor(max_workers=workers) as pool:
            future_to_sym = {pool.submit(self._screen_one, sym): sym for sym in symbols}
            for future in as_completed(future_to_sym):
                sym = future_to_sym[future]
                try:
                    rows.append(future.result())
                except Exception as exc:
                    logger.error("Screen failed for %s: %s", sym, exc)
                    rows.append({"Symbol": sym, "Signal": "ERROR", "Bullish_Points": -99})

        df = pd.DataFrame(rows)
        if not df.empty:
            df = df.sort_values("Bullish_Points", ascending=False).reset_index(drop=True)

        run_id = datetime.now().strftime("%Y%m%d_%H%M") + "_" + uuid.uuid4().hex[:6]
        self._db.save_screening_run(run_id, df.to_dict("records"))
        logger.info("Screen complete. Run ID: %s", run_id)

        return df

    def monitor_portfolio(self, portfolio: List[str]) -> str:
        """Generate a daily briefing for a list of holdings."""
        portfolio = [s.upper().strip() for s in portfolio]
        logger.info("Generating daily briefing for: %s", portfolio)
        try:
            return self.news_monitor.generate_daily_briefing(portfolio)
        except Exception as exc:
            logger.exception("Portfolio monitor failed: %s", exc)
            return f"ERROR: Portfolio monitoring failed.\nReason: {exc}"

    def get_decision_history(self, symbol: str, limit: int = 10) -> List[dict]:
        """Return the last *limit* decisions recorded for *symbol*."""
        return self._db.get_decision_history(symbol.upper().strip(), limit)

    # ------------------------------------------------------------------
    # Public API – New capabilities
    # ------------------------------------------------------------------

    def backtest(
        self,
        symbol:       str,
        years:        int = 5,
        holding_days: int = 63,
    ) -> dict:
        """
        Backtest the MA crossover / RSI strategy on *symbol*.
        Returns metrics, trade list, and walk-forward summary.
        """
        symbol = symbol.upper().strip()
        logger.info("Backtesting %s (%d years, %d-day hold)…", symbol, years, holding_days)
        return self.backtester.backtest(symbol, years=years, holding_days=holding_days)

    def backtest_portfolio(
        self,
        symbols:      List[str],
        years:        int = 5,
        holding_days: int = 63,
    ) -> dict:
        """Backtest each symbol in *symbols* and aggregate portfolio metrics."""
        symbols = [s.upper().strip() for s in symbols]
        logger.info("Portfolio backtest: %s", symbols)
        return self.backtester.backtest_portfolio(symbols, years=years, holding_days=holding_days)

    def portfolio_risk(
        self,
        symbols:  List[str],
        weights:  Optional[List[float]] = None,
        years:    int = 1,
    ) -> dict:
        """
        Compute correlation matrix, VaR, max drawdown, Sharpe/Sortino
        for the given portfolio of *symbols*.
        """
        symbols = [s.upper().strip() for s in symbols]
        logger.info("Computing portfolio risk for: %s", symbols)
        return self.risk_mgr.portfolio_analytics(symbols, weights=weights, years=years)

    def position_size(
        self,
        symbol:        str,
        capital:       float = 1_000_000,
        win_prob:      float = 0.55,
        upside_pct:    float = 15.0,
        stop_pct:      float = 8.0,
    ) -> dict:
        """
        Return Kelly-optimal and ATR-based position sizes for *symbol*.

        Args:
            capital:    Total capital available in ₹
            win_prob:   Estimated probability of winning the trade
            upside_pct: Expected upside % (use DCF upside if available)
            stop_pct:   Stop loss distance %
        """
        symbol = symbol.upper().strip()
        # Fetch current price and ATR
        current_price = 0.0
        atr           = 0.0
        try:
            q             = self.live_mgr.get_live_quote(symbol)
            current_price = float(q.get("last_price", 0.0))
        except Exception:
            pass

        try:
            ti  = self.tech_analyzer.analyze(symbol)
            atr = ti.get("atr", 0.0)
        except Exception:
            pass

        return self.risk_mgr.single_stock_risk(
            symbol, current_price, atr, win_prob, upside_pct, stop_pct, capital
        )

    def accounting_quality(self, symbol: str) -> dict:
        """Run Beneish M-Score, Altman Z-Score, and DuPont for *symbol*."""
        symbol = symbol.upper().strip()
        try:
            stmts = self.fund_mgr.get_financial_statements(symbol)
        except Exception:
            stmts = {}
        return self.acctg_analyzer.analyze(symbol, stmts)

    def working_capital_analysis(self, symbol: str) -> dict:
        """Return CCC, DSO, DIO, DPO trend analysis for *symbol*."""
        symbol = symbol.upper().strip()
        try:
            stmts = self.fund_mgr.get_financial_statements(symbol)
        except Exception:
            stmts = {}
        return self.wc_analyzer.analyze(symbol, stmts)

    def regulatory_check(self, symbol: str) -> dict:
        """Check if *symbol* is on ASM/GSM surveillance list."""
        return self.reg_monitor.analyze(symbol.upper().strip())

    def earnings_analysis(self, symbol: str) -> dict:
        """Return upcoming results dates and earnings surprise history for *symbol*."""
        symbol = symbol.upper().strip()
        try:
            stmts = self.fund_mgr.get_financial_statements(symbol)
        except Exception:
            stmts = {}
        return self.earnings_cal.analyze(symbol, stmts)

    def institutional_analysis(self, symbol: str) -> dict:
        """Return bulk/block deals and FII/DII trend for *symbol*."""
        symbol = symbol.upper().strip()
        try:
            ratios = self.fund_mgr.get_key_ratios(symbol)
        except Exception:
            ratios = {}
        return self.inst_tracker.analyze(symbol, ratios)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _screen_one(self, symbol: str) -> dict:
        f_r  = self.screener.calculate_piotroski_f_score(symbol)
        rs_r = self.screener.calculate_relative_strength(symbol)
        tr_r = self.screener.detect_trend_stage(symbol)
        rats = self.fund_mgr.get_key_ratios(symbol)
        grow = self.fund_mgr.get_growth_metrics(symbol)

        # Accounting quality quick check
        try:
            stmts  = self.fund_mgr.get_financial_statements(symbol)
            aq     = self.acctg_analyzer.analyze(symbol, stmts)
            m_flag = aq.get("beneish_flag", False)
            z_zone = aq.get("altman_zone", "SAFE")
        except Exception:
            m_flag = False
            z_zone = "SAFE"

        # Technical composite
        try:
            ti         = self.tech_analyzer.analyze(symbol)
            tech_score = ti.get("composite_signal", 0.0)
        except Exception:
            tech_score = 0.0

        f_score = f_r["score"]
        rs      = rs_r["rs_score"]
        stage   = tr_r["stage"]
        sal_g   = grow["sales_growth_yoy"]
        prf_g   = grow["profit_growth_yoy"]
        pe      = rats.get("pe", 0.0)
        roe     = rats.get("roe", 0.0)
        roce    = rats.get("roce", 0.0)
        de      = rats.get("debt_equity", 0.0)
        promo   = rats.get("promoter_holding", 0.0)
        pledge  = rats.get("pledged_pct", 0.0)
        rsi     = tr_r.get("rsi", 50.0)

        pts = 0
        if rs > 0:       pts += 1
        if f_score >= 7: pts += 1
        if sal_g > 20:   pts += 1
        if prf_g > 20:   pts += 1
        if roe > 15:     pts += 1
        if stage == 2:   pts += 1
        if roce > 20:    pts += 1
        if tech_score > 0.3: pts += 1
        if not m_flag:       pts += 1   # clean accounting
        if z_zone == "SAFE": pts += 1
        if f_score <= 3:     pts -= 2
        if sal_g < 0:        pts -= 1
        if prf_g < 0:        pts -= 1
        if de > 2.0:         pts -= 1
        if pledge > 30:      pts -= 1
        if m_flag:           pts -= 2   # manipulation risk
        if z_zone == "DISTRESS": pts -= 2

        if pts >= 6:
            color, signal = "GREEN",  "HIGH_CONVICTION"
        elif pts <= 0:
            color, signal = "RED",    "BEARISH"
        elif rsi > 70 or rsi < 30:
            color, signal = "YELLOW", "CAUTION"
        else:
            color, signal = "YELLOW", "NEUTRAL"

        return {
            "Symbol":           symbol,
            "F_Score":          f_score,
            "RS_Score":         round(rs, 2),
            "Trend":            tr_r["stage_name"],
            "Sales_Growth":     round(sal_g, 2),
            "Profit_Growth":    round(prf_g, 2),
            "PE":               round(pe, 2),
            "ROE":              round(roe, 2),
            "ROCE":             round(roce, 2),
            "D_E":              round(de, 2),
            "Promoter_Holding": round(promo, 2),
            "Pledged_Pct":      round(pledge, 2),
            "RSI":              round(rsi, 2),
            "Tech_Score":       round(tech_score, 3),
            "Beneish_Flag":     m_flag,
            "Altman_Zone":      z_zone,
            "Bullish_Points":   pts,
            "Signal":           signal,
            "Color":            color,
        }


# ── CLI entry point ──────────────────────────────────────────────────────────
if __name__ == "__main__":
    analyzer = IndianEquityAnalyzer()

    # Single stock deep dive
    print("\n" + "=" * 64)
    print("RUNNING FULL ANALYSIS: RELIANCE")
    print("=" * 64)
    report = analyzer.full_analysis("RELIANCE")
    print(report)

    # Universe screening (concurrent)
    nifty_10 = [
        "RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK",
        "HINDUNILVR", "SBIN", "BHARTIARTL", "ITC", "KOTAKBANK",
    ]
    print("\n" + "=" * 64)
    print("UNIVERSE SCREEN: NIFTY TOP-10  (concurrent)")
    print("=" * 64)
    results = analyzer.screen_universe(nifty_10)
    print(results.to_string(index=False))

    # Backtesting
    print("\n" + "=" * 64)
    print("BACKTEST: RELIANCE (5 years)")
    print("=" * 64)
    bt = analyzer.backtest("RELIANCE", years=5)
    print(bt["summary"])
    print("Walk-forward windows:", bt.get("walk_forward_results", []))

    # Portfolio risk
    holdings = ["RELIANCE", "TCS", "HDFCBANK"]
    print("\n" + "=" * 64)
    print("PORTFOLIO RISK ANALYSIS")
    print("=" * 64)
    risk = analyzer.portfolio_risk(holdings)
    print(f"  Sharpe:       {risk['sharpe_ratio']:.3f}")
    print(f"  Sortino:      {risk['sortino_ratio']:.3f}")
    print(f"  VaR 95%:      {risk['var_95_pct']:.2f}%")
    print(f"  Max Drawdown: {risk['max_drawdown_pct']:.2f}%")
    print(f"  Avg Corr:     {risk['avg_pairwise_corr']:.3f}")

    # Position sizing
    print("\n" + "=" * 64)
    print("POSITION SIZING: RELIANCE")
    print("=" * 64)
    sizing = analyzer.position_size("RELIANCE", capital=1_000_000)
    print(f"  Kelly fraction:    {sizing['kelly_fraction']*100:.1f}%")
    print(f"  Recommended cap:   ₹{sizing['kelly_capital']:,.0f}")
    print(f"  ATR stop:          ₹{sizing['atr_position']['stop_price']:,.2f}")

    # Portfolio monitoring
    print("\n" + "=" * 64)
    print("PORTFOLIO DAILY BRIEFING")
    print("=" * 64)
    briefing = analyzer.monitor_portfolio(holdings)
    print(briefing)

    # Decision history
    print("\n" + "=" * 64)
    print("DECISION HISTORY: RELIANCE")
    print("=" * 64)
    history = analyzer.get_decision_history("RELIANCE", limit=5)
    for h in history:
        ts = datetime.fromtimestamp(h.get("created_at", 0)).strftime("%Y-%m-%d %H:%M")
        print(f"  {ts}  {h['decision']:12s}  conf={h['confidence']}%  "
              f"price=₹{h['current_price']:.2f}  score={h['composite_score']:+.4f}")
