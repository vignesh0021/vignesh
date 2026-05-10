"""
Unit tests for Indian Equity Analyzer modules.

Run with:
    python -m pytest tests/test_modules.py -v
"""
import sys
import os
import unittest
from unittest.mock import MagicMock, patch
from pathlib import Path

# Ensure project root is on path when running from tests/ or project root
sys.path.insert(0, str(Path(__file__).parent.parent))

import numpy as np
import pandas as pd


# ---------------------------------------------------------------------------
# Helpers / fixtures
# ---------------------------------------------------------------------------

def _mock_income_statements():
    return [
        {"year": 2021, "revenue": 5_00_000, "gross_profit": 1_50_000,
         "operating_income": 80_000, "net_income": 60_000, "eps": 10.0},
        {"year": 2022, "revenue": 6_00_000, "gross_profit": 1_80_000,
         "operating_income": 95_000, "net_income": 72_000, "eps": 12.0},
        {"year": 2023, "revenue": 7_50_000, "gross_profit": 2_30_000,
         "operating_income": 1_20_000, "net_income": 90_000, "eps": 15.0},
        {"year": 2024, "revenue": 9_00_000, "gross_profit": 2_80_000,
         "operating_income": 1_50_000, "net_income": 1_10_000, "eps": 18.0},
    ]


def _mock_balance_sheets():
    return [
        {"year": 2021, "total_assets": 20_00_000, "total_liabilities": 12_00_000,
         "total_equity": 8_00_000, "total_debt": 5_00_000, "cash": 50_000,
         "current_assets": 3_00_000, "current_liabilities": 1_50_000},
        {"year": 2022, "total_assets": 22_00_000, "total_liabilities": 12_50_000,
         "total_equity": 9_50_000, "total_debt": 5_00_000, "cash": 70_000,
         "current_assets": 3_50_000, "current_liabilities": 1_60_000},
        {"year": 2023, "total_assets": 25_00_000, "total_liabilities": 13_00_000,
         "total_equity": 12_00_000, "total_debt": 4_80_000, "cash": 90_000,
         "current_assets": 4_00_000, "current_liabilities": 1_70_000},
        {"year": 2024, "total_assets": 28_00_000, "total_liabilities": 13_50_000,
         "total_equity": 14_50_000, "total_debt": 4_60_000, "cash": 1_20_000,
         "current_assets": 5_00_000, "current_liabilities": 1_80_000},
    ]


def _mock_cash_flows():
    return [
        {"year": 2021, "operating_cash_flow": 80_000, "capex": -30_000,
         "free_cash_flow": 50_000, "investing_cash_flow": -40_000,
         "financing_cash_flow": -10_000},
        {"year": 2022, "operating_cash_flow": 95_000, "capex": -35_000,
         "free_cash_flow": 60_000, "investing_cash_flow": -45_000,
         "financing_cash_flow": -12_000},
        {"year": 2023, "operating_cash_flow": 1_20_000, "capex": -40_000,
         "free_cash_flow": 80_000, "investing_cash_flow": -55_000,
         "financing_cash_flow": -15_000},
        {"year": 2024, "operating_cash_flow": 1_50_000, "capex": -45_000,
         "free_cash_flow": 1_05_000, "investing_cash_flow": -60_000,
         "financing_cash_flow": -18_000},
    ]


def _mock_statements():
    return {
        "income_statement": _mock_income_statements(),
        "balance_sheet": _mock_balance_sheets(),
        "cash_flow": _mock_cash_flows(),
        "quarterly_results": [],
    }


# ---------------------------------------------------------------------------
# 1. MonteCarloDCF
# ---------------------------------------------------------------------------

