import * as THREE from 'three';
import * as store from './store.js';

const BASE = './assets/';
const imgLoader = new THREE.ImageLoader();
const texCache = new Map();
let maxAniso = 8;
let hdSet = new Set();
let specSet = new Set();

export function setAnisotropy(n) { maxAniso = n; }

/** 'high'/'ultra' use the AI-upscaled HD texture pack when it was generated (tools/upscale_textures.py). */
function wantHD() {
  // phones: 2048² HD textures decode to well over a gigabyte of GPU memory, more than mobile Safari allows a page,
  // so they load only at 'ultra' there
  const phone = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  try { return (phone ? ['ultra'] : ['high', 'ultra']).includes(localStorage.getItem('gm_quality2') || 'high'); } catch { return !phone; }
}

// Where assets come from:
//  'packs' – claude.ai deploy (tools/pack_web.py): a few big pack files listed in packs.json
//  'http'  – local dev: every file under ./assets/ (npm run extract)
//  'local' – standalone web app: files the player imported from their own IPA into IndexedDB
//  'none'  – nothing yet: the import screen runs first (src/importer.js)
export let MODE = 'none';
let packIndex = null;
const packBlobs = new Map();
const urlCache = new Map();

async function tryJSON(url) {
  try {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) return null;
    return await r.json();
  } catch { return null; }
}

export const modeReady = (async () => {
  const pj = await tryJSON(BASE + 'packs.json');
  if (pj && pj.files) { packIndex = pj; return (MODE = 'packs'); }
  const cj = await tryJSON(BASE + 'city/city.json');
  if (cj && cj.batches) return (MODE = 'http');
  try {
    const meta = await store.get(store.META);
    if (meta && meta.done) return (MODE = 'local');
  } catch { /* IndexedDB unavailable (private mode) */ }
  return (MODE = 'none');
})();
/** kept for older callers */
export const packsReady = modeReady;

/** after a successful import the page switches to local mode without reloading */
export function useLocalAssets() { MODE = 'local'; }

const packTimers = new Map();
function packBlob(name) {
  let p = packBlobs.get(name);
  if (!p) {
    p = fetch(BASE + name).then((r) => { if (!r.ok) throw new Error('缺少素材包 ' + name); return r.blob(); });
    packBlobs.set(name, p);
  }
  // drop our reference after a quiet spell so the browser can free it (it is re-fetched from cache if needed)
  clearTimeout(packTimers.get(name));
  packTimers.set(name, setTimeout(() => { packBlobs.delete(name); packTimers.delete(name); }, 20000));
  return p;
}

async function packedBlob(path) {
  const e = packIndex && packIndex.files[path];
  if (!e || !e.p) return null;
  const parts = await Promise.all(e.p.map(async ([pk, off, len]) => (await packBlob(pk)).slice(off, off + len)));
  return new Blob(parts, { type: e.t });
}

const MIME = { png: 'image/png', webp: 'image/webp', json: 'application/json', ttf: 'font/ttf', wav: 'audio/wav', bin: 'application/octet-stream' };
/** local store keeps decoded UI images as PNG (the dev/pack builds use WebP) */
function localPath(path) {
  return path.startsWith('tex/') && path.endsWith('.webp') ? path.slice(0, -5) + '.png' : path;
}

/** raw bytes of an imported file (local mode) or null */
export async function localBytes(path) {
  const d = await store.get(localPath(path));
  if (d == null) return null;
  return d instanceof ArrayBuffer ? new Uint8Array(d) : d instanceof Uint8Array ? d : new Uint8Array(await new Blob([d]).arrayBuffer());
}

/** URL usable in <img>/CSS/<audio> for an asset path like 'tex/huds.webp'. */
export async function assetURL(path) {
  await modeReady;
  if (MODE === 'local') {
    let u = urlCache.get(path);
    if (!u) {
      const lp = localPath(path);
      u = localBytes(lp).then((b) => (b ? URL.createObjectURL(new Blob([b], { type: MIME[lp.split('.').pop()] || '' })) : ''));
      urlCache.set(path, u);
    }
    return u;
  }
  const e = packIndex && packIndex.files[path];
  // absolute, so the URL also works inside CSS custom properties (resolved against the stylesheet otherwise)
  if (!e) return new URL(BASE + path, location.href).href;
  if (e.url) return new URL(BASE + e.url, location.href).href;
  let u = urlCache.get(path);
  if (!u) { u = packedBlob(path).then((b) => URL.createObjectURL(b)); urlCache.set(path, u); }
  return u;
}

/** fetch() replacement that also reads from packs and the local store */
export async function fetchAsset(path) {
  await modeReady;
  if (MODE === 'local') {
    const b = await localBytes(path);
    return b ? new Response(b) : new Response(null, { status: 404 });
  }
  const b = await packedBlob(path);
  return b ? new Response(b) : fetch(BASE + path);
}

