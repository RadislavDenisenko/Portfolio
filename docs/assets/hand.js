/* The AirMouse hand: a modelled, rigged reference hand rendered into the room
   scene, wearing skin maps we generate.

   It replaces ~1450 lines of procedural sculpting. Building a hand out of
   lathed capsules never got past "mannequin in a glove" — a mesh a human
   modelled has the knuckle arc, digit taper and thumb mass already right, and
   at 94KB it costs less than the code it deletes.

   The rig is the WebXR hand skeleton (25 named joints, flat hierarchy). We do
   not skin it at runtime: the section shows one open-palm pose, and the bind
   pose IS that pose. The joints are still worth reading, because the 21
   landmarks AirMouse tracks are exactly where they say they are. */

import * as T from './vendor/three-slim.min.js';

/* Resolved against this module, not the page: the case study lives at
   /airmouse/, so page-relative asset paths point one directory too deep. */
const asset = rel => new URL(rel, import.meta.url).href;
const MODEL = asset('models/hand-rigged.glb');
/* Baked for this mesh's UV layout, so creases land on the anatomy. Not tiled:
   a repeat frequency is exactly what made earlier detail read as scales. */
const SKIN = {
  map: asset('img/hand-albedo.jpg'),
  normalMap: asset('img/hand-normal.jpg'),
  roughnessMap: asset('img/hand-rough.jpg'),
};

/* Palm to camera, fingers up. The model is a left hand, so palm-forward puts
   the thumb on the right; the mirrored yaw shows the back, where none of the
   palm creases exist. */
const POSE = { x: 0, y: -Math.PI / 2, z: Math.PI };

/* MediaPipe's 21 landmarks in WebXR joint names. MediaPipe has no metacarpal
   joints for the fingers, so its "MCP" is our phalanx-proximal. */
const LANDMARKS = [
  'wrist',
  'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip',
  'index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate',
  'index-finger-phalanx-distal', 'index-finger-tip',
  'middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate',
  'middle-finger-phalanx-distal', 'middle-finger-tip',
  'ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate',
  'ring-finger-phalanx-distal', 'ring-finger-tip',
  'pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate',
  'pinky-finger-phalanx-distal', 'pinky-finger-tip',
];
const BONES = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17],
];

const CTOR = {
  5120: Int8Array, 5121: Uint8Array, 5122: Int16Array,
  5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array,
};

/* A compact GLB read. The vendored three build is tree-shaken to the exports
   this site actually uses, and pulling GLTFLoader back in costs more than the
   model does — this file has one mesh and no animation. */
async function loadModel(url) {
  const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
  const jsonLen = new DataView(buf.buffer, buf.byteOffset).getUint32(12, true);
  const gltf = JSON.parse(new TextDecoder().decode(buf.subarray(20, 20 + jsonLen)));
  const bin = buf.subarray(20 + jsonLen + 8);

  const typed = (accIdx, size) => {
    const a = gltf.accessors[accIdx];
    const bv = gltf.bufferViews[a.bufferView];
    const off = (bv.byteOffset || 0) + (a.byteOffset || 0);
    return new CTOR[a.componentType](bin.buffer, bin.byteOffset + off, a.count * size);
  };

  const prim = gltf.meshes[0].primitives[0];
  const geo = new T.BufferGeometry();
  geo.setAttribute('position',
    new T.Float32BufferAttribute(typed(prim.attributes.POSITION, 3).slice(), 3));
  geo.setAttribute('normal',
    new T.Float32BufferAttribute(typed(prim.attributes.NORMAL, 3).slice(), 3));
  geo.setAttribute('uv',
    new T.Float32BufferAttribute(typed(prim.attributes.TEXCOORD_0, 2).slice(), 2));
  geo.setIndex(Array.from(typed(prim.indices, 1)));
  geo.computeBoundingBox();

  const joints = {};
  gltf.nodes.forEach(n => { if (n.name && n.translation) joints[n.name] = n.translation; });
  return { geo, joints };
}

function loadSkin(renderer) {
  const loader = new T.TextureLoader();
  const maps = {};
  for (const [slot, url] of Object.entries(SKIN)) {
    const t = loader.load(url);
    if (slot === 'map') t.colorSpace = T.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    maps[slot] = t;
  }
  return maps;
}

function dotSprite(rgb) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d').createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(' + rgb + ',0.62)');
  g.addColorStop(0.22, 'rgba(' + rgb + ',0.34)');
  g.addColorStop(0.55, 'rgba(' + rgb + ',0.07)');
  g.addColorStop(1, 'rgba(' + rgb + ',0)');
  const ctx = c.getContext('2d');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new T.CanvasTexture(c);
}


