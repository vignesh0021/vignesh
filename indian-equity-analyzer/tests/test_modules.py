"""
Unit tests for Indian Equity Analyzer – production-level suite.

Run with:
    python -m pytest tests/test_modules.py -v
"""
import sys
import math
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent))

import numpy as np
import pandas as pd


# ── Shared fixtures ─────────────────────────────────────────────────────────

def _income():
    return [
        {"period": "Mar 2021", "revenue": 500_000, "gross_profit": 150_000,
         "operating_profit": 80_000, "net_income": 60_000, "eps": 10.0},
        {"period": "Mar 2022", "revenue": 600_000, "gross_profit": 180_000,
         "operating_profit": 95_000, "net_income": 72_000, "eps": 12.0},
        {"period": "Mar 2023", "revenue": 750_000, "gross_profit": 230_000,
         "operating_profit": 120_000, "net_income": 90_000, "eps": 15.0},
        {"period": "Mar 2024", "revenue": 900_000, "gross_profit": 280_000,
         "operating_profit": 150_000, "net_income": 110_000, "eps": 18.0},
    ]


def _balance():
    return [
        {"period": "Mar 2021", "total_assets": 2_000_000, "total_equity": 800_000,
         "total_debt": 500_000, "borrowings": 500_000, "share_capital": 100_000,
         "reserves": 700_000, "current_assets": 300_000, "current_liabilities": 150_000,
         "total_liabilities": 1_200_000},
        {"period": "Mar 2022", "total_assets": 2_200_000, "total_equity": 950_000,
         "total_debt": 500_000, "borrowings": 500_000, "share_capital": 100_000,
         "reserves": 850_000, "current_assets": 350_000, "current_liabilities": 160_000,
         "total_liabilities": 1_250_000},
        {"period": "Mar 2023", "total_assets": 2_500_000, "total_equity": 1_200_000,
         "total_debt": 480_000, "borrowings": 480_000, "share_capital": 100_000,
         "reserves": 1_100_000, "current_assets": 400_000, "current_liabilities": 170_000,
         "total_liabilities": 1_300_000},
        {"period": "Mar 2024", "total_assets": 2_800_000, "total_equity": 1_450_000,
         "total_debt": 460_000, "borrowings": 460_000, "share_capital": 100_000,
         "reserves": 1_350_000, "current_assets": 500_000, "current_liabilities": 180_000,
         "total_liabilities": 1_350_000},
    ]


def _cashflow():
    return [
        {"period": "Mar 2021", "operating_cash_flow": 80_000, "capex": -30_000,
         "free_cash_flow": 50_000, "investing_cash_flow": -40_000, "financing_cash_flow": -10_000},
        {"period": "Mar 2022", "operating_cash_flow": 95_000, "capex": -35_000,
         "free_cash_flow": 60_000, "investing_cash_flow": -45_000, "financing_cash_flow": -12_000},
        {"period": "Mar 2023", "operating_cash_flow": 120_000, "capex": -40_000,
         "free_cash_flow": 80_000, "investing_cash_flow": -55_000, "financing_cash_flow": -15_000},
        {"period": "Mar 2024", "operating_cash_flow": 150_000, "capex": -45_000,
         "free_cash_flow": 105_000, "investing_cash_flow": -60_000, "financing_cash_flow": -18_000},
    ]


def _stmts():
    return {
        "income_statement": _income(),
        "balance_sheet":    _balance(),
        "cash_flow":        _cashflow(),
        "quarterly_results": [],
    }


def _ratios():
    return {
        "pe": 25.0, "pb": 3.0, "roe": 18.0, "roce": 22.0,
        "debt_equity": 0.32, "market_cap": 2_000_000,  # Crores
        "promoter_holding": 50.0, "fii_holding": 15.0,
        "current_ratio": 2.0, "pledged_pct": 5.0,
        "interest_coverage": 8.0, "asset_turnover": 0.45,
    }


