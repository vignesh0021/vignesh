"""Deterministic view generator: BuildingSpec -> SVG line diagrams.

Produces the six deliverables:
  front, rear, left, right   -> orthographic line diagrams
  top                        -> stacked roof / massing plan
  elevation                  -> shaded, coloured front elevation (presentation)

Everything is drawn from numbers in the spec, so geometry always matches the plan.
"""
from __future__ import annotations
from typing import List
from spec_schema import BuildingSpec, Floor


# ----------------------------- tiny svg helper -----------------------------
class SVG:
    def __init__(self, w, h, bg="white"):
        self.w, self.h = w, h
        self.parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" '
                      f'viewBox="0 0 {w} {h}" font-family="Inter,Arial,sans-serif">']
        if bg:
            self.parts.append(f'<rect width="{w}" height="{h}" fill="{bg}"/>')

    def raw(self, s): self.parts.append(s)

    def rect(self, x, y, w, h, fill="none", stroke="#1d1d1f", sw=2.2, rx=0):
        self.parts.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" '
                          f'rx="{rx}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"/>')

    def line(self, x1, y1, x2, y2, stroke="#1d1d1f", sw=2.2, dash=""):
        d = f' stroke-dasharray="{dash}"' if dash else ""
        self.parts.append(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" '
                          f'stroke="{stroke}" stroke-width="{sw}"{d}/>')

    def text(self, x, y, s, size=15, fill="#6b6b70", anchor="middle", weight="500"):
        self.parts.append(f'<text x="{x:.1f}" y="{y:.1f}" font-size="{size}" fill="{fill}" '
                          f'text-anchor="{anchor}" font-weight="{weight}">{s}</text>')

    def done(self):
        self.parts.append("</svg>")
        return "\n".join(self.parts)


INK = "#1d1d1f"
THIN = 1.4
LABEL = "#8a8a8f"


def _canvas(units_w, units_h, scale, pad=90, title_h=70):
    W = units_w * scale + pad * 2
    H = units_h * scale + pad * 2 + title_h
    return W, H, pad, title_h


def _window(svg: SVG, x, y, w, h, mull=True):
    svg.rect(x, y, w, h, sw=2.0)
    if mull and w > 10 and h > 10:
        svg.line(x + w / 2, y, x + w / 2, y + h, INK, THIN)
        svg.line(x, y + h / 2, x + w, y + h / 2, INK, THIN)
    svg.line(x - 3, y + h + 4, x + w + 3, y + h + 4, INK, THIN)   # sill


def _title(svg: SVG, W, H, title, sub):
    svg.line(60, H - 46, W - 60, H - 46, "#e2e2e6", 1.4)
    svg.text(W / 2, H - 22, title, 22, INK, "middle", "700")
    if sub:
        svg.text(W / 2, H - 2, sub, 13, LABEL)


# =========================================================================
#  ORTHOGRAPHIC LINE VIEWS
# =========================================================================
def _stack_heights(spec: BuildingSpec):
    """y (top) for each floor band, ground at bottom."""
    n = len(spec.floors)
    total_h = sum(f.height for f in spec.floors) + spec.parapet
    return total_h


