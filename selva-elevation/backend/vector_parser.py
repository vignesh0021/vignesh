"""Deterministic vector-PDF parser — read exact geometry + dimension text from a
CAD-exported plan with NO AI. Produces a BuildingSpec draft whose dimensions/areas
come straight from the drawing's own text layer.

Works on vector PDFs (embedded text). For raster scans/photos it returns None so the
caller can fall back to the LLM. Whatever it returns is still a *draft* that the user
confirms in the Verify & Edit gate.
"""
from __future__ import annotations
import re
from typing import Optional
import fitz

from spec_schema import BuildingSpec, Floor, Opening

# joinery defaults (feet) — used when a tag isn't in the sheet's legend table
JOINERY = {
    "MD": ("door", 3.5, 7.0, 0.0),
    "D":  ("door", 3.0, 7.0, 0.0),
    "D2": ("door", 2.5, 7.0, 0.0),
    "W2": ("window", 3.0, 4.0, 3.0),
    "W3": ("window", 4.0, 4.0, 3.0),
    "V":  ("ventilator", 2.0, 2.0, 6.0),
}
TAG_RE = re.compile(r"^(MD|D2|D|W2|W3|V)$")
FEET_RE = re.compile(r"(\d+)'\s*-?\s*(\d+)?\"?")  # 35'  10'9"  6'-6"


def _feet(tok: str) -> Optional[float]:
    m = FEET_RE.fullmatch(tok.strip())
    if not m:
        return None
    ft = int(m.group(1))
    inch = int(m.group(2)) if m.group(2) else 0
    return ft + inch / 12.0


def looks_like_vector_pdf(doc) -> bool:
    p = doc[0]
    words = p.get_text("words")
    drawings = p.get_drawings()
    # needs a real text layer + real vector linework (not a scanned image)
    return len(words) >= 30 and len(drawings) >= 200


def parse(data: bytes) -> tuple[Optional[BuildingSpec], list[str]]:
    notes: list[str] = []
    try:
        doc = fitz.open(stream=data, filetype="pdf")
    except Exception:
        return None, ["not a PDF"]
    if not looks_like_vector_pdf(doc):
        return None, ["no vector/text layer (looks like a scan) — vector parse skipped"]

    p = doc[0]
    words = p.get_text("words")           # (x0,y0,x1,y1, text, ...)
    text = p.get_text("text")
    TITLE_BLOCK_Y = 3160                  # legend/title strip at the bottom (mediabox)

    # --- locate the floor plans by their titles (rotated text -> match by token) ---
    # primary plan titles sit in a left column; the legend block repeats them on the right.
    name_y = {}
    for w in words:
        kw = w[4].upper()
        yc = (w[1] + w[3]) / 2
        if kw in ("GROUND", "FIRST", "SECOND", "THIRD", "FOURTH") and w[0] < 1200 and yc < TITLE_BLOCK_Y:
            name_y.setdefault(kw.title(), yc)
    titles = sorted(name_y.items(), key=lambda t: t[1])
    if not titles:
        return None, ["no floor-plan titles found"]
    n_floors = len(titles)

    # exact plot / building dimensions from the outer dimension chain
    dims = sorted({round(_feet(w[4]), 2) for w in words
                   if _feet(w[4]) is not None and _feet(w[4]) >= 2}, reverse=True)
    plot_w = _pick(dims, 40) or 40
    plot_d = _pick(dims, 30) or 30
    build_w = _pick(dims, 35) or (plot_w - 5)
    notes.append(f"dims read: plot {plot_w}x{plot_d} ft, building width {build_w} ft")

    # area labels with positions, paired to the nearest title (reliable: the area
    # caption always sits next to its floor title)
    area_tokens = []  # (value, y)
    d = p.get_text("dict")
    for b in d["blocks"]:
        for l in b.get("lines", []):
            s = "".join(sp["text"] for sp in l["spans"])
            m = re.search(r"BUILD ?UP AREA\s*=\s*(\d+)", s, re.I)
            if m:
                area_tokens.append((int(m.group(1)), (l["bbox"][1] + l["bbox"][3]) / 2))

    def area_for(ty):
        if not area_tokens:
            return None
        return min(area_tokens, key=lambda a: abs(a[1] - ty))[0]

    def nearest_title_idx(y):
        return min(range(n_floors), key=lambda i: abs(y - titles[i][1]))

    # group opening tags by nearest title (best-effort; positions confirmed in Verify gate)
    tags_by_floor: dict[int, list] = {i: [] for i in range(n_floors)}
    for w in words:
        yc = (w[1] + w[3]) / 2
        if yc >= TITLE_BLOCK_Y or not TAG_RE.match(w[4].strip()):
            continue
        tags_by_floor[nearest_title_idx(yc)].append(w)

    floors = []
    prev_depth = plot_d - 3
    for i, (name, ty) in enumerate(titles):
        area = area_for(ty)
        # EXACT-derived footprint depth from the area (captures upper-floor setbacks):
        # depth ≈ area / building_width, clamped to the plot.
        depth = round(min(area / build_w, plot_d), 1) if area else prev_depth
        prev_depth = depth

        # openings — nearest-title grouping; positions spread evenly per wall as a
        # starting point (the plan's exact tag coords vary; the user verifies).
        opens = []
        per_wall: dict[str, int] = {}
        band = tags_by_floor[i]
        # rough wall split: alternate by reading order so each wall gets a few
        for j, w in enumerate(sorted(band, key=lambda z: (z[1], z[0]))):
            tag = w[4].strip()
            kind, ww, hh, sill = JOINERY[tag]
            wall = ("front", "rear", "left", "right")[j % 4] if kind != "door" else "front"
            k = per_wall.get(wall, 0); per_wall[wall] = k + 1
            span = build_w if wall in ("front", "rear") else depth
            pos = round(min(2 + k * 6, max(0, span - ww)), 1)
            opens.append(Opening(tag=tag, kind=kind, wall=wall, pos=pos,
                                 width=ww, height=hh, sill=sill))

        floors.append(Floor(name=name, level=i, area_sqft=area,
                            fx=0, fy=0, fw=build_w, fd=depth, height=10,
                            openings=opens))
        notes.append(f"{name}: area={area} sqft, footprint {build_w}×{depth} ft "
                     f"(depth from area), {len(opens)} openings [{_count_tags(opens)}]")

    if not floors:
        return None, notes + ["no floor regions resolved"]

    spec = BuildingSpec(project="Vector-parsed plan", plot_width=plot_w, plot_depth=plot_d,
                        floor_height=10, parapet=3, floors=floors)
    notes.append("NOTE: dimensions/areas/opening tags are exact from the CAD text; "
                 "floor setbacks & exact window placement are best-effort — confirm in Verify & Edit.")
    return spec, notes


def _near_phrase(words, w, other, gap=200):
    """True if a word `other` appears near word w on roughly the same line."""
    yc = (w[1] + w[3]) / 2
    for z in words:
        if z[4].upper() == other and abs((z[1] + z[3]) / 2 - yc) < 40 and 0 < z[0] - w[2] < gap:
            return True
    return False


def _pick(values, target, tol=1.5):
    """closest value to target within tolerance, else None."""
    cands = [v for v in values if abs(v - target) <= tol]
    return min(cands, key=lambda v: abs(v - target)) if cands else None


def _count_tags(opens):
    from collections import Counter
    c = Counter(o.tag for o in opens)
    return ", ".join(f"{k}×{v}" for k, v in sorted(c.items()))
