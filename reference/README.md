# reference/

Not shipped. Study material for anyone working on the AirMouse hand.

## `hand-target.jpg` — the look to reach

A real hand, palm to camera, fingers spread, on deep navy, soft even studio
light with a faint cool rim down the left edge. Open it and look before judging
a render. Note specifically: **fingernails**, knuckle and joint creases, palm
crease lines, redness at fingertips and knuckles, translucency at the thumb's
outer edge, and how the forearm falls off into shadow.

## `hand-scan.glb` — a photogrammetry reconstruction of that same photo

Not usable in the site: one unrigged mesh, 2340 verts, fingers partly fused,
and its texture has the studio lighting baked in (which is exactly why it
rendered like putty). Kept because its *geometry* is measured from a real hand
— useful for proportions, palm curvature, and how the digits taper.

Read its vertex positions without a 3D program:

```python
import struct, json, numpy as np
d = open('reference/hand-scan.glb','rb').read()
jl = struct.unpack('<I', d[12:16])[0]
g = json.loads(d[20:20+jl]); binc = d[20+jl+8:]
bv = g['bufferViews'][g['accessors'][1]['bufferView']]
o = bv.get('byteOffset', 0)
pos = np.frombuffer(binc[o:o+bv['byteLength']], dtype='<f4').reshape(-1, 3)
```

Bounding box is roughly 0.60 x 0.14 x 0.99 units — a hand is about 1.65x
longer than wide and only ~0.23 as thick as it is wide. Replicate the
proportions; do not import the mesh.
