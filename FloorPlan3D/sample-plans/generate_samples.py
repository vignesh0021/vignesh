#!/usr/bin/env python3
"""Generates the sample floor-plan images used to validate FloorPlan 3D.

Draws synthetic but realistic 2D architectural plans: thick wall outlines,
dimension annotations (metric and feet-inches), elevation/level marks, a scale
indicator and material call-outs — everything the app's extraction pipeline
looks for.

Usage:  python3 generate_samples.py [output-dir]
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

WALL = 14          # wall thickness in px
INK = (20, 20, 20)
BG = (255, 255, 255)


def font(size):
    for name in ("DejaVuSans.ttf", "Arial.ttf", "LiberationSans-Regular.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def wall_h(d, x1, x2, y):
    d.rectangle([x1, y - WALL // 2, x2, y + WALL // 2], fill=INK)


def wall_v(d, x, y1, y2):
    d.rectangle([x - WALL // 2, y1, x + WALL // 2, y2], fill=INK)


def sample_residence(path: Path):
    """Two-bedroom residence, metric annotations."""
    img = Image.new("RGB", (1600, 1200), BG)
    d = ImageDraw.Draw(img)
    f, fs = font(26), font(20)

    # Outer walls: 1200x800 px representing 12.0 x 8.0 m
    L, T, R, B = 200, 200, 1400, 1000
    wall_h(d, L, R, T)
    wall_h(d, L, R, B)
    wall_v(d, L, T, B)
    wall_v(d, R, T, B)
    # Interior walls
    wall_v(d, 800, T, 700)          # bedroom divider
    wall_h(d, 800, R, 700)          # hall / bedroom 2
    wall_v(d, 1100, 700, B)         # kitchen

    # Dimension annotations
    d.text((720, 140), "12.0 m", font=f, fill=INK)
    d.line([L, 170, R, 170], fill=INK, width=2)
    d.text((80, 580), "8.0 m", font=f, fill=INK)
    d.line([170, T, 170, B], fill=INK, width=2)

    # Room labels with bare-mm sizes
    d.text((380, 420), "BEDROOM 1\n3600 X 4200", font=fs, fill=INK, align="center")
    d.text((1020, 420), "BEDROOM 2\n3000 X 4200", font=fs, fill=INK, align="center")
    d.text((420, 820), "LIVING HALL\n5400 X 3600", font=fs, fill=INK, align="center")
    d.text((1180, 820), "KITCHEN\n2400 X 3000", font=fs, fill=INK, align="center")

    # Elevations, height, scale, materials
    d.text((200, 1030), "FFL +0.45   PLINTH +0.45   FGL -0.15", font=fs, fill=INK)
    d.text((200, 1065), "CEILING HT 3.0 M", font=fs, fill=INK)
    d.text((200, 1100), "SCALE 1:100", font=fs, fill=INK)
    d.text((900, 1030), "230 THK BRICK MASONRY WALL IN CM 1:6", font=fs, fill=INK)
    d.text((900, 1065), "RCC SLAB M20, VITRIFIED TILE FLOORING", font=fs, fill=INK)
    d.text((900, 1100), "PLASTIC EMULSION PAINT ON WALLS", font=fs, fill=INK)
    d.text((200, 60), "RESIDENCE — GROUND FLOOR PLAN", font=f, fill=INK)

    img.save(path)


def sample_office_ftin(path: Path):
    """Small office, feet-inches annotations."""
    img = Image.new("RGB", (1500, 1100), BG)
    d = ImageDraw.Draw(img)
    f, fs = font(26), font(20)

    L, T, R, B = 150, 180, 1350, 930
    wall_h(d, L, R, T)
    wall_h(d, L, R, B)
    wall_v(d, L, T, B)
    wall_v(d, R, T, B)
    wall_v(d, 750, T, B)            # central partition
    wall_h(d, 750, R, 560)          # meeting room

    d.text((680, 120), "40'-0\"", font=f, fill=INK)
    d.line([L, 155, R, 155], fill=INK, width=2)
    d.text((40, 540), "25'-0\"", font=f, fill=INK)
    d.line([125, T, 125, B], fill=INK, width=2)

    d.text((330, 520), "OPEN OFFICE", font=fs, fill=INK)
    d.text((950, 350), "MEETING ROOM", font=fs, fill=INK)
    d.text((950, 760), "CABIN", font=fs, fill=INK)

    d.text((150, 960), "EL. +0.00   LVL +3.00", font=fs, fill=INK)
    d.text((150, 995), "CLG. HEIGHT: 10'-0\"", font=fs, fill=INK)
    d.text((150, 1030), "SCALE 1:50", font=fs, fill=INK)
    d.text((800, 960), "GYPSUM PARTITIONS, GLASS GLAZING", font=fs, fill=INK)
    d.text((800, 995), "GRANITE FLOORING, TEAK WOOD DOORS", font=fs, fill=INK)
    d.text((150, 60), "OFFICE LAYOUT PLAN", font=f, fill=INK)

    img.save(path)


if __name__ == "__main__":
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent
    out.mkdir(parents=True, exist_ok=True)
    sample_residence(out / "sample_residence_metric.png")
    sample_office_ftin(out / "sample_office_feet_inches.png")
    print(f"Wrote sample plans to {out}")
