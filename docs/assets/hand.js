/* AirMouse stage — a hand we BUILD, not a scan. A real little rig: a domed,
   tapered palm, four three-bone fingers and an opposed three-bone thumb, every
   segment parented to its own joint group, so rotating a joint carries
   everything downstream. Under it, the 21-landmark MediaPipe overlay: the dots
   are children of the rig's joints, so they are anatomically exact by
   construction and track every pose.

   It follows the cursor with spring lag (plus a per-finger secondary sway) and
   on click / Enter it PINCHES for real — the index curls, the thumb swings up
   and across, and the two pads meet. Same gesture AirMouse clicks with. The
   thumb's pinch angles aren't eyeballed: initPinch() solves them against the
   actual rig at build time, measuring the SURFACE gap between the two distal
   phalanges, so the pads touch instead of interpenetrating.

   Geometry is generated here (lofted superellipse palm, tangent-hull tapered
   limbs), so there is no GLB and no scan. The SKIN is three 256px tileable maps
   (albedo / tangent-space normal / roughness, 66KB total) synthesised by
   tools/make_skin_maps.py from skin's real micro-relief — a cellular furrow
   network with a statistically flat mean, so no tile can line up with its
   neighbour into a plaid. They drive a MeshPhysicalMaterial under a PMREM
   environment built from the room photo's MEASURED values, with the beam, the
   wall tube and the floor in their real directions. Everything is loaded from
   inside this module, which site.js lazy-imports, so none of it can block first
   paint. Vendored, tree-shaken three bundle (no CDN). */
import * as THREE from './vendor/three-slim.min.js';

const DEG = Math.PI / 180;
const EASE_OUT = (t) => 1 - Math.pow(1 - t, 3);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);

/* ==========================================================================
   Anatomy. One unit = 4 cm. Origin = wrist crease, +Y up the fingers,
   +Z out of the palm toward the viewer.

   CHIRALITY: this is a RIGHT hand shown palm-first. Hold your own right hand up
   with the fingers pointing up and the palm toward you — the thumb is on the
   side AWAY from your body's midline, i.e. on the viewer's right. So the thumb
   lives on +X and the pinky on -X. (Get this backwards and you have painted a
   left hand demonstrating a right-handed-mouse metaphor.)

   Phalanx lengths are the standard adult averages (mm/40) — Buryanov & Kotiuk —
   which is what makes middle > ring > index > pinky read correctly without
   guesswork. The MCP row follows the metacarpal arch, which descends
   monotonically from the middle: index sits just above ring, never below it.
   ========================================================================== */
const FINGERS = [
  /* mcp: knuckle position · splay: rest abduction (rz) · L: proximal/middle/
     distal lengths · R: radii at MCP, PIP, DIP, tip · rest/pinch: joint flex */
  { mcp: [0.75, 2.44, 0.05], splay: -0.070, dSplay: -0.130,
    L: [1.00, 0.56, 0.40], R: [0.250, 0.230, 0.208, 0.136],
    rest: [0.09, 0.16, 0.10], pinch: [0.78, 0.95, 0.30], lag: 1.00 },
  { mcp: [0.25, 2.45, 0.00], splay: -0.012, dSplay: 0.000,
    L: [1.12, 0.66, 0.44], R: [0.256, 0.236, 0.214, 0.139],
    rest: [0.08, 0.15, 0.10], pinch: [0.22, 0.32, 0.16], lag: 1.15 },
  { mcp: [-0.25, 2.34, -0.05], splay: 0.052, dSplay: 0.020,
    L: [1.04, 0.64, 0.44], R: [0.242, 0.222, 0.200, 0.133],
    rest: [0.12, 0.21, 0.13], pinch: [0.26, 0.38, 0.18], lag: 1.32 },
  { mcp: [-0.70, 2.18, -0.11], splay: 0.130, dSplay: 0.040,
    L: [0.82, 0.45, 0.40], R: [0.212, 0.194, 0.176, 0.121],
    rest: [0.15, 0.24, 0.14], pinch: [0.32, 0.46, 0.20], lag: 1.5 }
];
/* Thumb. Three nested rotations, because a thumb really does have three:
     opp    — yaw out of the palm plane at the CMC (the metacarpal axis ends up
              32° in front of the palm, which is what "opposed" means)
     pron   — AXIAL twist about the thumb's own long axis. Without this the pad
              can only ever face sideways, the landmark dots end up on the flank
              where the mesh slices them, and a pinch has nothing to meet with.
              It also aims the MCP/IP flexion axis: near neutral, flexing the
              thumb curves it back toward the palm (right), and at 0.4 rad it
              curls it straight at the camera (wrong — a stiff foreshortened rod).
     swing  — abduction in that tilted plane; 0.96 rad puts the metacarpal 48°
              off the index, the relaxed-open-hand angle.
   The CMC itself sits LOW and RADIAL — the thumb leaves the side of the wrist,
   not the middle of the palm. */
const THUMB = {
  cmc: [0.68, 0.62, 0.12],
  opp: -0.68, pron: 0.10, swing: -0.96, mcp: 0.30, ip: 0.28,
  L: [1.10, 0.76, 0.52], R: [0.320, 0.285, 0.255, 0.190]
};
/* A child phalanx starts a little WIDER than its parent's tip radius, so the
   joint swells past the parent's tangent cone into a knuckle instead of
   matching it exactly (which gives a C0-but-not-C1 crease ring at every joint).
   The shaft between knuckles is thinned by limb()'s waist. */
const KNUCKLE = 1.10;
const HAND_H = 4.95;    // wrist → middle fingertip (+ dot), for frame fitting
const HAND_W = 3.30;    // thumb tip → pinky edge
const PIVOT_Y = 1.45;   // the rig hangs from its palm centre, so it rotates there

/* ---------------------------- geometry helpers ---------------------------- */

/* keyframed scalar curve: [[u,v],…] read with smoothstep between keys */
function curve(tab, u) {
  if (u <= tab[0][0]) return tab[0][1];
  for (let i = 1; i < tab.length; i++) {
    if (u <= tab[i][0]) {
      const t = (u - tab[i - 1][0]) / (tab[i][0] - tab[i - 1][0]);
      return lerp(tab[i - 1][1], tab[i][1], smooth(t));
    }
  }
  return tab[tab.length - 1][1];
}

const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/* loft(rows) — rows of ring vertices bottom-to-top into one indexed, smooth
   surface. A row of length 1 is a pole and gets fanned. Winding is CCW out.

   Two passes, because the skin maps want a seam-free UV *and* the shading has to
   stay continuous around the limb:

   · pass 1 welds the rings (the last column shares vertices with the first) and
     computes the vertex normals there, so nothing shades differently at the
     wrap.
   · pass 2 re-emits the rings with that first column duplicated at the far end,
     carrying pass 1's normal, so U can climb to the ring's real circumference
     instead of snapping back to 0 inside one quad — which is what a welded ring
     does, and it squeezes a whole tile of pores into a stripe down the +X side.

   UVs are in OBJECT UNITS (1 unit = 4 cm): U is arc length around the ring, V is
   arc length up the profile. Deliberately NOT normalised per part — a single
   texture.repeat then puts the same pore size on a fingertip, a knuckle and the
   heel of the palm, instead of ballooning the pores on the big pieces. */
