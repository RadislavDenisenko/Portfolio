"""Rebuild the photogrammetry scan into something shaped like a hand.

The scan (reference/hand-scan.glb) reconstructed only two fingers, a lateral
spike and a wrist: single-image photogrammetry has to invent everything it
cannot see, and it fused the digits that touch in the source photo.

This grafts the missing digits from the ones that DID reconstruct, so the
texture and surface character stay photographic, and bends the lateral spike
into an opposed thumb. Output: docs/assets/models/hand-fixed.glb

    python3 tools/fix_hand_scan.py
"""
import json
import struct
import numpy as np

SRC = 'reference/hand-scan.glb'
DST = 'docs/assets/models/hand-fixed.glb'

KNUCKLE_Z = 0.22        # where the digits leave the palm
FINGER_A = (-0.20, -0.10)   # x span of the reconstructed outer finger
FINGER_B = (-0.10, 0.03)    # x span of the reconstructed inner finger
SPACING = 0.11              # centre-to-centre of adjacent digits


def read_glb(path):
    d = open(path, 'rb').read()
    jlen = struct.unpack('<I', d[12:16])[0]
    gltf = json.loads(d[20:20 + jlen])
    binc = d[20 + jlen + 8:]

    def acc(i, size, dtype):
        a = gltf['accessors'][i]
        bv = gltf['bufferViews'][a['bufferView']]
        o = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        return np.frombuffer(binc, dtype=dtype, count=a['count'] * size, offset=o).reshape(-1, size).copy()

    prim = gltf['meshes'][0]['primitives'][0]
    pos = acc(prim['attributes']['POSITION'], 3, '<f4')
    uv = acc(prim['attributes']['TEXCOORD_0'], 2, '<f4')
    idx = acc(prim['indices'], 1, '<u4').ravel()
    img_bv = gltf['bufferViews'][gltf['images'][0]['bufferView']]
    io_ = img_bv.get('byteOffset', 0)
    tex = binc[io_:io_ + img_bv['byteLength']]
    return pos, uv, idx, tex, gltf['images'][0]['mimeType']


def graft(pos, uv, idx, xlo, xhi, dx, zscale):
    """Copy one digit sideways into a new one. Only whole triangles move, so the
    clone keeps a closed surface; its open base is pushed into the palm."""
    sel = (pos[:, 2] > KNUCKLE_Z - 0.06) & (pos[:, 0] >= xlo) & (pos[:, 0] <= xhi)
    if sel.sum() < 12:
        raise SystemExit('digit selection empty for x %.2f..%.2f' % (xlo, xhi))

    tri = idx.reshape(-1, 3)
    keep = sel[tri].all(axis=1)
    tri = tri[keep]

    old = np.unique(tri)
    remap = {int(o): i + len(pos) for i, o in enumerate(old)}

    new_pos = pos[old].copy()
    new_pos[:, 0] += dx
    # taper the length from the knuckle, not from the origin
    new_pos[:, 2] = KNUCKLE_Z + (new_pos[:, 2] - KNUCKLE_Z) * zscale
    new_pos[:, 2] -= 0.035          # bury the open base inside the palm

    new_tri = np.vectorize(remap.get)(tri)
    return (np.vstack([pos, new_pos]),
            np.vstack([uv, uv[old]]),
            np.concatenate([idx, new_tri.ravel()]))


def bend_thumb(pos, x_start=0.055, angle_deg=-58.0):
    """Swing the lateral spike up and forward into an opposed thumb.
    The rotation is feathered by x so the palm side does not shear."""
    w = np.clip((pos[:, 0] - x_start) / (0.302 - x_start), 0, 1)
    w = w * w * (3 - 2 * w)                      # smoothstep
    a = np.radians(angle_deg) * w
    px, pz = 0.045, -0.02                        # pivot at the thumb's root
    x, z = pos[:, 0] - px, pos[:, 2] - pz
    pos[:, 0] = px + x * np.cos(a) + z * np.sin(a)
    pos[:, 2] = pz - x * np.sin(a) + z * np.cos(a)
    return pos


