import * as THREE from 'three';

const BASE = './assets/';
const texLoader = new THREE.TextureLoader();
const texCache = new Map();
let maxAniso = 8;
let hdSet = new Set();
let specSet = new Set();

export function setAnisotropy(n) { maxAniso = n; }

/** 'high'/'ultra' use the AI-upscaled HD texture pack when it was generated (tools/upscale_textures.py). */
function wantHD() {
  try { return ['high', 'ultra'].includes(localStorage.getItem('gm_quality') || 'high'); } catch { return true; }
}

let manifests = null;
/** Load the HD / material-map manifests once; textures requested before this resolve fall back to SD. */
export function texturesReady() {
  if (!manifests) {
    const get = (p) => fetch(BASE + p).then((r) => (r.ok ? r.json() : [])).catch(() => []);
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
    t = texLoader.load(BASE + (hd ? 'tex_hd/' : 'tex/') + name);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = maxAniso;
    t.flipY = false;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    texCache.set(key, t);
  }
  return t;
}

export async function json(path) {
  const r = await fetch(BASE + path);
  if (!r.ok) throw new Error('缺少素材 ' + path + '（请先运行 npm run extract -- 你的IPA路径）');
  return r.json();
}

export async function binary(path) {
  const r = await fetch(BASE + path);
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