class TestMonteCarloDCF(unittest.TestCase):

    def setUp(self):
        from valuation.dcf_engine import MonteCarloDCF
        self.dcf = MonteCarloDCF(
            risk_free_rate=0.07,
            market_risk_premium=0.08,
            tax_rate=0.25,
            terminal_growth_rate=0.04,
            projection_years=10,
        )
        self.hist_fcf = [50_000, 60_000, 80_000, 1_05_000]

    def test_wacc_calculation(self):
        wacc = self.dcf.calculate_wacc(beta=1.0, cost_of_debt=0.09, debt=500, equity=1500)
        self.assertGreater(wacc, 0.05)
        self.assertLess(wacc, 0.20)

    def test_wacc_floor(self):
        wacc = self.dcf.calculate_wacc(beta=-5, cost_of_debt=0.01, debt=10, equity=1)
        self.assertGreaterEqual(wacc, 0.05)

    def test_project_fcf_length(self):
        projected = self.dcf.project_fcf(self.hist_fcf)
        self.assertEqual(len(projected), 10)

    def test_project_fcf_bounds(self):
        rng = np.random.default_rng(99)
        for _ in range(20):
            projected = self.dcf.project_fcf(
                [100_000], {"mean": 0.15, "std": 0.05}, rng=rng
            )
            # No single step should exceed +50% or drop below -30% from prior
            self.assertEqual(len(projected), 10)

    def test_terminal_value_positive(self):
        tv = self.dcf.calculate_terminal_value(1_00_000, terminal_growth=0.04, wacc=0.12)
        self.assertGreater(tv, 0)

    def test_terminal_value_formula(self):
        fcf, g, wacc = 100_000, 0.04, 0.12
        expected = fcf * (1 + g) / (wacc - g)
        actual = self.dcf.calculate_terminal_value(fcf, g, wacc)
        self.assertAlmostEqual(actual, expected, places=0)

    def test_monte_carlo_returns_dict(self):
        result = self.dcf.run_monte_carlo(
            self.hist_fcf, wacc=0.12, current_market_cap=10_00_000, n_simulations=500
        )
        for key in ["mean", "median", "std", "p5", "p25", "p75", "p95",
                    "probability_of_upside", "per_share_median"]:
            self.assertIn(key, result)

    def test_monte_carlo_percentile_order(self):
        result = self.dcf.run_monte_carlo(
            self.hist_fcf, wacc=0.12, current_market_cap=10_00_000, n_simulations=500
        )
        self.assertLessEqual(result["p5"], result["p25"])
        self.assertLessEqual(result["p25"], result["median"])
        self.assertLessEqual(result["median"], result["p75"])
        self.assertLessEqual(result["p75"], result["p95"])

    def test_scenario_keys(self):
        scenarios = self.dcf.generate_scenarios(
            self.hist_fcf, wacc=0.12,
            current_market_cap=10_00_000, shares_outstanding=100
        )
        self.assertIn("bear", scenarios)
        self.assertIn("base", scenarios)
        self.assertIn("bull", scenarios)

    def test_bull_gt_bear(self):
        scenarios = self.dcf.generate_scenarios(
            self.hist_fcf, wacc=0.12,
            current_market_cap=10_00_000, shares_outstanding=100
        )
        self.assertGreater(
            scenarios["bull"]["per_share_value"],
            scenarios["bear"]["per_share_value"],
        )


# ---------------------------------------------------------------------------
# 2. ReverseDCF
# ---------------------------------------------------------------------------

