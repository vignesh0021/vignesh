"""Turn an uploaded plan (PDF/JPG/PNG) into a validated BuildingSpec.

Flow:  file -> PNG page(s) -> vision-LLM extracts JSON -> validate -> BuildingSpec
If no LLM is configured or extraction fails, we return the SELVA example spec and
flag source='fallback' so the UI can say so honestly.
"""
from __future__ import annotations
import io, json, base64, re
import fitz                       # pymupdf
from PIL import Image

import llm_providers
from spec_schema import BuildingSpec, SELVA_EXAMPLE

MAX_W = 1600


def file_to_png_b64(data: bytes, filename: str) -> str:
    """Render first page of a PDF, or normalise an image, to base64 PNG."""
    name = (filename or "").lower()
    if name.endswith(".pdf") or data[:5] == b"%PDF-":
        doc = fitz.open(stream=data, filetype="pdf")
        page = doc[0]
        zoom = min(3.0, MAX_W / page.rect.width) if page.rect.width else 2.0
        pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom))
        png = pix.tobytes("png")
    else:
        img = Image.open(io.BytesIO(data)).convert("RGB")
        if img.width > MAX_W:
            img = img.resize((MAX_W, int(img.height * MAX_W / img.width)))
        buf = io.BytesIO(); img.save(buf, "PNG"); png = buf.getvalue()
    return base64.b64encode(png).decode()


SCHEMA_HINT = """Return ONLY valid JSON (no markdown fence) with this shape:
{
 "project": str, "units":"ft", "plot_width": num, "plot_depth": num,
 "floor_height": num, "parapet": num,
 "floors": [
   {"name": str, "level": int(0=ground), "area_sqft": num,
    "fx": num, "fy": num, "fw": num, "fd": num, "height": num,
    "cladding": {"wall":"front","start":num,"length":num,"material":"teak"} | null,
    "open_bays":[{"wall":"front|rear|left|right","start":num,"length":num,"label":str}],
    "balconies":[{"wall":"front","start":num,"length":num,"depth":num,"rail_height":num,"label":str}],
    "openings":[{"tag":str,"kind":"window|door|ventilator","wall":"front|rear|left|right",
                 "pos":num,"width":num,"height":num,"sill":num}]}
 ]
}
Coordinates in feet. x = across the front (left..right as drawn); y = depth, 0 at FRONT
wall growing to REAR. 'fx,fy,fw,fd' = each floor's built footprint rectangle. Mark open
parking / open terrace as open_bays. Put every window (W2,W3..), door (MD,D,D2) and
ventilator (V) on the correct wall with its position and size from the joinery schedule."""

PROMPT = f"""You are an architectural plan reader. Study this residential floor-plan
sheet (it may contain several floors: ground/first/second, plus a joinery/legend table).
Extract the building as structured data so a renderer can draw accurate elevations.

Rules:
- Read every floor's built-up area and footprint. Note where upper floors STEP BACK
  (smaller footprint) or project (balconies).
- Use the joinery/legend table for exact window/door sizes (e.g. W3=4'x4', W2=3'x4').
- Identify the FRONT of the building (the entrance / main gate / road side).
- Do not invent floors or windows that are not on the plan.

{SCHEMA_HINT}"""


def _extract_json(text: str) -> dict:
    text = text.strip()
    text = re.sub(r"^```(json)?|```$", "", text, flags=re.MULTILINE).strip()
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if not m:
        raise ValueError("no JSON object in model output")
    return json.loads(m.group(0))


def analyze(data: bytes, filename: str) -> dict:
    """Returns {spec: BuildingSpec, source: 'llm'|'fallback', provider, note}."""
    prov = llm_providers.available()
    if prov["provider"] == "none" or not prov["configured"]:
        return {"spec": SELVA_EXAMPLE, "source": "fallback",
                "provider": prov["provider"],
                "note": "No LLM configured — showing the built-in SELVA example. "
                        "Set LLM_PROVIDER + key to analyse your own upload."}
    try:
        b64 = file_to_png_b64(data, filename)
        raw = llm_providers.analyze(b64, PROMPT)
        spec = BuildingSpec(**_extract_json(raw))
        if not spec.floors:
            raise ValueError("model returned zero floors")
        return {"spec": spec, "source": "llm", "provider": prov["provider"],
                "note": f"Extracted by {prov['provider']}."}
    except Exception as e:                      # noqa: BLE001 - report, don't crash
        return {"spec": SELVA_EXAMPLE, "source": "fallback",
                "provider": prov["provider"],
                "note": f"LLM extraction failed ({type(e).__name__}: {e}); "
                        f"showing example so you can still see the pipeline."}
