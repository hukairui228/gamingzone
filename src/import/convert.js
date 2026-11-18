// Browser port of the Python asset pipeline (tools/extract.py and the tools/convert_*.py scripts).
// Given the entries of the player's own IPA it writes the same files as `npm run extract` (same bytes for
// the city, models, animation, text and UI layouts), except that textures stay in their original PVR form
// ('tex/<name>.pvr', decoded at load time) and the few UI images are written as PNG instead of WebP.

import { openZip } from './zip.js';
import { decodePVR } from './pvr.js';
import { F, dumps, pyRoundInt, rint, pyRoundFloat } from './pyjson.js';
import { parseXML, iterXML, child, childrenOf, encodePNG, decodeCgBI, dropFontTables } from './formats.js';

const fr = Math.fround;
const f32_1e9 = fr(1e-9), f32_055 = fr(0.55), f32_06 = fr(0.6);

// yield to the event loop now and then so a page running this on the main thread stays responsive
let lastYield = 0;
async function breathe() {
  const now = Date.now();
  if (now - lastYield > 40) { lastYield = now; await new Promise((r) => setTimeout(r, 0)); }
}

/** growable byte buffer with the converters' put() (pads to 4 bytes, returns [offset, length]) */
class Buf {
  constructor(n = 1 << 20) { this.a = new Uint8Array(n); this.n = 0; }
  reserve(k) {
    if (this.n + k <= this.a.length) return;
    let m = this.a.length * 2; while (m < this.n + k) m *= 2;
    const b = new Uint8Array(m); b.set(this.a.subarray(0, this.n)); this.a = b;
  }
  push(bytes) { this.reserve(bytes.length); this.a.set(bytes, this.n); this.n += bytes.length; }
  put(bytes, pad = true) {
    if (pad) { const p = (4 - (this.n & 3)) & 3; this.reserve(p); for (let i = 0; i < p; i++) this.a[this.n++] = 0; }
    const start = this.n; this.push(bytes); return [start, this.n - start];
  }
  bytes() { return this.a.slice(0, this.n); }
}
const u8of = (ta) => new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength);
const dview = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength);
const latin1 = (b) => { let s = ''; for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192)); return s; };

// ======================= city (tools/convert_city.py) =======================
function cityMaterials(dae) {
  const r = parseXML(new TextDecoder().decode(dae));
  const imgs = new Map();
  for (const i of iterXML(r, 'image')) imgs.set(i.attrs.id, child(i, 'init_from').text);
  const effects = new Map();
  for (const e of iterXML(r, 'effect')) effects.set(e.attrs.id, e);
  const out = [];
  for (const m of iterXML(r, 'material')) {
    const ie = child(m, 'instance_effect');
    const tex = [];
    for (const s of childrenOf(ie, 'setparam')) {
      const surf = child(s, 'surface');
      if (surf) {
        const key = child(surf, 'init_from').text;
        if (!imgs.has(key)) throw new Error('city: unknown image ' + key);
        tex.push(imgs.get(key));
      }
    }
    const e = effects.get(ie.attrs.url.slice(1));
    if (!e) throw new Error('city: unknown effect ' + ie.attrs.url);
    const flag = (tag) => { for (const x of iterXML(e, tag)) if (x.attrs.value === 'true') return true; return false; };
    out.push({
      texture: tex.length ? tex[0].toLowerCase().replaceAll('.tga', '.webp') : null,
      blend: flag('blend_enable'),
      alphaTest: flag('alpha_test_enable'),
    });
  }
  return out;
}

function* cityBlocks(bd) {
  const dv = dview(bd);
  let o = 0;
  while (o < bd.length) {
    const n = dv.getUint32(o + 1, true);
    const attrs = [];
    for (let i = 0; i < n; i++) {
      const a = o + 5 + 12 * i;
      attrs.push([dv.getUint32(a, true), dv.getUint16(a + 4, true), dv.getUint16(a + 6, true), dv.getUint16(a + 8, true), dv.getUint16(a + 10, true)]);
    }
    let h = o + 5 + 12 * n + 24;
    let uvs = null, uvo = null;
    if (attrs.some((a) => a[1] === 1)) {
      uvs = [dv.getFloat32(h, true), dv.getFloat32(h + 4, true)];
      uvo = [dv.getFloat32(h + 12, true), dv.getFloat32(h + 16, true)];
      h += 24;
    }
    const nv = dv.getUint32(h, true);
    const vstart = h + 4, vend = vstart + nv * attrs[0][4];
    const prim = dv.getUint32(vend, true), ni = dv.getUint32(vend + 8, true), ntri = dv.getUint32(vend + 12, true);
    dv.getUint32(vend + 20, true);
    if (prim !== 6 || ni !== ntri * 3) throw new Error('city: bad block at 0x' + o.toString(16));
    const istart = vend + 24;
    if (istart + ni * 2 > bd.length) throw new Error('city: truncated indices');
    const idx = new Uint16Array(ni);
    for (let i = 0; i < ni; i++) idx[i] = dv.getUint16(istart + 2 * i, true);
    yield { attrs, dv, vstart, nv, uvs, uvo, idx };
    o = istart + ni * 2;
  }
}

