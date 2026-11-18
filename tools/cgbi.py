"""Decode Apple-optimised (CgBI) PNGs from an IPA: raw deflate, BGRA, premultiplied."""
import struct, zlib
import numpy as np
from PIL import Image


def decode(data):
    o, idat, w, h = 8, b'', 0, 0
    while o < len(data):
        n, = struct.unpack('>I', data[o:o + 4]); t = data[o + 4:o + 8]; c = data[o + 8:o + 8 + n]; o += 12 + n
        if t == b'IHDR': w, h = struct.unpack('>II', c[:8])
        if t == b'IDAT': idat += c
        if t == b'IEND': break
    raw = np.frombuffer(zlib.decompress(idat, -15), np.uint8)
    stride = w * 4
    out = np.zeros((h, stride), np.int32)
    prev = np.zeros(stride, np.int32)
    for y in range(h):
        f = raw[y * (stride + 1)]
        line = raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)].astype(np.int32)
        if f == 0: cur = line
        elif f == 2: cur = (line + prev) & 255
        else:
            cur = np.zeros(stride, np.int32)
            for i in range(stride):
                a = cur[i - 4] if i >= 4 else 0; b = prev[i]; c = prev[i - 4] if i >= 4 else 0
                if f == 1: p = a
                elif f == 3: p = (a + b) // 2
                else:
                    pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                    p = a if pa <= pb and pa <= pc else (b if pb <= pc else c)
                cur[i] = (line[i] + p) & 255
        out[y] = cur; prev = cur
    return Image.fromarray(out.reshape(h, w, 4)[:, :, [2, 1, 0, 3]].astype(np.uint8), 'RGBA')
