# 🧩 Plugging in an image detector (e.g. FloorPlanTo3D / Mask R-CNN)

For **photographed or scanned** plans (no CAD text layer), an object-detection model
reads walls/windows/doors far better than a general vision-LLM. The app has a **socket**
for this — `backend/detector_provider.py` — so a model becomes a **config change**, not a
rewrite. The detector's output is still a *draft* you confirm in **Verify & Edit**.

> For **CAD PDFs**, keep using the built-in **vector parser** — it's exact and needs no
> model. The detector is specifically for **raster** inputs.

## How the pipeline uses it
`plan_analyzer.analyze()` order:
1. **Vector parser** (CAD PDFs) — exact, no AI
2. **Detector** (this) — if `DETECTOR_PROVIDER=http` and reachable
3. **Vision LLM** (Gemini etc.) — fallback for images
4. **Built-in example** — last resort

## 1. Run the model as a microservice
Detection models (Mask R-CNN, etc.) need Python + a GPU + weights, so run them
**separately** from this app (keeps the app light and the model swappable). Example with
a FloorPlanTo3D-style server:
```
git clone https://github.com/fadyazizz/FloorPlanTo3D-API      # or your own server
# follow its README: create the env, download weights, run the API (e.g. :9000)
```
It should accept an image (multipart `file` or `{"image": <base64>}`) and return detected
boxes.

## 2. Point the app at it (`selva-elevation/.env`)
```
DETECTOR_PROVIDER=http
DETECTOR_URL=http://localhost:9000/predict
DETECTOR_BUILDING_WIDTH_FT=30     # scales pixels->feet when the service gives no scale
```
(Docker + host service → use `http://host.docker.internal:9000/predict`.)

## 3. Adapt the response (one small function)
The socket expects this **normalized** shape (boxes are `[x0,y0,x1,y1]` in image pixels):
```json
{
  "image_width": 1600, "image_height": 1200,
  "scale_ft_per_px": 0.03,
  "walls":   [[x0,y0,x1,y1], ...],
  "windows": [[x0,y0,x1,y1], ...],
  "doors":   [[x0,y0,x1,y1], ...]
}
```
`_normalize()` in `detector_provider.py` already handles a few common shapes (top-level
`walls/windows/doors`, or an `objects`/`detections` list with `class`+`bbox`). If your
model returns something else, edit that one function to map its fields — nothing else
changes.

## What you get
- The detector's boxes become a **single-floor** `BuildingSpec` (walls → footprint,
  windows/doors → openings placed on the nearest wall).
- Pixels are converted to feet via the service's `scale_ft_per_px`, or
  `DETECTOR_BUILDING_WIDTH_FT` if it gives none.
- `source: detector` is shown in the UI; you then set the true dimensions/heights and
  fix walls in **Verify & Edit** — which is what makes the final model exact.

## Honest limits
- Detection is **pixel-space** → absolute dimensions still need a scale (a known width, a
  scale bar, or the service's own scale). This is why the gate exists.
- These models are trained on particular plan styles; accuracy varies by sheet.
- Multi-floor sheets: run the detector per **cropped floor** and merge, or keep those on
  the vector/LLM path. The socket currently maps one image → one floor.
