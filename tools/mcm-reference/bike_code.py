"""Disassemble parts of the original MCM.EXE to study its bike physics (reference only).

With no range, prints the bike's built-in defaults: the constructor's float constants, which match
SBIKE/BIKE2.BIK. With a range (virtual addresses, hex), prints that stretch of code with x87 float
constants resolved. Needs: pip install capstone pefile

    python -I tools/mcm-reference/bike_code.py reference/mcm-disc/GAME/MCM.EXE
    python -I tools/mcm-reference/bike_code.py reference/mcm-disc/GAME/MCM.EXE 4b1870 4b1960

Places worth reading (retail 1998 EXE): 4a2100 bike defaults, 4ac335 lean, 4b1870 rear tyre
friction, 4b1960 front tyre friction, 49ed40 handlebar lock.
"""
import re
import struct
import sys

import capstone
import pefile

exe = sys.argv[1]
start = int(sys.argv[2], 16) if len(sys.argv) > 2 else 0x4A2100
end = int(sys.argv[3], 16) if len(sys.argv) > 3 else 0x4A2440
defaults_only = len(sys.argv) <= 2

pe = pefile.PE(exe)
data = open(exe, 'rb').read()
base = pe.OPTIONAL_HEADER.ImageBase


def file_offset(va):
    for s in pe.sections:
        o = va - base - s.VirtualAddress
        if 0 <= o < s.SizeOfRawData:
            return s.PointerToRawData + o
    return None


def constant(va, size):
    o = file_offset(va)
    if o is None:
        return None
    return struct.unpack('<d' if size == 8 else '<f', data[o:o + size])[0]


md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_32)
code_at = file_offset(start)
for ins in md.disasm(data[code_at:code_at + (end - start)], start):
    note = ''
    if ins.mnemonic == 'mov' and 'dword ptr' in ins.op_str and ', 0x' in ins.op_str:
        imm = int(ins.op_str.split(', ')[-1], 16) & 0xFFFFFFFF
        f = struct.unpack('<f', struct.pack('<I', imm))[0]
        if 1e-6 < abs(f) < 1e7:
            note = f'   ; {f:g}'
    m = re.search(r'\[0x([0-9a-f]{6,})\]', ins.op_str)
    if m and ins.mnemonic.startswith('f'):
        v = constant(int(m.group(1), 16), 8 if 'qword' in ins.op_str else 4)
        if v is not None:
            note = f'   ; {v:g}'
    if defaults_only and not note:
        continue
    print(f'{ins.address:x}  {ins.mnemonic} {ins.op_str}{note}')
