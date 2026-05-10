"""
Unit conversion utilities.

Internal monetary standard: Indian Rupee Crores (₹ Cr).
Per-share prices remain in absolute ₹ throughout.

Conversion table:
  1 Crore = 10,000,000 (1e7) absolute ₹
  1 Lakh  =     100,000 (1e5) absolute ₹
  yfinance marketCap, financials → absolute ₹  → divide by 1e7 → Crores
  Screener.in numbers             → already in Crores
"""
import re
import math
from typing import Optional, Union


_CRORE = 1_00_00_000  # 1e7


def abs_to_cr(value: float) -> float:
    """Convert absolute ₹ (yfinance style) to Crores."""
    if value is None or not math.isfinite(value):
        return 0.0
    return value / _CRORE


def cr_to_abs(value_cr: float) -> float:
    """Convert Crores to absolute ₹."""
    return value_cr * _CRORE


def shares_cr_from_mktcap(market_cap_cr: float, price: float) -> float:
    """
    Return shares outstanding in Crore units.

    market_cap_cr : market cap in ₹ Crores
    price         : current price in absolute ₹ per share
    Result        : shares in Crore units  (Cr ₹ / ₹ per share = Cr shares)
    """
    if price <= 0 or market_cap_cr <= 0:
        return 1.0
    return market_cap_cr / price


def normalise_market_cap(raw_value: float, source: str = "yfinance") -> float:
    """
    Return market cap in Crores regardless of the data source.

    source: 'yfinance'  → raw_value is absolute ₹  → convert
            'screener'  → raw_value is already Cr   → pass through
            'cr'        → already in Cr
    """
    if raw_value is None or not math.isfinite(raw_value):
        return 0.0
    if source == "yfinance":
        return abs_to_cr(raw_value)
    return float(raw_value)


def normalise_financial_value(raw_value: float, source: str = "yfinance") -> float:
    """
    Return a P&L / balance sheet value in Crores.

    yfinance financial statements are in absolute ₹.
    Screener.in financial tables are in Crores.
    """
    return normalise_market_cap(raw_value, source)


def parse_screener_number(text: str) -> Optional[float]:
    """
    Parse a Screener.in formatted number string.

    Handles:
      '₹2,345 Cr'  → 2345.0
      '12.3%'      → 12.3
      '-'          → None
      '2,345'      → 2345.0
      '1.23'       → 1.23
    """
    if not text:
        return None
    text = text.strip()
    if text in ("-", "", "N/A", "--", "NA", "—", "0"):
        return None
    # Strip currency symbol, commas, 'Cr', '%'
    cleaned = (
        text.replace("₹", "").replace(",", "")
            .replace("Cr", "").replace("%", "").strip()
    )
    match = re.search(r"-?\d+(?:\.\d+)?", cleaned)
    if not match:
        return None
    try:
        return float(match.group())
    except ValueError:
        return None


def safe_divide(numerator: float, denominator: float, default: float = 0.0) -> float:
    """Return numerator / denominator, or default if denominator is zero."""
    if not denominator or not math.isfinite(denominator):
        return default
    result = numerator / denominator
    return result if math.isfinite(result) else default
