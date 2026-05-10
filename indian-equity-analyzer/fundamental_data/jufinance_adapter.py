"""
Fundamental Data Manager.

Primary source: Screener.in (via ScreenerScraper) – returns ROCE, promoter
holding, pledging %, and full Indian financial statements.

Fallback:       yfinance – for PE, PB, market cap, basic ratios.

All monetary values stored and returned in ₹ Crores.
Percentages as plain floats (e.g. 15.3 for 15.3 %).
"""
import json
import logging
import math
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np

from utils.units import abs_to_cr, parse_screener_number, safe_divide
from utils.database import AnalysisDatabase
from fundamental_data.screener_scraper import ScreenerScraper

logger = logging.getLogger(__name__)


class FundamentalDataManager:
    """
    Provides fundamental financial data for Indian stocks.

    Cache strategy:
      - SQLite DB (24 h TTL) for full fundamental snapshots
      - In-memory dict for session-level ratio/growth caching
    """

    def __init__(
        self,
        cache_dir: str = "./data/fundamentals",
        db: Optional[AnalysisDatabase] = None,
    ):
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self._db = db or AnalysisDatabase()
        self._scraper = ScreenerScraper()
        self._mem_cache: Dict[str, Dict] = {}

    # ------------------------------------------------------------------
    # Public API – full fundamentals
    # ------------------------------------------------------------------

    def get_full_fundamentals(self, symbol: str) -> Dict[str, Any]:
        """
        Return a comprehensive fundamental snapshot for *symbol*.
        Tries DB cache first (24 h), then Screener.in, then yfinance.
        """
        # 1. DB cache
        cached = self._db.load_fundamentals(symbol, max_age=86_400)
        if cached:
            return cached

        # 2. Screener.in
        data = self._build_from_screener(symbol)

        # 3. Fill any gaps with yfinance
        data = self._enrich_yfinance(symbol, data)

        self._db.save_fundamentals(symbol, data)
        return data

    def get_key_ratios(self, symbol: str) -> Dict[str, float]:
        """
        Return a flat dict of key ratios (all floats).

        Keys: pe, pb, dividend_yield, roe, roce, debt_equity,
              promoter_holding, fii_holding, dii_holding, pledged_pct,
              market_cap (Cr), current_ratio, interest_coverage,
              asset_turnover, price_to_sales.
        """
        cache_key = f"ratios:{symbol}"
        if cache_key in self._mem_cache:
            return self._mem_cache[cache_key]

        full = self.get_full_fundamentals(symbol)
        si = full.get("stock_info", {})
        fi = full.get("financials", {})
        bi = full.get("basic_info", {})

        ratios = {
            "pe":                  _sf(si.get("pe")),
            "pb":                  _sf(si.get("pb")),
            "dividend_yield":      _sf(si.get("dividend_yield")),
            "roe":                 _sf(fi.get("roe")),
            "roce":                _sf(fi.get("roce")),
            "debt_equity":         _sf(fi.get("debt_equity")),
            "promoter_holding":    _sf(fi.get("promoter_holding")),
            "fii_holding":         _sf(fi.get("fii_holding")),
            "dii_holding":         _sf(fi.get("dii_holding")),
            "pledged_pct":         _sf(fi.get("pledged_pct")),
            "market_cap":          _sf(bi.get("market_cap")),  # Crores
            "current_ratio":       _sf(fi.get("current_ratio")),
            "interest_coverage":   _sf(fi.get("interest_coverage")),
            "asset_turnover":      _sf(fi.get("asset_turnover")),
            "price_to_sales":      _sf(si.get("price_to_sales")),
        }

        self._mem_cache[cache_key] = ratios
        return ratios

    def get_financial_statements(self, symbol: str) -> Dict[str, List]:
        """
        Return parsed annual financial statements in ₹ Crores.

        Keys: balance_sheet, income_statement, cash_flow, quarterly_results.
        Each value is a list of period dicts sorted oldest→newest.
        """
        cache_key = f"stmts:{symbol}"
        if cache_key in self._mem_cache:
            return self._mem_cache[cache_key]

        full = self.get_full_fundamentals(symbol)
        stmts = full.get("statements", {})

        result = {
            "balance_sheet":     stmts.get("balance_sheet", []),
            "income_statement":  stmts.get("income_statement", []),
            "cash_flow":         stmts.get("cash_flow", []),
            "quarterly_results": stmts.get("quarterly_results", []),
        }

        self._mem_cache[cache_key] = result
        return result

    def get_growth_metrics(self, symbol: str) -> Dict[str, float]:
        """
        Return YoY and 3-year CAGR growth rates (as %).

        Keys: sales_growth_yoy, profit_growth_yoy, eps_growth_yoy,
              sales_cagr_3y, profit_cagr_3y, fcf_growth_yoy.
        """
        cache_key = f"growth:{symbol}"
        if cache_key in self._mem_cache:
            return self._mem_cache[cache_key]

        stmts = self.get_financial_statements(symbol)
        income = stmts.get("income_statement", [])
        cf = stmts.get("cash_flow", [])

        def yoy(lst, key):
            if len(lst) < 2:
                return 0.0
            return _pct_chg(lst[-1].get(key), lst[-2].get(key))

        def cagr3(lst, key):
            if len(lst) < 4:
                return yoy(lst, key)
            return _cagr(_lv(lst, -4, key), _lv(lst, -1, key), 3)

        growth = {
            "sales_growth_yoy":   yoy(income, "revenue"),
            "profit_growth_yoy":  yoy(income, "net_income"),
            "eps_growth_yoy":     yoy(income, "eps"),
            "sales_cagr_3y":      cagr3(income, "revenue"),
            "profit_cagr_3y":     cagr3(income, "net_income"),
            "fcf_growth_yoy":     yoy(cf, "free_cash_flow"),
        }

        self._mem_cache[cache_key] = growth
        return growth

    # ------------------------------------------------------------------
    # Screener.in builder
    # ------------------------------------------------------------------

    def _build_from_screener(self, symbol: str) -> Dict[str, Any]:
        data: Dict[str, Any] = {
            "symbol": symbol,
            "fetched_at": datetime.now().isoformat(),
            "basic_info": {},
            "stock_info": {},
            "financials": {},
            "statements": {
                "income_statement": [],
                "balance_sheet": [],
                "cash_flow": [],
                "quarterly_results": [],
            },
        }

        try:
            raw = self._scraper.get_company_data(symbol)
            if raw.get("error"):
                return data

            ratios = raw.get("ratios", {})

            # ------ basic_info ------
            data["basic_info"] = {
                "market_cap": _sf(ratios.get("market_cap", ratios.get("mkt_cap"))),  # Cr
                "sector": "",
                "industry": "",
                "name": symbol,
            }

            # ------ stock_info (valuation multiples) ------
            data["stock_info"] = {
                "pe":             _sf(ratios.get("stock_p_e", ratios.get("p_e"))),
                "pb":             _sf(ratios.get("book_value") and
                                      ratios.get("current_price") and
                                      safe_divide(
                                          _sf(ratios.get("current_price")),
                                          _sf(ratios.get("book_value")))),
                "dividend_yield": _sf(ratios.get("dividend_yield")),
                "book_value":     _sf(ratios.get("book_value")),
                "eps":            _sf(ratios.get("eps")),
                "price_to_sales": 0.0,  # derived later if income available
            }

            # ------ financials (ratios) ------
            sh = raw.get("shareholding", {})
            data["financials"] = {
                "roe":               _sf(ratios.get("roe")),
                "roce":              _sf(ratios.get("roce")),
                "promoter_holding":  _sf(sh.get("promoter")),
                "fii_holding":       _sf(sh.get("fii")),
                "dii_holding":       _sf(sh.get("dii")),
                "pledged_pct":       _sf(sh.get("pledged")),
                "debt_equity":       0.0,  # derived below
                "current_ratio":     0.0,  # derived below
                "interest_coverage": 0.0,  # derived below
                "asset_turnover":    0.0,  # derived below
            }

            # ------ financial statements ------
            # Screener returns newest-first; we reverse to oldest-first
            inc = list(reversed(raw.get("income_statement", [])))
            bs  = list(reversed(raw.get("balance_sheet", [])))
            cf  = list(reversed(raw.get("cash_flow", [])))
            qtr = list(reversed(raw.get("quarterly", [])))

            data["statements"]["income_statement"]  = inc
            data["statements"]["balance_sheet"]     = bs
            data["statements"]["cash_flow"]         = cf
            data["statements"]["quarterly_results"] = qtr

            # Derive debt/equity, current ratio, asset turnover from latest BS + P&L
            if bs:
                latest_bs = bs[-1]
                equity    = _sf(latest_bs.get("total_equity",
                                               latest_bs.get("share_capital", 0)
                                               + latest_bs.get("reserves", 0)))
                debt      = _sf(latest_bs.get("total_debt",
                                               latest_bs.get("borrowings", 0)))
                assets    = _sf(latest_bs.get("total_assets", 1)) or 1

                data["financials"]["debt_equity"] = safe_divide(debt, equity)
                data["financials"]["asset_turnover"] = safe_divide(
                    _sf(inc[-1].get("revenue", 0)) if inc else 0, assets
                )

            if inc and bs:
                ebit = _sf(inc[-1].get("operating_profit", 0))
                interest = _sf(inc[-1].get("interest", 1)) or 1
                data["financials"]["interest_coverage"] = safe_divide(ebit, interest)

            # Price/Sales
            mkt_cap = data["basic_info"]["market_cap"]
            if mkt_cap and inc:
                rev = _sf(inc[-1].get("revenue", 0))
                if rev:
                    data["stock_info"]["price_to_sales"] = round(mkt_cap / rev, 2)

        except Exception as exc:
            logger.error("Screener build failed for %s: %s", symbol, exc)

        return data

    # ------------------------------------------------------------------
    # yfinance enrichment
    # ------------------------------------------------------------------

    def _enrich_yfinance(self, symbol: str, base: Dict) -> Dict:
        """Fill any zero/missing fields using yfinance."""
        try:
            import yfinance as yf
            info = yf.Ticker(f"{symbol}.NS").info or {}

            def fill(d: Dict, key: str, yf_key: str, transform=None) -> None:
                if d.get(key):
                    return
                val = info.get(yf_key)
                if val is not None and math.isfinite(float(val)):
                    d[key] = transform(float(val)) if transform else float(val)

            si = base.setdefault("stock_info", {})
            fill(si, "pe", "trailingPE")
            fill(si, "pe", "forwardPE")
            fill(si, "pb", "priceToBook")
            fill(si, "dividend_yield", "dividendYield", lambda x: x * 100)
            fill(si, "book_value", "bookValue")
            fill(si, "eps", "trailingEps")

            bi = base.setdefault("basic_info", {})
            fill(bi, "market_cap", "marketCap", abs_to_cr)  # yfinance → Crores
            bi.setdefault("sector", info.get("sector", ""))
            bi.setdefault("industry", info.get("industry", ""))
            bi.setdefault("name", info.get("longName", symbol))

            fi = base.setdefault("financials", {})
            fill(fi, "roe", "returnOnEquity", lambda x: x * 100)
            fill(fi, "debt_equity", "debtToEquity", lambda x: x / 100)  # yf gives %
            fill(fi, "current_ratio", "currentRatio")

            # If no statements at all, fetch from yfinance
            stmts = base.setdefault("statements", {})
            if not stmts.get("income_statement"):
                yf_stmts = self._yfinance_statements(symbol)
                for k, v in yf_stmts.items():
                    if v:
                        stmts.setdefault(k, v)

        except Exception as exc:
            logger.debug("yfinance enrichment failed for %s: %s", symbol, exc)

        return base

    def _yfinance_statements(self, symbol: str) -> Dict[str, List]:
        """Build statements from yfinance (values converted to Crores)."""
        result: Dict[str, List] = {
            "income_statement": [], "balance_sheet": [],
            "cash_flow": [], "quarterly_results": [],
        }
        try:
            import yfinance as yf
            t = yf.Ticker(f"{symbol}.NS")

            def _rows(df, mapping):
                if df is None or df.empty:
                    return []
                recs = []
                for col in reversed(df.columns):
                    period = str(col.date()) if hasattr(col, "date") else str(col)[:10]
                    rec = {"period": period}
                    for yf_key, our_key in mapping.items():
                        val = df[col].get(yf_key)
                        if val is not None and math.isfinite(float(val)):
                            rec[our_key] = abs_to_cr(float(val))
                    recs.append(rec)
                return recs

            _inc_map = {
                "Total Revenue": "revenue",
                "Gross Profit": "gross_profit",
                "Ebit": "operating_profit",
                "Operating Income": "operating_profit",
                "Net Income": "net_income",
                "Ebitda": "ebitda",
            }
            _bs_map = {
                "Total Assets": "total_assets",
                "Total Liabilities Net Minority Interest": "total_liabilities",
                "Stockholders Equity": "total_equity",
                "Total Debt": "total_debt",
                "Cash And Cash Equivalents": "cash",
                "Current Assets": "current_assets",
                "Current Liabilities": "current_liabilities",
                "Ordinary Shares Number": "share_capital",  # shares, not Cr
            }
            _cf_map = {
                "Operating Cash Flow": "operating_cash_flow",
                "Capital Expenditure": "capex",
                "Investing Cash Flow": "investing_cash_flow",
                "Financing Cash Flow": "financing_cash_flow",
            }

            inc = _rows(t.financials, _inc_map)
            for rec in inc:
                # EPS not in yfinance financials; skip
                pass
            result["income_statement"] = inc

            bs = _rows(t.balance_sheet, _bs_map)
            for rec in bs:
                if "total_equity" not in rec:
                    sc = rec.get("share_capital", 0)
                    rec["total_equity"] = sc  # crude fallback
                if "total_debt" not in rec:
                    rec["total_debt"] = 0.0
                rec.setdefault("total_liabilities",
                               rec.get("total_assets", 0) - rec.get("total_equity", 0))
            result["balance_sheet"] = bs

            cf = _rows(t.cashflow, _cf_map)
            for rec in cf:
                ocf  = rec.get("operating_cash_flow", 0)
                capex = abs(rec.get("capex", 0))
                inv   = rec.get("investing_cash_flow", 0)
                if not capex and inv < 0:
                    capex = abs(inv)
                rec["free_cash_flow"] = ocf - capex
            result["cash_flow"] = cf

            result["quarterly_results"] = _rows(t.quarterly_financials, _inc_map)

        except Exception as exc:
            logger.debug("yfinance statements failed for %s: %s", symbol, exc)

        return result


# ------------------------------------------------------------------
# Numeric helpers (module-private)
# ------------------------------------------------------------------

def _sf(value: Any, default: float = 0.0) -> float:
    """Safe float conversion with NaN/Inf guard."""
    if value is None:
        return default
    try:
        v = float(str(value).replace(",", "").replace("%", "").strip())
        return v if math.isfinite(v) else default
    except (ValueError, TypeError):
        return default


def _pct_chg(curr: Any, prev: Any) -> float:
    c, p = _sf(curr), _sf(prev)
    if p == 0:
        return 0.0
    return round((c - p) / abs(p) * 100, 2)


def _cagr(start: Any, end: Any, years: int) -> float:
    s, e = _sf(start), _sf(end)
    if s <= 0 or years <= 0:
        return 0.0
    return round(((e / s) ** (1 / years) - 1) * 100, 2)


def _lv(lst: List, idx: int, key: str) -> float:
    """Last value: safely get lst[idx][key]."""
    try:
        return _sf(lst[idx].get(key))
    except (IndexError, AttributeError):
        return 0.0
