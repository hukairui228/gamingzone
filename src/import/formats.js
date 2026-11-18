// Small file-format helpers for the importer: XML, PNG write, CgBI PNG read, TrueType table removal.

// ---------------- minimal XML (enough for COLLADA source.dae) ----------------
const ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const unent = (s) => (s.indexOf('&') < 0 ? s : s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENT[e] ?? m)));

/** -> root element {tag, attrs, children, text}; text is the text before the first child (ElementTree .text) */
export function parseXML(src) {
  const s = src.replace(/\r\n?/g, '\n');
  const doc = { tag: '#doc', attrs: {}, children: [], text: '' };
  const stack = [doc];
  let i = 0;
  const addText = (t) => { const top = stack[stack.length - 1]; if (!top.children.length) top.text += t; };
  while (i < s.length) {
    const lt = s.indexOf('<', i);
    if (lt < 0) { addText(unent(s.slice(i))); break; }
    if (lt > i) addText(unent(s.slice(i, lt)));
    if (s.startsWith('<!--', lt)) { i = s.indexOf('-->', lt) + 3; if (i < 3) break; continue; }
    if (s.startsWith('<?', lt)) { i = s.indexOf('?>', lt) + 2; if (i < 2) break; continue; }
    if (s.startsWith('<![CDATA[', lt)) { const e = s.indexOf(']]>', lt); addText(s.slice(lt + 9, e)); i = e + 3; continue; }
    if (s.startsWith('<!', lt)) { i = s.indexOf('>', lt) + 1; continue; }
    if (s[lt + 1] === '/') { stack.length > 1 && stack.pop(); i = s.indexOf('>', lt) + 1; continue; }
    // start tag
    let j = lt + 1;
    while (j < s.length && !/[\s/>]/.test(s[j])) j++;
    const el = { tag: s.slice(lt + 1, j), attrs: {}, children: [], text: '' };
    for (;;) {
      while (/\s/.test(s[j])) j++;
      if (s[j] === '>' || s[j] === '/') break;
      let k = j;
      while (!/[\s=]/.test(s[k])) k++;
      const name = s.slice(j, k);
      while (/\s/.test(s[k])) k++;
      if (s[k] !== '=') { j = k; el.attrs[name] = ''; continue; }
      k++;
      while (/\s/.test(s[k])) k++;
      const q = s[k], e = s.indexOf(q, k + 1);
      el.attrs[name] = unent(s.slice(k + 1, e).replace(/[\t\n]/g, ' '));
      j = e + 1;
    }
    stack[stack.length - 1].children.push(el);
    if (s[j] === '/') { i = s.indexOf('>', j) + 1; } else { stack.push(el); i = j + 1; }
  }
  return doc.children[0];
}

/** document-order iteration over el and its descendants with the given tag (ElementTree .iter) */
export function* iterXML(el, tag) {
  if (el.tag === tag) yield el;
  for (const c of el.children) yield* iterXML(c, tag);
}
export const child = (el, tag) => el.children.find((c) => c.tag === tag);
export const childrenOf = (el, tag) => el.children.filter((c) => c.tag === tag);

// ---------------- streams ----------------
async function pipe(bytes, stream) {
  const s = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(s).arrayBuffer());
}
export const inflateRaw = (b) => pipe(b, new DecompressionStream('deflate-raw'));
export const deflateZlib = (b) => pipe(b, new CompressionStream('deflate'));

// ---------------- PNG ----------------
const CRC = new Uint32Array(256);
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; }
function crc32(b, c = 0xffffffff) { for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return c; }

/** RGBA pixels -> PNG bytes (RGB when channels = 3), adaptive per-row filters */
export async function encodePNG(rgba, w, h, channels = 4) {
  const bpp = channels, stride = w * bpp;
  const raw = new Uint8Array((stride + 1) * h);
  const prev = new Uint8Array(stride), cur = new Uint8Array(stride), cand = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    for (let x = 0, s = y * w * 4, d = 0; x < w; x++, s += 4, d += bpp) {
      cur[d] = rgba[s]; cur[d + 1] = rgba[s + 1]; cur[d + 2] = rgba[s + 2];
      if (bpp === 4) cur[d + 3] = rgba[s + 3];
    }
    let best = 0, bestSum = Infinity;
    for (let f = 0; f < 5; f++) {
      let sum = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
        let p;
        if (f === 0) p = 0; else if (f === 1) p = a; else if (f === 2) p = b; else if (f === 3) p = (a + b) >> 1;
        else { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
        const v = (cur[i] - p) & 255;
        cand[i] = v; sum += v < 128 ? v : 256 - v;
      }
      if (sum < bestSum) { bestSum = sum; best = f; raw.set(cand, y * (stride + 1) + 1); raw[y * (stride + 1)] = f; }
    }
    prev.set(cur);
    void best;
  }
  const idat = await deflateZlib(raw);
  const chunks = [];
  const chunk = (type, data) => {
    const b = new Uint8Array(12 + data.length), dv = new DataView(b.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) b[4 + i] = type.charCodeAt(i);
    b.set(data, 8);
    dv.setUint32(8 + data.length, (crc32(b.subarray(4, 8 + data.length)) ^ 0xffffffff) >>> 0);
    chunks.push(b);
  };
  const ihdr = new Uint8Array(13), hv = new DataView(ihdr.buffer);
  hv.setUint32(0, w); hv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = channels === 4 ? 6 : 2;
  chunk('IHDR', ihdr); chunk('IDAT', idat); chunk('IEND', new Uint8Array(0));
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const out = new Uint8Array(8 + chunks.reduce((n, c) => n + c.length, 0));
  out.set(sig); let o = 8;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

