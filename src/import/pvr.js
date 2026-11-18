// PVR v2 textures (the game's .tga/.bmp files): header parsing and CPU decoding.
// The PVRTC decoder is a straight port of texture2ddecoder's pvrtc.cpp (used by tools/pvr2png.py),
// so it produces the same pixels bit for bit.

const FMT = { 0x18: 'pvrtc2', 0x19: 'pvrtc4', 0x10: 'rgba4444', 0x13: 'rgb565' };

function header(bytes) {
  if (bytes.length < 28) throw new Error('PVR: file too short');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u = (o) => dv.getUint32(o, true);
  return { hs: u(0), height: u(4), width: u(8), mips: u(12), flags: u(16), size: u(20), bpp: u(24) };
}

function levelSize(format, w, h) {
  if (format === 'pvrtc4') return (Math.max(w, 8) * Math.max(h, 8) * 4) >> 3;
  if (format === 'pvrtc2') return (Math.max(w, 16) * Math.max(h, 8) * 2) >> 3;
  return w * h * 2;
}

/** Header + per-level data views (no decoding): {width, height, format, mips: [Uint8Array...], hasAlpha, flip} */
export function parsePVR(bytes) {
  const hd = header(bytes);
  const fmt = hd.flags & 0xff;
  const format = FMT[fmt];
  if (!format) throw new Error('unsupported pvr format 0x' + fmt.toString(16));
  const mips = [];
  let w = hd.width, h = hd.height, o = hd.hs;
  const levels = (hd.flags & 0x100) || hd.mips ? hd.mips + 1 : 1;
  for (let i = 0; i < levels; i++) {
    const n = levelSize(format, w, h);
    if (o + n > bytes.length) break;
    mips.push(bytes.subarray(o, o + n));
    o += n; w = Math.max(1, w >> 1); h = Math.max(1, h >> 1);
  }
  if (!mips.length) throw new Error('PVR: truncated data');
  return { width: hd.width, height: hd.height, format, mips, hasAlpha: !!(hd.flags & 0x8000), flip: !!(hd.flags & 0x10000) };
}

// ---------------- PVRTC (texture2ddecoder pvrtc.cpp) ----------------
const STANDARD_WEIGHT = [0, 3, 5, 8];
const PUNCH_WEIGHT = [0, 4, 4, 8];

function morton(x, y, minDim) {
  let offset = 0, shift = 0;
  for (let mask = 1; mask < minDim; mask <<= 1, shift++) offset |= ((y & mask) | ((x & mask) << 1)) << shift;
  offset |= ((x | y) >> shift) << (shift * 2);
  return offset;
}

// texel info stored in flat typed arrays: colours a/b (r,g,b,a each), 32 int8 weights, punch-through mask
function texelInfo(data, nBlocks, is2bpp) {
  const ca = new Uint8Array(nBlocks * 4), cb = new Uint8Array(nBlocks * 4);
  const wt = new Int8Array(nBlocks * 32), punch = new Uint32Array(nBlocks);
  for (let i = 0; i < nBlocks; i++) {
    const d = i * 8;
    const A = data[d + 4] | (data[d + 5] << 8), B = data[d + 6] | (data[d + 7] << 8);
    const a = i * 4;
    if (A & 0x8000) {
      ca[a] = (A >> 10) & 0x1f; ca[a + 1] = (A >> 5) & 0x1f; ca[a + 2] = (A & 0x1e) | ((A >> 4) & 1); ca[a + 3] = 0xf;
    } else {
      ca[a] = ((A >> 7) & 0x1e) | ((A >> 11) & 1); ca[a + 1] = ((A >> 3) & 0x1e) | ((A >> 7) & 1);
      ca[a + 2] = ((A << 1) & 0x1c) | ((A >> 2) & 3); ca[a + 3] = (A >> 11) & 0xe;
    }
    if (B & 0x8000) {
      cb[a] = (B >> 10) & 0x1f; cb[a + 1] = (B >> 5) & 0x1f; cb[a + 2] = B & 0x1f; cb[a + 3] = 0xf;
    } else {
      cb[a] = ((B >> 7) & 0x1e) | ((B >> 11) & 1); cb[a + 1] = ((B >> 3) & 0x1e) | ((B >> 7) & 1);
      cb[a + 2] = ((B << 1) & 0x1e) | ((B >> 3) & 1); cb[a + 3] = (B >> 11) & 0xe;
    }
    const modMode = data[d + 4] & 1;
    let bits = (data[d] | (data[d + 1] << 8) | (data[d + 2] << 16) | (data[d + 3] << 24)) >>> 0;
    const W = i * 32;
    if (!is2bpp) {
      if (modMode) {
        let pf = 0;
        for (let k = 0; k < 16; k++, bits >>>= 2) {
          wt[W + k] = PUNCH_WEIGHT[bits & 3];
          if ((bits & 3) === 2) pf |= 1 << k;
        }
        punch[i] = pf >>> 0;
      } else {
        for (let k = 0; k < 16; k++, bits >>>= 2) wt[W + k] = STANDARD_WEIGHT[bits & 3];
      }
    } else if (modMode) {
      const fill = data[d] & 1 ? (data[d + 2] & 0x10 ? -1 : -2) : -3;
      for (let y = 0, k = 1; y < 4; (++y & 1) ? --k : ++k) for (let x = 0; x < 4; x++, k += 2) wt[W + k] = fill;
      for (let y = 0, k = 0; y < 4; (++y & 1) ? ++k : --k) for (let x = 0; x < 4; x++, k += 2, bits >>>= 2) wt[W + k] = STANDARD_WEIGHT[bits & 3];
      wt[W] = (wt[W] + 3) & 8;
      if (data[d] & 1) wt[W + 20] = (wt[W + 20] + 3) & 8;
    } else {
      for (let k = 0; k < 32; k++, bits >>>= 1) wt[W + k] = bits & 1 ? 8 : 0;
    }
  }
  return { ca, cb, wt, punch };
}

