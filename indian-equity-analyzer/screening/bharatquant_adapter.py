"""
BharatQuant Screening Adapter.
Implements Piotroski F-Score (all 9 criteria correctly), Relative Strength,
Weinstein Trend Stage detection, and a full multi-factor universe screen.

Key fix: Criterion 7 (equity dilution) now uses Share Capital change from
the balance sheet instead of the unreliable financing CF heuristic.
"""
import logging
import math
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)


class BharatQuantScreener:
    """
    Quantitative stock screener for Indian equities.

    Args:
        data_manager:        HistoricalDataManager instance.
        fundamental_manager: FundamentalDataManager instance.
    """

    def __init__(self, data_manager, fundamental_manager):
        self.data_mgr = data_manager
        self.fund_mgr = fundamental_manager

    # ------------------------------------------------------------------
    # Piotroski F-Score  (9 binary criteria → 0-9)
    # ------------------------------------------------------------------

    def calculate_piotroski_f_score(self, symbol: str) -> Dict[str, Any]:
        """
        Compute the 9-point Piotroski F-Score.

        Returns:
            score (int 0-9), criteria (dict name→0/1),
            details (raw values), interpretation (str).
        """
        criteria: Dict[str, int] = {}
        details:  Dict[str, float] = {}

        try:
            stmts  = self.fund_mgr.get_financial_statements(symbol)
            income = stmts.get("income_statement", [])
            bal    = stmts.get("balance_sheet", [])
            cf     = stmts.get("cash_flow", [])

            # ---- Profitability (4 criteria) ----

            # 1. ROA > 0
            roa_curr = _roa(income, bal, -1)
            details["roa_current"] = roa_curr
            criteria["positive_roa"] = 1 if roa_curr > 0 else 0

            # 2. Operating Cash Flow > 0
            ocf_curr = _lv(cf, -1, "operating_cash_flow")
            details["operating_cash_flow"] = ocf_curr
            criteria["positive_ocf"] = 1 if ocf_curr > 0 else 0

            # 3. ROA improving YoY
            roa_prev = _roa(income, bal, -2)
            details["roa_prior"] = roa_prev
            criteria["roa_improving"] = 1 if roa_curr > roa_prev else 0

            # 4. Accrual ratio: OCF/Assets > Net Income/Assets
            total_assets = _lv(bal, -1, "total_assets") or 1
            ni_curr      = _lv(income, -1, "net_income")
            details["net_income"] = ni_curr
            criteria["ocf_gt_net_income"] = (
                1 if (ocf_curr / total_assets) > (ni_curr / total_assets) else 0
            )

            # ---- Leverage / Liquidity (3 criteria) ----

            # 5. Long-term debt / total assets decreasing
            dr_curr = _debt_ratio(bal, -1)
            dr_prev = _debt_ratio(bal, -2)
            details["debt_ratio_current"] = dr_curr
            details["debt_ratio_prior"]   = dr_prev
            criteria["debt_decreasing"] = 1 if dr_curr < dr_prev else 0

            # 6. Current ratio improving
            cr_curr = _current_ratio(bal, -1)
            cr_prev = _current_ratio(bal, -2)
            details["current_ratio_current"] = cr_curr
            details["current_ratio_prior"]   = cr_prev
            criteria["current_ratio_improving"] = 1 if cr_curr > cr_prev else 0

            # 7. No new share issuance  — use Share Capital change
            #    (fixed: was using financing CF heuristic which flags profitable
            #     companies as diluting due to retained-earnings equity growth)
            sc_curr = _lv(bal, -1, "share_capital")
            sc_prev = _lv(bal, -2, "share_capital")
            details["share_capital_current"] = sc_curr
            details["share_capital_prior"]   = sc_prev
            if sc_curr > 0 and sc_prev > 0:
                dilution = (sc_curr - sc_prev) / sc_prev > 0.02  # > 2 % new shares
            else:
                dilution = False  # insufficient data → assume no dilution
            criteria["no_dilution"] = 0 if dilution else 1

            # ---- Operating Efficiency (2 criteria) ----

            # 8. Gross margin improving
            gm_curr = _gross_margin(income, -1)
            gm_prev = _gross_margin(income, -2)
            details["gross_margin_current"] = gm_curr
            details["gross_margin_prior"]   = gm_prev
            criteria["gross_margin_improving"] = 1 if gm_curr > gm_prev else 0

            # 9. Asset turnover improving
            at_curr = _asset_turnover(income, bal, -1)
            at_prev = _asset_turnover(income, bal, -2)
            details["asset_turnover_current"] = at_curr
            details["asset_turnover_prior"]   = at_prev
            criteria["asset_turnover_improving"] = 1 if at_curr > at_prev else 0

        except Exception as exc:
            logger.warning("F-Score failed for %s: %s", symbol, exc)
            for c in (
                "positive_roa", "positive_ocf", "roa_improving", "ocf_gt_net_income",
                "debt_decreasing", "current_ratio_improving", "no_dilution",
                "gross_margin_improving", "asset_turnover_improving",
            ):
                criteria.setdefault(c, 0)

        score = sum(criteria.values())
        interpretation = (
            "Excellent"  if score >= 8 else
            "Good"       if score >= 6 else
            "Average"    if score >= 4 else
            "Weak"       if score >= 2 else
            "Very Weak"
        )
        return {"score": score, "criteria": criteria, "details": details,
                "interpretation": interpretation}

    # ------------------------------------------------------------------
    # Relative Strength
    # ------------------------------------------------------------------

    def calculate_relative_strength(
        self, symbol: str, benchmark: str = "^NSEI"
    ) -> Dict[str, float]:
        """
        Compute 1-year relative strength vs *benchmark*.
        Returns: rs_score, stock_return_1y, benchmark_return_1y, outperforming.
        """
        try:
            stock_ret = self._annual_return(symbol)
            bench_ret = self._annual_return(benchmark, is_index=True)
            rs = stock_ret - bench_ret
            return {
                "rs_score":            round(rs, 2),
                "stock_return_1y":     round(stock_ret, 2),
                "benchmark_return_1y": round(bench_ret, 2),
                "outperforming":       rs > 0,
            }
        except Exception as exc:
            logger.warning("RS score failed for %s: %s", symbol, exc)
            return {"rs_score": 0.0, "stock_return_1y": 0.0,
                    "benchmark_return_1y": 0.0, "outperforming": False}

    # ------------------------------------------------------------------
    # Trend Stage (Weinstein)
    # ------------------------------------------------------------------

    def detect_trend_stage(self, symbol: str) -> Dict[str, Any]:
        """
        Classify the stock's Weinstein Trend Stage using 50/200 DMA.

        Stage 1: Base      (50DMA < 200DMA, consolidating)
        Stage 2: Advancing (50DMA > 200DMA, price > 50DMA)   BULLISH
        Stage 3: Top       (distribution, momentum fading)
        Stage 4: Declining (50DMA < 200DMA, price < 50DMA)   BEARISH
        """
        try:
            df = self.data_mgr.get_stock_history(symbol, years=2)
            if df.empty or len(df) < 200:
                return _unknown_trend()

            close = df["Close"].values
            ma50  = float(np.mean(close[-50:]))
            ma200 = float(np.mean(close[-200:]))
            price = float(close[-1])

            # 20-session slope of 50-DMA
            ma50_series = pd.Series(close).rolling(50).mean().dropna()
            slope_50 = 0.0
            if len(ma50_series) >= 20:
                slope_50 = float(
                    (ma50_series.iloc[-1] - ma50_series.iloc[-20])
                    / ma50_series.iloc[-20] * 100
                )

            rsi = self.data_mgr.calculate_rsi(symbol)

            if ma50 > ma200:
                if price > ma50:
                    stage, label, signal = 2, "Stage 2 – Advancing (BULLISH)", "BULLISH"
                else:
                    stage, label, signal = 3, "Stage 3 – Top (Caution)", "CAUTION"
            else:
                if price < ma50:
                    stage, label, signal = 4, "Stage 4 – Declining (BEARISH)", "BEARISH"
                else:
                    stage, label, signal = 1, "Stage 1 – Base (Neutral)", "NEUTRAL"

            return {
                "stage":          stage,
                "stage_name":     label,
                "signal":         signal,
                "ma50":           round(ma50, 2),
                "ma200":          round(ma200, 2),
                "current_price":  round(price, 2),
                "rsi":            round(rsi, 2),
                "slope_50dma_pct": round(slope_50, 2),
                "golden_cross":   ma50 > ma200,
            }
        except Exception as exc:
            logger.warning("Trend detection failed for %s: %s", symbol, exc)
            return _unknown_trend()

    # ------------------------------------------------------------------
    # Sector-relative PE
    # ------------------------------------------------------------------

    def sector_relative_pe(self, symbol: str, peers: List[str]) -> Dict[str, float]:
        """
        Compare *symbol*'s PE to the median PE of *peers*.

        Returns: symbol_pe, sector_median_pe, pe_premium_pct.
        """
        try:
            ratios  = self.fund_mgr.get_key_ratios(symbol)
            sym_pe  = ratios.get("pe", 0.0)
            peer_pes = []
            for peer in peers:
                if peer != symbol:
                    try:
                        pr = self.fund_mgr.get_key_ratios(peer)
                        pe = pr.get("pe", 0.0)
                        if 1 < pe < 300:
                            peer_pes.append(pe)
                    except Exception:
                        pass
            if not peer_pes:
                return {"symbol_pe": sym_pe, "sector_median_pe": 0.0, "pe_premium_pct": 0.0}
            median_pe = float(np.median(peer_pes))
            premium   = (sym_pe - median_pe) / median_pe * 100 if median_pe else 0.0
            return {
                "symbol_pe":       round(sym_pe, 1),
                "sector_median_pe": round(median_pe, 1),
                "pe_premium_pct":  round(premium, 1),
            }
        except Exception as exc:
            logger.warning("Sector PE failed for %s: %s", symbol, exc)
            return {"symbol_pe": 0.0, "sector_median_pe": 0.0, "pe_premium_pct": 0.0}

    # ------------------------------------------------------------------
    # Full Universe Screen
    # ------------------------------------------------------------------

    def run_full_screen(self, universe: List[str]) -> pd.DataFrame:
        """
        Screen *universe* and rank by conviction (Bullish_Points).

        Columns: Symbol, F_Score, RS_Score, Trend, Sales_Growth,
                 Profit_Growth, PE, ROE, ROCE, D_E, Promoter_Holding,
                 Pledged_Pct, RSI, Bullish_Points, Signal, Color.
        """
        rows = []
        for symbol in universe:
            logger.info("Screening %s…", symbol)
            try:
                f_r   = self.calculate_piotroski_f_score(symbol)
                rs_r  = self.calculate_relative_strength(symbol)
                tr_r  = self.detect_trend_stage(symbol)
                rats  = self.fund_mgr.get_key_ratios(symbol)
                grow  = self.fund_mgr.get_growth_metrics(symbol)

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

                # --- Conviction scoring ---
                pts = 0
                if rs > 0:       pts += 1
                if f_score >= 7: pts += 1
                if sal_g > 20:   pts += 1
                if prf_g > 20:   pts += 1
                if roe > 15:     pts += 1
                if stage == 2:   pts += 1
                if roce > 20:    pts += 1

                # Bearish deductions
                if f_score <= 3:  pts -= 2
                if sal_g < 0:     pts -= 1
                if prf_g < 0:     pts -= 1
                if de > 2.0:      pts -= 1
                if pledge > 30:   pts -= 1

                # --- Color / Signal ---
                if pts >= 4:
                    color, signal = "GREEN", "HIGH_CONVICTION"
                elif pts <= 0:
                    color, signal = "RED", "BEARISH"
                elif rsi > 70 or rsi < 30:
                    color, signal = "YELLOW", "CAUTION"
                else:
                    color, signal = "YELLOW", "NEUTRAL"

                rows.append({
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
        try:
            if is_index:
                import yfinance as yf
                from datetime import datetime, timedelta
                end = datetime.now()
                hist = yf.Ticker(symbol).history(
                    start=end - timedelta(days=380), end=end
                )
                if hist.empty:
                    return 10.0  # Nifty long-run avg
                return float(
                    (hist["Close"].iloc[-1] - hist["Close"].iloc[0])
                    / hist["Close"].iloc[0] * 100
                )
            df = self.data_mgr.get_stock_history(symbol, years=2)
            if df.empty or len(df) < 252:
                return 0.0
            return float(
                (df["Close"].iloc[-1] - df["Close"].iloc[-252])
                / df["Close"].iloc[-252] * 100
            )
        except Exception:
            return 0.0


# ------------------------------------------------------------------
# Module-level pure helpers (no self dependency)
# ------------------------------------------------------------------

def _lv(lst: list, idx: int, key: str, default: float = 0.0) -> float:
    try:
        v = lst[idx].get(key, default)
        return float(v) if v is not None and math.isfinite(float(v)) else default
    except (IndexError, TypeError, ValueError):
        return default


def _roa(income: list, bal: list, idx: int) -> float:
    ni     = _lv(income, idx, "net_income")
    assets = _lv(bal,    idx, "total_assets") or 1
    return ni / assets


def _debt_ratio(bal: list, idx: int) -> float:
    debt   = _lv(bal, idx, "total_debt")
    assets = _lv(bal, idx, "total_assets") or 1
    return debt / assets


def _current_ratio(bal: list, idx: int) -> float:
    ca = _lv(bal, idx, "current_assets")
    cl = _lv(bal, idx, "current_liabilities") or 1
    return ca / cl


def _gross_margin(income: list, idx: int) -> float:
    rev   = _lv(income, idx, "revenue") or 1
    gp    = _lv(income, idx, "gross_profit",
                _lv(income, idx, "operating_profit"))  # fallback to EBIT
    return gp / rev


def _asset_turnover(income: list, bal: list, idx: int) -> float:
    rev    = _lv(income, idx, "revenue")
    assets = _lv(bal,    idx, "total_assets") or 1
    return rev / assets


def _unknown_trend() -> Dict[str, Any]:
    return {
        "stage": 0, "stage_name": "Unknown", "signal": "NEUTRAL",
        "ma50": 0.0, "ma200": 0.0, "current_price": 0.0,
        "rsi": 50.0, "slope_50dma_pct": 0.0, "golden_cross": False,
    }
