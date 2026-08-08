"""Generate the tileable skin micro-surface maps (albedo / normal / roughness).

These used to be derived from one generated skin photograph. That photo was a
macro of a PALM, so its content was a handful of long, high-contrast flexion
creases — features 20–40 mm wide. Tiled at 4-something repeats per 40 mm object
unit, those long diagonals lined up tile-to-tile into a plaid: the hand read as
burlap, not skin. The low-frequency luminance ramp left in the photo (6.6 %
block-to-block) drew the grid even harder.

So the maps are synthesised now, from the structure real skin actually has at
this scale and nothing else:

  · a Worley (cellular) F2−F1 network — the polygonal micro-furrows that cover
    every square millimetre of skin. Points are placed on a wrapped torus, so
    the network is seamless by construction rather than by edge-blending.
  · sparse pores sunk at the furrow junctions, where they really sit.
  · a little band-limited noise so the cells are not all the same depth.

Nothing in the tile is bigger than one cell, and the mean is flattened to well
under 1 % block-to-block, so no tile boundary and no cell row can line up into a
readable pattern at any repeat. 256 px is plenty: at the shipped repeat one tile
covers ~8.7 mm, which the page renders across ~44 device pixels — the map is
~6x oversampled, and dropping from 512 saves ~100 KB of transfer.

Deterministic (fixed seed): re-running reproduces the shipped bytes.
Run from the repo root:  python3 tools/make_skin_maps.py
"""
import os

import numpy as np
from PIL import Image, ImageFilter

OUT = 'docs/assets/img'
SIZE = 256          # one tile ≈ 8.7 mm of skin at the shipped repeat
CELLS = 30          # secondary furrows across the tile → ~0.3 mm each
COARSE = 13         # primary furrows — real skin has both, at ~2:1
SEED = 20260808


def worley(size, cells, rng):
    """F2−F1 cellular ridges on a torus → a seamless micro-furrow network."""
    pts = (np.stack(np.meshgrid(np.arange(cells), np.arange(cells)), -1)
           .reshape(-1, 2).astype(np.float32) + rng.uniform(0.08, 0.92, (cells * cells, 2)))
    pts /= cells
    # 3x3 wrap so distances measured near an edge see the tile's other side
    off = np.array([[i, j] for i in (-1, 0, 1) for j in (-1, 0, 1)], np.float32)
    tiled = (pts[None, :, :] + off[:, None, :]).reshape(-1, 2)

    ax = (np.arange(size, dtype=np.float32) + 0.5) / size
    f1 = np.empty((size, size), np.float32)
    f2 = np.empty((size, size), np.float32)
    step = 16
    for y0 in range(0, size, step):
        ys = ax[y0:y0 + step]
        gx, gy = np.meshgrid(ax, ys)
        p = np.stack([gx, gy], -1).reshape(-1, 1, 2)
        d = np.linalg.norm(p - tiled[None, :, :], axis=2)
        part = np.partition(d, 1, axis=1)[:, :2]
        part.sort(axis=1)
        f1[y0:y0 + step] = part[:, 0].reshape(len(ys), size)
        f2[y0:y0 + step] = part[:, 1].reshape(len(ys), size)
    ridge = f2 - f1                       # 0 on a cell wall, large mid-cell
    return ridge / ridge.max()


def noise(size, scale, rng):
    """Band-limited value noise, tileable (built small, then wrapped-blurred)."""
    n = rng.random((size, size)).astype(np.float32)
    im = Image.fromarray((n * 255).astype(np.uint8))
    # wrap by tiling 3x3, blurring, then cropping the centre
    big = Image.new('L', (size * 3, size * 3))
    for i in range(3):
        for j in range(3):
            big.paste(im, (i * size, j * size))
    big = big.filter(ImageFilter.GaussianBlur(scale))
    a = np.asarray(big.crop((size, size, size * 2, size * 2))).astype(np.float32) / 255.0
    a -= a.mean()
    m = np.abs(a).max()
    return a / m if m > 1e-6 else a


