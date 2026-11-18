import * as THREE from 'three';

const BASE = './assets/';
const imgLoader = new THREE.ImageLoader();
const texCache = new Map();
let maxAniso = 8;
let hdSet = new Set();
let specSet = new Set();

export function setAnisotropy(n) { maxAniso = n; }

/** 'high'/'ultra' use the AI-upscaled HD texture pack when it was generated (tools/upscale_textures.py). */
function wantHD() {
  try { return ['high', 'ultra'].includes(localStorage.getItem('gm_quality') || 'high'); } catch { return true; }
}

// Packed deployment (tools/pack_web.py): assets live inside a few large pack files listed in packs.json.
// Without packs.json (local dev) every asset is fetched from its own path.
let packIndex = null;
const packBlobs = new Map();
const urlCache = new Map();
export const packsReady = fetch(BASE + 'packs.json').then((r) => (r.ok ? r.json() : null)).catch(() => null)
  .then((j) => { packIndex = j; });

function packBlob(name) {
  let p = packBlobs.get(name);
  if (!p) {
    p = fetch(BASE + name).then((r) => { if (!r.ok) throw new Error('缺少素材包 ' + name); return r.blob(); });
    packBlobs.set(name, p);
  }
  return p;
}

async function packedBlob(path) {
  const e = packIndex && packIndex.files[path];
  if (!e || !e.p) return null;
  const parts = await Promise.all(e.p.map(async ([pk, off, len]) => (await packBlob(pk)).slice(off, off + len)));
  return new Blob(parts, { type: e.t });
}

/** URL usable in <img>/CSS/<audio> for an asset path like 'tex/huds.webp'. */
export async function assetURL(path) {
  await packsReady;
  const e = packIndex && packIndex.files[path];
  if (!e) return BASE + path;
  if (e.url) return BASE + e.url;
  let u = urlCache.get(path);
  if (!u) { u = packedBlob(path).then((b) => URL.createObjectURL(b)); urlCache.set(path, u); }
  return u;
}

/** fetch() replacement that also reads from packs */
export async function fetchAsset(path) {
  await packsReady;
  const b = await packedBlob(path);
  return b ? new Response(b) : fetch(BASE + path);
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
    assetURL((hd ? 'tex_hd/' : 'tex/') + name).then((u) => imgLoader.load(u, (img) => { tex.image = img; tex.needsUpdate = true; }));
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
  if (!r.ok) throw new Error('缺少素材 ' + path + '（请先运行 npm run extract -- 你的IPA路径）');
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
