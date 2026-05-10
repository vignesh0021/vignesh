"""
News and Corporate Actions Monitor for Indian stocks.
Scrapes MoneyControl, Economic Times, and LiveMint RSS feeds.
Applies keyword-based impact scoring for actionable event detection.
"""
import logging
import re
import time
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

import requests

try:
    import feedparser as _feedparser
    _FEEDPARSER_OK = True
except (ImportError, ModuleNotFoundError, Exception):
    _feedparser = None  # type: ignore[assignment]
    _FEEDPARSER_OK = False

logger = logging.getLogger(__name__)

# High-impact keywords add +3; medium add +1; symbol match adds +2
HIGH_IMPACT_KEYWORDS = [
    "earnings", "results", "quarterly results", "dividend", "bonus", "stock split",
    "merger", "acquisition", "takeover", "buyback", "rights issue",
    "fda approval", "approval", "order", "contract", "default", "npa",
    "fraud", "penalty", "sebi", "investigation", "raid", "bankruptcy",
    "guidance", "outlook upgrade", "delisting", "qip",
]

MEDIUM_IMPACT_KEYWORDS = [
    "target", "upgrade", "downgrade", "buy", "sell", "hold", "outperform",
    "underperform", "analyst", "rating", "price target", "initiating",
    "maintain", "reiterate",
]

RSS_FEEDS = {
    "MoneyControl": "https://www.moneycontrol.com/rss/marketreports.xml",
    "EconomicTimes": "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms",
    "LiveMint": "https://www.livemint.com/rss/markets",
    "BusinessStandard": "https://www.business-standard.com/rss/markets-106.rss",
}


