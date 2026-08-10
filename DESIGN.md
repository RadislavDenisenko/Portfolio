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
- Fern `#2F6F4A` · Brick `#8E3B2F` — Roomly's pair (owner direction: planted
  apartment, green leading, brick as the note it sits against)

### Derived tints (the only off-palette values allowed)
- Cobalt-lift `#5478FF` — highlight stop inside cobalt gradient cards
- Navy-2 `#1B2456` (+ `#18204A` in the 3D scene) — inner glow of navy stages
- Stage fill `#EEF1FB` — hero stage ground
- Roomly blends only within the fern↔brick family: Fern-lift `#4E9468`,
  Sage `#7DA96F`, Olive `#5B7F4A` (the bridge from green into brick),
  Brick-lift `#A9564A`, Loam `#F2F5EC` (the section's green-washed ground)
- Everything else derives via `color-mix()` from the tokens above.

## Type
- One family: **Space Grotesk** (self-hosted, 300–700) does display *and* body —
  a deliberate single-voice choice. Display bold, tight (-.03em). Body 16px, max 58ch.
- Mono: **JetBrains Mono** (self-hosted woff2) — eyebrows, tags, spec labels.
- All self-hosted woff2. No CDN fonts. No unused font files in the deploy.

## Scales
- Space: 4 / 8 / 12 / 16 / 20 / 24 / 32 / 48 / 64 (4px grid).
- Type: 11 / 12 / 13 / 14 / 15 / 16 / 18 whole-px, plus fluid `clamp()` display sizes.

**Nothing stops growing at a laptop.** Every `clamp()` ceiling here used to cap
out around a 1350px viewport, and the column was a flat `max-width:1160px`. On a
27" display at 2560 that is a 1160px column with ~700px of dead margin a side and
a headline frozen at 66px — the single thing on this site that read as generated
rather than designed. The column is `clamp(1160px,82vw,1880px)` and the display
ceilings are set so type is still climbing at 2560: hero 112px, project 92px,
scene 104px, contact 88px, body 24-26px. Measured across the range the hero runs
40 / 63 / 71 / 94 / 112px at 390 / 1280 / 1440 / 1920 / 2560+.

Widening the column is safe because **line length is held by the `ch` measures,
not by the container** — 22ch on the hero headline, 58ch on body copy. Those are
what stop a wide viewport from turning a paragraph into a ticker, so they stay
whatever the column does. Display text gets `text-wrap:balance`; at these sizes
the last line otherwise arrives as a single orphaned word.

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
   the floor. Floating in the beam on a transparent canvas: a **modelled,
   rigged reference hand wearing maps we bake ourselves**. The mesh is the MIT
   WebXR hand skeleton (25 named joints, 1360 vertices, 94KB); it replaced
   ~1450 lines of procedural lofting that never got past "mannequin in a glove",
   because a mesh a human modelled already has the knuckle arc, the digit taper
   and the thumb mass right. It is a LEFT hand shown palm-first, so the thumb is
   on the viewer's right. We do not skin it per joint at runtime: the section
   shows one open-palm pose and the bind pose IS that pose. So the rendered hand
   does not pinch, and no copy near it claims it does — "pinch to click" on the
   page is a fact about the Windows app, which is true, not a caption on the
   demo. The rig is still read, because the 21
   MediaPipe landmarks are exactly where its joints say they are.

   **The hand turns on its wrist, not on a stick.** The cursor rotation is
   applied per vertex, ramped in with a smoothstep across the wrist over 0.034
   model units: the forearm stub below holds still while the hand pivots on it.
   Rotating the whole group instead — which is what a rigid transform does —
   swings the forearm along with the hand, and the eye reads that instantly as a
   prop being waved. The fingers then chase the palm on a second, slightly
   softer spring, so they set off after it and settle after it. That lag is
   tuned to about 7 degrees on a full-width flick, which is roughly what a hand
   yields; a slower spring measured 21 degrees and the hand turned to rubber.
   It breathes when idle so it is never frozen. All of it costs 0.024ms a frame,
   because everything that varies across the hand varies with one number —
   distance along the wrist-to-fingertip axis — so 32 rotation matrices get
   built per frame and every vertex is a lookup.

   All 21 landmarks are placed from the rig's joints — anatomically exact by
   construction — and they ride the same per-vertex transform as the skin, so
   they stay glued to it through the bend. Soft radial-gradient halos, aqua
   skeleton overlay. The skeleton is drawn THROUGH the hand rather than depth-tested: an
   instrumentation layer is either drawn or it isn't, and half-buried
   connectors emerge from under the mesh and die in mid-palm. Every additive
   overlay uses CustomBlending that adds RGB but not alpha: plain additive
   blending on an alpha canvas attenuates the room photo as much as it lights
   it, and a cyan glow arrives as grey haze. Skin is MeshPhysicalMaterial —
   warm mid tone, sheen, a whisper of clearcoat, plus albedo/normal/roughness
   maps — under ACES filmic tone mapping. Those maps are **baked to the model's
   own UV layout, not tiled** (tools/make_hand_maps.py, 1024px, 120KB): the tool
   rasterises the UVs to recover the 3D point behind every texel, then writes
   each crease where the rig's joints say it belongs — a flexion band at every
   finger joint, the three palm lines struck through the joint anchors, softer
   knuckle lines on the back. A tiled detail map cannot do this: a crease is
   anatomy, not surface noise, and at any repeat the 20–40mm creases in a
   macro-of-a-palm line up tile-to-tile into a plaid — the hand read as lizard
   skin. Grain is the one thing still synthesised, sampled from model space so
   it stays one size across islands of different density, and it lives in
   roughness only: in a JPEG normal map its block artefacts amplify into crust.
   Palm-side detail is masked by the surface normal, so nothing bleeds onto the
   back of the hand, and the pose is yawed palm-forward — the model is a LEFT
   hand, so palm-forward puts the thumb on the right.

   **Light is measured off the plate, never dialled by eye.** The plate has
   median luma 39 and p90 96; its brightest surface is the pool the beam makes
   on the floor. The rule that follows from that: **skin's median sits near the
   plate's own upper range, never above it.** It once sat at 135 against a plate
   p90 of 91 — brighter than 90% of the room it was standing in, shading across
   only 2:1 where a beanbag two feet away in the same photograph shades across
   21 — and no amount of crease detail rescues an object lit like that; it reads
   as pasted on. The ambient was doing it, so the hemisphere came down from 1.05
   to 0.16 and the key went up, which darkens the shadow side without dimming
   the lit one. Measured after: median 97 against p90 91, a ratio of 1.07. A
   flat palm facing the camera will never reach a sphere's terminator, so the
   ratio to the plate is the number to hold, not the internal range. Nothing
   warm is ever *added*: skin's albedo is warm enough that neutral and even cool
   light returns warm, and this room contains no warm source — the key is white,
   the rim and fill are blue. Fingertip and knuckle redness is **pigment in the
   albedo map**, not a lamp: a light cannot express thickness, and one aimed
   from below only ever paints an orange ring at each knuckle. The forearm is
   masked out at the bottom of the stage in CSS rather than ending in a lit
   stump. The floor shadow is a CSS **cast** shadow raking down-beam,
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
   being reworked, not launched — the button says "Follow the build", never
   "coming soon". Palette: **fern + brick on a loam ground** (owner direction).
   Green leads and brick answers: three of the four listing cards are
   green-dominant and one is brick, and the brick one is deliberately the card
   that peeks from behind the top of the stack, so both colours are in the
   resting composition instead of brick only turning up mid-animation. The
   section carries its own washed ground rather than only recoloured buttons —
   that is what makes it a world instead of a theme — but it stays a BRIGHT
   ground: the full-bleed dark exception belongs to AirMouse alone.
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
