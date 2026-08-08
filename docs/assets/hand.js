/* AirMouse stage — a real scanned hand (hand.glb, single static mesh) under the
   21-landmark MediaPipe tracking overlay: aqua/mint glowing dots + thin skeleton.
   Follows the cursor with spring lag; click = press pulse toward the camera with
   an index-fingertip flash and ripple (the mesh is unrigged, so no fake pinch).
   If the GLB can't load, falls back silently to the stylized primitive hand.
   Vendored, tree-shaken three bundle (no CDN). Lazy-imported by site.js. */
import * as THREE from './vendor/three-slim.min.js';
import { GLTFLoader } from './vendor/GLTFLoader.min.js';

const EASE_OUT = (t) => 1 - Math.pow(1 - t, 3);

export function initHand(target, opts = {}) {
  const statik = !!opts.statik;
  const room = !!opts.room; // homepage cinematic room: transparent canvas over a photo
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
  renderer.shadowMap.enabled = !room; // room floor shadow is a CSS ellipse instead
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.display = 'block';
  target.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, W / H, 0.1, 40);
  if (room) {
    /* framed a touch higher so the scan's two forearm prongs exit the bottom
       of the canvas and read as a wrist, never as legs floating mid-air */
    camera.position.set(0, 0.9, 6.2);
    camera.lookAt(0, 0.62, 0);
  } else {
    camera.position.set(0, 0.35, 6.4);
    camera.lookAt(0, 0.1, 0);
  }

  if (room) {
    /* room mode: the hand floats in the camera's cool beam. Neutral-white key
       so the scan's own JPEG texture reads as skin, aqua rim from the upper
       left where the surveillance beam comes from, faint warm floor bounce
       from the lamp side. No navy glow disc, no Three ground — the photo is
       the room and the floor shadow is a CSS ellipse. */
    scene.add(new THREE.HemisphereLight(0xF2F6FF, 0x1A2438, 0.9));

    const key = new THREE.DirectionalLight(0xFFFFFF, 2.1);
    key.position.set(1.2, 3.4, 4.6);
    scene.add(key);

    const rim = new THREE.DirectionalLight(0x9FE4FF, 2.6);
    rim.position.set(-4.2, 5.2, -1.6);
    scene.add(rim);

    const warm = new THREE.PointLight(0xFFB878, 5, 12, 2);
    warm.position.set(-4.0, -1.2, 2.2);
    scene.add(warm);
  } else {
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

    /* ---------- ground shadow + glow disc (navy stage only) ---------- */
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
  }

  /* ---------- shared: landmark dots + aqua skeleton overlay ---------- */
  const aquaDot = new THREE.MeshBasicMaterial({ color: 0x37D6FF });
  const mintDot = new THREE.MeshBasicMaterial({ color: 0x26D9A3 });

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
    color: 0x37D6FF, transparent: true, opacity: 0.4,
    blending: THREE.AdditiveBlending, depthWrite: false
  }));
  skeleton.frustumCulled = false;
  scene.add(skeleton);

  const _va = new THREE.Vector3();
  function updateSkeleton() {
    if (landmarks.length < 21) return; // model still loading
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

  // click ripple ring — anchored to the index fingertip landmark
  const ripple = new THREE.Mesh(
    new THREE.RingGeometry(0.14, 0.2, 40),
    new THREE.MeshBasicMaterial({
      color: 0x7FE8FF, transparent: true, opacity: 0, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false
    })
  );
  ripple.renderOrder = 9; // always over the mesh — the pulse must read
  scene.add(ripple);

  /* ---------- the hand: real scanned mesh, primitive fallback ---------- */
  /* base pose: on the navy stage the hand sits angled like a product shot;
     in the room it faces the viewer square-on — open palm, fingers up, a
     hair of z-tilt so it doesn't look pinned. */
  const BASE = room
    ? { rx: 0.04, ry: 0.0, rz: 0.05, x: 0, y: -0.05 }
    : { rx: -0.12, ry: -0.28, rz: 0.06, x: 0.15, y: -0.05 };
  const hand = new THREE.Group();
  scene.add(hand);
  hand.rotation.set(BASE.rx, BASE.ry, BASE.rz);
  hand.position.set(BASE.x, BASE.y, 0);

  /* applyPose(t, pulse, idleAmp) is swapped in by whichever builder wins.
     indexTip / focusTips are set by the builder for ripple + flash anchoring. */
  let applyPose = () => {};
  let indexTip = null;
  let tipFlash = []; // landmark meshes that flash on the press pulse

  /* ---- geometry surgery on the raw scan ----
     The scan is degenerate: two straight fingers along +Z, a diagonal prong
     at -X (renders screen-right), a horizontal protrusion at +X (renders
     screen-left) and two long artifact prongs along -Z. To read as an open
     palm ("stop"), we: clone one -Z prong into a RING finger, raise the
     diagonal prong so it reads as the PINKY, lift the +X protrusion into a
     THUMB, and compress the -Z prongs into one short floating wrist stump.
     Finally smooth vertex normals kill the flat-shaded faceting (the GLB
     ships no normals, so GLTFLoader defaults to flat shading). */
  const SMOOTH = (a, b, v) => {
    const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  function refineHandGeometry(geo) {
    const P = Array.from(geo.attributes.position.array);
    const U = Array.from(geo.attributes.uv.array);
    const I = Array.from(geo.index.array);
    const X = (i) => P[i * 3], Y = (i) => P[i * 3 + 1], Z = (i) => P[i * 3 + 2];

    /* 1 — clone the +X-side lower prong into a ring finger (mirror in z so
       the narrow tip points up, splay a touch toward -X, bury the open base
       edge inside the palm). Winding is reversed: the mirror flips it. */
    const inClone = (i) => Z(i) < -0.19 && X(i) > -0.05;
    const nTri = I.length;
    const map = new Map();
    const RC = -0.02, RDX = -0.215, RPX = -0.215, RPZ = 0.12, RS = 0.94, PSI = 0.13;
    const cs = Math.cos(PSI), sn = Math.sin(PSI);
    for (let t = 0; t < nTri; t += 3) {
      if (!(inClone(I[t]) && inClone(I[t + 1]) && inClone(I[t + 2]))) continue;
      for (let k = 0; k < 3; k++) {
        const o = I[t + k];
        if (!map.has(o)) {
          let x = X(o) + RDX, y = Y(o), z = RC - Z(o);
          const dx = (x - RPX) * RS, dz = (z - RPZ) * RS;
          x = RPX + dx * cs - dz * sn;
          z = RPZ + dx * sn + dz * cs;
          map.set(o, P.length / 3);
          P.push(x, y, z);
          U.push(U[o * 2], U[o * 2 + 1]);
        }
      }
      I.push(map.get(I[t]), map.get(I[t + 2]), map.get(I[t + 1]));
    }

    const nv0 = geo.attributes.position.count;
    for (let i = 0; i < nv0; i++) {
      let x = X(i), y = Y(i), z = Z(i);

      /* 2 — diagonal -X prong → pinky: rotate up ~32° about its base */
      if (x < -0.16 && z > 0.02 && z < 0.3) {
        const w = SMOOTH(-0.16, -0.2, x);
        const a = -0.56 * w, c = Math.cos(a), s = Math.sin(a);
        const dx = x + 0.17, dz = z - 0.12;
        x = -0.17 + dx * c - dz * s;
        z = 0.12 + dx * s + dz * c;
      }

      /* 3 — +X protrusion → thumb: rotate up ~30° about its base */
      if (x > 0.11 && z < 0.14) {
        const w = SMOOTH(0.11, 0.16, x);
        const a = 0.8 * w, c = Math.cos(a), s = Math.sin(a);
        const dx = x - 0.12, dz = z - 0.01;
        x = 0.12 + dx * c - dz * s;
        z = 0.01 + dx * s + dz * c;
      }

      /* 4 — the two -Z artifact prongs → one short tapered wrist stump that
         ends ON canvas, so the hand floats with the floor shadow visible */
      if (z < -0.155) {
        const u = Math.min(1, (-0.155 - z) / 0.345);
        z = -0.155 + (z + 0.155) * 0.38;
        x = -0.05 + (x + 0.05) * (1 - 0.85 * u);
        y = y * (1 - 0.6 * u * u);
      }

      P[i * 3] = x; P[i * 3 + 1] = y; P[i * 3 + 2] = z;
    }

    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    geo.setIndex(I);
    geo.computeVertexNormals();
    return nv0; // original vertex count — appended verts are the ring clone
  }

  /* Derive the 21 landmark anchors FROM the refined vertices, so every dot
     sits on the mesh: per digit, slice along its axis, take the slice
     centroid for x/z and the front (max-y) surface for the dot's height. */
  function meshLandmarks(geo, ringStart) {
    const P = geo.attributes.position.array;
    const nv = P.length / 3;
    const pick = (f) => {
      const out = [];
      for (let i = 0; i < nv; i++) {
        const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
        if (f(x, y, z, i)) out.push([x, y, z]);
      }
      return out;
    };
    /* chain(verts, axis 0=x 1=z, 4 param stations 0..1) → 4 joints */
    const chain = (verts, ax, stations) => {
      let lo = 1e9, hi = -1e9;
      verts.forEach((v) => { const p = v[ax * 2]; if (p < lo) lo = p; if (p > hi) hi = p; });
      return stations.map((t) => {
        const p0 = lo + (hi - lo) * t, hw = Math.max(0.028, (hi - lo) * 0.09);
        let sx = 0, sz = 0, n = 0, fy = -1;
        verts.forEach((v) => {
          if (Math.abs(v[ax * 2] - p0) > hw) return;
          sx += v[0]; sz += v[2]; n++;
          if (v[1] > fy) fy = v[1];
        });
        if (!n) return [p0, 0.06, p0];
        return [sx / n, fy + 0.015, sz / n];
      });
    };
    /* chainDir: joints along an arbitrary palm-plane direction (unit dx,dz)
       from a base point — for the diagonal pinky, which no axis box fits */
    const chainDir = (verts, bx, bz, dx, dz, stations) => {
      let smax = 0;
      const S = verts.map((v) => {
        const s = (v[0] - bx) * dx + (v[2] - bz) * dz;
        if (s > smax) smax = s;
        return s;
      });
      return stations.map((t) => {
        const s0 = smax * t, hw = Math.max(0.026, smax * 0.1);
        let sx = 0, sz = 0, n = 0, fy = -1;
        verts.forEach((v, i) => {
          if (Math.abs(S[i] - s0) > hw) return;
          sx += v[0]; sz += v[2]; n++;
          if (v[1] > fy) fy = v[1];
        });
        if (!n) return [bx + dx * s0, 0.06, bz + dz * s0];
        return [sx / n, fy + 0.015, sz / n];
      });
    };
    const orig = (i) => i < ringStart;
    const IDX = pick((x, y, z) => z > 0.17 && x > -0.06 && x < 0.08);
    const MID = pick((x, y, z, i) => z > 0.17 && x >= -0.175 && x <= -0.06 && orig(i));
    const RNG = pick((x, y, z, i) => i >= ringStart);
    const PNK = pick((x, y, z, i) => orig(i) && x < -0.17 && z > 0.09 && z < 0.3 &&
      (z < 0.19 || x < -0.205)); // keep clear of the middle finger's edge
    const THM = pick((x, y, z) => x > 0.135 && z > -0.06 && z < 0.16);
    const WRS = pick((x, y, z) => z > -0.26 && z < -0.18);
    const wrist = chain(WRS, 1, [0.5])[0];
    const ST = [0.04, 0.42, 0.7, 0.95];
    const LM = [wrist]
      .concat(chain(THM, 0, ST))
      .concat(chain(IDX, 1, ST))
      .concat(chain(MID, 1, ST))
      .concat(chain(RNG, 1, ST))
      .concat(chainDir(PNK, -0.175, 0.125, -0.69, 0.72, [0.06, 0.4, 0.68, 0.94]));
    return LM;
  }

  /* ---- real scanned hand ---- */
  function buildRealHand(gltf) {
    const inner = new THREE.Group();
    let refined = null; // { geo, ringStart }
    gltf.scene.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        if (o.geometry && o.geometry.index && !refined) {
          refined = { geo: o.geometry, ringStart: refineHandGeometry(o.geometry) };
        }
        if (o.material) {
          o.material.roughness = 0.55;
          o.material.metalness = 0.0;
          o.material.flatShading = false; // we just computed smooth normals
          o.material.needsUpdate = true;
        }
      }
    });
    /* mesh local axes (measured): X ±0.30 across the palm, Y ±0.07 thickness,
       Z ±0.50 along the fingers. rx-90 stands it up, rz180 turns the textured
       palm side toward the camera. Local → hand space: X=-3x, Y=3z+wrapY, Z=3y. */
    gltf.scene.rotation.set(0, 0, 0);
    inner.add(gltf.scene);
    inner.rotation.set(-Math.PI / 2, 0, Math.PI);
    const wrap = new THREE.Group();
    wrap.add(inner);
    wrap.scale.setScalar(3.0);
    const WRAP_Y = room ? 0.25 : -0.1; // room: wrist stump well above canvas bottom
    wrap.position.y = WRAP_Y;
    hand.add(wrap);

    /* 21 landmark anchors derived from the refined mesh itself (slice
       centroids + front surface), mapped local → hand space like the mesh */
    const LM = refined
      ? meshLandmarks(refined.geo, refined.ringStart)
      : [];
    const L = LM.map((p) => [-3 * p[0], 3 * p[2] + WRAP_Y, 3 * p[1]]);
    const TIP = { 4: 1, 8: 1, 12: 1, 16: 1, 20: 1 };
    L.forEach((p, i) => {
      landmark(hand, p[0], p[1], p[2],
        i === 0 ? 0.062 : (TIP[i] ? 0.058 : (i % 4 === 1 ? 0.048 : 0.042)),
        TIP[i] ? aquaDot : mintDot);
    });
    indexTip = landmarks[8];
    tipFlash = [landmarks[8]];

    /* press pulse: whole hand nudges toward the camera on the spring curve,
       the index fingertip flashes. No finger articulation — the scan is rigid. */
    applyPose = (t, pulse, idleAmp) => {
      hand.position.z = pulse * 0.42;
      const breathe = idleAmp * Math.sin(t * 1.05) * 0.015;
      wrap.rotation.z = breathe;
      const f = 1 + pulse * 0.9;
      tipFlash.forEach((m) => {
        m.scale.setScalar(1 + pulse * 0.45);
        m.userData.halo.scale.setScalar(f);
        m.userData.halo.material.opacity = 0.22 + pulse * 0.65;
      });
    };
  }

  /* ---- fallback: the stylized primitive hand (capsules + spheres) ---- */
  function buildPrimitiveHand() {
    const skin = new THREE.MeshStandardMaterial({ color: 0xEDF1FA, roughness: 0.38, metalness: 0.06 });

    const palm = new THREE.Mesh(new THREE.SphereGeometry(0.8, 40, 28), skin);
    palm.scale.set(1.0, 0.78, 0.42);
    palm.castShadow = true;
    hand.add(palm);

    const wrist = new THREE.Mesh(new THREE.CapsuleGeometry(0.38, 1.1, 6, 20), skin);
    wrist.position.set(0.02, -1.15, -0.05);
    wrist.rotation.z = 0.06;
    wrist.castShadow = true;
    hand.add(wrist);

    landmark(hand, 0, -0.62, 0.34, 0.062, mintDot); // 0 wrist

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
    landmark(thumb, 0, 0.04, 0.15, 0.045, mintDot);
    landmark(thumb, 0, 0.26, 0.15, 0.042, mintDot);
    landmark(tj2, 0, 0, 0.13, 0.042, mintDot);
    const thumbTip = landmark(tj2, 0, 0.38, 0, 0.058, aquaDot);
    hand.add(thumb);

    const fingers = [];
    function makeFinger(x, y, l1, l2, r1, r2, spread) {
      const root = new THREE.Group();
      root.position.set(x, y, 0.02);
      root.rotation.z = spread;
      const s1 = new THREE.Mesh(new THREE.CapsuleGeometry(r1, l1, 6, 18), skin);
      s1.position.y = l1 / 2 + r1 * 0.4;
      s1.castShadow = true;
      root.add(s1);
      landmark(root, 0, 0.02, r1 * 1.12, 0.048, mintDot);
      const j2 = new THREE.Group();
      j2.position.y = l1 + r1 * 0.8;
      root.add(j2);
      landmark(j2, 0, 0, r2 * 1.15, 0.042, mintDot);
      const s2 = new THREE.Mesh(new THREE.CapsuleGeometry(r2, l2, 6, 18), skin);
      s2.position.y = l2 / 2 + r2 * 0.35;
      s2.castShadow = true;
      j2.add(s2);
      landmark(j2, 0, l2 * 0.62, r2 * 1.1, 0.04, mintDot);
      const tip = landmark(j2, 0, l2 + r2 * 0.9, 0, 0.058, aquaDot);
      hand.add(root);
      return { root, j2, tip, spread };
    }
    fingers.push(makeFinger( 0.52, 0.52, 0.50, 0.42, 0.125, 0.108,  0.10));
    fingers.push(makeFinger( 0.175, 0.58, 0.56, 0.47, 0.13,  0.112,  0.02));
    fingers.push(makeFinger(-0.175, 0.56, 0.51, 0.43, 0.125, 0.108, -0.03));
    fingers.push(makeFinger(-0.52, 0.48, 0.38, 0.31, 0.11,  0.096, -0.12));
    indexTip = fingers[0].tip;
    tipFlash = [fingers[0].tip, thumbTip];

    const BASE_CURL_1 = 0.14, BASE_CURL_2 = 0.2;
    const PZ = { idx1: 0.92, idx2: 1.17, thZ: 0.58, thX: 0.68, thIp: 0.55, adduct: -0.58 };
    applyPose = (t, pinch, idleAmp) => {
      fingers.forEach((f, i) => {
        const sway = idleAmp * Math.sin(t * 1.25 + i * 0.9) * 0.05;
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
    };
  }

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

  /* ---------- load the scanned hand; fall back silently ---------- */
  let ready = false;
  function onHandReady() {
    ready = true;
    if (statik) {
      applyPose(0, 0.18, 0); // hint of a press reads as intentional
      hand.position.set(BASE.x, BASE.y + 0.03, 0.06);
    }
    render();
  }
  new GLTFLoader().load(
    new URL('./models/hand.glb', import.meta.url).href,
    (gltf) => { buildRealHand(gltf); onHandReady(); },
    undefined,
    () => { buildPrimitiveHand(); onHandReady(); }
  );

  /* ---------- static mode: one polished frame, no loop ---------- */
  if (statik) return { statik: true };

  /* ---------- interactive mode ---------- */
  const shadowEl = opts.shadowEl || null;
  const trackEl = host.closest('section') || host;
  const px = { c: BASE.x, v: 0, t: BASE.x };
  const py = { c: BASE.y, v: 0, t: BASE.y };

  trackEl.addEventListener('mousemove', (e) => {
    const r = sizeEl.getBoundingClientRect();
    const nx = (e.clientX - (r.left + r.width / 2)) / Math.max(r.width, 1);
    const ny = (e.clientY - (r.top + r.height / 2)) / Math.max(r.height, 1);
    /* travel kept short of the frame edges so the whole hand stays composed;
       in the room it also has to stay inside the light beam's pool */
    const lim = room ? 0.5 : 0.7;
    px.t = Math.max(-lim, Math.min(lim, nx * (room ? 1.1 : 1.5)));
    /* room: downward travel is short so the wrist stump never meets the
       canvas bottom — the hand must always float clear of its shadow */
    py.t = Math.max(room ? -0.24 : -0.42, Math.min(0.32, -ny * 1.1)) + BASE.y;
  });
  trackEl.addEventListener('mouseleave', () => { px.t = BASE.x; py.t = BASE.y; });

  let tNow = 0, last = performance.now();
  let pulseStart = -1;
  const PULSE_DUR = 0.62;
  /* case-study hero owns a choreography: it pulses on its own shortly after
     entering view, then every few seconds — a user click defers the next one */
  let nextAuto = opts.autoPulse ? 1.1 : Infinity;
  const triggerPulse = () => {
    if (pulseStart < 0 || tNow - pulseStart > PULSE_DUR * 0.6) pulseStart = tNow;
    if (opts.autoPulse) nextAuto = tNow + 4.6;
  };
  /* listen on the whole section: the copy column overlays part of the canvas,
     so a click anywhere on the scene (not on a link) should still pulse */
  trackEl.addEventListener('pointerdown', triggerPulse);
  sizeEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); triggerPulse(); }
  });

  let running = false, rafId = 0;
  const _vb = new THREE.Vector3();

  function frame() {
    rafId = requestAnimationFrame(frame);
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    tNow += dt;
    const t = tNow;
    if (t >= nextAuto && ready) triggerPulse();

    // spring toward the cursor — dt-scaled so 60Hz and 120Hz+ feel identical
    const s = dt * 60;
    px.v = (px.v + (px.t - px.c) * 0.085 * s) * Math.pow(0.82, s);
    py.v = (py.v + (py.t - py.c) * 0.085 * s) * Math.pow(0.82, s);
    px.c += px.v * s; py.c += py.v * s;

    hand.position.x = px.c;
    hand.position.y = py.c + Math.sin(t * 1.1) * 0.05;
    hand.rotation.y = BASE.ry + px.c * 0.22 + px.v * 1.6;
    hand.rotation.x = BASE.rx - (py.c - BASE.y) * 0.16 - py.v * 1.2;
    hand.rotation.z = BASE.rz - px.v * 1.4;

    /* the CSS floor shadow tracks the hand's drift — one cheap style write */
    if (shadowEl) {
      shadowEl.style.transform =
        'translateX(' + (px.c * 34).toFixed(1) + 'px) scale(' +
        (1 + (py.c - BASE.y) * 0.16).toFixed(3) + ')';
    }

    // press-pulse envelope: out and back
    let pulse = 0;
    if (pulseStart >= 0) {
      const p = (t - pulseStart) / PULSE_DUR;
      if (p >= 1) pulseStart = -1;
      else pulse = Math.sin(Math.PI * Math.min(p, 1));
    }
    applyPose(t, pulse, 1);

    // ripple feedback, emanating from the index fingertip landmark
    if (pulseStart >= 0 && indexTip) {
      hand.updateMatrixWorld(true);
      indexTip.getWorldPosition(_vb);
      ripple.position.copy(_vb);
      const p = (t - pulseStart) / PULSE_DUR;
      const e = EASE_OUT(Math.min(p, 1));
      ripple.scale.setScalar(0.5 + e * 2.0);
      /* fade is slower than the expansion so the ring stays readable
         through the middle of the pulse, not just the first frames */
      ripple.material.opacity = Math.max(0, 0.95 * Math.pow(1 - p, 1.4));
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
