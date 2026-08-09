"""Generate fine skin micro-detail maps procedurally.

Earlier versions derived these from a macro photograph of a palm. That photo
contained 20-40mm flexion creases, and a crease repeated across a tile grid
reads as scales — the hand looked like a lizard. Skin at the size this hand is
drawn has no visible creases at all: it has fine grain, faint pores, and very
low-amplitude relief. So the detail is synthesised at the right frequency
instead of photographed at the wrong one.

Built in the frequency domain, which makes the result seamless by construction
(an inverse FFT of a periodic spectrum wraps exactly) rather than by blending
edges and hoping.

    python3 tools/make_skin_maps.py
"""
import os
import numpy as np
from PIL import Image

N = 512
OUT = 'docs/assets/img'
SEED = 7


def spectral_noise(n, beta, rng):
    """Periodic noise whose power falls off as 1/f**beta. Higher beta = softer."""
    fy = np.fft.fftfreq(n)[:, None]
    fx = np.fft.fftfreq(n)[None, :]
    f = np.sqrt(fy ** 2 + fx ** 2)
    f[0, 0] = 1.0
    spec = np.fft.fft2(rng.normal(size=(n, n))) / (f ** beta)
    spec[0, 0] = 0
    out = np.real(np.fft.ifft2(spec))
    return out / (np.abs(out).max() + 1e-9)


def pores(n, count, radius, rng):
    """Shallow dimples on a jittered grid, wrapped at the edges."""
    field = np.zeros((n, n))
    ys = rng.integers(0, n, count)
    xs = rng.integers(0, n, count)
    r = int(radius * 3)
    gy, gx = np.mgrid[-r:r + 1, -r:r + 1]
    blob = np.exp(-(gy ** 2 + gx ** 2) / (2 * radius ** 2))
    for y, x in zip(ys, xs):
        yy = (np.arange(-r, r + 1) + y) % n
        xx = (np.arange(-r, r + 1) + x) % n
        field[np.ix_(yy, xx)] -= blob * rng.uniform(0.5, 1.0)
    return field / (np.abs(field).max() + 1e-9)


def main():
    rng = np.random.default_rng(SEED)

    # fine grain carries most of the read; a slower layer keeps it from looking
    # like uniform sandpaper; pores add the last touch of organic irregularity
    grain = spectral_noise(N, 0.85, rng)
    swell = spectral_noise(N, 2.1, rng)
    dimple = pores(N, 2600, 1.15, rng)

    height = 0.60 * grain + 0.28 * swell + 0.30 * dimple
    height = (height - height.mean()) / (height.std() + 1e-9)
    height = np.clip(height * 0.16 + 0.5, 0, 1)

    # --- normal ------------------------------------------------------------
    # np.roll keeps the gradient periodic, so the tile seam stays invisible.
    gx = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) * 0.5
    gy = (np.roll(height, -1, 0) - np.roll(height, 1, 0)) * 0.5
    strength = 3.2
    nx, ny, nz = -gx * strength, -gy * strength, np.ones_like(height)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    nrm = np.stack([nx / ln, ny / ln, nz / ln], -1) * 0.5 + 0.5
    Image.fromarray((nrm * 255).astype(np.uint8)).save(
        f'{OUT}/skin-normal.jpg', quality=92, optimize=True)

    # --- roughness ---------------------------------------------------------
    # Skin is damp in the furrows and drier on the ridges, a narrow band. Wider
    # than this and the hand starts flashing like wet plastic as it turns.
    r = 0.50 + (1.0 - height) * 0.16
    Image.fromarray((r * 255).astype(np.uint8)).convert('L').save(
        f'{OUT}/skin-rough.jpg', quality=90, optimize=True)

    # No albedo map is written. Skin at this size has no colour pattern worth
    # tiling, and a mid-grey map multiplies the material tint down to half
    # brightness — which is what turned the hand to chocolate.

    for f in ('skin-normal.jpg', 'skin-rough.jpg'):
        print(f, os.path.getsize(f'{OUT}/{f}'), 'bytes')


if __name__ == '__main__':
    main()
