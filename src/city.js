import * as THREE from 'three';
import { json, binary, view, texture } from './assets.js';

export const nightUniform = { value: 0 };
/** additive lamp/neon glow batches: faded in at night */
export const glowMaterials = [];

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
  const m = new THREE.MeshStandardMaterial({
    map, vertexColors: true, roughness: 0.82, metalness: 0,
    alphaTest: b.alphaTest ? 0.5 : 0, side: THREE.FrontSide,
    emissiveMap: night ? texture(night) : null,
    emissive: night ? 0xffffff : 0x000000,
  });
  if (night) {
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uNight = nightUniform;
      sh.fragmentShader = 'uniform float uNight;\n' + sh.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         // night atlas: keep only the bright lit windows/signs as light sources
         float lum = dot(totalEmissiveRadiance, vec3(0.299, 0.587, 0.114));
         totalEmissiveRadiance *= smoothstep(0.35, 0.75, lum) * uNight * 2.2;`);
    };
    m.customProgramCacheKey = () => 'city-night';
  }
  return m;
}

export async function loadCity(scene) {
  const [meta, buf] = await Promise.all([json('city/city.json'), binary('city/city.bin')]);
  const group = new THREE.Group();
  group.name = 'city';
  for (const b of meta.batches) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(view(buf, Float32Array, b.position), 3));
    if (b.uv) g.setAttribute('uv', new THREE.BufferAttribute(view(buf, Float32Array, b.uv), 2));
    if (b.normal) g.setAttribute('normal', new THREE.BufferAttribute(view(buf, Int8Array, b.normal), 3, true));
    else g.computeVertexNormals();
    if (b.color) g.setAttribute('color', new THREE.BufferAttribute(view(buf, Uint8Array, b.color), 4, true));
    g.setIndex(new THREE.BufferAttribute(view(buf, Uint16Array, b.index), 1));
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
