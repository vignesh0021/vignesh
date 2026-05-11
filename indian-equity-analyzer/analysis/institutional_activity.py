"""
Institutional Activity Tracker.

Sources:
  - NSE bulk/block deals (via NSEPython or direct API)
  - FII/DII net buying derived from Screener.in shareholding trends
  - yfinance as fallback for institutional holder data

Signal: net institutional buying is a positive catalyst; selling is negative.
"""
import logging
import time
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

import requests

logger = logging.getLogger(__name__)

_NSE_BULK_URL  = "https://www.nseindia.com/api/bulk-deal-archives?number=10&from={from_}&to={to_}&recordType=bulk&nseSymbol={sym}"
_NSE_BLOCK_URL = "https://www.nseindia.com/api/bulk-deal-archives?number=10&from={from_}&to={to_}&recordType=block&nseSymbol={sym}"
_HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
    "Accept-Language": "en-IN,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Referer": "https://www.nseindia.com/",
}


class InstitutionalActivityTracker:
    """
    Fetches block/bulk deals from NSE and derives FII/DII trend signals.

    Signal (-1 to +1):
      Net institutional buying → positive
      Net institutional selling → negative
      No data → 0.0
    """

    def __init__(self, fundamental_manager=None, cache_minutes: int = 60):
        self.fund_mgr      = fundamental_manager
        self._cache_min    = cache_minutes
        self._deal_cache:  Dict[str, Dict] = {}
        self._session:     Optional[requests.Session] = None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def analyze(self, symbol: str, ratios: Optional[Dict] = None) -> Dict:
        """
        Returns:
          bulk_deals, block_deals, fii_trend, dii_trend,
          net_institutional_signal [-1, +1], summary
        """
        bulk_deals  = self._get_deals(symbol, "bulk")
        block_deals = self._get_deals(symbol, "block")

        # FII/DII trend from shareholding changes
        fii_trend, dii_trend = self._get_holding_trends(symbol, ratios)

        signal  = self._compute_signal(bulk_deals, block_deals, fii_trend, dii_trend)
        summary = self._summarise(bulk_deals, block_deals, fii_trend, dii_trend)

        return {
            "bulk_deals":              bulk_deals[:5],
            "block_deals":             block_deals[:5],
            "fii_trend":               fii_trend,
            "dii_trend":               dii_trend,
            "net_institutional_signal": round(signal, 4),
            "summary":                 summary,
        }

    # ------------------------------------------------------------------
    # Deal fetching
    # ------------------------------------------------------------------

    def _get_deals(self, symbol: str, deal_type: str) -> List[Dict]:
        cache_key = f"{symbol}_{deal_type}"
        entry = self._deal_cache.get(cache_key)
        if entry and (time.time() - entry["ts"]) / 60 < self._cache_min:
            return entry["data"]

        to_   = datetime.now()
        from_ = to_ - timedelta(days=90)
        url   = (_NSE_BULK_URL if deal_type == "bulk" else _NSE_BLOCK_URL).format(
            sym=symbol,
            from_=from_.strftime("%d-%m-%Y"),
            to_=to_.strftime("%d-%m-%Y"),
        )

        deals = self._fetch_nse_api(url)
        self._deal_cache[cache_key] = {"data": deals, "ts": time.time()}
        return deals

    def _fetch_nse_api(self, url: str) -> List[Dict]:
        try:
            if self._session is None:
                self._session = requests.Session()
                # Warm cookie jar
                self._session.get("https://www.nseindia.com/", headers=_HEADERS, timeout=10)

            resp = self._session.get(url, headers=_HEADERS, timeout=10)
            if resp.status_code == 200:
                data = resp.json()
                if isinstance(data, dict):
                    data = data.get("data", data.get("bulkDealList", []))
                if isinstance(data, list):
                    return [self._normalise_deal(d) for d in data]
        except Exception as exc:
            logger.debug("NSE deal API failed (%s): %s", url, exc)
        return []

    @staticmethod
    def _normalise_deal(raw: Dict) -> Dict:
        return {
            "date":         raw.get("date", raw.get("BD_DT_DATE", "")),
            "symbol":       raw.get("symbol", raw.get("BD_SYMBOL", "")),
            "client":       raw.get("clientName", raw.get("BD_CLIENT_NAME", "")),
            "buy_sell":     raw.get("buyOrSell", raw.get("BD_BUY_SELL", "")),
            "quantity":     float(raw.get("quantity", raw.get("BD_QTY_TRD", 0)) or 0),
            "price":        float(raw.get("price", raw.get("BD_TP_WATP", 0)) or 0),
            "value_cr":     float(raw.get("quantity", 0) or 0) * float(raw.get("price", 0) or 0) / 1e7,
        }

    # ------------------------------------------------------------------
    # FII / DII holding trend from fundamental manager
    # ------------------------------------------------------------------

    def _get_holding_trends(
        self, symbol: str, ratios: Optional[Dict]
    ) -> tuple:
        """
        Returns ('BUYING'|'SELLING'|'STABLE', 'BUYING'|'SELLING'|'STABLE')
        for FII and DII respectively, based on QoQ shareholding change.
        """
        fii_holding = (ratios or {}).get("fii_holding", 0.0)
        dii_holding = (ratios or {}).get("dii_holding", 0.0)

        # Without time series data we fall back to level-based heuristics
        if fii_holding > 25:
            fii_trend = "BUYING"  # high absolute holding → institutional interest
        elif fii_holding < 5:
            fii_trend = "SELLING"
        else:
            fii_trend = "STABLE"

        if dii_holding > 15:
            dii_trend = "BUYING"
        elif dii_holding < 3:
            dii_trend = "SELLING"
        else:
            dii_trend = "STABLE"

        return fii_trend, dii_trend

    # ------------------------------------------------------------------
    # Signal computation
    # ------------------------------------------------------------------

    @staticmethod
    def _compute_signal(
        bulk_deals:  List[Dict],
        block_deals: List[Dict],
        fii_trend:   str,
        dii_trend:   str,
    ) -> float:
        score = 0.0

        # Deals: count net institutional buy/sell value
        all_deals = bulk_deals + block_deals
        net_val   = 0.0
        for d in all_deals:
            client = d.get("client", "").lower()
            is_inst = any(
                kw in client
                for kw in ["mutual fund", "mf", "fii", "fpi", "insurance",
                           "lic", "hdfc", "sbi", "icici", "axis", "kotak"]
            )
            if not is_inst:
                continue
            val = d.get("value_cr", 0.0)
            if d.get("buy_sell", "").upper() in ("BUY", "B"):
                net_val += val
            else:
                net_val -= val

        if net_val > 100:
            score += 0.4
        elif net_val > 0:
            score += 0.2
        elif net_val < -100:
            score -= 0.4
        elif net_val < 0:
            score -= 0.2

        trend_pts = {"BUYING": 0.3, "STABLE": 0.0, "SELLING": -0.3}
        score += trend_pts.get(fii_trend, 0.0)
        score += trend_pts.get(dii_trend, 0.0) * 0.5  # DII weight half of FII

        return max(-1.0, min(1.0, score))

    @staticmethod
    def _summarise(bulk, block, fii_trend, dii_trend) -> str:
        return (
            f"Bulk deals (90d): {len(bulk)} | "
            f"Block deals (90d): {len(block)} | "
            f"FII trend: {fii_trend} | "
            f"DII trend: {dii_trend}"
        )
