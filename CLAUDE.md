# Portfolio — project context

Personal portfolio for Radislav Denisenko, self-taught developer in North Port, FL,
applying for junior/entry-level roles. Its one job: get a hiring manager to download
AirMouse or send an email.

**`DESIGN.md` is the design system and it is law.** Read it before changing anything
visual. If a request conflicts with it, the request wins — then update `DESIGN.md`.

## Layout

- `docs/` — the whole site. GitHub Pages serves this from `main`.
  - `index.html` · `assets/site.css` · `assets/site.js`
  - `assets/hand.js` — the 3D hand (Three.js ES module, lazy-loaded)
  - `assets/vendor/` — Three.js, vendored locally. No CDNs, ever.
  - `assets/img/` — room background, skin PBR maps, screenshots
  - `airmouse/` — the AirMouse case study page
- `tools/make_hand_maps.py` — bakes the hand's creases, knuckle lines and skin grain
  onto the model's own UV layout, so detail lands on the anatomy instead of tiling
- `prompts/design-discovery.md` — the interview prompt for starting a new design

Working branch: `claude/portfolio-website-design-gtyyvt`.

## Facts (never invent, never overstate)

- **AirMouse** — SHIPPED Windows app, v0.9. Webcam becomes a mouse: 21 hand landmarks
  at 30fps driving the real cursor via Win32 SendInput. 300+ automated tests.
  Python · MediaPipe · OpenCV · Win32.
- **Roomly** — a first working draft, being reworked. NOT launched. Never call it live
  or polished. Its button says "Follow the build".
- Education says "degree not completed". Comcast cable technician since Oct 2023.
- Banned words: passionate, seamless, cutting-edge, "coming soon".

## Hard constraints

Zero third-party requests at runtime · console stays clean · total page transfer
under 600KB · keyboard focus visible on every background · `prefers-reduced-motion`
lands everything visible and still · no horizontal scroll at 390px · static HTML/CSS/JS
with no build step.

## Verifying visual work

Never claim a visual change works without looking at it:

```bash
cd docs && python3 -m http.server 8080 &
# then screenshot with Playwright and READ the image back
```

Chromium is preinstalled at `/opt/pw-browsers/` in cloud sessions; locally use
whatever browser automation is available. Always check console errors too.

## Generating assets

Assets are generated, not hand-drawn. See `.claude/skills/local-ai/SKILL.md` for the
local GPU pipeline (ComfyUI). Cloud sessions may have a Higgsfield MCP server instead.
Either way: generate → optimize → commit into `docs/assets/`, and keep the page under
budget.
