"""Build the positive/negative text-to-image prompt from a spec + theme.

Keeps the wording tied to the actual building so a photoreal render matches the
plan's massing (open parking, projecting balcony, stepped-back terrace, cladding).
"""
from __future__ import annotations
from spec_schema import BuildingSpec

# material words per theme id (mirrors frontend themes.js)
THEME_WORDS = {
    "white-teak": "smooth off-white plaster with warm teak-wood cladding accents and grey fluted panels",
    "sand-bronze": "warm sandstone plaster with brown stone accents and bronze metal railings",
    "mono": "clean white plaster with charcoal-grey accent panels and black steel railings",
    "terracotta": "off-white plaster with earthy terracotta accent bands and timber cladding",
    "slate-oak": "light grey plaster with slate-grey accents and light oak timber cladding",
}


def build_prompts(spec: BuildingSpec, theme_id: str = "white-teak") -> dict:
    n = len(spec.floors)
    mats = THEME_WORDS.get(theme_id, THEME_WORDS["white-teak"])
    features = []
    for f in spec.floors:
        if any(b.wall == "front" for b in f.balconies):
            features.append(f"a projecting front balcony on the {f.name.lower()} floor "
                            f"with glass and steel railing")
        if any(o.label for o in f.open_bays if o.wall == "front"):
            lab = next(o.label for o in f.open_bays if o.wall == "front")
            features.append(f"an open {lab} at the {f.name.lower()} level")
    feat = "; ".join(features) if features else "clean stacked massing"

    positive = (
        f"Ultra-realistic architectural exterior render, front elevation of a modern "
        f"G+{n-1} ({n}-level) residential building, strictly following the provided "
        f"structural line drawing. {feat}. The upper floor steps back to an open terrace "
        f"with a parapet. Facade in {mats}, floor-to-ceiling glass windows aligned to the "
        f"line-art openings, wall-mounted warm LED lights. Daytime, bright natural sunlight, "
        f"soft realistic shadows, clear blue sky, subtle landscaping and a car in the "
        f"open parking, architectural visualization, 8k, hyper-realistic materials, "
        f"physically based rendering, sharp, professional real-estate render."
    )
    negative = (
        "extra floors, missing floors, wrong floor count, misaligned windows, floating "
        "balconies, extra balconies, curved walls, sloped or pitched roof, roof tiles, "
        "classical columns, ornate details, arches, temple, cluttered, warped geometry, "
        "distorted proportions, blurry, low quality, watermark, text, people, cartoon, "
        "sketch, duplicate windows, fisheye."
    )
    return {"positive": positive, "negative": negative}
