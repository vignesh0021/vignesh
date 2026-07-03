# FloorPlan 3D

Android app that converts 2D civil-engineering floor plans into interactive 3D
visualizations in real time. Upload a plan image (PDF, PNG or JPG) or capture
one with the camera; the app extracts dimensions, elevations and material
call-outs, renders a navigable 3D model instantly, and shows a live material
cost estimate based on current market prices.

## Features

- **Upload & processing** — SAF file picker (PDF/PNG/JPG) and camera capture;
  PDFs are rasterised with `PdfRenderer`, camera shots are EXIF-rotated, giant
  scans are downscaled to a bounded working size.
- **Automatic extraction**
  - *Annotations*: on-device OCR (ML Kit text recognition) parsed for linear
    dimensions (`12'-6"`, `3.6 m`, `3600 X 4200`), elevation/level marks
    (`FFL +0.45`, `EL. +3.00`), ceiling heights (`CEILING HT 3.0 M`), scale
    indicators (`SCALE 1:100`) and material call-outs (brick, RCC, tiles, …).
  - *Geometry*: a pure-Kotlin wall detector (adaptive threshold → downscaled
    grid → morphological erosion → run-band merging) finds wall segments and
    distinguishes them from hair-line dimension strokes. No native OpenCV
    dependency — deterministic and fully unit-tested.
  - *Scale*: resolved by matching the largest annotated dimension against the
    drawing extents; explicit fallbacks with user-visible warnings otherwise.
- **3D visualization** — custom OpenGL ES 2.0 renderer (zero external engine
  dependencies): extruded walls + floor slab, per-vertex lighting, wireframe
  edge pass. Orbit / pan / pinch-zoom gestures; instant view presets — Plan
  (orthographic top-down), Front/Side elevations (orthographic), Isometric and
  free 3D perspective. Extracted dimensions and elevation marks are projected
  into screen space and drawn as labels on the model; a 2D plan mini-map is
  shown alongside the 3D view. Rendering is dirty-driven (draws only on
  change), so mid-range devices stay fluid and cool.
- **Material & cost calculation** — quantity take-off from the model geometry
  (wall volume/surface, slab volume, floor area) via documented CPWD-style
  thumb rules, priced from a Room-cached catalog that refreshes from a remote
  market-price feed (`pricing/material-prices.json`) and works fully offline.
  Cost breakdown by material with quantities, unit prices, assumptions and
  price-as-of timestamp, displayed alongside the 3D view.
- **Persistence** — processed plans (source image + extraction JSON) cached in
  a Room database; reopening a plan re-renders instantly with no reprocessing.
- **Robustness** — explicit handling for corrupted/undecodable files,
  password-protected PDFs, blank or unclear plans (perimeter-box fallback so
  the user always gets a model), missing annotations (sane defaults + visible
  extraction notes), OCR engine failure (geometry-only degradation) and
  missing prices (excluded lines are called out). All pipeline stages log to
  an in-memory diagnostics buffer plus logcat.

## Tech stack

| Concern | Choice |
| --- | --- |
| Language | Kotlin 2.0 |
| UI | Jetpack Compose + Material 3 |
| 3D rendering | OpenGL ES 2.0 (custom renderer, `GLSurfaceView`) |
| Image analysis / OCR | ML Kit Text Recognition (on-device, TFLite-based) + pure-Kotlin raster analysis |
| Storage | Room |
| Serialization | kotlinx.serialization |
| DI | Manual container (no codegen) |
| Min / target SDK | 26 / 35 |

## Project layout

