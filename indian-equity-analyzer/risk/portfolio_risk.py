"""
Portfolio Risk Management.

Features:
  - Kelly Criterion (full, half-Kelly) for position sizing
  - ATR-based stop-loss aligned position sizing
  - Portfolio correlation matrix (concentration risk)
  - Value at Risk (VaR) at 95% confidence using historical simulation
  - Maximum drawdown calculation
  - Sharpe and Sortino ratios
"""
import logging
import math
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)


class PortfolioRiskManager:
    """
    Standalone portfolio risk calculator.

    All monetary values are in ₹ or ₹ Crores depending on context.
    Position sizes are returned as fraction of capital (0.0 – 1.0).
    """

    def __init__(self, data_manager=None, risk_free_rate: float = 0.07):
        self.data_mgr = data_manager
        self.rf       = risk_free_rate

    # ------------------------------------------------------------------
    # Kelly Criterion
    # ------------------------------------------------------------------

    @staticmethod
    def kelly_position_size(
        win_probability: float,
        win_return:      float,
        loss_return:     float,
        fraction:        float = 0.5,   # half-Kelly by default
    ) -> float:
        """
        Kelly f* = (p × b - q) / b
          p = win probability, q = 1-p, b = win_return / abs(loss_return)

        Returns fraction of capital to deploy (0.0 – 1.0).
        *fraction* parameter scales the result (0.5 = half-Kelly).
        """
        if win_return <= 0 or loss_return >= 0:
            return 0.0
        p = max(0.0, min(1.0, win_probability))
        q = 1 - p
        b = win_return / abs(loss_return)
        f_star = (p * b - q) / b
        return round(max(0.0, min(1.0, f_star * fraction)), 4)

    # ------------------------------------------------------------------
    # ATR-based position sizing
    # ------------------------------------------------------------------

    @staticmethod
    def atr_position_size(
        capital:       float,
        current_price: float,
        atr:           float,
        risk_per_trade_pct: float = 1.0,   # max 1% of capital per trade
        atr_multiplier: float = 2.0,        # stop = 2×ATR below entry
    ) -> Dict:
        """
        Position size = (capital × risk_pct) / (atr_multiplier × ATR)

        Returns shares count, capital allocated, and stop price.
        """
        if current_price <= 0 or atr <= 0:
            return {"shares": 0, "capital_allocated": 0.0, "stop_price": 0.0, "risk_amount": 0.0}

        risk_amount  = capital * risk_per_trade_pct / 100
        stop_distance = atr_multiplier * atr
        shares       = int(risk_amount / stop_distance)
        allocated    = shares * current_price
        stop_price   = current_price - stop_distance

        return {
            "shares":            shares,
            "capital_allocated": round(allocated, 2),
            "stop_price":        round(stop_price, 2),
            "risk_amount":       round(risk_amount, 2),
            "position_pct":      round(allocated / capital * 100, 2) if capital > 0 else 0.0,
        }

    # ------------------------------------------------------------------
    # Portfolio analytics
    # ------------------------------------------------------------------

    def portfolio_analytics(
        self,
        symbols:  List[str],
        weights:  Optional[List[float]] = None,
        years:    int = 1,
    ) -> Dict:
        """
        Compute correlation matrix, VaR, max drawdown, Sharpe/Sortino
        for a portfolio of *symbols*.

        Returns:
          correlation_matrix, var_95, max_drawdown,
          sharpe_ratio, sortino_ratio, concentration_score
        """
        if not symbols:
            return self._empty_portfolio()

        returns_dict: Dict[str, pd.Series] = {}
        for sym in symbols:
            try:
                df = self.data_mgr.get_stock_history(sym, years=years)
                if df is not None and not df.empty:
                    r = df["Close"].pct_change().dropna()
                    returns_dict[sym] = r
            except Exception as exc:
                logger.warning("Portfolio risk: history failed for %s: %s", sym, exc)

        if not returns_dict:
            return self._empty_portfolio()

        # Align dates
        returns_df = pd.DataFrame(returns_dict).dropna()

        if returns_df.empty:
            return self._empty_portfolio()

        n        = len(returns_df.columns)
        eq_wts   = [1.0 / n] * n if weights is None else weights
        if len(eq_wts) != n:
            eq_wts = [1.0 / n] * n

        port_ret = returns_df.values.dot(eq_wts)

        # Correlation matrix
        corr = returns_df.corr()

        # VaR (historical simulation, 95%)
        var_95 = float(np.percentile(port_ret, 5)) * 100  # as %

        # Max drawdown
        cum   = (1 + pd.Series(port_ret)).cumprod()
        roll_max = cum.cummax()
        dd    = (cum - roll_max) / roll_max
        max_dd = float(dd.min()) * 100  # as %

        # Sharpe
        ann_ret  = float(np.mean(port_ret)) * 252
        ann_std  = float(np.std(port_ret, ddof=1)) * math.sqrt(252)
        sharpe   = (ann_ret - self.rf) / ann_std if ann_std > 0 else 0.0

        # Sortino (downside deviation)
        downside = port_ret[port_ret < 0]
        down_std = float(np.std(downside, ddof=1)) * math.sqrt(252) if len(downside) > 1 else ann_std
        sortino  = (ann_ret - self.rf) / down_std if down_std > 0 else 0.0

        # Concentration (Herfindahl-Hirschman Index)
        wts_arr = np.array(eq_wts)
        hhi     = float(np.sum(wts_arr ** 2))  # 1/n = fully diversified, 1.0 = concentrated

        # Avg pairwise correlation (excl diagonal)
        vals  = corr.values
        mask  = ~np.eye(n, dtype=bool)
        avg_corr = float(vals[mask].mean()) if n > 1 else 0.0

        return {
            "correlation_matrix":  corr.round(3).to_dict(),
            "avg_pairwise_corr":   round(avg_corr, 4),
            "var_95_pct":          round(var_95, 4),
            "max_drawdown_pct":    round(max_dd, 4),
            "annual_return_pct":   round(ann_ret * 100, 2),
            "annual_volatility_pct":round(ann_std * 100, 2),
            "sharpe_ratio":        round(sharpe, 4),
            "sortino_ratio":       round(sortino, 4),
            "herfindahl_index":    round(hhi, 4),
            "concentration_flag":  hhi > 0.25,
        }

    # ------------------------------------------------------------------
    # Single-stock risk profile
    # ------------------------------------------------------------------

    def single_stock_risk(
        self,
        symbol:        str,
        current_price: float,
        atr:           float,
        win_prob:      float = 0.55,   # estimated win probability
        upside_pct:    float = 15.0,   # expected upside
        stop_pct:      float = 8.0,    # stop loss distance
        capital:       float = 1_000_000,  # ₹10L default capital
    ) -> Dict:
        """Return Kelly size, ATR size, and risk summary for a single stock."""
        win_ret  = upside_pct / 100
        loss_ret = -stop_pct / 100

        kelly_f   = self.kelly_position_size(win_prob, win_ret, loss_ret)
        atr_size  = self.atr_position_size(capital, current_price, atr)

        kelly_capital = round(capital * kelly_f, 2)
        kelly_shares  = int(kelly_capital / current_price) if current_price > 0 else 0

        return {
            "kelly_fraction":     kelly_f,
            "kelly_capital":      kelly_capital,
            "kelly_shares":       kelly_shares,
            "atr_position":       atr_size,
            "recommended_pct":    round(min(kelly_f, 0.20) * 100, 1),  # cap at 20% per position
            "stop_price":         round(current_price * (1 - stop_pct / 100), 2),
            "target_price":       round(current_price * (1 + upside_pct / 100), 2),
            "risk_reward":        round(upside_pct / stop_pct, 2) if stop_pct > 0 else 0.0,
        }

    @staticmethod
    def _empty_portfolio() -> Dict:
        return {
            "correlation_matrix":   {},
            "avg_pairwise_corr":    0.0,
            "var_95_pct":           0.0,
            "max_drawdown_pct":     0.0,
            "annual_return_pct":    0.0,
            "annual_volatility_pct":0.0,
            "sharpe_ratio":         0.0,
            "sortino_ratio":        0.0,
            "herfindahl_index":     0.0,
            "concentration_flag":   False,
        }
