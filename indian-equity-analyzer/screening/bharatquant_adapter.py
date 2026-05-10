"""
BharatQuant Screening Adapter.
Implements Piotroski F-Score, Relative Strength, Trend Stage detection,
and a full multi-factor universe screen – inspired by BharatQuant methodology.
"""
import logging
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)


class BharatQuantScreener:
    """
    Quantitative stock screener for Indian equities.

    Attributes:
        data_mgr:  HistoricalDataManager instance.
        fund_mgr:  FundamentalDataManager instance.
    """

    def __init__(self, data_manager, fundamental_manager):
        self.data_mgr = data_manager
        self.fund_mgr = fundamental_manager

    # ------------------------------------------------------------------
    # Piotroski F-Score  (9 binary criteria → 0-9 score)
    # ------------------------------------------------------------------

    def calculate_piotroski_f_score(self, symbol: str) -> Dict[str, Any]:
        """
        Compute the full 9-point Piotroski F-Score for *symbol*.

        Returns a dict with:
          score         (int, 0-9)
          criteria      (dict of each criterion name → 0 or 1)
          details       (dict of raw values used)
          interpretation (str)
        """
        criteria: Dict[str, int] = {}
        details: Dict[str, float] = {}

        try:
            stmts = self.fund_mgr.get_financial_statements(symbol)
            ratios = self.fund_mgr.get_key_ratios(symbol)
            income = stmts.get("income_statement", [])
            balance = stmts.get("balance_sheet", [])
            cash_flow = stmts.get("cash_flow", [])

            # --- Profitability (4 criteria) ---
            # 1. ROA > 0 (Net Income / Total Assets)
            roa_curr = self._roa(income, balance, -1)
            details["roa_current"] = roa_curr
            criteria["positive_roa"] = 1 if roa_curr > 0 else 0

            # 2. Operating Cash Flow > 0
            ocf_curr = self._last_value(cash_flow, "operating_cash_flow")
            details["operating_cash_flow"] = ocf_curr
            criteria["positive_ocf"] = 1 if ocf_curr > 0 else 0

            # 3. ROA improving (current > prior year)
            roa_prev = self._roa(income, balance, -2)
            details["roa_prior"] = roa_prev
            criteria["roa_improving"] = 1 if roa_curr > roa_prev else 0

            # 4. Accrual quality: OCF > Net Income (cash earnings quality)
            net_inc_curr = self._last_value(income, "net_income")
            details["net_income"] = net_inc_curr
            total_assets = self._last_value(balance, "total_assets") or 1
            criteria["ocf_gt_net_income"] = (
                1 if (ocf_curr / total_assets) > (net_inc_curr / total_assets) else 0
            )

            # --- Leverage / Liquidity (3 criteria) ---
            # 5. Long-term debt ratio decreasing
            debt_curr = self._debt_ratio(balance, -1)
            debt_prev = self._debt_ratio(balance, -2)
            details["debt_ratio_current"] = debt_curr
            details["debt_ratio_prior"] = debt_prev
            criteria["debt_decreasing"] = 1 if debt_curr < debt_prev else 0

            # 6. Current ratio improving
            cr_curr = self._current_ratio(balance, -1)
            cr_prev = self._current_ratio(balance, -2)
            details["current_ratio_current"] = cr_curr
            details["current_ratio_prior"] = cr_prev
            criteria["current_ratio_improving"] = 1 if cr_curr > cr_prev else 0

            # 7. No new equity dilution (shares outstanding not increasing significantly)
            shares_issued = self._detect_equity_issuance(balance, cash_flow)
            details["new_equity_issued"] = shares_issued
            criteria["no_dilution"] = 0 if shares_issued else 1

            # --- Operating Efficiency (2 criteria) ---
            # 8. Gross margin improving
            gm_curr = self._gross_margin(income, -1)
            gm_prev = self._gross_margin(income, -2)
            details["gross_margin_current"] = gm_curr
            details["gross_margin_prior"] = gm_prev
            criteria["gross_margin_improving"] = 1 if gm_curr > gm_prev else 0

            # 9. Asset turnover improving
            at_curr = self._asset_turnover(income, balance, -1)
            at_prev = self._asset_turnover(income, balance, -2)
            details["asset_turnover_current"] = at_curr
            details["asset_turnover_prior"] = at_prev
            criteria["asset_turnover_improving"] = 1 if at_curr > at_prev else 0

        except Exception as exc:
            logger.warning("Piotroski F-Score calculation failed for %s: %s", symbol, exc)
            for c in [
                "positive_roa", "positive_ocf", "roa_improving", "ocf_gt_net_income",
                "debt_decreasing", "current_ratio_improving", "no_dilution",
                "gross_margin_improving", "asset_turnover_improving",
            ]:
                criteria.setdefault(c, 0)

        score = sum(criteria.values())

        if score >= 8:
            interpretation = "Excellent – Strong financial health"
        elif score >= 6:
            interpretation = "Good – Solid fundamentals"
        elif score >= 4:
            interpretation = "Average – Mixed signals"
        elif score >= 2:
            interpretation = "Weak – Deteriorating fundamentals"
        else:
            interpretation = "Very Weak – High financial distress"

        return {
            "score": score,
            "criteria": criteria,
            "details": details,
            "interpretation": interpretation,
        }

    # ------------------------------------------------------------------
    # Relative Strength
    # ------------------------------------------------------------------

    def calculate_relative_strength(
        self, symbol: str, benchmark: str = "^NSEI"
    ) -> Dict[str, float]:
        """
        Compute 1-year relative strength of *symbol* vs *benchmark*.

        Returns: rs_score (stock return - benchmark return), both raw returns.
        """
        try:
            stock_ret = self._annual_return(symbol)
            bench_ret = self._annual_return(benchmark, is_index=True)

            rs_score = stock_ret - bench_ret

            return {
                "rs_score": round(rs_score, 2),
                "stock_return_1y": round(stock_ret, 2),
                "benchmark_return_1y": round(bench_ret, 2),
                "outperforming": rs_score > 0,
            }
        except Exception as exc:
            logger.warning("Relative strength failed for %s: %s", symbol, exc)
            return {
                "rs_score": 0.0,
                "stock_return_1y": 0.0,
                "benchmark_return_1y": 0.0,
                "outperforming": False,
            }

    # ------------------------------------------------------------------
    # Trend Stage Detection
    # ------------------------------------------------------------------

    def detect_trend_stage(self, symbol: str) -> Dict[str, Any]:
        """
        Identify Weinstein Trend Stage using 50-DMA and 200-DMA.

        Stage 1: Base      – 50DMA < 200DMA, price sideways
        Stage 2: Advancing – 50DMA > 200DMA, price > 50DMA  (BULLISH)
        Stage 3: Top       – Distribution, weakening momentum
        Stage 4: Declining – 50DMA < 200DMA, price < 50DMA  (BEARISH)
        """
        try:
            df = self.data_mgr.get_stock_history(symbol, years=2)
            if df.empty or len(df) < 200:
                return self._unknown_trend(symbol)

            close = df["Close"].values
            ma50 = float(np.mean(close[-50:]))
            ma200 = float(np.mean(close[-200:]))
            current_price = float(close[-1])
            rsi = self.data_mgr.calculate_rsi(symbol)

            # Slope of 50-DMA over last 20 sessions
            ma50_series = pd.Series(close).rolling(50).mean().dropna()
            slope_50 = float(
                (ma50_series.iloc[-1] - ma50_series.iloc[-20]) / ma50_series.iloc[-20] * 100
            ) if len(ma50_series) >= 20 else 0.0

            if ma50 > ma200:
                if current_price > ma50:
                    stage = 2
                    stage_name = "Stage 2 – Advancing (BULLISH)"
                    signal = "BULLISH"
                else:
                    stage = 3
                    stage_name = "Stage 3 – Top (Caution)"
                    signal = "CAUTION"
            else:
                if current_price < ma50:
                    stage = 4
                    stage_name = "Stage 4 – Declining (BEARISH)"
                    signal = "BEARISH"
                else:
                    stage = 1
                    stage_name = "Stage 1 – Base (Neutral)"
                    signal = "NEUTRAL"

            return {
                "stage": stage,
                "stage_name": stage_name,
                "signal": signal,
                "ma50": round(ma50, 2),
                "ma200": round(ma200, 2),
                "current_price": round(current_price, 2),
                "rsi": round(rsi, 2),
                "slope_50dma_pct": round(slope_50, 2),
                "golden_cross": ma50 > ma200,
            }
        except Exception as exc:
            logger.warning("Trend stage detection failed for %s: %s", symbol, exc)
            return self._unknown_trend(symbol)

    # ------------------------------------------------------------------
    # Full Universe Screen
    # ------------------------------------------------------------------

    def run_full_screen(self, universe: List[str]) -> pd.DataFrame:
        """
        Screen a universe of stocks and rank by conviction.

        Returns a DataFrame with columns:
          Symbol, F_Score, RS_Score, Trend, Sales_Growth, Profit_Growth,
          PE, ROE, ROCE, D_E, Signal, Bullish_Points, Color
        """
        rows = []

        for symbol in universe:
            logger.info("Screening %s…", symbol)
            try:
                f_result = self.calculate_piotroski_f_score(symbol)
                rs_result = self.calculate_relative_strength(symbol)
                trend_result = self.detect_trend_stage(symbol)
                ratios = self.fund_mgr.get_key_ratios(symbol)
                growth = self.fund_mgr.get_growth_metrics(symbol)

                f_score = f_result["score"]
                rs_score = rs_result["rs_score"]
                trend_stage = trend_result["stage"]
                sales_growth = growth["sales_growth_yoy"]
                profit_growth = growth["profit_growth_yoy"]
                pe = ratios.get("pe", 0)
                roe = ratios.get("roe", 0)
                roce = ratios.get("roce", 0)
                de = ratios.get("debt_equity", 0)
                promoter = ratios.get("promoter_holding", 0)
                pledged = ratios.get("pledged_pct", 0)
                rsi = trend_result.get("rsi", 50)

                # --- Conviction Scoring ---
                bullish_points = 0
                if rs_score > 0:
                    bullish_points += 1
                if f_score >= 7:
                    bullish_points += 1
                if sales_growth > 20:
                    bullish_points += 1
                if profit_growth > 20:
                    bullish_points += 1
                if roe > 15:
                    bullish_points += 1
                if trend_stage == 2:
                    bullish_points += 1

                # --- Bearish deductions ---
                if f_score <= 3:
                    bullish_points -= 2
                if sales_growth < 0:
                    bullish_points -= 1
                if profit_growth < 0:
                    bullish_points -= 1
                if de > 2:
                    bullish_points -= 1
                if pledged > 30:
                    bullish_points -= 1

                # --- Color coding ---
                if bullish_points >= 4:
                    color = "GREEN"
                    signal = "HIGH_CONVICTION"
                elif bullish_points <= 0:
                    color = "RED"
                    signal = "BEARISH"
                elif rsi > 70 or rsi < 30:
                    color = "YELLOW"
                    signal = "CAUTION"
                else:
                    color = "YELLOW"
                    signal = "NEUTRAL"

                rows.append({
                    "Symbol": symbol,
                    "F_Score": f_score,
                    "RS_Score": round(rs_score, 2),
                    "Trend": trend_result["stage_name"],
                    "Sales_Growth": round(sales_growth, 2),
                    "Profit_Growth": round(profit_growth, 2),
                    "PE": round(pe, 2),
                    "ROE": round(roe, 2),
                    "ROCE": round(roce, 2),
                    "D_E": round(de, 2),
                    "Promoter_Holding": round(promoter, 2),
                    "Pledged_Pct": round(pledged, 2),
                    "RSI": round(rsi, 2),
                    "Bullish_Points": bullish_points,
                    "Signal": signal,
                    "Color": color,
                })

            except Exception as exc:
                logger.error("Screen failed for %s: %s", symbol, exc)
                rows.append({
                    "Symbol": symbol, "F_Score": 0, "RS_Score": 0.0,
                    "Trend": "Unknown", "Sales_Growth": 0.0, "Profit_Growth": 0.0,
                    "PE": 0.0, "ROE": 0.0, "ROCE": 0.0, "D_E": 0.0,
                    "Promoter_Holding": 0.0, "Pledged_Pct": 0.0, "RSI": 50.0,
                    "Bullish_Points": 0, "Signal": "ERROR", "Color": "GREY",
                })

        df = pd.DataFrame(rows)
        if not df.empty:
            df = df.sort_values("Bullish_Points", ascending=False).reset_index(drop=True)
        return df

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _annual_return(self, symbol: str, is_index: bool = False) -> float:
        """Calculate 1-year price return for a stock or index."""
        try:
            if is_index:
                # Map common index names to yfinance tickers
                index_map = {"^NSEI": "^NSEI", "NIFTY 50": "^NSEI", "SENSEX": "^BSESN"}
                yf_symbol = index_map.get(symbol, symbol)
                import yfinance as yf
                from datetime import datetime, timedelta
                end = datetime.now()
                start = end - timedelta(days=380)
                hist = yf.Ticker(yf_symbol).history(start=start, end=end)
                if hist.empty:
                    return 10.0  # approximate Nifty long-run return
                price_now = float(hist["Close"].iloc[-1])
                price_year_ago = float(hist["Close"].iloc[0])
            else:
                df = self.data_mgr.get_stock_history(symbol, years=2)
                if df.empty or len(df) < 252:
                    return 0.0
                price_now = float(df["Close"].iloc[-1])
                price_year_ago = float(df["Close"].iloc[-252])

            if price_year_ago <= 0:
                return 0.0
            return (price_now - price_year_ago) / price_year_ago * 100
        except Exception as exc:
            logger.debug("Annual return calc failed for %s: %s", symbol, exc)
            return 0.0

    @staticmethod
    def _last_value(lst: List[Dict], key: str, idx: int = -1) -> float:
        """Safely extract a float value from a list of statement dicts."""
        try:
            return float(lst[idx].get(key, 0) or 0)
        except (IndexError, TypeError, ValueError):
            return 0.0

    def _roa(
        self, income: List[Dict], balance: List[Dict], idx: int
    ) -> float:
        net_income = self._last_value(income, "net_income", idx)
        total_assets = self._last_value(balance, "total_assets", idx) or 1
        return net_income / total_assets

    def _debt_ratio(self, balance: List[Dict], idx: int) -> float:
        total_debt = self._last_value(balance, "total_debt", idx)
        total_assets = self._last_value(balance, "total_assets", idx) or 1
        return total_debt / total_assets

    def _current_ratio(self, balance: List[Dict], idx: int) -> float:
        ca = self._last_value(balance, "current_assets", idx)
        cl = self._last_value(balance, "current_liabilities", idx) or 1
        return ca / cl

    def _gross_margin(self, income: List[Dict], idx: int) -> float:
        revenue = self._last_value(income, "revenue", idx) or 1
        gross = self._last_value(income, "gross_profit", idx)
        return gross / revenue

    def _asset_turnover(
        self, income: List[Dict], balance: List[Dict], idx: int
    ) -> float:
        revenue = self._last_value(income, "revenue", idx)
        total_assets = self._last_value(balance, "total_assets", idx) or 1
        return revenue / total_assets

    @staticmethod
    def _detect_equity_issuance(
        balance: List[Dict], cash_flow: List[Dict]
    ) -> bool:
        """Heuristic: financing CF > 0 and equity raised via share issuance."""
        try:
            if len(cash_flow) < 2:
                return False
            fin_cf = float(cash_flow[-1].get("financing_cash_flow", 0) or 0)
            # Positive financing CF often indicates equity/debt raising
            equity_curr = float(balance[-1].get("total_equity", 1) or 1)
            equity_prev = float(balance[-2].get("total_equity", 1) or 1)
            equity_growth = (equity_curr - equity_prev) / equity_prev if equity_prev > 0 else 0
            # Flag if equity grew by more than 10% (dilution likely)
            return equity_growth > 0.10 and fin_cf > 0
        except Exception:
            return False

    @staticmethod
    def _unknown_trend(symbol: str) -> Dict[str, Any]:
        return {
            "stage": 0, "stage_name": "Unknown",
            "signal": "NEUTRAL", "ma50": 0.0, "ma200": 0.0,
            "current_price": 0.0, "rsi": 50.0,
            "slope_50dma_pct": 0.0, "golden_cross": False,
        }