// ---- textures from the original PVR data (local mode) ----
let pvrtcSupport = null;
/** iOS GPUs sample the original PVRTC data directly: ~1/8 of the memory of decoded RGBA */
function hasPVRTC() {
  if (pvrtcSupport === null) {
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      pvrtcSupport = !!(gl && gl.getExtension('WEBGL_compressed_texture_pvrtc'));
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch { pvrtcSupport = false; }
  }
  return pvrtcSupport;
}

const PVRTC_FORMAT = {
  pvrtc4: [THREE.RGB_PVRTC_4BPPV1_Format, THREE.RGBA_PVRTC_4BPPV1_Format],
  pvrtc2: [THREE.RGB_PVRTC_2BPPV1_Format, THREE.RGBA_PVRTC_2BPPV1_Format],
};

async function loadLocalTexture(tex, name) {
  const base = 'tex/' + name.replace(/\.(webp|png|tga)$/, '');
  const bytes = await localBytes(base + '.pvr');
  if (!bytes) {
    // textures the converter produced as images (UI sheets, generated maps)
    const png = await localBytes(base + '.png');
    if (!png) return;
    const url = URL.createObjectURL(new Blob([png], { type: 'image/png' }));
    imgLoader.load(url, (img) => { tex.image = img; tex.needsUpdate = true; URL.revokeObjectURL(url); }, undefined, () => URL.revokeObjectURL(url));
    return;
  }
  const { parsePVR, decodePVR } = await import('./import/pvr.js');
  const info = parsePVR(bytes);
  const pot = (n) => (n & (n - 1)) === 0;
  if (hasPVRTC() && PVRTC_FORMAT[info.format] && !info.flip && info.width === info.height && pot(info.width)) {
    // compressed upload; PVRTC has no sRGB variant, so the shader decodes sRGB the way three.js does for
    // video textures (DECODE_VIDEO_TEXTURE) — a no-op update() keeps the video path harmless
    let w = info.width, h = info.height;
    tex.mipmaps = info.mips.map((data) => { const m = { data, width: w, height: h }; w = Math.max(1, w >> 1); h = Math.max(1, h >> 1); return m; });
    tex.image = { width: info.width, height: info.height };
    tex.format = PVRTC_FORMAT[info.format][info.hasAlpha ? 1 : 0];
    tex.isCompressedTexture = true;
    if (tex.colorSpace === THREE.SRGBColorSpace) { tex.isVideoTexture = true; tex.update = () => {}; }
    tex.generateMipmaps = false;
    tex.minFilter = tex.mipmaps.length > 1 ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  } else {
    const d = await decodePVR(bytes);
    tex.image = { data: d.rgba instanceof Uint8Array ? d.rgba : new Uint8Array(d.rgba.buffer || d.rgba), width: d.width, height: d.height };
    tex.isDataTexture = true;
    tex.format = THREE.RGBAFormat;
    tex.type = THREE.UnsignedByteType;
    tex.unpackAlignment = 1;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
  }
  tex.magFilter = THREE.LinearFilter;
  tex.flipY = false;
  tex.needsUpdate = true;
}

let manifests = null;
/** Load the HD / material-map manifests once; textures requested before this resolve fall back to SD. */
export function texturesReady() {
  if (!manifests) {
    const get = (p) => fetchAsset(p).then((r) => (r.ok ? r.json() : [])).catch(() => []);
    manifests = Promise.all([get('tex_hd/manifest.json'), get('tex/spec_manifest.json')]).then(([hd, spec]) => {
      hdSet = new Set(hd); specSet = new Set(spec);
    });
  }
  return manifests;
}

export function hasSpec(name) { return specSet.has(name); }

export function texture(name, { srgb = true, repeat = true } = {}) {
  if (!name) return null;
  const hd = srgb && wantHD() && hdSet.has(name);
  const key = name + srgb + hd;
  let t = texCache.get(key);
  if (!t) {
    const tex = t = new THREE.Texture();
    const path = (hd ? 'tex_hd/' : 'tex/') + name;
    if (MODE === 'local') loadLocalTexture(tex, name).catch((e) => console.warn('texture', name, e));
    else assetURL(path).then((u) => imgLoader.load(u, (img) => {
      tex.image = img; tex.needsUpdate = true;
      if (u.startsWith('blob:')) { URL.revokeObjectURL(u); urlCache.delete(path); }
    }));
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = maxAniso;
    t.flipY = false;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    texCache.set(key, t);
  }
  return t;
}

export async function json(path) {
  const r = await fetchAsset(path);
  if (!r.ok) throw new Error('缺少素材 ' + path + '（请重新导入 IPA）');
  return r.json();
}

export async function binary(path) {
  const r = await fetchAsset(path);
  if (!r.ok) throw new Error('缺少素材 ' + path);
  return r.arrayBuffer();
}

export function view(buf, Type, [offset, bytes]) {
  return new Type(buf, offset, bytes / Type.BYTES_PER_ELEMENT);
}

const modelCache = new Map();
export function loadModel(name) {
  let p = modelCache.get(name);
  if (!p) {
    p = Promise.all([json('models/' + name + '.json'), binary('models/' + name + '.bin'), texturesReady()])
      .then(([meta, buf]) => ({ meta, buf }));
    modelCache.set(name, p);
  }
  return p;
}
