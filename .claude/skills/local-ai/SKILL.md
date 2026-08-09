---
name: local-ai
description: >
  Generate images, textures and video for this portfolio on Radislav's own PC using
  ComfyUI and locally downloaded models, instead of a paid cloud API. Use when a task
  needs a new visual asset — a room background, a skin or material texture, a hero
  video loop, an og:image — and the session is running on his desktop with the GPU.
  Also use when the user says "use my local models", "use ComfyUI", or "generate it
  locally". Do NOT use in a cloud session: there is no GPU and no route to his machine
  there — say so and use a cloud generation MCP server instead.
---

# Local AI generation

Radislav's desktop runs ComfyUI with locally downloaded models. A session running ON
that machine can generate assets for free instead of spending cloud credits.

## Hardware ceiling — plan around it

RTX 4070 Ti (**12GB VRAM**) · **32GB system RAM** · i7-14KF · NVMe.

- 12GB VRAM is the hard wall. Pick quantized model variants (NVFP4 / pruned INT8),
  never full-precision.
- Large video models offload to system RAM, which wants ~64GB. On 32GB, big video
  generations will thrash or fail. Prefer images; keep video short and low-res.
- Enable Sage Attention for roughly 2x faster generation: launch ComfyUI with
  `--use-sage-attention`.

## First run on a new machine

Fill these in the first time, then keep them here so future sessions skip the hunt:

- ComfyUI install path: `<TODO: e.g. C:\ComfyUI_windows_portable>`
- Launch command: `<TODO: e.g. .\run_nvidia_gpu.bat>` (add `--use-sage-attention`)
- API endpoint: usually `http://127.0.0.1:8188`
- Installed checkpoints worth using: `<TODO: list from ComfyUI/models/checkpoints>`

## Driving it

ComfyUI has an HTTP API — no GUI clicking needed:

- `POST /prompt` with a workflow JSON to queue a job
- `GET /history/{prompt_id}` to poll for completion
- `GET /view?filename=...` to fetch the result

Export a workflow from the GUI once (**Workflow → Export (API)**), save it under
`tools/comfy/`, then edit its prompt/seed fields and POST it. Reusing a saved workflow
beats hand-building node graphs.

Check ComfyUI is up before generating: `curl http://127.0.0.1:8188/system_stats`.
If it fails, start it and wait for the port rather than reporting failure.

## What this project actually needs

**Backgrounds** (e.g. `docs/assets/img/airmouse-room.jpg`) — cinematic room photos.
Prompt for the empty scene: generate the room *without* the subject, because the
subject is live 3D on top. Export ~1400px wide, JPEG q82, target under 100KB.

**Material textures** — this is the high-value one. Generate a flat, evenly lit macro
texture (no shadows, no directional light), then run:

```bash
python3 tools/make_hand_maps.py     # albedo + normal + roughness, baked to the UVs
```

Baked-in lighting is what makes 3D look like putty; the tool divides it out.

**Hero video** — 6-10s seamless loop, under 4MB, no text baked in (text lives in HTML
so it stays crisp). Keep resolution modest given the RAM ceiling.

## Rules

- Optimize before committing. Every asset counts against the 600KB page budget in
  `CLAUDE.md`.
- Assets live in `docs/assets/`, committed to the repo — never hotlinked.
- Look at what you generated before using it. Re-prompt if it is wrong; a bad asset
  shipped is worse than a slow one.
- Generating for 3D reconstruction? Spread the subject clearly (fingers wide apart,
  even lighting, plain background). Reconstruction fails on ambiguity.
