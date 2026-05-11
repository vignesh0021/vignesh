"""
Strategy Backtester with Walk-Forward Analysis.

Validates whether the composite scoring signal predicts actual future returns.

Methodology:
  1. Generate signal for each stock at each lookback period using
     ONLY data available at that point in time (no lookahead bias).
  2. Measure forward return over a given holding period.
  3. Aggregate: mean return per signal bucket, hit rate, Sharpe ratio.
  4. Walk-forward: train on rolling 3-year window, test on next 1 year.

Simplified mode (no full pipeline re-run):
  Uses RSI + MA crossover as a fast proxy signal for backtesting
  when the full 6-module pipeline is too slow for historical runs.
"""
import logging
import math
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)


class StrategyBacktester:
    """
    Fast technical-signal backtester for Indian equities.

    Uses MA crossover + RSI as proxy signal (same logic as the full
    pipeline's technical component) to avoid running expensive live
    data calls on every historical date.
    """

    def __init__(self, data_manager=None):
        self.data_mgr = data_manager

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def backtest(
        self,
        symbol:         str,
        years:          int    = 5,
        holding_days:   int    = 63,   # ~1 quarter
        fast_ma:        int    = 50,
        slow_ma:        int    = 200,
        rsi_period:     int    = 14,
        rsi_oversold:   float  = 35,
        rsi_overbought: float  = 65,
    ) -> Dict:
        """
        Run backtest for *symbol* over *years* of history.

        Returns:
          trades, metrics, walk_forward_results, summary
        """
        if self.data_mgr is None:
            return self._empty("No data manager provided")

        try:
            df = self.data_mgr.get_stock_history(symbol, years=years + 1)
        except Exception as exc:
            return self._empty(str(exc))

        if df is None or len(df) < slow_ma + holding_days + 10:
            return self._empty("Insufficient historical data")

        df = self._add_indicators(df, fast_ma, slow_ma, rsi_period)
        trades = self._generate_trades(df, holding_days, rsi_oversold, rsi_overbought)

        if not trades:
            return self._empty("No trades generated")

        metrics = self._compute_metrics(trades, df)
        wf      = self._walk_forward(df, holding_days, fast_ma, slow_ma, rsi_period,
                                     rsi_oversold, rsi_overbought, window_years=3)

        return {
            "symbol":               symbol,
            "years_tested":         years,
            "holding_days":         holding_days,
            "total_trades":         len(trades),
            "trades":               trades[-20:],  # last 20 for display
            "metrics":              metrics,
            "walk_forward_results": wf,
            "summary":              self._summary(metrics, wf),
        }

    def backtest_portfolio(
        self,
        symbols:      List[str],
        years:        int = 5,
        holding_days: int = 63,
    ) -> Dict:
        """Backtest each symbol and aggregate results."""
        results = {}
        for sym in symbols:
            results[sym] = self.backtest(sym, years=years, holding_days=holding_days)

        # Aggregate win rates and returns
        all_trades = []
        for sym, res in results.items():
            for t in res.get("trades", []):
                t["symbol"] = sym
                all_trades.append(t)

        portfolio_metrics = self._compute_metrics(all_trades, None) if all_trades else {}

        return {
            "individual":        results,
            "portfolio_metrics": portfolio_metrics,
            "summary":           (
                f"Portfolio backtest: {len(symbols)} stocks, "
                f"{len(all_trades)} total trades, "
                f"hit_rate={portfolio_metrics.get('hit_rate', 0):.1f}%"
            ),
        }

    # ------------------------------------------------------------------
    # Indicator calculation
    # ------------------------------------------------------------------

    @staticmethod
    def _add_indicators(
        df:         pd.DataFrame,
        fast_ma:    int,
        slow_ma:    int,
        rsi_period: int,
    ) -> pd.DataFrame:
        df = df.copy()
        c  = df["Close"]

        df["MA_Fast"] = c.rolling(fast_ma).mean()
        df["MA_Slow"] = c.rolling(slow_ma).mean()

        # RSI (Wilder smoothing via EWM)
        delta   = c.diff()
        gain    = delta.clip(lower=0)
        loss    = (-delta).clip(lower=0)
        avg_g   = gain.ewm(com=rsi_period - 1, min_periods=rsi_period).mean()
        avg_l   = loss.ewm(com=rsi_period - 1, min_periods=rsi_period).mean()
        rs      = avg_g / avg_l.replace(0, np.nan)
        df["RSI"] = 100 - 100 / (1 + rs)

        return df.dropna(subset=["MA_Fast", "MA_Slow", "RSI"])

    # ------------------------------------------------------------------
    # Trade generation
    # ------------------------------------------------------------------

    @staticmethod
    def _generate_trades(
        df:             pd.DataFrame,
        holding_days:   int,
        rsi_oversold:   float,
        rsi_overbought: float,
    ) -> List[Dict]:
        trades    = []
        in_trade  = False
        entry_idx = None
        entry_price = None

        rows = df.reset_index(drop=True)

        for i in range(len(rows) - holding_days):
            row     = rows.iloc[i]
            price   = float(row["Close"])
            ma_fast = float(row["MA_Fast"])
            ma_slow = float(row["MA_Slow"])
            rsi     = float(row["RSI"])

            if in_trade:
                # Exit after holding_days
                if i - entry_idx >= holding_days:
                    exit_price  = float(rows.iloc[i]["Close"])
                    fwd_return  = (exit_price - entry_price) / entry_price * 100
                    trades[-1].update({
                        "exit_date":    str(rows.iloc[i].get("Date", i)),
                        "exit_price":   round(exit_price, 2),
                        "return_pct":   round(fwd_return, 2),
                        "win":          fwd_return > 0,
                    })
                    in_trade = False

            else:
                # Entry: MA golden cross AND RSI not overbought
                golden_cross = ma_fast > ma_slow
                prev_row     = rows.iloc[i - 1] if i > 0 else row
                was_golden   = float(prev_row.get("MA_Fast", 0)) > float(prev_row.get("MA_Slow", 0))
                crossed      = golden_cross and not was_golden

                if crossed and rsi < rsi_overbought:
                    entry_price  = price
                    entry_idx    = i
                    in_trade     = True
                    trades.append({
                        "entry_date":  str(row.get("Date", i)),
                        "entry_price": round(entry_price, 2),
                        "signal":      "MA_CROSSOVER",
                        "rsi_at_entry": round(rsi, 1),
                        "exit_date":   None,
                        "exit_price":  None,
                        "return_pct":  None,
                        "win":         None,
                    })

        # Remove unclosed trades
        trades = [t for t in trades if t["return_pct"] is not None]
        return trades

    # ------------------------------------------------------------------
    # Metrics
    # ------------------------------------------------------------------

    @staticmethod
    def _compute_metrics(trades: List[Dict], df) -> Dict:
        if not trades:
            return {}

        returns = [t["return_pct"] for t in trades if t["return_pct"] is not None]
        if not returns:
            return {}

        wins        = [r for r in returns if r > 0]
        losses      = [r for r in returns if r <= 0]
        hit_rate    = len(wins) / len(returns) * 100
        avg_win     = float(np.mean(wins))   if wins   else 0.0
        avg_loss    = float(np.mean(losses)) if losses else 0.0
        profit_factor = (sum(wins) / abs(sum(losses))) if losses else float("inf")
        avg_return  = float(np.mean(returns))
        std_return  = float(np.std(returns, ddof=1)) if len(returns) > 1 else 0.0
        sharpe      = avg_return / std_return if std_return > 0 else 0.0

        # Max drawdown on equity curve
        equity   = [1.0]
        for r in returns:
            equity.append(equity[-1] * (1 + r / 100))
        eq_arr   = np.array(equity)
        roll_max = np.maximum.accumulate(eq_arr)
        dd       = (eq_arr - roll_max) / roll_max
        max_dd   = float(dd.min()) * 100

        return {
            "total_trades":   len(returns),
            "hit_rate":       round(hit_rate, 1),
            "avg_return_pct": round(avg_return, 2),
            "avg_win_pct":    round(avg_win, 2),
            "avg_loss_pct":   round(avg_loss, 2),
            "profit_factor":  round(min(profit_factor, 99.0), 2),
            "sharpe_ratio":   round(sharpe, 4),
            "max_drawdown_pct": round(max_dd, 2),
            "total_return_pct": round(sum(returns), 2),
        }

    # ------------------------------------------------------------------
    # Walk-forward analysis
    # ------------------------------------------------------------------

    def _walk_forward(
        self,
        df:             pd.DataFrame,
        holding_days:   int,
        fast_ma:        int,
        slow_ma:        int,
        rsi_period:     int,
        rsi_oversold:   float,
        rsi_overbought: float,
        window_years:   int = 3,
    ) -> List[Dict]:
        """Split data into rolling train/test windows."""
        total_rows   = len(df)
        train_bars   = window_years * 252
        test_bars    = 252  # 1 year test

        if total_rows < train_bars + test_bars:
            return []

        results = []
        start   = train_bars

        while start + test_bars <= total_rows:
            test_df = df.iloc[start: start + test_bars].copy()
            test_df = self._add_indicators(test_df, fast_ma, slow_ma, rsi_period)
            trades  = self._generate_trades(test_df, holding_days, rsi_oversold, rsi_overbought)
            m       = self._compute_metrics(trades, test_df)
            if m:
                results.append({
                    "period_start": str(df.index[start]) if hasattr(df.index, 'to_pydatetime') else start,
                    "trades":       m.get("total_trades", 0),
                    "hit_rate":     m.get("hit_rate", 0),
                    "avg_return":   m.get("avg_return_pct", 0),
                    "sharpe":       m.get("sharpe_ratio", 0),
                })
            start += test_bars

        return results

    # ------------------------------------------------------------------
    # Summary
    # ------------------------------------------------------------------

    @staticmethod
    def _summary(metrics: Dict, wf: List[Dict]) -> str:
        if not metrics:
            return "No metrics available"

        wf_str = ""
        if wf:
            wf_wins = sum(1 for w in wf if w.get("avg_return", 0) > 0)
            wf_str  = f" | WF windows: {wf_wins}/{len(wf)} profitable"

        return (
            f"Trades: {metrics['total_trades']} | "
            f"Hit rate: {metrics['hit_rate']:.1f}% | "
            f"Avg return: {metrics['avg_return_pct']:+.2f}% | "
            f"Sharpe: {metrics['sharpe_ratio']:.3f} | "
            f"Max DD: {metrics['max_drawdown_pct']:.1f}%"
            + wf_str
        )

    @staticmethod
    def _empty(reason: str = "") -> Dict:
        return {
            "symbol":               "",
            "years_tested":         0,
            "holding_days":         0,
            "total_trades":         0,
            "trades":               [],
            "metrics":              {},
            "walk_forward_results": [],
            "summary":              f"Backtest unavailable: {reason}",
        }