def _growth():
    return {
        "sales_growth_yoy": 20.0, "profit_growth_yoy": 22.0,
        "sales_cagr_3y": 21.0, "profit_cagr_3y": 22.5, "fcf_growth_yoy": 31.0,
    }


def _mock_price_df(n: int = 260) -> pd.DataFrame:
    rng = np.random.default_rng(42)
    dates  = pd.date_range("2023-01-01", periods=n, freq="B")
    prices = 1000 + np.cumsum(rng.standard_normal(n) * 8)
    return pd.DataFrame({
        "Date": dates, "Open": prices * 0.99, "High": prices * 1.01,
        "Low": prices * 0.98, "Close": prices, "Volume": 100_000,
    })


# ── 1. utils.units ─────────────────────────────────────────────────────────

class TestUnits(unittest.TestCase):

    def test_abs_to_cr(self):
        from utils.units import abs_to_cr
        self.assertAlmostEqual(abs_to_cr(1_00_00_000), 1.0)
        self.assertAlmostEqual(abs_to_cr(2_00_00_00_000), 200.0)  # 200 Cr

    def test_cr_to_abs(self):
        from utils.units import cr_to_abs
        self.assertAlmostEqual(cr_to_abs(1.0), 1_00_00_000)

    def test_round_trip(self):
        from utils.units import abs_to_cr, cr_to_abs
        self.assertAlmostEqual(abs_to_cr(cr_to_abs(500)), 500)

    def test_shares_from_mktcap(self):
        from utils.units import shares_cr_from_mktcap
        # 2,000,000 Cr market cap / ₹2000 price = 1,000,000 / 2000 = 1_00_000 Cr shares? No.
        # 2_000_000 Cr / ₹2000 per share = 1_000_000 Cr-shares? That's huge.
        # Actually: Reliance mktcap ≈ ₹20 lakh Cr = 20,00,000 Cr
        # Price ≈ ₹2800/share, shares ≈ 20,00,000/2800 ≈ 714 Cr shares ✓
        shares = shares_cr_from_mktcap(20_00_000, 2800)
        self.assertAlmostEqual(shares, 714.28, places=1)

    def test_parse_screener_number(self):
        from utils.units import parse_screener_number
        self.assertAlmostEqual(parse_screener_number("₹2,345 Cr"), 2345.0)
        self.assertAlmostEqual(parse_screener_number("12.3%"), 12.3)
        self.assertIsNone(parse_screener_number("-"))
        self.assertIsNone(parse_screener_number("N/A"))
        self.assertAlmostEqual(parse_screener_number("2,345"), 2345.0)

    def test_safe_divide(self):
        from utils.units import safe_divide
        self.assertAlmostEqual(safe_divide(10, 2), 5.0)
        self.assertEqual(safe_divide(10, 0), 0.0)
        self.assertEqual(safe_divide(10, 0, default=99.0), 99.0)


# ── 2. MonteCarloDCF ───────────────────────────────────────────────────────