const TYPE_BYTES = { 6: 4, 2: 2, 0: 1, 1: 1 };
function cityVertices({ attrs, dv, vstart, nv, uvs, uvo }) {
  const stride = attrs[0][4];
  const out = {};
  for (const [off, sem, typ, comps] of attrs) {
    if (!(typ in TYPE_BYTES)) throw new Error('city: vertex type ' + typ);
    const base = vstart + off;
    if (sem === 0) {
      const p = new Float32Array(nv * 3);
      for (let v = 0; v < nv; v++) {
        const o = base + v * stride;
        const x = dv.getFloat32(o, true), y = dv.getFloat32(o + 4, true), z = dv.getFloat32(o + 8, true);
        p[v * 3] = x / 100; p[v * 3 + 1] = z / 100; p[v * 3 + 2] = -y / 100;
      }
      out.position = p;
    } else if (sem === 1) {
      const sx = fr(uvs[0]), sy = fr(uvs[1]), ox = fr(uvo[0]), oy = fr(uvo[1]);
      const t = new Float32Array(nv * 2);
      for (let v = 0; v < nv; v++) {
        const o = base + v * stride;
        t[v * 2] = fr(dv.getInt16(o, true) * sx) + ox;
        t[v * 2 + 1] = fr(dv.getInt16(o + 2, true) * sy) + oy;
      }
      out.uv = t;
    } else if (sem === 0x11) {
      const t = new Int8Array(nv * 3);
      for (let v = 0; v < nv; v++) {
        const o = base + v * stride;
        t[v * 3] = dv.getInt8(o); t[v * 3 + 1] = dv.getInt8(o + 2); t[v * 3 + 2] = -dv.getInt8(o + 1);
      }
      out.normal = t;
    } else if (sem === 0x12) {
      const t = new Uint8Array(nv * 4);
      for (let v = 0; v < nv; v++) for (let k = 0; k < 4; k++) t[v * 4 + k] = dv.getUint8(base + v * stride + k);
      out.color = t;
    }
  }
  return out;
}

/** float32 face normal (numpy cross of b-a, c-a) and its float32 length */
function faceNormal(p, ia, ib, ic, n) {
  const ax = p[ia * 3], ay = p[ia * 3 + 1], az = p[ia * 3 + 2];
  const ux = fr(p[ib * 3] - ax), uy = fr(p[ib * 3 + 1] - ay), uz = fr(p[ib * 3 + 2] - az);
  const vx = fr(p[ic * 3] - ax), vy = fr(p[ic * 3 + 1] - ay), vz = fr(p[ic * 3 + 2] - az);
  n[0] = fr(fr(uy * vz) - fr(uz * vy));
  n[1] = fr(fr(uz * vx) - fr(ux * vz));
  n[2] = fr(fr(ux * vy) - fr(uy * vx));
  return fr(Math.sqrt(fr(fr(fr(n[0] * n[0]) + fr(n[1] * n[1])) + fr(n[2] * n[2]))));
}

function wallSegments(p, idx, out) {
  const n = new Float32Array(3);
  const P = [0, 0, 0];
  const pairs = [[0, 1], [1, 2], [0, 2]];
  for (let t = 0; t < idx.length; t += 3) {
    const ln = fr(faceNormal(p, idx[t], idx[t + 1], idx[t + 2], n) + f32_1e9);
    if (!(Math.abs(fr(n[1] / ln)) < 0.25)) continue;
    P[0] = idx[t]; P[1] = idx[t + 1]; P[2] = idx[t + 2];
    const y0 = p[P[0] * 3 + 1], y1 = p[P[1] * 3 + 1], y2 = p[P[2] * 3 + 1];
    const ymin = Math.min(y0, y1, y2), ymax = Math.max(y0, y1, y2);
    if (!(fr(ymax - ymin) > f32_06)) continue;
    let best = -1, bd = -Infinity;
    for (let k = 0; k < 3; k++) {
      const [i, j] = pairs[k];
      const dx = fr(p[P[i] * 3] - p[P[j] * 3]), dz = fr(p[P[i] * 3 + 2] - p[P[j] * 3 + 2]);
      const d = fr(Math.sqrt(fr(fr(dx * dx) + fr(dz * dz))));
      if (best < 0 || d > bd) { bd = d; best = k; }
    }
    if (!(bd > 0.25)) continue;
    const [i, j] = pairs[best];
    out.push(p[P[i] * 3], p[P[i] * 3 + 2], p[P[j] * 3], p[P[j] * 3 + 2], ymin, ymax);
  }
}

const NO_COLLIDE = /^(alpha_atlas|vegetation|forest|fields|grafitti|gloweffects)/;

