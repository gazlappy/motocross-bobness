# Decode a Motocross Madness animation (.VUB): u32 frames, u32 bones, then per frame per bone three
# float triples (layout from AlexKimov/motocross-madness-file-formats VUB.bt). Bone order comes from
# the matching .VUT (RIDER.VUT / BIKE.VUT). Reference only.
import struct, sys

def read(path):
    d = open(path, 'rb').read()
    frames, bones = struct.unpack_from('<II', d, 0)
    data = struct.unpack_from(f'<{frames * bones * 9}f', d, 8)
    out = []
    for f in range(frames):
        row = []
        for b in range(bones):
            v = data[(f * bones + b) * 9:(f * bones + b + 1) * 9]
            row.append((v[0:3], v[3:6], v[6:9]))
        out.append(row)
    return out

def bone_names(vut):
    return [line.split('=')[0].strip() for line in open(vut).read().splitlines() if '=' in line]

if __name__ == '__main__':
    names = bone_names(sys.argv[2]) if len(sys.argv) > 2 else None
    anim = read(sys.argv[1])
    print(len(anim), 'frames', len(anim[0]), 'bones', 'file size check')
    for b, (a, c, e) in enumerate(anim[0]):
        n = names[b] if names and b < len(names) else b
        print(f'  {n:8} A {tuple(round(x, 3) for x in a)}  B {tuple(round(x, 3) for x in c)}  C {tuple(round(x, 3) for x in e)}')