def taper_wrist(pos, z_start=-0.30):
    """Draw the forearm terminus to a point so it reads as a wrist leaving
    frame instead of a cut-off stump."""
    t = np.clip((z_start - pos[:, 2]) / (z_start - pos[:, 2].min()), 0, 1)
    s = 1.0 - 0.55 * t * t
    pos[:, 0] *= np.where(pos[:, 2] < z_start, s, 1.0)
    pos[:, 1] *= np.where(pos[:, 2] < z_start, s, 1.0)
    return pos


def write_glb(path, pos, uv, idx, tex, mime):
    parts, views, off = [], [], 0

    def add(buf, target=None):
        nonlocal off
        pad = (-len(buf)) % 4
        parts.append(buf + b'\x00' * pad)
        v = {'buffer': 0, 'byteOffset': off, 'byteLength': len(buf)}
        if target:
            v['target'] = target
        views.append(v)
        off += len(buf) + pad
        return len(views) - 1

    v_idx = add(idx.astype('<u4').tobytes(), 34963)
    v_pos = add(pos.astype('<f4').tobytes(), 34962)
    v_uv = add(uv.astype('<f4').tobytes(), 34962)
    v_tex = add(bytes(tex))

    gltf = {
        'asset': {'version': '2.0', 'generator': 'tools/fix_hand_scan.py'},
        'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': [{'mesh': 0}],
        'meshes': [{'primitives': [{
            'attributes': {'POSITION': 1, 'TEXCOORD_0': 2},
            'indices': 0, 'material': 0, 'mode': 4}]}],
        'accessors': [
            {'bufferView': v_idx, 'componentType': 5125, 'count': len(idx),
             'type': 'SCALAR', 'max': [int(idx.max())], 'min': [int(idx.min())]},
            {'bufferView': v_pos, 'componentType': 5126, 'count': len(pos),
             'type': 'VEC3', 'max': pos.max(axis=0).tolist(), 'min': pos.min(axis=0).tolist()},
            {'bufferView': v_uv, 'componentType': 5126, 'count': len(uv),
             'type': 'VEC2', 'max': uv.max(axis=0).tolist(), 'min': uv.min(axis=0).tolist()},
        ],
        'images': [{'bufferView': v_tex, 'mimeType': mime}],
        'textures': [{'source': 0}],
        'materials': [{'pbrMetallicRoughness': {
            'baseColorTexture': {'index': 0}, 'roughnessFactor': 0.75,
            'metallicFactor': 0.0}, 'doubleSided': True}],
        'bufferViews': views,
        'buffers': [{'byteLength': off}],
    }

    js = json.dumps(gltf, separators=(',', ':')).encode()
    js += b' ' * ((-len(js)) % 4)
    binb = b''.join(parts)
    total = 12 + 8 + len(js) + 8 + len(binb)
    out = (struct.pack('<III', 0x46546C67, 2, total)
           + struct.pack('<II', len(js), 0x4E4F534A) + js
           + struct.pack('<II', len(binb), 0x004E4942) + binb)
    open(path, 'wb').write(out)
    return total


def main():
    pos, uv, idx, tex, mime = read_glb(SRC)
    print('in : %d verts, %d tris' % (len(pos), len(idx) // 3))

    # graft the two missing fingers from the two that reconstructed
    pos, uv, idx = graft(pos, uv, idx, *FINGER_A, dx=-SPACING, zscale=0.84)   # pinky side
    pos, uv, idx = graft(pos, uv, idx, *FINGER_B, dx=+SPACING, zscale=0.94)   # index side

    pos = bend_thumb(pos)
    pos = taper_wrist(pos)

    print('out: %d verts, %d tris' % (len(pos), len(idx) // 3))
    print('bbox x %.3f..%.3f  z %.3f..%.3f' % (
        pos[:, 0].min(), pos[:, 0].max(), pos[:, 2].min(), pos[:, 2].max()))
    print('bytes:', write_glb(DST, pos, uv, idx, tex, mime))


if __name__ == '__main__':
    main()
