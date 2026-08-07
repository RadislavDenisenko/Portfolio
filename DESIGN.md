# DESIGN.md — Radislav Denisenko, Portfolio

The background design system. Claude Design (and any AI tool) reads this before
touching a pixel. If a request conflicts with this file, this file wins unless I
say otherwise.

---

## 1. What this site is

A personal portfolio for a self-taught developer in North Port, Florida applying
for junior/entry-level roles. Two projects: AirMouse (shipped, downloadable) and
Roomly (honest work-in-progress).

**The single job of this page:** make a hiring manager click "Download for
Windows" on AirMouse, or email me.

**Primary viewer:** a technical hiring manager or engineer skimming for 40
seconds on a laptop, plus a non-technical recruiter on a phone. Both must
understand what I built without jargon.

**The page must prove, not claim.** No "passionate about clean code." The
projects do the talking, and the site itself is the third project.

---

## 2. Aesthetic direction

**Family:** Warm editorial × playful color. Printed-poster warmth, saturated
gradient panels, big serif display type.

**The thesis:** most junior portfolios are dark-mode with a neon accent, which
reads as a template. This one is warm paper with full-bleed color, so it looks
art-directed instead of generated.

**Non-negotiable:** every section is a full-viewport world with its own
gradient, but they sit on one shared paper ground and share one type system.
Color varies; structure never does.

---

## 3. Color

Ground and ink:

| Token | Hex | Use |
|---|---|---|
| `--paper` | `#FFF9F2` | page ground, warm not white |
| `--ink` | `#241B14` | all body text, warm near-black, never `#000` |
| `--muted` | `#6B5D51` | secondary text |

Accents (page-level):

| Token | Hex | Use |
|---|---|---|
| `--coral` | `#FF5A3C` | primary accent, links, hover |
| `--tangerine` | `#FFA62E` | hero warmth |
| `--violet` | `#7C5CFF` | hero cool balance |
| `--lime` | `#C8F542` | tracking-overlay highlights only |

Per-section gradient worlds — each panel gets three stops, never two:

- **Hero:** `#FFA62E` → `#FF5A3C` → `#7C5CFF` blobs on paper
- **AirMouse:** `#2049E6` → `#00B3C6` → `#2BD98F` (machine-vision blues/greens)
- **Roomly:** `#FF3D77` → `#FF7A3D` → `#FFB93D` (warm, human, dusk)
- **Contact:** `#5B2EE6` → `#B23DEB` → `#FF5A8C`

**Rules:**
- Pure black and pure white are banned as grounds. Warm off-tones only.
- White text on gradients must clear 4.5:1 — check the lightest stop, not the
  average.
- Film grain (SVG turbulence, ~16% opacity) sits over everything. This is what
  separates "printed" from "flat AI page." Do not remove it.
- No teal-on-dark. No purple-to-blue hero gradient on white. Those are the
  house styles of every AI-generated page.

---

## 4. Type

- **Display:** Fraunces (variable serif) — headlines, project names, weights
  ~560–590, `letter-spacing: -.02em`. Italic for the emphasized phrase, often
  with a coral→violet gradient clip.
- **Body:** Space Grotesk — everything readable. 16.5px base, 1.6 line-height.
- **Utility:** system monospace — eyebrows, tech tags, metadata. 11–13px,
  `letter-spacing: .24em`, uppercase.

**Rules:**
- Self-host every face as woff2 in `docs/assets/fonts/`. No CDN links — the CSP
  on published artifacts blocks them and GitHub Pages shouldn't wait on Google.
- Inter, Roboto, and Space Grotesk-as-display are banned. Space Grotesk is the
  body face here, not the headline face.
- Headlines get `text-wrap: balance`. Body copy caps at ~58 characters.
- Never use a font size not on the scale; use `clamp()` for anything display-size.

---

## 5. Layout & motion

- Full-viewport sections (`100svh`), one per project, scroll-snap **proximity**
  only. Never hijack scroll with JS — the user stays in control.
- Project panels: rounded 28px, gradient fill, two-column (copy left, live
  visual right), collapsing to one column under 920px.
- Radii are pills (100px) for controls, 20–28px for surfaces. No `rounded-lg`
  everywhere.
- **One signature animation per section, not five.** AirMouse gets the live hand
  skeleton with a fingertip-following cursor; Roomly gets the floating swipe
  card. Everything else enters the same way: fade + 24–34px rise, 600–700ms,
  `cubic-bezier(.22,.75,.25,1)`.
- Every animation needs a `prefers-reduced-motion: reduce` fallback that lands
  content visible and still.
- Reveal-on-scroll must have a timeout backstop so content can never be
  permanently invisible if IntersectionObserver never fires.

---

## 6. Voice

Short, plain, human. Never salesy.

- Describe what a thing *does* for a person, not how it's built. Stack names
  live in the tech tags, not in sentences.
- **AirMouse is shipped.** Say downloadable, released, 300+ automated tests.
- **Roomly is not.** Say "first working draft, being reworked, not launched
  yet." Never live, done, or polished. The button says "Follow the build," never
  "Try the demo."
- Education says "degree not completed." Honest beats impressive.
- Banned: "passionate," "cutting-edge," "leveraging," "seamless," emoji as
  section markers.

---

## 7. Build constraints

- Static HTML/CSS/JS in `docs/`, served by GitHub Pages from `main`. No build
  step, no framework, no dependencies.
- Vanilla JS only, feature-detected, degrades to visible content.
- Everything self-hosted. Zero third-party requests.
- Keyboard focus must be visibly styled. Mobile-first reflow is mandatory —
  recruiters open portfolios on phones.

---

## 8. Anti-slop checklist

Before shipping any change, confirm it is **not**:

- [ ] dark ground with one neon accent
- [ ] cream `#F4F1EA` + serif + terracotta (the AI house style)
- [ ] a purple→blue gradient hero on white
- [ ] three equal feature cards with an icon on each
- [ ] centered everything
- [ ] emoji headers, or `01 / 02 / 03` numbering on things that aren't a sequence
- [ ] copy that claims skill instead of showing work