function loft(rows, tint) {
  const P = [], I = [], start = [];
  rows.forEach((r) => {
    start.push(P.length / 3);
    r.forEach((v) => P.push(v[0], v[1], v[2]));
  });
  for (let i = 0; i < rows.length - 1; i++) {
    const a = rows[i], b = rows[i + 1], sa = start[i], sb = start[i + 1];
    const n = Math.max(a.length, b.length);
    for (let j = 0; j < n; j++) {
      const k = (j + 1) % n;
      if (a.length === 1) I.push(sa, sb + j, sb + k);
      else if (b.length === 1) I.push(sa + j, sb, sa + k);
      else I.push(sa + j, sb + j, sb + k, sa + j, sb + k, sa + k);
    }
  }
  const weld = new THREE.BufferGeometry();
  weld.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  weld.setIndex(I);
  weld.computeVertexNormals();
  const WN = weld.attributes.normal.array;

  const P2 = [], N2 = [], UV = [], I2 = [], st = [], cnt = [];
  let prevV = null;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i], len = r.length, prev = rows[i - 1];
    const V = new Array(len);
    for (let j = 0; j < len; j++) {
      /* V accumulates per column up the profile; either end of a band can be a
         pole, in which case every column measures from that one point. */
      const k = !prev || prev.length === 1 || len === 1 ? 0 : j;
      V[j] = prev ? prevV[k] + dist3(r[j], prev[k]) : 0;
    }
    const m = len > 1 ? len + 1 : 1;      // +1 = the duplicated seam column
    st.push(P2.length / 3);
    cnt.push(m);
    for (let j = 0, u = 0; j < m; j++) {
      const q = j % len;
      if (j > 0) u += dist3(r[q], r[(j - 1) % len]);
      const s = (start[i] + q) * 3;
      P2.push(P[s], P[s + 1], P[s + 2]);
      N2.push(WN[s], WN[s + 1], WN[s + 2]);
      UV.push(u, V[q]);
    }
    prevV = V;
  }
  for (let i = 0; i < rows.length - 1; i++) {
    const ca = cnt[i], cb = cnt[i + 1], sa = st[i], sb = st[i + 1];
    if (ca === 1) for (let j = 0; j < cb - 1; j++) I2.push(sa, sb + j, sb + j + 1);
    else if (cb === 1) for (let j = 0; j < ca - 1; j++) I2.push(sa + j, sb, sa + j + 1);
    else {
      const n = Math.min(ca, cb) - 1;
      for (let j = 0; j < n; j++) {
        I2.push(sa + j, sb + j, sb + j + 1, sa + j, sb + j + 1, sa + j + 1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P2, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N2, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  g.setIndex(I2);
  return tint ? paint(g, tint) : g;
}

/* scaleUV — lift a stock geometry's normalised 0..1 UVs into the same
   object-unit space loft() emits, by handing it the surface's real arc lengths.
   Without this the one bought-in sphere in the hand would wear pores at its own
   private scale. */
function scaleUV(geo, su, sv) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return geo;
}

/* Per-vertex skin tint. The material has vertexColors on, so EVERY geometry it
   touches needs this attribute — a missing one would read as black. */
function paint(geo, fn) {
  const P = geo.attributes.position.array;
  const out = [];
  fn(P[0], P[1], P[2], out);
  const items = out.length >= 4 ? 4 : 3;   // a 4th component = alpha (wrist fade)
  const C = new Float32Array((P.length / 3) * items);
  for (let i = 0, o = 0; i < P.length; i += 3, o += items) {
    out.length = 0;
    fn(P[i], P[i + 1], P[i + 2], out);
    for (let k = 0; k < items; k++) C[o + k] = out[k];
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(C, items));
  return geo;
}

/* Warm blood tint: knuckles and fingertips run redder than the rest. It used to
   top out at +4.5%/−7.5%/−10.5%, which the albedo map multiplies down and ACES
   then compresses into nothing — against a flat ground there was no flush at a
   single knuckle or tip. Roughly doubled, so the variation survives the whole
   chain and skin stops reading as one moulded plastic tone. */
function skinTint(red, out) {
  out[0] = 1 + 0.10 * red;
  out[1] = 1 - 0.17 * red;
  out[2] = 1 - 0.25 * red;
}

/* The tips are the reddest part of a hand, because light gets in through 3–4mm
   of pulp and comes back out red — and they are NOT the brightest, which is the
   giveaway a lamp-based fake always gets backwards. A directional light cannot
   express thickness, so this is baked into the vertex colours over the distal
   30% of each distal phalanx, where it lands on the pad no matter how the rig
   is posed and costs nothing at run time. */
function tipBlood(y, len, out) {
  const t = smooth(clamp((y / len - 0.70) / 0.30, 0, 1));
  out[0] *= 1 + 0.07 * t; out[1] *= 1 - 0.13 * t; out[2] *= 1 - 0.19 * t;
}

const gauss = (dx, dy, sx, sy) =>
  Math.exp(-(dx * dx) / (2 * sx * sx) - (dy * dy) / (2 * sy * sy));

/* The flexion creases on the palmar side of every finger joint — not one line
   but the two or three fine parallel ones a real knuckle wears, and only on the
   palmar crown (zn ramps them off toward the silhouette). This is the anatomy
   the tiling skin map cannot give us: a repeat map delivers periodic noise,
   never a crease that knows where the joint is. */
function creaseFinger(y, zn, len, out) {
  if (zn <= 0) return;
  const band = (d) => gauss(0, d, 1, 0.030) +
    0.62 * gauss(0, d - 0.078, 1, 0.026) + 0.62 * gauss(0, d + 0.078, 1, 0.026);
  const k = 1 - 0.14 * zn * Math.min(1.4, band(y) + band(y - len));
  out[0] *= k; out[1] *= k; out[2] *= k;
}

/* Fingerprint: three or four concentric whorls on the pad of a distal phalanx.
   Deliberately LOW frequency — the mesh resolves ~0.6mm per row and a real
   ridge is ~0.5mm, so anything finer would just alias into moiré. At 1x it
   reads as the faint tonal swirl a fingertip has; at 4x you can see the arcs. */
function padPrint(y, zn, len, out) {
  if (zn <= 0.15) return;
  const t = (y - len * 0.76) / (len * 0.40);
  const w = 0.5 + 0.5 * Math.cos(t * t * 7.5 * Math.PI);
  const k = 1 - 0.05 * zn * zn * w * Math.exp(-t * t * 1.1);
  out[0] *= k; out[1] *= k; out[2] *= k;
}

/* limb(r0, r1, len) — the convex hull of a sphere r0 at y=0 and a sphere r1 at
   y=len (hemispherical joint ends joined by their common tangent cone), with an
   optional waist that thins the shaft between them. That waist is what makes a
   phalanx read as bone-and-flesh rather than as a lathe-turned dowel: the joints
   swell, the shaft doesn't. `pulp` then fattens the PALMAR side only, near the
   end of the segment, which is the soft pad a fingertip has and a dowel doesn't. */
function limb(r0, r1, len, o) {
  const seg = o.seg || 40, cap = o.cap || 11, lat = o.lat || 11;
  const sx = o.sx || 1, sz = o.sz || 1, waist = o.waist === undefined ? 0.16 : o.waist;
  const pulp = o.pulp || 0;
  const th0 = Math.asin(clamp((r0 - r1) / len, -0.96, 0.96));
  const prof = [];
  for (let i = 0; i <= cap; i++) {
    const a = -Math.PI / 2 + (th0 + Math.PI / 2) * (i / cap);
    prof.push([Math.cos(a) * r0, Math.sin(a) * r0]);
  }
  const a0 = [Math.cos(th0) * r0, Math.sin(th0) * r0];
  const a1 = [Math.cos(th0) * r1, len + Math.sin(th0) * r1];
  for (let i = 1; i < lat; i++) {
    const t = i / lat;
    prof.push([lerp(a0[0], a1[0], t) * (1 - waist * Math.sin(Math.PI * t)),
               lerp(a0[1], a1[1], t)]);
  }
  for (let i = 0; i <= cap; i++) {
    const a = th0 + (Math.PI / 2 - th0) * (i / cap);
    prof.push([Math.cos(a) * r1, len + Math.sin(a) * r1]);
  }
  const rows = prof.map((p) => {
    if (p[0] < 1e-5) return [[0, p[1], 0]];
    /* the pad swell varies smoothly with the angle around the ring (full on the
       palmar crown, nothing on the back), so it never creases the silhouette */
    const swell = pulp ? pulp * gauss(0, p[1] / len - 0.72, 1, 0.26) : 0;
    const ring = [];
    for (let j = 0; j < seg; j++) {
      const u = (j / seg) * Math.PI * 2;
      const s = Math.sin(u);
      ring.push([p[0] * Math.cos(u) * sx, p[1],
                 p[0] * s * sz * (1 + swell * (0.5 + 0.5 * s))]);
    }
    return ring;
  });
  return loft(rows, o.tint);
}

/* Distance from (x,y) to a polyline — used to paint AND to dent the palmar
   creases. Baked into the loft and into vertex colours, so the palm reads as
   skin that has creased a thousand times instead of a moulded shell, and it
   costs nothing at run time. */
function creaseFalloff(x, y, pts, w) {
  let best = 1e9;
  for (let i = 1; i < pts.length; i++) {
    const ax = pts[i - 1][0], ay = pts[i - 1][1];
    const bx = pts[i][0], by = pts[i][1];
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 ? clamp(((x - ax) * dx + (y - ay) * dy) / l2, 0, 1) : 0;
    const ex = x - (ax + dx * t), ey = y - (ay + dy * t);
    const d = ex * ex + ey * ey;
    if (d < best) best = d;
  }
  return Math.exp(-best / (w * w));
}
/* Right palm. The distal transverse crease runs under the fingers; the proximal
   transverse and the thenar crease MEET at the radial edge, the way they do on
   a real palm, instead of running past each other in parallel. */
const CREASES = [
  [[-0.86, 1.86], [-0.30, 2.06], [0.30, 2.10], [0.66, 2.00]],
  [[-0.80, 1.50], [-0.10, 1.70], [0.52, 1.82], [0.80, 1.82]],
  [[0.80, 1.82], [0.66, 1.30], [0.46, 0.80], [0.20, 0.34], [-0.02, 0.14]]
];
const CRW = 0.070;                  // 2.8mm — a crease is a line, not a smudge

/* The palm: a lofted superellipse slab — narrow at the wrist, widest across the
   knuckles, thicker through the heel, domed on the back and gently cupped on
   the palm side. Its distal edge follows the knuckle arc (middle highest,
   pinky lowest), so the finger roots emerge out of the form, not off a lid. */
function palmGeometry() {
  const seg = 72, N = 64, Y0 = -0.42, Y1 = 2.60;
  const W = [[0, 0.0], [0.06, 0.44], [0.15, 0.62], [0.3, 0.72], [0.5, 0.82],
             [0.7, 0.90], [0.86, 0.98], [1, 1.00]];
  const DF = [[0, 0.16], [0.18, 0.27], [0.44, 0.30], [0.72, 0.27], [1, 0.225]];
  const DB = [[0, 0.16], [0.18, 0.26], [0.44, 0.29], [0.72, 0.24], [1, 0.195]];
  /* Superellipse exponent: 2 is a plain ellipse, higher is more slab-like. Kept
     LOW on purpose — past ~2.6 the palm grows a flat side wall, and that wall
     faces away from the key, so it reads as a hard dark outline down the ulnar
     edge instead of a form turning away. */
  const NE = [[0, 2.0], [0.5, 2.25], [1, 2.5]];
  const CUP = [[0, 0], [0.3, 0.05], [0.6, 0.085], [0.88, 0.035], [1, 0]];
  const CB = 0.10, CT = 0.10;      // rounded cap ramps at both ends
  const rows = [];
  for (let i = 0; i <= N; i++) {
    /* Rows are packed into the two rounded ends instead of spread evenly: the
       curvature — and therefore the faceting — is all at the heel dome and the
       distal roll-off, and an even spread put only four rows in the edge that
       is most looked at. This puts ~14 there. */
    const q = i / N;
    const u = clamp(q - 0.70 * Math.sin(2 * Math.PI * q) / (2 * Math.PI), 0, 1);
    const y0 = Y0 + (Y1 - Y0) * u;
    let w = curve(W, u), df = curve(DF, u), db = curve(DB, u);
    const ne = curve(NE, u), cup = curve(CUP, u);
    if (u < CB) {                  /* heel: dome it down to a pole */
      const f = Math.sqrt(Math.max(0, 1 - Math.pow(1 - u / CB, 2)));
      w *= f; df *= 0.3 + 0.7 * f; db *= 0.3 + 0.7 * f;
    } else if (u > 1 - CT) {       /* distal edge: roll the thickness off */
      const f = Math.sqrt(Math.max(0, 1 - Math.pow((u - (1 - CT)) / CT, 2)));
      w *= 0.93 + 0.07 * f; df *= 0.5 + 0.5 * f; db *= 0.5 + 0.5 * f;
    }
    if (w < 1e-3) { rows.push([[0, y0, 0]]); continue; }
    /* The thumb-side (thenar) and pinky-side edges bulge over the muscle mounds.
       The thenar carries a second, higher swell over the first web space, so the
       palm's own silhouette reaches toward the thumb instead of ending in a
       cliff that a bolted-on ellipsoid then has to bridge. */
    const wT = w * (1 + 0.16 * gauss(0, y0 - 0.95, 1, 0.66)
                      + 0.11 * gauss(0, y0 - 1.60, 1, 0.44));
    const wP = w * (1 + 0.08 * gauss(0, y0 - 0.85, 1, 0.62));
    const ring = [];
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a), p = 2 / ne;
      const ex = Math.sign(c) * Math.pow(Math.abs(c), p);
      const ez = Math.sign(s) * Math.pow(Math.abs(s), p);
      const x = (ex < 0 ? wP : wT) * ex;
      let z = (ez >= 0 ? df : db) * ez;
      if (ez > 0) {
        /* The palm's own relief, folded into this surface instead of pasted on
           as separate spheres: thenar mound at the thumb's base, hypothenar
           ridge down the pinky edge, a pad under each knuckle, and the hollow
           through the middle. One skin, no intersection seams. */
        let bump = 0.20 * gauss(x - 0.50, y0 - 0.98, 0.34, 0.62)
                 + 0.10 * gauss(x + 0.66, y0 - 0.82, 0.26, 0.58);
        for (let f = 0; f < FINGERS.length; f++) {
          bump += 0.075 * gauss(x - FINGERS[f].mcp[0], y0 - 2.16, 0.24, 0.34);
        }
        /* the creases are cut into the FORM, not just darkened in the vertex
           colours — a crease changes where the light turns, which is why a
           painted-only one still reads as a smudge under a hard key */
        const cut = 0.030 * creaseFalloff(x, y0, CREASES[0], CRW)
                  + 0.026 * creaseFalloff(x, y0, CREASES[1], CRW)
                  + 0.024 * creaseFalloff(x, y0, CREASES[2], CRW + 0.01);
        z += (bump - cut - cup * (1 - ex * ex)) * ez;
      }
      /* knuckle arc: the distal edge peaks under the middle knuckle and falls
         away to both sides — hardest toward the pinky, exactly like the real
         metacarpal arch — and rises again between the fingers, which is the
         web of skin that keeps the roots from looking like rods in a slab. */
      let arc = 0.04 - 0.26 * Math.pow((x - 0.20) / 0.98, 2) * (1 + 0.32 * Math.max(0, -x));
      arc += 0.24 * (gauss(x - 0.50, 0, 0.26, 1) + gauss(x, 0, 0.26, 1)) +
             0.24 * gauss(x + 0.475, 0, 0.26, 1);
      ring.push([x, y0 + arc * smooth(clamp((u - 0.40) / 0.60, 0, 1)), z]);
    }
    rows.push(ring);
  }
  /* Close the distal edge with a rounded cap — four shrinking rows following a
     quarter ellipse — instead of one triangle fan to a centroid, which is a
     faceted cone lid on the most-looked-at silhouette in the frame. */
  const top = rows[rows.length - 1];
  let cx = 0, cy = 0, cz = 0;
  top.forEach((v) => { cx += v[0]; cy += v[1]; cz += v[2]; });
  cx /= top.length; cy /= top.length; cz /= top.length;
  const CN = 5, CAP_H = 0.085;
  for (let i = 1; i <= CN; i++) {
    const a = (i / CN) * Math.PI / 2;
    const k = Math.cos(a), h = Math.sin(a) * CAP_H;
    if (i === CN) { rows.push([[cx, cy + h, cz]]); break; }
    rows.push(top.map((v) => [cx + (v[0] - cx) * k,
                              cy + (v[1] - cy) * k + h,
                              cz + (v[2] - cz) * k]));
  }
  return loft(rows, (x, y, z, out) => {
    /* redder in the heel and across the finger-root pads, palest mid-palm —
       ramped over a long span so it never shows as a band */
    const heel = smooth(clamp((0.55 - y) / 1.1, 0, 1));
    const front = z > 0.02 ? 1 : 0.25;
    const pads = smooth(clamp((y - 1.5) / 1.0, 0, 1)) * front;
    skinTint(Math.min(1, heel * 0.45 + pads * 0.5), out);
    /* creases + fold occlusion, front of the palm only */
    let ao = 0.22 * creaseFalloff(x, y, CREASES[0], CRW)
           + 0.18 * creaseFalloff(x, y, CREASES[1], CRW)
           + 0.20 * creaseFalloff(x, y, CREASES[2], CRW + 0.01)
           + 0.07 * gauss(x - 0.05, y - 1.55, 0.6, 0.55);
    /* the notch between each pair of finger roots sits in its own shade */
    ao += 0.13 * (gauss(x - 0.50, y - 2.46, 0.10, 0.26) +
                  gauss(x, y - 2.54, 0.10, 0.26) +
                  gauss(x + 0.475, y - 2.40, 0.11, 0.26));
    const k = 1 - Math.min(0.42, ao) * front;
    out[0] *= k; out[1] *= k; out[2] *= k;
  });
}

