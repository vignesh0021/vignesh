"""
Earnings Calendar and Earnings Surprise Tracker.

Fetches:
  - Upcoming results dates from NSE API / Screener.in
  - Historical earnings surprise (actual vs consensus estimate)
  - Quarters with consistent beats/misses

Signal: consistent earnings beats → positive momentum; misses → negative.
"""
import logging
import time
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

import requests

logger = logging.getLogger(__name__)

_NSE_RESULTS_URL = (
    "https://www.nseindia.com/api/event-calendar?index=equities"
)
_HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64)",
    "Referer":    "https://www.nseindia.com/",
}


class EarningsCalendar:
    """
    Tracks earnings announcements and surprise patterns for Indian stocks.

    Surprise is measured as:
      surprise_pct = (actual_eps - consensus_eps) / abs(consensus_eps) × 100

    When consensus estimates are unavailable (common for Indian mid/small cap),
    we compare YoY EPS growth vs street expectation proxied from analyst targets.
    """

    def __init__(self, cache_minutes: int = 120):
        self._cache:   Dict[str, Dict] = {}
        self._cache_min = cache_minutes
        self._session: Optional[requests.Session] = None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def get_upcoming_results(self, symbol: str, days_ahead: int = 90) -> List[Dict]:
        """Return list of upcoming result dates for *symbol*."""
        events = self._fetch_event_calendar()
        upcoming = []
        cutoff   = datetime.now() + timedelta(days=days_ahead)

        for e in events:
            if e.get("symbol", "").upper() != symbol.upper():
                continue
            try:
                date = datetime.strptime(e["date"], "%d-%b-%Y")
                if datetime.now() <= date <= cutoff:
                    upcoming.append({
                        "date":   date.strftime("%Y-%m-%d"),
                        "symbol": symbol,
                        "event":  e.get("purpose", "Results"),
                    })
            except Exception:
                pass

        return upcoming

    def analyze(self, symbol: str, statements: Optional[Dict] = None) -> Dict:
        """
        Returns:
          upcoming_results, earnings_surprise_history,
          surprise_trend, earnings_score [-1, +1], summary
        """
        upcoming  = self.get_upcoming_results(symbol)
        surprises = self._compute_surprise_history(symbol, statements)
        trend     = self._surprise_trend(surprises)
        score     = self._score(surprises, trend)
        days_to_result = self._days_to_next(upcoming)

        return {
            "upcoming_results":        upcoming[:3],
            "days_to_next_result":     days_to_result,
            "earnings_surprise_history": surprises,
            "surprise_trend":          trend,
            "earnings_score":          round(score, 4),
            "summary":                 self._summary(upcoming, surprises, trend),
        }

    # ------------------------------------------------------------------
    # Internal: event calendar fetch
    # ------------------------------------------------------------------

    def _fetch_event_calendar(self) -> List[Dict]:
        cache_key = "event_calendar"
        entry     = self._cache.get(cache_key)
        if entry and (time.time() - entry["ts"]) / 60 < self._cache_min:
            return entry["data"]

        try:
            if self._session is None:
                self._session = requests.Session()
                self._session.get("https://www.nseindia.com/", headers=_HEADERS, timeout=10)

            resp = self._session.get(_NSE_RESULTS_URL, headers=_HEADERS, timeout=10)
            if resp.status_code == 200:
                data = resp.json()
                if isinstance(data, list):
                    self._cache[cache_key] = {"data": data, "ts": time.time()}
                    return data
        except Exception as exc:
            logger.debug("Earnings calendar fetch failed: %s", exc)

        self._cache[cache_key] = {"data": [], "ts": time.time()}
        return []

    # ------------------------------------------------------------------
    # Internal: compute surprise from statements
    # ------------------------------------------------------------------

    @staticmethod
    def _compute_surprise_history(symbol: str, statements: Optional[Dict]) -> List[Dict]:
        """
        Proxy earnings surprise = YoY EPS growth deviation from 3-year avg.
        When actual consensus data is unavailable, this measures consistency.
        """
        if not statements:
            return []

        pl = statements.get("profit_loss", [])
        if len(pl) < 3:
            return []

        # Compute YoY EPS growth rates
        eps_growth = []
        for i in range(1, len(pl)):
            ni_curr = float(pl[i].get("net_profit", 0) or 0)
            ni_prev = float(pl[i - 1].get("net_profit", 0) or 0)
            if ni_prev and ni_prev != 0:
                g = (ni_curr - ni_prev) / abs(ni_prev) * 100
                eps_growth.append({
                    "year":   pl[i].get("year", str(i)),
                    "growth": round(g, 1),
                })

        if len(eps_growth) < 2:
            return eps_growth

        # "Surprise" = actual growth vs 3y trailing average growth (proxy for consensus)
        surprises = []
        for i in range(len(eps_growth)):
            history = [g["growth"] for g in eps_growth[:i]] or [0.0]
            expected = sum(history) / len(history)
            actual   = eps_growth[i]["growth"]
            surprise = actual - expected
            surprises.append({
                "year":         eps_growth[i]["year"],
                "actual_growth":    round(actual, 1),
                "expected_growth":  round(expected, 1),
                "surprise_pct":     round(surprise, 1),
                "beat":             surprise > 0,
            })

        return surprises

    # ------------------------------------------------------------------
    # Trend
    # ------------------------------------------------------------------

    @staticmethod
    def _surprise_trend(surprises: List[Dict]) -> str:
        if len(surprises) < 2:
            return "UNKNOWN"
        recent = surprises[-3:]
        beats  = sum(1 for s in recent if s.get("beat", False))
        if beats >= 2:
            return "CONSISTENT_BEAT"
        if beats == 0:
            return "CONSISTENT_MISS"
        return "MIXED"

    @staticmethod
    def _score(surprises: List[Dict], trend: str) -> float:
        base = {"CONSISTENT_BEAT": 0.6, "MIXED": 0.0, "CONSISTENT_MISS": -0.6, "UNKNOWN": 0.0}.get(trend, 0.0)
        if surprises:
            latest_surprise = surprises[-1].get("surprise_pct", 0.0)
            latest_adj = max(-0.3, min(0.3, latest_surprise / 50))  # 50% surprise → ±0.3
            return max(-1.0, min(1.0, base + latest_adj))
        return base

    @staticmethod
    def _days_to_next(upcoming: List[Dict]) -> Optional[int]:
        if not upcoming:
            return None
        try:
            dt = datetime.strptime(upcoming[0]["date"], "%Y-%m-%d")
            return (dt - datetime.now()).days
        except Exception:
            return None

    @staticmethod
    def _summary(upcoming: List[Dict], surprises: List[Dict], trend: str) -> str:
        if upcoming:
            next_date = upcoming[0]["date"]
            up_str    = f"Next result: {next_date}"
        else:
            up_str    = "No upcoming result found (90d)"

        beat_rate = ""
        if surprises:
            beats = sum(1 for s in surprises if s.get("beat", False))
            beat_rate = f" | Beat rate: {beats}/{len(surprises)}"

        return f"{up_str} | Surprise trend: {trend}{beat_rate}"
