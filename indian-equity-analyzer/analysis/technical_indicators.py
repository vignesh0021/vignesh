"""
Advanced Technical Indicators: ATR, MACD, Bollinger Bands, Stochastic, OBV.

All functions accept a pandas DataFrame with columns: Open, High, Low, Close, Volume.
Returns are dicts or Series depending on context.
"""
import logging
from typing import Dict, Optional, Tuple

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)


class TechnicalAnalyzer:
    """
    Computes advanced technical indicators and generates composite signals.

    Signals:
      - ATR-based volatility regime and stop-loss distance
      - MACD trend + momentum signal
      - Bollinger Band squeeze / expansion
      - Stochastic %K/%D (momentum)
      - OBV trend confirmation

    All indicator values are appended to the OHLCV DataFrame.
    """

    def __init__(self, data_manager=None):
        self.data_mgr = data_manager

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def analyze(self, symbol: str, df: Optional[pd.DataFrame] = None) -> Dict:
        """
        Run all technical indicators for *symbol*.

        Returns a dict with keys:
          atr, atr_pct, macd_signal, bb_signal, stoch_signal,
          obv_trend, composite_signal, stop_pct, indicators_df
        """
        if df is None:
            if self.data_mgr is None:
                return self._empty()
            try:
                df = self.data_mgr.get_stock_history(symbol, years=2)
            except Exception as exc:
                logger.warning("Technical: history fetch failed for %s: %s", symbol, exc)
                return self._empty()

        if df is None or len(df) < 30:
            return self._empty()

        df = df.copy()
        df = self._atr(df)
        df = self._macd(df)
        df = self._bollinger(df)
        df = self._stochastic(df)
        df = self._obv(df)

        return self._summarise(df)

    # ------------------------------------------------------------------
    # Indicator calculations
    # ------------------------------------------------------------------

    @staticmethod
    def _atr(df: pd.DataFrame, period: int = 14) -> pd.DataFrame:
        h, l, c = df["High"], df["Low"], df["Close"]
        prev_c  = c.shift(1)
        tr = pd.concat([
            h - l,
            (h - prev_c).abs(),
            (l - prev_c).abs(),
        ], axis=1).max(axis=1)
        df["ATR"] = tr.ewm(com=period - 1, min_periods=period).mean()
        return df

    @staticmethod
    def _macd(
        df: pd.DataFrame,
        fast: int = 12,
        slow: int = 26,
        signal: int = 9,
    ) -> pd.DataFrame:
        c = df["Close"]
        ema_fast   = c.ewm(span=fast, adjust=False).mean()
        ema_slow   = c.ewm(span=slow, adjust=False).mean()
        macd_line  = ema_fast - ema_slow
        signal_line = macd_line.ewm(span=signal, adjust=False).mean()
        df["MACD"]        = macd_line
        df["MACD_Signal"] = signal_line
        df["MACD_Hist"]   = macd_line - signal_line
        return df

    @staticmethod
    def _bollinger(df: pd.DataFrame, period: int = 20, n_std: float = 2.0) -> pd.DataFrame:
        c      = df["Close"]
        mid    = c.rolling(period).mean()
        std    = c.rolling(period).std(ddof=1)
        df["BB_Mid"]   = mid
        df["BB_Upper"] = mid + n_std * std
        df["BB_Lower"] = mid - n_std * std
        df["BB_Width"] = (df["BB_Upper"] - df["BB_Lower"]) / mid  # normalised band width
        df["BB_Pct"]   = (c - df["BB_Lower"]) / (df["BB_Upper"] - df["BB_Lower"])
        return df

    @staticmethod
    def _stochastic(df: pd.DataFrame, k_period: int = 14, d_period: int = 3) -> pd.DataFrame:
        lo  = df["Low"].rolling(k_period).min()
        hi  = df["High"].rolling(k_period).max()
        rng = hi - lo
        rng = rng.replace(0, np.nan)
        k   = (df["Close"] - lo) / rng * 100
        d   = k.rolling(d_period).mean()
        df["Stoch_K"] = k
        df["Stoch_D"] = d
        return df

    @staticmethod
    def _obv(df: pd.DataFrame) -> pd.DataFrame:
        direction = np.sign(df["Close"].diff().fillna(0))
        vol_signed = df["Volume"] * direction
        df["OBV"] = vol_signed.cumsum()
        df["OBV_EMA"] = df["OBV"].ewm(span=20, adjust=False).mean()
        return df

    # ------------------------------------------------------------------
    # Signal summary
    # ------------------------------------------------------------------

    @staticmethod
    def _summarise(df: pd.DataFrame) -> Dict:
        last = df.iloc[-1]
        prev = df.iloc[-2] if len(df) >= 2 else last

        # ATR
        atr     = float(last.get("ATR", 0) or 0)
        price   = float(last["Close"])
        atr_pct = (atr / price * 100) if price > 0 else 0.0
        stop_pct = round(atr_pct * 2, 2)  # 2×ATR stop

        # MACD
        macd_hist      = float(last.get("MACD_Hist", 0) or 0)
        macd_hist_prev = float(prev.get("MACD_Hist", 0) or 0)
        macd_above_sig = float(last.get("MACD", 0) or 0) > float(last.get("MACD_Signal", 0) or 0)
        if macd_hist > 0 and macd_hist > macd_hist_prev:
            macd_signal = "BULLISH_STRONG"
        elif macd_hist > 0:
            macd_signal = "BULLISH_WEAKENING"
        elif macd_hist < 0 and macd_hist < macd_hist_prev:
            macd_signal = "BEARISH_STRONG"
        else:
            macd_signal = "BEARISH_WEAKENING"

        # Bollinger
        bb_pct = float(last.get("BB_Pct", 0.5) or 0.5)
        bb_width = float(last.get("BB_Width", 0) or 0)
        bb_width_hist = df["BB_Width"].dropna().tail(50).mean() if "BB_Width" in df else 0
        if bb_pct > 0.95:
            bb_signal = "OVERBOUGHT"
        elif bb_pct < 0.05:
            bb_signal = "OVERSOLD"
        elif bb_width < bb_width_hist * 0.7:
            bb_signal = "SQUEEZE"  # volatility contraction – potential breakout
        else:
            bb_signal = "NEUTRAL"

        # Stochastic
        k = float(last.get("Stoch_K", 50) or 50)
        d = float(last.get("Stoch_D", 50) or 50)
        if k > 80 and d > 80:
            stoch_signal = "OVERBOUGHT"
        elif k < 20 and d < 20:
            stoch_signal = "OVERSOLD"
        elif k > d and k > 50:
            stoch_signal = "BULLISH"
        elif k < d and k < 50:
            stoch_signal = "BEARISH"
        else:
            stoch_signal = "NEUTRAL"

        # OBV
        obv_rising = float(last.get("OBV", 0) or 0) > float(last.get("OBV_EMA", 0) or 0)
        obv_trend  = "BULLISH" if obv_rising else "BEARISH"

        # Composite technical score [-1, +1]
        scores = {
            "macd":   1.0 if macd_signal.startswith("BULL") else -1.0 if macd_signal.startswith("BEAR") else 0.0,
            "bb":     1.0 if bb_signal == "OVERSOLD" else -1.0 if bb_signal == "OVERBOUGHT" else 0.0,
            "stoch":  1.0 if stoch_signal == "OVERSOLD" else (-1.0 if stoch_signal == "OVERBOUGHT" else
                      (0.5 if stoch_signal == "BULLISH" else (-0.5 if stoch_signal == "BEARISH" else 0.0))),
            "obv":    0.5 if obv_trend == "BULLISH" else -0.5,
        }
        composite_signal = round(sum(scores.values()) / len(scores), 4)

        return {
            "atr":              round(atr, 2),
            "atr_pct":          round(atr_pct, 2),
            "stop_pct":         stop_pct,
            "macd_signal":      macd_signal,
            "bb_signal":        bb_signal,
            "bb_pct":           round(bb_pct * 100, 1),
            "stoch_k":          round(k, 1),
            "stoch_d":          round(d, 1),
            "stoch_signal":     stoch_signal,
            "obv_trend":        obv_trend,
            "composite_signal": composite_signal,
            "indicators_df":    df,
        }

    @staticmethod
    def _empty() -> Dict:
        return {
            "atr": 0.0, "atr_pct": 0.0, "stop_pct": 15.0,
            "macd_signal": "NEUTRAL", "bb_signal": "NEUTRAL",
            "bb_pct": 50.0, "stoch_k": 50.0, "stoch_d": 50.0,
            "stoch_signal": "NEUTRAL", "obv_trend": "NEUTRAL",
            "composite_signal": 0.0, "indicators_df": None,
        }
