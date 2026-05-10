"""
Reverse DCF Engine.
Solves for the implied growth rate baked into the current market price,
then compares it with actual historical growth to gauge valuation fairness.
"""
import logging
from typing import Any, Dict, Optional

import numpy as np
from scipy.optimize import brentq

logger = logging.getLogger(__name__)


class ReverseDCF:
    """
    Reverse-engineers the market's implicit FCF growth expectation.

    If implied_growth >> actual_growth  →  stock is priced for perfection (EXPENSIVE).
    If implied_growth ≈  actual_growth  →  fair price (FAIR).
    If implied_growth << actual_growth  →  growth undervalued by market (CHEAP).
    """

    def __init__(
        self,
        fundamental_manager,
        risk_free_rate: float = 0.07,
        market_risk_premium: float = 0.08,
        tax_rate: float = 0.25,
    ):
        self.fund_mgr = fundamental_manager
        self.risk_free_rate = risk_free_rate
        self.market_risk_premium = market_risk_premium
        self.tax_rate = tax_rate

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def calculate_implied_growth(
        self,
        symbol: str,
        current_price: float,
        terminal_growth: float = 0.04,
        projection_years: int = 10,
        beta: float = 1.0,
        cost_of_debt: float = 0.09,
    ) -> Dict[str, Any]:
        """
        Find the FCF growth rate *g* such that DCF(g) = current_market_cap.

        Args:
            symbol:          Stock symbol.
            current_price:   Current stock price (₹).
            terminal_growth: Terminal / perpetuity growth rate.
            projection_years: Forecast horizon.
            beta:            Stock beta (default 1.0).
            cost_of_debt:    Pre-tax cost of debt.

        Returns:
            Dict with: implied_growth_pct, wacc, base_fcf, shares_outstanding.
        """
        try:
            stmts = self.fund_mgr.get_financial_statements(symbol)
            ratios = self.fund_mgr.get_key_ratios(symbol)

            cash_flows = stmts.get("cash_flow", [])
            base_fcf = self._latest_fcf(cash_flows)

            # Estimate WACC
            market_cap = ratios.get("market_cap", 0)
            de_ratio = ratios.get("debt_equity", 0.5)
            equity_est = market_cap or 1e6
            debt_est = equity_est * de_ratio
            wacc = self._wacc(beta, cost_of_debt, debt_est, equity_est)

            # Shares outstanding ≈ market_cap / price
            shares = (market_cap / current_price) if (current_price > 0 and market_cap > 0) else 1.0

            # Target enterprise value (market cap + debt - cash)
            cash = self._last_balance_val(stmts, "cash")
            target_ev = market_cap + debt_est - cash
            if target_ev <= 0:
                target_ev = market_cap

            if base_fcf <= 0:
                # Cannot solve – return a narrative-only result
                return {
                    "implied_growth_pct": None,
                    "wacc": round(wacc * 100, 2),
                    "base_fcf": base_fcf,
                    "shares_outstanding": round(shares, 2),
                    "note": "Negative base FCF – reverse DCF not applicable",
                }

            # Solve for implied growth using Brent's method
            def dcf_value(g: float) -> float:
                pv = 0.0
                fcf = base_fcf
                for t in range(1, projection_years + 1):
                    fcf = fcf * (1 + g)
                    pv += fcf / (1 + wacc) ** t
                # Terminal value
                tv = (fcf * (1 + terminal_growth)) / max(wacc - terminal_growth, 0.001)
                pv += tv / (1 + wacc) ** projection_years
                return pv - target_ev

            try:
                implied_g = brentq(dcf_value, -0.30, 0.60, xtol=1e-6, maxiter=200)
            except ValueError:
                # If sign doesn't change in [-30%, 60%], use boundary with smallest abs error
                errors = [(abs(dcf_value(g)), g) for g in np.linspace(-0.30, 0.60, 50)]
                implied_g = min(errors, key=lambda x: x[0])[1]

            return {
                "implied_growth_pct": round(implied_g * 100, 2),
                "wacc": round(wacc * 100, 2),
                "base_fcf": round(base_fcf, 2),
                "shares_outstanding": round(shares, 2),
                "target_ev": round(target_ev, 2),
                "note": "Solved successfully",
            }

        except Exception as exc:
            logger.error("Reverse DCF failed for %s: %s", symbol, exc)
            return {
                "implied_growth_pct": None, "wacc": 12.0,
                "base_fcf": 0.0, "shares_outstanding": 0.0,
                "note": f"Error: {exc}",
            }

    def compare_to_historical_growth(self, symbol: str, current_price: float) -> Dict[str, Any]:
        """
        Compare market-implied growth with actual historical growth.

        Returns:
            implied_growth, actual_sales_growth, actual_profit_growth,
            growth_gap (implied - actual), assessment (CHEAP/FAIR/EXPENSIVE).
        """
        try:
            implied = self.calculate_implied_growth(symbol, current_price)
            growth = self.fund_mgr.get_growth_metrics(symbol)

            implied_g = implied.get("implied_growth_pct")
            actual_sales = growth.get("sales_cagr_3y", growth.get("sales_growth_yoy", 0.0))
            actual_profit = growth.get("profit_cagr_3y", growth.get("profit_growth_yoy", 0.0))

            if implied_g is None:
                return {
                    "implied_growth": None,
                    "actual_sales_growth": actual_sales,
                    "actual_profit_growth": actual_profit,
                    "growth_gap": None,
                    "assessment": "INDETERMINATE",
                    "note": implied.get("note", ""),
                }

            # Use profit growth as the primary comparator
            best_actual = max(actual_sales, actual_profit)
            growth_gap = implied_g - best_actual

            if growth_gap > 10:
                assessment = "EXPENSIVE"
            elif growth_gap > -5:
                assessment = "FAIR"
            else:
                assessment = "CHEAP"

            return {
                "implied_growth": round(implied_g, 2),
                "actual_sales_growth": round(actual_sales, 2),
                "actual_profit_growth": round(actual_profit, 2),
                "growth_gap": round(growth_gap, 2),
                "assessment": assessment,
                "wacc": implied.get("wacc", 12.0),
            }

        except Exception as exc:
            logger.error("Growth comparison failed for %s: %s", symbol, exc)
            return {
                "implied_growth": None, "actual_sales_growth": 0.0,
                "actual_profit_growth": 0.0, "growth_gap": None,
                "assessment": "INDETERMINATE",
            }

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _wacc(
        self, beta: float, cod: float, debt: float, equity: float
    ) -> float:
        total = debt + equity
        if total <= 0:
            return self.risk_free_rate + beta * self.market_risk_premium
        coe = self.risk_free_rate + beta * self.market_risk_premium
        after_tax_cod = cod * (1 - self.tax_rate)
        return max((equity / total) * coe + (debt / total) * after_tax_cod, 0.05)

    @staticmethod
    def _latest_fcf(cash_flows: list) -> float:
        """Return the most recent positive FCF, falling back to any FCF."""
        if not cash_flows:
            return 0.0
        # Try positive FCFs first
        for record in reversed(cash_flows):
            fcf = float(record.get("free_cash_flow", 0) or 0)
            if fcf > 0:
                return fcf
        # Fall back to most recent regardless of sign
        return float(cash_flows[-1].get("free_cash_flow", 0) or 0)

    @staticmethod
    def _last_balance_val(stmts: dict, key: str) -> float:
        bs = stmts.get("balance_sheet", [])
        if not bs:
            return 0.0
        try:
            return float(bs[-1].get(key, 0) or 0)
        except (TypeError, ValueError):
            return 0.0