const IW4 = [[2, 2, 0], [1, 3, 0], [0, 4, 0], [0, 3, 1]];
const IWX2 = [[4, 4, 0], [3, 5, 0], [2, 6, 0], [1, 7, 0], [0, 8, 0], [0, 7, 1], [0, 6, 2], [0, 5, 3]];
const POSYA = [[1, 24], [4, -8], [4, -8], [4, -8]];
const POSYB = [[4, 8], [4, 8], [4, 8], [7, -24]];
const POSXL = [[3, 7], [4, -1], [4, -1], [4, -1], [4, -1], [4, -1], [4, -1], [4, -1]];
const POSXR = [[4, 1], [4, 1], [4, 1], [4, 1], [4, 1], [4, 1], [4, 1], [5, -7]];

/** Decode one PVRTC level to RGBA bytes (w*h*4). */
export function decodePVRTC(data, w, h, is2bpp) {
  const bw = is2bpp ? 8 : 4;
  const nbx = is2bpp ? (w + 7) >> 3 : (w + 3) >> 2;
  const nby = (h + 3) >> 2;
  const nBlocks = nbx * nby;
  const minDim = Math.min(nbx, nby);
  if ((nbx & (nbx - 1)) || (nby & (nby - 1))) throw new Error('PVRTC: block counts must be powers of two');
  if (data.length < nBlocks * 8) throw new Error('PVRTC: truncated data');
  const { ca, cb, wt, punch } = texelInfo(data, nBlocks, is2bpp);
  const out = new Uint8Array(w * h * 4);
  const npx = bw * 4;
  const cA = new Int32Array(npx * 4), cB = new Int32Array(npx * 4), buf = new Uint8Array(npx * 4);
  const local = new Int32Array(9);
  const IWX = is2bpp ? IWX2 : IW4;
  const sx = is2bpp ? 2 : 1, sa = is2bpp ? 1 : 0; // colour shift (>>1 / >>2), alpha shift (>>0 / >>1)
  for (let by = 0; by < nby; by++) {
    const py0 = by === 0 ? nby - 1 : by - 1, py2 = by === nby - 1 ? 0 : by + 1;
    for (let bx = 0; bx < nbx; bx++) {
      const px0 = bx === 0 ? nbx - 1 : bx - 1, px2 = bx === nbx - 1 ? 0 : bx + 1;
      const PX = [px0, bx, px2], PY = [py0, by, py2];
      for (let cy = 0, c = 0; cy < 3; cy++) for (let cx = 0; cx < 3; cx++, c++) local[c] = morton(PX[cx], PY[cy], minDim);
      cA.fill(0); cB.fill(0);
      for (let y = 0, i = 0; y < 4; y++) {
        for (let x = 0; x < bw; x++, i++) {
          const j = i * 4;
          for (let acy = 0, ac = 0; acy < 3; acy++) {
            for (let acx = 0; acx < 3; acx++, ac++) {
              const iw = IWX[x][acx] * IW4[y][acy];
              if (!iw) continue;
              const t = local[ac] * 4;
              cA[j] += ca[t] * iw; cA[j + 1] += ca[t + 1] * iw; cA[j + 2] += ca[t + 2] * iw; cA[j + 3] += ca[t + 3] * iw;
              cB[j] += cb[t] * iw; cB[j + 1] += cb[t + 1] * iw; cB[j + 2] += cb[t + 2] * iw; cB[j + 3] += cb[t + 3] * iw;
            }
          }
          for (let k = 0; k < 3; k++) {
            cA[j + k] = (cA[j + k] >> sx) + (cA[j + k] >> (sx + 5));
            cB[j + k] = (cB[j + k] >> sx) + (cB[j + k] >> (sx + 5));
          }
          cA[j + 3] = (cA[j + 3] >> sa) + (cA[j + 3] >> (sa + 4));
          cB[j + 3] = (cB[j + 3] >> sa) + (cB[j + 3] >> (sa + 4));
        }
      }
      const self = local[4], SW = self * 32;
      let pf = punch[self];
      for (let y = 0, i = 0; y < 4; y++) {
        for (let x = 0; x < bw; x++, i++, pf >>>= 1) {
          if (is2bpp) {
            const v = wt[SW + i];
            if (v < 0) {
              const ya = wt[local[POSYA[y][0]] * 32 + i + POSYA[y][1]], yb = wt[local[POSYB[y][0]] * 32 + i + POSYB[y][1]];
              const xl = wt[local[POSXL[x][0]] * 32 + i + POSXL[x][1]], xr = wt[local[POSXR[x][0]] * 32 + i + POSXR[x][1]];
              wt[SW + i] = v === -1 ? Math.trunc((ya + yb + 1) / 2) : v === -2 ? Math.trunc((xl + xr + 1) / 2) : Math.trunc((ya + yb + xl + xr + 2) / 4);
            }
          }
          const w8 = wt[SW + i], j = i * 4;
          buf[j] = Math.trunc((cA[j] * (8 - w8) + cB[j] * w8) / 8);
          buf[j + 1] = Math.trunc((cA[j + 1] * (8 - w8) + cB[j + 1] * w8) / 8);
          buf[j + 2] = Math.trunc((cA[j + 2] * (8 - w8) + cB[j + 2] * w8) / 8);
          buf[j + 3] = pf & 1 ? 0 : Math.trunc((cA[j + 3] * (8 - w8) + cB[j + 3] * w8) / 8);
        }
      }
      // copy_block_buffer
      const x0 = bw * bx, xl = Math.min(bw, w - x0) * 4;
      for (let r = 0, y = by * 4; r < 4 && y < h; r++, y++) out.set(buf.subarray(r * bw * 4, r * bw * 4 + xl), (y * w + x0) * 4);
    }
  }
  return out;
}