```
FloorPlan3D/
├── app/src/main/java/com/floorplan3d/
│   ├── core/            PlanLog — logging with in-app diagnostics ring buffer
│   ├── domain/
│   │   ├── model/       FloorPlan, WallSegment, Dimension, CostEstimate, …
│   │   ├── extraction/  AnnotationParser, WallDetector, PlanAssembler (pure Kotlin)
│   │   │                PlanImageLoader, PlanExtractionPipeline (Android)
│   │   ├── geometry/    Mat4, PlanMeshBuilder (pure Kotlin)
│   │   └── estimation/  QuantityTakeoff, CostEstimator, DefaultPriceCatalog
│   ├── data/            Room database + Plan/Price repositories
│   ├── render/          CameraState, PlanRenderer (GLES2), PlanGLSurfaceView
│   ├── ui/              HomeScreen, ViewerScreen, theme
│   └── viewmodel/       HomeViewModel, ViewerViewModel
├── app/src/test/        JVM unit tests (extraction, geometry, costing)
├── sample-plans/        Sample plan images + generator script
└── pricing/             Remote market-price feed consumed by the app
```

The extraction, geometry and costing layers are deliberately free of Android
imports so they run as plain JVM unit tests.

## Build & run

Prerequisites: JDK 17, Android SDK (API 35). No `local.properties` tweaks
needed beyond the SDK path.

```bash
cd FloorPlan3D
gradle testDebugUnitTest      # run unit tests
gradle assembleDebug          # build debug APK
gradle assembleRelease        # build release APK (see signing below)
```

Debug APK: `app/build/outputs/apk/debug/app-debug.apk`.

### Release signing

`app/build.gradle.kts` resolves the release signing config from, in order:

1. **Environment variables** (used by CI): `RELEASE_KEYSTORE_PATH`,
   `RELEASE_KEYSTORE_PASSWORD`, `RELEASE_KEY_ALIAS`, `RELEASE_KEY_PASSWORD`.
   The path is resolved against the `FloorPlan3D/` project root.
2. **`keystore.properties`** at the project root (git-ignored) with keys
   `storeFile`, `storePassword`, `keyAlias`, `keyPassword`.
3. **Fallback**: the debug signing config, so `assembleRelease` always
   succeeds for local smoke builds.

## CI/CD (GitHub Actions)

`.github/workflows/build.yml` runs on every push to `main` that touches
`FloorPlan3D/` (plus manual dispatch):

1. Runs all unit tests (`testDebugUnitTest`) — dimension/elevation parsing,
   wall detection, mesh generation, projection math, quantity take-off and
   cost calculation. Test reports are uploaded as artifacts.
2. Builds the debug APK.
3. Builds the **signed release APK**. If the repository secrets
   `RELEASE_KEYSTORE_BASE64`, `RELEASE_KEYSTORE_PASSWORD`, `RELEASE_KEY_ALIAS`
   and `RELEASE_KEY_PASSWORD` are configured, the real keystore is used;
   otherwise CI generates an ephemeral keystore so the pipeline still produces
   a signed, installable artifact.
4. Verifies the APK signature with `apksigner`.
5. Uploads `FloorPlan3D-debug-<run>` and `FloorPlan3D-release-<run>` artifacts,
   ready to deploy.

To set up production signing:

```bash
keytool -genkeypair -keystore release.keystore -alias floorplan3d \
  -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 release.keystore   # → RELEASE_KEYSTORE_BASE64 secret
```

## Sample plans

`sample-plans/` contains generated validation images used by the test suite
and handy for manual testing:

- `sample_residence_metric.png` — two-bedroom residence with metric
  dimensions, FFL/plinth levels, `SCALE 1:100`, brick/RCC/tile/paint call-outs.
- `sample_office_feet_inches.png` — office layout annotated in feet-inches
  with gypsum/glass/granite/teak call-outs.

Regenerate with `python3 sample-plans/generate_samples.py` (needs Pillow).

## Market price feed

The app ships with a built-in price catalog (Indian residential market, INR)
and refreshes it at launch and on demand from
`FloorPlan3D/pricing/material-prices.json` served via raw.githubusercontent.com.
Edit that file to publish updated market prices to all installs — unknown
materials and malformed feeds are ignored safely, and the app keeps working
offline with the last cached prices.

## Known limitations

- Wall detection assumes predominantly axis-aligned walls (the common case for
  residential plans); heavily diagonal or curved layouts fall back to a
  perimeter model with a visible note.
- Only the first page of a multi-page PDF is processed.
- Quantity take-off does not deduct door/window openings; estimates are
  intentionally conservative and list their assumptions in the cost panel.
