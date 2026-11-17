// Humanoid characters: single skinned mesh (one draw call) + procedural animation.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { pick, damp, clamp, lerp, rand } from './util.js';
import { stdMat } from './materials.js';

const charMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.0 });

export const SKIN = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac, 0x6b4423, 0xd9a066];
export const SHIRTS = [0xff6fb5, 0x2ec4b6, 0xffffff, 0xf4d35e, 0xee964b, 0x6a4c93, 0x1982c4, 0x8ac926, 0xff595e, 0x333333, 0xf0e6d2, 0x9b5de5, 0x00bbf9];
export const PANTS = [0x2b2d42, 0x3d5a80, 0xe8e2d0, 0x6b705c, 0x1d3557, 0x222222, 0x8d6e63, 0xd4c5a9];
export const HAIR = [0x1a1a1a, 0x3b2a1a, 0x6b4423, 0xd4a017, 0x8b2500, 0x999999];

const BONES = ['root', 'hips', 'spine', 'head', 'shL', 'elL', 'shR', 'elR', 'thL', 'knL', 'thR', 'knR'];
const BI = Object.fromEntries(BONES.map((b, i) => [b, i]));

function part(geo, color, bone, x, y, z, sx = 1, sy = 1, sz = 1) {
  geo.scale(sx, sy, sz);
  geo.translate(x, y, z);
  const ng = geo.index ? geo.toNonIndexed() : geo;
  ng.deleteAttribute('uv');
  const n = ng.attributes.position.count;
  const c = new THREE.Color(color);
  const col = new Float32Array(n * 3), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; si[i * 4] = BI[bone]; sw[i * 4] = 1; }
  ng.setAttribute('color', new THREE.BufferAttribute(col, 3));
  ng.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  ng.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  return ng;
}

export function randomOutfit() {
  return {
    skin: pick(SKIN), shirt: pick(SHIRTS), pants: pick(PANTS), hair: pick(HAIR), shoes: pick([0xffffff, 0x222222, 0x8b5a2b, 0xd62828]),
    hairStyle: pick([0, 1, 1, 2, 3]), build: rand(0.92, 1.1), height: rand(0.93, 1.06), glasses: Math.random() < 0.2, hat: Math.random() < 0.12 ? pick([0xffffff, 0x222222, 0xf4d35e]) : null,
    sleeves: Math.random() < 0.6,
  };
}

function buildGeometry(o) {
  const parts = [];
  const b = o.build;
  // pelvis & torso
  parts.push(part(new THREE.BoxGeometry(0.32 * b, 0.2, 0.2), o.pants, 'hips', 0, 0.97, 0));
  parts.push(part(new THREE.CapsuleGeometry(0.17, 0.28, 4, 10), o.shirt, 'spine', 0, 1.28, 0, 1.25 * b, 1, 0.72 * b));
  if (o.jacket) parts.push(part(new THREE.CapsuleGeometry(0.175, 0.26, 4, 10), o.jacket, 'spine', 0, 1.29, -0.005, 1.28 * b, 1, 0.75 * b));
  parts.push(part(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 8), o.skin, 'spine', 0, 1.55, 0));
  // head
  parts.push(part(new THREE.SphereGeometry(0.12, 14, 10), o.skin, 'head', 0, 1.71, 0.005, 0.9, 1.08, 1));
  if (o.hairStyle === 1) parts.push(part(new THREE.SphereGeometry(0.125, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), o.hair, 'head', 0, 1.735, -0.012, 0.95, 0.95, 1.05));
  if (o.hairStyle === 2) parts.push(part(new THREE.SphereGeometry(0.13, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.7), o.hair, 'head', 0, 1.72, -0.03, 0.98, 1.05, 1.1));
  if (o.hairStyle === 3) parts.push(part(new THREE.BoxGeometry(0.2, 0.08, 0.22), o.hair, 'head', 0, 1.82, -0.01));
  if (o.hat) {
    parts.push(part(new THREE.CylinderGeometry(0.13, 0.13, 0.1, 12), o.hat, 'head', 0, 1.82, 0));
    parts.push(part(new THREE.BoxGeometry(0.2, 0.02, 0.14), o.hat, 'head', 0, 1.78, 0.12));
  }
  // eyes / glasses
  if (o.glasses) parts.push(part(new THREE.BoxGeometry(0.2, 0.045, 0.03), 0x050505, 'head', 0, 1.735, 0.11));
  else {
    parts.push(part(new THREE.BoxGeometry(0.025, 0.025, 0.02), 0x111111, 'head', 0.04, 1.74, 0.105));
    parts.push(part(new THREE.BoxGeometry(0.025, 0.025, 0.02), 0x111111, 'head', -0.04, 1.74, 0.105));
  }
  // arms
  for (const s of [1, -1]) {
    const sh = s > 0 ? 'shL' : 'shR', el = s > 0 ? 'elL' : 'elR';
    const x = s * 0.25 * b;
    parts.push(part(new THREE.CapsuleGeometry(0.058, 0.18, 3, 8), o.sleeves ? (o.jacket || o.shirt) : o.skin, sh, x, 1.36, 0));
    parts.push(part(new THREE.CapsuleGeometry(0.048, 0.2, 3, 8), o.jacket && o.longSleeves ? o.jacket : o.skin, el, x, 1.07, 0));
    parts.push(part(new THREE.SphereGeometry(0.052, 8, 6), o.skin, el, x, 0.9, 0.01));
  }
  // legs
  for (const s of [1, -1]) {
    const th = s > 0 ? 'thL' : 'thR', kn = s > 0 ? 'knL' : 'knR';
    const x = s * 0.1;
    parts.push(part(new THREE.CapsuleGeometry(0.078, 0.3, 3, 8), o.pants, th, x, 0.71, 0));
    parts.push(part(new THREE.CapsuleGeometry(0.062, 0.3, 3, 8), o.shorts ? o.skin : o.pants, kn, x, 0.28, 0));
    parts.push(part(new THREE.BoxGeometry(0.11, 0.08, 0.25), o.shoes, kn, x, 0.04, 0.04));
  }
  const g = mergeGeometries(parts);
  g.computeBoundingSphere();
  g.boundingSphere.radius = 2;
  return g;
}

