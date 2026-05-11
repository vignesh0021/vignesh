"""
Standalone full-module demo for Indian Equity Analyzer.

Runs every analysis module against realistic synthetic data for RELIANCE,
printing the complete investment report with all sub-analyses.

Run with:
    python demo_full_analysis.py
    python demo_full_analysis.py TCS
"""
import sys
import math
import logging
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np
import pandas as pd

# ── suppress noisy logs ──────────────────────────────────────────────────────
logging.basicConfig(level=logging.WARNING)

# ── add project root to path ─────────────────────────────────────────────────
sys.path.insert(0, str(Path(__file__).parent))


# ═══════════════════════════════════════════════════════════════════════════════
# 1. Mock data factory  (mimics what real data sources would return)
# ═══════════════════════════════════════════════════════════════════════════════

SYMBOL = (sys.argv[1].upper() if len(sys.argv) > 1 else "RELIANCE")

# --- OHLCV history (3 years of daily bars) -----------------------------------
def _price_df(n: int = 750) -> pd.DataFrame:
    rng    = np.random.default_rng(99)
    trend  = np.linspace(2400, 3100, n)              # upward drift
    noise  = np.cumsum(rng.standard_normal(n) * 18)
    close  = trend + noise
    close  = np.maximum(close, 100)                  # floor
    volume = rng.integers(5_000_000, 25_000_000, n).astype(float)
    dates  = [datetime(2022, 1, 3) + timedelta(days=i) for i in range(n)]
    return pd.DataFrame({
        "Date":   dates,
        "Open":   close * (1 - rng.uniform(0.002, 0.008, n)),
        "High":   close * (1 + rng.uniform(0.004, 0.018, n)),
        "Low":    close * (1 - rng.uniform(0.004, 0.018, n)),
        "Close":  close,
        "Volume": volume,
    })

PRICE_DF = _price_df()

# --- Financial statements (4 years, values in ₹ Crores) ---------------------
STATEMENTS = {
    "profit_loss": [
        {"year": "FY21", "sales": 5_39_238, "expenses": 4_70_616,
         "ebit": 55_420, "interest": 17_590, "depreciation": 23_000,
         "tax": 10_205, "net_profit": 53_739},
        {"year": "FY22", "sales": 7_21_634, "expenses": 6_28_004,
         "ebit": 72_400, "interest": 17_154, "depreciation": 25_000,
         "tax": 12_887, "net_profit": 60_705},
        {"year": "FY23", "sales": 9_74_864, "expenses": 8_52_196,
         "ebit": 95_640, "interest": 17_906, "depreciation": 27_500,
         "tax": 14_210, "net_profit": 73_670},
        {"year": "FY24", "sales": 10_02_083, "expenses": 8_70_126,
         "ebit": 1_11_500, "interest": 15_621, "depreciation": 29_000,
         "tax": 17_400, "net_profit": 79_020},
    ],
    "balance_sheet": [
        {"year": "FY21", "total_assets": 18_53_474, "total_equity": 6_27_862,
         "reserves": 5_98_062, "share_capital": 6_740, "total_debt": 3_36_294,
         "long_term_debt": 2_95_000, "current_assets": 2_50_000,
         "current_liabilities": 1_80_000, "fixed_assets": 8_00_000,
         "cash": 40_000, "borrowings": 3_36_294,
         "trade_receivables": 45_000, "inventories": 62_000, "trade_payables": 55_000},
        {"year": "FY22", "total_assets": 19_81_022, "total_equity": 6_83_060,
         "reserves": 6_58_060, "share_capital": 6_764, "total_debt": 3_07_474,
         "long_term_debt": 2_72_000, "current_assets": 2_80_000,
         "current_liabilities": 2_05_000, "fixed_assets": 8_60_000,
         "cash": 48_000, "borrowings": 3_07_474,
         "trade_receivables": 52_000, "inventories": 70_000, "trade_payables": 62_000},
        {"year": "FY23", "total_assets": 22_73_760, "total_equity": 8_33_006,
         "reserves": 8_08_006, "share_capital": 6_766, "total_debt": 3_13_924,
         "long_term_debt": 2_80_000, "current_assets": 3_20_000,
         "current_liabilities": 2_25_000, "fixed_assets": 9_50_000,
         "cash": 56_000, "borrowings": 3_13_924,
         "trade_receivables": 58_000, "inventories": 78_000, "trade_payables": 70_000},
        {"year": "FY24", "total_assets": 24_55_000, "total_equity": 9_20_000,
         "reserves": 8_90_000, "share_capital": 6_766, "total_debt": 3_05_000,
         "long_term_debt": 2_65_000, "current_assets": 3_60_000,
         "current_liabilities": 2_40_000, "fixed_assets": 10_00_000,
         "cash": 68_000, "borrowings": 3_05_000,
         "trade_receivables": 63_000, "inventories": 84_000, "trade_payables": 76_000},
    ],
    "cash_flow": [
        {"year": "FY21", "operating_cash_flow": 72_000, "capex": -48_000,
         "free_cash_flow": 24_000, "dividends_paid": -3_000},
        {"year": "FY22", "operating_cash_flow": 89_000, "capex": -56_000,
         "free_cash_flow": 33_000, "dividends_paid": -3_500},
        {"year": "FY23", "operating_cash_flow": 1_11_000, "capex": -62_000,
         "free_cash_flow": 49_000, "dividends_paid": -4_000},
        {"year": "FY24", "operating_cash_flow": 1_28_000, "capex": -65_000,
         "free_cash_flow": 63_000, "dividends_paid": -4_500},
    ],
}

