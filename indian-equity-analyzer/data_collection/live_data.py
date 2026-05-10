"""
Live Data Manager using NSEPython for real-time Indian market data.
Fetches quotes, index valuations, and corporate actions from NSE.
"""
import time
import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


class LiveDataManager:
    """
    Provides live market data for NSE stocks and indices using NSEPython.
    Falls back gracefully to yfinance when NSEPython is unavailable.
    """

    def __init__(self):
        self._nse_available = False
        self._init_nse()

    def _init_nse(self) -> None:
        """Attempt to import NSEPython; note availability for later calls."""
        try:
            import nsepython  # noqa: F401
            self._nse_available = True
            logger.info("NSEPython initialised successfully")
        except ImportError:
            logger.warning("NSEPython not installed – falling back to yfinance")

    # ------------------------------------------------------------------
    # Retry helper
    # ------------------------------------------------------------------

    @staticmethod
    def _retry(func, *args, max_retries: int = 3, **kwargs):
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

    def get_full_quote(self, symbol: str) -> Dict[str, Any]:
        """
        Return a rich quote for *symbol* including valuation metrics.

        Returns a dict with: symbol, last_price, change, pct_change,
        market_cap, pe, pb, dividend_yield, week52_high, week52_low,
        sector, industry, face_value, book_value, eps, roe.
        """
        quote = self._quote_nsepython(symbol)
        if quote:
            return quote

        quote = self._quote_yfinance(symbol)
        if quote:
            return quote

        return self._empty_quote(symbol)

    def get_index_valuations(self, index: str = "NIFTY 50") -> Dict[str, Any]:
        """
        Return current valuation for *index* (PE, PB, dividend yield).
        Used to contextualise individual stock valuations.
        """
        try:
            if self._nse_available:
                from nsepython import nse_index_info
                data = self._retry(nse_index_info, index)
                if data:
                    return {
                        "index": index,
                        "pe": float(data.get("pe", 0) or 0),
                        "pb": float(data.get("pb", 0) or 0),
                        "dividend_yield": float(data.get("dy", 0) or 0),
                        "source": "nsepython",
                    }
        except Exception as exc:
            logger.warning("Index valuation via NSEPython failed: %s", exc)

        # Hard-coded approximate fallback (2024 Nifty50 long-run averages)
        return {
            "index": index,
            "pe": 22.0,
            "pb": 3.5,
            "dividend_yield": 1.2,
            "source": "fallback",
        }

    def get_corporate_actions(self, symbol: str) -> List[Dict[str, Any]]:
        """
        Return a list of recent corporate actions (dividend, bonus, split)
        for *symbol* from NSE.

        Each item: {"action_type", "ex_date", "details"}
        """
        actions: List[Dict[str, Any]] = []

        try:
            if self._nse_available:
                from nsepython import nse_actions
                raw = self._retry(nse_actions, symbol=symbol)
                if raw:
                    for item in raw:
                        actions.append({
                            "action_type": item.get("subject", "Unknown"),
                            "ex_date": item.get("exDate", ""),
                            "record_date": item.get("recDate", ""),
                            "details": item.get("remarks", ""),
                        })
                return actions
        except Exception as exc:
            logger.warning("Corporate actions via NSEPython failed for %s: %s", symbol, exc)

        # Fallback: try yfinance dividends/splits
        try:
            import yfinance as yf
            ticker = yf.Ticker(f"{symbol}.NS")

            divs = ticker.dividends
            if divs is not None and not divs.empty:
                for dt, val in divs[-5:].items():
                    actions.append({
                        "action_type": "Dividend",
                        "ex_date": str(dt.date()),
                        "record_date": "",
                        "details": f"₹{val:.2f} per share",
                    })

            splits = ticker.splits
            if splits is not None and not splits.empty:
                for dt, ratio in splits[-3:].items():
                    actions.append({
                        "action_type": "Stock Split",
                        "ex_date": str(dt.date()),
                        "record_date": "",
                        "details": f"Ratio {ratio:.1f}:1",
                    })
        except Exception as exc:
            logger.warning("yfinance corporate actions failed for %s: %s", symbol, exc)

        return actions

    def get_market_status(self) -> Dict[str, Any]:
        """Return NSE market open/close status and current time."""
        try:
            if self._nse_available:
                from nsepython import nse_marketStatus
                status = self._retry(nse_marketStatus)
                if status:
                    return {
                        "is_open": status.get("marketStatus", "") == "Open",
                        "market_status": status.get("marketStatus", "Unknown"),
                        "trade_date": status.get("tradeDate", ""),
                    }
        except Exception as exc:
            logger.debug("Market status check failed: %s", exc)

        return {"is_open": False, "market_status": "Unknown", "trade_date": ""}

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _quote_nsepython(self, symbol: str) -> Optional[Dict[str, Any]]:
        if not self._nse_available:
            return None
        try:
            from nsepython import nse_eq
            data = self._retry(nse_eq, symbol)
            if not data:
                return None

            pi = data.get("priceInfo", {})
            meta = data.get("metadata", {})
            sec = data.get("securityInfo", {})
            hi_lo = pi.get("weekHighLow", {})

            return {
                "symbol": symbol,
                "last_price": float(pi.get("lastPrice", 0) or 0),
                "change": float(pi.get("change", 0) or 0),
                "pct_change": float(pi.get("pChange", 0) or 0),
                "market_cap": float(sec.get("marketCap", 0) or 0),
                "pe": float(sec.get("pdSymbolPe", 0) or 0),
                "pb": 0.0,  # not always in NSEPython response
                "dividend_yield": float(sec.get("pdSectorPe", 0) or 0),
                "week52_high": float(hi_lo.get("max", 0) or 0),
                "week52_low": float(hi_lo.get("min", 0) or 0),
                "sector": meta.get("sector", ""),
                "industry": meta.get("industry", ""),
                "face_value": float(sec.get("faceValue", 1) or 1),
                "book_value": 0.0,
                "eps": 0.0,
                "roe": 0.0,
                "source": "nsepython",
            }
        except Exception as exc:
            logger.debug("NSEPython full quote failed for %s: %s", symbol, exc)
            return None

    def _quote_yfinance(self, symbol: str) -> Optional[Dict[str, Any]]:
        try:
            import yfinance as yf
            ticker = yf.Ticker(f"{symbol}.NS")
            info = ticker.info
            if not info:
                return None

            return {
                "symbol": symbol,
                "last_price": float(info.get("currentPrice", info.get("regularMarketPrice", 0)) or 0),
                "change": 0.0,
                "pct_change": 0.0,
                "market_cap": float(info.get("marketCap", 0) or 0),
                "pe": float(info.get("trailingPE", info.get("forwardPE", 0)) or 0),
                "pb": float(info.get("priceToBook", 0) or 0),
                "dividend_yield": float(info.get("dividendYield", 0) or 0) * 100,
                "week52_high": float(info.get("fiftyTwoWeekHigh", 0) or 0),
                "week52_low": float(info.get("fiftyTwoWeekLow", 0) or 0),
                "sector": info.get("sector", ""),
                "industry": info.get("industry", ""),
                "face_value": 1.0,
                "book_value": float(info.get("bookValue", 0) or 0),
                "eps": float(info.get("trailingEps", 0) or 0),
                "roe": float(info.get("returnOnEquity", 0) or 0) * 100,
                "source": "yfinance",
            }
        except Exception as exc:
            logger.debug("yfinance full quote failed for %s: %s", symbol, exc)
            return None

    @staticmethod
    def _empty_quote(symbol: str) -> Dict[str, Any]:
        return {
            "symbol": symbol, "last_price": 0.0, "change": 0.0,
            "pct_change": 0.0, "market_cap": 0.0, "pe": 0.0, "pb": 0.0,
            "dividend_yield": 0.0, "week52_high": 0.0, "week52_low": 0.0,
            "sector": "", "industry": "", "face_value": 1.0,
            "book_value": 0.0, "eps": 0.0, "roe": 0.0,
            "source": "none", "error": "No data source available",
        }