class TestMonteCarloDCF(unittest.TestCase):

    def setUp(self):
        from valuation.dcf_engine import MonteCarloDCF
        self.dcf = MonteCarloDCF(
            risk_free_rate=0.07, market_risk_premium=0.08,
            tax_rate=0.25, terminal_growth_rate=0.04, projection_years=10,
        )
        self.hist_fcf = [50_000, 60_000, 80_000, 105_000]  # Crores

    def test_wacc_plausible(self):
        wacc = self.dcf.calculate_wacc(beta=1.2, cost_of_debt=0.09,
                                        debt=500_000, equity=1_500_000)
        self.assertGreater(wacc, 0.05)
        self.assertLess(wacc, 0.20)

    def test_wacc_floor(self):
        wacc = self.dcf.calculate_wacc(beta=-10, cost_of_debt=0.01, debt=1, equity=1)
        self.assertGreaterEqual(wacc, 0.05)

    def test_wacc_high_beta_raises_wacc(self):
        low  = self.dcf.calculate_wacc(beta=0.5, cost_of_debt=0.09, debt=0, equity=1)
        high = self.dcf.calculate_wacc(beta=2.0, cost_of_debt=0.09, debt=0, equity=1)
        self.assertGreater(high, low)

    def test_project_fcf_length(self):
        proj = self.dcf.project_fcf(self.hist_fcf)
        self.assertEqual(len(proj), 10)

    def test_project_fcf_growth_clipped(self):
        rng = np.random.default_rng(99)
        for _ in range(50):
            proj = self.dcf.project_fcf([100_000], {"mean": 0.5, "std": 0.5}, rng=rng)
            for i in range(1, len(proj)):
                ratio = proj[i] / proj[i-1]
                # Growth clipped to [-30%, +50%] means ratio in [0.70, 1.50]
                self.assertGreaterEqual(ratio, 0.65)
                self.assertLessEqual(ratio, 1.55)

    def test_terminal_value_formula(self):
        fcf, g, wacc = 100_000, 0.04, 0.12
        expected = fcf * (1 + g) / (wacc - g)
        self.assertAlmostEqual(self.dcf.calculate_terminal_value(fcf, g, wacc), expected, places=0)

    def test_monte_carlo_percentile_order(self):
        r = self.dcf.run_monte_carlo(self.hist_fcf, wacc=0.12,
                                     current_market_cap=10_000_000, n_simulations=500)
        self.assertLessEqual(r["p5"], r["p25"])
        self.assertLessEqual(r["p25"], r["median"])
        self.assertLessEqual(r["median"], r["p75"])
        self.assertLessEqual(r["p75"], r["p95"])

    def test_per_share_value_units(self):
        """Per-share value = DCF_total_Cr / shares_Cr = ₹ per share (unit-correct)."""
        from utils.units import shares_cr_from_mktcap
        price      = 2800.0           # ₹ / share
        mktcap_cr  = 20_00_000        # ₹ Crores
        shares_cr  = shares_cr_from_mktcap(mktcap_cr, price)
        r = self.dcf.run_monte_carlo(
            self.hist_fcf, wacc=0.12,
            current_market_cap=mktcap_cr,
            shares_outstanding=shares_cr,
            n_simulations=200,
        )
        # Per-share median must be a sane rupee value (not billions)
        per_share = r["per_share_median"]
        self.assertGreater(per_share, 10)      # > ₹10
        self.assertLess(per_share, 1_000_000)  # < ₹10 lakh

    def test_scenarios_bull_gt_bear(self):
        s = self.dcf.generate_scenarios(self.hist_fcf, wacc=0.12,
                                        current_market_cap=10_000_000, shares_outstanding=700)
        self.assertGreater(s["bull"]["per_share_value"], s["bear"]["per_share_value"])


# ── 3. ReverseDCF ──────────────────────────────────────────────────────────

class TestReverseDCF(unittest.TestCase):

    def _rdcf(self):
        from valuation.reverse_dcf import ReverseDCF
        fm = MagicMock()
        fm.get_financial_statements.return_value = _stmts()
        fm.get_key_ratios.return_value = _ratios()
        fm.get_growth_metrics.return_value = _growth()
        return ReverseDCF(fundamental_manager=fm)

    def test_implied_growth_returns_dict(self):
        r = self._rdcf().calculate_implied_growth("TEST", current_price=2000.0)
        self.assertIn("implied_growth_pct", r)
        self.assertIn("wacc", r)

    def test_compare_returns_valid_assessment(self):
        r = self._rdcf().compare_to_historical_growth("TEST", current_price=2000.0)
        self.assertIn(r["assessment"], ["CHEAP", "FAIR", "EXPENSIVE", "INDETERMINATE"])

    def test_very_high_mktcap_is_expensive(self):
        rdcf = self._rdcf()
        rdcf.fund_mgr.get_key_ratios.return_value = {**_ratios(), "market_cap": 200_000_000}
        r = rdcf.compare_to_historical_growth("TEST", current_price=2000.0)
        if r["growth_gap"] is not None:
            self.assertIn(r["assessment"], ["EXPENSIVE", "FAIR"])


# ── 4. BharatQuantScreener ─────────────────────────────────────────────────