function buildSkeleton() {
  const bones = BONES.map((n) => { const b = new THREE.Bone(); b.name = n; return b; });
  const [root, hips, spine, head, shL, elL, shR, elR, thL, knL, thR, knR] = bones;
  root.add(hips); hips.position.set(0, 0.95, 0);
  hips.add(spine); spine.position.set(0, 0.08, 0);
  spine.add(head); head.position.set(0, 0.52, 0);
  spine.add(shL); shL.position.set(0.25, 0.47, 0);
  shL.add(elL); elL.position.set(0, -0.29, 0);
  spine.add(shR); shR.position.set(-0.25, 0.47, 0);
  shR.add(elR); elR.position.set(0, -0.29, 0);
  hips.add(thL); thL.position.set(0.1, -0.02, 0);
  thL.add(knL); knL.position.set(0, -0.45, 0);
  hips.add(thR); thR.position.set(-0.1, -0.02, 0);
  thR.add(knR); knR.position.set(0, -0.45, 0);
  return bones;
}

// ---------- weapons (visual) ----------
const gunMat = stdMat(0x1c1c1e, 0.35, 0.8);
const woodMat = stdMat(0x6b3e1f, 0.6, 0);
const weaponGeoCache = {};
export function weaponMesh(id) {
  if (!weaponGeoCache[id]) {
    const box = (w, h, d, x, y, z) => { const b = new THREE.BoxGeometry(w, h, d); b.translate(x, y, z); return b; };
    let parts = [], wood = [];
    switch (id) {
      case 'pistol': parts = [box(0.035, 0.05, 0.2, 0, 0.02, 0.06), box(0.03, 0.1, 0.05, 0, -0.04, 0)]; break;
      case 'smg': parts = [box(0.045, 0.07, 0.34, 0, 0.02, 0.1), box(0.03, 0.14, 0.04, 0, -0.07, 0.06), box(0.03, 0.1, 0.04, 0, -0.04, -0.02)]; break;
      case 'shotgun': parts = [box(0.05, 0.05, 0.7, 0, 0.03, 0.25)]; wood = [box(0.05, 0.09, 0.3, 0, -0.01, -0.12), box(0.05, 0.05, 0.16, 0, 0.0, 0.32)]; break;
      case 'rifle': parts = [box(0.05, 0.08, 0.7, 0, 0.03, 0.22), box(0.035, 0.16, 0.06, 0, -0.08, 0.14), box(0.04, 0.05, 0.12, 0, 0.1, 0.12)]; wood = [box(0.05, 0.1, 0.22, 0, 0.0, -0.18)]; break;
      case 'rocket': parts = [new THREE.CylinderGeometry(0.075, 0.075, 1.1, 10).rotateX(Math.PI / 2).translate(0, 0.08, 0.15)]; break;
      case 'grenade': parts = [new THREE.SphereGeometry(0.05, 8, 6).translate(0, 0, 0.02)]; break;
      default: return null;
    }
    weaponGeoCache[id] = { metal: mergeGeometries(parts.map((p) => { p.deleteAttribute('uv'); return p.index ? p.toNonIndexed() : p; })), wood: wood.length ? mergeGeometries(wood) : null };
  }
  const c = weaponGeoCache[id];
  const g = new THREE.Group();
  const m = new THREE.Mesh(c.metal, id === 'rocket' ? stdMat(0x4a5a3a, 0.6, 0.3) : gunMat); m.castShadow = true; g.add(m);
  if (c.wood) { const w = new THREE.Mesh(c.wood, woodMat); g.add(w); }
  return g;
}
const TWO_HANDED = new Set(['smg', 'shotgun', 'rifle', 'rocket']);

