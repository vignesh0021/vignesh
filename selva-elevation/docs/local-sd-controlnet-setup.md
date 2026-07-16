# 🖥️ Local Stable Diffusion + ControlNet setup (exact photoreal in the app)

This makes the **“Generate photoreal”** button produce a photoreal image **locked to your
plan’s geometry** — the app feeds the front line-art into **ControlNet at weight 1.0**, so
the AI can only repaint *within* your building’s exact outline. Fully local, free, private.

Do this on your **own PC** when you have it. (It won’t run on a phone or a plain Codespace —
it needs a GPU.)

---

## 1. Hardware
- **NVIDIA GPU** with **≥ 8 GB VRAM** (12 GB+ recommended for SDXL).
- Windows or Linux. ~20–30 GB free disk for models.
- (AMD/Mac work too but are slower/fiddlier — NVIDIA is the smooth path.)

## 2. Install the WebUI
Pick one (both expose the same API):

**Option A — Stable Diffusion WebUI Forge** (recommended: faster, ControlNet built in)
```
git clone https://github.com/lllyasviel/stable-diffusion-webui-forge
cd stable-diffusion-webui-forge
# Windows: run webui-user.bat   |   Linux: ./webui.sh
```

**Option B — AUTOMATIC1111 WebUI**
```
git clone https://github.com/AUTOMATIC1111/stable-diffusion-webui
cd stable-diffusion-webui
# then install the ControlNet extension (step 4)
```

## 3. Enable the API
Edit `webui-user.bat` (Windows) or `webui-user.sh` (Linux) and set:
```
set COMMANDLINE_ARGS=--api --listen
```
(`--api` exposes `/sdapi/v1/txt2img`; `--listen` lets the app reach it if it’s in Docker.)
Launch it and confirm **http://localhost:7860** opens.

## 4. ControlNet extension (A1111 only — Forge has it built in)
In the WebUI: **Extensions → Install from URL →**
`https://github.com/Mikubill/sd-webui-controlnet` → Install → **Reload UI**.

## 5. Download models
Put a **base checkpoint** in `models/Stable-diffusion/` and a **matching ControlNet model**
in `models/ControlNet/`. Base and ControlNet **must be the same family** (SD1.5 ↔ SD1.5,
SDXL ↔ SDXL).

**Easiest, great for buildings — SD 1.5:**
| Type | Model | Put in |
|------|-------|--------|
| Base (realistic) | **Realistic Vision v6** or **epiCRealism** | `models/Stable-diffusion/` |
| ControlNet (Canny) | **control_v11p_sd15_canny** | `models/ControlNet/` |

**Higher quality — SDXL:**
| Type | Model | Put in |
|------|-------|--------|
| Base | **Juggernaut XL** / **RealVisXL** | `models/Stable-diffusion/` |
| ControlNet (Canny) | **controlnet-canny-sdxl-1.0** | `models/ControlNet/` |

(Download from Civitai / Hugging Face. MLSD also works well for straight architectural lines.)

Reload the UI so it sees the new files.

## 6. Point the app at it (`selva-elevation/.env`)
```
IMAGE_PROVIDER=local_sd
SD_WEBUI_URL=http://localhost:7860
SD_CONTROL_MODULE=canny
# use the EXACT filename shown in the ControlNet model dropdown:
SD_CONTROL_MODEL=control_v11p_sd15_canny
# optional: pin the base checkpoint (name as shown in the WebUI dropdown)
SD_MODEL=realisticVisionV60B1_v51VAE.safetensors
# SDXL? use ~1024; SD1.5? ~768 is fine (set in the request; defaults are OK)
```
> If the app runs in **Docker** and the WebUI runs on the host, use
> `SD_WEBUI_URL=http://host.docker.internal:7860`.

Restart the app (`docker compose up --build`, or restart uvicorn).

## 7. Use it
1. Load/upload a plan → **Verify & Edit** (confirm the model) → **3D Elevation**.
2. Pick a **theme** (drives the material words in the prompt).
3. **Generate photoreal.** The badge should read **“ControlNet ✓ — locked to your plan.”**
4. Download the PNG.

The result follows your exact massing/openings because the front line-art constrains it.

---

## Tuning (in `.env`)
| Setting | Effect |
|---------|--------|
| `SD_STEPS` | 20–35; higher = cleaner, slower |
| `SD_CFG` | 5–7; higher = follows prompt harder |
| `SD_SAMPLER` | `DPM++ 2M Karras` is a good default |
| ControlNet weight | fixed at **1.0** in the app for maximum geometry lock |

## Troubleshooting
- **Badge still says “prompt-only”** → `IMAGE_PROVIDER` isn’t `local_sd`, or the health check can’t reach `SD_WEBUI_URL`. Open that URL in a browser.
- **500 / “model not found”** → `SD_CONTROL_MODEL` or `SD_MODEL` name doesn’t match the WebUI dropdown exactly (copy it verbatim, include the extension).
- **Geometry ignored** → base and ControlNet models are different families (SD1.5 vs SDXL), or the preprocessor (`SD_CONTROL_MODULE`) doesn’t match the ControlNet model.
- **Out of memory** → use an SD1.5 model, lower resolution, or add `--medvram` to `COMMANDLINE_ARGS`.

## Even higher quality
For the absolute best (matching a studio render), still prefer **GLB → D5/Lumion**
(`docs/photoreal-render-guide.md`). ControlNet is the fast in-app option; the render-engine
route is the portfolio option.