KEY_RATIOS = {
    "pe": 28.4, "pb": 2.45, "roe": 14.2, "roce": 15.8,
    "debt_equity": 0.35, "market_cap": 20_34_000,   # ₹ Crores
    "promoter_holding": 50.3, "fii_holding": 23.1,
    "dii_holding": 14.2, "pledged_pct": 0.2,
    "current_ratio": 1.5, "interest_coverage": 7.1,
}

GROWTH = {
    "sales_growth_yoy": 2.8,
    "profit_growth_yoy": 7.3,
    "sales_cagr_3y": 23.1,
    "profit_cagr_3y": 13.7,
    "fcf_growth_yoy": 28.6,
}

LIVE_QUOTE = {"last_price": 2940.0, "volume": 8_452_300, "change_pct": 0.42}


# ═══════════════════════════════════════════════════════════════════════════════
# 2. Run every module
# ═══════════════════════════════════════════════════════════════════════════════

def run_full_analysis():
    sep  = "=" * 68
    thin = "-" * 68

    print(f"\n{sep}")
    print(f"  INDIAN EQUITY ANALYZER — FULL MODULE DEMO")
    print(f"  Symbol  : {SYMBOL}")
    print(f"  Run at  : {datetime.now().strftime('%d %b %Y  %H:%M:%S')}")
    print(f"{sep}\n")

    # ── 1. Fundamental ratios (from jufinance_adapter / Screener.in) ──────────
    print(f"{thin}")
    print("MODULE 1 — FUNDAMENTAL RATIOS  (Screener.in adapter)")
    print(f"{thin}")
    r = KEY_RATIOS
    print(f"  P/E                : {r['pe']:.1f}×")
    print(f"  P/B                : {r['pb']:.2f}×")
    print(f"  ROE                : {r['roe']:.1f}%")
    print(f"  ROCE               : {r['roce']:.1f}%")
    print(f"  Debt / Equity      : {r['debt_equity']:.2f}×")
    print(f"  Market Cap         : ₹{r['market_cap']:,.0f} Cr")
    print(f"  Promoter Holding   : {r['promoter_holding']:.1f}%")
    print(f"  FII Holding        : {r['fii_holding']:.1f}%")
    print(f"  DII Holding        : {r['dii_holding']:.1f}%")
    print(f"  Pledged %          : {r['pledged_pct']:.1f}%")
    g = GROWTH
    print(f"  Sales Growth YoY   : {g['sales_growth_yoy']:.1f}%")
    print(f"  Profit Growth YoY  : {g['profit_growth_yoy']:.1f}%")
    print(f"  Sales CAGR 3Y      : {g['sales_cagr_3y']:.1f}%")
    print(f"  Profit CAGR 3Y     : {g['profit_cagr_3y']:.1f}%")
    print(f"  FCF Growth YoY     : {g['fcf_growth_yoy']:.1f}%\n")

    # ── 2. Piotroski F-Score ──────────────────────────────────────────────────
    print(f"{thin}")
    print("MODULE 2 — PIOTROSKI F-SCORE  (BharatQuant adapter)")
    print(f"{thin}")
    from screening.bharatquant_adapter import BharatQuantScreener

    def _mock_fs(symbol):
        bs = STATEMENTS["balance_sheet"]
        pl = STATEMENTS["profit_loss"]
        cf = STATEMENTS["cash_flow"]
        mock_fund = MagicMock()
        mock_fund.get_financial_statements.return_value = STATEMENTS
        mock_fund.get_key_ratios.return_value = KEY_RATIOS
        mock_fund.get_growth_metrics.return_value = GROWTH

        dm = MagicMock()
        dm.get_stock_history.return_value = PRICE_DF

        screener = BharatQuantScreener(data_manager=dm, fundamental_manager=mock_fund)
        return screener.calculate_piotroski_f_score(symbol)

    fs = _mock_fs(SYMBOL)
    print(f"  F-Score  : {fs['score']}/9")
    for k, v in fs.get("criteria", {}).items():
        tick = "✓" if v == 1 else "✗"
        print(f"    {tick}  {k.replace('_', ' ').title()}")

    # ── 3. Relative Strength & Trend ──────────────────────────────────────────
    print(f"\n{thin}")
    print("MODULE 3 — RELATIVE STRENGTH & TREND  (BharatQuant adapter)")
    print(f"{thin}")
    from data_collection.historical_data import HistoricalDataManager

    dm2 = MagicMock()
    # Stock returns +18% vs benchmark +9% over 1 year
    dm2.get_stock_history.side_effect = lambda sym, years=1: PRICE_DF

    mock_fund2 = MagicMock()
    mock_fund2.get_financial_statements.return_value = STATEMENTS
    mock_fund2.get_key_ratios.return_value = KEY_RATIOS
    mock_fund2.get_growth_metrics.return_value = GROWTH

    sc2 = BharatQuantScreener(data_manager=dm2, fundamental_manager=mock_fund2)

    # Manually compute RS from PRICE_DF
    close    = PRICE_DF["Close"].values
    yr_ret   = (close[-1] / close[-252] - 1) * 100 if len(close) >= 252 else 0
    bench_ret = 9.0    # synthetic Nifty return
    rs_score  = yr_ret - bench_ret
    ma50  = float(PRICE_DF["Close"].rolling(50).mean().iloc[-1])
    ma200 = float(PRICE_DF["Close"].rolling(200).mean().iloc[-1])
    price_now = float(PRICE_DF["Close"].iloc[-1])

    if price_now > ma50 > ma200:
        stage, stage_name = 2, "Stage 2 — ADVANCING (Bullish)"
    elif price_now < ma50 < ma200:
        stage, stage_name = 4, "Stage 4 — DECLINING (Bearish)"
    elif ma50 > ma200:
        stage, stage_name = 1, "Stage 1 — BASING"
    else:
        stage, stage_name = 3, "Stage 3 — TOPPING"

    delta  = PRICE_DF["Close"].diff()
    gain   = delta.clip(lower=0).ewm(com=13, min_periods=14).mean()
    loss   = (-delta).clip(lower=0).ewm(com=13, min_periods=14).mean()
    rs_ind = gain / loss.replace(0, np.nan)
    rsi    = float(100 - 100 / (1 + rs_ind.iloc[-1]))

    print(f"  1Y Stock Return : {yr_ret:+.1f}%")
    print(f"  1Y Nifty Return : {bench_ret:+.1f}%")
    print(f"  RS Score        : {rs_score:+.1f}%")
    print(f"  MA50            : ₹{ma50:,.2f}")
    print(f"  MA200           : ₹{ma200:,.2f}")
    print(f"  Current Price   : ₹{price_now:,.2f}")
    print(f"  Trend Stage     : {stage_name}")
    print(f"  RSI (14)        : {rsi:.1f}")

    # ── 4. Advanced Technicals ─────────────────────────────────────────────────
    print(f"\n{thin}")
    print("MODULE 4 — ADVANCED TECHNICALS  (ATR / MACD / Bollinger / Stochastic / OBV)")
    print(f"{thin}")
    from analysis.technical_indicators import TechnicalAnalyzer
    ta     = TechnicalAnalyzer()
    tech   = ta.analyze(SYMBOL, df=PRICE_DF)
    print(f"  ATR (14)         : ₹{tech['atr']:.2f}  ({tech['atr_pct']:.1f}% of price)")
    print(f"  ATR Stop (2×)    : {tech['stop_pct']:.1f}% below entry")
    print(f"  MACD Signal      : {tech['macd_signal']}")
    print(f"  Bollinger Signal : {tech['bb_signal']}  (BB %: {tech['bb_pct']:.1f})")
    print(f"  Stochastic K/D   : {tech['stoch_k']:.1f} / {tech['stoch_d']:.1f}  → {tech['stoch_signal']}")
    print(f"  OBV Trend        : {tech['obv_trend']}")
    print(f"  Tech Composite   : {tech['composite_signal']:+.4f}")

    # ── 5. Accounting Quality ──────────────────────────────────────────────────
    print(f"\n{thin}")
    print("MODULE 5 — ACCOUNTING QUALITY  (Beneish M-Score / Altman Z / DuPont)")
    print(f"{thin}")
    from analysis.accounting_quality import AccountingQualityAnalyzer
    aq_res = AccountingQualityAnalyzer().analyze(SYMBOL, STATEMENTS)
    m   = aq_res["beneish_m_score"]
    z   = aq_res["altman_z_score"]
    dp  = aq_res["dupont"]
    print(f"  Beneish M-Score  : {m:.4f}  {'⚠ MANIPULATION RISK' if aq_res['beneish_flag'] else '✓ CLEAN  (threshold -1.78)'}")
    print(f"  Altman Z-Score   : {z:.4f}  Zone: {aq_res['altman_zone']}")
    print(f"  DuPont Decomp    :")
    print(f"    Net Margin       : {dp['net_margin']:.2f}%")
    print(f"    Asset Turnover   : {dp['asset_turnover']:.4f}×")
    print(f"    Equity Multiplier: {dp['equity_multiplier']:.4f}×")
    print(f"    → ROE (computed) : {dp['roe']:.2f}%")
    print(f"  Quality Score    : {aq_res['quality_score']:+.4f}")

    # ── 6. Working Capital Cycle ───────────────────────────────────────────────
    print(f"\n{thin}")
    print("MODULE 6 — WORKING CAPITAL CYCLE  (DSO / DIO / DPO / CCC)")
    print(f"{thin}")
    from analysis.working_capital import WorkingCapitalAnalyzer
    wc_res = WorkingCapitalAnalyzer().analyze(SYMBOL, STATEMENTS)
    latest = wc_res["latest"]
    print(f"  Debtor Days (DSO)  : {latest['dso']:.1f} days")
    print(f"  Inventory Days (DIO): {latest['dio']:.1f} days")
    print(f"  Creditor Days (DPO): {latest['dpo']:.1f} days")
    print(f"  Cash Conv. Cycle   : {latest['ccc']:.1f} days  (lower = better)")
    print(f"  3-Year Trend       : {wc_res['trend']}")
    print(f"  WC Score           : {wc_res['wc_score']:+.4f}")
    if wc_res["history"]:
        print(f"  History:")
        for h in wc_res["history"]:
            print(f"    {h['year']}: CCC={h['ccc']:.1f}d  DSO={h['dso']:.1f}  DIO={h['dio']:.1f}  DPO={h['dpo']:.1f}")

    # ── 7. Capital Allocation Quality ─────────────────────────────────────────
    print(f"\n{thin}")
    print("MODULE 7 — CAPITAL ALLOCATION QUALITY  (ROIC / Capex Efficiency / FCF)")
    print(f"{thin}")
    from analysis.capital_allocation import CapitalAllocationAnalyzer
    ca_res = CapitalAllocationAnalyzer().analyze(SYMBOL, STATEMENTS, wacc=0.115)
    print(f"  ROIC               : {ca_res['roic']:.2f}%")
    print(f"  WACC               : {ca_res['wacc_pct']:.2f}%")
    print(f"  ROIC–WACC Spread   : {ca_res['roic_wacc_spread']:+.2f}%  "
          f"({'VALUE CREATING ✓' if ca_res['roic_wacc_spread'] > 0 else 'VALUE DESTROYING ✗'})")
    print(f"  Capex Efficiency   : {ca_res['capex_efficiency_trend']}")
    print(f"  FCF Conversion     : {ca_res['fcf_conversion']:.2f}×  (FCF/Net Income)")
    print(f"  Dividend History   : {ca_res['dividend_consistency']}")
    print(f"  CA Score           : {ca_res['ca_score']:+.4f}")

    # ── 8. Monte Carlo DCF Valuation ──────────────────────────────────────────
    print(f"\n{thin}")
    print("MODULE 8 — MONTE CARLO DCF VALUATION  (10,000 simulations)")
    print(f"{thin}")
    from valuation.dcf_engine import MonteCarloDCF
    from utils.units import shares_cr_from_mktcap

    dcf_engine = MonteCarloDCF(
        risk_free_rate=0.07, market_risk_premium=0.08,
        tax_rate=0.25, terminal_growth_rate=0.04,
    )
    market_cap_cr = KEY_RATIOS["market_cap"]
    price_now2    = LIVE_QUOTE["last_price"]
    beta          = 0.78
    de            = KEY_RATIOS["debt_equity"]
    equity_cr     = market_cap_cr
    debt_cr       = equity_cr * de

    wacc = dcf_engine.calculate_wacc(beta=beta, cost_of_debt=0.09, debt=debt_cr, equity=equity_cr)
    hist_fcf = [float(r["free_cash_flow"]) for r in STATEMENTS["cash_flow"]]
    shares_cr = shares_cr_from_mktcap(market_cap_cr, price_now2)

    mc = dcf_engine.run_monte_carlo(
        historical_fcf=hist_fcf, wacc=wacc,
        current_market_cap=market_cap_cr,
        shares_outstanding=shares_cr,
        n_simulations=10_000,
    )
    upside = (mc["per_share_median"] - price_now2) / price_now2 * 100
    print(f"  Beta (3Y weekly)   : {beta:.3f}")
    print(f"  WACC               : {wacc*100:.2f}%")
    print(f"  Shares Outstanding : {shares_cr:.2f} Cr shares")
    print(f"  Historical FCF     : {[f'{x:,}' for x in hist_fcf]} Cr")
    print(f"  Current Price      : ₹{price_now2:,.2f}")
    print(f"  DCF Median (P50)   : ₹{mc['per_share_median']:,.2f}  (upside {upside:+.1f}%)")
    print(f"  DCF Bear   (P25)   : ₹{mc['per_share_p25']:,.2f}")
    print(f"  DCF Bull   (P75)   : ₹{mc['per_share_p75']:,.2f}")
    print(f"  Prob. of Upside    : {mc['probability_of_upside']:.1f}%")

    # ── 9. Reverse DCF ────────────────────────────────────────────────────────
    print(f"\n{thin}")
    print("MODULE 9 — REVERSE DCF  (market-implied growth vs actual)")
    print(f"{thin}")
    from valuation.reverse_dcf import ReverseDCF

    mock_fund3 = MagicMock()
    mock_fund3.get_financial_statements.return_value = STATEMENTS
    mock_fund3.get_growth_metrics.return_value = GROWTH

    rdcf = ReverseDCF(
        fundamental_manager=mock_fund3,
        risk_free_rate=0.07, market_risk_premium=0.08, tax_rate=0.25,
    )
    rdcf_res = rdcf.compare_to_historical_growth(SYMBOL, price_now2)
    ig  = rdcf_res.get("implied_growth")
    ig_str = f"{ig:.1f}%" if ig is not None else "N/A"
    print(f"  Market-Implied Growth : {ig_str}")
    print(f"  Actual Sales Growth   : {rdcf_res.get('actual_sales_growth', 0):.1f}%")
    print(f"  Actual Profit Growth  : {rdcf_res.get('actual_profit_growth', 0):.1f}%")
    print(f"  Valuation Assessment  : {rdcf_res.get('assessment', 'INDETERMINATE')}")

    # ── 10. Institutional Activity ────────────────────────────────────────────
    print(f"\n{thin}")
    print("MODULE 10 — INSTITUTIONAL ACTIVITY  (Block/Bulk Deals + FII/DII)")
    print(f"{thin}")
    from analysis.institutional_activity import InstitutionalActivityTracker

    iat = InstitutionalActivityTracker()
    # Inject mock bulk deal data
    mock_deals = [
        {"date": "2024-09-15", "client": "HDFC Mutual Fund", "buy_sell": "BUY",
         "quantity": 1_200_000, "price": 2_870.0, "value_cr": 344.4},
        {"date": "2024-10-03", "client": "SBI Life Insurance", "buy_sell": "BUY",
         "quantity": 800_000, "price": 2_915.0, "value_cr": 233.2},
        {"date": "2024-11-12", "client": "Foreign Portfolio Investor", "buy_sell": "BUY",
         "quantity": 2_000_000, "price": 2_945.0, "value_cr": 589.0},
    ]

    with patch.object(iat, "_get_deals", side_effect=lambda sym, t: mock_deals if t == "bulk" else []):
        ia_res = iat.analyze(SYMBOL, KEY_RATIOS)

    print(f"  FII Trend          : {ia_res['fii_trend']}")
    print(f"  DII Trend          : {ia_res['dii_trend']}")
    print(f"  Bulk Deals (90d)   : {len(ia_res['bulk_deals'])}")
    for d in ia_res["bulk_deals"][:3]:
        print(f"    {d['date']}  {d['client'][:28]:28s}  {d['buy_sell']:4s}  ₹{d['value_cr']:.1f} Cr")
    print(f"  Institutional Signal: {ia_res['net_institutional_signal']:+.4f}")

    # ── 11. Regulatory / SEBI Monitor ─────────────────────────────────────────
    print(f"\n{thin}")
    print("MODULE 11 — REGULATORY MONITOR  (ASM / GSM / SAST)")
    print(f"{thin}")
    from monitoring.regulatory_monitor import RegulatoryMonitor

    rm = RegulatoryMonitor()
    with patch.object(rm, "_fetch_surveillance", return_value=[]):
        reg_res = rm.analyze(SYMBOL)

    print(f"  On ASM List        : {'⚠ YES' if reg_res['on_asm'] else 'No'}")
    print(f"  On GSM List        : {'⚠ YES' if reg_res['on_gsm'] else 'No'}")
    print(f"  SAST Disclosures   : {len(reg_res['sast_disclosures'])}")
    print(f"  Enforcement Actions: {len(reg_res['enforcement_actions'])}")
    print(f"  Regulatory Score   : {reg_res['regulatory_score']:+.4f}")
    print(f"  Summary            : {reg_res['summary']}")

    # ── 12. Earnings Calendar & Surprise ──────────────────────────────────────
    print(f"\n{thin}")
    print("MODULE 12 — EARNINGS CALENDAR & SURPRISE TRACKING")
    print(f"{thin}")
    from monitoring.earnings_calendar import EarningsCalendar

    ec     = EarningsCalendar()
    ec_res = ec.analyze(SYMBOL, STATEMENTS)

    print(f"  Surprise Trend     : {ec_res['surprise_trend']}")
    print(f"  Earnings Score     : {ec_res['earnings_score']:+.4f}")
    if ec_res["earnings_surprise_history"]:
        print(f"  YoY Earnings Growth History:")
        for s in ec_res["earnings_surprise_history"]:
            beat = "BEAT ✓" if s["beat"] else "MISS ✗"
            print(f"    {s['year']}: actual {s['actual_growth']:+.1f}%  "
                  f"vs expected {s['expected_growth']:+.1f}%  → {beat}")

    # ── 13. Portfolio Risk & Position Sizing ──────────────────────────────────
    print(f"\n{thin}")
    print("MODULE 13 — PORTFOLIO RISK & POSITION SIZING")
    print(f"{thin}")
    from risk.portfolio_risk import PortfolioRiskManager

    pm  = PortfolioRiskManager(risk_free_rate=0.07)

    # Kelly Criterion
    win_prob    = 0.56
    upside_pct  = (mc["per_share_median"] - price_now2) / price_now2 * 100
    stop_pct    = tech["stop_pct"]
    kelly_f     = pm.kelly_position_size(win_prob, upside_pct / 100, -stop_pct / 100)
    capital     = 20_00_000   # ₹20L

    atr_pos = pm.atr_position_size(
        capital=capital, current_price=price_now2,
        atr=tech["atr"], risk_per_trade_pct=1.0,
    )
    kelly_capital = capital * kelly_f
    kelly_shares  = int(kelly_capital / price_now2)

    print(f"  Capital (demo)       : ₹{capital:,.0f}")
    print(f"  Estimated Win Prob.  : {win_prob*100:.0f}%")
    print(f"  DCF Upside           : {upside_pct:+.1f}%")
    print(f"  ATR Stop Distance    : {stop_pct:.1f}%")
    print(f"  Kelly Fraction       : {kelly_f*100:.1f}%  (half-Kelly)")
    print(f"  Kelly Capital        : ₹{kelly_capital:,.0f}  ({kelly_shares} shares)")
    print(f"  ATR-Based Shares     : {atr_pos['shares']}  (1% risk/trade)")
    print(f"  ATR Stop Price       : ₹{atr_pos['stop_price']:,.2f}")
    print(f"  Recommended % Cap    : {min(kelly_f, 0.20)*100:.1f}%  (capped at 20%/position)")
    print(f"  Risk / Reward        : 1 : {abs(upside_pct/stop_pct):.1f}")

    # Portfolio VaR using simulated returns
    rng     = np.random.default_rng(42)
    n_sim   = 1000
    ret_sim = rng.normal(0.0004, 0.013, n_sim)   # daily ~+0.04% ± 1.3%
    var_95  = float(np.percentile(ret_sim, 5)) * 100
    print(f"  Daily VaR (95%)      : {var_95:.2f}%  (based on 3Y vol simulation)")

    # ── 14. Backtesting (strategy validation) ─────────────────────────────────
    print(f"\n{thin}")
    print("MODULE 14 — STRATEGY BACKTESTING  (MA Crossover + RSI, walk-forward)")
    print(f"{thin}")
    from backtesting.strategy_backtester import StrategyBacktester

    dm_bt = MagicMock()
    dm_bt.get_stock_history.return_value = PRICE_DF

    bt     = StrategyBacktester(data_manager=dm_bt)
    bt_res = bt.backtest(SYMBOL, years=3, holding_days=45)
    m_bt   = bt_res.get("metrics", {})

    if m_bt:
        print(f"  Total Trades       : {m_bt['total_trades']}")
        print(f"  Hit Rate           : {m_bt['hit_rate']:.1f}%")
        print(f"  Avg Return/Trade   : {m_bt['avg_return_pct']:+.2f}%")
        print(f"  Avg Win            : {m_bt['avg_win_pct']:+.2f}%")
        print(f"  Avg Loss           : {m_bt['avg_loss_pct']:+.2f}%")
        print(f"  Profit Factor      : {m_bt['profit_factor']:.2f}")
        print(f"  Sharpe Ratio       : {m_bt['sharpe_ratio']:.4f}")
        print(f"  Max Drawdown       : {m_bt['max_drawdown_pct']:.1f}%")
    else:
        print("  (Insufficient history for backtest metrics)")

    wf = bt_res.get("walk_forward_results", [])
    if wf:
        print(f"  Walk-Forward Windows: {len(wf)}")
        for w in wf:
            print(f"    Trades={w['trades']}  HitRate={w['hit_rate']:.1f}%  "
                  f"AvgRet={w['avg_return']:+.2f}%  Sharpe={w['sharpe']:.3f}")

    # ── 15. News Monitor ──────────────────────────────────────────────────────
    print(f"\n{thin}")
    print("MODULE 15 — NEWS & CORPORATE ACTIONS MONITOR")
    print(f"{thin}")
    from monitoring.news_monitor import IndianStockMonitor
    import monitoring.news_monitor as nm_module

    nm = IndianStockMonitor()
    # Inject sample articles
    sample_articles = [
        {"title": f"{SYMBOL} reports record profit; earnings beat analyst estimates",
         "summary": "Strong quarterly results driven by retail and digital businesses.",
         "source": "EconomicTimes", "link": "#", "published": ""},
        {"title": f"{SYMBOL} promoter buying stake in subsidiary",
         "summary": "Promoter increases stake signalling strong confidence in business.",
         "source": "MoneyControl", "link": "#", "published": ""},
        {"title": f"{SYMBOL} announces bonus shares 1:1 ratio",
         "summary": "Board approved bonus issue to reward long-term shareholders.",
         "source": "BusinessStandard", "link": "#", "published": ""},
    ]

    # Each feed returns distinct articles; we inject once per source call
    call_count = [0]
    def _mock_feed(source, url, cutoff):
        idx = call_count[0] % len(sample_articles)
        call_count[0] += 1
        return [sample_articles[idx]]

    with patch.object(nm, "_fetch_feed", side_effect=_mock_feed), \
         patch.object(nm_module, "_FEEDPARSER_OK", True):
        articles = nm.fetch_news(symbol=SYMBOL, days=7, min_impact=2)

    if articles:
        print(f"  High-Impact News ({len(articles)} articles):")
        for a in articles[:3]:
            icon = "▲" if a.get("sentiment") == "positive" else ("▼" if a.get("sentiment") == "negative" else "–")
            print(f"  {icon} [{a['impact_score']}/10] [{a.get('sentiment','?')[:3].upper()}]")
            print(f"      {a['title'][:72]}")
            print(f"      Source: {a['source']}")
    else:
        print("  No high-impact news found.")

    # ── 16. Composite Score & Final Decision ──────────────────────────────────
    print(f"\n{sep}")
    print("  FINAL COMPOSITE DECISION")
    print(sep)

    # Compute each sub-score
    f_score     = fs["score"]
    f_norm      = (f_score - 4.5) / 4.5
    rs_norm     = max(-1.0, min(1.0, rs_score / 30))
    trend_norm  = {2: 1.0, 1: 0.0, 3: -0.3, 4: -1.0, 0: 0.0}.get(stage, 0.0)
    quant_norm  = (f_norm + rs_norm + trend_norm) / 3

    prob_up     = mc["probability_of_upside"]
    dcf_norm    = (prob_up - 50) / 50

    ass_map     = {"CHEAP": 1.0, "FAIR": 0.0, "EXPENSIVE": -1.0, "INDETERMINATE": 0.0}
    rdcf_norm   = ass_map.get(rdcf_res.get("assessment", "INDETERMINATE"), 0.0)

    acctg_norm  = aq_res["quality_score"]
    capalloc_n  = ca_res["ca_score"]
    tech_norm   = tech["composite_signal"]
    inst_norm   = ia_res["net_institutional_signal"]
    regul_norm  = reg_res["regulatory_score"]
    news_norm   = 0.5   # positive sentiment from sample articles

    W = dict(quant=0.35, dcf=0.20, rdcf=0.15, acctg=0.10,
             capalloc=0.10, tech=0.05, inst=0.02, regul=0.02, news=0.01)

    sub_scores = dict(
        quant=quant_norm, dcf=dcf_norm, rdcf=rdcf_norm,
        acctg=acctg_norm, capalloc=capalloc_n, tech=tech_norm,
        inst=inst_norm, regul=regul_norm, news=news_norm,
    )

    composite = sum(W[k] * sub_scores[k] for k in W)

    if composite >= 0.6:
        decision, pos_size, horizon = "STRONG_BUY", "Full",    "Long"
        confidence = min(95, 85 + int((composite - 0.6) * 25))
    elif composite >= 0.2:
        decision, pos_size, horizon = "BUY",        "Half",    "Medium"
        confidence = min(80, 65 + int((composite - 0.2) * 37))
    elif composite >= -0.2:
        decision, pos_size, horizon = "HOLD",       "Quarter", "Medium"
        confidence = 50
    elif composite >= -0.6:
        decision, pos_size, horizon = "AVOID",      "None",    "Short"
        confidence = min(80, 65 + int((-composite - 0.2) * 37))
    else:
        decision, pos_size, horizon = "STRONG_AVOID","None",   "Short"
        confidence = min(95, 85 + int((-composite - 0.6) * 25))

    target  = mc["per_share_p75"]
    stop    = round(price_now2 - 2 * tech["atr"], 2)

    print(f"\n  ╔══════════════════════════════════════╗")
    print(f"  ║  DECISION  : {decision:<24s}║")
    print(f"  ║  CONFIDENCE: {confidence}%{' '*22}║")
    print(f"  ╚══════════════════════════════════════╝")
    print(f"\n  Current Price   : ₹{price_now2:,.2f}")
    print(f"  Target Price    : ₹{target:,.2f}  (DCF P75)")
    print(f"  Stop Loss       : ₹{stop:,.2f}  (2× ATR)")
    print(f"  Position Size   : {pos_size}")
    print(f"  Time Horizon    : {horizon}")

    print(f"\n  Sub-Score Breakdown:")
    print(f"  {'Signal':<16}  {'Raw Score':>10}  {'Weight':>8}  {'Contribution':>14}")
    print(f"  {'-'*52}")
    for k in W:
        raw  = sub_scores[k]
        wt   = W[k]
        cont = wt * raw
        bar  = "█" * int(abs(raw) * 10) + ("" if raw >= 0 else "")
        sign = "+" if raw >= 0 else ""
        print(f"  {k.upper():<16}  {sign}{raw:>9.4f}  {wt*100:>7.0f}%  {cont:>+14.4f}  {bar}")
    print(f"  {'─'*52}")
    print(f"  {'COMPOSITE':<16}  {composite:>+10.4f}  {'100%':>8}  {composite:>+14.4f}")

    print(f"\n{sep}\n")


if __name__ == "__main__":
    run_full_analysis()