export class Character {
  constructor(outfit = randomOutfit()) {
    this.outfit = outfit;
    this.mesh = new THREE.Group();
    const bones = buildSkeleton();
    this.bones = Object.fromEntries(bones.map((b) => [b.name, b]));
    const geo = buildGeometry(outfit);
    this.skinned = new THREE.SkinnedMesh(geo, charMat);
    this.skinned.add(bones[0]);
    this.skinned.bind(new THREE.Skeleton(bones));
    this.skinned.castShadow = true;
    this.skinned.frustumCulled = true;
    this.mesh.add(this.skinned);
    this.mesh.scale.setScalar(outfit.height || 1);
    this.x = 0; this.z = 0; this.y = 0; this.h = 0;
    this.vx = 0; this.vz = 0; this.vy = 0;
    this.hp = 100; this.maxHp = 100; this.armor = 0;
    this.dead = false; this.deathT = 0;
    this.phase = Math.random() * 6;
    this.aim = false; this.aimPitch = 0;
    this.weapon = null; this.weaponId = 'fist';
    this.punchT = 0; this.recoil = 0;
    this.fling = null; // tumbling when hit by car
    this.radius = 0.35;
    this.inVehicle = null;
    this.hitFlash = 0;
  }

  setWeapon(id) {
    if (this.weaponId === id && this.weapon) return;
    if (this.weapon) { this.weapon.removeFromParent(); this.weapon = null; }
    this.weaponId = id;
    const m = weaponMesh(id);
    if (m) {
      // attach to right forearm bone near hand
      m.position.set(0, -0.33, 0.04);
      m.rotation.x = Math.PI / 2;
      this.bones.elR.add(m);
      this.weapon = m;
    }
  }

  place(x, z, h = 0) { this.x = x; this.z = z; this.h = h; this.sync(); }