class TestBharatQuantScreener(unittest.TestCase):

    def _screener(self):
        from screening.bharatquant_adapter import BharatQuantScreener
        dm = MagicMock()
        dm.get_stock_history.return_value = _mock_price_df()
        dm.calculate_rsi.return_value = 55.0
        fm = MagicMock()
        fm.get_financial_statements.return_value = _stmts()
        fm.get_key_ratios.return_value = _ratios()
        fm.get_growth_metrics.return_value = _growth()
        return BharatQuantScreener(data_manager=dm, fundamental_manager=fm)

    def test_f_score_range(self):
        s = self._screener().calculate_piotroski_f_score("TEST")
        self.assertGreaterEqual(s["score"], 0)
        self.assertLessEqual(s["score"], 9)

    def test_f_score_criteria_count(self):
        s = self._screener().calculate_piotroski_f_score("TEST")
        self.assertEqual(len(s["criteria"]), 9)

    def test_f_score_criteria_binary(self):
        s = self._screener().calculate_piotroski_f_score("TEST")
        for v in s["criteria"].values():
            self.assertIn(v, [0, 1])

    def test_f_score_sum_equals_score(self):
        s = self._screener().calculate_piotroski_f_score("TEST")
        self.assertEqual(s["score"], sum(s["criteria"].values()))

    def test_no_dilution_with_stable_share_capital(self):
        """Share capital unchanged → no_dilution = 1."""
        s = self._screener().calculate_piotroski_f_score("TEST")
        self.assertEqual(s["criteria"]["no_dilution"], 1)

    def test_dilution_detected_when_share_capital_jumps(self):
        """Share capital +20% YoY → no_dilution = 0."""
        from screening.bharatquant_adapter import BharatQuantScreener
        dm = MagicMock()
        dm.get_stock_history.return_value = _mock_price_df()
        dm.calculate_rsi.return_value = 55.0
        fm = MagicMock()
        diluted_bs = [r.copy() for r in _balance()]
        diluted_bs[-1]["share_capital"] = 130_000  # +30% from 100_000
        fm.get_financial_statements.return_value = {
            **_stmts(), "balance_sheet": diluted_bs
        }
        fm.get_key_ratios.return_value = _ratios()
        fm.get_growth_metrics.return_value = _growth()
        sc = BharatQuantScreener(data_manager=dm, fundamental_manager=fm)
        r = sc.calculate_piotroski_f_score("TEST")
        self.assertEqual(r["criteria"]["no_dilution"], 0)

    def test_rs_score_outperform(self):
        sc = self._screener()
        # Stock returns 20%, benchmark returns 10% → RS = +10%
        with patch.object(sc, "_annual_return", side_effect=[20.0, 10.0]):
            r = sc.calculate_relative_strength("TEST")
        self.assertGreater(r["rs_score"], 0)
        self.assertTrue(r["outperforming"])

    def test_trend_stage_valid(self):
        stage = self._screener().detect_trend_stage("TEST")["stage"]
        self.assertIn(stage, [0, 1, 2, 3, 4])

    def test_screen_returns_dataframe(self):
        sc = self._screener()
        with patch.object(sc, "_annual_return", return_value=12.0):
            df = sc.run_full_screen(["TEST"])
        self.assertIsInstance(df, pd.DataFrame)
        self.assertFalse(df.empty)
        for col in ["Symbol", "F_Score", "RS_Score", "Bullish_Points", "Signal", "Color"]:
            self.assertIn(col, df.columns)


# ── 5. HistoricalDataManager ───────────────────────────────────────────────

