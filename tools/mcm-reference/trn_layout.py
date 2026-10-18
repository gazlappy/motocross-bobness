# Walk a .TRN terrain using the layout from AlexKimov/motocross-madness-file-formats (TRN.bt), printing
# offsets and the sizes of each block. Reference only: reads the user's own copy of the game.
import struct, sys
d = open(sys.argv[1], 'rb').read()
o = 0
def u32():
    global o
    v = struct.unpack_from('<I', d, o)[0]; o += 4; return v
def f32():
    global o
    v = struct.unpack_from('<f', d, o)[0]; o += 4; return v
magic = d[0:4]; o = 4; ver = u32()
tf = u32(); print('magic', magic, 'ver', ver, 'textureFormat', tf)
if tf:
    unk = u32(); colours = u32(); data = u32(); print(' unk', unk, 'colours', colours, 'data', data)
    if data:
        for name, raw in (('colormap', 768), ('data2', 32768), ('data3', 65536)):
            size = u32(); print(f'  {name}: stored {size} (raw {raw}) at {o}'); o += min(size, raw) if size == raw else size
    else:
        o += 768 + 32768 + 65536
U = u32(); fl = f32(); count = u32(); print('U', U, 'float', fl, 'count', count, 'at', o)
pos = struct.unpack_from(f'<{count}I', d, o); o += 4 * count
print(' positions', pos[:8], '...')
for i in range(count):
    sizes = []
    for k in range(3):
        a = struct.unpack_from('<i', d, o)[0]; b = struct.unpack_from('<i', d, o + 4)[0]; o += 8
        n = b if b <= a else a; sizes.append((a, b)); o += n
    if i < 4 or i == count - 1: print(f'  tile {i}: (raw,stored) {sizes}')
K = u32(); G = u32(); print('K', K, 'G', G, 'at', o)
def nb(c):
    return {1:3,9:3,2:2,7:2,3:2,8:2,4:1,6:1,5:3,10:2,13:2,11:2,14:2,12:4,15:4}.get(c, 0)
if G:
    A, B, C = u32(), u32(), u32(); print(' I1', A, B, C, 'bytes', A*B*nb(C), '+', A*B*nb(C)//4, 'at', o); o += A*B*nb(C) + A*B*nb(C)//4
if K:
    A, B, C = u32(), u32(), u32(); print(' I2', A, B, C, 'x', K, 'at', o); o += A*B*nb(C)*K + K*A*B*nb(C)//4
print('tail at', o, 'of', len(d), 'remaining', len(d) - o)
print(' tail u32s', struct.unpack_from('<15I', d, o) if len(d) - o >= 60 else d[o:])
