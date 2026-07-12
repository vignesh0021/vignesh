# 📸 Photoreal render guide — matching the designer's elevation

The in-app 3D is a fast, exact **preview**. To get a **studio-quality photoreal image**
like the reference render (global illumination, HDRI sky, real materials, depth of field),
export the exact model and finish it in a render engine. The geometry is already 100%
correct, so you only add lighting + materials — no remodelling.

This is the same workflow your engineer used.

---

## Step 1 — Export the exact model
In the app, open **3D Elevation → “⬇ Download 3D (.glb)”**. You get
`<project>-<theme>.glb` — the precise building (plinth, floors, balconies, sunshades,
windows, railings), correctly scaled in **feet**.

## Step 2 — Pick an engine
| Engine | Why | Difficulty |
|--------|-----|-----------|
| **D5 Render** | fastest path to photoreal, real-time ray tracing, huge asset library | ⭐ easiest |
| **Twinmotion** | free-ish, easy, good for houses | ⭐ easy |
| **Lumion** | industry standard for this exact look | ⭐⭐ |
| **Blender (Cycles)** | free, total control | ⭐⭐⭐ |

Recommended: **D5 Render** (Windows) — import `.glb`, and you're 80% there.

## Step 3 — Import & scale
1. New scene → **Import → Model** → select the `.glb`.
2. Units are feet; if the model looks tiny/huge, set import scale so the building
   is ~**35 ft** wide / ~**33 ft** tall (G+2 + plinth + parapet).
3. Place it on the ground plane; rotate so the **front faces the camera**.

## Step 4 — Materials (to match the reference)
Replace the placeholder materials with:
| Part | Material | Notes |
|------|----------|-------|
| Main walls | **Off-white plaster / matte paint** | roughness high, near-white |
| Accent panels | **Teak / walnut wood** | warm brown, vertical grain |
| Fluted strips | **Grey fluted concrete / GRC** | vertical channels |
| Railings | **Black powder-coated metal** | thin, low roughness |
| Balcony rail | **Clear glass + steel** | transparent, slight tint |
| Windows | **Clear glazing** | reflective, dark tint |
| Main door / gate | **Teak wood** | |
| Plinth / band | **Grey granite or cement** | |

## Step 5 — Lighting
1. Choose a **clear-sky HDRI** (D5/Lumion ship these).
2. Sun **elevation ~30–40°**, azimuth from the **front-left** (matches the reference
   shadows falling to the right).
3. Soft shadows on; a touch of ambient occlusion.

## Step 6 — Camera
1. **Front elevation** view, camera roughly at eye level, pulled back.
2. Focal length **~35–50 mm** (avoid wide-angle distortion — keeps walls vertical).
3. Slight depth of field for the “render” feel.

## Step 7 — Surroundings (optional, for realism)
- Grass + a few **trees/shrubs** at the base
- A **compound wall + gate** and a **car** in the parking bay
- Wet/paved forecourt with a subtle reflection

## Step 8 — Render
- Resolution **2560×1440** or higher, denoiser on.
- Export PNG.

---

## Alternative: in-app AI photoreal (no engine install)
For a quick photoreal-style image without a render engine, use **3D Elevation →
“Generate photoreal.”** With `IMAGE_PROVIDER=local_sd` (Automatic1111/Forge + ControlNet)
the app feeds the **front line-art** at ControlNet weight 1.0, so the AI repaints *within*
your exact geometry. It won't equal an offline render, but it's one click. See the main
README's “Photoreal rendering” section.

---

### Reality check
A browser real-time preview can't equal an offline ray-traced render — that's tooling,
not a limitation of your model. The `.glb` **is** the exact building; Steps 4–8 are what
turn it into the reference-quality image.
