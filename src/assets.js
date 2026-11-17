import * as THREE from 'three';

const BASE = './assets/';
const texLoader = new THREE.TextureLoader();
const texCache = new Map();
let maxAniso = 8;

export function setAnisotropy(n) { maxAniso = n; }

export function texture(name, { srgb = true, repeat = true } = {}) {
  if (!name) return null;
  const key = name + srgb;
  let t = texCache.get(key);
  if (!t) {
    t = texLoader.load(BASE + 'tex/' + name);
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
    p = Promise.all([json('models/' + name + '.json'), binary('models/' + name + '.bin')])
      .then(([meta, buf]) => ({ meta, buf }));
    modelCache.set(name, p);
  }
  return p;
}
