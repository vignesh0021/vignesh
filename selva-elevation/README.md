# 🏛️ SELVA Elevation Studio

Upload a floor plan (**PDF / JPG / PNG**, full sheet or floor-by-floor) and get back
clean **line diagrams for all views** — *front, rear, left side, right side, top/roof* —
plus a **shaded colour elevation**. Built as the foundation for a future
**ultra-realistic 3D elevation** step.

The core design principle: **the LLM only extracts numbers, a deterministic renderer
draws the geometry.** That keeps every view *100% faithful to the plan* — no pixel
hallucination, no dimensional drift.

```
 plan (pdf/jpg/png)
        │
        ▼
 vision LLM  ──►  structured BuildingSpec (JSON: floors, footprints, windows, balconies…)
        │                         │
   (free model)                   ▼
                        deterministic SVG renderer
                                  │
     ┌──────────┬──────────┬──────┴─────┬──────────┬───────────┐
   front      rear       left        right       top       elevation
```

---

## Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Frontend | **React + Vite + Tailwind** | fast, modern, minimal setup |
| Backend | **FastAPI (Python)** | great for file uploads + image/PDF work |
| Plan → data | **Free vision LLM** (Ollama / Gemini / Groq / OpenRouter) | provider-agnostic, all have a free path |
| PDF/Image | PyMuPDF + Pillow | render any upload to an image for the model |
| Rendering | Pure-Python SVG generator | exact, reproducible geometry |

---

## Quick start

### 1. Backend
```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # pick your LLM provider (see below)
uvicorn app:app --reload --port 8000
```

### 2. Frontend
```bash
cd frontend
npm install
npm run dev                    # http://localhost:5173  (proxies /api → :8000)
```

Or just: `./start.sh` (runs both).

> No LLM configured? The app still runs — it shows the built-in **SELVA G+2** example
> so you can see the whole pipeline, and clearly flags `source: fallback`.

---

## Choosing a free LLM (`backend/.env`)

| Provider | Free path | Set in `.env` |
|----------|-----------|---------------|
| **Ollama** (recommended, local & private) | 100% free, runs on your machine | `LLM_PROVIDER=ollama` · `ollama pull llama3.2-vision` |
| **Google Gemini** | AI Studio free tier | `LLM_PROVIDER=gemini` · `GEMINI_API_KEY=…` |
| **Groq** | free tier, very fast | `LLM_PROVIDER=groq` · `GROQ_API_KEY=…` |
| **OpenRouter** | `:free` vision models | `LLM_PROVIDER=openrouter` · `OPENROUTER_API_KEY=…` |

Ollama example:
```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull llama3.2-vision      # or llava / qwen2.5-vl / minicpm-v
```

---

## API

| Method | Route | Purpose |
|--------|-------|---------|
| `GET`  | `/api/health`  | status + which LLM provider is active |
| `GET`  | `/api/example` | built-in SELVA spec + all views |
| `POST` | `/api/analyze` | multipart `file=` → `{spec, views, source}` |

`views` is a map of `{front, rear, left, right, top, elevation}` → SVG strings.

---

## Project layout
```
selva-elevation/
├── backend/
│   ├── app.py             FastAPI endpoints
│   ├── spec_schema.py     BuildingSpec model + SELVA example
│   ├── plan_analyzer.py   upload → PNG → LLM → validated spec (+fallback)
│   ├── llm_providers.py   ollama / gemini / groq / openrouter
│   ├── view_generator.py  spec → 6 SVG views (the deterministic core)
│   └── requirements.txt
├── frontend/              React + Vite + Tailwind UI
└── start.sh
```

---

## Roadmap

- [x] Upload PDF/JPG/PNG, per-floor or full sheet
- [x] Extract structured building spec via free vision LLM (+ deterministic fallback)
- [x] Generate line views: front · rear · left · right · top
- [x] Shaded colour elevation
- [ ] **Ultra-realistic 3D elevation** — feed the generated front line-art into
      ControlNet (Canny/MLSD, weight 1.0) + SDXL, *or* auto-build a 3D massing model
      (extrude the spec) for a real render engine. The spec already carries everything
      needed (footprints, heights, openings), so this plugs straight in.
- [ ] Dimension lines & auto scale bar
- [ ] Multi-sheet upload (one file per floor) merged into one spec

---

## Note on accuracy
Plan sheets rarely carry **vertical** dimensions, so storey heights use a conventional
assumption (`floor_height`, editable in the spec). Everything horizontal — widths,
setbacks, window positions, balcony projections — is taken straight from the plan.
