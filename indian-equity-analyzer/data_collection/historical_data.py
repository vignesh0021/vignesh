"""
Historical Data Manager using Jugaad-Data for NSE/BSE stocks.
Provides OHLCV history, bhavcopy downloads, beta calculation, and
technical indicators. Falls back to yfinance when Jugaad-Data is absent.
"""
import math
import time
import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Any

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)


class HistoricalDataManager:
    """
    Manages historical price data and derived technical indicators.
    Falls back to yfinance when Jugaad-Data is unavailable.
    Disk-caches every result (Parquet) with a 1-hour expiry.
    """

    def __init__(self, cache_dir: str = "./data/historical"):
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self._cache_ttl = 3600  # seconds
        self._jd_stock_df = None
        self._jd_bhavcopy  = None
        self._init_jugaad()

    def _init_jugaad(self) -> None:
        try:
            from jugaad_data.nse import stock_df, bhavcopy_save
            self._jd_stock_df = stock_df
            self._jd_bhavcopy  = bhavcopy_save
            logger.info("Jugaad-Data initialised")
        except Exception as exc:
            logger.warning("Jugaad-Data unavailable (%s); yfinance fallback active", exc)

    # ------------------------------------------------------------------
    # Cache helpers
    # ------------------------------------------------------------------

    def _cp(self, key: str) -> Path:
        return self.cache_dir / (key.replace("/", "_").replace(":", "_") + ".parquet")

    def _valid(self, path: Path) -> bool:
        return path.exists() and (time.time() - path.stat().st_mtime) < self._cache_ttl

    # ------------------------------------------------------------------
    # Retry
    # ------------------------------------------------------------------

    @staticmethod
    def _retry(func, *args, retries: int = 3, **kwargs):
        for attempt in range(retries):
            try:
                return func(*args, **kwargs)
            except Exception as exc:
                if attempt == retries - 1:
                    raise
                delay = 2 ** attempt
                logger.warning("Attempt %d failed (%s). Retry in %ds…", attempt + 1, exc, delay)
                time.sleep(delay)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def download_bhavcopy_range(self, start_date: datetime, end_date: datetime) -> bool:
        """Download NSE bhavcopy files for every trading day in the range."""
        if self._jd_bhavcopy is None:
            logger.error("Jugaad-Data unavailable – bhavcopy download skipped")
            return False

        downloaded = 0
        cur = start_date
        while cur <= end_date:
            if cur.weekday() < 5:
                cp = self._cp(f"bhavcopy_{cur.strftime('%Y%m%d')}")
                if not self._valid(cp):
                    try:
                        self._retry(self._jd_bhavcopy, cur.date(), str(self.cache_dir))
                        downloaded += 1
                        time.sleep(0.5)
                    except Exception as exc:
                        logger.warning("Bhavcopy %s failed: %s", cur.date(), exc)
            cur += timedelta(days=1)

        logger.info("Downloaded %d bhavcopy files", downloaded)
        return downloaded > 0

    def get_stock_history(self, symbol: str, years: int = 5) -> pd.DataFrame:
        """
        Return OHLCV history for *symbol* covering the last *years* years.
        Columns: Date (datetime64), Open, High, Low, Close, Volume (float).
        """
        cp = self._cp(f"history_{symbol}_{years}y")
        if self._valid(cp):
            try:
                return pd.read_parquet(cp)
            except Exception:
                pass  # corrupt – re-fetch

        end_dt  = datetime.now()
        start_dt = end_dt - timedelta(days=years * 365)

        df = self._fetch_jugaad(symbol, start_dt, end_dt)
        if df is None or df.empty:
            df = self._fetch_yfinance(symbol, start_dt, end_dt)

        if df is not None and not df.empty:
            df = df.sort_values("Date").reset_index(drop=True)
            try:
                df.to_parquet(cp)
            except Exception:
                pass
            return df

        return pd.DataFrame(columns=["Date", "Open", "High", "Low", "Close", "Volume"])

    def get_live_quote(self, symbol: str) -> Dict[str, Any]:
        """Return a live-ish price dict. Tries NSEPython, falls back to yfinance."""
        q = self._live_nse(symbol)
        return q if q else (self._live_yfinance(symbol) or
                            {"symbol": symbol, "last_price": 0.0, "error": "no source"})

    def calculate_beta(
        self, symbol: str, benchmark: str = "^NSEI", years: int = 3
    ) -> float:
        """
        Compute stock beta vs *benchmark* using 3-year weekly returns OLS.

        Uses the Damodaran methodology: regress weekly stock returns on
        weekly benchmark returns; clip extreme values to [-3, 5].

        Returns 1.0 on any failure so downstream code still runs.
        """
        try:
            from scipy.stats import linregress

            end_dt   = datetime.now()
            start_dt = end_dt - timedelta(days=years * 365 + 30)

            # Stock weekly prices
            stock_df = self.get_stock_history(symbol, years=years + 1)
            if stock_df.empty or len(stock_df) < 60:
                return 1.0

            # Benchmark via yfinance (^NSEI / ^BSESN)
            import yfinance as yf
            bench_raw = yf.Ticker(benchmark).history(start=start_dt, end=end_dt)
            if bench_raw is None or bench_raw.empty:
                return 1.0

            bench_raw = bench_raw.reset_index()
            bench_raw["Date"] = pd.to_datetime(bench_raw["Date"]).dt.tz_localize(None)
            bench_raw = bench_raw[["Date", "Close"]].rename(columns={"Close": "bench"})

            # Weekly resampling
            stock_w = (
                stock_df.set_index("Date")["Close"]
                .resample("W").last().dropna()
            )
            bench_w = (
                bench_raw.set_index("Date")["bench"]
                .resample("W").last().dropna()
            )

            # Returns
            s_ret = stock_w.pct_change().dropna()
            b_ret = bench_w.pct_change().dropna()

            # Align on common dates
            common = s_ret.index.intersection(b_ret.index)
            if len(common) < 30:
                return 1.0

            s = s_ret.loc[common].values
            b = b_ret.loc[common].values

            slope, _, r_val, p_val, _ = linregress(b, s)
            beta = float(np.clip(slope, -3.0, 5.0))

            logger.info(
                "Beta(%s vs %s): %.3f  R²=%.3f  n=%d",
                symbol, benchmark, beta, r_val ** 2, len(common),
            )
            return round(beta, 3)

        except Exception as exc:
            logger.warning("Beta calculation failed for %s: %s", symbol, exc)
            return 1.0

    def calculate_moving_averages(
        self, symbol: str, windows: List[int] = None
    ) -> Dict[str, float]:
        """Return simple moving averages for the specified *windows* (default 50, 200)."""
        if windows is None:
            windows = [50, 200]
        df = self.get_stock_history(symbol, years=2)
        result: Dict[str, float] = {}
        for w in windows:
            if not df.empty and len(df) >= w:
                result[f"MA_{w}"] = round(float(df["Close"].iloc[-w:].mean()), 2)
            else:
                result[f"MA_{w}"] = round(float(df["Close"].mean()), 2) if not df.empty else 0.0
        return result

    def calculate_rsi(self, symbol: str, period: int = 14) -> float:
        """Compute RSI for *symbol* over *period* days. Returns 50.0 on error."""
        try:
            df = self.get_stock_history(symbol, years=1)
            if df.empty or len(df) < period + 2:
                return 50.0

            delta = df["Close"].diff().dropna()
            gain  = delta.clip(lower=0)
            loss  = (-delta).clip(lower=0)

            avg_gain = gain.ewm(com=period - 1, min_periods=period).mean()
            avg_loss = loss.ewm(com=period - 1, min_periods=period).mean()

            rs  = avg_gain / avg_loss.replace(0, np.inf)
            rsi = 100 - (100 / (1 + rs))
            val = float(rsi.iloc[-1])
            return val if math.isfinite(val) else 50.0

        except Exception as exc:
            logger.error("RSI calculation failed for %s: %s", symbol, exc)
            return 50.0

    def get_yearly_returns(self, symbol: str, years: int = 5) -> List[float]:
        """Return list of annual returns (decimal) for the last *years* calendar years."""
        try:
            df = self.get_stock_history(symbol, years=years + 1)
            if df.empty:
                return []
            df["Year"] = pd.to_datetime(df["Date"]).dt.year
            annual  = df.groupby("Year")["Close"].last()
            returns = annual.pct_change().dropna().tolist()
            return returns[-years:]
        except Exception as exc:
            logger.error("Yearly returns failed for %s: %s", symbol, exc)
            return []

    # ------------------------------------------------------------------
    # Private fetch helpers
    # ------------------------------------------------------------------

    def _fetch_jugaad(
        self, symbol: str, start_dt: datetime, end_dt: datetime
    ) -> Optional[pd.DataFrame]:
        if self._jd_stock_df is None:
            return None
        try:
            df = self._retry(
                self._jd_stock_df,
                symbol=symbol,
                from_date=start_dt.date(),
                to_date=end_dt.date(),
                series="EQ",
            )
            if df is None or df.empty:
                return None
            rename = {
                "DATE": "Date", "OPEN": "Open", "HIGH": "High",
                "LOW": "Low", "CLOSE": "Close", "TOTTRDQTY": "Volume",
                "date": "Date", "open": "Open", "high": "High",
                "low": "Low", "close": "Close", "volume": "Volume",
            }
            df = df.rename(columns={k: v for k, v in rename.items() if k in df.columns})
            df["Date"] = pd.to_datetime(df["Date"])
            for c in ["Open", "High", "Low", "Close"]:
                df[c] = pd.to_numeric(df[c], errors="coerce")
            df["Volume"] = pd.to_numeric(df.get("Volume", 0), errors="coerce").fillna(0)
            return df[["Date", "Open", "High", "Low", "Close", "Volume"]].dropna(subset=["Close"])
        except Exception as exc:
            logger.warning("Jugaad fetch failed for %s: %s", symbol, exc)
            return None

    def _fetch_yfinance(
        self, symbol: str, start_dt: datetime, end_dt: datetime
    ) -> Optional[pd.DataFrame]:
        try:
            import yfinance as yf
            raw = yf.Ticker(f"{symbol}.NS").history(start=start_dt, end=end_dt, auto_adjust=True)
            if raw is None or raw.empty:
                return None
            raw = raw.reset_index()[["Date", "Open", "High", "Low", "Close", "Volume"]]
            raw["Date"] = pd.to_datetime(raw["Date"]).dt.tz_localize(None)
            logger.info("yfinance fallback used for %s", symbol)
            return raw
        except Exception as exc:
            logger.warning("yfinance fetch failed for %s: %s", symbol, exc)
            return None

    def _live_nse(self, symbol: str) -> Optional[Dict[str, Any]]:
        try:
            from nsepython import nse_eq
            data = nse_eq(symbol)
            if not data:
                return None
            pi  = data.get("priceInfo", {})
            trd = data.get("marketDeptOrderBook", {}).get("tradeInfo", {})
            return {
                "symbol":      symbol,
                "last_price":  float(pi.get("lastPrice", 0) or 0),
                "change":      float(pi.get("change", 0) or 0),
                "pct_change":  float(pi.get("pChange", 0) or 0),
                "open":        float(pi.get("open", 0) or 0),
                "high":        float(pi.get("intraDayHighLow", {}).get("max", 0) or 0),
                "low":         float(pi.get("intraDayHighLow", {}).get("min", 0) or 0),
                "volume":      int(trd.get("totalTradedVolume", 0) or 0),
                "prev_close":  float(pi.get("previousClose", 0) or 0),
                "source":      "nsepython",
            }
        except Exception:
            return None

    def _live_yfinance(self, symbol: str) -> Optional[Dict[str, Any]]:
        try:
            import yfinance as yf
            fi = yf.Ticker(f"{symbol}.NS").fast_info
            return {
                "symbol":     symbol,
                "last_price": float(getattr(fi, "last_price", 0) or 0),
                "change":     0.0,
                "pct_change": 0.0,
                "open":       float(getattr(fi, "open", 0) or 0),
                "high":       float(getattr(fi, "day_high", 0) or 0),
                "low":        float(getattr(fi, "day_low", 0) or 0),
                "volume":     int(getattr(fi, "three_month_average_volume", 0) or 0),
                "prev_close": float(getattr(fi, "previous_close", 0) or 0),
                "source":     "yfinance",
            }
        except Exception:
            return None
