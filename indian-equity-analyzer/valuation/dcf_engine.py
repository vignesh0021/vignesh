"""
Monte Carlo DCF Valuation Engine with India-specific parameters.
Uses proper statistical distributions (not uniform random) for growth rate
simulation, applying Gordon Growth Model for terminal value.
"""
import logging
from typing import Any, Dict, List, Optional

import numpy as np

logger = logging.getLogger(__name__)


class MonteCarloDCF:
    """
    Discounted Cash Flow valuation via Monte Carlo simulation.

    India defaults:
      risk_free_rate       = 7%   (10-yr G-Sec yield)
      market_risk_premium  = 8%
      tax_rate             = 25%  (corporate tax)
      terminal_growth_rate = 4%   (long-run GDP growth)
    """

    def __init__(
        self,
        risk_free_rate: float = 0.07,
        market_risk_premium: float = 0.08,
        tax_rate: float = 0.25,
        terminal_growth_rate: float = 0.04,
        projection_years: int = 10,
    ):
        self.risk_free_rate = risk_free_rate
        self.market_risk_premium = market_risk_premium
        self.tax_rate = tax_rate
        self.terminal_growth_rate = terminal_growth_rate
        self.projection_years = projection_years

    # ------------------------------------------------------------------
    # WACC
    # ------------------------------------------------------------------

    def calculate_wacc(
        self,
        beta: float,
        cost_of_debt: float,
        debt: float,
        equity: float,
    ) -> float:
        """
        Compute Weighted Average Cost of Capital (WACC).

        Args:
            beta:         Stock beta vs Nifty 50.
            cost_of_debt: Pre-tax cost of debt (decimal, e.g. 0.09).
            debt:         Total debt (₹ Cr).
            equity:       Market cap / total equity (₹ Cr).

        Returns:
            WACC as decimal.
        """
        total = debt + equity
        if total <= 0:
            return self.risk_free_rate + beta * self.market_risk_premium

        cost_of_equity = self.risk_free_rate + beta * self.market_risk_premium
        after_tax_cod = cost_of_debt * (1 - self.tax_rate)

        wacc = (equity / total) * cost_of_equity + (debt / total) * after_tax_cod
        return round(max(wacc, 0.05), 6)  # floor at 5%

    # ------------------------------------------------------------------
    # FCF Projection
    # ------------------------------------------------------------------

    def project_fcf(
        self,
        historical_fcf: List[float],
        growth_assumptions: Optional[Dict[str, float]] = None,
        rng: Optional[np.random.Generator] = None,
    ) -> List[float]:
        """
        Project free cash flows for *projection_years* using random growth
        drawn from a clipped normal distribution.

        Args:
            historical_fcf:    List of annual FCF values (most recent last).
            growth_assumptions: {'mean': 0.12, 'std': 0.08}  (decimals).
            rng:               NumPy random generator (for reproducibility).

        Returns:
            List of projected FCF values.
        """
        if growth_assumptions is None:
            # Derive from historical FCF if possible
            if len(historical_fcf) >= 2:
                rates = []
                for i in range(1, len(historical_fcf)):
                    prev = historical_fcf[i - 1]
                    if prev != 0:
                        rates.append((historical_fcf[i] - prev) / abs(prev))
                mean_g = float(np.median(rates)) if rates else 0.10
                std_g = float(np.std(rates)) if len(rates) > 1 else 0.08
            else:
                mean_g, std_g = 0.10, 0.08
            growth_assumptions = {"mean": mean_g, "std": std_g}

        mean_g = growth_assumptions.get("mean", 0.10)
        std_g = growth_assumptions.get("std", 0.08)

        if rng is None:
            rng = np.random.default_rng()

        base_fcf = historical_fcf[-1] if historical_fcf else 100.0

        projected = []
        current = base_fcf
        for year in range(1, self.projection_years + 1):
            # Growth tapers towards terminal rate in later years
            year_mean = mean_g * (1 - year / (self.projection_years * 2))
            year_mean = max(year_mean, self.terminal_growth_rate)
            growth = rng.normal(year_mean, std_g)
            growth = float(np.clip(growth, -0.30, 0.50))
            current = current * (1 + growth)
            projected.append(round(current, 4))

        return projected

    # ------------------------------------------------------------------
    # Terminal Value
    # ------------------------------------------------------------------

    def calculate_terminal_value(
        self,
        final_fcf: float,
        terminal_growth: Optional[float] = None,
        wacc: float = 0.12,
    ) -> float:
        """
        Compute terminal value using the Gordon Growth Model.

        TV = FCF_(n+1) / (WACC - g)

        Args:
            final_fcf:      FCF in the last projected year.
            terminal_growth: Long-run perpetual growth rate.
            wacc:           Discount rate.

        Returns:
            Terminal value (same currency unit as final_fcf).
        """
        g = terminal_growth if terminal_growth is not None else self.terminal_growth_rate
        denominator = wacc - g
        if denominator <= 0.001:
            denominator = 0.001  # Prevent division by near-zero
        tv = (final_fcf * (1 + g)) / denominator
        return round(tv, 4)

    # ------------------------------------------------------------------
    # Monte Carlo Engine
    # ------------------------------------------------------------------

    def run_monte_carlo(
        self,
        historical_fcf: List[float],
        wacc: float,
        current_market_cap: float,
        shares_outstanding: float = 1.0,
        growth_assumptions: Optional[Dict[str, float]] = None,
        n_simulations: int = 10_000,
    ) -> Dict[str, Any]:
        """
        Run *n_simulations* DCF scenarios and return summary statistics.

        Args:
            historical_fcf:      Annual FCF list (₹ Cr), most-recent last.
            wacc:                Weighted average cost of capital.
            current_market_cap:  Current mkt cap (₹ Cr) for upside calculation.
            shares_outstanding:  In Cr shares (for per-share value).
            growth_assumptions:  {'mean': g, 'std': s} for FCF growth.
            n_simulations:       Monte Carlo iterations (default 10 000).

        Returns:
            Dict with: mean, median, std, p5, p25, p75, p95,
                       probability_of_upside, per_share_median,
                       per_share_p25, per_share_p75, values (full array).
        """
        rng = np.random.default_rng(seed=42)
        intrinsic_values: List[float] = []

        for _ in range(n_simulations):
            try:
                # Random WACC perturbation (±1%)
                sim_wacc = max(wacc + rng.normal(0, 0.01), 0.05)

                projected = self.project_fcf(historical_fcf, growth_assumptions, rng)
                if not projected:
                    continue

                # Discount FCFs to present
                pv_fcfs = sum(
                    fcf / (1 + sim_wacc) ** (t + 1)
                    for t, fcf in enumerate(projected)
                )

                # Terminal value discounted back
                tv = self.calculate_terminal_value(projected[-1], wacc=sim_wacc)
                pv_tv = tv / (1 + sim_wacc) ** self.projection_years

                intrinsic_value = pv_fcfs + pv_tv
                intrinsic_values.append(intrinsic_value)
            except Exception:
                continue

        if not intrinsic_values:
            return self._empty_mc_result()

        arr = np.array(intrinsic_values)
        prob_upside = float(np.mean(arr > current_market_cap)) if current_market_cap > 0 else 0.5

        shares = max(shares_outstanding, 1.0)

        return {
            "mean": round(float(np.mean(arr)), 2),
            "median": round(float(np.median(arr)), 2),
            "std": round(float(np.std(arr)), 2),
            "p5": round(float(np.percentile(arr, 5)), 2),
            "p25": round(float(np.percentile(arr, 25)), 2),
            "p75": round(float(np.percentile(arr, 75)), 2),
            "p95": round(float(np.percentile(arr, 95)), 2),
            "probability_of_upside": round(prob_upside * 100, 1),
            "per_share_median": round(float(np.median(arr)) / shares, 2),
            "per_share_p25": round(float(np.percentile(arr, 25)) / shares, 2),
            "per_share_p75": round(float(np.percentile(arr, 75)) / shares, 2),
            "n_simulations": len(intrinsic_values),
            "values": arr.tolist(),
        }

    # ------------------------------------------------------------------
    # Scenario Analysis
    # ------------------------------------------------------------------

    def generate_scenarios(
        self,
        historical_fcf: List[float],
        wacc: float,
        current_market_cap: float,
        shares_outstanding: float = 1.0,
    ) -> Dict[str, Dict[str, float]]:
        """
        Run Bear / Base / Bull scenario DCF.

        Returns dict: { 'bear': {...}, 'base': {...}, 'bull': {...} }
        Each sub-dict: growth_mean, intrinsic_value, per_share_value, upside_pct.
        """
        rng = np.random.default_rng(seed=42)
        scenarios = {
            "bear": {"mean": -0.05, "std": 0.03},
            "base": {"mean": 0.10, "std": 0.05},
            "bull": {"mean": 0.20, "std": 0.05},
        }
        results = {}

        for name, assump in scenarios.items():
            try:
                projected = self.project_fcf(historical_fcf, assump, rng)
                pv_fcfs = sum(
                    fcf / (1 + wacc) ** (t + 1)
                    for t, fcf in enumerate(projected)
                )
                tv = self.calculate_terminal_value(projected[-1], wacc=wacc)
                pv_tv = tv / (1 + wacc) ** self.projection_years
                iv = pv_fcfs + pv_tv

                per_share = iv / max(shares_outstanding, 1)
                upside_pct = (
                    (iv - current_market_cap) / current_market_cap * 100
                    if current_market_cap > 0 else 0.0
                )

                results[name] = {
                    "growth_mean_pct": round(assump["mean"] * 100, 1),
                    "intrinsic_value": round(iv, 2),
                    "per_share_value": round(per_share, 2),
                    "upside_pct": round(upside_pct, 1),
                }
            except Exception as exc:
                logger.warning("Scenario %s failed: %s", name, exc)
                results[name] = {
                    "growth_mean_pct": 0.0, "intrinsic_value": 0.0,
                    "per_share_value": 0.0, "upside_pct": 0.0,
                }

        return results

    # ------------------------------------------------------------------
    # Utility
    # ------------------------------------------------------------------

    @staticmethod
    def _empty_mc_result() -> Dict[str, Any]:
        return {
            "mean": 0.0, "median": 0.0, "std": 0.0,
            "p5": 0.0, "p25": 0.0, "p75": 0.0, "p95": 0.0,
            "probability_of_upside": 0.0,
            "per_share_median": 0.0, "per_share_p25": 0.0, "per_share_p75": 0.0,
            "n_simulations": 0, "values": [],
        }
