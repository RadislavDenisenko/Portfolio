"""Bake hand-specific surface maps: palm creases, knuckle flexion lines, grain.

Tiling a generic detail texture can never put a crease in the right place — a
crease is anatomy, not surface noise. So this rasterises the model's own UV
layout, recovers the 3D position behind every texel, and draws the creases
where the hand's joints say they belong. Output is a single non-tiled map set,
which also removes the repeat frequency that made earlier attempts read as
scales.

    python3 tools/make_hand_maps.py
"""
import json
import struct
import numpy as np
from PIL import Image

SRC = 'docs/assets/models/hand-rigged.glb'
OUT = 'docs/assets/img'
N = 1024
PALM_DIR = np.array([-1.0, 0.0, 0.0])   # palmar side faces -X (the thumb folds that way)


# ----------------------------------------------------------------- read glb
def read():
    d = open(SRC, 'rb').read()
    jl = struct.unpack('<I', d[12:16])[0]
    g = json.loads(d[20:20 + jl])
    binc = d[20 + jl + 8:]
    C = {5121: np.uint8, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}

    def acc(i, size):
        a = g['accessors'][i]
        bv = g['bufferViews'][a['bufferView']]
        o = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        return np.frombuffer(binc, dtype=C[a['componentType']],
                             count=a['count'] * size, offset=o).reshape(-1, size).astype(np.float64)

    p = g['meshes'][0]['primitives'][0]
    joints = {n['name']: np.array(n['translation'])
              for n in g['nodes'] if n.get('name') and n.get('translation')}
    return (acc(p['attributes']['POSITION'], 3),
            acc(p['attributes']['NORMAL'], 3),
            acc(p['attributes']['TEXCOORD_0'], 2),
            acc(p['indices'], 1).astype(int).ravel(),
            joints)


# ------------------------------------------------------- uv -> 3d position map
def rasterise(pos, nrm, uv, idx):
    """For every texel, the 3D point and normal of the surface that lands there."""
    P = np.zeros((N, N, 3))
    Nm = np.zeros((N, N, 3))
    mask = np.zeros((N, N), bool)
    px = uv.copy()
    px[:, 0] *= (N - 1)
    px[:, 1] *= (N - 1)

    for t in idx.reshape(-1, 3):
        a, b, c = px[t]
        x0, x1 = int(max(0, np.floor(min(a[0], b[0], c[0])))), int(min(N - 1, np.ceil(max(a[0], b[0], c[0]))))
        y0, y1 = int(max(0, np.floor(min(a[1], b[1], c[1])))), int(min(N - 1, np.ceil(max(a[1], b[1], c[1]))))
        if x1 < x0 or y1 < y0:
            continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
        d = ((b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]))
        if abs(d) < 1e-12:
            continue
        w0 = ((b[1] - c[1]) * (xs - c[0]) + (c[0] - b[0]) * (ys - c[1])) / d
        w1 = ((c[1] - a[1]) * (xs - c[0]) + (a[0] - c[0]) * (ys - c[1])) / d
        w2 = 1 - w0 - w1
        inside = (w0 >= -0.002) & (w1 >= -0.002) & (w2 >= -0.002)
        if not inside.any():
            continue
        yy, xx = ys[inside], xs[inside]
        w = np.stack([w0[inside], w1[inside], w2[inside]], -1)
        P[yy, xx] = w @ pos[t]
        Nm[yy, xx] = w @ nrm[t]
        mask[yy, xx] = True
    return P, Nm, mask


# ------------------------------------------------------------------- creases
def seg_dist(P, a, b):
    """Distance from every texel's 3D point to segment ab."""
    ab = b - a
    L = ab @ ab
    t = np.clip(((P - a) @ ab) / (L + 1e-12), 0, 1)[..., None]
    return np.linalg.norm(P - (a + t * ab), axis=-1)


def polyline_dist(P, pts):
    d = np.full(P.shape[:2], 1e9)
    for i in range(len(pts) - 1):
        d = np.minimum(d, seg_dist(P, pts[i], pts[i + 1]))
    return d


def flatten(V):
    """Drop the component along the palm normal.

    A palm crease is a line drawn ON the palm, but the joints that anchor it sit
    inside the hand — up to 55mm from the skin along that normal. Measured in
    full 3D the curve never comes within reach of any surface texel. Measured in
    the palm plane it behaves like the drawn line it is, at any depth."""
    return V - np.expand_dims(V @ PALM_DIR, -1) * PALM_DIR


