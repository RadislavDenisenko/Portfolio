/* AirMouse stage — a stylized 3D hand built from primitives (blessed in DESIGN.md).
   All 21 MediaPipe landmarks rendered proud of the surface with an aqua skeleton.
   Follows the cursor with spring lag; thumb + index actually meet on pinch.
   Vendored, tree-shaken three bundle (no CDN). Lazy-imported by site.js. */
import * as THREE from './vendor/three-slim.min.js';

const EASE_OUT = (t) => 1 - Math.pow(1 - t, 3);

export function initHand(target, opts = {}) {
  const statik = !!opts.statik;
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
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.display = 'block';
  target.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, W / H, 0.1, 40);
  camera.position.set(0, 0.35, 6.4);
  camera.lookAt(0, 0.1, 0);

  /* ---------- lights: aqua rim + mint fill on navy ---------- */
  scene.add(new THREE.HemisphereLight(0x9FB4FF, 0x0E1230, 0.85));

  const key = new THREE.DirectionalLight(0xEFF3FF, 2.4);
  key.position.set(3.2, 4.6, 4.2);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -4; key.shadow.camera.right = 4;
  key.shadow.camera.top = 4; key.shadow.camera.bottom = -4;
  key.shadow.bias = -0.0005;
  scene.add(key);

  const rim = new THREE.DirectionalLight(0x00B4E6, 3.2);
  rim.position.set(-4.5, 1.4, -2.5);
  scene.add(rim);

  const fill = new THREE.PointLight(0x26D9A3, 14, 12, 2);
  fill.position.set(2.4, -1.4, 2.4);
  scene.add(fill);

  /* ---------- ground shadow + glow disc ---------- */
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(14, 14),
    new THREE.ShadowMaterial({ opacity: 0.32 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1.72;
  ground.receiveShadow = true;
  scene.add(ground);

  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(3.4, 48),
    new THREE.MeshBasicMaterial({ color: 0x18204A, transparent: true, opacity: 0.5 })
  );
  glow.position.set(0.1, 0.1, -1.8);
  scene.add(glow);

  /* ---------- materials ---------- */
  const skin = new THREE.MeshStandardMaterial({ color: 0xEDF1FA, roughness: 0.38, metalness: 0.06 });
  const aquaDot = new THREE.MeshBasicMaterial({ color: 0x37D6FF });
  const mintDot = new THREE.MeshBasicMaterial({ color: 0x26D9A3 });

  /* 21 tracked landmarks (MediaPipe order-ish) + halo glow so the
     tracking-overlay story reads at a glance */
  const landmarks = [];
  function landmark(parent, x, y, z, r, mat) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 12), mat);
    m.position.set(x, y, z);
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(r * 1.9, 12, 10),
      new THREE.MeshBasicMaterial({
        color: mat.color, transparent: true, opacity: 0.22,
        blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    m.add(halo);
    parent.add(m);
    landmarks.push(m);
    return m;
  }

  /* ---------- hand from primitives ---------- */
  const hand = new THREE.Group();
  scene.add(hand);

  // palm: smooth scaled sphere slab
  const palm = new THREE.Mesh(new THREE.SphereGeometry(0.8, 40, 28), skin);
  palm.scale.set(1.0, 0.78, 0.42);
  palm.castShadow = true;
  hand.add(palm);

  // wrist / forearm flowing off the bottom of the frame
  const wrist = new THREE.Mesh(new THREE.CapsuleGeometry(0.38, 1.1, 6, 20), skin);
  wrist.position.set(0.02, -1.15, -0.05);
  wrist.rotation.z = 0.06;
  wrist.castShadow = true;
  hand.add(wrist);

  // 0 · wrist landmark
  landmark(hand, 0, -0.62, 0.34, 0.062, mintDot);

  // 1-4 · thumb: two segments angled out from the palm's +x side
  const thumb = new THREE.Group();
  thumb.position.set(0.66, 0.02, 0.1);
  thumb.rotation.z = -0.95;
  const t1 = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.32, 6, 18), skin);
  t1.position.y = 0.2; t1.castShadow = true;
  thumb.add(t1);
  const tj2 = new THREE.Group();
  tj2.position.y = 0.46;
  thumb.add(tj2);
  const t2 = new THREE.Mesh(new THREE.CapsuleGeometry(0.108, 0.26, 6, 18), skin);
  t2.position.y = 0.16; t2.castShadow = true;
  tj2.add(t2);
  landmark(thumb, 0, 0.04, 0.15, 0.045, mintDot);   // 1 cmc
  landmark(thumb, 0, 0.26, 0.15, 0.042, mintDot);   // 2 mcp
  landmark(tj2, 0, 0, 0.13, 0.042, mintDot);        // 3 ip
  const thumbTip = landmark(tj2, 0, 0.38, 0, 0.058, aquaDot); // 4 tip
  hand.add(thumb);

  // 5-20 · four fingers: mcp / pip / dip / tip landmarks each
  const fingers = [];
  function makeFinger(x, y, l1, l2, r1, r2, spread) {
    const root = new THREE.Group();
    root.position.set(x, y, 0.02);
    root.rotation.z = spread;
    const s1 = new THREE.Mesh(new THREE.CapsuleGeometry(r1, l1, 6, 18), skin);
    s1.position.y = l1 / 2 + r1 * 0.4;
    s1.castShadow = true;
    root.add(s1);

    landmark(root, 0, 0.02, r1 * 1.12, 0.048, mintDot);          // mcp

    const j2 = new THREE.Group();
    j2.position.y = l1 + r1 * 0.8;
    root.add(j2);

    landmark(j2, 0, 0, r2 * 1.15, 0.042, mintDot);               // pip

    const s2 = new THREE.Mesh(new THREE.CapsuleGeometry(r2, l2, 6, 18), skin);
    s2.position.y = l2 / 2 + r2 * 0.35;
    s2.castShadow = true;
    j2.add(s2);

    landmark(j2, 0, l2 * 0.62, r2 * 1.1, 0.04, mintDot);         // dip
    const tip = landmark(j2, 0, l2 + r2 * 0.9, 0, 0.058, aquaDot); // tip

    hand.add(root);
    return { root, j2, tip, spread };
  }

  // index, middle, ring, pinky (thumb side = +x)
  fingers.push(makeFinger( 0.52, 0.52, 0.50, 0.42, 0.125, 0.108,  0.10));
  fingers.push(makeFinger( 0.175, 0.58, 0.56, 0.47, 0.13,  0.112,  0.02));
  fingers.push(makeFinger(-0.175, 0.56, 0.51, 0.43, 0.125, 0.108, -0.03));
  fingers.push(makeFinger(-0.52, 0.48, 0.38, 0.31, 0.11,  0.096, -0.12));
  const indexTip = fingers[0].tip;

  /* ---------- aqua skeleton connecting the 21 landmarks ---------- */
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
    color: 0x37D6FF, transparent: true, opacity: 0.4,
    blending: THREE.AdditiveBlending, depthWrite: false
  }));
  skeleton.frustumCulled = false;
  scene.add(skeleton);

  const _va = new THREE.Vector3();
  function updateSkeleton() {
    scene.updateMatrixWorld(true);
    const pos = skelGeo.attributes.position;
    CONNS.forEach((c, i) => {
      landmarks[c[0]].getWorldPosition(_va);
      pos.setXYZ(i * 2, _va.x, _va.y, _va.z);
      landmarks[c[1]].getWorldPosition(_va);
      pos.setXYZ(i * 2 + 1, _va.x, _va.y, _va.z);
    });
    pos.needsUpdate = true;
  }

  // click ripple ring — re-anchored to the thumb/index contact point each frame
  const ripple = new THREE.Mesh(
    new THREE.RingGeometry(0.16, 0.2, 40),
    new THREE.MeshBasicMaterial({ color: 0x37D6FF, transparent: true, opacity: 0, side: THREE.DoubleSide })
  );
  scene.add(ripple);

  hand.rotation.set(-0.12, -0.28, 0.06);
  hand.position.set(0.15, -0.05, 0);

  /* ---------- pose: numerically solved so the tips meet at pinch=1 ---------- */
  const BASE_CURL_1 = 0.14, BASE_CURL_2 = 0.2;
  const PZ = { idx1: 0.92, idx2: 1.17, thZ: 0.58, thX: 0.68, thIp: 0.55, adduct: -0.58 };
  function applyPose(t, pinch, idleAmp) {
    fingers.forEach((f, i) => {
      const sway = idleAmp * Math.sin(t * 1.25 + i * 0.9) * 0.05;
      /* index curls to meet the thumb; the other three stay mostly extended */
      const extra = (i === 0 ? PZ.idx1 : 0.08) * pinch;
      const extra2 = (i === 0 ? PZ.idx2 : 0.1) * pinch;
      f.root.rotation.x = BASE_CURL_1 + sway + extra;
      f.j2.rotation.x = BASE_CURL_2 + sway * 1.4 + extra2;
      if (i === 0) f.root.rotation.z = f.spread + PZ.adduct * pinch;
    });
    thumb.rotation.z = -0.95 + pinch * PZ.thZ;
    thumb.rotation.x = 0.1 + pinch * PZ.thX;
    tj2.rotation.x = 0.12 + pinch * PZ.thIp;
    hand.position.z = pinch * 0.28;
  }
  applyPose(0, 0, 0);

  function render() { updateSkeleton(); renderer.render(scene, camera); }

  function resize() {
    const r = sizeEl.getBoundingClientRect();
    if (r.width < 5 || r.height < 5) return;
    W = r.width; H = r.height;
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    renderer.setSize(W, H, false);
    if (statik || !running) render();
  }
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(sizeEl);
  else window.addEventListener('resize', resize);

  /* ---------- static mode: one polished frame, no loop ---------- */
  if (statik) {
    applyPose(0, 0.22, 0); // hint of a pinch reads as intentional
    hand.position.set(0.15, -0.02, 0.06);
    render();
    return { statik: true };
  }

  /* ---------- interactive mode ---------- */
  const trackEl = host.closest('section') || host;
  const px = { c: 0.15, v: 0, t: 0.15 };
  const py = { c: -0.05, v: 0, t: -0.05 };

  trackEl.addEventListener('mousemove', (e) => {
    const r = sizeEl.getBoundingClientRect();
    const nx = (e.clientX - (r.left + r.width / 2)) / Math.max(r.width, 1);
    const ny = (e.clientY - (r.top + r.height / 2)) / Math.max(r.height, 1);
    /* travel kept short of the frame edges so the whole hand stays composed */
    px.t = Math.max(-0.7, Math.min(0.7, nx * 1.5));
    py.t = Math.max(-0.5, Math.min(0.32, -ny * 1.1)) - 0.05;
  });
  trackEl.addEventListener('mouseleave', () => { px.t = 0.15; py.t = -0.05; });

  let tNow = 0, last = performance.now();
  let pinchStart = -1;
  const PINCH_DUR = 0.62;
  /* case-study hero owns a choreography: it pinches on its own shortly after
     entering view, then every few seconds — a user pinch defers the next one */
  let nextAuto = opts.autoPinch ? 1.1 : Infinity;
  const triggerPinch = () => {
    if (pinchStart < 0 || tNow - pinchStart > PINCH_DUR * 0.6) pinchStart = tNow;
    if (opts.autoPinch) nextAuto = tNow + 4.6;
  };
  sizeEl.addEventListener('pointerdown', triggerPinch);
  sizeEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); triggerPinch(); }
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
    if (t >= nextAuto) triggerPinch();

    // spring toward the cursor — dt-scaled so 60Hz and 120Hz+ feel identical
    const s = dt * 60;
    px.v = (px.v + (px.t - px.c) * 0.085 * s) * Math.pow(0.82, s);
    py.v = (py.v + (py.t - py.c) * 0.085 * s) * Math.pow(0.82, s);
    px.c += px.v * s; py.c += py.v * s;

    hand.position.x = px.c;
    hand.position.y = py.c + Math.sin(t * 1.1) * 0.05;
    hand.rotation.y = -0.28 + px.c * 0.22 + px.v * 1.6;
    hand.rotation.x = -0.12 - py.c * 0.16 - py.v * 1.2;
    hand.rotation.z = 0.06 - px.v * 1.4;

    // pinch envelope: out and back
    let pinch = 0;
    if (pinchStart >= 0) {
      const p = (t - pinchStart) / PINCH_DUR;
      if (p >= 1) pinchStart = -1;
      else pinch = Math.sin(Math.PI * Math.min(p, 1));
    }
    applyPose(t, pinch, 1);

    // ripple feedback, emanating from where the fingertips actually meet
    if (pinchStart >= 0) {
      hand.updateMatrixWorld(true);
      indexTip.getWorldPosition(_vb);
      thumbTip.getWorldPosition(_vc);
      ripple.position.copy(_vb).add(_vc).multiplyScalar(0.5);
      const p = (t - pinchStart) / PINCH_DUR;
      const e = EASE_OUT(Math.min(p * 1.4, 1));
      ripple.scale.setScalar(0.4 + e * 2.2);
      ripple.material.opacity = Math.max(0, 0.9 * (1 - e));
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
  return { setRunning };
}
