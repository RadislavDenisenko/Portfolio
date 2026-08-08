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

const MODEL = 'assets/models/hand-rigged.glb';
const SKIN = {
  map: 'assets/img/skin-albedo.jpg',
  normalMap: 'assets/img/skin-normal.jpg',
  roughnessMap: 'assets/img/skin-rough.jpg',
};

/* Palm to camera, fingers up, thumb splayed — found by rendering the sweep. */
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
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.repeat.set(5, 5);              // pores, not paving slabs, at this on-screen size
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    if (slot === 'map') t.colorSpace = T.SRGBColorSpace;
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
    color: 0xE3AE93,
    roughness: 0.58,
    metalness: 0.0,
    sheen: 0.35,
    sheenColor: 0xffcdb4,
    sheenRoughness: 0.7,
    clearcoat: 0.07,
    clearcoatRoughness: 0.62,
    ...loadSkin(renderer),
  });
  mat.normalScale.set(0.35, 0.35);

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
    s.position.set(p[0] + centre[0], p[1] + centre[1], p[2] + centre[2] + 0.012);
    s.scale.setScalar(TIPS.has(i) ? 0.0135 : 0.0105);
    s.renderOrder = 10;
    lm.add(s);
    pts[i] = s.position;
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
  const onMove = e => {
    ty = (e.clientX / window.innerWidth - 0.5) * 0.62;
    tx = (e.clientY / window.innerHeight - 0.5) * -0.34;
  };
  window.addEventListener('mousemove', onMove, { passive: true });

  let visible = true, running = false, raf = null;
  const frame = t => {
    if (!visible || document.hidden) { running = false; raf = null; return; }
    vx += (tx - cx) * 0.055; vx *= 0.85; cx += vx;
    vy += (ty - cy) * 0.055; vy *= 0.85; cy += vy;
    wrap.rotation.x = cx;
    wrap.rotation.y = cy;
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
