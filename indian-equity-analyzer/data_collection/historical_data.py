"""
Historical Data Manager using Jugaad-Data for NSE/BSE stocks.
Provides OHLCV history, bhavcopy downloads, and technical indicators.
"""
import os
import time
import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional, Dict, Any, List

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)


class HistoricalDataManager:
    """
    Manages historical price data using Jugaad-Data library.
    Falls back to yfinance when Jugaad-Data is unavailable.
    Caches all data to disk to respect NSE rate limits.
    """

    def __init__(self, cache_dir: str = "./data/historical"):
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self._cache_expiry_seconds = 3600  # 1 hour

        self._jd_stock_df = None
        self._jd_bhavcopy_save = None
        self._init_jugaad()

    def _init_jugaad(self) -> None:
        """Attempt to initialise Jugaad-Data; silently fall back on failure."""
        try:
            from jugaad_data.nse import stock_df, bhavcopy_save
            self._jd_stock_df = stock_df
            self._jd_bhavcopy_save = bhavcopy_save
            logger.info("Jugaad-Data initialised successfully")
        except Exception as exc:
            logger.warning("Jugaad-Data not available (%s); yfinance fallback active", exc)

    # ------------------------------------------------------------------
    # Cache helpers
    # ------------------------------------------------------------------

    def _cache_path(self, key: str) -> Path:
        safe = key.replace("/", "_").replace(":", "_").replace(" ", "_")
        return self.cache_dir / f"{safe}.parquet"

    def _cache_valid(self, path: Path) -> bool:
        if not path.exists():
            return False
        return (time.time() - path.stat().st_mtime) < self._cache_expiry_seconds

    # ------------------------------------------------------------------
    # Retry logic
    # ------------------------------------------------------------------

    @staticmethod
    def _retry(func, *args, max_retries: int = 3, **kwargs):
        """Call *func* with exponential backoff, raising on final failure."""
        for attempt in range(max_retries):
            try:
                return func(*args, **kwargs)
            except Exception as exc:
                if attempt == max_retries - 1:
                    raise
                delay = 2 ** attempt
                logger.warning("Attempt %d failed (%s). Retrying in %ds…", attempt + 1, exc, delay)
                time.sleep(delay)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def download_bhavcopy_range(self, start_date: datetime, end_date: datetime) -> bool:
        """
        Download and cache bhavcopy files for every trading day in range.

        Args:
            start_date: First date (inclusive).
            end_date:   Last date (inclusive).

        Returns:
            True if at least one file was downloaded successfully.
        """
        if self._jd_bhavcopy_save is None:
            logger.error("Jugaad-Data unavailable – cannot download bhavcopy.")
            return False

        downloaded = 0
        current = start_date
        while current <= end_date:
            if current.weekday() < 5:  # Monday–Friday only
                cache_key = f"bhavcopy_{current.strftime('%Y%m%d')}"
                cp = self._cache_path(cache_key)
                if not self._cache_valid(cp):
                    try:
                        self._retry(self._jd_bhavcopy_save, current.date(), str(self.cache_dir))
                        downloaded += 1
                        time.sleep(0.5)
                    except Exception as exc:
                        logger.warning("Bhavcopy %s failed: %s", current.date(), exc)
            current += timedelta(days=1)

        logger.info("Downloaded %d bhavcopy files.", downloaded)
        return downloaded > 0

    def get_stock_history(self, symbol: str, years: int = 5) -> pd.DataFrame:
        """
        Fetch OHLCV history for *symbol* covering the last *years* years.

        Returns a DataFrame with columns: Date, Open, High, Low, Close, Volume
        sorted ascending by Date.
        """
        cache_key = f"history_{symbol}_{years}y"
        cp = self._cache_path(cache_key)

        if self._cache_valid(cp):
            logger.info("Loading cached history for %s", symbol)
            try:
                return pd.read_parquet(cp)
            except Exception:
                pass  # corrupt cache – re-fetch

        end_dt = datetime.now()
        start_dt = end_dt - timedelta(days=years * 365)

        df = self._fetch_jugaad(symbol, start_dt, end_dt)
        if df is None or df.empty:
            df = self._fetch_yfinance(symbol, start_dt, end_dt)

        if df is not None and not df.empty:
            df = df.sort_values("Date").reset_index(drop=True)
            try:
                df.to_parquet(cp)
            except Exception as exc:
                logger.warning("Could not cache history for %s: %s", symbol, exc)
            return df

        return pd.DataFrame(columns=["Date", "Open", "High", "Low", "Close", "Volume"])

    def get_live_quote(self, symbol: str) -> Dict[str, Any]:
        """
        Return a live-ish quote dict for *symbol*.
        Tries NSEPython first, then falls back to yfinance fast_info.
        """
        quote = self._live_nsepython(symbol)
        if quote:
            return quote

        quote = self._live_yfinance(symbol)
        if quote:
            return quote

        return {"symbol": symbol, "last_price": 0.0, "error": "No data source available"}

    def calculate_moving_averages(
        self, symbol: str, windows: List[int] = None
    ) -> Dict[str, float]:
        """Return simple moving averages for the requested *windows* (default 50, 200)."""
        if windows is None:
            windows = [50, 200]
        df = self.get_stock_history(symbol, years=2)
        result: Dict[str, float] = {}
        for w in windows:
            if not df.empty and len(df) >= w:
                result[f"MA_{w}"] = float(df["Close"].iloc[-w:].mean())
            else:
                result[f"MA_{w}"] = float(df["Close"].mean()) if not df.empty else 0.0
        return result

    def calculate_rsi(self, symbol: str, period: int = 14) -> float:
        """Compute the RSI for *symbol* over *period* days. Returns 50.0 on error."""
        try:
            df = self.get_stock_history(symbol, years=1)
            if df.empty or len(df) < period + 1:
                return 50.0
            delta = df["Close"].diff()
            gain = delta.clip(lower=0).rolling(period).mean()
            loss = (-delta).clip(lower=0).rolling(period).mean()
            rs = gain / loss.replace(0, np.inf)
            rsi = 100 - (100 / (1 + rs))
            val = float(rsi.iloc[-1])
            return val if np.isfinite(val) else 50.0
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
            annual = df.groupby("Year")["Close"].last()
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
            for col in ["Open", "High", "Low", "Close"]:
                df[col] = pd.to_numeric(df[col], errors="coerce")
            df["Volume"] = pd.to_numeric(df.get("Volume", 0), errors="coerce").fillna(0)
            return df[["Date", "Open", "High", "Low", "Close", "Volume"]].dropna(subset=["Close"])
        except Exception as exc:
            logger.warning("Jugaad-Data fetch failed for %s: %s", symbol, exc)
            return None

    def _fetch_yfinance(
        self, symbol: str, start_dt: datetime, end_dt: datetime
    ) -> Optional[pd.DataFrame]:
        try:
            import yfinance as yf
            ticker = yf.Ticker(f"{symbol}.NS")
            raw = ticker.history(start=start_dt, end=end_dt, auto_adjust=True)
            if raw is None or raw.empty:
                return None
            raw = raw.reset_index()[["Date", "Open", "High", "Low", "Close", "Volume"]]
            raw["Date"] = pd.to_datetime(raw["Date"]).dt.tz_localize(None)
            logger.info("yfinance fallback used for %s", symbol)
            return raw
        except Exception as exc:
            logger.warning("yfinance fetch failed for %s: %s", symbol, exc)
            return None

    def _live_nsepython(self, symbol: str) -> Optional[Dict[str, Any]]:
        try:
            from nsepython import nse_eq
            data = nse_eq(symbol)
            if not data:
                return None
            pi = data.get("priceInfo", {})
            trd = data.get("marketDeptOrderBook", {}).get("tradeInfo", {})
            return {
                "symbol": symbol,
                "last_price": float(pi.get("lastPrice", 0)),
                "change": float(pi.get("change", 0)),
                "pct_change": float(pi.get("pChange", 0)),
                "open": float(pi.get("open", 0)),
                "high": float(pi.get("intraDayHighLow", {}).get("max", 0)),
                "low": float(pi.get("intraDayHighLow", {}).get("min", 0)),
                "volume": int(trd.get("totalTradedVolume", 0)),
                "prev_close": float(pi.get("previousClose", 0)),
                "source": "nsepython",
            }
        except Exception as exc:
            logger.debug("NSEPython live quote failed for %s: %s", symbol, exc)
            return None

    def _live_yfinance(self, symbol: str) -> Optional[Dict[str, Any]]:
        try:
            import yfinance as yf
            fi = yf.Ticker(f"{symbol}.NS").fast_info
            return {
                "symbol": symbol,
                "last_price": float(getattr(fi, "last_price", 0) or 0),
                "change": 0.0,
                "pct_change": 0.0,
                "open": float(getattr(fi, "open", 0) or 0),
                "high": float(getattr(fi, "day_high", 0) or 0),
                "low": float(getattr(fi, "day_low", 0) or 0),
                "volume": int(getattr(fi, "three_month_average_volume", 0) or 0),
                "prev_close": float(getattr(fi, "previous_close", 0) or 0),
                "source": "yfinance",
            }
        except Exception as exc:
            logger.debug("yfinance live quote failed for %s: %s", symbol, exc)
            return None
