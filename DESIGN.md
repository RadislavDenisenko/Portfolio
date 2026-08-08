# DESIGN.md — Radislav Denisenko, Portfolio (v2.1)

Bright ground. Three color worlds. Résumé first — this site's job is to get a
hiring manager to download AirMouse or email me. Fun and professional at once.

## Foundation
- Paper `#FAF8F4` page ground · White `#FFFFFF` surfaces · Ink `#101014` text
- Soft `#63636E` secondary · Hairline `#E8E4DC` borders
- Never pure black grounds. Dark appears only inside framed demo stages (`#0E1230`).
  **Documented exception (owner decision):** project-world *scenes* — currently
  the homepage AirMouse room — may go full-bleed dark: an unframed 100svh
  cinematic photo ground with copy sitting directly on a scrim.

## Accents (2–3 per section, never all at once)
- Cobalt `#2B5CFF` — site primary: buttons, links, focus rings
- Sun `#FFC838` · Candy `#FF4F79` · Mint `#26D9A3` · Aqua `#00B4E6` · Coral `#FF6247`

### Derived tints (the only off-palette values allowed)
- Cobalt-lift `#5478FF` — highlight stop inside cobalt gradient cards
- Navy-2 `#1B2456` (+ `#18204A` in the 3D scene) — inner glow of navy stages
- Stage fill `#EEF1FB` — hero stage ground
- Roomly photo gradients blend only within the coral↔sun family
  (`#FF8A5C`, `#FF9A4A`, `#FFB55C`)
- Everything else derives via `color-mix()` from the tokens above.

## Type
- One family: **Space Grotesk** (self-hosted, 300–700) does display *and* body —
  a deliberate single-voice choice. Display bold, tight (-.03em). Body 16px, max 58ch.
- Mono: **JetBrains Mono** (self-hosted woff2) — eyebrows, tags, spec labels.
- All self-hosted woff2. No CDN fonts. No unused font files in the deploy.

## Scales
- Space: 4 / 8 / 12 / 16 / 20 / 24 / 32 / 48 / 64 (4px grid).
- Type: 11 / 12 / 13 / 14 / 15 / 16 / 18 whole-px, plus fluid `clamp()` display sizes.

## Structure
Full-viewport section per project, scroll-snap proximity (never JS-hijacked):
1. **Hero** — the AirMouse pointer story as a zero-weight pure-CSS demo inside a
   large rounded white-framed stage: a cursor travels a mock UI, pinch-clicks a
   button, flips a toggle. Headline letters spring in; frame tilts toward cursor.
   Never ship placeholder copy ("coming soon") anywhere on the page.
   Palette: paper + cobalt + sun.
2. **AirMouse** — a full-bleed 100svh cinematic room scene (owner decision, the
   framed-stage exception above): a moody blue room photo where a surveillance
   camera (blinking CSS REC dot on its housing) casts a volumetric beam onto
   the floor. Floating in the beam on a transparent canvas: a **procedural
   rigged hand we generate in code — no GLB, no scan**. A lofted
   superellipse palm with real muscle relief (thenar, hypothenar, knuckle pads),
   four three-bone fingers and an opposed three-bone thumb, each segment
   parented to its own joint group. It is a RIGHT hand shown palm-first, so the
   thumb is on the viewer's right. Anthropometric phalanx lengths and a
   metacarpal arch that descends from the middle, so middle > ring ≈ index >
   pinky reads right. Joints swell into knuckles and the shafts waist between
   them; fingertips narrow and then fatten into a palmar pulp. The anatomy the
   tiling skin map cannot supply is baked into the vertex colours and the loft
   itself: palmar creases cut into the form as well as darkened, flexion creases
   at every knuckle, low-frequency pad whorls on the fingertips. Rest pose is an
   open palm to the viewer; it follows the cursor with spring lag plus a
   per-finger sway, breathes when idle, and **click / Enter is a real pinch** —
   the index curls to a textbook 45/54/17° tip pinch and the thumb swings up and
   across until the two pads touch. The thumb angles are solved against the rig
   at build time, and what is measured is the SURFACE gap between the two distal
   phalanges (each sampled as the tapered capsule the loft actually builds), not
   the distance between landmarks — landmarks live under the skin, so closing
   *them* buries one finger inside the other. Retune the anatomy and the thumb
   re-finds contact; if it ever cannot reach, the module says so in the console.
   That's the product's actual click gesture, so the copy says so. All 21
   landmarks are children of the rig's joints — anatomically exact by
   construction and they track the pinch — sitting proud of the surface on the
   pad normal, with soft radial-gradient halos and an aqua skeleton overlay.
   Every additive overlay uses CustomBlending that adds RGB but not alpha:
   plain additive blending on an alpha canvas attenuates the room photo as much
   as it lights it, and a cyan glow arrives as grey haze. Skin is
   MeshPhysicalMaterial — warm mid tone, sheen, a whisper of clearcoat, plus
   tileable albedo/normal/roughness maps (at a low repeat, so no tile is
   countable) and a PMREM environment derived from the room photo — under ACES
   filmic tone mapping. The key is a shadow-casting spot from the beam side, so
   the fingers shade each other and the forearm fades out of frame instead of
   ending in a stump; the fill is a COOL room bounce, because in a navy room the
   shadow side has to be cooler than the light, and the key and exposure come
   down on phone widths where the hand sits below the beam. Copy sits directly
   on the scene behind a left scrim (≥4.5:1 verified); spec chips are glass
   pills. Three.js ships as one tree-shaken vendored bundle (531KB, ~133KB
   gzipped, rebuilt from tools/three-bundle-entry.js) — down from 754KB of
   three + GLTFLoader + hand.glb before the scan was deleted — lazy-loaded;
   static open-palm frame on coarse-pointer devices and under reduced motion.
   The airmouse/ case study reuses the same module on its framed navy stage.
   Palette: navy room + aqua + mint.
3. **Roomly** — swipe-card stack that tears the top card off on a loop, clipped
   inside its own area (never across copy). Honest copy: first working draft,
   being reworked, not launched. Palette: white + coral + sun (two accent
   families max in this world).
4. **Contact** — short, cobalt CTA. On cobalt/navy surfaces the focus ring is
   white with a dark halo; body text on cobalt is ≥ .95 white.

## Motion
- One curve: `cubic-bezier(.32,1.25,.4,1)` (slight overshoot = fun, not corporate)
- Enter: fade + 28px rise, 500ms, 60ms stagger — and the stagger delay is cleared
  after entry so hover transitions start instantly. Interactivity keys off
  `(any-pointer: fine)`, never `ontouchstart`.
- Hover: lift −3px, scale 1.03, colored shadow in the element's own accent.
  Documented exception: ghost / on-blue buttons use a neutral ink/navy shadow.
- One signature animation per section. `prefers-reduced-motion`: everything lands
  visible and still. With JS unavailable, everything is simply visible.

## Voice
Short, human, honest. AirMouse is shipped (300+ tests, v0.9). Roomly is a draft
("The idea:" before any feature talk). Education says "degree not completed".
Stack names live in tags/spec chips, not in lead copy.
Banned: passionate, seamless, cutting-edge, "coming soon".

## Build
Static HTML/CSS/JS in `docs/`, GitHub Pages, zero third-party requests, keyboard
focus visible on every ground, mobile-first reflow. Page weight ≤ 600KB transfer.
Console stays clean (no deprecation warnings). `og:image` ships so pasted links
unfurl with a card.

Live spec with rendered swatches, worlds and motion demos:
https://claude.ai/code/artifact/25179477-9f96-42a7-9165-d0a3f26959fc
