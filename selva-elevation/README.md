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
| Line views | Pure-Python SVG generator | exact, reproducible geometry |
| 3D | **Three.js** parametric model + themes | real-time, orbitable, plan-exact |
| Photoreal | Provider-agnostic image gen (local SD + ControlNet / Pollinations / HF / Replicate) | free-first, geometry-locked |

---

## Quick start

### 🐳 One-click (Docker) — recommended
No Python/Node setup needed. From the project root:
```bash
docker compose up --build       # then open http://localhost:8080
```
That runs the backend + frontend (nginx serves the built UI and proxies `/api`).
Works with **no GPU**; photoreal renders default to the zero-key `pollinations` provider.
Copy `.env.example` → `.env` first if you want to plug in an LLM or a different image provider.

**Optional exact-match photoreal** (needs an NVIDIA GPU + `nvidia-container-toolkit`):
```bash
docker compose --profile gpu up --build      # also starts a local SD+ControlNet at :7860
# then set IMAGE_PROVIDER=local_sd in .env
```

### Or run the two services by hand

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
├── frontend/              React + Vite + Tailwind UI (Dockerfile + nginx.conf)
├── docker-compose.yml     one-click: backend + frontend (+ optional gpu SD)
└── start.sh               bare-metal dev launcher
```

---

## Roadmap

- [x] Upload PDF/JPG/PNG, per-floor or full sheet
- [x] Extract structured building spec via free vision LLM (+ deterministic fallback)
- [x] Generate line views: front · rear · left · right · top
- [x] Shaded colour elevation
- [x] **Parametric 3D elevation** (Three.js) built from the spec — real-time, orbitable,
      with **5 design themes** = 5 different elevations of the *same exact plan*
- [x] **Photoreal — Route A:** one-click **`.glb` export** of the exact model →
      open in Blender / Lumion / Twinmotion / D5 for offline photoreal stills
- [x] **Photoreal — Route B:** in-app **AI render** (`/api/render3d`) that feeds the
      front line-art into **ControlNet (weight 1.0)** so geometry stays locked; free-first
      providers (local SD, Pollinations, Hugging Face, Replicate)
- [x] **One-click Docker** (`docker compose up`) — backend + frontend, plus an
      optional GPU profile that bundles local SD + ControlNet for exact-match photoreal
- [ ] Dimension lines & auto scale bar
- [ ] Multi-sheet upload (one file per floor) merged into one spec

### 3D themes
The 3D tab renders the building from the spec and lets you switch **material themes**
(`frontend/src/themes.js`). Each theme changes only finishes (plaster / wood / accent /
railing / glass) — never the structure — so all 5 stay 100% true to the plan. Add your own
by appending to the `THEMES` array.

### Photoreal rendering (two routes, so you're never stuck)

**Route A — export & render offline (highest quality).**
Click **“Download 3D (.glb)”** on the 3D tab. The exported model is the exact geometry
(no drift). Open it in **Blender / Lumion / Twinmotion / D5 Render**, drop an HDRI, and
render photoreal stills or a walkaround. Because the mesh is already correct, you only
tune materials and lighting.

**Route B — one-click AI render (in-app).**
Click **“Generate photoreal”**. The backend builds a plan-specific prompt and calls an
image provider (`IMAGE_PROVIDER` in `.env`). Options, free-first:

| Provider | Free? | ControlNet (exact geometry) | Setup |
|----------|-------|------------------------------|-------|
| `pollinations` | ✅ zero-key | ✗ prompt-only | works out of the box |
| **`local_sd`** | ✅ local | ✅ **yes** | run Automatic1111/Forge `--api` at :7860 + a ControlNet model |
| `huggingface` | ✅ tier | ✗ prompt-only | `HF_API_KEY` |
| `replicate` | trial | optional | `REPLICATE_API_TOKEN` |

For a render that **exactly matches the plan**, use `local_sd`: the app sends the
generated front line-art as the ControlNet image at weight 1.0, so the AI can only
repaint *within* your geometry. Example `.env`:
```
IMAGE_PROVIDER=local_sd
SD_WEBUI_URL=http://localhost:7860
SD_CONTROL_MODULE=canny
SD_CONTROL_MODEL=control_v11p_sd15_canny
```

---

## Note on accuracy
Plan sheets rarely carry **vertical** dimensions, so storey heights use a conventional
assumption (`floor_height`, editable in the spec). Everything horizontal — widths,
setbacks, window positions, balcony projections — is taken straight from the plan.