async function convertCity(miami, write, progress) {
  const z = await openZip(miami);
  const bd = await z.read('batch_data.bin');
  const mz = await openZip(await z.read('materials.bdae'));
  const mats = cityMaterials(await mz.read('source.dae'));
  const batches = [];
  const data = new Buf(64 << 20);
  const walls = [];
  const groundP = [], groundT = [];
  let gn = 0, k = 0;
  const n = new Float32Array(3);
  for (const blk of cityBlocks(bd)) {
    const v = cityVertices(blk);
    const { idx, nv } = blk;
    if (k === 0) {
      groundP.push(v.position); groundT.push(Uint32Array.from(idx)); gn += nv;
      k++; continue;
    }
    const m = mats[k];
    if (!m) throw new Error('city: no material for batch ' + k);
    const p = v.position;
    if (!p) throw new Error('city: batch without positions');
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < nv; i++) for (let c = 0; c < 3; c++) { const x = p[i * 3 + c]; if (x < mn[c]) mn[c] = x; if (x > mx[c]) mx[c] = x; }
    const r2 = (x) => F(fr(rint(fr(x * 100)) / 100));
    const entry = {
      id: k, texture: m.texture, blend: m.blend, alphaTest: m.alphaTest,
      count: idx.length, vertices: nv,
      min: nv ? mn.map(r2) : [], max: nv ? mx.map(r2) : [],
      position: data.put(u8of(p)),
      index: data.put(u8of(idx)),
    };
    if (v.uv) entry.uv = data.put(u8of(v.uv));
    if (v.normal) entry.normal = data.put(u8of(v.normal));
    if (v.color) entry.color = data.put(v.color);
    batches.push(entry);
    if (!m.blend && !NO_COLLIDE.test(m.texture || '')) {
      wallSegments(p, idx, walls);
      const up = [];
      for (let t = 0; t < idx.length; t += 3) {
        const ln = faceNormal(p, idx[t], idx[t + 1], idx[t + 2], n);
        if (fr(n[1] / fr(ln + f32_1e9)) > f32_055) up.push(idx[t] + gn, idx[t + 1] + gn, idx[t + 2] + gn);
      }
      groundP.push(p); groundT.push(Uint32Array.from(up)); gn += nv;
    }
    k++;
    if ((k & 63) === 0) { progress?.(k); await breathe(); }
  }
  // ground: drop vertices no walkable triangle references (np.unique compaction)
  const used = new Uint8Array(gn);
  for (const t of groundT) for (let i = 0; i < t.length; i++) used[t[i]] = 1;
  const remap = new Uint32Array(gn);
  let nu = 0;
  for (let i = 0; i < gn; i++) if (used[i]) remap[i] = nu++;
  const nt = groundT.reduce((s, t) => s + t.length, 0);
  const ground = new Uint8Array(8 + nu * 12 + nt * 4);
  const gdv = dview(ground);
  gdv.setUint32(0, nu, true); gdv.setUint32(4, nt, true);
  const gp = new Float32Array(ground.buffer, 8, nu * 3);
  let base = 0, w = 0;
  for (const p of groundP) {
    for (let i = 0; i < p.length / 3; i++) if (used[base + i]) { gp[w++] = p[i * 3]; gp[w++] = p[i * 3 + 1]; gp[w++] = p[i * 3 + 2]; }
    base += p.length / 3;
  }
  let o = 8 + nu * 12;
  for (const t of groundT) for (let i = 0; i < t.length; i++, o += 4) gdv.setUint32(o, remap[t[i]], true);
  await write('city/ground.bin', ground);
  await write('city/walls.bin', u8of(Float32Array.from(walls)));
  await write('city/city.bin', data.bytes());
  await write('city/city.json', dumps({ batches }));
  return { batches: batches.length, groundTris: nt / 3, walls: walls.length / 6 };
}

// ======================= models (tools/convert_model.py) =======================
export const MODEL_PREFIXES = ['car_', 'bike_', 'boat_', 'heli_', 'gun_', 'col_', 'checkpoint_', 'skybox', 'sun', 'ocean',
  'char_', 'prop_', 'metro_', 'cop_lights', 'blood_puddle', 'target_'];

class Bres {
  constructor(d) { this.d = d; this.dv = dview(d); this.root = this.u(0x20); }
  u(o) { return this.dv.getUint32(o, true); }
  f(o, n) { const r = []; for (let i = 0; i < n; i++) r.push(F(this.dv.getFloat32(o + 4 * i, true))); return r; }
  s(o) {
    if (!o) return '';
    const e = this.d.indexOf(0, o);
    if (e < 0 || o > this.d.length) throw new Error('bres: unterminated string');
    return latin1(this.d.subarray(o, e));
  }
  table(off, size) { const n = this.u(this.root + off), p = this.u(this.root + off + 4); const r = []; for (let i = 0; i < n; i++) r.push(p + i * size); return r; }
  /** np.frombuffer bounds check */
  bytes(off, n) { if (off > this.d.length || off + n > this.d.length) throw new Error('bres: buffer too small'); return this.d.subarray(off, off + n); }
}

/** numpy column slice raw[:, off:off+width] of an (nv, stride) byte matrix, as contiguous bytes */
function column(raw, nv, stride, off, width, itemsize) {
  const a = Math.min(off, stride), b = Math.min(off + width, stride), wdt = Math.max(0, b - a);
  if (itemsize > 1 && wdt % itemsize) throw new Error('model: column width not a multiple of ' + itemsize);
  const out = new Uint8Array(nv * wdt);
  for (let v = 0; v < nv; v++) out.set(raw.subarray(v * stride + a, v * stride + a + wdt), v * wdt);
  return out;
}

