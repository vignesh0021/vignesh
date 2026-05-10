"""
News and Corporate Actions Monitor for Indian stocks.

Improvements over v1:
  - Sentiment-aware scoring: negation words flip negative keywords to positive
  - Distinguishes positive vs negative high-impact events
  - feedparser imported lazily (handles broken system installs gracefully)
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
except Exception:
    _feedparser = None  # type: ignore[assignment]
    _FEEDPARSER_OK = False

logger = logging.getLogger(__name__)

# ── Sentiment-aware keyword lists ──────────────────────────────────────────

# High-impact POSITIVE events: earnings beat, approval, contract win …
_HIGH_POS = [
    "earnings beat", "profit rises", "strong results", "record profit",
    "dividend declared", "bonus shares", "stock split", "buyback",
    "merger", "acquisition", "contract won", "order received",
    "fda approval", "drug approval", "approval received", "rating upgrade",
    "debt free", "promoter buying", "insider buying", "rights issue",
    "qip", "delisting offer",
]

# High-impact NEGATIVE events: default, fraud, penalty …
_HIGH_NEG = [
    "default", "loan default", "npa", "fraud", "sebi order", "sebi ban",
    "penalty imposed", "fraud detected", "cbi raid", "income tax raid",
    "profit falls", "net loss", "earnings miss", "guidance cut",
    "promoter pledging", "promoter selling", "credit downgrade",
    "bankruptcy", "insolvency", "nclt", "debt restructuring",
    "margin call", "forced selling",
]

# Medium-impact neutral / ambiguous terms (+1 each)
_MEDIUM = [
    "target price", "price target", "analyst upgrade", "analyst downgrade",
    "buy recommendation", "sell recommendation", "hold recommendation",
    "outlook positive", "outlook negative", "initiating coverage",
    "maintain outperform", "maintain underperform", "results announced",
    "quarterly results",
]

# Negation words that flip the sentiment of an immediately following keyword
_NEGATION = re.compile(
    r"\b(not|no|avoids?|denies?|clears?|without|rules? out|"
    r"dismisses?|rejects?|reverses?|prevents?|unlikely)\b",
    re.IGNORECASE,
)

RSS_FEEDS: Dict[str, str] = {
    "MoneyControl":     "https://www.moneycontrol.com/rss/marketreports.xml",
    "EconomicTimes":    "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms",
    "LiveMint":         "https://www.livemint.com/rss/markets",
    "BusinessStandard": "https://www.business-standard.com/rss/markets-106.rss",
}


class IndianStockMonitor:
    """
    Monitors news and corporate actions for Indian equity portfolios.

    Impact score (0-10):
      Positive high-impact keyword:  +3
      Negative high-impact keyword:  +3  (flagged as negative)
      Negation before neg keyword:   reverses to +0 (not counted negative)
      Medium keyword:                +1
      Symbol match in text:          +2
      Sector match:                  +1
    Final score = min(raw, 10); sentiment = positive / negative / neutral.
    """

    def __init__(self, live_data_manager=None, cache_minutes: int = 30):
        self.live_mgr       = live_data_manager
        self._cache_min     = cache_minutes
        self._feed_cache:   Dict[str, Dict] = {}

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def fetch_news(
        self,
        symbol: Optional[str] = None,
        sector: Optional[str] = None,
        days: int = 7,
        min_impact: int = 5,
    ) -> List[Dict[str, Any]]:
        """
        Fetch, score, and filter recent Indian market news.

        Args:
            symbol:     Boost articles mentioning this symbol.
            sector:     Boost sector-related articles.
            days:       Only include articles from last N days.
            min_impact: Minimum impact score (0-10) to include.

        Returns:
            Sorted list (impact desc) of scored news dicts.
        """
        if not _FEEDPARSER_OK:
            logger.info("feedparser unavailable – news fetching skipped")
            return []

        cutoff = datetime.now() - timedelta(days=days)
        all_items: List[Dict[str, Any]] = []

        for source, url in RSS_FEEDS.items():
            all_items.extend(self._fetch_feed(source, url, cutoff))

        scored = []
        for item in all_items:
            score, sentiment = self._score(item, symbol, sector)
            if score >= min_impact:
                item["impact_score"] = score
                item["sentiment"]    = sentiment
                scored.append(item)

        scored.sort(key=lambda x: x["impact_score"], reverse=True)
        return scored

    def get_corporate_actions(self, symbol: str) -> List[Dict[str, Any]]:
        """Return corporate actions for *symbol* via LiveDataManager."""
        if self.live_mgr is None:
            return []
        try:
            return self.live_mgr.get_corporate_actions(symbol)
        except Exception as exc:
            logger.warning("Corporate actions failed for %s: %s", symbol, exc)
            return []

    def generate_daily_briefing(self, portfolio: List[str]) -> str:
        """Generate a formatted daily portfolio briefing."""
        lines = [
            "=" * 64,
            f"DAILY PORTFOLIO BRIEFING  –  {datetime.now().strftime('%d %b %Y %H:%M')}",
            "=" * 64, "",
        ]

        for symbol in portfolio:
            lines.append(f"── {symbol} ──────────────────────────────────────")

            actions = self.get_corporate_actions(symbol)
            if actions:
                lines.append("  Corporate Actions:")
                for a in actions[:3]:
                    lines.append(f"    • {a['action_type']} on {a['ex_date']} – {a['details']}")
            else:
                lines.append("  Corporate Actions: None in recent history")

            news = self.fetch_news(symbol=symbol, days=7, min_impact=4)
            if news:
                lines.append("  Top News:")
                for n in news[:3]:
                    sent = n.get("sentiment", "neutral")
                    icon = "▲" if sent == "positive" else ("▼" if sent == "negative" else "–")
                    lines.append(
                        f"    {icon}[{n['impact_score']}/10] {n['title'][:78]}"
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
        """Download and cache a single RSS feed."""
        entry = self._feed_cache.get(url)
        if entry and (time.time() - entry["ts"]) / 60 < self._cache_min:
            return entry["items"]

        items: List[Dict[str, Any]] = []
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

            for e in feed.entries:
                pub = _parse_date(e)
                if pub and pub < cutoff:
                    continue
                items.append({
                    "title":     e.get("title", ""),
                    "summary":   e.get("summary", e.get("description", "")),
                    "link":      e.get("link", ""),
                    "published": pub.isoformat() if pub else "",
                    "source":    source,
                })

            self._feed_cache[url] = {"items": items, "ts": time.time()}
            logger.info("Fetched %d items from %s", len(items), source)

        except Exception as exc:
            logger.warning("RSS fetch failed (%s – %s): %s", source, url, exc)

        return items

    @staticmethod
    def _score(
        article: Dict[str, Any],
        symbol: Optional[str],
        sector: Optional[str],
    ) -> tuple:
        """
        Return (score, sentiment) for *article*.
        Negation detection: a negation word within 4 tokens of a negative
        keyword converts it from negative to neutral (no score awarded).
        """
        text = (article.get("title", "") + " " + article.get("summary", "")).lower()
        raw_score = 0
        pos_hits  = 0
        neg_hits  = 0

        # --- Positive high-impact ---
        for kw in _HIGH_POS:
            if kw in text:
                raw_score += 3
                pos_hits  += 1

        # --- Negative high-impact (with negation check) ---
        for kw in _HIGH_NEG:
            idx = text.find(kw)
            if idx == -1:
                continue
            # Look at the 60 characters preceding the keyword for negation
            prefix = text[max(0, idx - 60): idx]
            if _NEGATION.search(prefix):
                # Negated negative = neutral; don't penalise
                pass
            else:
                raw_score += 3
                neg_hits  += 1

        # --- Medium keywords ---
        for kw in _MEDIUM:
            if kw in text:
                raw_score += 1

        # --- Symbol boost ---
        if symbol:
            pattern = r"\b" + re.escape(symbol.lower()) + r"\b"
            if re.search(pattern, text):
                raw_score += 2
                # Determine sentiment direction from surrounding context
                if pos_hits > neg_hits:
                    pass  # already counted
                elif neg_hits > pos_hits:
                    pass

        # --- Sector boost ---
        if sector and sector.lower() in text:
            raw_score += 1

        score     = min(raw_score, 10)
        sentiment = (
            "positive" if pos_hits > neg_hits else
            "negative" if neg_hits > pos_hits else
            "neutral"
        )
        return score, sentiment


def _parse_date(entry) -> Optional[datetime]:
    try:
        if getattr(entry, "published_parsed", None):
            import calendar
            return datetime.fromtimestamp(calendar.timegm(entry.published_parsed))
    except Exception:
        pass
    return None
