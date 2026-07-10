"""Regional construction standards (heights etc.). Applied as defaults so the model
is correct out of the box; every value stays editable in the Verify & Edit gate and
can be saved as a user preference on the client.

Tamil Nadu values follow TNCDBR (Tamil Nadu Combined Development & Building Rules)
plus common local practice. All in feet.
"""
from __future__ import annotations

TAMIL_NADU = {
    "id": "tn",
    "name": "Tamil Nadu (standard)",
    "floor_height": 10.0,     # floor-to-floor (clear >= 2.75 m / 9' per TNCDBR)
    "stilt_height": 10.0,     # ground / open-parking storey (set 9 for a low stilt)
    "plinth": 2.0,            # finished floor above ground level
    "parapet": 3.5,           # terrace parapet (code min 1 m ~ 3'-3")
    "lintel": 7.0,            # door & window head level
    "window_sill": 3.0,       # habitable-room window sill
    "vent_sill": 6.0,         # toilet ventilator sill
    "door_height": 7.0,
    "wall_thickness": 0.75,   # 9" external
    "note": "TNCDBR: clear height >= 2.75 m (9'); floor-to-floor ~10'; plinth 2'; "
            "parapet >= 1 m (3'-3\"); lintel 7'; window sill 3'.",
}

# a second common variant (low stilt parking)
TAMIL_NADU_STILT9 = {**TAMIL_NADU, "id": "tn_stilt9",
                     "name": "Tamil Nadu (9' stilt parking)", "stilt_height": 9.0}

STANDARDS = {s["id"]: s for s in (TAMIL_NADU, TAMIL_NADU_STILT9)}
DEFAULT_STANDARD = "tn"


def apply_to_spec(spec, std: dict | None = None):
    """Fill heights/plinth/parapet/sills from a standard (used as sensible defaults)."""
    std = std or TAMIL_NADU
    spec.parapet = std["parapet"]
    spec.plinth = std.get("plinth", 2.0)
    spec.lintel = std.get("lintel", 7.0)
    spec.floor_height = std["floor_height"]
    for f in spec.floors:
        # ground / any storey with open parking uses the stilt height
        is_stilt = any(b.wall == "front" and "park" in (b.label or "").lower()
                       for b in f.open_bays) or f.level == 0
        f.height = std["stilt_height"] if is_stilt else std["floor_height"]
        for op in f.openings:
            if op.kind == "window":
                op.sill = std["window_sill"]
            elif op.kind == "ventilator":
                op.sill = std["vent_sill"]
            elif op.kind == "door":
                op.sill = 0.0
    return spec