def front_or_rear(spec: BuildingSpec, rear=False) -> str:
    scale = 22
    tw = spec.total_width
    th = _stack_heights(spec)
    W, H, pad, tit = _canvas(tw, th, scale)
    svg = SVG(W, H)
    ground_y = H - pad - tit
    xl = pad

    def fx(v):                      # foot -> px, mirror for rear
        return xl + (tw - v if rear else v) * scale

    # draw floors bottom-up
    y = ground_y
    for f in spec.floors:
        fh = f.height * scale
        top = y - fh
        # footprint span
        x0, x1 = fx(f.fx), fx(f.fx + f.fw)
        lo, hi = min(x0, x1), max(x0, x1)
        svg.rect(lo, top, hi - lo, fh, sw=2.4)
        wall = "rear" if rear else "front"
        # cladding hatch
        cl = f.cladding
        if cl and cl.get("wall") == wall:
            cx0, cx1 = fx(cl["start"]), fx(cl["start"] + cl["length"])
            clo, chi = min(cx0, cx1), max(cx0, cx1)
            svg.rect(clo, top, chi - clo, fh, "#f3ece2", INK, 1.6)
            n = int((chi - clo) // 14)
            for i in range(1, n):
                svg.line(clo + i * 14, top, clo + i * 14, top + fh, "#c9b48f", 1.0)
        # open bays on this wall -> draw as recessed (dashed opening)
        for ob in f.open_bays:
            if ob.wall != wall:
                continue
            ox0, ox1 = fx(ob.start), fx(ob.start + ob.length)
            olo, ohi = min(ox0, ox1), max(ox0, ox1)
            svg.rect(olo, top, ohi - olo, fh, "#fbfbfc", "#b8b8bd", 1.6)
            svg.line(olo, top, ohi, top + fh, "#d3d3d8", 1.0, "6 6")
            svg.text((olo + ohi) / 2, top + fh - 8, ob.label.upper(), 12, LABEL)
        # openings
        for op in f.openings:
            if op.wall != wall:
                continue
            ox = fx(op.pos + (op.width / 2 if not rear else -op.width / 2))
            wpx, hpx = op.width * scale, op.height * scale
            oy = y - (op.sill + op.height) * scale
            _window(svg, ox - wpx / 2, oy, wpx, hpx, mull=(op.kind == "window"))
            svg.text(ox, oy - 6, op.tag, 11, LABEL)
        # balconies (front/rear projecting rail)
        for b in f.balconies:
            if b.wall != wall:
                continue
            bx0, bx1 = fx(b.start), fx(b.start + b.length)
            blo, bhi = min(bx0, bx1), max(bx0, bx1)
            rail = y - b.rail_height * scale
            svg.line(blo - 6, y, bhi + 6, y, INK, 2.4)
            svg.rect(blo, rail, bhi - blo, y - rail, "#eef4f8", "#8a9aa4", 1.6)
            svg.line(blo, rail - 6, bhi, rail - 6, INK, 2.0)
            k = int((bhi - blo) // 34)
            for i in range(k + 1):
                svg.line(blo + i * 34, rail - 6, blo + i * 34, y, "#9fb0ba", 1.4)
            svg.text((blo + bhi) / 2, rail - 12, b.label, 11, LABEL)
        y = top
    # roof parapet on the topmost band
    top_floor = spec.floors[-1]
    tx0, tx1 = fx(top_floor.fx), fx(top_floor.fx + top_floor.fw)
    svg.rect(min(tx0, tx1) - 8, y - spec.parapet * scale, abs(tx1 - tx0) + 16,
             spec.parapet * scale, "none", INK, 2.0)
    # ground line + hatch
    svg.line(xl - 30, ground_y, W - pad + 30, ground_y, INK, 2.2)
    for i in range(0, int((W - 2 * pad + 60) // 20)):
        gx = xl - 30 + i * 20
        svg.line(gx, ground_y + 12, gx + 12, ground_y, INK, 1.0)
    name = "REAR ELEVATION" if rear else "FRONT ELEVATION"
    _title(svg, W, H, name, f'{spec.project} · width {tw:g} ft · scale ~1:{int(12/ (scale/22)) or 12}')
    return svg.done()


def side(spec: BuildingSpec, right=False) -> str:
    scale = 22
    td = spec.total_depth
    th = _stack_heights(spec)
    W, H, pad, tit = _canvas(td, th, scale)
    svg = SVG(W, H)
    ground_y = H - pad - tit
    xl = pad

    def fy(v):                       # depth foot -> px (front at left; mirror for right)
        return xl + (td - v if right else v) * scale

    y = ground_y
    for f in spec.floors:
        fh = f.height * scale
        top = y - fh
        d0, d1 = fy(f.fy), fy(f.fy + f.fd)
        lo, hi = min(d0, d1), max(d0, d1)
        svg.rect(lo, top, hi - lo, fh, sw=2.4)
        wall = "right" if right else "left"
        for op in f.openings:
            if op.wall != wall:
                continue
            oy = y - (op.sill + op.height) * scale
            ox = fy(op.pos + (op.width / 2 if not right else -op.width / 2))
            wpx, hpx = op.width * scale, op.height * scale
            _window(svg, ox - wpx / 2, oy, wpx, hpx, mull=(op.kind == "window"))
            svg.text(ox, oy - 6, op.tag, 11, LABEL)
        # front-facing balconies show as a projection block at the FRONT edge
        for b in f.balconies:
            if b.wall != "front":
                continue
            fe = fy(0)                       # front edge
            proj = b.depth * scale
            rail = y - b.rail_height * scale
            px = fe - proj if not right else fe + proj
            svg.line(fe, y, px, y, INK, 2.2)
            svg.rect(min(fe, px), rail, proj, y - rail, "#eef4f8", "#8a9aa4", 1.6)
        y = top
    top_floor = spec.floors[-1]
    tx0, tx1 = fy(top_floor.fy), fy(top_floor.fy + top_floor.fd)
    svg.rect(min(tx0, tx1) - 8, y - spec.parapet * scale, abs(tx1 - tx0) + 16,
             spec.parapet * scale, "none", INK, 2.0)
    svg.line(xl - 30, ground_y, W - pad + 30, ground_y, INK, 2.2)
    for i in range(0, int((W - 2 * pad + 60) // 20)):
        gx = xl - 30 + i * 20
        svg.line(gx, ground_y + 12, gx + 12, ground_y, INK, 1.0)
    name = "RIGHT SIDE ELEVATION" if right else "LEFT SIDE ELEVATION"
    svg.text(pad, ground_y + 40, "◄ FRONT" if not right else "REAR ►", 12, LABEL, "start")
    _title(svg, W, H, name, f'{spec.project} · depth {td:g} ft')
    return svg.done()


def top(spec: BuildingSpec) -> str:
    """Stacked roof / massing plan seen from above."""
    scale = 20
    tw, td = spec.total_width, spec.total_depth
    # reserve room at the front (top) for projecting balconies
    front_proj = max((b.depth for f in spec.floors for b in f.balconies
                      if b.wall == "front"), default=0)
    W, H, pad, tit = _canvas(tw, td + front_proj, scale)
    svg = SVG(W, H)
    xl, yt = pad, pad + front_proj * scale

    def px(v): return xl + v * scale
    def py(v): return yt + v * scale          # front (y=0) at top

    # draw each floor footprint; higher floors darker outline to read the stack
    shades = ["#eef0f3", "#e2e6ea", "#d4dae0"]
    for i, f in enumerate(spec.floors):
        svg.rect(px(f.fx), py(f.fy), f.fw * scale, f.fd * scale,
                 shades[min(i, 2)], INK, 2.0)
        svg.text(px(f.fx + f.fw / 2), py(f.fy + f.fd / 2), f.name.upper(), 13, "#5f5f65")
        # open terraces / bays as dashed
        for ob in f.open_bays:
            if ob.wall == "front":
                svg.rect(px(ob.start), py(0), ob.length * scale, 3 * scale,
                         "none", "#b8b8bd", 1.4)
        # balconies as projecting rectangles toward front
        for b in f.balconies:
            if b.wall == "front":
                svg.rect(px(b.start), py(0) - b.depth * scale, b.length * scale,
                         b.depth * scale, "#eef4f8", "#8a9aa4", 1.4)
    # plot boundary
    svg.rect(px(0) - (spec.plot_width - tw) * scale / 2 if False else px(0), py(0),
             tw * scale, td * scale, "none", "#c7c7cc", 1.2, )
    # north arrow (front faces north on this plan)
    ax, ay = W - pad - 20, pad + 30
    svg.line(ax, ay + 34, ax, ay - 20, INK, 2)
    svg.raw(f'<polygon points="{ax-7},{ay-8} {ax+7},{ay-8} {ax},{ay-22}" fill="{INK}"/>')
    svg.text(ax, ay + 52, "N", 14, INK)
    _title(svg, W, H, "TOP / ROOF PLAN", f'{spec.project} · {tw:g} × {td:g} ft · setbacks shown')
    return svg.done()


# =========================================================================
#  COLOURED PRESENTATION ELEVATION  (front)
# =========================================================================
def elevation(spec: BuildingSpec) -> str:
    scale = 26
    tw = spec.total_width
    th = _stack_heights(spec)
    pad = 120
    W = int(tw * scale + pad * 2)
    H = int(th * scale + pad * 2)
    svg = SVG(W, H, bg=None)
    svg.raw('''<defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5B9BD5"/>
        <stop offset="0.6" stop-color="#9FC7EA"/><stop offset="1" stop-color="#DCEEFB"/></linearGradient>
      <linearGradient id="pl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F6F2EA"/>
        <stop offset="1" stop-color="#E4DCCE"/></linearGradient>
      <linearGradient id="plsh" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#DCD3C4"/>
        <stop offset="1" stop-color="#C7BCA9"/></linearGradient>
      <linearGradient id="tk" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#B06E33"/>
        <stop offset="0.5" stop-color="#95531F"/><stop offset="1" stop-color="#7D4419"/></linearGradient>
      <linearGradient id="gl" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="#BcdCEC"/>
        <stop offset="0.5" stop-color="#7FA9C4"/><stop offset="1" stop-color="#5C8AA8"/></linearGradient>
      <linearGradient id="rg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#CFE4F0" stop-opacity="0.75"/>
        <stop offset="1" stop-color="#9FBFD2" stop-opacity="0.55"/></linearGradient>
      <radialGradient id="sun" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#FFFDF0"/>
        <stop offset="0.4" stop-color="#FFF3C8" stop-opacity="0.9"/><stop offset="1" stop-color="#FFF3C8" stop-opacity="0"/></radialGradient>
      <filter id="sf" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="10"/></filter>
    </defs>''')
    svg.raw(f'<rect width="{W}" height="{H}" fill="url(#sky)"/>')
    svg.raw(f'<circle cx="{pad+40}" cy="{pad}" r="150" fill="url(#sun)"/>')
    ground_y = H - pad
    svg.raw(f'<rect x="0" y="{ground_y}" width="{W}" height="{H-ground_y}" fill="#6FA34B"/>')
    svg.raw(f'<rect x="0" y="{ground_y}" width="{W}" height="70" fill="#C9C4BC"/>')
    svg.raw(f'<ellipse cx="{W/2}" cy="{ground_y+46}" rx="{tw*scale/2+60}" ry="34" '
            f'fill="#000" opacity="0.16" filter="url(#sf)"/>')
    xl = pad

    def fx(v): return xl + v * scale

    def gwin(x, y, w, h):
        svg.rect(x-3, y-3, w+6, h+6, "#e9e3d6", INK, 2)
        svg.rect(x, y, w, h, "url(#gl)", "#4d6f86", 1.5)
        svg.line(x+w/2, y, x+w/2, y+h, "#dfeaf1", 2)
        svg.line(x, y+h/2, x+w, y+h/2, "#dfeaf1", 2)
        svg.raw(f'<polygon points="{x+5},{y+h-5} {x+w*0.42},{y+5} {x+w*0.6},{y+5} {x+7},{y+h-5}" '
                f'fill="#fff" opacity="0.28"/>')

    y = ground_y
    for f in spec.floors:
        fh = f.height * scale
        top = y - fh
        x0, x1 = fx(f.fx), fx(f.fx + f.fw)
        # base plaster
        svg.rect(x0, top, x1-x0, fh, "url(#pl)", INK, 2.2)
        # open bay -> recessed dark
        for ob in f.open_bays:
            if ob.wall == "front":
                svg.rect(fx(ob.start), top, ob.length*scale, fh, "#5f574b", "none")
        # cladding
        cl = f.cladding
        if cl and cl.get("wall") == "front":
            svg.rect(fx(cl["start"]), top, cl["length"]*scale, fh, "url(#tk)", INK, 2)
            for i in range(1, int(cl["length"]*scale//26)):
                svg.line(fx(cl["start"])+i*26, top, fx(cl["start"])+i*26, top+fh, "#6d3c14", 1)
        # slab band
        svg.rect(x0-10, top-12, (x1-x0)+20, 14, "#efe9dd", INK, 2)
        # openings
        for op in f.openings:
            if op.wall != "front":
                continue
            wpx, hpx = op.width*scale, op.height*scale
            ox = fx(op.pos) - wpx/2 + op.width*scale/2
            ox = fx(op.pos)
            oy = y - (op.sill+op.height)*scale
            if op.kind == "door":
                svg.rect(ox-wpx/2, oy, wpx, hpx, "url(#tk)" if op.tag=="MD" and f.level==0 else "url(#gl)", INK, 2)
            else:
                gwin(ox-wpx/2, oy, wpx, hpx)
        # balconies
        for b in f.balconies:
            if b.wall != "front":
                continue
            bx0, bx1 = fx(b.start)-10, fx(b.start+b.length)+10
            rail = y - b.rail_height*scale
            svg.rect(bx0, y, bx1-bx0, 14, "#e7e0d2", INK, 2)
            svg.rect(bx0, rail, bx1-bx0, y-rail, "url(#rg)", "#8f9aa1", 1.5)
            svg.rect(bx0, rail-7, bx1-bx0, 7, "#b8c0c6", "#8f9aa1", 1)
            for i in range(int((bx1-bx0)//60)+1):
                svg.line(bx0+i*60, rail-7, bx0+i*60, y, "#aeb6bd", 2)
        y = top
    # roof parapet
    tf = spec.floors[-1]
    svg.rect(fx(tf.fx)-10, y-spec.parapet*scale, tf.fw*scale+20, spec.parapet*scale,
             "url(#plsh)", INK, 2)
    svg.rect(fx(tf.fx)-14, y-spec.parapet*scale-10, tf.fw*scale+28, 12, "#efe9dd", INK, 2)
    # plinth + ground
    svg.rect(fx(0)-14, ground_y-scale, tw*scale+28, scale, "#9a9184", INK, 2)
    svg.line(0, ground_y, W, ground_y, "#8f8a80", 2)
    # a tree
    tx = pad*0.55
    svg.raw(f'<rect x="{tx-8}" y="{ground_y-110}" width="16" height="110" fill="#6b4a2b"/>')
    svg.raw(f'<g fill="#357a2f"><circle cx="{tx}" cy="{ground_y-170}" r="70"/>'
            f'<circle cx="{tx-48}" cy="{ground_y-135}" r="48"/><circle cx="{tx+48}" cy="{ground_y-138}" r="50"/></g>')
    return svg.done()


# --------------------------------------------------------------------------
def generate_all(spec: BuildingSpec) -> dict:
    return {
        "front": front_or_rear(spec, rear=False),
        "rear": front_or_rear(spec, rear=True),
        "left": side(spec, right=False),
        "right": side(spec, right=True),
        "top": top(spec),
        "elevation": elevation(spec),
    }
