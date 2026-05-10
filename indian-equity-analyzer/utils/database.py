"""
SQLite persistence layer.

Stores:
  - Fundamental snapshots (24-hour TTL, refreshed on miss)
  - Investment decision history (permanent log)
  - Universe screening results

All writes are wrapped in try/except so a DB failure never crashes analysis.
"""
import json
import math
import sqlite3
import time
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS fundamentals (
    symbol      TEXT PRIMARY KEY,
    data        TEXT NOT NULL,
    fetched_at  REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS decisions (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol           TEXT    NOT NULL,
    decision         TEXT    NOT NULL,
    confidence       INTEGER,
    composite_score  REAL,
    current_price    REAL,
    target_price     REAL,
    stop_loss        REAL,
    position_size    TEXT,
    data             TEXT,
    created_at       REAL    NOT NULL
);

CREATE TABLE IF NOT EXISTS screening_runs (
    run_id      TEXT    NOT NULL,
    symbol      TEXT    NOT NULL,
    f_score     INTEGER,
    rs_score    REAL,
    trend       TEXT,
    bull_pts    INTEGER,
    signal      TEXT,
    data        TEXT,
    created_at  REAL    NOT NULL,
    PRIMARY KEY (run_id, symbol)
);

CREATE INDEX IF NOT EXISTS idx_dec_symbol  ON decisions(symbol);
CREATE INDEX IF NOT EXISTS idx_dec_created ON decisions(created_at DESC);
"""


class AnalysisDatabase:
    """
    Thread-safe SQLite store for analysis results.
    Uses WAL mode and a 10-second busy timeout for concurrent access.
    """

    def __init__(self, db_path: str = "./data/market.db"):
        self._path = Path(db_path)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._init()

    # ------------------------------------------------------------------
    # Schema
    # ------------------------------------------------------------------

    def _init(self) -> None:
        try:
            with self._connect() as conn:
                conn.executescript(_SCHEMA)
                conn.execute("PRAGMA journal_mode=WAL")
        except Exception as exc:
            logger.error("DB init failed: %s", exc)

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self._path), timeout=10)
        conn.row_factory = sqlite3.Row
        return conn

    # ------------------------------------------------------------------
    # Fundamentals cache
    # ------------------------------------------------------------------

    def save_fundamentals(self, symbol: str, data: Dict, ttl: int = 86_400) -> None:
        """Cache fundamental data for *symbol* (default 24-hour TTL)."""
        try:
            with self._connect() as conn:
                conn.execute(
                    "INSERT OR REPLACE INTO fundamentals VALUES (?, ?, ?)",
                    (symbol, json.dumps(data, default=_json_default), time.time()),
                )
        except Exception as exc:
            logger.warning("DB save_fundamentals(%s) failed: %s", symbol, exc)

    def load_fundamentals(self, symbol: str, max_age: int = 86_400) -> Optional[Dict]:
        """Return cached fundamentals if fresher than *max_age* seconds."""
        try:
            with self._connect() as conn:
                row = conn.execute(
                    "SELECT data, fetched_at FROM fundamentals WHERE symbol = ?",
                    (symbol,),
                ).fetchone()
            if row and (time.time() - row["fetched_at"]) < max_age:
                return json.loads(row["data"])
        except Exception as exc:
            logger.warning("DB load_fundamentals(%s) failed: %s", symbol, exc)
        return None

    # ------------------------------------------------------------------
    # Decision history
    # ------------------------------------------------------------------

    def save_decision(self, symbol: str, d: Dict) -> None:
        """Append an investment decision to the permanent log."""
        try:
            with self._connect() as conn:
                conn.execute(
                    """INSERT INTO decisions
                       (symbol, decision, confidence, composite_score,
                        current_price, target_price, stop_loss,
                        position_size, data, created_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        symbol,
                        d.get("decision", ""),
                        d.get("confidence", 0),
                        d.get("composite_score", 0.0),
                        d.get("current_price", 0.0),
                        d.get("target_price", 0.0),
                        d.get("stop_loss", 0.0),
                        d.get("position_size", "None"),
                        json.dumps(d, default=_json_default),
                        time.time(),
                    ),
                )
        except Exception as exc:
            logger.warning("DB save_decision(%s) failed: %s", symbol, exc)

    def get_decision_history(self, symbol: str, limit: int = 10) -> List[Dict]:
        """Return the last *limit* decisions for *symbol*, newest first."""
        try:
            with self._connect() as conn:
                rows = conn.execute(
                    """SELECT decision, confidence, composite_score,
                              current_price, target_price, created_at
                       FROM decisions WHERE symbol = ?
                       ORDER BY created_at DESC LIMIT ?""",
                    (symbol, limit),
                ).fetchall()
            return [dict(r) for r in rows]
        except Exception as exc:
            logger.warning("DB get_decision_history(%s) failed: %s", symbol, exc)
            return []

    # ------------------------------------------------------------------
    # Screening runs
    # ------------------------------------------------------------------

    def save_screening_run(self, run_id: str, rows: List[Dict]) -> None:
        """Persist a complete screening run (one row per stock)."""
        try:
            with self._connect() as conn:
                conn.executemany(
                    """INSERT OR REPLACE INTO screening_runs
                       (run_id, symbol, f_score, rs_score, trend,
                        bull_pts, signal, data, created_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    [
                        (
                            run_id, r.get("Symbol", ""), r.get("F_Score", 0),
                            r.get("RS_Score", 0.0), r.get("Trend", ""),
                            r.get("Bullish_Points", 0), r.get("Signal", ""),
                            json.dumps(r, default=_json_default), time.time(),
                        )
                        for r in rows
                    ],
                )
        except Exception as exc:
            logger.warning("DB save_screening_run(%s) failed: %s", run_id, exc)


# ------------------------------------------------------------------
# Helper
# ------------------------------------------------------------------

def _json_default(obj):
    """Make non-serialisable objects (numpy scalars, etc.) JSON-safe."""
    if hasattr(obj, "item"):  # numpy scalar
        return obj.item()
    if math.isnan(obj) if isinstance(obj, float) else False:
        return None
    return str(obj)
