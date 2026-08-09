"""Upscale a generated plate with Real-ESRGAN, on CPU, without paid credits.

The room background was generated at 1376x768. Full-bleed on a retina laptop
wants nearly 2900px, and no amount of JPEG quality invents detail that was
never in the file — the 1.77MB PNG original in git history is the same 1376px
and converting it to JPEG cost an RMSE of 2.2/255. The only real fix is a
model that synthesises the missing detail.

No GPU here and no cloud credits, but the pieces are all reachable:
`download.pytorch.org` is blocked by the egress policy while PyPI is not, and
the `realesrgan-ncnn-py` wheel happens to SHIP the 33MB x4plus photo weights.
So we take the weights from that wheel and run them through plain `ncnn` on
the CPU, which needs no Vulkan device.

    pip install realesrgan-ncnn-py ncnn
    THREADS=4 python3 tools/upscale.py in.jpg out.png

About ten minutes for 1376x768 on four cores. Tiled with 12px of overlap, which
measured clean: seam columns land at 0.85-1.46 mean delta against a p99 of 4.05
for the image's own gradients.

Then cut the delivery sizes — downscaling the 4x result beats running the model
at a lower factor, and the output compresses SMALLER than the source because
the JPEG noise is gone:

    sr.resize((w, h), Image.LANCZOS).save(p, quality=82, optimize=True,
                                          progressive=True)
"""
import os
import sys
import time

import numpy as np
import ncnn
from PIL import Image

MODEL = ('/usr/local/lib/python3.11/dist-packages/realesrgan_ncnn_py/models/'
         'realesrgan-x4plus')
SCALE = 4
TILE = int(os.environ.get('TILE', 192))
PAD = 12


def main():
    src, dst = sys.argv[1], sys.argv[2]

    net = ncnn.Net()
    net.opt.use_vulkan_compute = False        # no Vulkan ICD in a cloud session
    net.opt.num_threads = int(os.environ.get('THREADS', os.cpu_count() or 4))
    net.load_param(MODEL + '.param')
    net.load_model(MODEL + '.bin')

    img = np.asarray(Image.open(src).convert('RGB'), np.uint8)
    H, W, _ = img.shape
    out = np.zeros((H * SCALE, W * SCALE, 3), np.float32)

    tiles = [(y, x) for y in range(0, H, TILE) for x in range(0, W, TILE)]
    t0 = time.time()
    for n, (y0, x0) in enumerate(tiles):
        y1, x1 = min(y0 + TILE, H), min(x0 + TILE, W)
        # Overlap on the way in, discarded on the way out: the network's
        # receptive field reaches past the tile edge and starves without it.
        py0, px0 = max(0, y0 - PAD), max(0, x0 - PAD)
        py1, px1 = min(H, y1 + PAD), min(W, x1 + PAD)
        t = np.ascontiguousarray(img[py0:py1, px0:px1])

        m = ncnn.Mat.from_pixels(t.tobytes(), ncnn.Mat.PixelType.PIXEL_RGB,
                                 px1 - px0, py1 - py0)
        m.substract_mean_normalize([0.0, 0.0, 0.0], [1 / 255.0] * 3)
        ex = net.create_extractor()
        ex.input('data', m)
        _, o = ex.extract('output')

        a = np.array(o).transpose(1, 2, 0) * 255.0
        ty0, tx0 = (y0 - py0) * SCALE, (x0 - px0) * SCALE
        out[y0 * SCALE:y1 * SCALE, x0 * SCALE:x1 * SCALE] = \
            a[ty0:ty0 + (y1 - y0) * SCALE, tx0:tx0 + (x1 - x0) * SCALE]

        el = time.time() - t0
        print('tile %d/%d  %.0fs elapsed  eta %.0fs'
              % (n + 1, len(tiles), el, el / (n + 1) * (len(tiles) - n - 1)),
              flush=True)

    Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save(dst)
    print('wrote %s %s in %.0fs' % (dst, Image.open(dst).size, time.time() - t0))


if __name__ == '__main__':
    main()
