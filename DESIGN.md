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
   the floor. The Three.js real scanned hand (hand.glb, 146KB, single static
   mesh — unrigged, so no fake finger articulation) floats in the beam on a
   transparent canvas, palm to the viewer, lit neutral-white so its own texture
   reads as skin, with an aqua rim from the beam side and a CSS ellipse shadow
   on the floor. It follows the visitor's cursor with spring lag; click = a
   press pulse toward the camera with an index-fingertip flash + ripple. All 21
   landmarks rendered proud of the surface with an aqua skeleton overlay, so
   the tracking story reads at a glance. Copy sits directly on the scene behind
   a left scrim (≥4.5:1 verified); spec chips are glass pills. If the GLB
   fails, the stylized primitive hand (capsules + spheres) steps in silently.
   Three.js + GLTFLoader ship as tree-shaken vendored bundles, lazy-loaded;
   static poster on coarse-pointer devices. The airmouse/ case study keeps the
   framed navy stage. Palette: navy room + aqua + mint.
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
