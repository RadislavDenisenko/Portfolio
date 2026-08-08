/* AirMouse stage — a hand we BUILD, not a scan. A real little rig: a domed,
   tapered palm, four three-bone fingers and an opposed three-bone thumb, every
   segment parented to its own joint group, so rotating a joint carries
   everything downstream. Under it, the 21-landmark MediaPipe overlay: the dots
   are children of the rig's joints, so they are anatomically exact by
   construction and track every pose.

   It follows the cursor with spring lag (plus a per-finger secondary sway) and
   on click / Enter it PINCHES for real — the index curls, the thumb rotates in,
   and the two fingertips meet. Same gesture AirMouse clicks with. The thumb's
   pinch angles aren't eyeballed: initPinch() solves them against the actual
   rig at build time, so the tips always touch.

   Geometry is generated here (lofted superellipse palm, tangent-hull tapered
   limbs), so there is no GLB, no loader and no texture to ship. Vendored,
   tree-shaken three bundle (no CDN). Lazy-imported by site.js. */
import * as THREE from './vendor/three-slim.min.js';

const DEG = Math.PI / 180;
const EASE_OUT = (t) => 1 - Math.pow(1 - t, 3);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);

/* ==========================================================================
   Anatomy. One unit = 4 cm. Origin = wrist crease, +Y up the fingers,
   +Z out of the palm toward the viewer. Right hand, so the thumb sits on -X.
   Phalanx lengths are the standard adult averages (mm/40), which is what makes
   middle > ring > index > pinky read correctly without guesswork.
   ========================================================================== */
const FINGERS = [
  /* mcp: knuckle position · splay: rest abduction (rz) · L: proximal/middle/
     distal lengths · R: radii at MCP, PIP, DIP, tip · rest/pinch: joint flex */
  { mcp: [-0.75, 2.30, 0.05], splay: 0.070, dSplay: 0.130,
    L: [1.00, 0.56, 0.40], R: [0.250, 0.230, 0.208, 0.155],
    rest: [0.10, 0.17, 0.10], pinch: [0.90, 1.30, 0.45], lag: 1.00 },
  { mcp: [-0.25, 2.45, 0.00], splay: 0.012, dSplay: 0.000,
    L: [1.12, 0.66, 0.44], R: [0.256, 0.236, 0.214, 0.158],
    rest: [0.08, 0.15, 0.10], pinch: [0.22, 0.32, 0.16], lag: 1.15 },
  { mcp: [0.25, 2.36, -0.05], splay: -0.052, dSplay: -0.020,
    L: [1.04, 0.64, 0.44], R: [0.242, 0.222, 0.200, 0.151],
    rest: [0.11, 0.19, 0.12], pinch: [0.26, 0.38, 0.18], lag: 1.32 },
  { mcp: [0.70, 2.10, -0.11], splay: -0.130, dSplay: -0.040,
    L: [0.82, 0.45, 0.40], R: [0.212, 0.194, 0.176, 0.138],
    rest: [0.15, 0.24, 0.14], pinch: [0.32, 0.46, 0.20], lag: 1.5 }
];
/* Thumb: a long metacarpal off a low, radial CMC joint, swung out of the palm
   plane (opp ≈ 41°) so the pad opposes the fingers instead of lying flat. */
const THUMB = {
  cmc: [-0.52, 0.72, 0.12],
  opp: 0.68, swing: 0.72, mcp: 0.34, ip: 0.30,
  L: [1.10, 0.76, 0.52], R: [0.320, 0.285, 0.255, 0.212]
};
/* A child phalanx starts at exactly its parent's tip radius, so the two
   hemispheres at a joint coincide into one ball and leave no shading seam. The
   knuckle bulge comes from the waist in limb(), the way it does in a finger. */
const KNUCKLE = 1.0;
const HAND_H = 4.95;    // wrist → middle fingertip (+ dot), for frame fitting
const HAND_W = 3.15;    // thumb tip → pinky edge
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

/* loft(rows) — rows of ring vertices bottom-to-top into one indexed, smooth
   surface. A row of length 1 is a pole and gets fanned. Winding is CCW out. */
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
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setIndex(I);
  g.computeVertexNormals();
  return tint ? paint(g, tint) : g;
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

/* Warm blood tint: knuckles and fingertips run redder than the rest. Kept
   deliberately shallow — skin varies subtly, and a heavy hand here reads as
   painted plastic. */
