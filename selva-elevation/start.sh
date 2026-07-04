#!/usr/bin/env bash
# One-command dev launcher for SELVA Elevation Studio.
# Starts the FastAPI backend (:8000) and the Vite frontend (:5173).
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "▶ backend  → http://localhost:8000"
cd "$ROOT/backend"
[ -d .venv ] || python3 -m venv .venv
# shellcheck disable=SC1091
source .venv/bin/activate
pip install -q -r requirements.txt
[ -f .env ] || cp .env.example .env
( uvicorn app:app --host 0.0.0.0 --port 8000 & echo $! > /tmp/selva_backend.pid )

echo "▶ frontend → http://localhost:5173"
cd "$ROOT/frontend"
[ -d node_modules ] || npm install
npm run dev

# cleanup backend on exit
kill "$(cat /tmp/selva_backend.pid)" 2>/dev/null || true
