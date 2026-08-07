# DESIGN.md — Radislav Denisenko, Portfolio (v2)

Bright ground. Three color worlds. Résumé first — this site's job is to get a
hiring manager to download AirMouse or email me. Fun and professional at once.

## Foundation
- Paper `#FAF8F4` page ground · White `#FFFFFF` surfaces · Ink `#101014` text
- Soft `#63636E` secondary · Hairline `#E8E4DC` borders
- Never pure black grounds. Dark appears only inside framed demo stages (`#0E1230`).

## Accents (2–3 per section, never all at once)
- Cobalt `#2B5CFF` — site primary: buttons, links, focus rings
- Sun `#FFC838` · Candy `#FF4F79` · Mint `#26D9A3` · Aqua `#00B4E6` · Coral `#FF6247`

## Type
- Display: General Sans / Cabinet Grotesk class — bold, tight (-.03em)
- Body: Inter Tight or Instrument Sans, 16px, max 58ch
- Mono: JetBrains Mono — eyebrows, tags, spec labels
- All self-hosted woff2. No CDN fonts.

## Structure
Full-viewport section per project, scroll-snap proximity (never JS-hijacked):
1. **Hero** — generated video loop (6–10s, <4MB) inside a large rounded white-framed
   stage on the bright ground. Headline letters spring in; frame tilts toward cursor.
   Palette: paper + cobalt + sun.
2. **AirMouse** — Three.js realistic hand on a navy stage that follows the visitor's
   cursor with spring lag; pinch animation on click. GLB ≤2MB, lazy-loaded, static
   poster on mobile. Palette: navy stage + aqua + mint landmarks.
3. **Roomly** — swipe-card stack that tears the top card off on a loop. Honest copy:
   first working draft, being reworked, not launched. Palette: white + coral + sun.
4. **Contact** — short, cobalt CTA.

## Motion
- One curve: `cubic-bezier(.32,1.25,.4,1)` (slight overshoot = fun, not corporate)
- Enter: fade + 28px rise, 500ms, 60ms stagger. Hover: lift −3px, scale 1.03,
  colored shadow in the element's own accent.
- One signature animation per section. `prefers-reduced-motion`: everything lands
  visible and still.

## Voice
Short, human, honest. AirMouse is shipped (300+ tests). Roomly is a draft.
Education says "degree not completed". Banned: passionate, seamless, cutting-edge.

## Build
Static HTML/CSS/JS in `docs/`, GitHub Pages, zero third-party requests, keyboard
focus visible, mobile-first reflow.

Live spec with rendered swatches, worlds and motion demos:
https://claude.ai/code/artifact/25179477-9f96-42a7-9165-d0a3f26959fc
