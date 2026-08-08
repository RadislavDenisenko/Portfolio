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
   The skeleton is drawn THROUGH the hand rather than depth-tested: an
   instrumentation layer is either drawn or it isn't, and half-buried
   connectors emerge from under the mesh and die in mid-palm. Every additive
   overlay uses CustomBlending that adds RGB but not alpha: plain additive
   blending on an alpha canvas attenuates the room photo as much as it lights
   it, and a cyan glow arrives as grey haze. Skin is MeshPhysicalMaterial —
   warm mid tone, sheen, a whisper of clearcoat, plus tileable
   albedo/normal/roughness maps — under ACES filmic tone mapping. Those maps
   are **synthesised, not photographic** (tools/make_skin_maps.py, 3 × 256px,
   66KB): a cellular micro-furrow network with a mean flattened to under 1%
   block-to-block, because the macro-of-a-palm they were derived from contained
   only 20–40mm flexion creases, and tiled at any repeat those lined up
   tile-to-tile into a plaid — the hand read as burlap.

   **Light is measured off the plate, never dialled by eye.** That photograph
   has median luma 41 and p95 125; its brightest surface is the pool the beam
   makes on the floor at #5E6D76. So: the key is a shadow-casting spot that
   TRAVELS across the hand from the upper left and passes behind it (the
   housing is at 22%/10% of the plate, its pool at 55%/88%) — never one that
   faces the hand, which brightens both silhouettes and leaves the centre dark,
   the signature of a ring light. Skin's median sits near the plate's own upper
   range rather than above the brightest thing the beam can make, and the
   terminator runs down the palm. Nothing warm is ever *added*: skin's albedo is
   warm enough (R/B = 1.32) that neutral and even cool light returns warm, and
   this room contains no warm source. The PMREM environment is BUILT from the
   plate's sampled values with the beam, the wall tube and the floor in their
   real directions — feeding a 1.79:1 rectilinear photo to an equirectangular
   mapping smears it over 360°, and the near-black patches it lands on turn
   shadowed skin slate-teal. Fingertip translucency is baked into the vertex
   colours, not faked with a lamp; a light cannot express thickness, and one
   aimed from below only ever paints an orange ring at each knuckle. The
   forearm fades out of frame instead of ending in a stump — vertex alpha plus a
   mask on the canvas, since the plate's floor mist only covers the terminus at
   desktop crops. The floor shadow is a CSS **cast** shadow raking down-beam,
   offset and skewed, not a centred puddle (a puddle is a light directly
   overhead, which contradicts the plate). Copy sits directly on the scene
   behind a left scrim (≥4.5:1 verified); spec chips are glass pills, and the
   secondary button takes the system's on-dark `.btn-outline-light` treatment —
   the paper-ground `.btn-ghost` fill makes the secondary action the brightest
   object in a night photograph. On phones the copy is cut to fit ABOVE the
   hand (two sentences, chips collapse to one mono line, Case study becomes an
   inline link) so the 3D object the section exists for gets ~46% of the
   viewport instead of a cropped bottom quarter. The stacked layout sizes the
   hand from the space the copy leaves (`--handH`), not from `svh` alone — a
   fixed fraction plus the copy adds up to more than a short landscape tablet
   has, and the section grows past the fold taking the hand with it. Three.js
   ships as one tree-shaken vendored bundle rebuilt from
   tools/three-bundle-entry.js (529KB, ~133KB gzipped — down from the 754KB of
   three + GLTFLoader + hand.glb the scanned mesh needed, all three of which are
   now deleted), lazy-loaded; static open-palm frame on coarse-pointer devices and under
   reduced motion, and a real 21-landmark SVG diagram (with matching label and
   caption) where WebGL is unavailable — never a button that announces a pinch
   demo and does nothing. The airmouse/ case study reuses the same module on its
   framed navy stage, whose backdrop glow is a CSS gradient rather than a disc
   in the scene: a disc has a silhouette, and it cut a hard arc across the
   stage corner. Palette: navy room + aqua + mint.
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
focus visible on every ground, mobile-first reflow.
Console stays clean (no deprecation warnings). `og:image` ships so pasted links
unfurl with a card.

**Page weight ≤ 600KB transfer**, and "transfer" means what crosses the wire.
Measured request-by-request on the built tree, everything lazy included:

| page | requests | third-party | bytes on disk | over the wire |
|---|---|---|---|---|
| `/` | 11 | 0 | 852KB | **370KB** |
| `/airmouse/` | 13 | 0 | 904KB | **414KB** |

The budget is met on the wire and *not* met on disk, so both are written down.
The gap is `Content-Encoding: gzip`, which GitHub Pages applies to text —
a host behaviour this repo does not control and could not verify from the build
sandbox, so it is stated as the assumption it is rather than folded silently
into one flattering number. 62% of `/` is the three.js bundle, which is why
nothing else may be careless: in the same pass that fixed how they *looked*,
the skin maps went 512px → 256px and photographic → synthesised, 146KB → 66KB.

Live spec with rendered swatches, worlds and motion demos:
https://claude.ai/code/artifact/25179477-9f96-42a7-9165-d0a3f26959fc
