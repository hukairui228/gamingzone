"""Decode Gangstar 2 .tga files (actually PVR v2 containers) to PNG."""
import struct, sys, os
import numpy as np
from PIL import Image
import texture2ddecoder as t2d

def decode(path):
    d = open(path, 'rb').read()
    hs, h, w, mips, flags, size, bpp = struct.unpack('<7I', d[:28])
    fmt = flags & 0xff
    data = d[hs:]
    if fmt in (0x18, 0x19):
        n = max(w, 8 if fmt == 0x19 else 16) * max(h, 8) * (4 if fmt == 0x19 else 2) // 8
        raw = t2d.decode_pvrtc(data[:n], w, h, fmt == 0x18)
        img = Image.frombuffer('RGBA', (w, h), raw, 'raw', 'BGRA')
    elif fmt == 0x10:  # RGBA4444
        a = np.frombuffer(data[:w * h * 2], '<u2').reshape(h, w)
        r = ((a >> 12) & 15) * 17; g = ((a >> 8) & 15) * 17; b = ((a >> 4) & 15) * 17; al = (a & 15) * 17
        img = Image.fromarray(np.stack([r, g, b, al], -1).astype(np.uint8), 'RGBA')
    elif fmt == 0x13:  # RGB565
        a = np.frombuffer(data[:w * h * 2], '<u2').reshape(h, w)
        r = ((a >> 11) & 31) * 255 // 31; g = ((a >> 5) & 63) * 255 // 63; b = (a & 31) * 255 // 31
        img = Image.fromarray(np.stack([r, g, b], -1).astype(np.uint8), 'RGB')
    else:
        raise ValueError(f'{path}: unsupported pvr format {fmt:#x}')
    if not (flags & 0x8000) and img.mode == 'RGBA':
        img = img.convert('RGB')
    return img.transpose(Image.FLIP_TOP_BOTTOM) if (flags & 0x10000) else img

if __name__ == '__main__':
    src, dst = sys.argv[1], sys.argv[2]
    os.makedirs(dst, exist_ok=True)
    for f in sorted(os.listdir(src)):
        if f.lower().endswith('.tga') and not f.endswith('_lo.tga'):
            try:
                decode(os.path.join(src, f)).save(os.path.join(dst, f[:-4].lower() + '.png'))
            except Exception as e:
                print('skip', f, e)