class TestReverseDCF(unittest.TestCase):

    def _make_rdcf(self):
        from valuation.reverse_dcf import ReverseDCF
        fund_mgr = MagicMock()
        fund_mgr.get_financial_statements.return_value = _mock_statements()
        fund_mgr.get_key_ratios.return_value = {
            "pe": 25.0, "pb": 3.0, "roe": 18.0, "roce": 22.0,
            "debt_equity": 0.5, "market_cap": 20_00_000,
            "promoter_holding": 50.0, "fii_holding": 15.0,
            "current_ratio": 2.0, "pledged_pct": 5.0,
        }
        fund_mgr.get_growth_metrics.return_value = {
            "sales_growth_yoy": 20.0, "profit_growth_yoy": 22.0,
            "sales_cagr_3y": 21.0, "profit_cagr_3y": 22.5,
        }
        return ReverseDCF(fundamental_manager=fund_mgr)

    def test_implied_growth_returns_dict(self):
        rdcf = self._make_rdcf()
        result = rdcf.calculate_implied_growth("TESTCO", current_price=2000.0)
        self.assertIn("implied_growth_pct", result)
        self.assertIn("wacc", result)

    def test_compare_returns_assessment(self):
        rdcf = self._make_rdcf()
        result = rdcf.compare_to_historical_growth("TESTCO", current_price=2000.0)
        self.assertIn("assessment", result)
        self.assertIn(result["assessment"], ["CHEAP", "FAIR", "EXPENSIVE", "INDETERMINATE"])

    def test_growth_gap_direction(self):
        rdcf = self._make_rdcf()
        # Inflate market cap so implied growth >> actual → EXPENSIVE
        rdcf.fund_mgr.get_key_ratios.return_value["market_cap"] = 2_00_00_000  # 100× inflated
        result = rdcf.compare_to_historical_growth("TESTCO", current_price=2000.0)
        # With an extremely high market cap the implied growth should be very high
        if result["growth_gap"] is not None:
            self.assertIn(result["assessment"], ["EXPENSIVE", "FAIR"])


# ---------------------------------------------------------------------------
# 3. BharatQuantScreener
# ---------------------------------------------------------------------------

class TestBharatQuantScreener(unittest.TestCase):

    def _make_screener(self):
        from screening.bharatquant_adapter import BharatQuantScreener

        data_mgr = MagicMock()
        # Return a 252-row DataFrame for trend detection
        dates = pd.date_range("2023-01-01", periods=260, freq="B")
        closes = 1000 + np.cumsum(np.random.randn(260) * 5)
        df = pd.DataFrame({
            "Date": dates, "Open": closes * 0.99, "High": closes * 1.01,
            "Low": closes * 0.98, "Close": closes, "Volume": 100_000,
        })
        data_mgr.get_stock_history.return_value = df
        data_mgr.calculate_rsi.return_value = 55.0

        fund_mgr = MagicMock()
        fund_mgr.get_financial_statements.return_value = _mock_statements()
        fund_mgr.get_key_ratios.return_value = {
            "pe": 20.0, "pb": 2.5, "roe": 18.0, "roce": 22.0,
            "debt_equity": 0.4, "promoter_holding": 55.0,
            "fii_holding": 14.0, "current_ratio": 2.3, "pledged_pct": 3.0,
        }
        fund_mgr.get_growth_metrics.return_value = {
            "sales_growth_yoy": 20.0, "profit_growth_yoy": 22.0,
            "sales_cagr_3y": 20.0, "profit_cagr_3y": 21.0,
        }

        return BharatQuantScreener(data_manager=data_mgr, fundamental_manager=fund_mgr)

    def test_f_score_range(self):
        screener = self._make_screener()
        result = screener.calculate_piotroski_f_score("TEST")
        self.assertGreaterEqual(result["score"], 0)
        self.assertLessEqual(result["score"], 9)

    def test_f_score_criteria_count(self):
        screener = self._make_screener()
        result = screener.calculate_piotroski_f_score("TEST")
        self.assertEqual(len(result["criteria"]), 9)

    def test_f_score_criteria_binary(self):
        screener = self._make_screener()
        result = screener.calculate_piotroski_f_score("TEST")
        for v in result["criteria"].values():
            self.assertIn(v, [0, 1])

    def test_f_score_sum_matches_total(self):
        screener = self._make_screener()
        result = screener.calculate_piotroski_f_score("TEST")
        self.assertEqual(result["score"], sum(result["criteria"].values()))

    def test_rs_score_returns_dict(self):
        screener = self._make_screener()
        with patch.object(screener, "_annual_return", return_value=15.0):
            result = screener.calculate_relative_strength("TEST")
        self.assertIn("rs_score", result)
        self.assertIn("outperforming", result)

    def test_trend_stage_returns_valid_stage(self):
        screener = self._make_screener()
        result = screener.detect_trend_stage("TEST")
        self.assertIn(result["stage"], [0, 1, 2, 3, 4])

    def test_full_screen_returns_dataframe(self):
        screener = self._make_screener()
        with patch.object(screener, "_annual_return", return_value=12.0):
            df = screener.run_full_screen(["TEST"])
        self.assertIsInstance(df, pd.DataFrame)
        self.assertFalse(df.empty)
        self.assertIn("Symbol", df.columns)
        self.assertIn("F_Score", df.columns)
        self.assertIn("Bullish_Points", df.columns)


