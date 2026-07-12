"""Structured building specification.

The whole project is built around ONE idea: a vision-LLM only *extracts numbers*
into this spec, and a deterministic renderer draws every view from the spec.
That keeps geometry 100% faithful to the plan (no pixel hallucination).

Coordinate system (all values in feet):
  x  -> horizontal across the FRONT facade, left..right as the plan is drawn.
  y  -> depth, 0 at the FRONT wall, increasing toward the REAR.
  z  -> height, handled by floor stacking (floor_height).
"""
from __future__ import annotations
from typing import List, Optional, Literal
from pydantic import BaseModel, Field

Wall = Literal["front", "rear", "left", "right"]


class Opening(BaseModel):
    tag: str = "W3"                      # W2 / W3 / MD / D / V ...
    kind: Literal["window", "door", "ventilator"] = "window"
    wall: Wall = "front"
    pos: float = 0.0                     # offset along the wall (x for front/rear, y for sides)
    width: float = 4.0
    height: float = 4.0
    sill: float = 3.0                    # height of sill above floor (0 for doors)


class Balcony(BaseModel):
    wall: Wall = "front"
    start: float = 0.0                   # offset along the wall
    length: float = 10.0
    depth: float = 5.0                   # how far it projects
    rail_height: float = 3.5
    label: str = "balcony"


class OpenBay(BaseModel):
    """A wall-less region on a floor (open parking / open terrace)."""
    wall: Wall = "front"
    start: float = 0.0
    length: float = 10.0
    label: str = "parking"


class Floor(BaseModel):
    name: str = "Ground"
    level: int = 0                       # 0 = ground
    area_sqft: Optional[float] = None
    # footprint rectangle of the built slab, in plot coordinates
    fx: float = 0.0
    fy: float = 0.0
    fw: float = 35.0                     # width
    fd: float = 27.0                     # depth
    height: float = 10.0
    cladding: Optional[dict] = None      # {"wall":"front","start":22,"length":13,"material":"teak"}
    open_bays: List[OpenBay] = Field(default_factory=list)
    balconies: List[Balcony] = Field(default_factory=list)
    openings: List[Opening] = Field(default_factory=list)


class BuildingSpec(BaseModel):
    project: str = "Building"
    units: str = "ft"
    plot_width: float = 40.0
    plot_depth: float = 30.0
    floor_height: float = 10.0
    parapet: float = 3.5
    plinth: float = 2.0          # finished floor level above ground (Tamil Nadu ~2')
    lintel: float = 7.0          # door/window head level
    wall_thickness: float = 0.75  # 9" external wall
    sunshade: bool = True        # chajja over exterior windows/doors (common in TN)
    standard: str = "tn"         # id of the applied height standard
    floors: List[Floor] = Field(default_factory=list)

    @property
    def total_width(self) -> float:
        return max((f.fx + f.fw for f in self.floors), default=self.plot_width)

    @property
    def total_depth(self) -> float:
        return max((f.fy + f.fd for f in self.floors), default=self.plot_depth)


# --------------------------------------------------------------------------
# Built-in example: SELVA 23.3.26  (G+2), extracted from the real blueprint.
# Serves as a working demo and as a few-shot target for the LLM.
# --------------------------------------------------------------------------
SELVA_EXAMPLE = BuildingSpec(
    project="SELVA G+2 Residence",
    plot_width=40, plot_depth=30, floor_height=10, parapet=3,
    floors=[
        Floor(
            name="Ground", level=0, area_sqft=960,
            fx=0, fy=0, fw=35, fd=27, height=10,
            open_bays=[OpenBay(wall="front", start=0, length=22, label="car parking")],
            openings=[
                Opening(tag="MD", kind="door", wall="front", pos=27.5, width=3.5, height=7, sill=0),
                Opening(tag="W3", wall="rear",  pos=6,  width=4, height=4),
                Opening(tag="W3", wall="rear",  pos=20, width=4, height=4),
                Opening(tag="W3", wall="left",  pos=8,  width=4, height=4),
                Opening(tag="W3", wall="right", pos=8,  width=4, height=4),
            ],
        ),
        Floor(
            name="First", level=1, area_sqft=1054,
            fx=0, fy=0, fw=35, fd=29, height=10,
            cladding={"wall": "front", "start": 22, "length": 13, "material": "teak"},
            balconies=[Balcony(wall="front", start=0.5, length=22.5, depth=5, rail_height=3.5,
                               label="5' wide balcony")],
            openings=[
                Opening(tag="W3", wall="front", pos=4,  width=4, height=4),
                Opening(tag="MD", kind="door",  wall="front", pos=11, width=4, height=8, sill=0),
                Opening(tag="W2", wall="front", pos=18, width=3, height=4),
                Opening(tag="W3", wall="front", pos=30, width=4, height=4),
                Opening(tag="W3", wall="right", pos=10, width=4, height=4),
                Opening(tag="W3", wall="left",  pos=10, width=4, height=4),
            ],
        ),
        Floor(
            name="Second", level=2, area_sqft=567,
            fx=22, fy=6, fw=13, fd=23, height=10,   # rear-right block only
            cladding={"wall": "front", "start": 22, "length": 2.5, "material": "teak"},
            open_bays=[OpenBay(wall="front", start=0, length=22, label="open terrace")],
            balconies=[Balcony(wall="front", start=23, length=11.5, depth=4.2, rail_height=3.2,
                               label="terrace balcony")],
            openings=[
                Opening(tag="W3", wall="front", pos=30, width=4, height=4),
                Opening(tag="W3", wall="right", pos=8,  width=4, height=4),
            ],
        ),
    ],
)