const stripHash = (s) => s.replace(/^#+/, '');

function convertModel(bytes) {
  const b = new Bres(bytes);
  const images = b.table(0x4c, 20).map((e) => b.s(b.u(e + 8)));
  const materials = [], matIndex = new Map();
  for (const e of b.table(0x5c, 0x24)) {
    let tex = null;
    const n = b.u(e + 0x10), p = b.u(e + 0x14);
    for (let j = 0; j < n; j++) {
      const pe = p + j * 0x18;
      if (b.u(pe + 8) === 0xb && b.s(b.u(pe)) === 'diffuse-sampler') {
        const idx = b.u(b.u(b.u(pe + 0x14)));
        if (idx < images.length) tex = images[idx].toLowerCase().replaceAll('.tga', '.webp');
      }
    }
    matIndex.set(b.s(b.u(e)), materials.length);
    materials.push({ name: b.s(b.u(e)), texture: tex });
  }
  const data = new Buf(1 << 20);
  const meshes = [], meshIndex = new Map();
  for (const e of b.table(0x64, 16)) {
    const gid = b.s(b.u(e)), m = b.u(e + 12);
    const nv = b.u(m + 4), desc = b.u(m + 8), nsub = b.u(m + 12), subs = b.u(m + 16);
    const stride = b.u(desc), na = b.u(desc + 4);
    const cols = [0, 1, 2].map((k) => { const r = []; for (let j = 0; j < na; j++) r.push(b.u(b.u(desc + 8 + k * 8) + j * 4)); return r; });
    const raw = b.bytes(b.u(desc + 0x24), nv * stride);
    const mesh = { name: gid };
    let floats3 = 0;
    for (let j = 0; j < na; j++) {
      const off = cols[0][j], typ = cols[1][j], comps = cols[2][j];
      if (typ === 6 && comps === 3) {
        const key = floats3 === 0 ? 'position' : 'normal';
        floats3++;
        mesh[key] = data.put(column(raw, nv, stride, off, 12, 4));
      } else if (typ === 6 && comps === 2 && !('uv' in mesh)) {
        mesh.uv = data.put(column(raw, nv, stride, off, 8, 4));
      } else if (typ === 1 && comps === 4 && !('color' in mesh)) {
        mesh.color = data.put(column(raw, nv, stride, off, 4, 1));
      }
    }
    const prims = [];
    for (let k = 0; k < nsub; k++) {
      const sb = subs + k * 0x28;
      const sym = b.s(b.u(sb + 4)), ni = b.u(sb + 0x20), ip = b.u(sb + 0x24);
      const idx = b.bytes(ip, ni * 2);
      prims.push({ material: matIndex.has(sym) ? matIndex.get(sym) : -1, symbol: sym, index: data.put(idx) });
    }
    mesh.prims = prims;
    mesh.bbox = b.f(m + 0x14, 6);
    meshIndex.set(gid, meshes.length);
    meshes.push(mesh);
  }

  const nodes = [];
  const meshOf = (url) => {
    const gid = meshIndex.has(url) ? url : url.split('-mesh')[0] + '-mesh';
    return meshIndex.has(gid) ? gid : null;
  };
  const walk = (o, parent, depth) => {
    if (depth > 990) throw new Error('model: node tree too deep'); // Python's recursion limit
    const i = nodes.length;
    const q = b.f(o + 0x18, 4);
    const node = {
      name: b.s(b.u(o + 4)) || b.s(b.u(o)), parent, sid: b.s(b.u(o + 8)),
      t: b.f(o + 0xc, 3), q: [F(-q[0].v), F(-q[1].v), F(-q[2].v), q[3]], s: b.f(o + 0x28, 3), meshes: [],
    };
    nodes.push(node);
    for (let j = 0, n = b.u(o + 0x40); j < n; j++) {
      const ip = b.u(o + 0x44) + j * 8;
      const gid = meshOf(stripHash(b.s(b.u(b.u(ip + 4) + 4))));
      if (gid !== null) node.meshes.push(meshIndex.get(gid));
    }
    for (let j = 0, n = b.u(o + 0x38); j < n; j++) walk(b.u(o + 0x3c) + j * 0x50, i, depth + 1);
  };
  for (const vs of b.table(0x8c, 0x10).slice(0, 1)) for (let j = 0, n = b.u(vs + 8); j < n; j++) walk(b.u(vs + 0xc) + j * 0x50, -1, 1);

  const skins = [];
  const bySid = new Map(), byName = new Map();
  nodes.forEach((n, i) => { if (n.sid) bySid.set(n.sid, i); });
  nodes.forEach((n, i) => byName.set(n.name, i));
  for (const e of b.table(0x6c, 12)) {
    if (b.u(e) !== 0) continue;
    const sk = b.u(e + 8);
    const gid = meshOf(stripHash(b.s(b.u(sk + 0x70))));
    if (gid === null) continue;
    const mi = meshIndex.get(gid), mesh = meshes[mi];
    const nj = b.u(sk + 0x74);
    const names = [];
    for (let j = 0; j < nj; j++) names.push(b.s(b.u(b.u(sk + 0x78) + 4 * j)));
    const joints = names.map((n) => (bySid.has(n) ? bySid.get(n) : byName.has(n) ? byName.get(n) : -1));
    if (!mesh.position) throw new Error("model: KeyError 'position'");
    const nv = Math.floor(mesh.position[1] / 12);
    const maxInf = b.u(sk + 0x90);
    const stride = 4 + 4 * maxInf;
    if (b.u(sk + 0x7c) * 4 !== nv * stride || joints.includes(-1)) continue;
    const raw = b.bytes(b.u(sk + 0x80), nv * stride);
    if (maxInf > 4) throw new Error('model: more than 4 influences');
    const jidx = new Uint8Array(nv * 4), w = new Float32Array(nv * 4);
    const rv = dview(raw);
    for (let v = 0; v < nv; v++) {
      for (let c = 0; c < 4; c++) jidx[v * 4 + c] = raw[v * stride + c];
      for (let c = 0; c < maxInf; c++) w[v * 4 + c] = rv.getFloat32(v * stride + 4 + 4 * c, true);
      for (let c = 0; c < 4; c++) if (w[v * 4 + c] === 0) jidx[v * 4 + c] = 0;
    }
    mesh.joints = data.put(jidx);
    mesh.weights = data.put(u8of(w));
    mesh.skin = skins.length;
    skins.push({ mesh: mi, joints, jointNames: names, inverseBind: data.put(b.bytes(b.u(sk + 4), 64 * nj)), bindShape: b.f(sk + 0x10, 16) });
  }
  const meta = { materials, meshes, nodes };
  if (skins.length) { meta.skins = skins; meta.skin = skins[0]; }
  return { meta, data: data.bytes() };
}

// ======================= animation (tools/convert_anim.py) =======================
function convertAnim(d) {
  const FPS = 30;
  const b = new Bres(d);
  const u = (o) => b.u(o), s = (o) => b.s(o);
  const root = u(0x20);
  const chans = [];
  for (let i = 0; i < u(root + 0x24); i++) {
    const e = u(root + 0x28) + i * 0x20;
    const name = s(u(e));
    const comps = u(u(e + 8) + 0x14);
    const k = name.lastIndexOf('-node-');
    chans.push(k < 0 ? { bone: '', prop: name, comps } : { bone: name.slice(0, k), prop: name.slice(k + 6), comps });
  }
  const nclip = u(root + 0x34);
  const clips = [];
  for (let i = 0; i < nclip; i++) clips.push([s(u(u(root + 0x38) + 12 * i)), u(u(root + 0x38) + 12 * i + 4)]);
  const nch = chans.length;
  const times = chans.map(() => []), vals = chans.map(() => []);
  let p = u(0x28);
  const lastFrame = pyRoundInt(clips[nclip - 1][1] * FPS / 1000) - 1;
  while (p + nch * 16 + 4 <= d.length) {
    const counts = [];
    for (let k = 0; k < nch; k++) counts.push(u(p + 16 * k + 4));
    let q = p + nch * 16 + 4;
    for (let k = 0; k < nch; k++) {
      const n = counts[k], c = chans[k].comps;
      const tb = b.bytes(q, 2 * n);
      const t = new Int32Array(n);
      for (let i = 0; i < n; i++) t[i] = tb[2 * i] | (tb[2 * i + 1] << 8);
      times[k].push(t);
      q = (q + 2 * n + 3) & ~3;
      const vb = b.bytes(q, 4 * n * c);
      const v = new Float32Array(n * c);
      const vdv = dview(vb);
      for (let i = 0; i < n * c; i++) v[i] = vdv.getFloat32(4 * i, true);
      if (chans[k].prop === 'rotation' && c === 4) for (let i = 0; i < n; i++) { v[i * 4] *= -1; v[i * 4 + 1] *= -1; v[i * 4 + 2] *= -1; }
      vals[k].push(v);
      q += 4 * n * c;
    }
    p = q;
    const t0 = times[0][times[0].length - 1];
    if (t0.length && t0[t0.length - 1] >= lastFrame) break;
  }
  // np.unique(t, return_index=True): sorted unique frame times, value row of each first occurrence
  const tracks = chans.map((c, k) => {
    const t = [], rows = [];
    const all = [];
    let off = 0;
    times[k].forEach((tt, ci) => { for (let i = 0; i < tt.length; i++) all.push([tt[i], off + i, ci, i]); off += tt.length; });
    all.sort((a, bb) => a[0] - bb[0] || a[1] - bb[1]);
    for (const [ft, , ci, i] of all) if (!t.length || t[t.length - 1] !== ft) { t.push(ft); rows.push(vals[k][ci].subarray(i * c.comps, (i + 1) * c.comps)); }
    return { t, v: rows };
  });

  const sample = (t, v, f, quat) => {
    // searchsorted(side='right') - 1
    let lo = 0, hi = t.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (t[mid] <= f) lo = mid + 1; else hi = mid; }
    const i = lo - 1;
    if (i < 0) return Array.from(v[0]);
    if (i >= t.length - 1) return Array.from(v[v.length - 1]);
    const a = (f - t[i]) / (t[i + 1] - t[i]);
    const x = v[i];
    let y = Array.from(v[i + 1]);
    if (quat) {
      let dot = 0;
      for (let c = 0; c < x.length; c++) dot = fr(dot + fr(x[c] * y[c]));
      if (dot < 0) y = y.map((z) => -z);
    }
    const r = Array.from(x, (xc, c) => xc * (1 - a) + y[c] * a);
    if (!quat) return r;
    let ss = 0;
    for (const z of r) ss += z * z;
    const nrm = Math.sqrt(ss);
    return r.map((z) => z / nrm);
  };

  const data = new Buf(4 << 20);
  const putF = (arr) => data.put(u8of(Float32Array.from(arr)), false);
  const out = new Map();
  for (let ci = 0; ci < nclip - 1; ci++) {
    const [name, ms] = clips[ci];
    const f0 = pyRoundInt(ms * FPS / 1000);
    const f1 = Math.max(f0, pyRoundInt(clips[ci + 1][1] * FPS / 1000) - 1);
    const clip = { duration: F((f1 - f0) / FPS), tracks: new Map() };
    chans.forEach((c, k) => {
      if (!['rotation', 'translation'].includes(c.prop) || ![3, 4].includes(c.comps)) return;
      const { t, v } = tracks[k];
      const quat = c.prop === 'rotation';
      const ft = f1 > f0 ? [f0, ...t.filter((x) => x > f0 && x < f1), f1] : [f0];
      const fv = [];
      for (const f of ft) fv.push(...sample(t, v, f, quat));
      if (!clip.tracks.has(c.bone)) clip.tracks.set(c.bone, {});
      const tr = clip.tracks.get(c.bone);
      const secs = ft.map((f) => (f - f0) / FPS);
      if (!('t' in tr)) tr.t = putF(secs);
      if (quat) { tr.tq = putF(secs); tr.q = putF(fv); } else { tr.tp = putF(secs); tr.p = putF(fv); }
    });
    for (const tr of clip.tracks.values()) delete tr.t;
    out.set(name, clip);
  }
  return { json: dumps(out), bin: data.bytes(), clips: out.size };
}