function skinTint(red, out) {
  out[0] = 1 + 0.045 * red;
  out[1] = 1 - 0.075 * red;
  out[2] = 1 - 0.105 * red;
}

/* The fine flexion creases on the palm side of every finger joint. */
function creaseFinger(y, z, len, out) {
  if (z <= 0) return;
  const k = 1 - 0.10 * (gauss(0, y, 1, 0.06) + gauss(0, y - len, 1, 0.06));
  out[0] *= k; out[1] *= k; out[2] *= k;
}

/* limb(r0, r1, len) — the convex hull of a sphere r0 at y=0 and a sphere r1 at
   y=len (hemispherical joint ends joined by their common tangent cone), with an
   optional waist that thins the shaft between them. That waist is what makes a
   phalanx read as bone-and-flesh rather than as a lathe-turned dowel: the joints
   swell, the shaft doesn't, and consecutive segments meet without a seam. */
function limb(r0, r1, len, o) {
  const seg = o.seg || 30, cap = o.cap || 8, lat = o.lat || 7;
  const sx = o.sx || 1, sz = o.sz || 1, waist = o.waist === undefined ? 0.09 : o.waist;
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
    const ring = [];
    for (let j = 0; j < seg; j++) {
      const u = (j / seg) * Math.PI * 2;
      ring.push([p[0] * Math.cos(u) * sx, p[1], p[0] * Math.sin(u) * sz]);
    }
    return ring;
  });
  return loft(rows, o.tint);
}

const gauss = (dx, dy, sx, sy) =>
  Math.exp(-(dx * dx) / (2 * sx * sx) - (dy * dy) / (2 * sy * sy));

/* Distance from (x,y) to a polyline — used to paint the palmar creases and the
   soft occlusion in the folds. Baked into vertex colours, so the palm reads as
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
const CREASES = [
  /* distal transverse (under the fingers) · proximal transverse · thenar */
  [[0.86, 1.86], [0.30, 2.06], [-0.30, 2.10], [-0.66, 2.00]],
  [[0.80, 1.50], [0.10, 1.70], [-0.52, 1.82], [-0.82, 1.80]],
  [[-0.84, 1.80], [-0.66, 1.30], [-0.46, 0.80], [-0.20, 0.34], [0.02, 0.14]]
];

/* The palm: a lofted superellipse slab — narrow at the wrist, widest across the
   knuckles, thicker through the heel, domed on the back and gently cupped on
   the palm side. Its distal edge follows the knuckle arc (middle highest,
   pinky lowest), so the finger roots emerge out of the form, not off a lid. */