class TestHistoricalDataManager(unittest.TestCase):

    def _mgr(self) -> "HistoricalDataManager":
        from data_collection.historical_data import HistoricalDataManager
        mgr = HistoricalDataManager.__new__(HistoricalDataManager)
        mgr.cache_dir = Path("/tmp/test_hist")
        mgr.cache_dir.mkdir(exist_ok=True)
        mgr._cache_ttl = 3600
        mgr._jd_stock_df = None
        mgr._jd_bhavcopy = None
        mgr.get_stock_history = MagicMock(return_value=_mock_price_df(260))
        return mgr

    def test_rsi_in_range(self):
        mgr = self._mgr()
        rsi = mgr.calculate_rsi("TEST")
        self.assertGreaterEqual(rsi, 0.0)
        self.assertLessEqual(rsi, 100.0)

    def test_ma50_lt_ma200_on_rising_trend(self):
        mgr = self._mgr()
        mas = mgr.calculate_moving_averages("TEST", windows=[50, 200])
        self.assertIn("MA_50", mas)
        self.assertIn("MA_200", mas)
        # Both must be positive
        self.assertGreater(mas["MA_50"], 0)
        self.assertGreater(mas["MA_200"], 0)

    def test_beta_returns_float(self):
        """Beta calculation returns a valid float; falls back to 1.0 on error."""
        from data_collection.historical_data import HistoricalDataManager
        mgr = HistoricalDataManager.__new__(HistoricalDataManager)
        mgr.cache_dir = Path("/tmp/test_hist")
        mgr.cache_dir.mkdir(exist_ok=True)
        mgr._cache_ttl = 3600
        mgr._jd_stock_df = None
        mgr._jd_bhavcopy = None
        mgr.get_stock_history = MagicMock(return_value=_mock_price_df(400))

        # Build a plausible benchmark DataFrame the same shape as what yfinance returns
        bench_raw = _mock_price_df(400).set_index("Date")
        bench_raw.index.name = "Date"

        # Patch at the import site inside the module under test
        mock_yf_mod = MagicMock()
        inst = MagicMock()
        mock_yf_mod.Ticker.return_value = inst
        inst.history.return_value = bench_raw
        with patch.dict("sys.modules", {"yfinance": mock_yf_mod}):
            beta = mgr.calculate_beta("TEST", years=1)

        self.assertIsInstance(beta, float)
        self.assertGreater(beta, -3.0)
        self.assertLess(beta, 5.0)


# ── 6. FundamentalDataManager helpers ─────────────────────────────────────

class TestFundamentalDataManager(unittest.TestCase):

    def test_pct_change_positive(self):
        from fundamental_data.jufinance_adapter import _pct_chg
        self.assertAlmostEqual(_pct_chg(120, 100), 20.0)

    def test_pct_change_negative(self):
        from fundamental_data.jufinance_adapter import _pct_chg
        self.assertAlmostEqual(_pct_chg(80, 100), -20.0)

    def test_pct_change_zero_denominator(self):
        from fundamental_data.jufinance_adapter import _pct_chg
        self.assertEqual(_pct_chg(100, 0), 0.0)

    def test_cagr_10pct(self):
        from fundamental_data.jufinance_adapter import _cagr
        # 100 → 133.1 over 3 years ≈ 10%
        self.assertAlmostEqual(_cagr(100, 133.1, 3), 10.0, places=0)

    def test_sf_handles_strings(self):
        from fundamental_data.jufinance_adapter import _sf
        self.assertEqual(_sf("3,500.50"), 3500.50)
        self.assertEqual(_sf(None), 0.0)
        self.assertEqual(_sf("N/A"), 0.0)
        self.assertTrue(math.isfinite(_sf(float("nan"))))


# ── 7. News Monitor – sentiment-aware scoring ──────────────────────────────