  // speed: ground speed m/s
  animate(dt, speed, opt = {}) {
    const B = this.bones;
    if (this.dead) { this.animateDead(dt); return; }
    const run = clamp((speed - 2.5) / 3.5, 0, 1);
    const moving = speed > 0.2;
    const freq = lerp(1.9, 1.45, run);
    this.phase += dt * speed * freq;
    const ph = this.phase;
    const amp = moving ? lerp(0.55, 0.95, run) * clamp(speed / 1.5, 0, 1) : 0;
    const s = Math.sin(ph), c = Math.cos(ph);
    const k = 12;
    // legs
    B.thL.rotation.x = damp(B.thL.rotation.x, -s * amp, k, dt);
    B.thR.rotation.x = damp(B.thR.rotation.x, s * amp, k, dt);
    B.knL.rotation.x = damp(B.knL.rotation.x, moving ? Math.max(0, c) * amp * 1.3 + 0.05 : 0.02, k, dt);
    B.knR.rotation.x = damp(B.knR.rotation.x, moving ? Math.max(0, -c) * amp * 1.3 + 0.05 : 0.02, k, dt);
    // body
    const bob = moving ? Math.abs(Math.sin(ph)) * 0.05 * (0.5 + run) : Math.sin(this.phase * 0.3 + performance.now() * 0.0015) * 0.006;
    B.hips.position.y = 0.95 - bob * 0.6 - (opt.crouch ? 0.25 : 0);
    B.spine.rotation.x = damp(B.spine.rotation.x, run * 0.22 + (opt.crouch ? 0.3 : 0), 8, dt);
    B.hips.rotation.y = damp(B.hips.rotation.y, moving ? s * 0.12 * amp : 0, k, dt);
    B.spine.rotation.y = damp(B.spine.rotation.y, moving ? -s * 0.18 * amp : 0, k, dt);
    // arms
    this.recoil = Math.max(0, this.recoil - dt * 8);
    this.punchT = Math.max(0, this.punchT - dt);
    const armed = this.weaponId !== 'fist' && this.weaponId !== 'grenade';
    if (this.aim && armed) {
      const pitch = this.aimPitch;
      B.spine.rotation.y = damp(B.spine.rotation.y, 0.25, 12, dt);
      B.shR.rotation.x = damp(B.shR.rotation.x, -Math.PI / 2 - pitch - this.recoil * 0.3, 20, dt);
      B.shR.rotation.z = damp(B.shR.rotation.z, 0.2, 20, dt);
      B.shR.rotation.y = damp(B.shR.rotation.y, 0, 20, dt);
      B.elR.rotation.x = damp(B.elR.rotation.x, -0.05, 20, dt);
      if (TWO_HANDED.has(this.weaponId)) {
        B.shL.rotation.x = damp(B.shL.rotation.x, -Math.PI / 2 - pitch + 0.15, 20, dt);
        B.shL.rotation.z = damp(B.shL.rotation.z, 0.75, 20, dt);
        B.elL.rotation.x = damp(B.elL.rotation.x, -0.5, 20, dt);
      } else {
        B.shL.rotation.x = damp(B.shL.rotation.x, s * amp * 0.5, k, dt);
        B.shL.rotation.z = damp(B.shL.rotation.z, 0.1, k, dt);
        B.elL.rotation.x = damp(B.elL.rotation.x, -0.3, k, dt);
      }
    } else if (this.punchT > 0) {
      const t = this.punchT / 0.35;
      const ext = Math.sin(t * Math.PI);
      B.shR.rotation.x = -Math.PI / 2 * ext - 0.3;
      B.elR.rotation.x = -1.4 * (1 - ext);
      B.shL.rotation.x = -0.9; B.elL.rotation.x = -1.6;
      B.spine.rotation.y = 0.4 * ext;
    } else {
      const armAmp = amp * 0.9;
      B.shL.rotation.x = damp(B.shL.rotation.x, s * armAmp, k, dt);
      B.shR.rotation.x = damp(B.shR.rotation.x, -s * armAmp + (armed ? -0.25 : 0), k, dt);
      B.shL.rotation.z = damp(B.shL.rotation.z, 0.08, k, dt);
      B.shR.rotation.z = damp(B.shR.rotation.z, -0.08, k, dt);
      B.elL.rotation.x = damp(B.elL.rotation.x, -0.15 - run * 1.0, k, dt);
      B.elR.rotation.x = damp(B.elR.rotation.x, -0.15 - run * 1.0 - (armed ? 0.4 : 0), k, dt);
    }
    // panic: arms up
    if (opt.panic) {
      B.shL.rotation.x = -2.6 + Math.sin(ph * 2) * 0.2; B.shR.rotation.x = -2.6 - Math.sin(ph * 2) * 0.2;
      B.elL.rotation.x = -0.4; B.elR.rotation.x = -0.4;
    }
    if (opt.handsUp) {
      B.shL.rotation.x = -2.9; B.shR.rotation.x = -2.9; B.shL.rotation.z = 0.3; B.shR.rotation.z = -0.3;
    }
    // airborne
    if (opt.air) {
      B.thL.rotation.x = -0.6; B.knL.rotation.x = 1.1; B.thR.rotation.x = 0.2; B.knR.rotation.x = 0.6;
    }
    B.head.rotation.x = damp(B.head.rotation.x, this.aim ? -this.aimPitch * 0.5 : 0, 8, dt);
    this.hitFlash = Math.max(0, this.hitFlash - dt * 6);
    B.spine.rotation.z = this.hitFlash * 0.25;
  }

  die(dirX = 0, dirZ = 1, force = 0) {
    if (this.dead) return;
    this.dead = true; this.deathT = 0;
    // fall direction relative to facing
    const fwd = Math.sin(this.h) * dirX + Math.cos(this.h) * dirZ;
    this.fallBack = fwd > 0 ? -1 : 1;
    if (force > 0) {
      this.fling = { vx: dirX * force, vz: dirZ * force, vy: Math.min(9, force * 0.45), spin: (Math.random() - 0.5) * 10 };
    }
    if (this.weapon) this.weapon.visible = false;
  }