/* ========================================================================== */

export function initHand(target, opts = {}) {
  const statik = !!opts.statik;
  const room = !!opts.room;   // homepage room: transparent canvas over the photo
  const host = target;
  const sizeEl = target;

  const rect = sizeEl.getBoundingClientRect();
  let W = Math.max(rect.width, 200);
  let H = Math.max(rect.height, 200);

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: 'low-power'
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(W, H, false);
  /* filmic response: keeps the key light's highlights on skin from clipping to
     paper white, which is most of what separates "premium" from "plastic toy". */
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  /* The whole fiction is ONE narrow beam, and a beam with nothing occluding it
     is just an ambient light with extra steps. The thumb has to land a shadow
     across the palm, the fingers have to shade each other, and the pinch has to
     have a contact shadow, or the hand reads as a layer pasted over the photo. */
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;   // PCFSoft is deprecated in r185
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.display = 'block';
  target.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const FOV = 34, CAM_D = 6.6, CAM_Y = 0.5;
  const camera = new THREE.PerspectiveCamera(FOV, W / H, 0.1, 40);
  camera.position.set(0, CAM_Y, CAM_D);
  camera.lookAt(0, CAM_Y, 0);

  /* ------------------------------- light ---------------------------------- */
  /* Every number here is measured off the plate rather than dialled by eye.
     What that photograph actually is: median luma 41, p95 125, and the single
     brightest surface in it is the pool the beam makes on the floor at #5E6D76
     (luma 108). The wall behind the hand is #3C6A89, the tube #6DAAC4, the
     beam haze #2B3B47 — every source in the room is blue-dominant, and there
     is no warm source anywhere (the shelf lamp corner samples #25211C).

     Two consequences drive the whole rig:

     1. The key TRAVELS. The camera housing sits at 22%/10% of the plate and the
        pool it makes lands at 55%/88%, moving away from the lens — so the beam
        rakes ACROSS the hand from the upper left and passes behind it. It is
        not allowed to face the hand. A key that faces the subject brightens
        both silhouettes and leaves the centre darkest, which is the signature
        of a ring light, and a ring light inside a beam photograph is the
        loudest composite tell there is. Raked, the pinky edge owns the light, a
        terminator runs down the palm, and the thumb side falls into the room.
     2. Nothing warm may be *added*. Skin's own albedo is warm (R/B = 1.32), so
        neutral and even mildly cool light still comes back off it warm. Warmth
        belongs in the albedo, never in a lamp this room does not contain. */
  const hemi = new THREE.HemisphereLight(
    room ? 0x7FA8CE : 0xA8C0E4, room ? 0x101A26 : 0x1A2340, room ? 0.22 : 0.16);
  scene.add(hemi);

  /* effective irradiance = intensity / distance^decay; at d≈8.1 and decay 1.4
     the divisor is ~18.8, so 180 lands ~9.6 — the key OWNS the lit side instead
     of topping up an ambient wash. */
  const key = new THREE.SpotLight(room ? 0xD6E6F5 : 0xEAF2FF,
    room ? 180 : 196, 0, 0.36, 0.5, 1.4);
  /* Raked hard, but it still has to LAND. Pushed behind the hand (z<0) the beam
     misses the one surface the shot is about: the palm faces +Z, so N·L went
     negative and the palm fell to the wall's own luminance — a dark carving in a
     lit room. From here N·L ≈ 0.31, i.e. 72° of incidence: the pinky edge still
     owns the light and a terminator still runs down toward the thumb, but the
     palm is lit by the beam instead of by leftovers. */
  key.position.set(-5.6, 5.2, 2.6);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.bias = -0.0015;
  key.shadow.normalBias = 0.022;
  key.shadow.radius = 3;
  key.shadow.camera.near = 3;
  key.shadow.camera.far = 18;
  scene.add(key);
  key.target.position.set(0.20, 1.00, 0.25);
  scene.add(key.target);

  /* Cool rim, further behind and above so it follows the beam's travel.
     Desaturated on purpose: a hard saturated cyan rim pinned to the silhouette
     is an outline stroke, not light wrapping a form. The velvety part of the
     edge comes from the material's sheen, which is silhouette-weighted by
     construction and much cheaper than winding this up. */
  const rim = new THREE.DirectionalLight(0xBFE6FF, room ? 3.4 : 2.4);
  rim.position.set(-4.6, 3.4, -4.2);
  scene.add(rim);

  /* The wall tube, camera-right and behind, sampled from the plate (#6DAAC4).
     Grazing from back-right it catches the thumb-side silhouette only — which
     is the edge the key can never reach — instead of washing the palm. */
  const kick = new THREE.DirectionalLight(room ? 0x6DAAC4 : 0x7FD8F5, room ? 1.9 : 1.2);
  kick.position.set(room ? 5.4 : 2.8, room ? 1.6 : -0.3, room ? -2.4 : 0.7);
  scene.add(kick);

  /* Bounce up off the beam's own floor pool, which the hand floats directly
     over — the brightest surface in the room, and cool-neutral (#5E6D76), not
     tungsten. This is the only thing keeping the shadow side off zero, so it is
     also what stops shadowed skin collapsing to a pure environment sample and
     going slate-teal.

     Its HUE is the whole shadow-side argument. Skin's albedo is warm (B/R 0.76),
     so a neutral fill returns warm skin — and with the key on the ulnar edge the
     radial side is fill-only, which measured B/R 0.63 against the lit side's
     0.77: the shadow warmer than the light, in a navy room. Backwards, and one
     of the loudest composite tells there is. So the fill carries the pool's real
     hue (#5E6D76, B/R 1.25) scaled up rather than washed to grey, which lands
     shadowed skin near 0.9 — a shade COOLER than the light, as the room says. */
  const bounce = new THREE.DirectionalLight(0xAEC9DA, room ? 0.95 : 0.7);
  bounce.position.set(0.8, -2.2, 2.6);
  scene.add(bounce);

  /* Fake subsurface. Real transmission costs a second render pass on a canvas
     that is already compositing over a photo, so the cheap stand-in is a deep
     red light from BEHIND and ABOVE: it reaches only the surfaces curving away
     from us, which on an upright hand is the far side of each fingertip. It
     used to sit below and behind, where the only thing it could reach was the
     underside of each joint — it painted an orange ring at every knuckle and
     nothing at all on the tips, which point up. The tips' own translucency is
     baked into the vertex colours instead (tipBlood), where it lands on the
     pad regardless of how the hand is turned. */
  const sub = new THREE.DirectionalLight(0xE0523A, room ? 1.5 : 1.3);
  sub.position.set(-1.4, 3.4, -3.6);
  scene.add(sub);

  if (!room) {
    /* the navy stage's own glow disc, behind the hand instead of a room */
    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(3.0, 48),
      new THREE.MeshBasicMaterial({ color: 0x1B2456, transparent: true, opacity: 0.62 })
    );
    glow.position.set(0.05, 0.5, -1.9);
    scene.add(glow);
  }

  /* ------------------------------- skin ---------------------------------- */
  /* Three layers stack into the final colour, and each one earns its place:
       map            — the photographic albedo (pores, fine wrinkle noise)
       vertexColors   — the baked anatomy: redder knuckles, palmar creases,
                        fingerprints, the wrist's alpha fade. Free at run time.
       color          — a warm tint that MULTIPLIES both. The albedo already is
                        a light skin tone, so this stays near-white with a peach
                        bias; a saturated tint here would double up and go clay.
     roughness/metalness are the map's multipliers: roughnessMap ships 0.42–0.72,
     which is damp skin, so `roughness: 1` keeps that range verbatim. */
  const skin = new THREE.MeshPhysicalMaterial({
    color: 0xFFE2D2,
    roughness: 1.0,
    metalness: 0.0,
    /* Sheen is the peach-fuzz layer: a wide, warm, retro-reflective lobe that
       only shows near the silhouette, which is where real skin goes velvety.
       Raised and roughened, because it is now doing the job the hard cyan rim
       used to do badly — a broad velvety falloff instead of a stripe.
       Clearcoat is the sweat film — barely there, and rough, because skin is
       damp, not wet. */
    sheen: 0.5,
    sheenRoughness: 0.8,
    sheenColor: 0xFFB79B,
    /* Clearcoat is the sweat film. Kept LOW and rough, and its colour comes
       from the environment — with a smeared photo behind it, this layer was the
       one adding a cyan specular on top of shadowed skin. A warm sheen under a
       cold coat is the fight that produced the slate band down the thumb. */
    clearcoat: 0.10,
    clearcoatRoughness: 0.62,
    /* The environment is now directional and measured, so it can be trusted
       with real weight — but not with the shadow side's entire colour, which is
       what pushed skin past its own hue into teal. */
    envMapIntensity: room ? 0.75 : 0.85,
    vertexColors: true
  });
  skin.normalScale.set(0.32, 0.32);
  skin.clearcoatNormalScale.set(0.5, 0.5);
  /* the forearm uses the same skin, but with a per-vertex alpha so it dissolves
     into the room's darkness instead of ending in a cut-off stump */
  const skinFade = new THREE.MeshPhysicalMaterial({
    color: skin.color, roughness: skin.roughness, metalness: 0,
    clearcoat: skin.clearcoat, clearcoatRoughness: skin.clearcoatRoughness,
    sheen: skin.sheen, sheenRoughness: skin.sheenRoughness,
    sheenColor: skin.sheenColor, envMapIntensity: skin.envMapIntensity,
    vertexColors: true, transparent: true
  });
  skinFade.normalScale.copy(skin.normalScale);
  const skins = [skin, skinFade];

  /* --------------------- skin maps + the room as IBL ----------------------- */
  /* This is where the hand stops being a shaded blob: 66KB of 256px tileable
     maps for the microsurface, plus a PMREM environment (built below) so the
     specular has something real to reflect. The maps were derived from a macro
     photograph of a palm, which is why the hand used to read as burlap — the
     only features in a palm macro are 20–40mm flexion creases, and tiled they
     line up tile-to-tile into a plaid no matter what repeat you choose. They
     are synthesised now, with nothing in the tile bigger than one 0.3mm skin
     cell and the mean flattened to under 1% block-to-block. */
  const IMG = new URL('./img/', import.meta.url);
  const loader = new THREE.TextureLoader();
  const ANISO = renderer.capabilities.getMaxAnisotropy();
  /* Tiles per object unit. 1 unit = 4cm, and loft() writes UVs in units, so this
     is a real-world pitch: 1.8 tiles/unit ≈ one tile per 22mm of skin, which
     lands one tile across ~56 CSS px at the homepage render size and puts the
     tile's 30 cells at roughly 2 device px each — grain, not pattern. It used
     to be 4.6, which put nine tiles across the palm; a tile you can count nine
     of is not a pore field, it is a woven glove. Anatomy (creases, prints,
     blood tone) comes from the vertex colours instead, where it is aperiodic
     and knows where the joints are. */
  const REPEAT = 1.8;
  const REPEAT_LO = 0.55;            // second, much coarser scale via the coat

  let waiting = 3;
  const maps = {};
  function mapDone(key2, tex) {
    maps[key2] = tex || null;
    if (--waiting) return;
    for (const m of skins) {
      m.map = maps.albedo;
      m.normalMap = maps.normal;
      m.roughnessMap = maps.rough;
      /* The coat carries the SAME normal at a third of the frequency. Two
         scales of undulation instead of one repeated one: the skin gets broad
         soft swells under the fine grain, which is what stops a tiling map from
         announcing its own tile. */
      if (maps.normal) {
        const lo = maps.normal.clone();
        lo.repeat.set(REPEAT_LO, REPEAT_LO);
        lo.needsUpdate = true;
        m.clearcoatNormalMap = lo;
      }
      m.needsUpdate = true;
    }
    render();
  }
  function loadMap(key2, file, srgb) {
    loader.load(new URL(file, IMG).href, (t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(REPEAT, REPEAT);
      t.anisotropy = ANISO;              // crisp pores at grazing angles
      /* colour data is sRGB-encoded; normals and roughness are raw numbers and
         must stay linear or the creases lighten and the gloss lifts */
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      mapDone(key2, t);
    }, undefined, () => mapDone(key2, null));
  }
  loadMap('albedo', 'skin-albedo.jpg', true);
  loadMap('normal', 'skin-normal.jpg', false);
  loadMap('rough', 'skin-rough.jpg', false);

  /* ------------------------- the room as an environment -------------------- */
  /* This used to hand airmouse-room.jpg to EquirectangularReflectionMapping.
     That mapping wants a 2:1 lat-long panorama; the plate is a 1.79:1
     rectilinear PHOTOGRAPH. Wrapped onto a sphere it smears the whole room
     across 360°, stretches the top and bottom rows into the poles, and puts the
     beam, the tube and the dark floor in arbitrary directions. The result was
     an undirected grey-blue haze that reflected nothing recognisable and — on
     surfaces facing a near-black patch of it — a cold specular that turned
     shadowed skin slate-teal, which is what the blade down the thumb was.

     So the environment is BUILT instead, from the same plate but measured: the
     sources go where they actually are, in the colours they actually sample.
     Costs no download at all, and now the specular has real information in it —
     kill the key and the hand still shows you where the room's lights are. */
  const SRGB = (hex) => {
    const f = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
    return [f(((hex >> 16) & 255) / 255), f(((hex >> 8) & 255) / 255), f((hex & 255) / 255)];
  };
  /* room values sampled off airmouse-room.jpg; navy values are the stage's own
     palette tokens (DESIGN.md navy + aqua) */
  const ENV = room
    ? { wall: SRGB(0x1A2430), ceil: SRGB(0x20303D), floor: SRGB(0x4C5B66),
        beam: SRGB(0xB9D2E6), neon: SRGB(0x6DAAC4), lamp: SRGB(0x8A6440) }
    : { wall: SRGB(0x151C42), ceil: SRGB(0x1B2456), floor: SRGB(0x0B0F26),
        beam: SRGB(0xD8E6FF), neon: SRGB(0x3FC8E8), lamp: SRGB(0x1B2456) };
  /* unit vectors toward each source, in the same world the lights live in */
  const D_BEAM = [-0.81, 0.57, -0.14];
  const D_NEON = [0.88, 0.22, -0.42];
  const D_LAMP = [-0.60, -0.52, 0.61];
  function roomEnv() {
    const dome = new THREE.SphereGeometry(12, 48, 32);
    const lobe = (nx, ny, nz, d, k) =>
      Math.pow(Math.max(0, nx * d[0] + ny * d[1] + nz * d[2]), k);
    paint(dome, (x, y, z, out) => {
      const n = 1 / Math.max(1e-6, Math.hypot(x, y, z));
      const nx = x * n, ny = y * n, nz = z * n;
      /* wall below the horizon rolls into the floor; ceiling lifts above it */
      const dn = smooth(clamp(-ny * 1.6, 0, 1));
      const up = smooth(clamp(ny * 1.3, 0, 1));
      const beam = lobe(nx, ny, nz, D_BEAM, 26);     // ~18° disc, the camera beam
      /* the tube is a vertical bar: wide in azimuth, tall in elevation */
      const az = Math.max(0, nx * D_NEON[0] + nz * D_NEON[2]) /
                 Math.max(1e-6, Math.hypot(nx, nz));
      const neon = Math.pow(az, 34) * Math.exp(-ny * ny * 2.2);
      const lamp = lobe(nx, ny, nz, D_LAMP, 10);
      for (let i = 0; i < 3; i++) {
        out[i] = lerp(lerp(ENV.wall[i], ENV.ceil[i], up), ENV.floor[i], dn)
               + ENV.beam[i] * beam + ENV.neon[i] * neon * 0.8
               + ENV.lamp[i] * lamp * 0.30;
      }
    });
    const s = new THREE.Scene();
    s.add(new THREE.Mesh(dome, new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.DoubleSide
    })));
    return s;
  }

  let booted = false;   // true once the first frame has been drawn
  function buildEnv() {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const rt = pmrem.fromScene(roomEnv(), 0, 0.1, 40);
    for (const m of skins) { m.envMap = rt.texture; m.needsUpdate = true; }
    pmrem.dispose();                     // the render target stays: it IS the env
    if (booted) render();
  }
  buildEnv();

  /* --------------------- landmark dots + skeleton ------------------------- */
  /* Every additive overlay on this canvas has to add RGB WITHOUT adding alpha.
     The canvas is alpha:true and three premultiplies, so plain AdditiveBlending
     also accumulates into the alpha channel; the browser then composites
     canvasRGB + (1-canvasA)*photo, which ATTENUATES the room photo underneath by
     as much as it adds — a cyan glow arrives as a flat grey haze. Keeping the
     RGB add and zeroing the alpha contribution is the whole fix. */
  const GLOW = {
    transparent: true, depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor
  };

  const aquaDot = new THREE.MeshBasicMaterial({ color: 0x37D6FF });
  const mintDot = new THREE.MeshBasicMaterial({ color: 0x26D9A3 });
  const dotGeo = {};

  /* A soft radial falloff, not a solid sphere. An additive sphere over bright
     skin clips to a flat disc with a hard rim — a printed decal. A gradient
     sprite fades out at its own edge, so it reads as light. */
  function haloTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    rg.addColorStop(0.00, 'rgba(255,255,255,0.86)');
    rg.addColorStop(0.30, 'rgba(255,255,255,0.46)');
    rg.addColorStop(0.62, 'rgba(255,255,255,0.13)');
    rg.addColorStop(1.00, 'rgba(255,255,255,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  const HALO_TEX = haloTexture();

  const landmarks = [];
  function landmark(parent, x, y, z, r, mat) {
    const k = r.toFixed(3);
    dotGeo[k] = dotGeo[k] || new THREE.SphereGeometry(r, 18, 14);
    const m = new THREE.Mesh(dotGeo[k], mat);
    m.position.set(x, y, z);
    /* depthTest off, or the halo loses: the dot centre sits ON the skin, so a
       camera-facing quad through it is co-planar with the surface all around it
       and gets z-rejected into nothing. Same reason the skeleton draws over the
       hand — this is a tracking OVERLAY, and it reads as one. */
    const halo = new THREE.Sprite(new THREE.SpriteMaterial(Object.assign({
      map: HALO_TEX, color: mat.color, opacity: 0.30, depthTest: false
    }, GLOW)));
    halo.renderOrder = 7;                 // under the skeleton, over the skin
    halo.userData.base = r * 6.2;
    halo.scale.setScalar(halo.userData.base);
    m.add(halo);
    m.userData.halo = halo;
    parent.add(m);
    landmarks.push(m);
    return m;
  }

  // landmarks[]: 0 wrist · 1-4 thumb · 5-8 index · 9-12 middle · 13-16 ring · 17-20 pinky
  const CONNS = [
    [0, 1], [1, 2], [2, 3], [3, 4],
    [0, 5], [5, 6], [6, 7], [7, 8],
    [5, 9], [9, 10], [10, 11], [11, 12],
    [9, 13], [13, 14], [14, 15], [15, 16],
    [13, 17], [17, 18], [18, 19], [19, 20],
    [0, 17]
  ];
  const skelGeo = new THREE.BufferGeometry();
  skelGeo.setAttribute('position',
    new THREE.Float32BufferAttribute(new Float32Array(CONNS.length * 6), 3));
  /* Drawn THROUGH the hand, not half-buried in it. The palm-interior connectors
     (0→1, 0→5, 0→17, 5→9) run in straight lines between dots that sit on a
     domed surface, so the middle of each line dives under the skin: depth-tested,
     they emerged from beneath the mesh and died in mid-palm — three or four
     white whiskers and a stub, which reads as broken vector art rather than an
     overlay. An instrumentation layer is either drawn or it isn't; this one is,
     consistently, which is also how MediaPipe's own visualiser draws it. Opacity
     comes down to 0.30 at the same time, because these lines reach past the
     silhouette and were spilling onto the wall behind the hand. */
  const skeleton = new THREE.LineSegments(skelGeo, new THREE.LineBasicMaterial(
    Object.assign({ color: 0x37D6FF, opacity: 0.30, depthTest: false }, GLOW)));
  skeleton.frustumCulled = false;
  skeleton.renderOrder = 8;
  scene.add(skeleton);

  const _va = new THREE.Vector3();
  function updateSkeleton() {
    scene.updateMatrixWorld(true);
    const pos = skelGeo.attributes.position;
    for (let i = 0; i < CONNS.length; i++) {
      landmarks[CONNS[i][0]].getWorldPosition(_va);
      pos.setXYZ(i * 2, _va.x, _va.y, _va.z);
      landmarks[CONNS[i][1]].getWorldPosition(_va);
      pos.setXYZ(i * 2 + 1, _va.x, _va.y, _va.z);
    }
    pos.needsUpdate = true;
  }

  /* Click ripple — it blooms FROM the pinch contact, and its one hard rule is
     that it must never cover it. A RingGeometry gave a hard-edged annulus that
     the finger meshes clipped into a razor-sharp white crescent sitting exactly
     on top of the two pads at the moment they met: the payoff of the entire
     interaction, hidden by its own feedback, reading as a chipped ring or a
     render glitch. This is a soft radial-alpha sprite instead — no terminating
     edge that can be clipped — held small, capped well under clipping, and
     pushed toward the camera so it FRAMES the contact from in front of it
     instead of lying across it. */
  function rippleTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const rg = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    rg.addColorStop(0.00, 'rgba(255,255,255,0)');
    rg.addColorStop(0.48, 'rgba(255,255,255,0)');
    rg.addColorStop(0.70, 'rgba(255,255,255,0.9)');
    rg.addColorStop(0.86, 'rgba(255,255,255,0.2)');
    rg.addColorStop(1.00, 'rgba(255,255,255,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  const ripple = new THREE.Sprite(new THREE.SpriteMaterial(Object.assign({
    map: rippleTexture(), color: 0x7FE8FF, opacity: 0, depthTest: false
  }, GLOW)));
  ripple.renderOrder = 9;
  scene.add(ripple);

  /* ============================== the rig =============================== */
  /* base pose: the room shows the palm square to the viewer; the navy stage
     angles it like a product shot. */
  const BASE = room
    ? { rx: 0.02, ry: -0.09, rz: -0.03, x: 0, y: 0 }
    : { rx: -0.06, ry: 0.24, rz: -0.05, x: -0.1, y: 0 };

  const hand = new THREE.Group();       // cursor spring + click nudge
  scene.add(hand);
  const wrap = new THREE.Group();       // frame fit: scale + palm-centre pivot
  hand.add(wrap);
  const wrist = new THREE.Group();      // root joint — breathing lives here
  wrap.add(wrist);

  /* everything made of skin both casts into the beam and receives what the
     rest of the hand throws back; the overlay (dots, halos, lines, ripple)
     stays out of the shadow pass entirely */
  function solid(mesh) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  const palm = solid(new THREE.Mesh(palmGeometry(), skin));
  wrist.add(palm);

  /* The one mass the palm loft can't carry, because it spans two chains: the
     first web space, the sail of skin between the thumb's metacarpal and the
     index. Big enough to actually close the gap — under-scaled, it left a hard
     black crevice down the thumb and the thumb read as a separate cut-out layer
     floating in front of the palm. */
  const pad = new THREE.SphereGeometry(1, 40, 28);
  /* the arc lengths of the ellipsoid it becomes once scaled below, so its pores
     match the palm's instead of running at the unit sphere's own scale */
  scaleUV(pad, 1.73, 1.29);
  paint(pad, (x, y, z, out) => skinTint(0.25, out));
  const web1 = solid(new THREE.Mesh(pad, skin));
  /* The gap it has to close is mostly in DEPTH, not across: the palm's radial
     edge sits at z≈0.05 and the thumb floats 25mm in front of it, so a sail
     lying in the palm plane just perches on top as a separate egg. This one is
     turned to lie ALONG that depth run — buried in the palm at one end, inside
     the thumb's metacarpal at the other, with only its outer curve showing. */
  web1.position.set(1.07, 1.40, 0.30);
  web1.scale.set(0.36, 0.52, 0.20);
  web1.rotation.set(0, -1.10, 0.19);
  wrist.add(web1);

  /* forearm: oval section, widening away from the wrist, alpha-faded so it
     dissolves into shadow rather than ending in an amputation. It does not cast
     — half of it is transparent, and a shadow map only sees depth. */
  const stump = new THREE.Mesh(
    limb(0.50, 0.62, 2.6, {
      seg: 40, cap: 9, sx: 1.30, sz: 0.68, waist: 0.04,
      tint: (x, y, z, out) => {
        const d = clamp(y / 2.2, 0, 1);            // 0 at the wrist, 1 far out
        skinTint(0.18 * (1 - d), out);
        const dark = 1 - 0.88 * smooth(clamp(d / 0.5, 0, 1));
        out[0] *= dark; out[1] *= dark; out[2] *= dark;
        out[3] = 1 - smooth(clamp((d - 0.1) / 0.42, 0, 1));
      }
    }),
    skinFade
  );
  stump.receiveShadow = true;
  stump.position.set(-0.02, 0.12, 0.0);
  stump.rotation.z = Math.PI;   // point it down; keeps +Z toward the viewer
  wrist.add(stump);

  landmark(wrist, 0.0, 0.16, 0.30, 0.088, mintDot);   // 0 · wrist

  /* ------------------------------- thumb --------------------------------- */
  /* Nested groups instead of one Euler triple, because a thumb really is three
     stacked rotations. thumbPron sits INSIDE the swing, so its axis is the
     thumb's own long axis — that is the one that turns the pad to face the
     fingers and the camera. Put it outside the swing and it just re-aims the
     thumb; the pad never rotates at all, which is how the pinch used to end up
     contacting flank-to-flank. */
  const thumbOpp = new THREE.Group();
  thumbOpp.position.set(THUMB.cmc[0], THUMB.cmc[1], THUMB.cmc[2]);
  thumbOpp.rotation.y = THUMB.opp;
  wrist.add(thumbOpp);
  const thumbSwing = new THREE.Group();
  thumbSwing.rotation.z = THUMB.swing;
  thumbOpp.add(thumbSwing);
  const thumbPron = new THREE.Group();
  thumbPron.rotation.y = THUMB.pron;
  thumbSwing.add(thumbPron);
  thumbPron.add(solid(new THREE.Mesh(limb(THUMB.R[0], THUMB.R[1], THUMB.L[0], {
    seg: 44, sx: 1.02, sz: 0.94,
    tint: (x, y, z, out) => {
      skinTint(0.3 * (1 - clamp(y / THUMB.L[0], 0, 1)), out);
      creaseFinger(y - THUMB.L[0], clamp(z / THUMB.R[1], 0, 1), THUMB.L[0], out);
    }
  }), skin)));

  const thumbMCP = new THREE.Group();
  thumbMCP.position.y = THUMB.L[0];
  thumbMCP.rotation.x = THUMB.mcp;
  thumbPron.add(thumbMCP);
  thumbMCP.add(solid(new THREE.Mesh(limb(THUMB.R[1] * KNUCKLE, THUMB.R[2], THUMB.L[1], {
    seg: 44, sx: 1.06, sz: 0.95,
    tint: (x, y, z, out) => {
      skinTint(0.26 * Math.abs(1 - 2 * clamp(y / THUMB.L[1], 0, 1)), out);
      creaseFinger(y, clamp(z / THUMB.R[2], 0, 1), THUMB.L[1], out);
    }
  }), skin)));

  const thumbIP = new THREE.Group();
  thumbIP.position.y = THUMB.L[1];
  thumbIP.rotation.x = THUMB.ip;
  thumbMCP.add(thumbIP);
  thumbIP.add(solid(new THREE.Mesh(limb(THUMB.R[2] * KNUCKLE, THUMB.R[3], THUMB.L[2], {
    seg: 44, sx: 1.10, sz: 1.02, pulp: 0.17,
    tint: (x, y, z, out) => {
      const zn = clamp(z / THUMB.R[3], 0, 1);
      skinTint(0.34 + 0.5 * clamp(y / THUMB.L[2], 0, 1), out);
      tipBlood(y, THUMB.L[2], out);
      creaseFinger(y, zn, THUMB.L[2], out);
      padPrint(y, zn, THUMB.L[2], out);
    }
  }), skin)));

  /* Dots ride the POST-pronation frame, so local +Z is the pad normal and they
     land on the pad facing the viewer instead of buried in the flank. And they
     sit a hair PROUD of the surface (≥1.0 × the local radius) — at 0.86 the
     sphere centre was inside the skin and the mesh sliced the dot into a
     teardrop from any angle but dead-on. */
  landmark(thumbPron, 0, 0.05, THUMB.R[0] * 0.98, 0.074, mintDot);            // 1 · CMC
  landmark(thumbMCP, 0, 0, THUMB.R[1] * KNUCKLE * 1.02, 0.07, mintDot);       // 2 · MCP
  landmark(thumbIP, 0, 0, THUMB.R[2] * KNUCKLE * 1.02, 0.066, mintDot);       // 3 · IP
  const thumbTip = landmark(thumbIP, 0, THUMB.L[2] * 0.80,
    lerp(THUMB.R[2] * KNUCKLE, THUMB.R[3], 0.80) * 1.14, 0.082, aquaDot);     // 4 · tip

  /* ------------------------------ fingers -------------------------------- */
  const fingers = FINGERS.map((F) => {
    const mcpJ = new THREE.Group();
    mcpJ.position.set(F.mcp[0], F.mcp[1], F.mcp[2]);
    mcpJ.rotation.z = F.splay;
    mcpJ.rotation.x = F.rest[0];
    wrist.add(mcpJ);
    mcpJ.add(solid(new THREE.Mesh(limb(F.R[0], F.R[1], F.L[0], {
      sx: 1.06, sz: 0.94,
      tint: (x, y, z, out) => {
        skinTint(0.42 * (1 - smooth(clamp(y / (F.L[0] * 0.5), 0, 1))), out);
        creaseFinger(y, clamp(z / F.R[1], 0, 1), F.L[0], out);
      }
    }), skin)));

    const pipJ = new THREE.Group();
    pipJ.position.y = F.L[0];
    pipJ.rotation.x = F.rest[1];
    mcpJ.add(pipJ);
    pipJ.add(solid(new THREE.Mesh(limb(F.R[1] * KNUCKLE, F.R[2], F.L[1], {
      sx: 1.06, sz: 0.94,
      tint: (x, y, z, out) => {
        const t = clamp(y / F.L[1], 0, 1);
        skinTint(0.4 * (1 - smooth(t)) + 0.3 * smooth(t), out);
        creaseFinger(y, clamp(z / F.R[2], 0, 1), F.L[1], out);
      }
    }), skin)));

    const dipJ = new THREE.Group();
    dipJ.position.y = F.L[1];
    dipJ.rotation.x = F.rest[2];
    pipJ.add(dipJ);
    /* the distal phalanx narrows toward the tip and then fattens on the palmar
       side into the pulp — an ogival fingertip, not a dowel with a lid */
    dipJ.add(solid(new THREE.Mesh(limb(F.R[2] * KNUCKLE, F.R[3], F.L[2], {
      sx: 1.10, sz: 1.02, pulp: 0.18,
      tint: (x, y, z, out) => {
        const zn = clamp(z / F.R[3], 0, 1);
        skinTint(0.34 + 0.5 * smooth(clamp(y / F.L[2], 0, 1)), out);
        tipBlood(y, F.L[2], out);
        creaseFinger(y, zn, F.L[2], out);
        padPrint(y, zn, F.L[2], out);
      }
    }), skin)));

    const lm = [
      landmark(mcpJ, 0, 0, F.R[0] * 0.94 + 0.15 - F.mcp[2], 0.07, mintDot),
      landmark(pipJ, 0, 0, F.R[1] * KNUCKLE * 0.96 + 0.02, 0.064, mintDot),
      landmark(dipJ, 0, 0, F.R[2] * KNUCKLE * 0.96 + 0.02, 0.059, mintDot),
      landmark(dipJ, 0, F.L[2] * 0.80,
        lerp(F.R[2] * KNUCKLE, F.R[3], 0.80) * 1.12, 0.078, aquaDot)
    ];
    return { F, mcpJ, pipJ, dipJ, tip: lm[3], sx: 0, sxv: 0, sy: 0, syv: 0 };
  });
  const index = fingers[0];

  /* --------------------- solve the pinch on the real rig ------------------ */
  /* The pinch angles are solved against the rig at build time, not eyeballed —
     retune the anatomy above and the thumb re-finds contact by itself.
     What is measured matters: driving the two fingertip LANDMARKS together
     drives them to COINCIDE, and landmarks live under the skin, so "coincide"
     meant ~15mm of interpenetration — the index disappeared into the thumb
     along a razor-sharp intersection curve. So this measures the real thing:
     the SURFACE gap between the two distal phalanges, each sampled as the
     tapered capsule limb() actually builds, over the pad half of the segment.
     Drive that to a hair of clearance and the pads touch. A second term keeps
     the thumb's contact BEHIND the index's in z, so the camera sees the index
     tip resting on the thumb instead of vanishing behind it.

     On the index angles: [0.78, 0.95, 0.30] is 45°/54°/17°, which is what the
     literature reports for a tip pinch and — with correct phalanx lengths and a
     thumb that reaches 95mm from a CMC 72mm away — is also the least curl that
     can physically reach the thumb at all. */
  const GAP_T = 0.012;                              // ≈0.5mm of clearance
  const CAP_A = { j: index.dipJ, len: FINGERS[0].L[2],
                  r0: FINGERS[0].R[2] * KNUCKLE, r1: FINGERS[0].R[3] };
  const CAP_B = { j: thumbIP, len: THUMB.L[2],
                  r0: THUMB.R[2] * KNUCKLE, r1: THUMB.R[3] };
  const RS = 1.06;                                  // mean of the limbs' sx/sz
  const PAD_N = 10;
  const ptsA = [], ptsB = [];
  function sampleCap(c, out) {
    for (let i = 0; i < PAD_N; i++) {
      const t = 0.50 + 0.54 * (i / (PAD_N - 1));
      const o = out[i] || (out[i] = { p: new THREE.Vector3(), r: 0 });
      o.p.set(0, c.len * t, 0).applyMatrix4(c.j.matrixWorld);
      o.r = lerp(c.r0, c.r1, Math.min(t, 1)) * RS;
    }
  }
  function padGap() {
    sampleCap(CAP_A, ptsA);
    sampleCap(CAP_B, ptsB);
    let best = 1e9, dz = 0;
    for (let i = 0; i < PAD_N; i++) {
      for (let j = 0; j < PAD_N; j++) {
        const d = ptsA[i].p.distanceTo(ptsB[j].p) - ptsA[i].r - ptsB[j].r;
        if (d < best) { best = d; dz = ptsA[i].p.z - ptsB[j].p.z; }
      }
    }
    return { gap: best, dz };
  }
  /* deltas from the rest pose, in radians */
  const TH_P = { opp: -0.30, pron: 0.0, swing: 0.42, mcp: 0.12, ip: 0.0 };
  function solvePinch() {
    scene.updateMatrixWorld(true);       // wrap.scale is still 1: fitFrame() is next
    const F = index.F;
    index.mcpJ.rotation.set(F.pinch[0], 0, F.splay + F.dSplay);
    index.pipJ.rotation.x = F.pinch[1];
    index.dipJ.rotation.x = F.pinch[2];
    index.mcpJ.updateWorldMatrix(false, true);

    const LIM = { opp: [-0.72, 0.25], pron: [-0.55, 0.85], swing: [-0.20, 0.76],
                  mcp: [-0.18, 0.85], ip: [-0.14, 0.80] };
    const keys = ['swing', 'opp', 'mcp', 'ip', 'pron'];
    const cost = () => {
      thumbOpp.rotation.y = THUMB.opp + TH_P.opp;
      thumbSwing.rotation.z = THUMB.swing + TH_P.swing;
      thumbPron.rotation.y = THUMB.pron + TH_P.pron;
      thumbMCP.rotation.x = THUMB.mcp + TH_P.mcp;
      thumbIP.rotation.x = THUMB.ip + TH_P.ip;
      thumbOpp.updateWorldMatrix(false, true);
      const g = padGap();
      return Math.abs(g.gap - GAP_T) * 10
        + Math.max(0, 0.04 - g.dz) * 1.6      // index in front of the thumb…
        + Math.max(0, g.dz - 0.34) * 1.6      // …but beside it, not behind it
        /* a feather-light pull toward a relaxed thumb, so the solver cannot
           wander into a contorted solution that happens to touch */
        + 0.010 * (Math.abs(TH_P.mcp) + Math.abs(TH_P.ip) +
                   Math.abs(TH_P.swing) + Math.abs(TH_P.pron))
        + 0.020 * Math.abs(TH_P.opp);
    };
    let best = cost();
    for (let step = 0.28; step > 0.004; step *= 0.55) {
      let moved = true;
      while (moved) {
        moved = false;
        for (const k of keys) {
          for (const dir of [1, -1]) {
            const old = TH_P[k];
            const next = clamp(old + dir * step, LIM[k][0], LIM[k][1]);
            if (next === old) continue;
            TH_P[k] = next;
            const c = cost();
            if (c < best - 1e-5) { best = c; moved = true; } else { TH_P[k] = old; }
          }
        }
      }
    }
    return padGap();
  }
  const fit = solvePinch();
  /* build-time assertion: if the anatomy is ever retuned past what the thumb
     can reach, say so out loud instead of shipping a pinch that misses */
  if (!(Math.abs(fit.gap - GAP_T) < 0.02)) {
    console.warn('[hand] pinch does not reach contact — surface gap',
      fit.gap.toFixed(3), 'units');
  }

  /* ------------------------- frame fit + posing --------------------------- */
  const TRAVEL_UP = room ? 0.26 : 0.3;
  let S = 1;
  function fitFrame() {
    const visH = 2 * CAM_D * Math.tan(FOV * 0.5 * DEG);
    const visW = visH * (W / H);
    S = Math.min(visH * (room ? 0.70 : 0.76) / HAND_H, visW * (room ? 0.62 : 0.72) / HAND_W);
    wrap.scale.setScalar(S);
    wrap.position.y = -PIVOT_Y * S;
    /* Hang the fingertips just inside the top edge, leaving room for the upward
       cursor travel; the forearm then runs off the bottom. The static frame sits
       a little lower: on narrow layouts the copy column's buttons overlap the
       top of this canvas, and fingertips must not tuck under one. */
    BASE.y = CAM_Y + visH * (statik ? 0.40 : 0.46) - (HAND_H - PIVOT_Y) * S - TRAVEL_UP;
    /* On a phone the room photo crops so that the beam is spent well above the
       hand — the hand sits in the dark bottom corner, over the rug. Lighting it
       with the desktop key makes it a bright cut-out in an unlit corner, so the
       key comes down and the room's own ambient comes up. */
    const narrow = room && window.innerWidth < 600;
    key.intensity = room ? (narrow ? 104 : 132) : 196;
    hemi.intensity = room ? (narrow ? 0.38 : 0.22) : 0.16;
    /* Exposure is set by the plate, not by taste. Skin used to sit at median
       179 against a photograph whose own p95 is 125 and whose brightest
       beam-lit floor reads 108 — the hand's MID tone was brighter than the
       brightest thing the beam could produce. 0.80 lands skin's median in the
       120s, i.e. lit by that beam rather than pasted over it. The navy stage is
       measured separately: its ground is far lighter, so it keeps its own. */
    renderer.toneMappingExposure = room ? (narrow ? 0.88 : 0.78) : 1.02;
  }
  fitFrame();

  const flashTips = [index.tip, thumbTip];  // the two dots the click lights up

  /* applyPose(t, pinch, idleAmp) — pinch runs 0 (open) → 1 (tips touching) and
     dips slightly negative on the springy release. */
  function applyPose(t, p, idleAmp) {
    const breathe = idleAmp * Math.sin(t * 0.85);
    wrist.rotation.x = breathe * 0.014;
    wrist.rotation.z = Math.sin(t * 0.62) * idleAmp * 0.012;
    for (let i = 0; i < fingers.length; i++) {
      const f = fingers[i], F = f.F;
      const b = breathe * 0.013 * (1 + i * 0.15);
      f.mcpJ.rotation.x = lerp(F.rest[0], F.pinch[0], p) + b + f.sy;
      f.pipJ.rotation.x = lerp(F.rest[1], F.pinch[1], p) + b * 1.5 + f.sy * 1.3;
      f.dipJ.rotation.x = lerp(F.rest[2], F.pinch[2], p) + b * 0.8;
      f.mcpJ.rotation.z = F.splay + F.dSplay * p + f.sx;
    }
    thumbOpp.rotation.y = THUMB.opp + TH_P.opp * p;
    thumbSwing.rotation.z = THUMB.swing + TH_P.swing * p;
    thumbPron.rotation.y = THUMB.pron + TH_P.pron * p;
    thumbMCP.rotation.x = THUMB.mcp + TH_P.mcp * p - breathe * 0.01;
    thumbIP.rotation.x = THUMB.ip + TH_P.ip * p;
    /* the whole hand leans a hair into the click, like a real press */
    const fl = Math.max(0, p);
    hand.position.z = fl * 0.1;
    /* The contact flash is deliberately small. Two halos stacked additively over
       pale skin clip to pure white across the exact 40px the click is meant to
       reveal, so past the halfway point the thumb's halo bows out and the
       index's carries the flash alone, capped well under clipping. */
    for (let i = 0; i < flashTips.length; i++) {
      const m = flashTips[i];
      m.scale.setScalar(1 + fl * 0.16);
      const halo = m.userData.halo;
      halo.scale.setScalar(halo.userData.base * (1 + fl * 0.45));
      const solo = i === 1 ? clamp(1 - (p - 0.45) / 0.28, 0, 1) : 1;
      halo.material.opacity = (0.30 + fl * 0.04) * solo;
    }
  }
  applyPose(0, 0, 0);

  function render() { updateSkeleton(); renderer.render(scene, camera); }

  /* set once the follow springs exist, so a resize re-bases them instead of
     fighting them (the fit changes where "rest" is) */
  let onRefit = null;
  let running = false, rafId = 0;
  function resize() {
    const r = sizeEl.getBoundingClientRect();
    if (r.width < 5 || r.height < 5) return;
    W = r.width; H = r.height;
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    renderer.setSize(W, H, false);
    const was = BASE.y;
    fitFrame();
    if (onRefit) onRefit(BASE.y - was);
    else hand.position.y = BASE.y;
    if (statik || !running) render();
  }
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(sizeEl);
  else window.addEventListener('resize', resize);

  hand.rotation.set(BASE.rx, BASE.ry, BASE.rz);
  hand.position.set(BASE.x, BASE.y, 0);

  /* ---------- static mode: one open-palm frame, no loop, no motion -------- */
  booted = true;
  if (statik) {
    render();
    return { statik: true };
  }

  /* ---------------------------- interactive ------------------------------- */
  const shadowEl = opts.shadowEl || null;
  const trackEl = host.closest('section') || host;
  const px = { c: BASE.x, v: 0, t: BASE.x };
  const py = { c: BASE.y, v: 0, t: BASE.y };
  onRefit = (dy) => { py.c += dy; py.t += dy; };

  trackEl.addEventListener('mousemove', (e) => {
    const r = sizeEl.getBoundingClientRect();
    const nx = (e.clientX - (r.left + r.width / 2)) / Math.max(r.width, 1);
    const ny = (e.clientY - (r.top + r.height / 2)) / Math.max(r.height, 1);
    /* travel stays well short of the edges: the hand must never clip, and in
       the room it also has to stay inside the beam's pool of light */
    const lim = room ? 0.44 : 0.6;
    px.t = clamp(nx * (room ? 1.0 : 1.4), -lim, lim);
    py.t = clamp(-ny * 1.05, room ? -0.24 : -0.32, TRAVEL_UP) + BASE.y;
  });
  trackEl.addEventListener('mouseleave', () => { px.t = BASE.x; py.t = BASE.y; });

  let tNow = 0, last = performance.now();
  /* the pinch envelope: snap closed, HOLD so the contact reads, then a damped
     spring back that opens a few percent past rest before settling */
  /* Weighted toward the HOLD. The closed pose is the one thing the copy
     promises out loud, and at 150ms of a 660ms pulse it was the hardest state
     in the animation to actually catch — three timed captures after a click
     landed on mid-curl and fully-open frames and never on contact. 320ms of
     hold is long enough to register without the gesture going slow. */
  const P_IN = 0.12, P_HOLD = 0.32, P_OUT = 0.34;
  const PULSE_DUR = P_IN + P_HOLD + P_OUT;
  const pinchAt = (dt) => {
    if (dt < P_IN) return EASE_OUT(dt / P_IN);
    if (dt < P_IN + P_HOLD) return 1;
    const u = (dt - P_IN - P_HOLD) / P_OUT;
    return (1 - u * u) * Math.exp(-2.2 * u) * Math.cos(u * 3.4);
  };
  let pulseStart = -1;
  let pinch = 0;                          // current envelope value, for retrigger
  let nextAuto = opts.autoPulse ? 1.2 : Infinity;
  /* A click inside the hold window used to be a silent no-op, so anyone who
     tested the demo the way people actually do — double-clicking — got one
     pinch out of two. Now every click restarts the envelope, but from wherever
     the hand currently IS: rewinding pulseStart to the point on the in-curve
     that matches the present value re-runs the hold without snapping the pose. */
  const triggerPulse = () => {
    pulseStart = tNow - (pinch > 0.02 && pinch < 1
      ? P_IN * (1 - Math.cbrt(1 - Math.min(pinch, 0.999)))
      : 0);
    if (opts.autoPulse) nextAuto = tNow + 4.6;
  };
  /* the copy column overlays part of the canvas, so listen on the whole
     section — a click anywhere on the scene (not on a link) still pinches */
  trackEl.addEventListener('pointerdown', triggerPulse);
  sizeEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); triggerPulse(); }
  });

  const _vb = new THREE.Vector3(), _vc = new THREE.Vector3();

  function frame() {
    rafId = requestAnimationFrame(frame);
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    tNow += dt;
    const t = tNow;
    if (t >= nextAuto) triggerPulse();

    // spring toward the cursor — dt-scaled so 60Hz and 120Hz+ feel identical
    const s = dt * 60;
    px.v = (px.v + (px.t - px.c) * 0.085 * s) * Math.pow(0.82, s);
    py.v = (py.v + (py.t - py.c) * 0.085 * s) * Math.pow(0.82, s);
    px.c += px.v * s; py.c += py.v * s;

    hand.position.x = px.c;
    hand.position.y = py.c + Math.sin(t * 1.1) * 0.045;
    hand.rotation.y = BASE.ry + px.c * 0.2 + px.v * 1.5;
    hand.rotation.x = BASE.rx - (py.c - BASE.y) * 0.14 - py.v * 1.1;
    hand.rotation.z = BASE.rz - px.v * 1.2;

    /* secondary motion: each finger lags the hand, the pinky loosest, so the
       whole thing has a little inertia instead of moving as one rigid prop */
    for (let i = 0; i < fingers.length; i++) {
      const f = fingers[i], k = 0.115 / f.F.lag;
      f.sxv = (f.sxv + (px.v * 1.5 * f.F.lag - f.sx) * k * s) * Math.pow(0.83, s);
      f.sx += f.sxv * s;
      f.syv = (f.syv + (py.v * 1.5 * f.F.lag - f.sy) * k * s) * Math.pow(0.83, s);
      f.sy += f.syv * s;
    }

    /* The CSS floor shadow tracks the hand's drift — two custom-property writes
       rather than a transform, because the shadow's own rotate/skew (it is a
       cast shadow raking down-beam, not a puddle under the wrist) lives in the
       stylesheet and a transform written here would overwrite it. */
    if (shadowEl) {
      shadowEl.style.setProperty('--drift', (px.c * 34).toFixed(1) + 'px');
      shadowEl.style.setProperty('--near', (1 + (py.c - BASE.y) * 0.16).toFixed(3));
    }

    pinch = 0;
    if (pulseStart >= 0) {
      const d = t - pulseStart;
      if (d >= PULSE_DUR) pulseStart = -1;
      else pinch = pinchAt(d);
    }
    applyPose(t, pinch, 1);

    // ripple feedback, blooming from the pinch contact itself
    if (pulseStart >= 0) {
      hand.updateMatrixWorld(true);
      index.tip.getWorldPosition(_vb);
      thumbTip.getWorldPosition(_vc);
      /* sit it a seventh of the way toward the lens: in front of the pads, so
         nothing about the contact can be occluded by the feedback */
      ripple.position.copy(_vb).add(_vc).multiplyScalar(0.5)
        .lerp(camera.position, 0.14);
      const p = (t - pulseStart) / PULSE_DUR;
      ripple.scale.setScalar(0.30 + EASE_OUT(Math.min(p, 1)) * 0.74);
      /* the fade lags the expansion so the ring stays readable through the
         middle of the pulse, not just its first frames */
      ripple.material.opacity = Math.max(0, 0.20 * Math.pow(1 - p, 1.3));
    } else {
      ripple.material.opacity = 0;
    }

    render();
  }

  function setRunning(on) {
    if (on === running) return;
    running = on;
    if (on) { last = performance.now(); frame(); }
    else cancelAnimationFrame(rafId);
  }

  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      entries.forEach((en) => setRunning(en.isIntersecting));
    }, { threshold: 0.05 }).observe(host);
  } else {
    setRunning(true);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) setRunning(false);
    else {
      const r = host.getBoundingClientRect();
      if (r.bottom > 0 && r.top < window.innerHeight) setRunning(true);
    }
  });

  render(); // first frame immediately, loop takes over when visible
  return { setRunning };
}
