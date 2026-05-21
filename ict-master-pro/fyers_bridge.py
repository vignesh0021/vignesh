"""ICT Master Pro → Fyers bridge (reference implementation).

Receives JSON webhook from TradingView, resolves the option symbol from
the live LTP, and submits a Fyers /orders call. Use as a starting point —
deploy behind HTTPS (ngrok / Cloudflare Tunnel) and put the webhook URL
into your TradingView alert.

Dependencies:  fastapi  uvicorn  fyers-apiv3  python-dotenv
Env:           FYERS_CLIENT_ID, FYERS_ACCESS_TOKEN  (refresh daily)

Run:           uvicorn fyers_bridge:app --host 0.0.0.0 --port 8000
TV webhook:    https://<your-tunnel>/webhook

Payload shape (from the indicator's Fyers mode):
{
  "broker": "fyers",
  "action": "BUY|SELL",
  "side": 1|-1,
  "instrument": "OPTIONS|EQUITY|FUTURES",
  "underlying": "NIFTY|BANKNIFTY|FINNIFTY|SENSEX|...",
  "optionType": "CE|PE|",
  "expiry": "WEEKLY|MONTHLY",
  "strikeOffset": 0,
  "symbol": "NSE:RELIANCE-EQ",
  "exchange": "NSE|BSE",
  "qty": 75,
  "lots": 1,
  "lotSize": 75,
  "productType": "INTRADAY|MARGIN|CNC|BO|CO",
  "orderType": "MARKET|LIMIT",
  "entryPrice": 24500.0,
  "sl": 24450.0,
  "tp1": ..., "tp2": ..., "tp3": ...,
  "score": 6,
  "ticker": "NSE:NIFTY",
  "time": "..."
}
"""

import os
from datetime import datetime, timedelta

from fastapi import FastAPI, HTTPException, Request
from fyers_apiv3 import fyersModel

CLIENT_ID = os.environ["FYERS_CLIENT_ID"]
ACCESS_TOKEN = os.environ["FYERS_ACCESS_TOKEN"]

fyers = fyersModel.FyersModel(client_id=CLIENT_ID, token=ACCESS_TOKEN, is_async=False)

# Strike step per underlying (NSE/BSE F&O specs)
STRIKE_STEP = {
    "NIFTY": 50,
    "BANKNIFTY": 100,
    "FINNIFTY": 50,
    "MIDCPNIFTY": 25,
    "SENSEX": 100,
    "BANKEX": 100,
}

PRODUCT_MAP = {
    "INTRADAY": "INTRADAY",
    "MARGIN": "MARGIN",
    "CNC": "CNC",
    "BO": "BO",
    "CO": "CO",
}

ORDER_TYPE_MAP = {"MARKET": 2, "LIMIT": 1, "STOP": 3, "STOP-LIMIT": 4}

app = FastAPI()


def _next_weekly_expiry(today: datetime) -> str:
    # NIFTY weekly = every Thursday; BANKNIFTY moved to monthly only.
    # NSE format: YYMMM (e.g., 24N07 = 2024 Nov week-of-7th).
    # For monthly: NSE uses YYMMM where MMM is short month name.
    # Bridge oversimplified — production should call Fyers /option-chain
    # to fetch the actual expiry list.
    days_ahead = (3 - today.weekday()) % 7  # Thursday=3
    if days_ahead == 0 and today.hour >= 15:
        days_ahead = 7
    expiry = today + timedelta(days=days_ahead)
    yy = expiry.strftime("%y")
    mm_letter = expiry.strftime("%b")[0].upper()
    dd = expiry.day
    return f"{yy}{mm_letter}{dd}"


def _next_monthly_expiry(today: datetime) -> str:
    # Last Thursday of current month.
    last_day = (today.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
    while last_day.weekday() != 3:
        last_day -= timedelta(days=1)
    yy = last_day.strftime("%y")
    mmm = last_day.strftime("%b").upper()
    return f"{yy}{mmm}"


def _atm_strike(underlying: str, ltp: float, offset: int) -> int:
    step = STRIKE_STEP.get(underlying, 50)
    atm = round(ltp / step) * step
    return int(atm + offset * step)


def _build_option_symbol(underlying: str, expiry_type: str, strike: int, opt_type: str) -> str:
    today = datetime.now()
    if expiry_type == "WEEKLY":
        exp = _next_weekly_expiry(today)
    else:
        exp = _next_monthly_expiry(today)
    exch = "BSE" if underlying in ("SENSEX", "BANKEX") else "NSE"
    return f"{exch}:{underlying}{exp}{strike}{opt_type}"


def _resolve_symbol(payload: dict) -> str:
    instr = payload["instrument"]
    if instr == "EQUITY":
        return payload["symbol"]
    if instr == "FUTURES":
        return payload.get("symbol", payload["ticker"])
    # OPTIONS
    underlying = payload["underlying"]
    ltp_resp = fyers.quotes({"symbols": payload["ticker"]})
    ltp = ltp_resp["d"][0]["v"]["lp"]
    strike = _atm_strike(underlying, ltp, int(payload["strikeOffset"]))
    return _build_option_symbol(underlying, payload["expiry"], strike, payload["optionType"])


def _build_order(payload: dict, symbol: str) -> dict:
    is_options = payload["instrument"] == "OPTIONS"
    side = 1 if is_options else int(payload["side"])
    order_type = ORDER_TYPE_MAP[payload["orderType"]]
    qty = int(payload["qty"])
    order = {
        "symbol": symbol,
        "qty": qty,
        "type": order_type,
        "side": side,
        "productType": PRODUCT_MAP[payload["productType"]],
        "limitPrice": float(payload["entryPrice"]) if order_type == 1 else 0,
        "stopPrice": 0,
        "validity": "DAY",
        "disclosedQty": 0,
        "offlineOrder": False,
    }
    # Bracket order — attach SL + TP
    if payload["productType"] == "BO":
        order["stopLoss"] = round(abs(float(payload["entryPrice"]) - float(payload["sl"])), 2)
        order["takeProfit"] = round(abs(float(payload["tp1"]) - float(payload["entryPrice"])), 2)
    return order


@app.post("/webhook")
async def webhook(req: Request):
    payload = await req.json()
    if payload.get("broker") != "fyers":
        raise HTTPException(400, "not a fyers payload")
    try:
        symbol = _resolve_symbol(payload)
        order = _build_order(payload, symbol)
        resp = fyers.place_order(data=order)
        return {"status": "submitted", "symbol": symbol, "order": order, "fyers": resp}
    except Exception as e:
        raise HTTPException(500, f"order failed: {e}")


@app.get("/health")
def health():
    return {"ok": True, "ts": datetime.utcnow().isoformat()}