/* --------------------------------------------------------------- wrist bend
   Rotating the whole group swings the forearm along with the hand, which reads
   as a prop on a stick. The turn is applied per vertex instead, ramped in
   across the wrist: the stub below it holds still, the hand turns on it, and
   the fingers run a slower spring than the palm so they arrive late. That lag
   is most of the difference between rotating and moving.

   Written longhand because the vendored three exports no Quaternion and no
   Matrix3, and two composed axis-angle rotations are a dozen lines. */
const BUCKETS = 32;
const BEND_BAND = 0.034;        // model units the wrist spreads the bend over

function rodrigues(m, u, ang) {
  const c = Math.cos(ang), s = Math.sin(ang), C = 1 - c;
  const x = u.x, y = u.y, z = u.z;
  m[0] = x * x * C + c;     m[1] = x * y * C - z * s; m[2] = x * z * C + y * s;
  m[3] = y * x * C + z * s; m[4] = y * y * C + c;     m[5] = y * z * C - x * s;
  m[6] = z * x * C - y * s; m[7] = z * y * C + x * s; m[8] = z * z * C + c;
}

function mul3(out, o, a, b) {
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[o + r * 3 + c] =
        a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
}

export async function initHand(target, opts = {}) {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  target.appendChild(canvas);

  const renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = T.SRGBColorSpace;

  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(30, 1, 0.1, 100);
  camera.position.set(0, 0, 3.2);

  /* Lit to the room plate: its beam enters upper-left, its only other sources
     are the window and the wall tube, both cool. Nothing warm is added — skin
     albedo is warm enough that neutral light returns warm. */
  scene.add(new T.HemisphereLight(0xc9dcf2, 0x1a2740, 1.05));
  const key = new T.DirectionalLight(0xffffff, 1.5);
  key.position.set(-2.4, 2.8, 1.8);
  scene.add(key);
  const rim = new T.DirectionalLight(0x8fd8ff, 0.9);
  rim.position.set(-3.0, 0.8, -1.6);
  scene.add(rim);
  const fill = new T.DirectionalLight(0x7fa8d8, 0.28);
  fill.position.set(2.6, -0.6, 1.2);
  scene.add(fill);

  const wrap = new T.Group();
  scene.add(wrap);
  const spin = new T.Group();
  spin.rotation.set(POSE.x, POSE.y, POSE.z);
  wrap.add(spin);

  let model;
  try {
    model = await loadModel(MODEL);
  } catch (e) {
    target.classList.add('hand-fallback');
    return;
  }

  const mat = new T.MeshPhysicalMaterial({
    color: 0xF0BFA4,
    roughness: 0.65,
    metalness: 0.0,
    sheen: 0.45,
    sheenColor: 0xffcdb4,
    sheenRoughness: 0.7,
    clearcoat: 0.02,
    clearcoatRoughness: 0.62,
    ...loadSkin(renderer),
  });
  mat.normalScale.set(0.62, 0.62);

  const mesh = new T.Mesh(model.geo, mat);
  spin.add(mesh);

  const bb = model.geo.boundingBox;
  const centre = [
    -(bb.min.x + bb.max.x) / 2,
    -(bb.min.y + bb.max.y) / 2,
    -(bb.min.z + bb.max.z) / 2,
  ];
  mesh.position.set(centre[0], centre[1], centre[2]);
  const span = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z);
  spin.scale.setScalar(1.52 / span);

  /* Landmarks read their positions from the rig, so they sit exactly where the
     joints are rather than where someone guessed. Lifted along the palm normal
     so they read as an overlay on the surface, not embedded in it. */
  const lm = new T.Group();
  const tipTex = dotSprite('124,255,190');
  const jointTex = dotSprite('90,214,255');
  const pts = [];
  const lmRaw = [];
  const TIPS = new Set([4, 8, 12, 16, 20]);
  LANDMARKS.forEach((name, i) => {
    const p = model.joints[name];
    if (!p) return;
    const s = new T.Sprite(new T.SpriteMaterial({
      map: TIPS.has(i) ? tipTex : jointTex,
      transparent: true, depthTest: false, depthWrite: false,
      blending: T.CustomBlending,
      blendSrc: T.SrcAlphaFactor, blendDst: T.OneFactor,
      blendSrcAlpha: T.ZeroFactor, blendDstAlpha: T.OneFactor,
    }));
    s.position.set(p[0] + centre[0], p[1] + centre[1], p[2] + centre[2] + 0.004);
    s.scale.setScalar(TIPS.has(i) ? 0.0135 : 0.0105);
    s.renderOrder = 10;
    lm.add(s);
    pts[i] = s.position;
    lmRaw[i] = p;
  });

  const segs = [];
  BONES.forEach(([a, b]) => {
    if (!pts[a] || !pts[b]) return;
    segs.push(pts[a].x, pts[a].y, pts[a].z, pts[b].x, pts[b].y, pts[b].z);
  });
  const skel = new T.LineSegments(
    new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute(segs, 3)),
    new T.LineBasicMaterial({
      color: 0x7fe4ff, transparent: true, opacity: 0.3,
      depthTest: false, depthWrite: false,
      blending: T.CustomBlending,
      blendSrc: T.SrcAlphaFactor, blendDst: T.OneFactor,
      blendSrcAlpha: T.ZeroFactor, blendDstAlpha: T.OneFactor,
    }));
  skel.renderOrder = 9;
  lm.add(skel);
  spin.add(lm);

  /* Screen axes expressed in the geometry's own frame. The cursor turns the
     hand about the camera's axes; the vertices we move live in model space. */
  const probe = new T.Group();
  probe.rotation.set(POSE.x, POSE.y, POSE.z);
  probe.updateMatrixWorld();
  const axX = probe.worldToLocal(new T.Vector3(1, 0, 0)).normalize();
  const axY = probe.worldToLocal(new T.Vector3(0, 1, 0)).normalize();

  const wj = model.joints['wrist'];
  const tj = model.joints['middle-finger-tip'];
  const reach = Math.hypot(tj[0] - wj[0], tj[1] - wj[1], tj[2] - wj[2]);
  const axis = new T.Vector3((tj[0] - wj[0]) / reach,
                             (tj[1] - wj[1]) / reach,
                             (tj[2] - wj[2]) / reach);
  const along = (x, y, z) =>
    (x - wj[0]) * axis.x + (y - wj[1]) * axis.y + (z - wj[2]) * axis.z;

  /* Everything that varies across the hand varies with one number — distance
     along the wrist-to-fingertip axis — so the per-vertex work is a lookup,
     and only 32 rotation matrices get built per frame instead of 1360. */
  const T0 = -0.008;
  const slot = t => Math.max(0, Math.min(BUCKETS - 1,
    Math.round((t - T0) / (reach - T0) * (BUCKETS - 1))));
  const bendW = new Float32Array(BUCKETS);    // how much of the turn reaches here
  const bendD = new Float32Array(BUCKETS);    // how far out, for the finger lag
  for (let i = 0; i < BUCKETS; i++) {
    const t = T0 + (reach - T0) * i / (BUCKETS - 1);
    const u = Math.max(0, Math.min(1, t / BEND_BAND));
    bendW[i] = u * u * (3 - 2 * u);
    bendD[i] = Math.max(0, Math.min(1, t / reach));
  }

  const posAttr = model.geo.attributes.position;
  const nrmAttr = model.geo.attributes.normal;
  const restP = posAttr.array.slice();
  const restN = nrmAttr.array.slice();
  const vSlot = new Uint8Array(restP.length / 3);
  for (let v = 0; v < vSlot.length; v++) {
    vSlot[v] = slot(along(restP[v * 3], restP[v * 3 + 1], restP[v * 3 + 2]));
  }
  const lmSlot = lmRaw.map(p => (p ? slot(along(p[0], p[1], p[2])) : 0));
  mesh.frustumCulled = false;    // the bend moves vertices outside the bind box

  const mats = new Float32Array(BUCKETS * 9);
  const mA = new Float32Array(9), mB = new Float32Array(9);
  const skelPos = skel.geometry.attributes.position;

  /* cx/cy is where the palm has got to, gx/gy where the fingers have. */
  function bend(cx, cy, gx, gy) {
    for (let i = 0; i < BUCKETS; i++) {
      const w = bendW[i], d = bendD[i];
      rodrigues(mA, axX, w * (cx + (gx - cx) * d));
      rodrigues(mB, axY, w * (cy + (gy - cy) * d));
      mul3(mats, i * 9, mA, mB);
    }

    const P = posAttr.array, N = nrmAttr.array;
    for (let v = 0, n = vSlot.length; v < n; v++) {
      const o = vSlot[v] * 9, k = v * 3;
      const px = restP[k] - wj[0], py = restP[k + 1] - wj[1], pz = restP[k + 2] - wj[2];
      P[k]     = wj[0] + mats[o]     * px + mats[o + 1] * py + mats[o + 2] * pz;
      P[k + 1] = wj[1] + mats[o + 3] * px + mats[o + 4] * py + mats[o + 5] * pz;
      P[k + 2] = wj[2] + mats[o + 6] * px + mats[o + 7] * py + mats[o + 8] * pz;
      const nx = restN[k], ny = restN[k + 1], nz = restN[k + 2];
      N[k]     = mats[o]     * nx + mats[o + 1] * ny + mats[o + 2] * nz;
      N[k + 1] = mats[o + 3] * nx + mats[o + 4] * ny + mats[o + 5] * nz;
      N[k + 2] = mats[o + 6] * nx + mats[o + 7] * ny + mats[o + 8] * nz;
    }
    posAttr.needsUpdate = true;
    nrmAttr.needsUpdate = true;

    /* The landmarks are the claim this section makes, so they ride the same
       transform as the skin rather than a cheaper approximation of it. */
    for (let i = 0; i < lmRaw.length; i++) {
      const p = lmRaw[i];
      if (!p || !pts[i]) continue;
      const o = lmSlot[i] * 9;
      const px = p[0] - wj[0], py = p[1] - wj[1], pz = p[2] + 0.004 - wj[2];
      pts[i].set(
        wj[0] + mats[o]     * px + mats[o + 1] * py + mats[o + 2] * pz + centre[0],
        wj[1] + mats[o + 3] * px + mats[o + 4] * py + mats[o + 5] * pz + centre[1],
        wj[2] + mats[o + 6] * px + mats[o + 7] * py + mats[o + 8] * pz + centre[2]);
    }
    const S = skelPos.array;
    let j = 0;
    for (const [a, b] of BONES) {
      if (!pts[a] || !pts[b]) continue;
      S[j++] = pts[a].x; S[j++] = pts[a].y; S[j++] = pts[a].z;
      S[j++] = pts[b].x; S[j++] = pts[b].y; S[j++] = pts[b].z;
    }
    skelPos.needsUpdate = true;
  }

  function resize() {
    const r = target.getBoundingClientRect();
    if (!r.width || !r.height) return;
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / r.height;
    camera.updateProjectionMatrix();
  }
  resize();
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(target);
  else window.addEventListener('resize', resize);

  /* One frame is the whole job on a coarse pointer or under reduced motion:
     there is no cursor to follow, so a render loop would burn battery to
     redraw an identical image. */
  if (opts.statik) { renderer.render(scene, camera); return; }

  let tx = 0, ty = 0, cx = 0, cy = 0, vx = 0, vy = 0;
  let gx = 0, gy = 0, ux = 0, uy = 0;
  const onMove = e => {
    ty = (e.clientX / window.innerWidth - 0.5) * 0.62;
    tx = (e.clientY / window.innerHeight - 0.5) * 0.34;
  };
  window.addEventListener('mousemove', onMove, { passive: true });

  let visible = true, running = false, raf = null;
  const frame = t => {
    if (!visible || document.hidden) { running = false; raf = null; return; }
    vx += (tx - cx) * 0.055; vx *= 0.85; cx += vx;
    vy += (ty - cy) * 0.055; vy *= 0.85; cy += vy;
    /* The fingers chase the palm rather than the cursor, on a slightly softer
       spring, so they set off after it and settle after it. Tuned to about 7
       degrees of lag on a full-width flick: a hand yields that much, a slower
       spring gave 21 and the hand turned to rubber. */
    ux += (cx - gx) * 0.26; ux *= 0.84; gx += ux;
    uy += (cy - gy) * 0.26; uy *= 0.84; gy += uy;
    bend(cx, cy, gx, gy);
    wrap.position.y = 0.06 + Math.sin(t / 1600) * 0.022;   // idle drift, never frozen
    if (opts.shadowEl) {
      opts.shadowEl.style.transform =
        'translate(-50%,-50%) translateX(' + (cy * 46).toFixed(1) + 'px) scale(' +
        (1 - Math.abs(cy) * 0.10).toFixed(3) + ')';
    }
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  };
  const start = () => { if (!running) { running = true; raf = requestAnimationFrame(frame); } };
  const stop = () => { if (raf) cancelAnimationFrame(raf); raf = null; running = false; };

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(es => es.forEach(e => {
      visible = e.isIntersecting;
      visible ? start() : stop();
    }), { threshold: 0.01 }).observe(target);
  } else { start(); }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop(); else if (visible) start();
  });
  start();
}
