import * as THREE from 'three';
import { loadModel, texture, view } from './assets.js';

const matCache = new Map();

function material(mat, opts) {
  const key = (mat.texture || 'none') + (opts.paint ? '|p' : '') + (opts.basic ? '|b' : '');
  let m = matCache.get(key);
  if (m) return m;
  const map = texture(mat.texture);
  const name = (mat.name || '').toLowerCase();
  const alpha = /shadow|alpha|glow|light|window|glass/.test(name) || /alphas|props_alpha/.test(mat.texture || '');
  if (/shadow/.test(name)) {
    m = new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, opacity: 0.85, color: 0x000000, alphaMap: map });
  } else if (/glow|light/.test(name) || opts.basic) {
    m = new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  } else if (opts.paint && /car_texture$|car_texture_d|car_cops|car_poor/.test(name + ' ' + (mat.texture || ''))) {
    m = new THREE.MeshPhysicalMaterial({
      map, roughness: 0.35, metalness: 0.25, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.2,
    });
  } else {
    m = new THREE.MeshStandardMaterial({ map, roughness: 0.75, metalness: 0, alphaTest: alpha ? 0.5 : 0, side: alpha ? THREE.DoubleSide : THREE.FrontSide });
  }
  matCache.set(key, m);
  return m;
}

function geometry(mesh, buf) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(view(buf, Float32Array, mesh.position), 3));
  if (mesh.normal) g.setAttribute('normal', new THREE.BufferAttribute(view(buf, Float32Array, mesh.normal), 3));
  if (mesh.uv) g.setAttribute('uv', new THREE.BufferAttribute(view(buf, Float32Array, mesh.uv), 2));
  return g;
}

/**
 * Build a static model. Returns a Group in game space (Y-up metres).
 * opts.skip: regexp of node names to leave out; opts.paint: car paint material.
 */
export async function buildModel(name, opts = {}) {
  const { meta, buf } = await loadModel(name);
  const geoms = meta.meshes.map((m) => geometry(m, buf));
  const objs = [];
  const root = new THREE.Group();
  root.name = name;
  const inner = new THREE.Group();
  inner.rotation.x = -Math.PI / 2;
  inner.scale.setScalar(0.01);
  root.add(inner);
  meta.nodes.forEach((n, i) => {
    const o = new THREE.Group();
    o.name = n.name;
    o.position.fromArray(n.t);
    o.quaternion.set(n.q[0], n.q[1], n.q[2], n.q[3]);
    o.scale.fromArray(n.s);
    objs.push(o);
    (n.parent >= 0 ? objs[n.parent] : inner).add(o);
    if (opts.skip && opts.skip.test(n.name)) return;
    for (const mi of n.meshes) {
      const mesh = meta.meshes[mi];
      if (opts.skip && opts.skip.test(mesh.name)) continue;
      for (const p of mesh.prims) {
        const g = geoms[mi].clone();
        g.setIndex(new THREE.BufferAttribute(view(buf, Uint16Array, p.index), 1));
        if (!g.attributes.normal) g.computeVertexNormals();
        const mat = meta.materials[p.material] || { texture: null, name: '' };
        const m = new THREE.Mesh(g, material(mat, opts));
        m.name = mesh.name;
        m.castShadow = !(m.material.transparent);
        m.receiveShadow = true;
        o.add(m);
      }
    }
  });
  root.userData.nodes = Object.fromEntries(objs.map((o) => [o.name, o]));
  return root;
}