/** Decode a PVR file to RGBA pixels, like tools/pvr2png.py (alpha forced to 255 when the file has none). */
export function decodePVR(bytes) {
  const hd = header(bytes);
  const fmt = hd.flags & 0xff;
  const w = hd.width, h = hd.height;
  const data = bytes.subarray(hd.hs);
  let rgba;
  if (fmt === 0x18 || fmt === 0x19) {
    const n = (Math.max(w, fmt === 0x19 ? 8 : 16) * Math.max(h, 8) * (fmt === 0x19 ? 4 : 2)) >> 3;
    rgba = decodePVRTC(data.subarray(0, n), w, h, fmt === 0x18);
  } else if (fmt === 0x10 || fmt === 0x13) {
    if (data.length < w * h * 2) throw new Error('PVR: truncated data');
    rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const a = data[i * 2] | (data[i * 2 + 1] << 8), o = i * 4;
      if (fmt === 0x10) {
        rgba[o] = ((a >> 12) & 15) * 17; rgba[o + 1] = ((a >> 8) & 15) * 17; rgba[o + 2] = ((a >> 4) & 15) * 17; rgba[o + 3] = (a & 15) * 17;
      } else {
        rgba[o] = Math.floor(((a >> 11) & 31) * 255 / 31); rgba[o + 1] = Math.floor(((a >> 5) & 63) * 255 / 63);
        rgba[o + 2] = Math.floor((a & 31) * 255 / 31); rgba[o + 3] = 255;
      }
    }
  } else throw new Error('unsupported pvr format 0x' + fmt.toString(16));
  const hasAlpha = !!(hd.flags & 0x8000) && fmt !== 0x13;
  if (!hasAlpha) for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  if (hd.flags & 0x10000) {
    const row = w * 4, tmp = new Uint8Array(row);
    for (let y = 0; y < h >> 1; y++) {
      const a = y * row, b = (h - 1 - y) * row;
      tmp.set(rgba.subarray(a, a + row)); rgba.copyWithin(a, b, b + row); rgba.set(tmp, b);
    }
  }
  return { width: w, height: h, rgba, hasAlpha };
}
