// Parametric building generator: BuildingSpec + theme -> THREE.Group.
// Geometry comes entirely from the spec, so the 3D model matches the plan exactly.
// Coordinate mapping (feet -> world units, 1:1):
//   x : across the front, building centred  -> worldX(v) = v - tw/2
//   y : height (up)
//   z : depth, FRONT at +td/2, REAR at -td/2 -> worldZ(depth) = td/2 - depth

const T = 0.55; // wall thickness (ft)

export function buildBuilding(THREE, spec, theme) {
  const g = new THREE.Group();
  const tw = Math.max(...spec.floors.map((f) => f.fx + f.fw));
  const td = Math.max(...spec.floors.map((f) => f.fy + f.fd));
  const wx = (v) => v - tw / 2;
  const wz = (d) => td / 2 - d;

  const mat = (color, opts = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.02, ...opts });
  const M = {
    plaster: mat(theme.plaster, { roughness: 0.9 }),
    accent: mat(theme.accent, { roughness: 0.8 }),
    wood: mat(theme.wood, { roughness: 0.6 }),
    slab: mat(theme.slab, { roughness: 0.9 }),
    trim: mat(theme.trim, { roughness: 0.85 }),
    rail: mat(theme.rail, { roughness: 0.4, metalness: 0.6 }),
    frame: mat("#2a2c30", { roughness: 0.5, metalness: 0.3 }),
    glass: mat(theme.glass, { roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.55 }),
    railGlass: mat(theme.railGlass, { roughness: 0.1, transparent: true, opacity: 0.4 }),
    void: mat("#3a352f", { roughness: 1 }),
  };

  const box = (w, h, d, m, cx, cy, cz, cast = true) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(cx, cy, cz);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };

  // subtract open-bay spans from a full [a,b] span -> list of covered [s,e]
  const subtract = (a, b, bays) => {
    let segs = [[a, b]];
    for (const bay of bays) {
      const s = bay.start, e = bay.start + bay.length;
      const next = [];
      for (const [x0, x1] of segs) {
        if (e <= x0 || s >= x1) { next.push([x0, x1]); continue; }
        if (s > x0) next.push([x0, s]);
        if (e < x1) next.push([e, x1]);
      }
      segs = next;
    }
    return segs.filter(([x0, x1]) => x1 - x0 > 0.2);
  };

  // window/door as recessed frame + pane on a wall face
  const opening = (op, floor, front) => {
    const w = op.width, h = op.height;
    const cy = floor.y0 + op.sill + h / 2;
    if (op.wall === "front" || op.wall === "rear") {
      const cxx = wx(op.pos + w / 2);
      const zface = op.wall === "front" ? wz(0) : wz(td);
      const zoff = op.wall === "front" ? -0.12 : 0.12;
      box(w + 0.4, h + 0.4, 0.2, M.frame, cxx, cy, zface + (op.wall === "front" ? 0.02 : -0.02));
      box(w, h, 0.1, op.kind === "door" && op.tag === "MD" ? M.wood : M.glass,
          cxx, cy, zface + zoff * 0.4);
    } else {
      const czz = wz(op.pos + w / 2);
      const xface = op.wall === "left" ? wx(floor.fx) : wx(floor.fx + floor.fw);
      const xoff = op.wall === "left" ? 0.02 : -0.02;
      box(0.2, h + 0.4, w + 0.4, M.frame, xface + xoff, cy, czz);
      box(0.1, h, w, M.glass, xface + (op.wall === "left" ? 0.05 : -0.05), cy, czz);
    }
  };

  const railing = (x0, x1, y0, top, z, vertical = true) => {
    box(x1 - x0, 0.25, 0.5, M.rail, (x0 + x1) / 2, top, z);          // top rail
    if (vertical) {
      const n = Math.max(2, Math.round((x1 - x0) / 0.5));
      for (let i = 0; i <= n; i++) {
        const x = x0 + (i * (x1 - x0)) / n;
        box(0.12, top - y0, 0.12, M.rail, x, (y0 + top) / 2, z);
      }
    } else {
      for (let k = 1; k <= 3; k++) {
        const yy = y0 + (k * (top - y0)) / 4;
        box(x1 - x0, 0.1, 0.1, M.rail, (x0 + x1) / 2, yy, z);
      }
    }
  };

  // stack floor heights
  let base = 0;
  for (const f of spec.floors) { f.y0 = base; base += f.height; }

  for (const f of spec.floors) {
    const x0 = wx(f.fx), x1 = wx(f.fx + f.fw), mx = (x0 + x1) / 2;
    const zF = wz(f.fy), zR = wz(f.fy + f.fd), mz = (zF + zR) / 2;
    const h = f.height, y0 = f.y0, ymid = y0 + h / 2;

    // floor slab
    box(f.fw + 0.5, 0.5, f.fd + 0.5, M.slab, mx, y0 + 0.25, mz, false);

    const frontBays = (f.open_bays || []).filter((b) => b.wall === "front");
    // front wall segments (skip open bays -> see-through parking/terrace)
    for (const [s, e] of subtract(f.fx, f.fx + f.fw, frontBays)) {
      box(e - s, h, T, M.plaster, wx((s + e) / 2), ymid, zF - T / 2);
    }
    // rear + side walls (full)
    box(f.fw, h, T, M.plaster, mx, ymid, zR + T / 2);
    box(T, h, f.fd, M.plaster, x0 + T / 2, ymid, mz);
    box(T, h, f.fd, M.plaster, x1 - T / 2, ymid, mz);

    // columns inside front open bays (stilts / terrace edge posts)
    for (const bay of frontBays) {
      const stops = [bay.start, bay.start + bay.length];
      for (let p = bay.start + 11; p < bay.start + bay.length - 2; p += 11) stops.push(p);
      for (const p of stops) box(0.8, h, 0.8, M.plaster, wx(p), ymid, zF - 0.4);
      // low parapet along a front terrace bay (upper floors)
      if (f.level > 0) railing(wx(bay.start), wx(bay.start + bay.length), y0, y0 + 3, zF - 0.2, false);
    }

    // cladding accent panel on front
    if (f.cladding && f.cladding.wall === "front") {
      box(f.cladding.length, h - 0.4, 0.18, M.wood,
          wx(f.cladding.start + f.cladding.length / 2), ymid, zF + 0.06);
    }

    // openings
    for (const op of f.openings || []) opening(op, f, true);

    // balconies (front, projecting) + railing
    for (const b of (f.balconies || []).filter((b) => b.wall === "front")) {
      const bx0 = wx(b.start), bx1 = wx(b.start + b.length);
      const zEdge = zF + b.depth;
      box(b.length + 0.3, 0.45, b.depth, M.slab, (bx0 + bx1) / 2, y0 + 0.2, zF + b.depth / 2);
      // solid parapet lower + glass/steel rail above (matches reference)
      box(b.length + 0.3, 1.6, 0.25, M.accent, (bx0 + bx1) / 2, y0 + 1.0, zEdge);
      railing(bx0, bx1, y0 + 1.8, y0 + b.rail_height, zEdge, true);
      // teak strip on parapet face
      box(b.length * 0.35, 0.9, 0.08, M.wood, (bx0 + bx1) / 2, y0 + 1.0, zEdge + 0.16);
    }
  }

  // top floor: roof slab + perimeter parapet
  const tf = spec.floors[spec.floors.length - 1];
  const tx0 = wx(tf.fx), tx1 = wx(tf.fx + tf.fw);
  const tzF = wz(tf.fy), tzR = wz(tf.fy + tf.fd);
  box(tf.fw + 0.6, 0.5, tf.fd + 0.6, M.slab, (tx0 + tx1) / 2, base + 0.25, (tzF + tzR) / 2);
  const par = spec.parapet || 3;
  box(tf.fw + 0.6, par, 0.4, M.plaster, (tx0 + tx1) / 2, base + par / 2, tzF); // front parapet
  box(tf.fw + 0.6, par, 0.4, M.plaster, (tx0 + tx1) / 2, base + par / 2, tzR);
  box(0.4, par, tf.fd + 0.6, M.plaster, tx0, base + par / 2, (tzF + tzR) / 2);
  box(0.4, par, tf.fd + 0.6, M.plaster, tx1, base + par / 2, (tzF + tzR) / 2);

  g.userData.dims = { tw, td, height: base + par };
  return g;
}

// simple decorative gate + compound wall in front (reference cue)
export function buildCompound(THREE, spec, theme, group) {
  const tw = Math.max(...spec.floors.map((f) => f.fx + f.fw));
  const td = Math.max(...spec.floors.map((f) => f.fy + f.fd));
  const z = td / 2 + 6;
  const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, ...o });
  const wall = mat(theme.trim);
  const wood = mat(theme.wood, { roughness: 0.6 });
  const add = (w, h, d, m, x, y) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh);
  };
  add(tw + 4, 3, 0.6, wall, 0, 1.5);                 // low boundary wall
  add(8, 4.5, 0.5, wood, 0, 2.25);                   // gate leaf
}