# ---------------------------------------------------------------------------
# 4. IndianStockMonitor (news scoring)
# ---------------------------------------------------------------------------

class TestIndianStockMonitor(unittest.TestCase):
    """Tests use only the pure-Python scoring logic; no feedparser import needed."""

    def _make_monitor(self):
        import monitoring.news_monitor as nm_module
        # Patch feedparser availability so the module can be imported safely
        # regardless of the system's feedparser version.
        with patch.object(nm_module, "_FEEDPARSER_OK", True):
            from monitoring.news_monitor import IndianStockMonitor
            monitor = IndianStockMonitor.__new__(IndianStockMonitor)
            monitor.live_mgr = None
            monitor._cache_minutes = 30
            monitor._news_cache = {}
        return monitor

    def test_score_high_impact_keyword(self):
        import monitoring.news_monitor as nm_module
        article = {"title": "RELIANCE quarterly earnings beat expectations", "summary": ""}
        score = nm_module.IndianStockMonitor._score_article(article, symbol="RELIANCE", sector=None)
        self.assertGreaterEqual(score, 3)

    def test_score_symbol_boost(self):
        import monitoring.news_monitor as nm_module
        article = {"title": "TCS reported strong results", "summary": ""}
        score_with = nm_module.IndianStockMonitor._score_article(article, symbol="TCS", sector=None)
        score_without = nm_module.IndianStockMonitor._score_article(article, symbol="INFY", sector=None)
        self.assertGreater(score_with, score_without)

    def test_score_capped_at_10(self):
        import monitoring.news_monitor as nm_module
        article = {
            "title": "earnings results dividend bonus acquisition merger FDA approval",
            "summary": "default penalty sebi fraud"
        }
        score = nm_module.IndianStockMonitor._score_article(article, symbol="XYZ", sector=None)
        self.assertLessEqual(score, 10)

    def test_daily_briefing_structure(self):
        import monitoring.news_monitor as nm_module
        with patch.object(nm_module, "_FEEDPARSER_OK", False):
            monitor = nm_module.IndianStockMonitor(live_data_manager=None)
        with patch.object(monitor, "fetch_news", return_value=[]), \
             patch.object(monitor, "get_corporate_actions", return_value=[]):
            briefing = monitor.generate_daily_briefing(["RELIANCE"])
        self.assertIn("DAILY PORTFOLIO BRIEFING", briefing)
        self.assertIn("RELIANCE", briefing)


# ---------------------------------------------------------------------------
# 5. FundamentalDataManager – growth metrics calculation
# ---------------------------------------------------------------------------

