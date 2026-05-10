"""
Screener.in Web Scraper.

Replaces the non-functional JUFinance dependency with a direct BeautifulSoup
parser of the publicly accessible Screener.in pages.

Screener URLs:
  Consolidated: https://www.screener.in/company/{SYMBOL}/consolidated/
  Standalone:   https://www.screener.in/company/{SYMBOL}/

All monetary values are returned in Indian Rupee Crores (₹ Cr).
Percentages are returned as plain floats (e.g. 15.3 for 15.3%).
"""
import re
import time
import logging
from typing import Any, Dict, List, Optional, Tuple

import requests
from bs4 import BeautifulSoup, Tag

from utils.units import parse_screener_number

logger = logging.getLogger(__name__)

_BASE = "https://www.screener.in/company"
_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
}

# Screener.in P&L row name → our canonical key
_PL_MAP = {
    "sales": "revenue", "revenue": "revenue",
    "operating profit": "operating_profit",
    "opm %": "opm_pct", "opm%": "opm_pct",
    "other income": "other_income",
    "interest": "interest",
    "depreciation": "depreciation",
    "profit before tax": "profit_before_tax",
    "tax %": "tax_pct", "tax%": "tax_pct",
    "net profit": "net_income",
    "profit after tax": "net_income",
    "eps in rs": "eps", "eps": "eps",
}

# Balance Sheet row name → canonical key
_BS_MAP = {
    "share capital": "share_capital",
    "reserves": "reserves",
    "borrowings": "borrowings",
    "other liabilities": "other_liabilities",
    "total liabilities": "total_liabilities",
    "fixed assets": "fixed_assets",
    "cwip": "cwip",
    "investments": "investments",
    "other assets": "other_assets",
    "total assets": "total_assets",
}

# Cash Flow row name → canonical key
_CF_MAP = {
    "cash from operating activity": "operating_cash_flow",
    "cash from investing activity": "investing_cash_flow",
    "cash from financing activity": "financing_cash_flow",
    "net cash flow": "net_cash_flow",
    "capital expenditure": "capex",
}