// ======================= text, sprites =======================
function decodeText(data) {
  const dv = dview(data);
  const n = dv.getUint16(0, true);
  const td = new TextDecoder('utf-8');
  const out = [];
  let o = 2;
  for (let i = 0; i < n; i++) {
    const L = dv.getUint16(o, true);
    out.push(td.decode(data.subarray(o + 2, o + 2 + L)));
    o += 2 + L;
  }
  return out;
}

export function parseSprite(d) {
  if (d.length < 80) throw new Error('bsprite: short header');
  const dv = dview(d);
  const h = (i) => dv.getUint32(i * 4, true);
  const nmod = h(1), nfr = h(3), om = h(8), ofr = h(9), ofm = h(11);
  const modules = [];
  for (let i = 0; i < nmod; i++) { const o = om + i * 10; modules.push([1, 2, 3, 4].map((k) => dv.getUint16(o + 2 * k, true))); }
  const frames = [];
  for (let i = 0; i < nfr; i++) {
    const r = ofr + i * 28;
    dv.getInt32(r + 24, true);
    const n = dv.getInt32(r, true), first = dv.getInt32(r + 20, true);
    const fms = [];
    for (let k = 0; k < n; k++) { const o = ofm + (first + k) * 8; fms.push([dv.getUint16(o, true), dv.getInt16(o + 2, true), dv.getInt16(o + 4, true), dv.getInt16(o + 6, true)]); }
    frames.push(fms);
  }
  return { modules, frames };
}