function palmGeometry() {
  const seg = 46, N = 32, Y0 = -0.42, Y1 = 2.60;
  const W = [[0, 0.0], [0.06, 0.44], [0.15, 0.62], [0.3, 0.72], [0.5, 0.82],
             [0.7, 0.90], [0.86, 0.98], [1, 1.00]];
  const DF = [[0, 0.16], [0.18, 0.27], [0.44, 0.30], [0.72, 0.27], [1, 0.225]];
  const DB = [[0, 0.16], [0.18, 0.26], [0.44, 0.29], [0.72, 0.24], [1, 0.195]];
  const NE = [[0, 2.2], [0.5, 2.7], [1, 3.2]];
  const CUP = [[0, 0], [0.3, 0.05], [0.6, 0.085], [0.88, 0.035], [1, 0]];
  const CB = 0.10, CT = 0.10;      // rounded cap ramps at both ends
  const rows = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N;
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
    /* the thumb-side and pinky-side edges bulge over the muscle mounds */
    const wT = w * (1 + 0.16 * gauss(0, y0 - 0.95, 1, 0.66));
    const wP = w * (1 + 0.08 * gauss(0, y0 - 0.85, 1, 0.62));
    const ring = [];
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a), p = 2 / ne;
      const ex = Math.sign(c) * Math.pow(Math.abs(c), p);
      const ez = Math.sign(s) * Math.pow(Math.abs(s), p);
      const x = (ex < 0 ? wT : wP) * ex;
      let z = (ez >= 0 ? df : db) * ez;
      if (ez > 0) {
        /* The palm's own relief, folded into this surface instead of pasted on
           as separate spheres: thenar mound at the thumb's base, hypothenar
           ridge down the pinky edge, a pad under each knuckle, and the hollow
           through the middle. One skin, no intersection seams. */
        let bump = 0.20 * gauss(x + 0.50, y0 - 0.98, 0.34, 0.62)
                 + 0.10 * gauss(x - 0.66, y0 - 0.82, 0.26, 0.58);
        for (let f = 0; f < FINGERS.length; f++) {
          bump += 0.075 * gauss(x - FINGERS[f].mcp[0], y0 - 2.16, 0.24, 0.34);
        }
        z += (bump - cup * (1 - ex * ex)) * ez;
      }
      /* knuckle arc: the distal edge peaks under the middle knuckle and falls
         away to both sides — hardest toward the pinky, exactly like the real
         metacarpal arch — and rises again between the fingers, which is the
         web of skin that keeps the roots from looking like rods in a slab. */
      let arc = 0.04 - 0.26 * Math.pow((x + 0.20) / 0.98, 2) * (1 + 0.5 * Math.max(0, x));
      arc += 0.13 * (gauss(x + 0.50, 0, 0.17, 1) + gauss(x, 0, 0.17, 1) +
                     gauss(x - 0.475, 0, 0.18, 1));
      ring.push([x, y0 + arc * smooth(clamp((u - 0.40) / 0.60, 0, 1)), z]);
    }
    rows.push(ring);
  }
  /* close the distal edge over the centroid of the last (arched) ring */
  const top = rows[rows.length - 1];
  let cx = 0, cy = 0, cz = 0;
  top.forEach((v) => { cx += v[0]; cy += v[1]; cz += v[2]; });
  rows.push([[cx / top.length, cy / top.length + 0.07, cz / top.length]]);
  return loft(rows, (x, y, z, out) => {
    /* redder in the heel and across the finger-root pads, palest mid-palm —
       ramped over a long span so it never shows as a band */
    const heel = smooth(clamp((0.55 - y) / 1.1, 0, 1));
    const front = z > 0.02 ? 1 : 0.25;
    const pads = smooth(clamp((y - 1.5) / 1.0, 0, 1)) * front;
    skinTint(Math.min(1, heel * 0.45 + pads * 0.5), out);
    /* creases + fold occlusion, front of the palm only */
    let ao = 0.065 * creaseFalloff(x, y, CREASES[0], 0.12)
           + 0.055 * creaseFalloff(x, y, CREASES[1], 0.12)
           + 0.06 * creaseFalloff(x, y, CREASES[2], 0.13)
           + 0.07 * gauss(x + 0.05, y - 1.55, 0.6, 0.55);
    /* the notch between each pair of finger roots sits in its own shade */
    ao += 0.13 * (gauss(x + 0.50, y - 2.46, 0.10, 0.26) +
                  gauss(x, y - 2.54, 0.10, 0.26) +
                  gauss(x - 0.475, y - 2.40, 0.11, 0.26));
    const k = 1 - ao * front;
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
     paper white, which is most of what separates "premium" from "plastic toy" */
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = room ? 1.0 : 0.98;
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
  /* Both stages share one idea, because both are lit by the same fiction: a
     single narrow beam from the upper LEFT (the room photo's surveillance camera
     is up there, and the case-study stage inherits its logic). The key is a
     SPOT, not a sun, so its cone edge crosses the hand: fingers bright, wrist
     falling away into the dark — which is also what sells the forearm
     dissolving out of frame. Then a cool rim from behind that same side, a
     faint kicker on the far edge, and a low warm bounce. Warm skin core against
     cool edges is most of what reads as "lit by that room". */
  scene.add(new THREE.HemisphereLight(
    room ? 0xCBDEF7 : 0xBFD2F2, room ? 0x3C6390 : 0x243768, room ? 0.66 : 0.42));

  const key = new THREE.SpotLight(room ? 0xFFFFFF : 0xFFF6EE,
    room ? 96 : 104, 0, 0.46, 0.88, 1.4);
  key.position.set(-4.2, 6.0, 4.4);
  scene.add(key);
  key.target.position.set(-0.42, 1.40, 0.34);
  scene.add(key.target);

  const rim = new THREE.DirectionalLight(room ? 0x8FE2FF : 0x5FD6F7, room ? 3.0 : 3.4);
  rim.position.set(-3.2, 2.0, -2.8);
  scene.add(rim);

  /* room: the wall neon saves the right silhouette. navy: a pale mint kicker —
     saturated mint at this angle paints a green outline instead of bouncing. */
  const kick = new THREE.DirectionalLight(room ? 0x6FD8FF : 0x9FF0DC, room ? 1.0 : 0.55);
  kick.position.set(room ? 4.2 : 2.8, room ? 0.6 : -0.6, room ? -1.9 : -1.6);
  scene.add(kick);

  /* the shelf lamp, low and to the left: lifts the undersides of the fingers
     and the thumb out of black instead of letting them die */
  const warm = new THREE.DirectionalLight(0xFFC79A, 1.2);
  warm.position.set(-3.6, -1.1, 2.6);
  scene.add(warm);

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
  /* Warm mid tone, mid roughness, a whisper of clearcoat + sheen for the soft
     wrap-around falloff real skin has at grazing angles. Per-vertex tint does
     the redder knuckles and fingertips for free. */
  const skin = new THREE.MeshPhysicalMaterial({
    color: 0xCE9E8A,
    roughness: 0.58,
    metalness: 0.0,
    /* Clearcoat stays a whisper on purpose. There is no environment map here
       (nothing to reflect), and a strong coat suppresses the diffuse layer by
       its Fresnel term at grazing angles — which paints a dark band right around
       the silhouette. 0.1 gives the soft second highlight without the halo. */
    clearcoat: 0.1,
    clearcoatRoughness: 0.42,
    sheen: 0.62,
    sheenRoughness: 0.8,
    sheenColor: 0xFFC2AE,
    vertexColors: true
  });
  /* the forearm uses the same skin, but with a per-vertex alpha so it dissolves
     into the room's darkness instead of ending in a cut-off stump */
  const skinFade = new THREE.MeshPhysicalMaterial({
    color: skin.color, roughness: skin.roughness, metalness: 0,
    clearcoat: skin.clearcoat, clearcoatRoughness: skin.clearcoatRoughness,
    sheen: skin.sheen, sheenRoughness: skin.sheenRoughness,
    sheenColor: skin.sheenColor, vertexColors: true, transparent: true
  });

  /* --------------------- landmark dots + skeleton ------------------------- */
  const aquaDot = new THREE.MeshBasicMaterial({ color: 0x37D6FF });
  const mintDot = new THREE.MeshBasicMaterial({ color: 0x26D9A3 });
  const dotGeo = {};
  const haloGeo = {};

  const landmarks = [];
  function landmark(parent, x, y, z, r, mat) {
    const k = r.toFixed(3);
    dotGeo[k] = dotGeo[k] || new THREE.SphereGeometry(r, 18, 14);
    haloGeo[k] = haloGeo[k] || new THREE.SphereGeometry(r * 1.85, 14, 10);
    const m = new THREE.Mesh(dotGeo[k], mat);
    m.position.set(x, y, z);
    const halo = new THREE.Mesh(haloGeo[k], new THREE.MeshBasicMaterial({
      color: mat.color, transparent: true, opacity: 0.17,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
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
  const skeleton = new THREE.LineSegments(skelGeo, new THREE.LineBasicMaterial({
    color: 0x37D6FF, transparent: true, opacity: 0.42,
    blending: THREE.AdditiveBlending, depthWrite: false
  }));
  skeleton.frustumCulled = false;
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

  /* click ripple — it blooms from the pinch contact point */
  const ripple = new THREE.Mesh(
    new THREE.RingGeometry(0.14, 0.2, 40),
    new THREE.MeshBasicMaterial({
      color: 0x7FE8FF, transparent: true, opacity: 0, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false
    })
  );
  ripple.renderOrder = 9;
  scene.add(ripple);

  /* ============================== the rig =============================== */
  /* base pose: the room shows the palm square to the viewer; the navy stage
     angles it like a product shot. */
  const BASE = room
    ? { rx: 0.02, ry: 0.09, rz: 0.03, x: 0, y: 0 }
    : { rx: -0.06, ry: -0.24, rz: 0.05, x: 0.1, y: 0 };

  const hand = new THREE.Group();       // cursor spring + click nudge
  scene.add(hand);
  const wrap = new THREE.Group();       // frame fit: scale + palm-centre pivot
  hand.add(wrap);
  const wrist = new THREE.Group();      // root joint — breathing lives here
  wrap.add(wrist);

  const palm = new THREE.Mesh(palmGeometry(), skin);
  wrist.add(palm);

  /* The one mass the palm loft can't carry, because it spans two chains: the
     first web space, the sail of skin between the thumb's metacarpal and the
     index. Buried deep in both so only its outer curve shows. */
  const pad = new THREE.SphereGeometry(1, 28, 20);
  paint(pad, (x, y, z, out) => skinTint(0.25, out));
  const web1 = new THREE.Mesh(pad, skin);
  web1.position.set(-0.80, 1.72, 0.16);
  web1.scale.set(0.34, 0.52, 0.19);
  web1.rotation.z = 0.38;
  wrist.add(web1);

  /* forearm: oval section, widening away from the wrist, alpha-faded so it
     dissolves into shadow rather than ending in an amputation */
  const stump = new THREE.Mesh(
    limb(0.50, 0.62, 2.6, {
      seg: 34, cap: 7, sx: 1.30, sz: 0.68,
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
  stump.position.set(0.02, 0.12, 0.0);
  stump.rotation.z = Math.PI;   // point it down; keeps +Z toward the viewer
  wrist.add(stump);

  landmark(wrist, 0.0, 0.16, 0.30, 0.088, mintDot);   // 0 · wrist

  /* ------------------------------- thumb --------------------------------- */
  /* Nested groups instead of one Euler triple: the outer group opposes the
     whole thumb out of the palm plane, the inner one swings it in that tilted
     plane. That IS how a thumb works, and it keeps the pinch solve stable. */
  const thumbOpp = new THREE.Group();
  thumbOpp.position.set(THUMB.cmc[0], THUMB.cmc[1], THUMB.cmc[2]);
  thumbOpp.rotation.y = THUMB.opp;
  wrist.add(thumbOpp);
  const thumbSwing = new THREE.Group();
  thumbSwing.rotation.z = THUMB.swing;
  thumbOpp.add(thumbSwing);
  thumbSwing.add(new THREE.Mesh(limb(THUMB.R[0], THUMB.R[1], THUMB.L[0], {
    seg: 30, sx: 1.02, sz: 0.94,
    tint: (x, y, z, out) => skinTint(0.3 * (1 - clamp(y / THUMB.L[0], 0, 1)), out)
  }), skin));

  const thumbMCP = new THREE.Group();
  thumbMCP.position.y = THUMB.L[0];
  thumbMCP.rotation.x = THUMB.mcp;
  thumbSwing.add(thumbMCP);
  thumbMCP.add(new THREE.Mesh(limb(THUMB.R[1] * KNUCKLE, THUMB.R[2], THUMB.L[1], {
    seg: 30, sx: 1.06, sz: 0.95,
    tint: (x, y, z, out) => skinTint(0.26 * Math.abs(1 - 2 * clamp(y / THUMB.L[1], 0, 1)), out)
  }), skin));

  const thumbIP = new THREE.Group();
  thumbIP.position.y = THUMB.L[1];
  thumbIP.rotation.x = THUMB.ip;
  thumbMCP.add(thumbIP);
  thumbIP.add(new THREE.Mesh(limb(THUMB.R[2] * KNUCKLE, THUMB.R[3], THUMB.L[2], {
    seg: 30, sx: 1.1, sz: 0.94,
    tint: (x, y, z, out) => skinTint(0.35 + 0.5 * clamp(y / THUMB.L[2], 0, 1), out)
  }), skin));

  landmark(thumbSwing, 0, 0.05, THUMB.R[0] * 0.82, 0.074, mintDot);            // 1 · CMC
  landmark(thumbMCP, 0, 0, THUMB.R[1] * 0.86 + 0.03, 0.07, mintDot);        // 2 · MCP
  landmark(thumbIP, 0, 0, THUMB.R[2] * 0.86 + 0.028, 0.066, mintDot);           // 3 · IP
  const thumbTip = landmark(thumbIP, 0, THUMB.L[2] * 0.78, THUMB.R[3] * 0.86, 0.082, aquaDot); // 4

  /* ------------------------------ fingers -------------------------------- */
  const fingers = FINGERS.map((F) => {
    const mcpJ = new THREE.Group();
    mcpJ.position.set(F.mcp[0], F.mcp[1], F.mcp[2]);
    mcpJ.rotation.z = F.splay;
    mcpJ.rotation.x = F.rest[0];
    wrist.add(mcpJ);
    mcpJ.add(new THREE.Mesh(limb(F.R[0], F.R[1], F.L[0], {
      seg: 28, sx: 1.06, sz: 0.94,
      tint: (x, y, z, out) => {
        skinTint(0.42 * (1 - smooth(clamp(y / (F.L[0] * 0.5), 0, 1))), out);
        creaseFinger(y, z, F.L[0], out);
      }
    }), skin));

    const pipJ = new THREE.Group();
    pipJ.position.y = F.L[0];
    pipJ.rotation.x = F.rest[1];
    mcpJ.add(pipJ);
    pipJ.add(new THREE.Mesh(limb(F.R[1] * KNUCKLE, F.R[2], F.L[1], {
      seg: 28, sx: 1.06, sz: 0.94,
      tint: (x, y, z, out) => {
        const t = clamp(y / F.L[1], 0, 1);
        skinTint(0.4 * (1 - smooth(t)) + 0.3 * smooth(t), out);
        creaseFinger(y, z, F.L[1], out);
      }
    }), skin));

    const dipJ = new THREE.Group();
    dipJ.position.y = F.L[1];
    dipJ.rotation.x = F.rest[2];
    pipJ.add(dipJ);
    dipJ.add(new THREE.Mesh(limb(F.R[2] * KNUCKLE, F.R[3], F.L[2], {
      seg: 28, sx: 1.10, sz: 0.90,
      tint: (x, y, z, out) => {
        skinTint(0.32 + 0.6 * smooth(clamp(y / F.L[2], 0, 1)), out);
        creaseFinger(y, z, F.L[2], out);
      }
    }), skin));

    const lm = [
      landmark(mcpJ, 0, 0, F.R[0] * 0.86 + 0.15 - F.mcp[2], 0.07, mintDot),
      landmark(pipJ, 0, 0, F.R[1] * 0.88 + 0.026, 0.064, mintDot),
      landmark(dipJ, 0, 0, F.R[2] * 0.88 + 0.024, 0.059, mintDot),
      landmark(dipJ, 0, F.L[2] * 0.78, F.R[3] * 0.86, 0.078, aquaDot)
    ];
    return { F, mcpJ, pipJ, dipJ, tip: lm[3], sx: 0, sxv: 0, sy: 0, syv: 0 };
  });
  const index = fingers[0];

  /* --------------------- solve the pinch on the real rig ------------------ */
  /* Put the index in its pinch pose, read where its fingertip landmark ends up,
     then coordinate-descend the thumb's four angles until its own fingertip
     landmark lands on the same point. Both dots are pinned to their pads, so
     "dots coincide" means "pads touch". ~300 forward-kinematics evaluations,
     once, at build time — and the pinch can never drift out of contact when the
     anatomy above is retuned. */
  const TH_P = { opp: 0.3, swing: -0.35, mcp: 0.35, ip: 0.3 };
  const _t1 = new THREE.Vector3(), _t2 = new THREE.Vector3();
  function solvePinch() {
    scene.updateMatrixWorld(true);
    const F = index.F;
    index.mcpJ.rotation.set(F.pinch[0], 0, F.splay + F.dSplay);
    index.pipJ.rotation.x = F.pinch[1];
    index.dipJ.rotation.x = F.pinch[2];
    index.mcpJ.updateWorldMatrix(false, true);
    index.tip.getWorldPosition(_t1);

    const LIM = { opp: [-0.1, 0.6], swing: [-0.8, 0.2], mcp: [-0.15, 0.8], ip: [0, 0.85] };
    const keys = ['swing', 'opp', 'mcp', 'ip'];
    const cost = () => {
      thumbOpp.rotation.y = THUMB.opp + TH_P.opp;
      thumbSwing.rotation.z = THUMB.swing + TH_P.swing;
      thumbMCP.rotation.x = THUMB.mcp + TH_P.mcp;
      thumbIP.rotation.x = THUMB.ip + TH_P.ip;
      thumbOpp.updateWorldMatrix(false, true);
      thumbTip.getWorldPosition(_t2);
      /* distance to the index pad, plus a feather-light bias toward a relaxed
         thumb so the solver can't wander into a contorted solution */
      return _t2.distanceTo(_t1) +
        0.012 * (Math.abs(TH_P.mcp) + Math.abs(TH_P.ip) + Math.abs(TH_P.swing));
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
    return best;
  }
  const pinchGap = solvePinch();

  /* ------------------------- frame fit + posing --------------------------- */
  const TRAVEL_UP = room ? 0.26 : 0.3;
  let S = 1;
  function fitFrame() {
    const visH = 2 * CAM_D * Math.tan(FOV * 0.5 * DEG);
    const visW = visH * (W / H);
    S = Math.min(visH * (room ? 0.70 : 0.76) / HAND_H, visW * (room ? 0.62 : 0.72) / HAND_W);
    wrap.scale.setScalar(S);
    wrap.position.y = -PIVOT_Y * S;
    /* hang the fingertips just inside the top edge, leaving room for the
       upward cursor travel; the forearm then runs off the bottom */
    BASE.y = CAM_Y + visH * 0.46 - (HAND_H - PIVOT_Y) * S - TRAVEL_UP;
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
    thumbMCP.rotation.x = THUMB.mcp + TH_P.mcp * p - breathe * 0.01;
    thumbIP.rotation.x = THUMB.ip + TH_P.ip * p;
    /* the whole hand leans a hair into the click, like a real press */
    const fl = Math.max(0, p);
    hand.position.z = fl * 0.1;
    /* the contact flash stays restrained on purpose: the point of the click is
       that you can SEE the two fingertips meet, not a white blowout */
    for (let i = 0; i < flashTips.length; i++) {
      const m = flashTips[i];
      m.scale.setScalar(1 + fl * 0.16);
      m.userData.halo.scale.setScalar(1 + fl * 0.5);
      m.userData.halo.material.opacity = 0.17 + fl * 0.22;
    }
  }
  applyPose(0, 0, 0);

  function render() { updateSkeleton(); renderer.render(scene, camera); }

  /* set once the follow springs exist, so a resize re-bases them instead of
     fighting them (the fit changes where "rest" is) */
  let onRefit = null;
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
  if (statik) {
    render();
    return { statik: true, pinchGap };
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
  const P_IN = 0.17, P_HOLD = 0.15, P_OUT = 0.34;
  const PULSE_DUR = P_IN + P_HOLD + P_OUT;
  const pinchAt = (dt) => {
    if (dt < P_IN) return EASE_OUT(dt / P_IN);
    if (dt < P_IN + P_HOLD) return 1;
    const u = (dt - P_IN - P_HOLD) / P_OUT;
    return (1 - u * u) * Math.exp(-2.2 * u) * Math.cos(u * 3.4);
  };
  let pulseStart = -1;
  let nextAuto = opts.autoPulse ? 1.2 : Infinity;
  const triggerPulse = () => {
    if (pulseStart < 0 || tNow - pulseStart > P_IN + P_HOLD) pulseStart = tNow;
    if (opts.autoPulse) nextAuto = tNow + 4.6;
  };
  /* the copy column overlays part of the canvas, so listen on the whole
     section — a click anywhere on the scene (not on a link) still pinches */
  trackEl.addEventListener('pointerdown', triggerPulse);
  sizeEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); triggerPulse(); }
  });

  let running = false, rafId = 0;
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
      f.sxv = (f.sxv + (-px.v * 1.5 * f.F.lag - f.sx) * k * s) * Math.pow(0.83, s);
      f.sx += f.sxv * s;
      f.syv = (f.syv + (py.v * 1.5 * f.F.lag - f.sy) * k * s) * Math.pow(0.83, s);
      f.sy += f.syv * s;
    }

    /* the CSS floor shadow tracks the hand's drift — one cheap style write */
    if (shadowEl) {
      shadowEl.style.transform =
        'translateX(' + (px.c * 34).toFixed(1) + 'px) scale(' +
        (1 + (py.c - BASE.y) * 0.16).toFixed(3) + ')';
    }

    let pinch = 0;
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
      ripple.position.copy(_vb).add(_vc).multiplyScalar(0.5);
      const p = (t - pulseStart) / PULSE_DUR;
      ripple.scale.setScalar(0.4 + EASE_OUT(Math.min(p, 1)) * 1.5);
      /* the fade lags the expansion so the ring stays readable through the
         middle of the pulse, not just its first frames */
      ripple.material.opacity = Math.max(0, 0.34 * Math.pow(1 - p, 1.5));
      ripple.lookAt(camera.position);
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
  return { setRunning, pinchGap };
}
