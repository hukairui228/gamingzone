import * as THREE from 'three';
import { json, binary, view, texture, loadModel } from './assets.js';

let clipsPromise = null;
function loadClips() {
  if (!clipsPromise) {
    clipsPromise = Promise.all([json('anim/clips.json'), binary('anim/clips.bin')]).then(([meta, buf]) => {
      const clips = new Map();
      const speeds = new Map();
      for (const [name, c] of Object.entries(meta)) {
        const tracks = [];
        for (const [bone, tr] of Object.entries(c.tracks)) {
          if (tr.q) {
            tracks.push(new THREE.QuaternionKeyframeTrack(bone + '.quaternion',
              view(buf, Float32Array, tr.tq), view(buf, Float32Array, tr.q)));
          }
          if (tr.p) {
            const p = view(buf, Float32Array, tr.p).slice();
            if (bone === 'Bip01') {
              // strip horizontal root motion (game moves the character), remember its speed
              const n = p.length / 3;
              const dx = p[(n - 1) * 3] - p[0], dy = p[(n - 1) * 3 + 1] - p[1];
              speeds.set(name, c.duration > 0 ? Math.hypot(dx, dy) / 100 / c.duration : 0);
              for (let i = 0; i < n; i++) { p[i * 3] = 0; p[i * 3 + 1] = 0; }
            }
            tracks.push(new THREE.VectorKeyframeTrack(bone + '.position', view(buf, Float32Array, tr.tp), p));
          }
        }
        clips.set(name, new THREE.AnimationClip(name, c.duration, tracks));
      }
      return { clips, speeds };
    });
  }
  return clipsPromise;
}

const matCache = new Map();
function charMaterial(tex) {
  let m = matCache.get(tex);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      map: texture(tex, { repeat: false }), roughness: 0.75, metalness: 0,
      alphaTest: tex && tex.includes('alpha') ? 0.5 : 0,
    });
    matCache.set(tex, m);
  }
  return m;
}

/**
 * Original-game character with skeleton + animations.
 * root: Y-up, metres, feet on y=0, facing local +Z.
 * opts.variant: mesh index or name for files that bundle several bodies (pedestrians).
 */
export async function createCharacter(modelName, opts = {}) {
  const [{ meta, buf }, { clips, speeds }] = await Promise.all([loadModel(modelName), loadClips()]);
  const root = new THREE.Group();
  root.name = modelName;
  const space = new THREE.Group(); // source space: Z-up centimetres, facing -Y
  space.rotation.x = -Math.PI / 2;
  space.scale.setScalar(0.01);
  root.add(space);

  const objs = meta.nodes.map((n) => {
    const o = new THREE.Bone();
    o.name = n.name;
    o.position.fromArray(n.t);
    o.quaternion.fromArray(n.q);
    o.scale.fromArray(n.s);
    return o;
  });
  meta.nodes.forEach((n, i) => (n.parent >= 0 ? objs[n.parent] : space).add(objs[i]));

  const skins = meta.skins || [];
  let pick = skins;
  if (opts.variant !== undefined) {
    pick = skins.filter((s, i) => i === opts.variant || meta.meshes[s.mesh].name.startsWith(opts.variant));
  } else if (skins.length > 1) {
    pick = skins.slice(0, 1);
  }

  const meshes = [];
  for (const s of pick) {
    const md = meta.meshes[s.mesh];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(view(buf, Float32Array, md.position), 3));
    if (md.normal) g.setAttribute('normal', new THREE.BufferAttribute(view(buf, Float32Array, md.normal), 3));
    if (md.uv) g.setAttribute('uv', new THREE.BufferAttribute(view(buf, Float32Array, md.uv), 2));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(view(buf, Uint8Array, md.joints), 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(view(buf, Float32Array, md.weights), 4));
    const indices = [];
    const groups = [];
    for (const p of md.prims) {
      const idx = view(buf, Uint16Array, p.index);
      groups.push([indices.length, idx.length, p.material]);
      for (let i = 0; i < idx.length; i++) indices.push(idx[i]);
    }
    g.setIndex(indices);
    const mats = groups.map(([start, count, mi], k) => {
      g.addGroup(start, count, k);
      return charMaterial(meta.materials[mi] && meta.materials[mi].texture);
    });
    if (!md.normal) g.computeVertexNormals();
    const mesh = new THREE.SkinnedMesh(g, mats.length === 1 ? mats[0] : mats);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    const ibm = view(buf, Float32Array, s.inverseBind);
    const bones = s.joints.map((j) => objs[j]);
    const inverses = bones.map((_, j) => new THREE.Matrix4().fromArray(ibm, j * 16));
    space.add(mesh);
    mesh.bind(new THREE.Skeleton(bones, inverses), new THREE.Matrix4().fromArray(s.bindShape));
    meshes.push(mesh);
  }

  const mixer = new THREE.AnimationMixer(space);
  let current = null, overlayAction = null;
  const upperClips = new Map();
  const UPPER = /Spine1|Neck|Head|Clavicle|UpperArm|Forearm|Hand|Finger|weapon/;
  const byName = new Map(objs.map((o) => [o.name, o]));

  return {
    root,
    meshes,
    clips: [...clips.keys()],
    mixer,
    /** metres per second of the clip's original root motion (useful to sync walk speed). */
    clipSpeed: (name) => speeds.get(name) || 0,
    /** a skeleton node by name, e.g. 'r_h_weapon', 'Bip01_Head' (in source space: cm, Z-up). */
    getNode: (name) => byName.get(name),
    play(name, { loop = true, fade = 0.2, timeScale = 1 } = {}) {
      const clip = clips.get(name);
      if (!clip) throw new Error('unknown clip ' + name);
      const action = mixer.clipAction(clip);
      action.timeScale = timeScale;
      if (action === current && action.isRunning()) return action;
      action.reset();
      action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
      action.clampWhenFinished = !loop;
      action.play();
      if (current && fade > 0) current.crossFadeTo(action, fade, false);
      else if (current) current.stop();
      current = action;
      return action;
    },
    /** Upper-body layer (aiming, reloading) on top of the locomotion clip; null to clear. */
    overlay(name, { fade = 0.15, loop = true } = {}) {
      if (overlayAction && (!name || overlayAction.getClip().name !== name + '#upper')) {
        overlayAction.fadeOut(fade);
        overlayAction = null;
      }
      if (!name || overlayAction) return overlayAction;
      let clip = upperClips.get(name);
      if (!clip) {
        const src = clips.get(name);
        if (!src) throw new Error('unknown clip ' + name);
        clip = new THREE.AnimationClip(name + '#upper', src.duration, src.tracks.filter((t) => UPPER.test(t.name)));
        upperClips.set(name, clip);
      }
      overlayAction = mixer.clipAction(clip);
      overlayAction.reset();
      overlayAction.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
      overlayAction.clampWhenFinished = !loop;
      overlayAction.setEffectiveWeight(12);
      overlayAction.fadeIn(fade).play();
      return overlayAction;
    },
    update(dt) { mixer.update(dt); },
  };
}