  animateDead(dt) {
    const B = this.bones;
    this.deathT += dt;
    if (this.fling) {
      const f = this.fling;
      f.vy -= 20 * dt;
      this.x += f.vx * dt; this.z += f.vz * dt; this.y += f.vy * dt;
      this.h += f.spin * dt;
      f.vx *= 1 - dt * 0.6; f.vz *= 1 - dt * 0.6;
      if (this.y <= this.groundY) { this.y = this.groundY; if (Math.abs(f.vy) > 3) { f.vy *= -0.3; f.vx *= 0.5; f.vz *= 0.5; f.spin *= 0.4; } else { this.fling = null; } }
    }
    const t = clamp(this.deathT / 0.5, 0, 1);
    const e = 1 - (1 - t) * (1 - t);
    this.skinned.rotation.x = this.fallBack * -Math.PI / 2 * e;
    this.skinned.position.y = 0.12 * e;
    B.shL.rotation.x = lerp(B.shL.rotation.x, -2.2, e * 0.2); B.shR.rotation.x = lerp(B.shR.rotation.x, -1.0, e * 0.2);
    B.shL.rotation.z = lerp(B.shL.rotation.z, 0.9, e * 0.2); B.shR.rotation.z = lerp(B.shR.rotation.z, -0.6, e * 0.2);
    B.thL.rotation.x = lerp(B.thL.rotation.x, -0.2, e * 0.2); B.thR.rotation.x = lerp(B.thR.rotation.x, 0.3, e * 0.2);
    B.knL.rotation.x = lerp(B.knL.rotation.x, 0.4, e * 0.2); B.knR.rotation.x = lerp(B.knR.rotation.x, 0.1, e * 0.2);
    B.hips.position.y = 0.95 - 0.95 * e * 0 + 0;
    this.sync();
  }

  revive() {
    this.dead = false; this.deathT = 0; this.fling = null;
    this.skinned.rotation.x = 0; this.skinned.position.y = 0;
    if (this.weapon) this.weapon.visible = true;
  }

  sync() {
    this.mesh.position.set(this.x, this.y, this.z);
    this.mesh.rotation.y = this.h;
  }

  // hit spheres for bullets (world space)
  hitSpheres() {
    if (this.dead) return [{ x: this.x, y: this.y + 0.25, z: this.z, r: 0.6, part: 'body' }];
    const sc = this.outfit.height || 1;
    return [
      { x: this.x, y: this.y + 1.72 * sc, z: this.z, r: 0.14, part: 'head' },
      { x: this.x, y: this.y + 1.25 * sc, z: this.z, r: 0.28, part: 'body' },
      { x: this.x, y: this.y + 0.65 * sc, z: this.z, r: 0.26, part: 'legs' },
    ];
  }

  dispose() {
    this.mesh.removeFromParent();
    this.skinned.geometry.dispose();
  }
}

export const OUTFITS = {
  player: { skin: 0xd9a066, shirt: 0x1fb5a8, pants: 0xe8e2d0, hair: 0x1a1a1a, shoes: 0xffffff, hairStyle: 3, build: 1.05, height: 1.0, glasses: true, sleeves: true, jacket: null },
  cop: { skin: 0xe0ac69, shirt: 0x1d2b53, pants: 0x1d2b53, hair: 0x222222, shoes: 0x111111, hairStyle: 0, build: 1.08, height: 1.02, glasses: false, hat: 0x111a33, sleeves: true },
  gang: { skin: 0xc68642, shirt: 0xc0392b, pants: 0x111111, hair: 0x111111, shoes: 0x111111, hairStyle: 3, build: 1.06, height: 1.0, glasses: false, hat: null, sleeves: false },
  boss: { skin: 0xe0ac69, shirt: 0x111111, jacket: 0xf4f4f4, longSleeves: true, pants: 0xf4f4f4, hair: 0x3b2a1a, shoes: 0x111111, hairStyle: 1, build: 1.1, height: 1.04, glasses: true, sleeves: true },
  sal: { skin: 0xc68642, shirt: 0xff9f1c, pants: 0x3d5a80, hair: 0x999999, shoes: 0x8b5a2b, hairStyle: 3, build: 1.2, height: 0.98, glasses: false, hat: 0xffffff, sleeves: true },
};
export function gangOutfit() {
  const o = { ...OUTFITS.gang };
  o.skin = pick(SKIN); o.shirt = pick([0xc0392b, 0xe74c3c, 0x922b21, 0xff6f61]); o.hairStyle = pick([0, 1, 3]);
  o.glasses = Math.random() < 0.3; o.hat = Math.random() < 0.3 ? 0xc0392b : null; o.build = rand(1, 1.15);
  return o;
}
export function copOutfit() { return { ...OUTFITS.cop, skin: pick(SKIN) }; }
