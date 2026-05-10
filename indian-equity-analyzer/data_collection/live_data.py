"""
Live Data Manager using NSEPython for real-time Indian market data.
Market cap is returned in ₹ Crores (our internal standard).
Cache TTL adapts to market hours: 60 s during market, 8 h post-close.
"""
import math
import time
import logging
from datetime import datetime, time as dtime
from typing import Any, Dict, List, Optional

from utils.units import abs_to_cr

logger = logging.getLogger(__name__)

_MARKET_OPEN  = dtime(9, 15)
_MARKET_CLOSE = dtime(15, 30)


def _market_open_now() -> bool:
    """Return True if NSE is currently within trading hours (IST weekday)."""
    now = datetime.now()
    if now.weekday() >= 5:  # Sat / Sun
        return False
    return _MARKET_OPEN <= now.time() <= _MARKET_CLOSE


def _cache_ttl() -> int:
    """Return cache TTL in seconds: 60 s during trading, 8 h otherwise."""
    return 60 if _market_open_now() else 28_800


class LiveDataManager:
    """
    Provides live market data for NSE stocks and indices.
    Tries NSEPython first; falls back to yfinance automatically.
    All monetary values returned in ₹ Crores.
    """

    def __init__(self):
        self._nse_ok = False
        self._quote_cache: Dict[str, Dict] = {}   # { symbol: {data, ts} }
        self._init_nse()

    def _init_nse(self) -> None:
        try:
            import nsepython  # noqa: F401
            self._nse_ok = True
            logger.info("NSEPython initialised")
        except ImportError:
            logger.warning("NSEPython not installed – yfinance fallback active")

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
                time.sleep(2 ** attempt)

    # ------------------------------------------------------------------
    # Quote cache
    # ------------------------------------------------------------------

    def _cached_quote(self, symbol: str) -> Optional[Dict]:
        entry = self._quote_cache.get(symbol)
        if entry and (time.time() - entry["ts"]) < _cache_ttl():
            return entry["data"]
        return None

    def _store_quote(self, symbol: str, data: Dict) -> None:
        self._quote_cache[symbol] = {"data": data, "ts": time.time()}

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def get_full_quote(self, symbol: str) -> Dict[str, Any]:
        """
        Return a rich quote for *symbol*.

        Fields: symbol, last_price (₹), change, pct_change,
                market_cap (₹ Cr), pe, pb, dividend_yield,
                week52_high, week52_low, sector, industry,
                face_value, book_value, eps, roe, source.
        """
        cached = self._cached_quote(symbol)
        if cached:
            return cached

        q = self._quote_nse(symbol) or self._quote_yfinance(symbol) or _empty_quote(symbol)
        self._store_quote(symbol, q)
        return q

    def get_index_valuations(self, index: str = "NIFTY 50") -> Dict[str, Any]:
        """
        Return current index-level PE, PB, and dividend yield.
        Used to contextualise individual stock valuations.
        """
        if self._nse_ok:
            try:
                from nsepython import nse_index_info
                data = self._retry(nse_index_info, index)
                if data:
                    return {
                        "index": index,
                        "pe":             float(data.get("pe", 0) or 0),
                        "pb":             float(data.get("pb", 0) or 0),
                        "dividend_yield": float(data.get("dy", 0) or 0),
                        "source": "nsepython",
                    }
            except Exception as exc:
                logger.debug("Index valuation via NSEPython failed: %s", exc)

        # Hard-coded long-run averages (updated periodically)
        return {"index": index, "pe": 22.0, "pb": 3.5, "dividend_yield": 1.2, "source": "default"}

    def get_corporate_actions(self, symbol: str) -> List[Dict[str, Any]]:
        """Return recent corporate actions (dividend, bonus, split) for *symbol*."""
        actions: List[Dict[str, Any]] = []

        if self._nse_ok:
            try:
                from nsepython import nse_actions
                raw = self._retry(nse_actions, symbol=symbol)
                if raw:
                    for item in raw:
                        actions.append({
                            "action_type": item.get("subject", "Unknown"),
                            "ex_date":     item.get("exDate", ""),
                            "record_date": item.get("recDate", ""),
                            "details":     item.get("remarks", ""),
                        })
                    return actions
            except Exception as exc:
                logger.debug("NSEPython corporate actions failed for %s: %s", symbol, exc)

        # yfinance fallback
        try:
            import yfinance as yf
            ticker = yf.Ticker(f"{symbol}.NS")
            for dt, val in (ticker.dividends or {})[-5:].items():
                actions.append({
                    "action_type": "Dividend",
                    "ex_date":     str(dt.date()),
                    "record_date": "",
                    "details":     f"₹{val:.2f} per share",
                })
            for dt, ratio in (ticker.splits or {})[-3:].items():
                actions.append({
                    "action_type": "Stock Split",
                    "ex_date":     str(dt.date()),
                    "record_date": "",
                    "details":     f"Ratio {ratio:.1f}:1",
                })
        except Exception as exc:
            logger.debug("yfinance corporate actions failed for %s: %s", symbol, exc)

        return actions

    def get_market_status(self) -> Dict[str, Any]:
        """Return NSE open/close status."""
        is_open = _market_open_now()
        if self._nse_ok:
            try:
                from nsepython import nse_marketStatus
                status = self._retry(nse_marketStatus)
                if status:
                    return {
                        "is_open":      status.get("marketStatus", "") == "Open",
                        "market_status": status.get("marketStatus", "Unknown"),
                        "trade_date":   status.get("tradeDate", ""),
                        "source":       "nsepython",
                    }
            except Exception:
                pass
        return {"is_open": is_open, "market_status": "Open" if is_open else "Closed",
                "trade_date": datetime.now().strftime("%d-%b-%Y"), "source": "local_time"}

    # ------------------------------------------------------------------
    # Private quote fetchers
    # ------------------------------------------------------------------

    def _quote_nse(self, symbol: str) -> Optional[Dict[str, Any]]:
        if not self._nse_ok:
            return None
        try:
            from nsepython import nse_eq
            data = self._retry(nse_eq, symbol)
            if not data:
                return None
            pi   = data.get("priceInfo", {})
            meta = data.get("metadata", {})
            sec  = data.get("securityInfo", {})
            hilo = pi.get("weekHighLow", {})
            # NSEPython returns market cap in Crores already
            mkt_cap_cr = float(sec.get("marketCap", 0) or 0)
            return {
                "symbol":        symbol,
                "last_price":    float(pi.get("lastPrice", 0) or 0),
                "change":        float(pi.get("change", 0) or 0),
                "pct_change":    float(pi.get("pChange", 0) or 0),
                "market_cap":    mkt_cap_cr,          # ₹ Crores
                "pe":            float(sec.get("pdSymbolPe", 0) or 0),
                "pb":            0.0,
                "dividend_yield": 0.0,
                "week52_high":   float(hilo.get("max", 0) or 0),
                "week52_low":    float(hilo.get("min", 0) or 0),
                "sector":        meta.get("sector", ""),
                "industry":      meta.get("industry", ""),
                "face_value":    float(sec.get("faceValue", 1) or 1),
                "book_value":    0.0,
                "eps":           0.0,
                "roe":           0.0,
                "source":        "nsepython",
            }
        except Exception as exc:
            logger.debug("NSEPython full quote failed for %s: %s", symbol, exc)
            return None

    def _quote_yfinance(self, symbol: str) -> Optional[Dict[str, Any]]:
        try:
            import yfinance as yf
            info = yf.Ticker(f"{symbol}.NS").info
            if not info:
                return None
            # yfinance marketCap is absolute ₹ → convert to Crores
            mkt_cap_raw = float(info.get("marketCap", 0) or 0)
            mkt_cap_cr  = abs_to_cr(mkt_cap_raw)
            return {
                "symbol":         symbol,
                "last_price":     float(info.get("currentPrice",
                                                  info.get("regularMarketPrice", 0)) or 0),
                "change":         0.0,
                "pct_change":     0.0,
                "market_cap":     mkt_cap_cr,          # ₹ Crores
                "pe":             float(info.get("trailingPE", info.get("forwardPE", 0)) or 0),
                "pb":             float(info.get("priceToBook", 0) or 0),
                "dividend_yield": float(info.get("dividendYield", 0) or 0) * 100,
                "week52_high":    float(info.get("fiftyTwoWeekHigh", 0) or 0),
                "week52_low":     float(info.get("fiftyTwoWeekLow", 0) or 0),
                "sector":         info.get("sector", ""),
                "industry":       info.get("industry", ""),
                "face_value":     1.0,
                "book_value":     float(info.get("bookValue", 0) or 0),
                "eps":            float(info.get("trailingEps", 0) or 0),
                "roe":            float(info.get("returnOnEquity", 0) or 0) * 100,
                "source":         "yfinance",
            }
        except Exception as exc:
            logger.debug("yfinance full quote failed for %s: %s", symbol, exc)
            return None


def _empty_quote(symbol: str) -> Dict[str, Any]:
    return {
        "symbol": symbol, "last_price": 0.0, "change": 0.0, "pct_change": 0.0,
        "market_cap": 0.0, "pe": 0.0, "pb": 0.0, "dividend_yield": 0.0,
        "week52_high": 0.0, "week52_low": 0.0, "sector": "", "industry": "",
        "face_value": 1.0, "book_value": 0.0, "eps": 0.0, "roe": 0.0,
        "source": "none", "error": "No data source available",
    }
