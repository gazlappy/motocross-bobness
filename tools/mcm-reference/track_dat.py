# Decode a Motocross Madness track centreline (.DAT next to a .TRN): a u32 count, then per point
# x (f32), an unused u32, z (f32), height (f32) and a type (u32). Reference only.
import json, math, struct, sys

def read(path):
    d = open(path, 'rb').read()
    n = struct.unpack_from('<I', d, 0)[0]
    pts = [struct.unpack_from('<fIffI', d, 4 + i * 20) for i in range(n)]
    return [{'x': p[0], 'z': p[2], 'y': p[3], 'type': p[4], 'pad': p[1]} for p in pts]

if __name__ == '__main__':
    for path in sys.argv[1:]:
        pts = read(path)
        seg = [math.dist((a['x'], a['z']), (b['x'], b['z'])) for a, b in zip(pts, pts[1:] + pts[:1])]
        xs, zs, ys = [p['x'] for p in pts], [p['z'] for p in pts], [p['y'] for p in pts]
        types = {}
        for p in pts: types[p['type']] = types.get(p['type'], 0) + 1
        print(f"{path.split('/')[-1]:14} pts {len(pts):3} loop {sum(seg):7.0f}  spacing {min(seg):5.1f}-{max(seg):5.1f}  "
              f"x {min(xs):6.0f}-{max(xs):6.0f}  z {min(zs):6.0f}-{max(zs):6.0f}  h {min(ys):5.1f}-{max(ys):5.1f}  types {types}  pads {set(p['pad'] for p in pts)}")
