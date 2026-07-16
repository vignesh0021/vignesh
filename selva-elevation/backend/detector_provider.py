"""Pluggable image-detector extraction stage.

For raster plans (photos/scans) with no CAD text layer, an object-detection model
(e.g. a Mask R-CNN service like FloorPlanTo3D) can find walls/windows/doors far more
reliably than a general vision-LLM. This module is the *socket*: point it at such a
service and its detections become a BuildingSpec. Whatever it returns is still a
draft confirmed in the Verify & Edit gate.

Select with  DETECTOR_PROVIDER = none | http
  http : POST the image to DETECTOR_URL; expect (or adapt in _normalize) a JSON of
         pixel-space boxes for walls/windows/doors. See docs/detector-integration.md.

No heavy ML deps live here — the model runs as a separate microservice (it needs the
GPU/weights). This keeps the app light and the model swappable.
"""
from __future__ import annotations
import io, os, base64, requests

from spec_schema import BuildingSpec, Floor, Opening
import standards

TIMEOUT = 120

# default opening sizes (ft) when the detector gives only boxes/positions
DEFAULT = {"window": (4.0, 4.0, 3.0), "door": (3.0, 7.0, 0.0)}


def _provider() -> str:
    return os.getenv("DETECTOR_PROVIDER", "none").strip().lower()


def available() -> dict:
    p = _provider()
    return {"provider": p, "configured": p == "http" and bool(os.getenv("DETECTOR_URL"))}


def detect(data: bytes, filename: str = "") -> BuildingSpec | None:
    """Returns a BuildingSpec draft, or None if not configured / detection failed."""
    if not available()["configured"]:
        return None
    try:
        raw = _call_service(data)
        norm = _normalize(raw)
        spec = _to_spec(norm)
        if spec and spec.floors:
            standards.apply_to_spec(spec)
            return spec
    except Exception:                       # noqa: BLE001 - fall through to LLM
        return None
    return None


def _call_service(data: bytes) -> dict:
    url = os.environ["DETECTOR_URL"]
    b64 = base64.b64encode(data).decode()
    # send both a file part and a base64 field so most services are happy
    try:
        r = requests.post(url, files={"file": ("plan.png", io.BytesIO(data), "image/png")},
                          timeout=TIMEOUT)
        if r.status_code >= 400:
            raise RuntimeError(r.status_code)
    except Exception:
        r = requests.post(url, json={"image": b64}, timeout=TIMEOUT)
        r.raise_for_status()
    return r.json()


def _normalize(raw: dict) -> dict:
    """Map a service's response to our shape. ADAPT THIS to your model's output.

    Expected normalized shape (all boxes are [x0, y0, x1, y1] in image pixels):
      { "image_width": int, "image_height": int,
        "scale_ft_per_px": float | None,
        "walls":   [[..],..],  "windows": [[..],..],  "doors": [[..],..] }
    """
    def boxes(key, *alts):
        for k in (key, *alts):
            if isinstance(raw.get(k), list):
                return [b[:4] for b in raw[k] if isinstance(b, (list, tuple)) and len(b) >= 4]
        # some APIs return {"objects":[{"class":"window","bbox":[...]}]}
        objs = raw.get("objects") or raw.get("detections") or []
        out = []
        for o in objs:
            cls = str(o.get("class") or o.get("label") or "").lower()
            bb = o.get("bbox") or o.get("box")
            if bb and key[:-1] in cls:      # "windows" -> "window"
                out.append(list(bb)[:4])
        return out

    return {
        "image_width": raw.get("image_width") or raw.get("width") or 1000,
        "image_height": raw.get("image_height") or raw.get("height") or 1000,
        "scale_ft_per_px": raw.get("scale_ft_per_px") or raw.get("scale"),
        "walls": boxes("walls"),
        "windows": boxes("windows"),
        "doors": boxes("doors"),
    }


def _to_spec(n: dict) -> BuildingSpec | None:
    walls = n["walls"]
    anchor = walls or (n["windows"] + n["doors"])
    if not anchor:
        return None
    xs = [c for b in anchor for c in (b[0], b[2])]
    ys = [c for b in anchor for c in (b[1], b[3])]
    X0, X1, Y0, Y1 = min(xs), max(xs), min(ys), max(ys)
    pxW, pxH = max(X1 - X0, 1), max(Y1 - Y0, 1)

    # pixels -> feet: use the detector scale, else the operator-provided building width
    scale = n["scale_ft_per_px"]
    if not scale:
        bw = float(os.getenv("DETECTOR_BUILDING_WIDTH_FT", "30"))
        scale = bw / pxW
    fw = round(pxW * scale, 1)
    fd = round(pxH * scale, 1)

    def place(box, kind):
        w, h, sill = DEFAULT[kind]
        cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
        nx = (cx - X0) / pxW              # across width
        ny = (cy - Y0) / pxH             # across depth
        edges = {"front": ny, "rear": 1 - ny, "left": nx, "right": 1 - nx}
        wall = min(edges, key=edges.get)
        if wall in ("front", "rear"):
            span, pos = fw, nx * fw
        else:
            span, pos = fd, ny * fd
        pos = round(max(0, min(pos - w / 2, span - w)), 1)
        tag = "W3" if kind == "window" else "MD"
        return Opening(tag=tag, kind=kind, wall=wall, pos=pos, width=w, height=h, sill=sill)

    opens = [place(b, "window") for b in n["windows"]] + [place(b, "door") for b in n["doors"]]
    floor = Floor(name="Ground", level=0, area_sqft=round(fw * fd, 0),
                  fx=0, fy=0, fw=fw, fd=fd, height=10, openings=opens)
    return BuildingSpec(project="Detected plan", plot_width=fw + 5, plot_depth=fd + 3,
                        floor_height=10, floors=[floor])