class ScreenerScraper:
    """
    Fetches and parses company financial data from Screener.in.

    Tries the consolidated view first (most relevant for large companies),
    then falls back to standalone if consolidated is unavailable.
    """

    def __init__(self, session: Optional[requests.Session] = None):
        self._session = session or requests.Session()
        self._session.headers.update(_HEADERS)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def get_company_data(self, symbol: str) -> Dict[str, Any]:
        """
        Fetch all available data for *symbol* from Screener.in.

        Returns a dict with:
          ratios           – key valuation / quality metrics
          shareholding     – promoter, FII, DII, public, pledged %
          income_statement – list of annual P&L dicts (Crores)
          balance_sheet    – list of annual B/S dicts (Crores)
          cash_flow        – list of annual CF dicts (Crores)
          quarterly        – list of quarterly P&L dicts (Crores)
          pros / cons      – list of text strings
        """
        for view in ("consolidated", ""):
            url = (
                f"{_BASE}/{symbol}/consolidated/" if view == "consolidated"
                else f"{_BASE}/{symbol}/"
            )
            try:
                resp = self._get(url)
                if resp is None:
                    continue
                if resp.status_code == 404:
                    logger.debug("Screener 404 for %s (%s)", symbol, view or "standalone")
                    continue
                if resp.status_code != 200:
                    continue
                soup = BeautifulSoup(resp.content, "lxml")
                data = self._parse(soup, symbol, view or "standalone")
                if data.get("ratios"):  # got something useful
                    logger.info("Screener.in data fetched for %s (%s)", symbol, view or "standalone")
                    return data
            except Exception as exc:
                logger.warning("Screener fetch %s (%s): %s", symbol, view, exc)

        logger.warning("Screener.in: no data for %s", symbol)
        return {"symbol": symbol, "error": "Screener.in fetch failed",
                "ratios": {}, "shareholding": {}, "income_statement": [],
                "balance_sheet": [], "cash_flow": [], "quarterly": [],
                "pros": [], "cons": []}

    # ------------------------------------------------------------------
    # HTTP
    # ------------------------------------------------------------------

    def _get(self, url: str, retries: int = 3) -> Optional[requests.Response]:
        for attempt in range(retries):
            try:
                return self._session.get(url, timeout=15)
            except requests.RequestException as exc:
                if attempt == retries - 1:
                    raise
                time.sleep(2 ** attempt)
        return None

    # ------------------------------------------------------------------
    # Page parsing
    # ------------------------------------------------------------------

    def _parse(self, soup: BeautifulSoup, symbol: str, view: str) -> Dict[str, Any]:
        return {
            "symbol": symbol,
            "view": view,
            "ratios": self._parse_top_ratios(soup),
            "shareholding": self._parse_shareholding(soup),
            "income_statement": self._parse_table(soup, "profit-loss", _PL_MAP),
            "balance_sheet": self._parse_table(soup, "balance-sheet", _BS_MAP),
            "cash_flow": self._parse_table(soup, "cash-flow", _CF_MAP),
            "quarterly": self._parse_table(soup, "quarters", _PL_MAP),
            "pros": self._parse_bullets(soup, "div.pros"),
            "cons": self._parse_bullets(soup, "div.cons"),
        }

    # ------ Top ratio bar ------

    def _parse_top_ratios(self, soup: BeautifulSoup) -> Dict[str, float]:
        ratios: Dict[str, float] = {}

        # Modern Screener layout: <section id="top"> <ul> <li> ...
        top = soup.find(id="top")
        if isinstance(top, Tag):
            for li in top.find_all("li"):
                name_tag = li.find("span", class_="name") or li.find(class_="name")
                val_tag  = (li.find("span", class_="number")
                            or li.find("span", class_="value")
                            or li.find(class_="number"))
                if name_tag and val_tag:
                    key = _normalise_key(name_tag.get_text())
                    val = parse_screener_number(val_tag.get_text())
                    if val is not None:
                        ratios[key] = val

        # Fallback: company ratios in a different layout
        if not ratios:
            for ul in soup.find_all("ul", class_=re.compile(r"company-ratios|ratios")):
                for li in ul.find_all("li"):
                    spans = li.find_all("span")
                    if len(spans) >= 2:
                        key = _normalise_key(spans[0].get_text())
                        val = parse_screener_number(spans[-1].get_text())
                        if val is not None:
                            ratios[key] = val

        return ratios

    # ------ Shareholding ------

    def _parse_shareholding(self, soup: BeautifulSoup) -> Dict[str, float]:
        result = {"promoter": 0.0, "fii": 0.0, "dii": 0.0,
                  "public": 0.0, "pledged": 0.0}

        section = soup.find(id="shareholding")
        if not isinstance(section, Tag):
            return result

        table = section.find("table")
        if not isinstance(table, Tag):
            return result

        rows = table.find_all("tr")
        for row in rows:
            cells = row.find_all(["td", "th"])
            if len(cells) < 2:
                continue
            label = cells[0].get_text(strip=True).lower()
            # Most-recent column = last <td>
            val = parse_screener_number(cells[-1].get_text(strip=True))
            if val is None:
                continue
            if "promoter" in label and "pledge" not in label:
                result["promoter"] = val
            elif any(k in label for k in ("fii", "foreign institutional")):
                result["fii"] = val
            elif any(k in label for k in ("dii", "domestic institutional", "mutual fund")):
                result["dii"] = val
            elif "public" in label:
                result["public"] = val

        # Pledged % – sometimes in a separate sub-table or inline text
        section_text = section.get_text(" ")
        m = re.search(r"pledged[^\d]*(\d+\.?\d*)\s*%?", section_text, re.IGNORECASE)
        if m:
            result["pledged"] = float(m.group(1))

        return result

    # ------ Financial tables ------

    def _parse_table(
        self,
        soup: BeautifulSoup,
        section_id: str,
        field_map: Dict[str, str],
    ) -> List[Dict[str, Any]]:
        """
        Parse a Screener.in financial data table.

        Returns a list of period dicts, oldest first.
        Each dict: { "period": "Mar 2024", <canonical_field>: float, ... }
        """
        section = soup.find(id=section_id)
        if not isinstance(section, Tag):
            return []

        table = section.find("table")
        if not isinstance(table, Tag):
            return []

        thead = table.find("thead") or table.find("tr")
        if not isinstance(thead, Tag):
            return []

        # Extract column headers (period labels)
        header_cells = thead.find_all(["th", "td"])
        periods = [c.get_text(strip=True) for c in header_cells[1:]]
        if not periods:
            return []

        # Build {period → {field → value}} mapping
        period_data: Dict[str, Dict[str, float]] = {p: {} for p in periods}

        tbody = table.find("tbody") or table
        for row in tbody.find_all("tr"):
            cells = row.find_all(["td", "th"])
            if not cells:
                continue
            # Row label (strip trailing + for expandable rows)
            raw_label = cells[0].get_text(strip=True).strip("+").lower()
            canonical = field_map.get(raw_label)
            if canonical is None:
                continue
            for i, cell in enumerate(cells[1:]):
                if i < len(periods):
                    val = parse_screener_number(cell.get_text(strip=True))
                    if val is not None:
                        period_data[periods[i]][canonical] = val

        # Convert to list; compute derived fields
        records = []
        for period, fields in period_data.items():
            if not fields:
                continue
            rec: Dict[str, Any] = {"period": period}
            rec.update(fields)

            # Derive free_cash_flow if not directly present
            if "free_cash_flow" not in rec:
                ocf = rec.get("operating_cash_flow", 0.0)
                capex = abs(rec.get("capex", 0.0))
                if not capex:
                    # Use investing CF as capex proxy (sign is already negative in Screener)
                    inv = rec.get("investing_cash_flow", 0.0)
                    capex = abs(inv) if inv < 0 else 0.0
                rec["free_cash_flow"] = ocf - capex

            # Derive total equity for balance sheet
            if "total_equity" not in rec and "share_capital" in rec:
                rec["total_equity"] = rec.get("share_capital", 0) + rec.get("reserves", 0)

            # total_debt alias
            if "total_debt" not in rec and "borrowings" in rec:
                rec["total_debt"] = rec["borrowings"]

            records.append(rec)

        return records  # oldest → newest (Screener orders newest-first; we reverse)

    # ------ Pros / Cons ------

    @staticmethod
    def _parse_bullets(soup: BeautifulSoup, selector: str) -> List[str]:
        container = soup.select_one(selector)
        if not container:
            return []
        return [li.get_text(strip=True) for li in container.find_all("li") if li.get_text(strip=True)]


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

def _normalise_key(text: str) -> str:
    """Convert a display label to a snake_case dict key."""
    return re.sub(r"\s+", "_", text.strip().lower().replace(".", "").replace("/", "_"))