/** rebuild the 960x640 title image from splash960's tiled frame 0 (convert_sprite.compose), RGBA with alpha 255 */
function composeSprite(sprite, img, W = 960, H = 640) {
  const out = new Uint8Array(W * H * 4);
  for (let i = 3; i < out.length; i += 4) out[i] = 255;
  for (const [m, x, y] of sprite.frames[0]) {
    const [mx, my, mw, mh] = sprite.modules[m];
    for (let r = 0; r < mh; r++) {
      const ty = y + r, sy = my + r;
      if (ty < 0 || ty >= H) continue;
      for (let c = 0; c < mw; c++) {
        const tx = x + c, sx = mx + c;
        if (tx < 0 || tx >= W) continue;
        const o = (ty * W + tx) * 4;
        if (sx < img.width && sy < img.height) {
          const s = (sy * img.width + sx) * 4;
          out[o] = img.rgba[s]; out[o + 1] = img.rgba[s + 1]; out[o + 2] = img.rgba[s + 2];
        } else { out[o] = out[o + 1] = out[o + 2] = 0; }
      }
    }
  }
  return out;
}

// ======================= roads (tools/build_roads.py) =======================
const MAP_X0 = -1049.3, MAP_Z0 = -1126.3, MAP_SCALE = 1.955; // tools/build_roads.py fit
const npRound1 = (x) => rint(x * 10) / 10; // numpy float64 round(x, 1)

function thin(img, W, H) {
  const a = img.slice();
  const N = new Uint8Array(8);
  const at = (y, x) => (y >= 0 && y < H && x >= 0 && x < W ? a[y * W + x] : 0);
  const rm = [];
  for (;;) {
    let changed = false;
    for (let step = 0; step < 2; step++) {
      rm.length = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (a[y * W + x] !== 1) continue;
        N[0] = at(y - 1, x); N[1] = at(y - 1, x + 1); N[2] = at(y, x + 1); N[3] = at(y + 1, x + 1);
        N[4] = at(y + 1, x); N[5] = at(y + 1, x - 1); N[6] = at(y, x - 1); N[7] = at(y - 1, x - 1);
        const b = N[0] + N[1] + N[2] + N[3] + N[4] + N[5] + N[6] + N[7];
        if (b < 2 || b > 6) continue;
        let t = 0;
        for (let i = 0; i < 8; i++) if (N[i] === 0 && N[(i + 1) & 7] === 1) t++;
        if (t !== 1) continue;
        const c = step === 0 ? (N[0] * N[2] * N[4] === 0 && N[2] * N[4] * N[6] === 0) : (N[0] * N[2] * N[6] === 0 && N[0] * N[4] * N[6] === 0);
        if (c) rm.push(y * W + x);
      }
      if (rm.length) { for (const i of rm) a[i] = 0; changed = true; }
    }
    if (!changed) return a;
  }
}

function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  const a = pts[0], b = pts[pts.length - 1];
  const ab0 = b[0] - a[0], ab1 = b[1] - a[1];
  const L = Math.hypot(ab0, ab1) || 1e-9;
  let i = 1, best = -Infinity;
  for (let k = 1; k < pts.length - 1; k++) {
    const p = pts[k];
    const d = Math.abs(ab0 * (p[1] - a[1]) - ab1 * (p[0] - a[0])) / L;
    if (d > best) { best = d; i = k; }
  }
  if (best > eps) return simplify(pts.slice(0, i + 1), eps).slice(0, -1).concat(simplify(pts.slice(i), eps));
  return [pts[0], pts[pts.length - 1]];
}