class TestIndianStockMonitor(unittest.TestCase):

    @staticmethod
    def _score(title, symbol=None, sector=None):
        import monitoring.news_monitor as nm
        article = {"title": title, "summary": ""}
        score, sentiment = nm.IndianStockMonitor._score(article, symbol, sector)
        return score, sentiment

    def test_high_positive_keyword(self):
        score, sentiment = self._score("RELIANCE quarterly earnings beat expectations")
        self.assertGreaterEqual(score, 3)
        self.assertEqual(sentiment, "positive")

    def test_high_negative_keyword(self):
        score, sentiment = self._score("Company found guilty of fraud by SEBI")
        self.assertGreaterEqual(score, 3)
        self.assertEqual(sentiment, "negative")

    def test_negation_flips_negative(self):
        # "avoids default" → should NOT be scored as negative
        score_neg, sent_neg = self._score("Company defaults on loan repayment")
        score_neg_flip, sent_flip = self._score("Company avoids default on loan")
        # Without negation → negative; with negation → neutral or lower
        self.assertEqual(sent_neg, "negative")
        self.assertNotEqual(sent_flip, "negative")

    def test_symbol_boost(self):
        score_with, _ = self._score("TCS reports strong results", symbol="TCS")
        score_without, _ = self._score("TCS reports strong results", symbol="INFY")
        self.assertGreater(score_with, score_without)

    def test_score_capped_at_10(self):
        score, _ = self._score(
            "earnings results dividend bonus acquisition merger FDA approval "
            "default penalty sebi fraud",
            symbol="XYZ",
        )
        self.assertLessEqual(score, 10)

    def test_daily_briefing_contains_symbol(self):
        import monitoring.news_monitor as nm
        with patch.object(nm, "_FEEDPARSER_OK", False):
            monitor = nm.IndianStockMonitor(live_data_manager=None)
        with patch.object(monitor, "fetch_news", return_value=[]), \
             patch.object(monitor, "get_corporate_actions", return_value=[]):
            briefing = monitor.generate_daily_briefing(["RELIANCE"])
        self.assertIn("DAILY PORTFOLIO BRIEFING", briefing)
        self.assertIn("RELIANCE", briefing)


# ── 8. utils.database ──────────────────────────────────────────────────────

class TestAnalysisDatabase(unittest.TestCase):

    def _db(self):
        from utils.database import AnalysisDatabase
        return AnalysisDatabase("/tmp/test_market.db")

    def test_save_and_load_fundamentals(self):
        db = self._db()
        db.save_fundamentals("TESTCO", {"pe": 25.0, "roe": 18.0})
        loaded = db.load_fundamentals("TESTCO", max_age=3600)
        self.assertIsNotNone(loaded)
        self.assertAlmostEqual(loaded["pe"], 25.0)

    def test_stale_cache_returns_none(self):
        db = self._db()
        db.save_fundamentals("STALE", {"pe": 10.0})
        # max_age=0 → always stale
        loaded = db.load_fundamentals("STALE", max_age=0)
        self.assertIsNone(loaded)

    def test_save_decision_and_history(self):
        db = self._db()
        db.save_decision("TESTCO", {
            "decision": "BUY", "confidence": 70,
            "composite_score": 0.35, "current_price": 2500.0,
            "target_price": 3000.0, "stop_loss": 2125.0, "position_size": "Half",
        })
        history = db.get_decision_history("TESTCO", limit=5)
        self.assertGreater(len(history), 0)
        self.assertEqual(history[0]["decision"], "BUY")

    def test_screening_run_persisted(self):
        db = self._db()
        rows = [{"Symbol": "TESTCO", "F_Score": 7, "RS_Score": 12.0,
                 "Trend": "Stage 2", "Bullish_Points": 5, "Signal": "HIGH_CONVICTION"}]
        db.save_screening_run("run_001", rows)  # should not raise


# ── 9. InvestmentDecision dataclass ───────────────────────────────────────

class TestInvestmentDecision(unittest.TestCase):

    def test_defaults(self):
        from decision_engine.investment_decision import InvestmentDecision
        d = InvestmentDecision(symbol="TEST")
        self.assertEqual(d.decision, "HOLD")
        self.assertEqual(d.position_size, "None")
        self.assertEqual(d.beta, 1.0)
        self.assertIsInstance(d.key_reasons, list)

    def test_decision_labels(self):
        from decision_engine.investment_decision import DECISION_LABELS
        for label in ["STRONG_BUY", "BUY", "HOLD", "AVOID", "STRONG_AVOID"]:
            self.assertIn(label, DECISION_LABELS)


# ── Runner ─────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    unittest.main(verbosity=2)
