# Indian Equity Analyzer

A production-ready Python framework for fundamental analysis and investment decision-making on NSE/BSE Indian stocks.

## What It Does

The system answers one question with absolute clarity: **"Should we invest in this Indian stock?"**

Output: `STRONG_BUY / BUY / HOLD / AVOID / STRONG_AVOID` with confidence %, target price, stop loss, position size, and detailed reasoning.

## Architecture

Six integrated open-source data sources:

| Module | Source | Purpose |
|--------|--------|---------|
| `data_collection` | Jugaad-Data + NSEPython | Historical OHLCV, live quotes, corporate actions |
| `fundamental_data` | JUFinance (Screener.in) | P&L, balance sheet, ratios, shareholding |
| `screening` | BharatQuant methodology | Piotroski F-Score, RS Score, Trend Stage |
| `valuation` | Monte Carlo DCF | 10,000-simulation DCF, Reverse DCF |
| `monitoring` | RSS feeds | News scoring, corporate actions |
| `decision_engine` | Composite engine | Weighted signal → Buy/Sell/Hold |

## Installation

```bash
# 1. Clone
git clone <repo-url>
cd indian-equity-analyzer

# 2. Create virtual environment
python -m venv venv
source venv/bin/activate        # Linux/Mac
# venv\Scripts\activate         # Windows

# 3. Install dependencies
pip install -r requirements.txt

# 4. (Optional) Install optional speedups
pip install yfinance lxml
```

**Minimum Python: 3.9**

### Dependency Notes

| Package | Role | Fallback |
|---------|------|---------|
| `jugaad-data` | Bhavcopy / historical NSE data | yfinance |
| `nsepython` | Live NSE quotes, corporate actions | yfinance |
| `jufinance` | Screener.in financials / ratios | yfinance |
| `yfinance` | Universal fallback | None |
| `scipy` | Brent's method for Reverse DCF | — |
| `feedparser` | RSS news parsing | — |

All primary sources are **free and public** – no API keys required.

## Quick Start

```python
from main import IndianEquityAnalyzer

analyzer = IndianEquityAnalyzer()

# Single stock deep dive
report = analyzer.full_analysis("RELIANCE")
print(report)

# Universe screening
nifty_10 = [
    "RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK",
    "HINDUNILVR", "SBIN", "BHARTIARTL", "ITC", "KOTAKBANK",
]
results = analyzer.screen_universe(nifty_10)
print(results.to_string())

# Portfolio daily briefing
holdings = ["RELIANCE", "TCS", "HDFCBANK"]
briefing = analyzer.monitor_portfolio(holdings)
print(briefing)
```

Or run the built-in demo:

```bash
python main.py
```

## Sample Report Output

```
================================================================
INVESTMENT DECISION REPORT: RELIANCE
================================================================

DECISION: BUY
CONFIDENCE: 72%

----------------------------------------------------------------
KEY REASONS TO CONSIDER:
----------------------------------------------------------------
1. Solid Piotroski F-Score of 7/9 – above average quality
2. Outperforming Nifty by 8.3% over last year
3. Stage 2 Advancing trend – price above 50-DMA with golden cross
4. Revenue growing at 12.4% YoY – above-market pace
5. Monte Carlo DCF suggests 18.2% upside to median intrinsic value

----------------------------------------------------------------
KEY RISKS:
----------------------------------------------------------------
1. Premium valuation (P/E 28.3x) leaves little margin of safety
2. High debt/equity of 0.82x – moderate leverage

----------------------------------------------------------------
TRADING PARAMETERS:
----------------------------------------------------------------
Current Price: ₹2,850.00
Target Price:  ₹3,380.00
Stop Loss:     ₹2,422.50
Position Size: Half
Time Horizon:  Medium
...
```

## Module Reference

### `IndianEquityAnalyzer` (main.py)

| Method | Description |
|--------|-------------|
| `full_analysis(symbol)` | Deep-dive single-stock report |
| `screen_universe(symbols)` | Rank a list by conviction |
| `monitor_portfolio(portfolio)` | Daily briefing for holdings |

### `BharatQuantScreener` (screening/)

| Method | Description |
|--------|-------------|
| `calculate_piotroski_f_score(symbol)` | 9-criteria F-Score (0-9) |
| `calculate_relative_strength(symbol)` | 1-year RS vs Nifty 50 |
| `detect_trend_stage(symbol)` | Weinstein Stage 1-4 |
| `run_full_screen(universe)` | DataFrame of all metrics |

### `MonteCarloDCF` (valuation/)

| Method | Description |
|--------|-------------|
| `calculate_wacc(...)` | India-adjusted WACC |
| `project_fcf(...)` | 10-year FCF projection |
| `run_monte_carlo(n=10000)` | Full distribution + percentiles |
| `generate_scenarios()` | Bear / Base / Bull DCF |

### `ReverseDCF` (valuation/)

| Method | Description |
|--------|-------------|
| `calculate_implied_growth(symbol, price)` | Solve for market's growth expectation |
| `compare_to_historical_growth(symbol, price)` | CHEAP / FAIR / EXPENSIVE assessment |

## Configuration

Edit `config/india_market_params.json` to tune:

```json
{
  "india": {
    "risk_free_rate": 0.07,
    "market_risk_premium": 0.08,
    "tax_rate": 0.25,
    "terminal_growth_rate": 0.04,
    "monte_carlo_simulations": 10000
  }
}
```

## Composite Scoring Logic

```
Composite = BharatQuant_signal + DCF_signal + Reverse_DCF_signal + News_signal

>= +1.5  →  STRONG_BUY  (Full position, Long horizon)
>= +0.5  →  BUY         (Half position, Medium horizon)
>= -0.5  →  HOLD        (Quarter position, Medium horizon)
>= -1.5  →  AVOID       (No position)
<  -1.5  →  STRONG_AVOID
```

## Running Tests

```bash
python -m pytest tests/test_modules.py -v
```

## Data Sources Attribution

| Repository | Author | License |
|-----------|--------|---------|
| jugaad-data | jugaad-py | MIT |
| nsepython | aeron7 | MIT |
| jufinance | prkedia81 | MIT |
| BharatQuant | sreekanthpalagiri | MIT |
| dcf-valuation-tool | dafahentra | MIT |
| indian-trading-skills | ajeeshworkspace | MIT |

## Disclaimer

This tool is for educational and research purposes only. It does not constitute financial advice. Always perform your own due diligence before making investment decisions. Past performance is not indicative of future results. Indian equity markets are subject to regulatory, macroeconomic, and geopolitical risks.
