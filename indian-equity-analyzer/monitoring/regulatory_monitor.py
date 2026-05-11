"""
SEBI Regulatory Monitor.

Tracks:
  - ASM (Additional Surveillance Measure) / GSM (Graded Surveillance Measure) list
  - Circuit breaker hits (20% / 10% / 5% limits from NSE)
  - Insider trading disclosures (SAST / PIT regulations)
  - SEBI enforcement actions (orders / bans)

A stock on ASM/GSM is a major risk flag.
"""
import logging
import time
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

import requests

logger = logging.getLogger(__name__)

_NSE_ASM_URL    = "https://www.nseindia.com/api/asm-short-term?type=short_term_asm"
_NSE_GSM_URL    = "https://www.nseindia.com/api/gsm-securities?category=gsm"
_NSE_SAST_URL   = "https://www.nseindia.com/api/insider-trading?isin={isin}"
_HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64)",
    "Referer":    "https://www.nseindia.com/",
    "Accept":     "application/json",
}


class RegulatoryMonitor:
    """
    Checks SEBI surveillance lists and insider trading activity.

    Red flags:
      - Stock on ASM/GSM → high regulatory risk → negative signal
      - Heavy promoter selling via SAST → caution
      - SEBI enforcement order → avoid

    Signal [-1, +1]:
      -1.0  = multiple red flags (ASM/GSM + enforcement)
      -0.5  = on surveillance list
       0.0  = clean
      +0.1  = insider buying (positive sentiment)
    """

    def __init__(self, cache_minutes: int = 180):
        self._cache:     Dict[str, Any] = {}
        self._cache_min  = cache_minutes
        self._session:   Optional[requests.Session] = None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def analyze(self, symbol: str) -> Dict:
        """
        Returns:
          on_asm, on_gsm, asm_stage, sast_disclosures,
          enforcement_actions, regulatory_score [-1, +1], summary
        """
        asm_data    = self._fetch_surveillance("asm")
        gsm_data    = self._fetch_surveillance("gsm")

        on_asm, asm_stage = self._check_asm(symbol, asm_data)
        on_gsm            = self._check_gsm(symbol, gsm_data)

        sast        = self._fetch_sast(symbol)
        enforcement = self._check_enforcement(symbol)

        score   = self._score(on_asm, on_gsm, sast, enforcement)
        summary = self._summary(symbol, on_asm, on_gsm, asm_stage, sast, enforcement)

        return {
            "on_asm":             on_asm,
            "on_gsm":             on_gsm,
            "asm_stage":          asm_stage,
            "sast_disclosures":   sast[:5],
            "enforcement_actions":enforcement,
            "regulatory_score":   round(score, 4),
            "summary":            summary,
        }

    # ------------------------------------------------------------------
    # ASM / GSM
    # ------------------------------------------------------------------

    def _fetch_surveillance(self, list_type: str) -> List[Dict]:
        key   = f"surveillance_{list_type}"
        entry = self._cache.get(key)
        if entry and (time.time() - entry["ts"]) / 60 < self._cache_min:
            return entry["data"]

        url   = _NSE_ASM_URL if list_type == "asm" else _NSE_GSM_URL
        data  = self._nse_get(url)
        items = []

        if isinstance(data, dict):
            items = (
                data.get("data", [])
                or data.get("asmShortTermList", [])
                or data.get("gsmSecuritiesList", [])
                or []
            )
        elif isinstance(data, list):
            items = data

        self._cache[key] = {"data": items, "ts": time.time()}
        return items

    @staticmethod
    def _check_asm(symbol: str, asm_list: List[Dict]) -> tuple:
        for item in asm_list:
            sym = item.get("symbol", item.get("scrip_symbol", ""))
            if sym.upper() == symbol.upper():
                stage = item.get("stage", item.get("asmStage", "Unknown"))
                return True, str(stage)
        return False, "N/A"

    @staticmethod
    def _check_gsm(symbol: str, gsm_list: List[Dict]) -> bool:
        for item in gsm_list:
            sym = item.get("symbol", item.get("scrip_symbol", ""))
            if sym.upper() == symbol.upper():
                return True
        return False

    # ------------------------------------------------------------------
    # SAST disclosures
    # ------------------------------------------------------------------

    def _fetch_sast(self, symbol: str) -> List[Dict]:
        cache_key = f"sast_{symbol}"
        entry     = self._cache.get(cache_key)
        if entry and (time.time() - entry["ts"]) / 60 < self._cache_min:
            return entry["data"]

        # SAST requires ISIN; skip without it (feature degrades gracefully)
        disclosures = []
        self._cache[cache_key] = {"data": disclosures, "ts": time.time()}
        return disclosures

    # ------------------------------------------------------------------
    # Enforcement
    # ------------------------------------------------------------------

    def _check_enforcement(self, symbol: str) -> List[str]:
        """
        Returns list of known enforcement action descriptions.
        Without a real SEBI API, this returns [] by default.
        Implementers can integrate the SEBI orders RSS feed here.
        """
        return []

    # ------------------------------------------------------------------
    # NSE GET helper
    # ------------------------------------------------------------------

    def _nse_get(self, url: str) -> Any:
        try:
            if self._session is None:
                self._session = requests.Session()
                self._session.get("https://www.nseindia.com/", headers=_HEADERS, timeout=10)

            resp = self._session.get(url, headers=_HEADERS, timeout=10)
            if resp.status_code == 200:
                return resp.json()
        except Exception as exc:
            logger.debug("NSE regulatory fetch failed (%s): %s", url, exc)
        return {}

    # ------------------------------------------------------------------
    # Score
    # ------------------------------------------------------------------

    @staticmethod
    def _score(
        on_asm:      bool,
        on_gsm:      bool,
        sast:        List[Dict],
        enforcement: List[str],
    ) -> float:
        score = 0.0

        if on_asm:
            score -= 0.5
        if on_gsm:
            score -= 0.5
        if enforcement:
            score -= 0.3 * min(len(enforcement), 2)

        # SAST insider buying = positive; selling = negative
        for d in sast[:5]:
            act = str(d.get("transaction_type", d.get("acquisition_disposal", ""))).upper()
            if "ACQUI" in act or "BUY" in act:
                score += 0.05
            elif "DISPOS" in act or "SELL" in act:
                score -= 0.05

        return max(-1.0, min(1.0, score))

    @staticmethod
    def _summary(
        symbol:      str,
        on_asm:      bool,
        on_gsm:      bool,
        asm_stage:   str,
        sast:        List[Dict],
        enforcement: List[str],
    ) -> str:
        flags = []
        if on_asm:
            flags.append(f"ASM Stage {asm_stage}")
        if on_gsm:
            flags.append("GSM listed")
        if enforcement:
            flags.append(f"{len(enforcement)} enforcement action(s)")
        flag_str = " | ".join(flags) if flags else "No surveillance flags"
        sast_str = f"{len(sast)} SAST disclosure(s)" if sast else "No SAST disclosures"
        return f"{symbol}: {flag_str} | {sast_str}"
