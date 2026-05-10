"""
Fundamental Data Manager wrapping JUFinance + yfinance fallbacks.
Scrapes Screener.in / MoneyControl via JUFinance for financial statements
and key ratios needed by the screening and valuation engines.
"""
import json
import time
import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)


class FundamentalDataManager:
    """
    Provides fundamental financial data for Indian stocks.

    Primary source: JUFinance (wraps Screener.in + MoneyControl scraping).
    Fallback:       yfinance for key ratios when JUFinance scraping fails.
    Cache:          JSON files on disk, 1-hour expiry.
    """

    def __init__(self, cache_dir: str = "./data/fundamentals"):
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self._cache_ttl = 3600  # seconds

        self._jufinance_ok = False
        self._init_jufinance()

    def _init_jufinance(self) -> None:
        try:
            import jufinance  # noqa: F401
            self._jufinance_ok = True
            logger.info("JUFinance initialised successfully")
        except ImportError:
            logger.warning("JUFinance not installed – using yfinance fallback for fundamentals")

    # ------------------------------------------------------------------
    # Cache helpers
    # ------------------------------------------------------------------

    def _cache_path(self, key: str) -> Path:
        safe = key.replace("/", "_").replace(":", "_").replace(" ", "_")
        return self.cache_dir / f"{safe}.json"

    def _load_cache(self, key: str) -> Optional[Dict]:
        cp = self._cache_path(key)
        if not cp.exists():
            return None
        if (time.time() - cp.stat().st_mtime) > self._cache_ttl:
            return None
        try:
            with cp.open() as f:
                return json.load(f)
        except Exception:
            return None

    def _save_cache(self, key: str, data: Dict) -> None:
        try:
            with self._cache_path(key).open("w") as f:
                json.dump(data, f, default=str)
        except Exception as exc:
            logger.debug("Cache write failed for %s: %s", key, exc)

    # ------------------------------------------------------------------
    # Retry
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
    # Public API – full fundamentals
    # ------------------------------------------------------------------

    def get_full_fundamentals(self, symbol: str) -> Dict[str, Any]:
        """
        Return a comprehensive fundamental snapshot for *symbol*.

        Keys: basic_info, financials, stock_info, dcf_value,
              broker_research, pros_cons, annual_reports.
        """
        cache_key = f"full_{symbol}"
        cached = self._load_cache(cache_key)
        if cached:
            return cached

        data: Dict[str, Any] = {
            "symbol": symbol,
            "fetched_at": datetime.now().isoformat(),
            "basic_info": {},
            "financials": {},
            "stock_info": {},
            "dcf_value": None,
            "broker_research": [],
            "pros_cons": {"pros": [], "cons": []},
            "annual_reports": [],
        }

        if self._jufinance_ok:
            data = self._fetch_jufinance_full(symbol, data)

        # Always enrich / fill gaps with yfinance
        data = self._enrich_with_yfinance(symbol, data)

        self._save_cache(cache_key, data)
        return data

    def get_key_ratios(self, symbol: str) -> Dict[str, float]:
        """
        Return a flat dict of key valuation and quality ratios.

        Keys: pe, pb, dividend_yield, roe, roce, debt_equity,
              promoter_holding, fii_holding, dii_holding, market_cap,
              current_ratio, interest_coverage, asset_turnover.
        """
        cache_key = f"ratios_{symbol}"
        cached = self._load_cache(cache_key)
        if cached:
            return cached

        full = self.get_full_fundamentals(symbol)

        ratios: Dict[str, float] = {
            "pe": self._safe_float(full.get("stock_info", {}).get("pe")),
            "pb": self._safe_float(full.get("stock_info", {}).get("pb")),
            "dividend_yield": self._safe_float(full.get("stock_info", {}).get("dividend_yield")),
            "roe": self._safe_float(full.get("financials", {}).get("roe")),
            "roce": self._safe_float(full.get("financials", {}).get("roce")),
            "debt_equity": self._safe_float(full.get("financials", {}).get("debt_equity")),
            "promoter_holding": self._safe_float(full.get("financials", {}).get("promoter_holding")),
            "fii_holding": self._safe_float(full.get("financials", {}).get("fii_holding")),
            "dii_holding": self._safe_float(full.get("financials", {}).get("dii_holding")),
            "market_cap": self._safe_float(full.get("basic_info", {}).get("market_cap")),
            "current_ratio": self._safe_float(full.get("financials", {}).get("current_ratio")),
            "interest_coverage": self._safe_float(full.get("financials", {}).get("interest_coverage")),
            "asset_turnover": self._safe_float(full.get("financials", {}).get("asset_turnover")),
            "pledged_pct": self._safe_float(full.get("financials", {}).get("pledged_pct")),
        }

        self._save_cache(cache_key, ratios)
        return ratios

    def get_financial_statements(self, symbol: str) -> Dict[str, Any]:
        """
        Return parsed annual financial statements.

        Keys: balance_sheet, income_statement, cash_flow, quarterly_results.
        Each is a list of annual (or quarterly) dicts with year/quarter + values.
        """
        cache_key = f"statements_{symbol}"
        cached = self._load_cache(cache_key)
        if cached:
            return cached

        full = self.get_full_fundamentals(symbol)
        stmts = full.get("financials", {}).get("statements", {})

        result = {
            "balance_sheet": stmts.get("balance_sheet", []),
            "income_statement": stmts.get("income_statement", []),
            "cash_flow": stmts.get("cash_flow", []),
            "quarterly_results": stmts.get("quarterly_results", []),
        }

        if not any(result.values()):
            result = self._fetch_yfinance_statements(symbol)

        self._save_cache(cache_key, result)
        return result

    def get_growth_metrics(self, symbol: str) -> Dict[str, float]:
        """
        Return YoY and CAGR growth metrics.

        Keys: sales_growth_yoy, profit_growth_yoy, eps_growth_yoy,
              sales_cagr_3y, profit_cagr_3y, fcf_growth_yoy.
        """
        cache_key = f"growth_{symbol}"
        cached = self._load_cache(cache_key)
        if cached:
            return cached

        stmts = self.get_financial_statements(symbol)
        income = stmts.get("income_statement", [])
        cash_flow = stmts.get("cash_flow", [])

        growth = {
            "sales_growth_yoy": 0.0,
            "profit_growth_yoy": 0.0,
            "eps_growth_yoy": 0.0,
            "sales_cagr_3y": 0.0,
            "profit_cagr_3y": 0.0,
            "fcf_growth_yoy": 0.0,
        }

        if len(income) >= 2:
            curr, prev = income[-1], income[-2]
            growth["sales_growth_yoy"] = self._pct_change(curr.get("revenue"), prev.get("revenue"))
            growth["profit_growth_yoy"] = self._pct_change(curr.get("net_income"), prev.get("net_income"))
            growth["eps_growth_yoy"] = self._pct_change(curr.get("eps"), prev.get("eps"))

        if len(income) >= 4:
            curr4, prev4 = income[-1], income[-4]
            growth["sales_cagr_3y"] = self._cagr(prev4.get("revenue"), curr4.get("revenue"), 3)
            growth["profit_cagr_3y"] = self._cagr(prev4.get("net_income"), curr4.get("net_income"), 3)

        if len(cash_flow) >= 2:
            curr_cf, prev_cf = cash_flow[-1], cash_flow[-2]
            growth["fcf_growth_yoy"] = self._pct_change(
                curr_cf.get("free_cash_flow"), prev_cf.get("free_cash_flow")
            )

        self._save_cache(cache_key, growth)
        return growth

    # ------------------------------------------------------------------
    # JUFinance integration
    # ------------------------------------------------------------------

    def _fetch_jufinance_full(self, symbol: str, base: Dict) -> Dict:
        """Try to enrich *base* using JUFinance scrapers."""
        try:
            from jufinance import get_stock_info, get_financial_data
            logger.info("Fetching JUFinance data for %s", symbol)

            stock_info = self._retry(get_stock_info, symbol)
            if stock_info:
                base["stock_info"].update({
                    "pe": self._safe_float(stock_info.get("P/E")),
                    "pb": self._safe_float(stock_info.get("P/B")),
                    "dividend_yield": self._safe_float(stock_info.get("Dividend Yield")),
                    "market_cap": self._safe_float(stock_info.get("Market Cap")),
                    "book_value": self._safe_float(stock_info.get("Book Value")),
                    "eps": self._safe_float(stock_info.get("EPS")),
                })

            fin_data = self._retry(get_financial_data, symbol)
            if fin_data:
                base["financials"].update({
                    "roe": self._safe_float(fin_data.get("ROE")),
                    "roce": self._safe_float(fin_data.get("ROCE")),
                    "debt_equity": self._safe_float(fin_data.get("Debt to Equity")),
                    "promoter_holding": self._safe_float(fin_data.get("Promoter Holding")),
                    "fii_holding": self._safe_float(fin_data.get("FII Holding")),
                    "dii_holding": self._safe_float(fin_data.get("DII Holding")),
                    "current_ratio": self._safe_float(fin_data.get("Current Ratio")),
                    "pledged_pct": self._safe_float(fin_data.get("Pledged Percentage")),
                })

        except Exception as exc:
            logger.warning("JUFinance full fetch failed for %s: %s", symbol, exc)

        return base

    # ------------------------------------------------------------------
    # yfinance enrichment / fallback
    # ------------------------------------------------------------------

    def _enrich_with_yfinance(self, symbol: str, base: Dict) -> Dict:
        """Fill zero/missing fields in *base* using yfinance."""
        try:
            import yfinance as yf
            info = yf.Ticker(f"{symbol}.NS").info or {}

            def fill(d: Dict, key: str, yf_key: str, scale: float = 1.0) -> None:
                if not d.get(key):
                    val = info.get(yf_key)
                    if val is not None:
                        d[key] = float(val) * scale

            si = base.setdefault("stock_info", {})
            fill(si, "pe", "trailingPE")
            fill(si, "pe", "forwardPE")
            fill(si, "pb", "priceToBook")
            fill(si, "dividend_yield", "dividendYield", 100)
            fill(si, "market_cap", "marketCap")
            fill(si, "book_value", "bookValue")
            fill(si, "eps", "trailingEps")

            bi = base.setdefault("basic_info", {})
            fill(bi, "market_cap", "marketCap")
            bi.setdefault("sector", info.get("sector", ""))
            bi.setdefault("industry", info.get("industry", ""))
            bi.setdefault("name", info.get("longName", symbol))

            fi = base.setdefault("financials", {})
            fill(fi, "roe", "returnOnEquity", 100)
            fill(fi, "debt_equity", "debtToEquity")
            fill(fi, "current_ratio", "currentRatio")
            fill(fi, "interest_coverage", "interestCoverage")
            fill(fi, "asset_turnover", "assetTurnover")

        except Exception as exc:
            logger.debug("yfinance enrichment failed for %s: %s", symbol, exc)

        return base

    def _fetch_yfinance_statements(self, symbol: str) -> Dict[str, List]:
        """Build income_statement, balance_sheet, cash_flow lists from yfinance."""
        result: Dict[str, List] = {
            "balance_sheet": [], "income_statement": [],
            "cash_flow": [], "quarterly_results": [],
        }
        try:
            import yfinance as yf
            ticker = yf.Ticker(f"{symbol}.NS")

            # Annual income statement
            ann_income = ticker.financials
            if ann_income is not None and not ann_income.empty:
                for col in ann_income.columns:
                    year = col.year if hasattr(col, "year") else str(col)[:4]
                    row = ann_income[col]
                    result["income_statement"].append({
                        "year": year,
                        "revenue": self._safe_float(row.get("Total Revenue")),
                        "gross_profit": self._safe_float(row.get("Gross Profit")),
                        "operating_income": self._safe_float(row.get("Operating Income", row.get("Ebit"))),
                        "net_income": self._safe_float(row.get("Net Income")),
                        "ebitda": self._safe_float(row.get("Ebitda")),
                        "eps": 0.0,
                    })
                result["income_statement"].reverse()

            # Annual balance sheet
            ann_bs = ticker.balance_sheet
            if ann_bs is not None and not ann_bs.empty:
                for col in ann_bs.columns:
                    year = col.year if hasattr(col, "year") else str(col)[:4]
                    row = ann_bs[col]
                    result["balance_sheet"].append({
                        "year": year,
                        "total_assets": self._safe_float(row.get("Total Assets")),
                        "total_liabilities": self._safe_float(
                            row.get("Total Liabilities Net Minority Interest",
                                    row.get("Total Liab"))
                        ),
                        "total_equity": self._safe_float(
                            row.get("Stockholders Equity",
                                    row.get("Total Stockholder Equity"))
                        ),
                        "total_debt": self._safe_float(
                            row.get("Total Debt", row.get("Long Term Debt", 0))
                        ),
                        "cash": self._safe_float(
                            row.get("Cash And Cash Equivalents",
                                    row.get("Cash", 0))
                        ),
                        "current_assets": self._safe_float(row.get("Current Assets")),
                        "current_liabilities": self._safe_float(row.get("Current Liabilities")),
                    })
                result["balance_sheet"].reverse()

            # Annual cash flow
            ann_cf = ticker.cashflow
            if ann_cf is not None and not ann_cf.empty:
                for col in ann_cf.columns:
                    year = col.year if hasattr(col, "year") else str(col)[:4]
                    row = ann_cf[col]
                    cfo = self._safe_float(row.get("Operating Cash Flow",
                                                    row.get("Total Cash From Operating Activities")))
                    capex = self._safe_float(row.get("Capital Expenditure",
                                                      row.get("Capital Expenditures", 0)))
                    result["cash_flow"].append({
                        "year": year,
                        "operating_cash_flow": cfo,
                        "capex": capex,
                        "free_cash_flow": cfo - abs(capex),
                        "investing_cash_flow": self._safe_float(
                            row.get("Investing Cash Flow",
                                    row.get("Total Cash From Investing Activities"))
                        ),
                        "financing_cash_flow": self._safe_float(
                            row.get("Financing Cash Flow",
                                    row.get("Total Cash From Financing Activities"))
                        ),
                    })
                result["cash_flow"].reverse()

            # Quarterly
            qtr_income = ticker.quarterly_financials
            if qtr_income is not None and not qtr_income.empty:
                for col in qtr_income.columns[:8]:
                    result["quarterly_results"].append({
                        "quarter": str(col.date()) if hasattr(col, "date") else str(col),
                        "revenue": self._safe_float(qtr_income[col].get("Total Revenue")),
                        "net_income": self._safe_float(qtr_income[col].get("Net Income")),
                    })
                result["quarterly_results"].reverse()

        except Exception as exc:
            logger.warning("yfinance statements failed for %s: %s", symbol, exc)

        return result

    # ------------------------------------------------------------------
    # Utilities
    # ------------------------------------------------------------------

    @staticmethod
    def _safe_float(value: Any, default: float = 0.0) -> float:
        if value is None:
            return default
        try:
            v = float(str(value).replace(",", "").replace("%", "").strip())
            return v if np.isfinite(v) else default
        except (ValueError, TypeError):
            return default

    @staticmethod
    def _pct_change(current: Any, previous: Any) -> float:
        try:
            c, p = float(current or 0), float(previous or 0)
            if p == 0:
                return 0.0
            return round((c - p) / abs(p) * 100, 2)
        except Exception:
            return 0.0

    @staticmethod
    def _cagr(start_val: Any, end_val: Any, years: int) -> float:
        try:
            s, e = float(start_val or 0), float(end_val or 0)
            if s <= 0 or years <= 0:
                return 0.0
            return round(((e / s) ** (1 / years) - 1) * 100, 2)
        except Exception:
            return 0.0