/** Road graph from the minimap image (RGBA pixels): {nodes, edges, map}, like tools/build_roads.py */
export function buildRoads(rgba, W, H) {
  let road = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) road[i] = Math.min(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]) > 225 ? 1 : 0;
  // PIL MaxFilter(3) then MinFilter(3), edges replicated
  const rank = (src, max) => {
    const out = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let v = max ? 0 : 1;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const s = src[Math.min(H - 1, Math.max(0, y + dy)) * W + Math.min(W - 1, Math.max(0, x + dx))];
        v = max ? v | s : v & s;
      }
      out[y * W + x] = v;
    }
    return out;
  };
  road = rank(rank(road, true), false);
  const dist = new Float64Array(W * H);
  let cur = road.slice();
  for (let k = 1; k <= 20 && cur.some((v) => v); k++) {
    const nx = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!cur[i]) continue;
      dist[i] = k;
      nx[i] = (y > 0 && cur[i - W]) && (y < H - 1 && cur[i + W]) && (x > 0 && cur[i - 1]) && (x < W - 1 && cur[i + 1]) ? 1 : 0;
    }
    cur = nx;
  }
  const sk = thin(road, W, H);
  const nb = (i) => {
    const y = (i / W) | 0, x = i - y * W, r = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!(dy || dx)) continue;
      const yy = y + dy, xx = x + dx;
      if (yy >= 0 && yy < H && xx >= 0 && xx < W && sk[yy * W + xx]) r.push(yy * W + xx);
    }
    return r;
  };
  const isNode = new Set();
  for (let i = 0; i < W * H; i++) if (sk[i] && nb(i).length !== 2) isNode.add(i);
  const nodeList = [...isNode].sort((a, b) => a - b); // row-major = sorted (y, x)
  const nodeId = new Map(), nodes = [];
  for (const p of nodeList) {
    if (nodeId.has(p)) continue;
    const stack = [p], cluster = [];
    nodeId.set(p, nodes.length);
    while (stack.length) {
      const q = stack.pop();
      cluster.push(q);
      for (const r of nb(q)) if (isNode.has(r) && !nodeId.has(r)) { nodeId.set(r, nodes.length); stack.push(r); }
    }
    let sy = 0, sx = 0;
    for (const c of cluster) { sy += (c / W) | 0; sx += c % W; }
    nodes.push([sx / cluster.length, sy / cluster.length]);
  }
  let edges = [];
  const seen = new Set();
  const key = (a, b) => a * W * H + b;
  for (const p of nodeList) {
    for (const q of nb(p)) {
      if (isNode.has(q) || seen.has(key(p, q))) continue;
      const path = [p];
      let prev = p, c = q;
      while (!isNode.has(c)) {
        path.push(c);
        const tail = path.slice(-3);
        const nxt = nb(c).filter((r) => r !== prev && !tail.includes(r));
        if (!nxt.length) break;
        prev = c; c = nxt[0];
      }
      path.push(c);
      seen.add(key(path[path.length - 1], path[path.length - 2]));
      if (!isNode.has(c)) continue;
      const a = nodeId.get(p), b = nodeId.get(c);
      if (a === b && path.length < 8) continue;
      const ds = path.map((i) => dist[i]).sort((x, y) => x - y);
      const m = ds.length;
      const med = m % 2 ? ds[(m - 1) / 2] : (ds[m / 2 - 1] + ds[m / 2]) / 2;
      const width = med * 2 * MAP_SCALE;
      const pts = simplify(path.map((i) => [i % W, (i / W) | 0]), 1.2);
      edges.push([a, b, F(pyRoundFloat(width, 1)), pts.map(([x, y]) => [F(npRound1(MAP_X0 + x * MAP_SCALE)), F(npRound1(MAP_Z0 + y * MAP_SCALE))])]);
    }
  }
  const length = (e) => { let s = 0; const P = e[3]; for (let i = 0; i < P.length - 1; i++) s += Math.hypot(P[i + 1][0].v - P[i][0].v, P[i + 1][1].v - P[i][1].v); return s; };
  const degN = new Int32Array(nodes.length);
  for (const e of edges) { degN[e[0]]++; degN[e[1]]++; }
  edges = edges.filter((e) => !((degN[e[0]] === 1 || degN[e[1]] === 1) && length(e) < 12));
  const outNodes = nodes.map(([x, y]) => [F(npRound1(MAP_X0 + x * MAP_SCALE)), F(npRound1(MAP_Z0 + y * MAP_SCALE))]);
  return { nodes: outNodes, edges, map: { x0: F(MAP_X0), z0: F(MAP_Z0), scale: F(MAP_SCALE), size: W } };
}

// ======================= driver (tools/extract.py) =======================
const UI_SPRITES = ['huds', 'cinematics_hud', 'chapter1', 'chapter2', 'chapter3', 'chapter4', 'chapter5', 'races', 'sidemission1', 'sidemission2'];
const UI_IMAGES = new Set(['huds', 'cinematics_hud', 'minimap_map', 'characters1', 'characters2', 'chapter1', 'chapter2', 'chapter3',
  'chapter4', 'chapter5', 'races', 'sidemission1', 'sidemission2']);

