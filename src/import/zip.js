// Minimal zip reader for IPA files (and the zip-based .bdae containers inside them).
// Works on a Blob/File without loading it whole: only the central directory and the entries
// that are read are sliced out. Supports stored and deflated entries (and zip64 sizes/offsets).

async function inflateRaw(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

function source(src) {
  if (src instanceof Uint8Array) return { size: src.length, read: async (o, n) => src.subarray(o, o + n) };
  if (src instanceof ArrayBuffer) return source(new Uint8Array(src));
  return { size: src.size, read: async (o, n) => new Uint8Array(await src.slice(o, o + n).arrayBuffer()) };
}

const td = new TextDecoder('utf-8');
const latin = (b) => { let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return s; };

/**
 * Open a zip archive.
 * @param {Blob|Uint8Array|ArrayBuffer} blob
 * @returns {Promise<{list(): string[], read(name: string): Promise<Uint8Array>, size(name: string): number}>}
 */
export async function openZip(blob) {
  const src = source(blob);
  const tailLen = Math.min(src.size, 65557);
  const tail = await src.read(src.size - tailLen, tailLen);
  const tv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let e = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (tv.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('不是有效的 zip / IPA 文件');
  let count = tv.getUint16(e + 10, true), cdSize = tv.getUint32(e + 12, true), cdOff = tv.getUint32(e + 16, true);
  if (count === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff) {
    // zip64 end of central directory locator sits just before the EOCD
    const l = e - 20;
    if (l >= 0 && tv.getUint32(l, true) === 0x07064b50) {
      const z64 = Number(tv.getBigUint64(l + 8, true));
      const r = await src.read(z64, 56);
      const rv = new DataView(r.buffer, r.byteOffset, r.byteLength);
      if (rv.getUint32(0, true) !== 0x06064b50) throw new Error('zip64 记录损坏');
      count = Number(rv.getBigUint64(32, true)); cdSize = Number(rv.getBigUint64(40, true)); cdOff = Number(rv.getBigUint64(48, true));
    }
  }
  const cd = await src.read(cdOff, cdSize);
  const cv = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
  const entries = new Map();
  const names = [];
  let p = 0;
  for (let i = 0; i < count && p + 46 <= cd.length; i++) {
    if (cv.getUint32(p, true) !== 0x02014b50) throw new Error('zip 目录损坏');
    const flags = cv.getUint16(p + 8, true), method = cv.getUint16(p + 10, true);
    let csize = cv.getUint32(p + 20, true), usize = cv.getUint32(p + 24, true);
    const nl = cv.getUint16(p + 28, true), xl = cv.getUint16(p + 30, true), cl = cv.getUint16(p + 32, true);
    let off = cv.getUint32(p + 42, true);
    const nb = cd.subarray(p + 46, p + 46 + nl);
    const name = flags & 0x800 ? td.decode(nb) : latin(nb);
    // zip64 extra field
    for (let x = p + 46 + nl, xe = x + xl; x + 4 <= xe;) {
      const id = cv.getUint16(x, true), len = cv.getUint16(x + 2, true);
      if (id === 1) {
        let q = x + 4;
        if (usize === 0xffffffff) { usize = Number(cv.getBigUint64(q, true)); q += 8; }
        if (csize === 0xffffffff) { csize = Number(cv.getBigUint64(q, true)); q += 8; }
        if (off === 0xffffffff) { off = Number(cv.getBigUint64(q, true)); q += 8; }
      }
      x += 4 + len;
    }
    if (!entries.has(name)) names.push(name);
    entries.set(name, { method, csize, usize, off });
    p += 46 + nl + xl + cl;
  }

  async function read(name) {
    const en = entries.get(name);
    if (!en) throw new Error('zip: no entry ' + name);
    const lh = await src.read(en.off, 30);
    const lv = new DataView(lh.buffer, lh.byteOffset, lh.byteLength);
    if (lv.getUint32(0, true) !== 0x04034b50) throw new Error('zip: bad local header for ' + name);
    const start = en.off + 30 + lv.getUint16(26, true) + lv.getUint16(28, true);
    const raw = await src.read(start, en.csize);
    if (en.method === 0) return raw instanceof Uint8Array && raw.byteOffset === 0 && raw.length === raw.buffer.byteLength ? raw : raw.slice();
    if (en.method === 8) {
      const out = await inflateRaw(raw);
      if (out.length !== en.usize) throw new Error('zip: size mismatch for ' + name);
      return out;
    }
    throw new Error('zip: unsupported compression ' + en.method + ' for ' + name);
  }

  return { list: () => names.slice(), read, size: (name) => entries.get(name)?.usize ?? -1 };
}
