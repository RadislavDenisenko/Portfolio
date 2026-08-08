"""Derive a PBR map set from one generated skin photo.

albedo   — lighting flattened (divide out the low-frequency luminance), so the
           texture tints the model instead of fighting the scene's lights.
normal   — Sobel gradient of the high-frequency detail, packed to tangent space.
roughness— inverted detail: creases hold moisture and read glossier than ridges.

The source is made tileable first by mirror-blending its edges, so the detail
map can repeat across the hand at high frequency without visible seams.
"""
import os
import numpy as np
from PIL import Image, ImageFilter

SRC = 'docs/assets/img/skin-src.png'
OUT = 'docs/assets/img'
SIZE = 512  # detail map, tiled — small on purpose, keeps the page light


def make_tileable(img, blend=64):
    """Mirror-blend opposite edges so the texture repeats seamlessly."""
    a = np.asarray(img).astype(np.float32)
    h, w = a.shape[:2]
    ramp = np.linspace(0, 1, blend, dtype=np.float32)
    # horizontal: fade the left edge into the mirrored right edge
    left, right = a[:, :blend], a[:, -blend:][:, ::-1]
    a[:, :blend] = left * ramp[None, :, None] + right * (1 - ramp)[None, :, None]
    # vertical
    top, bottom = a[:blend, :], a[-blend:, :][::-1, :]
    a[:blend, :] = top * ramp[:, None, None] + bottom * (1 - ramp)[:, None, None]
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


def main():
    img = Image.open(SRC).convert('RGB')
    print('source:', img.size)
    img = img.resize((SIZE, SIZE), Image.LANCZOS)
    img = make_tileable(img)

    arr = np.asarray(img).astype(np.float32) / 255.0

    # ---- albedo: flatten baked lighting -------------------------------------
    # Any residual soft gradient in the generation is low-frequency. Dividing by
    # a heavy blur of the luminance removes it while keeping pore/crease detail.
    lum = arr.mean(axis=2)
    low = np.asarray(
        Image.fromarray((lum * 255).astype(np.uint8)).filter(
            ImageFilter.GaussianBlur(SIZE / 8)
        )
    ).astype(np.float32) / 255.0
    low = np.clip(low, 0.15, 1.0)
    flat = np.clip(arr / low[:, :, None] * lum.mean(), 0, 1)
    # pull saturation back slightly; the material tint supplies final hue
    grey = flat.mean(axis=2, keepdims=True)
    flat = np.clip(grey + (flat - grey) * 0.75, 0, 1)
    Image.fromarray((flat * 255).astype(np.uint8)).save(
        f'{OUT}/skin-albedo.jpg', quality=88, optimize=True
    )

    # ---- height -> normal ---------------------------------------------------
    h = flat.mean(axis=2)
    h = np.asarray(
        Image.fromarray((h * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.6))
    ).astype(np.float32) / 255.0
    # wrap edges so gradients stay seamless across the tile boundary
    gx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * 0.5
    gy = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * 0.5
    strength = 6.0
    nx, ny, nz = -gx * strength, -gy * strength, np.ones_like(h)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    nrm = np.stack([nx / ln, ny / ln, nz / ln], axis=2) * 0.5 + 0.5
    Image.fromarray((nrm * 255).astype(np.uint8)).save(
        f'{OUT}/skin-normal.jpg', quality=90, optimize=True
    )

    # ---- roughness ----------------------------------------------------------
    # creases sit darker in the flattened albedo and read glossier than ridges
    r = 1.0 - h
    r = (r - r.min()) / max(float(r.max() - r.min()), 1e-6)
    r = 0.42 + r * 0.30          # 0.42–0.72: damp skin, never mirror or chalk
    Image.fromarray((r * 255).astype(np.uint8)).convert('L').save(
        f'{OUT}/skin-rough.jpg', quality=88, optimize=True
    )

    os.remove(SRC)
    for f in ('skin-albedo.jpg', 'skin-normal.jpg', 'skin-rough.jpg'):
        print(f, os.path.getsize(f'{OUT}/{f}'), 'bytes')


if __name__ == '__main__':
    main()