/**
 * Convert the game data of an IPA.
 * @param {object} io
 * @param {() => string[]} io.list   entry names of the IPA (full zip paths)
 * @param {(name: string) => Promise<Uint8Array>} io.read
 * @param {(path: string, data: Uint8Array|string) => (void|Promise<void>)} io.write  paths as under public/assets
 * @param {(fraction: number, message: string) => void} [io.progress]
 */
export async function convertAll({ list, read, write, progress = () => {} }) {
  const names = await list();
  const pack = new Map();
  for (const n of names) if (n.includes('/_packMac/') && !n.endsWith('/')) pack.set(n.slice(n.lastIndexOf('/') + 1), n);
  if (!pack.has('miami.bdae')) throw new Error('这不是《孤胆车神：雄霸迈阿密》的 IPA（找不到 miami.bdae）');
  const raw = (name) => {
    if (!pack.has(name)) throw new Error('IPA 中缺少 ' + name);
    return read(pack.get(name));
  };
  const sorted = [...pack.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const stats = {};

  // textures: original PVR data; UI images also decoded to PNG
  const texNames = sorted.filter((n) => /\.(tga|bmp)$/i.test(n) && !n.endsWith('_lo.tga'));
  const done = new Set();
  const decoded = new Map();
  for (let i = 0; i < texNames.length; i++) {
    const n = texNames[i], base = n.slice(0, -4).toLowerCase();
    if (done.has(base)) continue;
    done.add(base);
    const bytes = await raw(n);
    await write('tex/' + base + '.pvr', bytes);
    if (UI_IMAGES.has(base) || base === 'splash960') {
      try {
        const img = decodePVR(bytes);
        decoded.set(base, img);
        if (UI_IMAGES.has(base)) await write('tex/' + base + '.png', await encodePNG(img.rgba, img.width, img.height, img.hasAlpha ? 4 : 3));
      } catch (e) { console.warn('texture skipped', n, e); }
    }
    progress(0.2 * (i + 1) / texNames.length, '纹理 ' + (i + 1) + '/' + texNames.length);
    await breathe();
  }
  stats.textures = done.size;

  progress(0.2, '城市模型');
  stats.city = await convertCity(await raw('miami.bdae'), write, () => {});
  const mm = decoded.get('minimap_map');
  if (mm) {
    progress(0.4, '道路网');
    await breathe();
    const roads = buildRoads(mm.rgba, mm.width, mm.height);
    await write('city/roads.json', dumps(roads));
    stats.roads = roads.edges.length;
  }

  const models = sorted.filter((n) => n.endsWith('.bdae') && MODEL_PREFIXES.some((p) => n.startsWith(p)) && !n.endsWith('_lo.bdae'));
  const ok = [];
  for (let i = 0; i < models.length; i++) {
    const n = models[i], base = n.slice(0, -5);
    progress(0.45 + 0.25 * i / models.length, '模型 ' + (i + 1) + '/' + models.length);
    try {
      const z = await openZip(await raw(n));
      const inner = z.list().find((x) => x.endsWith('.bdae'));
      if (inner === undefined) throw new Error('StopIteration');
      const { meta, data } = convertModel(await z.read(inner));
      await write('models/' + base + '.bin', data);
      await write('models/' + base + '.json', dumps(meta));
      ok.push(base);
    } catch (e) {
      console.warn('model skipped', base, e && e.message);
    }
    await breathe();
  }
  await write('models/index.json', dumps(ok));
  stats.models = ok.length + '/' + models.length;

  progress(0.7, '动作');
  const anim = convertAnim(await raw('anim_ingame.bdae'));
  await write('anim/clips.bin', anim.bin);
  await write('anim/clips.json', anim.json);
  stats.clips = anim.clips;

  progress(0.74, '文本');
  for (const n of [...pack.keys()].filter((x) => x.endsWith('.chinese') || x.endsWith('.english'))) {
    await write('text/' + n + '.json', dumps(decodeText(await raw(n)), false));
  }

  progress(0.76, '界面');
  for (const s of UI_SPRITES) await write('ui/' + s + '.json', dumps(parseSprite(await raw(s + '.bsprite'))));
  const splash = decoded.get('splash960');
  if (splash) {
    const title = composeSprite(parseSprite(await raw('splash960.bsprite')), splash);
    await write('tex/title.png', await encodePNG(title, 960, 640, 3));
  }
  const icon = names.find((n) => n.endsWith('AppIcon76x76@2x~ipad.png'));
  if (icon) {
    try {
      const im = await decodeCgBI(await read(icon));
      await write('icon.png', await encodePNG(im.rgba, im.width, im.height, 3));
    } catch (e) { console.warn('icon skipped', e); }
  }
  for (const f of ['font_chinese.ttf', 'font_latin.ttf']) {
    if (!pack.has(f)) continue;
    const b = await raw(f);
    let out = b;
    try { out = dropFontTables(b); } catch (e) { console.warn('font kept as is', f, e); }
    await write('fonts/' + f, out);
  }

  const wavs = sorted.filter((n) => n.endsWith('.wav'));
  for (let i = 0; i < wavs.length; i++) {
    await write('audio/' + wavs[i].slice(0, -4).toLowerCase() + '.wav', await raw(wavs[i]));
    if ((i & 15) === 0) { progress(0.8 + 0.2 * i / wavs.length, '音频 ' + (i + 1) + '/' + wavs.length); await breathe(); }
  }
  stats.audio = wavs.length;
  progress(1, '完成');
  return stats;
}

export { convertCity, convertModel, convertAnim, decodeText, composeSprite };
