"""Upscale a plate. Uses your ComfyUI models and GPU when it can, this CPU when it can't.

Two paths, picked automatically:

1. **ComfyUI** (preferred). If ComfyUI is answering on $COMFYUI_URL, the job goes
   there: your GPU, your downloaded upscale models. The models are discovered at
   runtime from /object_info, so this needs no install path and no hardcoded
   filenames — whatever is in ComfyUI/models/upscale_models is what it can use.
   Seconds instead of minutes, and better weights than the fallback.

2. **Real-ESRGAN on the CPU** (fallback, for a cloud session with no GPU and no
   route to your machine). `download.pytorch.org` is blocked by the egress
   policy while PyPI is not, and the `realesrgan-ncnn-py` wheel happens to SHIP
   the 33MB x4plus photo weights, so we take the weights from that wheel and run
   them through plain `ncnn`, which needs no Vulkan device. About ten minutes for
   a 1376px plate on four cores. Note this path CANNOT use your ComfyUI models:
   those are .pth, and ncnn reads .param/.bin.

    pip install realesrgan-ncnn-py ncnn     # fallback path only
    python3 tools/upscale.py in.jpg out.png
    COMFYUI_URL=http://127.0.0.1:8188 python3 tools/upscale.py in.jpg out.png
    UPSCALE_FORCE=cpu python3 tools/upscale.py in.jpg out.png

Then cut the delivery sizes — downscaling a 4x result beats running the model at
a lower factor, and the output compresses SMALLER than the source because the
JPEG noise is gone:

    sr.resize((w, h), Image.LANCZOS).save(p, quality=82, optimize=True,
                                          progressive=True)
"""
import importlib.util
import json
import os
import sys
import time
import urllib.parse
import urllib.request

COMFY = os.environ.get('COMFYUI_URL', 'http://127.0.0.1:8188').rstrip('/')
# Substring preferences, best first. Anything installed still works; this only
# decides which to reach for when several are present.
PREFER = ('4x-ultrasharp', 'realesrgan_x4plus', 'remacri', '4x_foolhardy', 'esrgan')
SCALE, PAD = 4, 12


# --------------------------------------------------------------- comfyui ----
def _get(path, timeout=10):
    with urllib.request.urlopen(COMFY + path, timeout=timeout) as r:
        return r.read()


def comfy_up():
    try:
        _get('/system_stats', timeout=3)
        return True
    except Exception:
        return False


def comfy_models():
    d = json.loads(_get('/object_info/UpscaleModelLoader'))
    return d['UpscaleModelLoader']['input']['required']['model_name'][0]


def pick(models):
    for want in PREFER:
        for m in models:
            if want in m.lower():
                return m
    return models[0]


def comfy_upload(path):
    b = '----upscalepy'
    name = os.path.basename(path)
    body = (
        ('--%s\r\nContent-Disposition: form-data; name="image"; filename="%s"\r\n'
         'Content-Type: application/octet-stream\r\n\r\n' % (b, name)).encode()
        + open(path, 'rb').read()
        + ('\r\n--%s\r\nContent-Disposition: form-data; name="overwrite"\r\n\r\ntrue\r\n' % b).encode()
        + ('--%s--\r\n' % b).encode())
    req = urllib.request.Request(
        COMFY + '/upload/image', body,
        {'Content-Type': 'multipart/form-data; boundary=' + b})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read())['name']