class IndianStockMonitor:
    """
    Monitors news and corporate actions for a watchlist or portfolio of Indian stocks.

    Applies a structured impact score (0-10) to each news item based on:
      - Keyword relevance (high / medium impact words)
      - Symbol mention in headline or summary
      - Sector relevance
    """

    def __init__(self, live_data_manager=None, cache_minutes: int = 30):
        self.live_mgr = live_data_manager
        self._cache_minutes = cache_minutes
        self._news_cache: Dict[str, Dict] = {}  # keyed by feed URL

    # ------------------------------------------------------------------
    # News fetching
    # ------------------------------------------------------------------

    def fetch_news(
        self,
        symbol: Optional[str] = None,
        sector: Optional[str] = None,
        days: int = 7,
        min_impact: int = 5,
    ) -> List[Dict[str, Any]]:
        """
        Fetch and score recent news from Indian financial RSS feeds.

        Args:
            symbol:     If provided, boost articles mentioning this symbol.
            sector:     If provided, boost sector-related articles.
            days:       Only include articles from the last N days.
            min_impact: Minimum impact score (0-10) to include.

        Returns:
            List of news dicts sorted by impact score descending.
        """
        cutoff = datetime.now() - timedelta(days=days)
        all_items: List[Dict[str, Any]] = []

        for source, url in RSS_FEEDS.items():
            items = self._fetch_feed(source, url, cutoff)
            all_items.extend(items)

        # Score and filter
        scored = []
        for item in all_items:
            score = self._score_article(item, symbol, sector)
            if score >= min_impact:
                item["impact_score"] = score
                scored.append(item)

        scored.sort(key=lambda x: x["impact_score"], reverse=True)
        return scored

    def get_corporate_actions(self, symbol: str) -> List[Dict[str, Any]]:
        """
        Return corporate actions for *symbol* via the LiveDataManager (NSEPython).
        Falls back to an empty list if unavailable.
        """
        if self.live_mgr is None:
            return []
        try:
            return self.live_mgr.get_corporate_actions(symbol)
        except Exception as exc:
            logger.warning("Corporate actions fetch failed for %s: %s", symbol, exc)
            return []

    def generate_daily_briefing(self, portfolio: List[str]) -> str:
        """
        Produce a formatted daily briefing for a list of holdings.

        Args:
            portfolio: List of NSE symbols (e.g. ['RELIANCE', 'TCS']).

        Returns:
            Formatted text briefing.
        """
        lines = [
            "=" * 64,
            f"DAILY PORTFOLIO BRIEFING  –  {datetime.now().strftime('%d %b %Y %H:%M')}",
            "=" * 64,
            "",
        ]

        for symbol in portfolio:
            lines.append(f"── {symbol} ──────────────────────────────────────")

            # Corporate actions
            actions = self.get_corporate_actions(symbol)
            if actions:
                lines.append("  Corporate Actions:")
                for a in actions[:3]:
                    lines.append(f"    • {a['action_type']} on {a['ex_date']} – {a['details']}")
            else:
                lines.append("  Corporate Actions: None in recent history")

            # News
            news = self.fetch_news(symbol=symbol, days=7, min_impact=4)
            if news:
                lines.append("  Top News:")
                for n in news[:3]:
                    lines.append(
                        f"    [{n['impact_score']}/10] {n['title'][:80]}"
                        f"  ({n['source']})"
                    )
            else:
                lines.append("  News: No high-impact news in last 7 days")

            lines.append("")

        lines.append("=" * 64)
        return "\n".join(lines)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _fetch_feed(
        self, source: str, url: str, cutoff: datetime
    ) -> List[Dict[str, Any]]:
        """Download and parse a single RSS feed, respecting cache TTL."""
        cache_entry = self._news_cache.get(url)
        if cache_entry:
            age_mins = (time.time() - cache_entry["fetched_at"]) / 60
            if age_mins < self._cache_minutes:
                return cache_entry["items"]

        items: List[Dict[str, Any]] = []
        if not _FEEDPARSER_OK:
            logger.warning("feedparser unavailable – news fetching from %s skipped", source)
            self._news_cache[url] = {"items": [], "fetched_at": time.time()}
            return []

        try:
            for attempt in range(3):
                try:
                    resp = requests.get(url, timeout=10, headers={"User-Agent": "Mozilla/5.0"})
                    feed = _feedparser.parse(resp.content)
                    break
                except requests.RequestException as exc:
                    if attempt == 2:
                        raise
                    time.sleep(2 ** attempt)

            for entry in feed.entries:
                pub_dt = self._parse_date(entry)
                if pub_dt and pub_dt < cutoff:
                    continue

                items.append({
                    "title": entry.get("title", ""),
                    "summary": entry.get("summary", entry.get("description", "")),
                    "link": entry.get("link", ""),
                    "published": pub_dt.isoformat() if pub_dt else "",
                    "source": source,
                    "impact_score": 0,
                })

            self._news_cache[url] = {"items": items, "fetched_at": time.time()}
            logger.info("Fetched %d items from %s", len(items), source)

        except Exception as exc:
            logger.warning("Failed to fetch RSS from %s (%s): %s", source, url, exc)

        return items

    @staticmethod
    def _parse_date(entry) -> Optional[datetime]:
        """Convert feedparser's published_parsed to datetime."""
        try:
            if hasattr(entry, "published_parsed") and entry.published_parsed:
                import calendar
                return datetime.fromtimestamp(calendar.timegm(entry.published_parsed))
        except Exception:
            pass
        return None

    @staticmethod
    def _score_article(
        article: Dict[str, Any],
        symbol: Optional[str],
        sector: Optional[str],
    ) -> int:
        """Compute impact score (0-10) for a news article."""
        text = (article.get("title", "") + " " + article.get("summary", "")).lower()
        score = 0

        for kw in HIGH_IMPACT_KEYWORDS:
            if kw in text:
                score += 3

        for kw in MEDIUM_IMPACT_KEYWORDS:
            if kw in text:
                score += 1

        if symbol and re.search(r'\b' + re.escape(symbol.lower()) + r'\b', text):
            score += 2

        if sector and sector.lower() in text:
            score += 1

        return min(score, 10)
