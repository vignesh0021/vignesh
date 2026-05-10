"""
Indian Equity Analyzer – Main Orchestrator
==========================================

Production features added:
  - Concurrent universe screening via ThreadPoolExecutor
  - SQLite-backed decision persistence
  - Smart cache TTL (60 s during trading hours, 8 h post-close)
  - Beta calculated from 3-year weekly regression

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
from typing import List

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

# ── Module imports ───────────────────────────────────────────────────────────
from data_collection.historical_data import HistoricalDataManager
from data_collection.live_data import LiveDataManager
from fundamental_data.jufinance_adapter import FundamentalDataManager
from screening.bharatquant_adapter import BharatQuantScreener
from valuation.dcf_engine import MonteCarloDCF
from valuation.reverse_dcf import ReverseDCF
from monitoring.news_monitor import IndianStockMonitor
from decision_engine.investment_decision import InvestmentDecisionEngine
from utils.database import AnalysisDatabase


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
    Top-level façade wiring together all six analysis modules.

    Public methods:
      full_analysis(symbol)          → str  (formatted report)
      screen_universe(symbols)       → pd.DataFrame  (ranked)
      monitor_portfolio(portfolio)   → str  (daily briefing)
      get_decision_history(symbol)   → list (past decisions)
    """

    # Max concurrent workers for universe screening
    _SCREEN_WORKERS = 5

    def __init__(self):
        cfg = _load_config()
        logger.info("Initialising Indian Equity Analyzer…")

        self._db = AnalysisDatabase("./data/market.db")

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

        self.decision_engine = InvestmentDecisionEngine(
            data_manager       = self.data_mgr,
            fundamental_manager= self.fund_mgr,
            screener           = self.screener,
            dcf_engine         = self.dcf_engine,
            reverse_dcf        = self.reverse_dcf,
            news_monitor       = self.news_monitor,
            db                 = self._db,
        )

        logger.info("All modules initialised successfully")

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def full_analysis(self, symbol: str) -> str:
        """
        Run a complete analysis pipeline for *symbol* and return a
        formatted text report.  The report is also persisted to
        ./data/reports/{SYMBOL}_{timestamp}.txt.
        """
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
        """
        Screen *symbols* concurrently and rank by conviction.

        Uses ThreadPoolExecutor with up to *max_workers* threads
        (default: self._SCREEN_WORKERS = 5).
        Results are saved to the DB for history tracking.
        """
        symbols = [s.upper().strip() for s in symbols]
        workers = max_workers or self._SCREEN_WORKERS
        logger.info("Screening %d stocks with %d workers…", len(symbols), workers)

        rows = []
        with ThreadPoolExecutor(max_workers=workers) as pool:
            future_to_sym = {
                pool.submit(self._screen_one, sym): sym for sym in symbols
            }
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

        # Persist screening run
        run_id = datetime.now().strftime("%Y%m%d_%H%M") + "_" + uuid.uuid4().hex[:6]
        self._db.save_screening_run(run_id, df.to_dict("records"))
        logger.info("Screen complete. Run ID: %s", run_id)

        return df

    def monitor_portfolio(self, portfolio: List[str]) -> str:
        """Generate a daily briefing for a list of portfolio holdings."""
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
    # Internal helpers
    # ------------------------------------------------------------------

    def _screen_one(self, symbol: str) -> dict:
        """Screen a single stock – runs in a worker thread."""
        f_r  = self.screener.calculate_piotroski_f_score(symbol)
        rs_r = self.screener.calculate_relative_strength(symbol)
        tr_r = self.screener.detect_trend_stage(symbol)
        rats = self.fund_mgr.get_key_ratios(symbol)
        grow = self.fund_mgr.get_growth_metrics(symbol)

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
        if f_score <= 3: pts -= 2
        if sal_g < 0:    pts -= 1
        if prf_g < 0:    pts -= 1
        if de > 2.0:     pts -= 1
        if pledge > 30:  pts -= 1

        if pts >= 4:
            color, signal = "GREEN",  "HIGH_CONVICTION"
        elif pts <= 0:
            color, signal = "RED",    "BEARISH"
        elif rsi > 70 or rsi < 30:
            color, signal = "YELLOW", "CAUTION"
        else:
            color, signal = "YELLOW", "NEUTRAL"

        return {
            "Symbol":          symbol,
            "F_Score":         f_score,
            "RS_Score":        round(rs, 2),
            "Trend":           tr_r["stage_name"],
            "Sales_Growth":    round(sal_g, 2),
            "Profit_Growth":   round(prf_g, 2),
            "PE":              round(pe, 2),
            "ROE":             round(roe, 2),
            "ROCE":            round(roce, 2),
            "D_E":             round(de, 2),
            "Promoter_Holding": round(promo, 2),
            "Pledged_Pct":     round(pledge, 2),
            "RSI":             round(rsi, 2),
            "Bullish_Points":  pts,
            "Signal":          signal,
            "Color":           color,
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

    # Portfolio monitoring
    holdings = ["RELIANCE", "TCS", "HDFCBANK"]
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