def noise3(P, mask, freq=900.0, octaves=3):
    """Value noise evaluated in model space, so grain is the same size
    everywhere on the hand regardless of how the UVs were laid out."""
    rng = np.random.default_rng(11)
    G = 64
    out = np.zeros(P.shape[:2])
    amp, f = 1.0, freq
    for _ in range(octaves):
        grid = rng.random((G, G, G))
        c = P * f
        i0 = np.floor(c).astype(np.int64)
        t = c - i0
        t = t * t * (3 - 2 * t)                    # smoothstep between lattice points
        i0 %= G
        i1 = (i0 + 1) % G
        x0, y0, z0 = i0[..., 0], i0[..., 1], i0[..., 2]
        x1, y1, z1 = i1[..., 0], i1[..., 1], i1[..., 2]
        tx, ty, tz = t[..., 0], t[..., 1], t[..., 2]
        def lerp(a, b, w): return a + (b - a) * w
        c00 = lerp(grid[x0, y0, z0], grid[x1, y0, z0], tx)
        c10 = lerp(grid[x0, y1, z0], grid[x1, y1, z0], tx)
        c01 = lerp(grid[x0, y0, z1], grid[x1, y0, z1], tx)
        c11 = lerp(grid[x0, y1, z1], grid[x1, y1, z1], tx)
        out += amp * lerp(lerp(c00, c10, ty), lerp(c01, c11, ty), tz)
        amp *= 0.5
        f *= 2.1
    out -= out[mask].mean() if mask.any() else 0
    return out / (np.abs(out).max() + 1e-9)


def uv_anchors(P, Nm, mask, J):
    """Pixel position of each joint on the palm island."""
    palmar = Nm @ PALM_DIR
    ys, xs = np.nonzero(mask & (palmar > 0.35))
    pts = P[ys, xs]
    out = {}
    for name in ('index-finger-phalanx-proximal', 'middle-finger-phalanx-proximal',
                 'ring-finger-phalanx-proximal', 'pinky-finger-phalanx-proximal', 'wrist'):
        k = int(np.argmin(((pts - J[name]) ** 2).sum(1)))
        out[name] = np.array([xs[k], ys[k]], float)
    return out


def painted_palm_lines(a):
    """The three palm creases, laid out relative to the joint anchors.

    Every offset here is a fraction of the hand's own span, never a pixel count:
    how big the palm lands on the map depends on how the model was unwrapped,
    and offsets tuned against one unwrap collapse into a knot on another."""
    from PIL import ImageDraw, ImageFilter
    idx, mid = a['index-finger-phalanx-proximal'], a['middle-finger-phalanx-proximal']
    rng, pnk = a['ring-finger-phalanx-proximal'], a['pinky-finger-phalanx-proximal']
    wri = a['wrist']

    base = (idx + mid + rng + pnk) / 4
    down = wri - base
    L = float(np.linalg.norm(down))
    down /= (L + 1e-9)                        # finger bases toward the wrist
    across = idx - pnk
    span = float(np.linalg.norm(across))
    across /= (span + 1e-9)                   # pinky edge toward the thumb edge

    lo = lambda p, q, t: p + (q - p) * t
    web = idx + across * (0.18 * span) + down * (0.06 * L)   # thumb/index web
    ulnar = pnk - across * (0.12 * span)                     # outside palm edge

    curves = [
        # distal transverse: under the fingers, ulnar edge to the index side
        ([ulnar + down * (0.10 * L),
          lo(pnk, rng, 0.5) + down * (0.13 * L),
          lo(rng, mid, 0.5) + down * (0.17 * L),
          lo(mid, idx, 0.55) + down * (0.20 * L)], 1.0, 2),
        # proximal transverse: from the web, sweeping down across the palm
        ([web + down * (0.02 * L),
          lo(idx, mid, 0.6) + down * (0.26 * L),
          lo(mid, rng, 0.6) + down * (0.30 * L),
          ulnar + down * (0.34 * L)], 0.95, 2),
        # thenar: around the ball of the thumb, web down to the wrist
        ([web - down * (0.02 * L),
          web + down * (0.15 * L) - across * (0.06 * span),
          lo(web, wri, 0.55) - across * (0.10 * span),
          lo(web, wri, 0.86) - across * (0.04 * span)], 0.9, 2),
    ]

    # Proximal digital creases: the band where each finger hinges off the palm.
    # The 3D crease pass cannot reach these — it gates on distance to the bone,
    # and at the knuckle the palm is wider than that gate — so the busiest strip
    # of a real palm was coming out blank.
    perp = np.array([-down[1], down[0]])
    for a, halfw in ((idx, 0.150), (mid, 0.155), (rng, 0.145), (pnk, 0.125)):
        c = a - down * (0.045 * L)
        curves.append(([c - perp * (halfw * span) + down * (0.012 * L),
                        c - perp * (halfw * span * 0.4),
                        c + perp * (halfw * span * 0.4),
                        c + perp * (halfw * span) + down * (0.012 * L)], 0.8, 2))

    acc = np.zeros((N, N), np.float32)
    for pts, amp, width in curves:
        im = Image.new('L', (N, N), 0)
        d = ImageDraw.Draw(im)
        sm = catmull_rom([tuple(map(float, q)) for q in pts])
        d.line(sm, fill=255, width=width, joint='curve')
        soft = np.asarray(im.filter(ImageFilter.GaussianBlur(2.0)), np.float32) / 255.0
        acc = np.maximum(acc, soft * amp)
    return np.clip(acc * 1.45, 0, 1)


