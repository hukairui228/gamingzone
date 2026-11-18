import * as THREE from 'three';
import { json, binary, view, texture, texturesReady, hasSpec } from './assets.js';

export const nightUniform = { value: 0 };
export const windUniform = { value: 0 };
/** additive lamp/neon glow batches: faded in at night */
export const glowMaterials = [];
/** street-lamp positions (clusters of the original glow cards), used for real lights at night */
export const lampPositions = [];
const cityMaterials = [];

const FOLIAGE = /^(vegetation_00|forest|fields|fields_cap)\.webp$/;
const BUMPY = /^(atlas\d+|alpha_atlas\d+|ground_\d+|concrete_\d+|concretepost|tile|entrance|parking_lot_blank|tennis|helipad)\.webp$/;

function nightTextureFor(name) {
  const m = /^(alpha_)?atlas(\d+)\.webp$/.exec(name || '');
  return m ? `${m[1] ? 'alpha_night' : 'night'}${m[2]}.webp` : null;
}

function cityMaterial(b) {
  const map = texture(b.texture);
  if (b.blend) {
    const m = new THREE.MeshBasicMaterial({
      map, vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, fog: true, toneMapped: true,
    });
    glowMaterials.push(m);
    return m;
  }
  const night = nightTextureFor(b.texture);
  const foliage = FOLIAGE.test(b.texture || '');
  const spec = hasSpec(b.texture) ? texture('spec_' + b.texture, { srgb: false }) : null;
  const m = new THREE.MeshStandardMaterial({
    map, vertexColors: true, roughness: spec ? 1 : foliage ? 0.9 : 0.82, metalness: spec ? 1 : 0,
    roughnessMap: spec, metalnessMap: spec,
    bumpMap: BUMPY.test(b.texture || '') ? map : null, bumpScale: 0.8,
    alphaTest: b.alphaTest ? 0.5 : 0, side: foliage ? THREE.DoubleSide : THREE.FrontSide,
    emissiveMap: night ? texture(night) : null,
    emissive: night ? 0xffffff : 0x000000,
    envMapIntensity: 1.0,
  });
  m.userData.alphaTest = !!b.alphaTest;
  m.onBeforeCompile = (sh) => {
    if (night) {
      sh.uniforms.uNight = nightUniform;
      sh.fragmentShader = 'uniform float uNight;\n' + sh.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         // night atlas: keep only the bright lit windows/signs as light sources
         float lum = dot(totalEmissiveRadiance, vec3(0.299, 0.587, 0.114));
         totalEmissiveRadiance *= smoothstep(0.35, 0.75, lum) * uNight * 2.4;`);
    }
    if (foliage) {
      // palms and trees sway in the sea breeze; aSway = 0 at the trunk base, 1 at the crown
      sh.uniforms.uWind = windUniform;
      sh.vertexShader = 'uniform float uWind;\nattribute float aSway;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        float ph = position.x * 0.21 + position.z * 0.17;
        float gust = 0.6 + 0.4 * sin(uWind * 0.37 + ph * 0.3);
        transformed.x += (sin(uWind * 1.7 + ph) * 0.16 + sin(uWind * 4.1 + ph * 2.3) * 0.03) * aSway * gust;
        transformed.z += (cos(uWind * 1.3 + ph * 1.1) * 0.12) * aSway * gust;`);
    }
  };
  m.customProgramCacheKey = () => `city-${night ? 'n' : ''}${foliage ? 'f' : ''}`;
  cityMaterials.push(m);
  return m;
}

/** 0 at the lowest vertex of each connected piece (a tree), rising to 1 at its top. */
function swayWeights(pos, idx) {
  const n = pos.length / 3, parent = new Int32Array(n).map((_, i) => i);
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  for (let i = 0; i < idx.length; i += 3) {
    const a = find(idx[i]), b = find(idx[i + 1]), c = find(idx[i + 2]);
    parent[b] = a; parent[c] = a;
  }
  const lo = new Map(), hi = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i), y = pos[i * 3 + 1];
    lo.set(r, Math.min(lo.get(r) ?? Infinity, y)); hi.set(r, Math.max(hi.get(r) ?? -Infinity, y));
  }
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = find(i), h = hi.get(r) - lo.get(r);
    const t = h > 0.5 ? (pos[i * 3 + 1] - lo.get(r)) / h : 0;
    w[i] = t * t * Math.min(1, h / 6);
  }
  return w;
}

function findLamps(pos, idx) {
  const cell = new Map();
  for (let i = 0; i < idx.length; i += 3) {
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < 3; k++) { const v = idx[i + k] * 3; x += pos[v]; y += pos[v + 1]; z += pos[v + 2]; }
    x /= 3; y /= 3; z /= 3;
    const key = Math.round(x / 7) + ',' + Math.round(z / 7);
    if (!cell.has(key)) cell.set(key, [x, y, z]);
  }
  for (const p of cell.values()) lampPositions.push(p);
}

/** Toggle anti-aliasing tricks that depend on the active preset (alpha-to-coverage needs MSAA). */
export function applyCityQuality(msaa) {
  for (const m of cityMaterials) {
    const a2c = msaa && m.userData.alphaTest;
    if (m.alphaToCoverage !== a2c) { m.alphaToCoverage = a2c; m.needsUpdate = true; }
  }
}

export async function loadCity(scene) {
  const [meta, buf] = await Promise.all([json('city/city.json'), binary('city/city.bin'), texturesReady()]);
  const group = new THREE.Group();
  group.name = 'city';
  for (const b of meta.batches) {
    const g = new THREE.BufferGeometry();
    const pos = view(buf, Float32Array, b.position);
    const idx = view(buf, Uint16Array, b.index);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    if (b.uv) g.setAttribute('uv', new THREE.BufferAttribute(view(buf, Float32Array, b.uv), 2));
    if (b.normal) g.setAttribute('normal', new THREE.BufferAttribute(view(buf, Int8Array, b.normal), 3, true));
    else g.computeVertexNormals();
    if (b.color) g.setAttribute('color', new THREE.BufferAttribute(view(buf, Uint8Array, b.color), 4, true));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    if (FOLIAGE.test(b.texture || '')) g.setAttribute('aSway', new THREE.BufferAttribute(swayWeights(pos, idx), 1));
    if (b.blend) findLamps(pos, idx);
    g.boundingBox = new THREE.Box3(new THREE.Vector3(...b.min), new THREE.Vector3(...b.max));
    g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
    const mesh = new THREE.Mesh(g, cityMaterial(b));
    mesh.name = 'city_' + b.id;
    mesh.matrixAutoUpdate = false;
    mesh.castShadow = !b.blend;
    mesh.receiveShadow = !b.blend;
    if (b.blend) mesh.renderOrder = 10;
    group.add(mesh);
  }
  scene.add(group);
  return group;
}