/** Apple CgBI PNG (raw deflate, BGRA) -> {width, height, rgba} like tools/cgbi.py */
export async function decodeCgBI(data) {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let o = 8, w = 0, h = 0;
  const idat = [];
  while (o < data.length) {
    const n = dv.getUint32(o);
    const t = String.fromCharCode(...data.subarray(o + 4, o + 8));
    const c = data.subarray(o + 8, o + 8 + n);
    o += 12 + n;
    if (t === 'IHDR') { w = dv.getUint32(o - 12 - n + 8); h = dv.getUint32(o - 12 - n + 12); }
    if (t === 'IDAT') idat.push(c);
    if (t === 'IEND') break;
  }
  const raw = await inflateRaw(new Uint8Array(await new Blob(idat).arrayBuffer()));
  const stride = w * 4;
  const out = new Uint8Array(h * stride);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? cur[i - 4] : 0, b = prev[i], c = i >= 4 ? prev[i - 4] : 0;
      let p;
      if (f === 0) p = 0; else if (f === 1) p = a; else if (f === 2) p = b; else if (f === 3) p = (a + b) >> 1;
      else { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[i] = (line[i] + p) & 255;
    }
    prev = cur;
  }
  for (let i = 0; i < out.length; i += 4) { const t = out[i]; out[i] = out[i + 2]; out[i + 2] = t; }
  return { width: w, height: h, rgba: out };
}

// ---------------- TrueType ----------------
/** Rebuild an sfnt without the given tables (browsers reject the original vhea 1.1 tables) */
export function dropFontTables(font, drop = ['vhea', 'vmtx', 'VORG']) {
  const dv = new DataView(font.buffer, font.byteOffset, font.byteLength);
  const num = dv.getUint16(4);
  const tables = [];
  for (let i = 0; i < num; i++) {
    const e = 12 + i * 16;
    const tag = String.fromCharCode(font[e], font[e + 1], font[e + 2], font[e + 3]);
    tables.push({ tag, sum: dv.getUint32(e + 4), off: dv.getUint32(e + 8), len: dv.getUint32(e + 12) });
  }
  const keep = tables.filter((t) => !drop.includes(t.tag)).sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  if (keep.length === tables.length) return font;
  const n = keep.length;
  let es = 0; while ((1 << (es + 1)) <= n) es++;
  const sr = (1 << es) * 16;
  let size = 12 + 16 * n;
  for (const t of keep) size += (t.len + 3) & ~3;
  const out = new Uint8Array(size), ov = new DataView(out.buffer);
  ov.setUint32(0, dv.getUint32(0)); ov.setUint16(4, n); ov.setUint16(6, sr); ov.setUint16(8, es); ov.setUint16(10, n * 16 - sr);
  let o = 12 + 16 * n, headOff = -1;
  const sum = (a, b) => { let s = 0; for (let i = a; i < b; i += 4) s = (s + ((out[i] << 24) | (out[i + 1] << 16) | (out[i + 2] << 8) | out[i + 3])) >>> 0; return s; };
  keep.forEach((t, i) => {
    out.set(font.subarray(t.off, t.off + t.len), o);
    if (t.tag === 'head') { headOff = o; out[o + 8] = out[o + 9] = out[o + 10] = out[o + 11] = 0; }
    const e = 12 + i * 16;
    for (let k = 0; k < 4; k++) out[e + k] = t.tag.charCodeAt(k);
    ov.setUint32(e + 4, sum(o, o + ((t.len + 3) & ~3))); ov.setUint32(e + 8, o); ov.setUint32(e + 12, t.len);
    o += (t.len + 3) & ~3;
  });
  if (headOff >= 0) ov.setUint32(headOff + 8, (0xb1b0afba - sum(0, size)) >>> 0);
  return out;
}