def comfy_upscale(src, dst):
    models = comfy_models()
    if not models:
        raise SystemExit('ComfyUI is running but has no upscale models installed.\n'
                         'Put one in ComfyUI/models/upscale_models and retry.')
    model = pick(models)
    print('comfyui: %s  (of %d installed: %s)' % (model, len(models), ', '.join(models)))

    graph = {
        '1': {'class_type': 'LoadImage',
              'inputs': {'image': comfy_upload(src), 'upload': 'image'}},
        '2': {'class_type': 'UpscaleModelLoader', 'inputs': {'model_name': model}},
        '3': {'class_type': 'ImageUpscaleWithModel',
              'inputs': {'upscale_model': ['2', 0], 'image': ['1', 0]}},
        '4': {'class_type': 'SaveImage',
              'inputs': {'images': ['3', 0], 'filename_prefix': 'upscale'}},
    }
    req = urllib.request.Request(COMFY + '/prompt',
                                 json.dumps({'prompt': graph}).encode(),
                                 {'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=30) as r:
        pid = json.loads(r.read())['prompt_id']

    t0 = time.time()
    while True:
        hist = json.loads(_get('/history/' + pid))
        if pid in hist and hist[pid].get('outputs'):
            break
        if time.time() - t0 > 900:
            raise SystemExit('ComfyUI did not finish within 15 minutes')
        time.sleep(1.5)

    img = hist[pid]['outputs']['4']['images'][0]
    q = urllib.parse.urlencode({'filename': img['filename'],
                                'subfolder': img.get('subfolder', ''),
                                'type': img.get('type', 'output')})
    open(dst, 'wb').write(_get('/view?' + q, timeout=300))
    print('wrote %s via ComfyUI in %.0fs' % (dst, time.time() - t0))


# ------------------------------------------------------------------- cpu ----
def ncnn_weights():
    """The x4plus weights bundled inside the realesrgan-ncnn-py wheel.

    find_spec rather than import: the wheel's own __init__ pulls a Vulkan
    extension that needs libomp, which a headless box does not have. We only
    want the files sitting next to it."""
    spec = importlib.util.find_spec('realesrgan_ncnn_py')
    if spec is None or not spec.origin:
        raise SystemExit('No ComfyUI on %s and realesrgan-ncnn-py is not installed.\n'
                         'Either start ComfyUI (better: your GPU, your models) or\n'
                         '  pip install realesrgan-ncnn-py ncnn' % COMFY)
    base = os.path.join(os.path.dirname(spec.origin), 'models', 'realesrgan-x4plus')
    if not os.path.exists(base + '.param'):
        raise SystemExit('realesrgan-ncnn-py is installed but its models are missing: ' + base)
    return base


def cpu_upscale(src, dst):
    import numpy as np
    import ncnn
    from PIL import Image

    model = ncnn_weights()
    tile = int(os.environ.get('TILE', 192))
    net = ncnn.Net()
    net.opt.use_vulkan_compute = False
    net.opt.num_threads = int(os.environ.get('THREADS', os.cpu_count() or 4))
    net.load_param(model + '.param')
    net.load_model(model + '.bin')

    img = np.asarray(Image.open(src).convert('RGB'), np.uint8)
    H, W, _ = img.shape
    out = np.zeros((H * SCALE, W * SCALE, 3), np.float32)
    tiles = [(y, x) for y in range(0, H, tile) for x in range(0, W, tile)]
    print('cpu: real-esrgan x4plus, %d tiles, %d threads' % (len(tiles), net.opt.num_threads))

    t0 = time.time()
    for n, (y0, x0) in enumerate(tiles):
        y1, x1 = min(y0 + tile, H), min(x0 + tile, W)
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
        print('  tile %d/%d  %.0fs elapsed  eta %.0fs'
              % (n + 1, len(tiles), el, el / (n + 1) * (len(tiles) - n - 1)), flush=True)

    Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save(dst)
    print('wrote %s %s in %.0fs' % (dst, Image.open(dst).size, time.time() - t0))


def main():
    if len(sys.argv) < 3:
        raise SystemExit(__doc__.strip().splitlines()[0] +
                         '\n\n  python3 tools/upscale.py <in> <out>')
    src, dst = sys.argv[1], sys.argv[2]
    force = os.environ.get('UPSCALE_FORCE', '').lower()

    if force != 'cpu' and comfy_up():
        comfy_upscale(src, dst)
    else:
        if force != 'cpu':
            print('no ComfyUI on %s - falling back to this machine\'s CPU.' % COMFY)
            print('  (start ComfyUI to use your own GPU and your own models)')
        cpu_upscale(src, dst)


if __name__ == '__main__':
    main()