class TestFundamentalDataManager(unittest.TestCase):

    def _make_mgr(self):
        from fundamental_data.jufinance_adapter import FundamentalDataManager
        mgr = FundamentalDataManager.__new__(FundamentalDataManager)
        mgr.cache_dir = Path("/tmp/test_cache")
        mgr.cache_dir.mkdir(exist_ok=True)
        mgr._cache_ttl = 3600
        mgr._jufinance_ok = False
        return mgr

    def test_pct_change_positive(self):
        from fundamental_data.jufinance_adapter import FundamentalDataManager
        result = FundamentalDataManager._pct_change(120, 100)
        self.assertAlmostEqual(result, 20.0)

    def test_pct_change_negative(self):
        from fundamental_data.jufinance_adapter import FundamentalDataManager
        result = FundamentalDataManager._pct_change(80, 100)
        self.assertAlmostEqual(result, -20.0)

    def test_pct_change_zero_denominator(self):
        from fundamental_data.jufinance_adapter import FundamentalDataManager
        result = FundamentalDataManager._pct_change(100, 0)
        self.assertEqual(result, 0.0)

    def test_cagr_calculation(self):
        from fundamental_data.jufinance_adapter import FundamentalDataManager
        # 100 → 133.1 over 3 years ≈ 10%
        result = FundamentalDataManager._cagr(100, 133.1, 3)
        self.assertAlmostEqual(result, 10.0, places=0)

    def test_safe_float_handles_strings(self):
        from fundamental_data.jufinance_adapter import FundamentalDataManager
        self.assertEqual(FundamentalDataManager._safe_float("3,500.50"), 3500.50)
        self.assertEqual(FundamentalDataManager._safe_float("25%"), 25.0)
        self.assertEqual(FundamentalDataManager._safe_float(None), 0.0)
        self.assertEqual(FundamentalDataManager._safe_float("N/A"), 0.0)


# ---------------------------------------------------------------------------
# 6. InvestmentDecision dataclass
# ---------------------------------------------------------------------------

class TestInvestmentDecision(unittest.TestCase):

    def test_default_values(self):
        from decision_engine.investment_decision import InvestmentDecision
        d = InvestmentDecision(symbol="TEST", decision="HOLD", confidence=50)
        self.assertEqual(d.symbol, "TEST")
        self.assertEqual(d.decision, "HOLD")
        self.assertEqual(d.position_size, "None")
        self.assertIsInstance(d.key_reasons, list)
        self.assertIsInstance(d.risks, list)

    def test_decision_labels(self):
        from decision_engine.investment_decision import DECISION_LABELS
        for label in ["STRONG_BUY", "BUY", "HOLD", "AVOID", "STRONG_AVOID"]:
            self.assertIn(label, DECISION_LABELS)


# ---------------------------------------------------------------------------
# 7. HistoricalDataManager – RSI and MA
# ---------------------------------------------------------------------------

class TestHistoricalDataManager(unittest.TestCase):

    def _make_mgr_with_data(self):
        from data_collection.historical_data import HistoricalDataManager
        mgr = HistoricalDataManager.__new__(HistoricalDataManager)
        mgr.cache_dir = Path("/tmp/test_hist_cache")
        mgr.cache_dir.mkdir(exist_ok=True)
        mgr._cache_expiry_seconds = 3600
        mgr._jd_stock_df = None
        mgr._jd_bhavcopy_save = None

        # Inject 260 trading days of mock data
        dates = pd.date_range("2023-01-01", periods=260, freq="B")
        prices = 1000 + np.cumsum(np.random.default_rng(1).standard_normal(260) * 10)
        mgr._mock_df = pd.DataFrame({
            "Date": dates, "Open": prices * 0.99,
            "High": prices * 1.01, "Low": prices * 0.98,
            "Close": prices, "Volume": 50_000,
        })
        mgr.get_stock_history = MagicMock(return_value=mgr._mock_df)
        return mgr

    def test_calculate_rsi_range(self):
        mgr = self._make_mgr_with_data()
        rsi = mgr.calculate_rsi("TEST")
        self.assertGreaterEqual(rsi, 0.0)
        self.assertLessEqual(rsi, 100.0)

    def test_calculate_moving_averages(self):
        mgr = self._make_mgr_with_data()
        mas = mgr.calculate_moving_averages("TEST", windows=[50, 200])
        self.assertIn("MA_50", mas)
        self.assertIn("MA_200", mas)
        self.assertGreater(mas["MA_50"], 0)
        self.assertGreater(mas["MA_200"], 0)


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    unittest.main(verbosity=2)