def flatten(h, size):
    """Remove any residual low-frequency drift, so tile-to-tile mean is flat."""
    im = Image.fromarray(np.clip(h * 255, 0, 255).astype(np.uint8))
    big = Image.new('L', (size * 3, size * 3))
    for i in range(3):
        for j in range(3):
            big.paste(im, (i * size, j * size))
    low = np.asarray(big.filter(ImageFilter.GaussianBlur(size / 6))
                     .crop((size, size, size * 2, size * 2))).astype(np.float32) / 255.0
    return h - low + low.mean()


def main():
    rng = np.random.default_rng(SEED)

    fine = worley(SIZE, CELLS, rng)
    coarse = worley(SIZE, COARSE, rng)
    # furrows: narrow valleys along the cell walls. Thin and shallow — skin's
    # micro-relief is a height feature, not a paint job.
    fw = np.clip(fine / 0.15, 0, 1) ** 0.55               # 0 in a furrow, 1 on a plateau
    cw = np.clip(coarse / 0.20, 0, 1) ** 0.55
    # pores sit in the junctions — the deepest points of the network
    pore = np.clip(1.0 - fine / 0.055, 0, 1) ** 2.2
    grain = noise(SIZE, 1.1, rng) * 0.5 + noise(SIZE, 2.4, rng) * 0.5
    cellvary = noise(SIZE, 5.0, rng)

    h = (0.62 + 0.17 * fw + 0.10 * cw + 0.05 * grain + 0.035 * cellvary - 0.09 * pore)
    h = flatten(h, SIZE)
    h = np.clip((h - h.mean()) * 1.0 + 0.62, 0, 1)

    # ---- albedo -------------------------------------------------------------
    # one warm mid skin tone; the furrows and pores sit a shade darker and a
    # shade redder, which is the only colour information real skin has here.
    # Deliberately weak: at render size this map is a grain, not a pattern.
    d = (h - h.mean())
    base = np.array([0.815, 0.688, 0.616], np.float32)
    tintd = np.array([0.30, 0.20, 0.18], np.float32)      # direction of "deeper"
    alb = base[None, None, :] + d[:, :, None] * tintd[None, None, :]
    alb = np.clip(alb, 0, 1)
    Image.fromarray((alb * 255).astype(np.uint8)).save(
        f'{OUT}/skin-albedo.jpg', quality=90, optimize=True)

    # ---- height -> tangent-space normal -------------------------------------
    hs = np.asarray(Image.fromarray((h * 255).astype(np.uint8))
                    .filter(ImageFilter.GaussianBlur(0.5))).astype(np.float32) / 255.0
    gx = (np.roll(hs, -1, axis=1) - np.roll(hs, 1, axis=1)) * 0.5
    gy = (np.roll(hs, -1, axis=0) - np.roll(hs, 1, axis=0)) * 0.5
    strength = 7.0
    nx, ny, nz = -gx * strength, -gy * strength, np.ones_like(hs)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    nrm = np.stack([nx / ln, ny / ln, nz / ln], axis=2) * 0.5 + 0.5
    Image.fromarray((nrm * 255).astype(np.uint8)).save(
        f'{OUT}/skin-normal.jpg', quality=92, optimize=True)

    # ---- roughness ----------------------------------------------------------
    # furrows hold moisture and read glossier than the plateaus between them
    r = 1.0 - (h - h.min()) / max(float(h.max() - h.min()), 1e-6)
    r = 0.44 + r * 0.26                                   # 0.44–0.70, damp skin
    Image.fromarray((r * 255).astype(np.uint8)).convert('L').save(
        f'{OUT}/skin-rough.jpg', quality=90, optimize=True)

    total = 0
    for f in ('skin-albedo.jpg', 'skin-normal.jpg', 'skin-rough.jpg'):
        n = os.path.getsize(f'{OUT}/{f}')
        total += n
        print(f, n, 'bytes')
    print('total', total, 'bytes')


if __name__ == '__main__':
    main()
