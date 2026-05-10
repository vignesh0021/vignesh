"""
Indian Equity Analyzer – Main Orchestrator
==========================================

Usage:
    python main.py

    Or import and use programmatically:
        from main import IndianEquityAnalyzer
        analyzer = IndianEquityAnalyzer()
        print(analyzer.full_analysis("RELIANCE"))
"""
import json
import logging
import sys
from pathlib import Path
from typing import List

import pandas as pd

# ---------------------------------------------------------------------------
# Logging setup
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s – %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("./data/analyzer.log", mode="a"),
    ],
)
logger = logging.getLogger("IndianEquityAnalyzer")

# ---------------------------------------------------------------------------
# Module imports
# ---------------------------------------------------------------------------
from data_collection.historical_data import HistoricalDataManager
from data_collection.live_data import LiveDataManager
from fundamental_data.jufinance_adapter import FundamentalDataManager
from screening.bharatquant_adapter import BharatQuantScreener
from valuation.dcf_engine import MonteCarloDCF
from valuation.reverse_dcf import ReverseDCF
from monitoring.news_monitor import IndianStockMonitor
from decision_engine.investment_decision import InvestmentDecisionEngine


def _load_config() -> dict:
    config_path = Path(__file__).parent / "config" / "india_market_params.json"
    try:
        with config_path.open() as f:
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
    Top-level façade that wires together all six analysis modules
    and exposes three simple methods:

    * ``full_analysis(symbol)``     – deep-dive single stock report
    * ``screen_universe(symbols)``  – rank a list of stocks by conviction
    * ``monitor_portfolio(portfolio)`` – daily briefing for holdings
    """

    def __init__(self):
        cfg = _load_config()
        logger.info("Initialising Indian Equity Analyzer…")

        # Layer 1 – Data collection
        self.data_mgr = HistoricalDataManager(cache_dir="./data/historical")
        self.live_mgr = LiveDataManager()

        # Layer 2 – Fundamental data
        self.fund_mgr = FundamentalDataManager(cache_dir="./data/fundamentals")

        # Layer 3 – Screening
        self.screener = BharatQuantScreener(
            data_manager=self.data_mgr,
            fundamental_manager=self.fund_mgr,
        )

        # Layer 4 – Valuation
        self.dcf_engine = MonteCarloDCF(
            risk_free_rate=cfg.get("risk_free_rate", 0.07),
            market_risk_premium=cfg.get("market_risk_premium", 0.08),
            tax_rate=cfg.get("tax_rate", 0.25),
            terminal_growth_rate=cfg.get("terminal_growth_rate", 0.04),
        )
        self.reverse_dcf = ReverseDCF(
            fundamental_manager=self.fund_mgr,
            risk_free_rate=cfg.get("risk_free_rate", 0.07),
            market_risk_premium=cfg.get("market_risk_premium", 0.08),
            tax_rate=cfg.get("tax_rate", 0.25),
        )

        # Layer 5 – News monitor
        self.news_monitor = IndianStockMonitor(live_data_manager=self.live_mgr)

        # Layer 6 – Decision engine
        self.decision_engine = InvestmentDecisionEngine(
            data_manager=self.data_mgr,
            fundamental_manager=self.fund_mgr,
            screener=self.screener,
            dcf_engine=self.dcf_engine,
            reverse_dcf=self.reverse_dcf,
            news_monitor=self.news_monitor,
        )

        logger.info("All modules initialised successfully")

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def full_analysis(self, symbol: str) -> str:
        """
        Run a complete analysis for *symbol* and return a formatted report.

        Args:
            symbol: NSE equity symbol (e.g. 'RELIANCE').

        Returns:
            Multi-line formatted investment decision report.
        """
        symbol = symbol.upper().strip()
        logger.info("Running full analysis for %s", symbol)
        try:
            decision = self.decision_engine.analyze_stock(symbol)
            report = self.decision_engine.generate_report(decision)

            # Persist report to disk
            report_dir = Path("./data/reports")
            report_dir.mkdir(parents=True, exist_ok=True)
            from datetime import datetime
            ts = datetime.now().strftime("%Y%m%d_%H%M")
            report_path = report_dir / f"{symbol}_{ts}.txt"
            report_path.write_text(report)
            logger.info("Report saved to %s", report_path)

            return report
        except Exception as exc:
            logger.exception("Full analysis failed for %s: %s", symbol, exc)
            return (
                f"ERROR: Analysis failed for {symbol}.\n"
                f"Reason: {exc}\n"
                "Please check network connectivity and try again."
            )

    def screen_universe(self, symbols: List[str]) -> pd.DataFrame:
        """
        Screen a list of stocks and rank by conviction score.

        Args:
            symbols: List of NSE equity symbols.

        Returns:
            Ranked DataFrame with screening metrics.
        """
        symbols = [s.upper().strip() for s in symbols]
        logger.info("Screening universe of %d stocks: %s", len(symbols), symbols)
        try:
            df = self.screener.run_full_screen(symbols)
            return df
        except Exception as exc:
            logger.exception("Universe screen failed: %s", exc)
            return pd.DataFrame({"Error": [str(exc)]})

    def monitor_portfolio(self, portfolio: List[str]) -> str:
        """
        Generate a daily briefing for a list of portfolio holdings.

        Args:
            portfolio: List of NSE symbols currently held.

        Returns:
            Formatted daily briefing text.
        """
        portfolio = [s.upper().strip() for s in portfolio]
        logger.info("Generating daily briefing for: %s", portfolio)
        try:
            return self.news_monitor.generate_daily_briefing(portfolio)
        except Exception as exc:
            logger.exception("Portfolio monitor failed: %s", exc)
            return f"ERROR: Portfolio monitoring failed.\nReason: {exc}"


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    analyzer = IndianEquityAnalyzer()

    # ── Single stock deep dive ──────────────────────────────────────────
    print("\n" + "=" * 64)
    print("RUNNING FULL ANALYSIS: RELIANCE")
    print("=" * 64)
    report = analyzer.full_analysis("RELIANCE")
    print(report)

    # ── Universe screening ──────────────────────────────────────────────
    nifty_10 = [
        "RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK",
        "HINDUNILVR", "SBIN", "BHARTIARTL", "ITC", "KOTAKBANK",
    ]
    print("\n" + "=" * 64)
    print("UNIVERSE SCREEN: NIFTY TOP-10")
    print("=" * 64)
    results = analyzer.screen_universe(nifty_10)
    print(results.to_string(index=False))

    # ── Portfolio monitoring ────────────────────────────────────────────
    holdings = ["RELIANCE", "TCS", "HDFCBANK"]
    print("\n" + "=" * 64)
    print("PORTFOLIO DAILY BRIEFING")
    print("=" * 64)
    briefing = analyzer.monitor_portfolio(holdings)
    print(briefing)