def catmull_rom(pts, steps=26):
    """Smooth the control points so the creases curve like skin, not polylines."""
    P0 = [pts[0]] + list(pts) + [pts[-1]]
    out = []
    for i in range(len(P0) - 3):
        p0, p1, p2, p3 = (np.array(P0[i + k]) for k in range(4))
        for s in range(steps):
            t = s / steps
            out.append(tuple(0.5 * ((2 * p1) + (-p0 + p2) * t +
                                    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t +
                                    (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3)))
    return out


def pigment(P, Nm, mask, J):
    """Where a hand is red and where it is pale.

    Skin is not one colour. The pads and the knuckles sit over a capillary bed
    with very little above it; the hollow of the palm is thick, poorly
    vascularised and the palest part of the whole hand. A photograph of a real
    palm swings about 26 points of red-minus-green between those two places.
    Baking only crease shadow into the albedo leaves a single hue everywhere,
    which is most of what made the render read as unpainted clay."""
    palmar = np.clip(Nm @ PALM_DIR, 0, 1)
    dorsal = np.clip(Nm @ -PALM_DIR, 0, 1)
    fingers = ('index-finger', 'middle-finger', 'ring-finger', 'pinky-finger')

    red = np.zeros(P.shape[:2])

    def blob(name, r, amp, side):
        d = np.linalg.norm(P - J[name], axis=-1)
        return np.exp(-(d / r) ** 2) * amp * side

    for f in fingers:                        # pulp of the fingertips
        red = np.maximum(red, blob(f + '-tip', 0.016, 1.0, palmar))
        red = np.maximum(red, blob(f + '-phalanx-distal', 0.014, 0.80, palmar))
    red = np.maximum(red, blob('thumb-tip', 0.018, 1.0, palmar))
    red = np.maximum(red, blob('thumb-phalanx-distal', 0.016, 0.80, palmar))
    for f in fingers:                        # knuckles, stretched over bone
        red = np.maximum(red, blob(f + '-phalanx-proximal', 0.015, 0.85, dorsal))
        red = np.maximum(red, blob(f + '-phalanx-intermediate', 0.012, 0.60, dorsal))

    hollow = (J['index-finger-phalanx-proximal'] + J['pinky-finger-phalanx-proximal']
              + 2 * J['wrist']) / 4
    pale = np.exp(-(np.linalg.norm(P - hollow, axis=-1) / 0.045) ** 2) * palmar
    return red * mask, pale * mask


def build_creases(P, Nm, mask, J):
    palmar = np.clip(Nm @ PALM_DIR, 0, 1)          # creases only exist on the palm side
    dorsal = np.clip(Nm @ -PALM_DIR, 0, 1)
    depth = np.zeros(P.shape[:2])

    # --- flexion creases: a band at each finger joint, across the digit ------
    fingers = ['index-finger', 'middle-finger', 'ring-finger', 'pinky-finger']
    for f in fingers:
        chain = [J[f + '-phalanx-proximal'], J[f + '-phalanx-intermediate'],
                 J[f + '-phalanx-distal'], J[f + '-tip']]
        for i, j in enumerate(chain[:-1]):
            nxt = chain[i + 1]
            axis = nxt - j
            axis /= (np.linalg.norm(axis) + 1e-12)
            along = np.abs((P - j) @ axis)
            near = seg_dist(P, j, nxt) < 0.013      # this digit only
            width, amp = (0.0011, 0.62) if i == 0 else (0.0008, 0.40)
            band = np.exp(-(along / width) ** 2) * near
            depth = np.maximum(depth, band * amp * palmar)
            if i > 0:      # knuckles crease on the back too, more softly
                depth = np.maximum(depth, np.exp(-(along / (width * 1.3)) ** 2) * near * 0.26 * dorsal)

    # thumb: one crease at the IP joint, one at the base
    for a, b, amp in [('thumb-phalanx-proximal', 'thumb-phalanx-distal', 0.7),
                      ('thumb-metacarpal', 'thumb-phalanx-proximal', 0.6)]:
        axis = J[b] - J[a]
        axis /= (np.linalg.norm(axis) + 1e-12)
        near = seg_dist(P, J[a], J[b]) < 0.018
        depth = np.maximum(depth,
                           np.exp(-(np.abs((P - J[b]) @ axis) / 0.0011) ** 2) * near * amp * palmar)

    # --- the three palm lines, painted onto the UV island -------------------
    # The palm unwraps as a hand silhouette (fingers up, thumb right), so the
    # creases are drawn there against joint anchors rather than fitted through
    # the solid, where every anchor sits centimetres below the skin.
    anchors = uv_anchors(P, Nm, mask, J)
    depth = np.maximum(depth, painted_palm_lines(anchors) * palmar)

    # Grain is sampled from the 3D position, not from UV. The mesh's UV islands
    # differ in density, so a map uniform in UV space arrives at different
    # scales on the model: grainy across the palm, glassy on the thumb.
    grain = noise3(P, mask)

    height = -np.clip(depth, 0, 1.0) * 0.55
    # Pore relief. Grain used to go only into roughness, where a +-0.036 swing
    # is invisible, so 91% of the hand had no relief at all and the surface
    # between the creases rendered dead. It is safe here in a way a tiled photo
    # map never was: this noise is sampled in model space, so it has no repeat
    # frequency to line up into scales.
    height += grain * 0.030
    height *= mask
    return height, np.clip(depth, 0, 1.0) * mask, grain



def save(arr, name, half=False, **kw):
    """Write a baked map.

    The raster puts v=0 in row 0, i.e. at the top of the file, but three.js
    uploads textures with flipY on, so it reads v=0 from the bottom. Tileable
    grain survived that; a crease drawn at a knuckle does not. Flip on the way
    out and the two agree."""
    im = Image.fromarray(np.flipud(arr))
    if half:
        im = im.resize((N // 2, N // 2), Image.LANCZOS)
    im.save(f'{OUT}/{name}', **kw)


def main():
    pos, nrm, uv, idx, J = read()
    print('rasterising %d triangles into %d^2' % (len(idx) // 3, N))
    P, Nm, mask = rasterise(pos, nrm, uv, idx)
    print('coverage: %.1f%%' % (100 * mask.mean()))

    height, depth, grain = build_creases(P, Nm, mask, J)
    red, pale = pigment(P, Nm, mask, J)

    # normal from the height field
    gx = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) * 0.5
    gy = (np.roll(height, -1, 0) - np.roll(height, 1, 0)) * 0.5
    # The height field runs 0..0.55 in model units, not pixels. At s=20 a crease
    # tilted the surface ~70 degrees and rendered as a black band; this keeps the
    # steepest wall under about 25.
    s = 6.5
    nx, ny, nz = -gx * s, -gy * s, np.ones_like(height)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    nmap = np.stack([nx / ln, ny / ln, nz / ln], -1) * 0.5 + 0.5
    nmap[~mask] = [0.5, 0.5, 1.0]
    # Higher quality than the others on purpose: pore relief is exactly the
    # high-frequency content JPEG throws away first, and blocking in a normal
    # map amplifies into visible crust rather than softening.
    save((nmap * 255).astype(np.uint8), 'hand-normal.jpg', quality=92, optimize=True)

    # Creases read as shadow, which is what sells them at a glance; on top of
    # that the albedo carries pigment, by pulling green and blue down where the
    # hand is red rather than pushing red up, which would just clip to white.
    shade = np.clip(1.0 - depth * 0.15, 0.7, 1.0)
    col = np.stack([
        shade * (1.0 - pale * 0.010),
        shade * 0.975 * (1.0 - red * 0.085 + pale * 0.030),
        shade * 0.955 * (1.0 - red * 0.130 + pale * 0.055),
    ], -1)
    col = np.clip(col, 0, 1)
    col[~mask] = 1.0
    save((col * 255).astype(np.uint8), 'hand-albedo.jpg', quality=90, optimize=True)

    rough = np.clip(0.62 + depth * 0.10 + grain * 0.15, 0.42, 0.86)
    rough[~mask] = 0.62
    # Half size: this map is almost entirely grain, which gzip cannot touch and
    # JPEG spends its whole budget on. At 512 it is 5x smaller and the grain is
    # still finer than the screen resolves.
    save((rough * 255).astype(np.uint8), 'hand-rough.jpg', half=True,
         quality=86, optimize=True)

    import os
    for f in ('hand-normal.jpg', 'hand-albedo.jpg', 'hand-rough.jpg'):
        print(f, os.path.getsize(f'{OUT}/{f}'), 'bytes')


if __name__ == '__main__':
    main()
