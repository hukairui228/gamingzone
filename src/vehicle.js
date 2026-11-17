// Vehicles: procedural models + arcade physics with drifting, jumps, damage and explosions.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, lerp, damp, satOBB, circleOBB, pick } from './util.js';
import { groundHeight, WATER_Y } from './layout.js';
import { paintMaterial, stdMat } from './materials.js';
import { G } from './state.js';
import { glowTexture } from './textures.js';

// ---------------- vehicle catalogue (original designs) ----------------
const COMMON_COLORS = [0xd7263d, 0x1b998b, 0xf4f4f4, 0x111111, 0x2e86ab, 0xf18f01, 0x8c8c8c, 0x5b2a86, 0xe0c341, 0x2d6a4f, 0xc0c0c0, 0xff6fb5, 0x23395b];
export const CAR_TYPES = {
  coupe: {
    name: '旋风 GT', L: 4.4, Wd: 1.9, power: 21, top: 60, grip: 8.5, mass: 1300, hp: 900, wr: 0.34, wf: 0.8, wb: 0.19,
    body: [[0, .36], [0, .8], [.04, .86], [.25, .88], [.7, .8], [.92, .72], [1, .62], [1, .36], [.97, .28], [.03, .28]],
    cabin: [[.22, .86], [.38, 1.24], [.6, 1.24], [.74, .82]], colors: COMMON_COLORS, value: 900,
  },
  sedan: {
    name: '科萨 轿车', L: 4.7, Wd: 1.86, power: 14, top: 47, grip: 7.2, mass: 1450, hp: 1000, wr: 0.34, wf: 0.8, wb: 0.19,
    body: [[0, .38], [0, .92], [.05, .98], [.24, 1.0], [.32, .98], [.75, .95], [.95, .85], [1, .72], [1, .38], [.97, .3], [.03, .3]],
    cabin: [[.24, .98], [.34, 1.45], [.66, 1.45], [.78, .95]], colors: COMMON_COLORS, value: 500,
  },
  muscle: {
    name: '野牛 V8', L: 4.9, Wd: 1.96, power: 23, top: 57, grip: 6.4, mass: 1550, hp: 1100, wr: 0.37, wf: 0.8, wb: 0.18,
    body: [[0, .42], [0, .92], [.05, .97], [.3, .97], [.62, .94], [.97, .92], [1, .82], [1, .42], [.97, .32], [.03, .32]],
    cabin: [[.2, .96], [.32, 1.3], [.55, 1.3], [.66, .94]], colors: [0xd7263d, 0x111111, 0xf18f01, 0x2e86ab, 0xe0c341, 0x2d6a4f], value: 1100,
  },
  suv: {
    name: '阿特拉斯 SUV', L: 4.8, Wd: 2.0, power: 15, top: 45, grip: 7, mass: 2100, hp: 1400, wr: 0.42, wf: 0.8, wb: 0.19,
    body: [[0, .52], [0, 1.12], [.03, 1.17], [.75, 1.14], [.95, 1.02], [1, .92], [1, .52], [.97, .44], [.03, .44]],
    cabin: [[.02, 1.14], [.05, 1.82], [.62, 1.82], [.76, 1.14]], colors: COMMON_COLORS, value: 800,
  },
  taxi: {
    name: '海湾出租车', L: 4.7, Wd: 1.86, power: 15, top: 48, grip: 7.4, mass: 1450, hp: 1000, wr: 0.34, wf: 0.8, wb: 0.19,
    body: [[0, .38], [0, .92], [.05, .98], [.24, 1.0], [.32, .98], [.75, .95], [.95, .85], [1, .72], [1, .38], [.97, .3], [.03, .3]],
    cabin: [[.24, .98], [.34, 1.45], [.66, 1.45], [.78, .95]], colors: [0xffc300], taxi: true, value: 600,
  },
  police: {
    name: '警用拦截车', L: 4.8, Wd: 1.9, power: 21, top: 58, grip: 8.6, mass: 1600, hp: 1300, wr: 0.35, wf: 0.8, wb: 0.19,
    body: [[0, .38], [0, .92], [.05, .98], [.24, 1.0], [.32, .98], [.75, .95], [.95, .85], [1, .72], [1, .38], [.97, .3], [.03, .3]],
    cabin: [[.24, .98], [.34, 1.45], [.66, 1.45], [.78, .95]], colors: [0x101820], police: true, value: 1500,
  },
  pickup: {
    name: '牧场皮卡', L: 5.2, Wd: 2.0, power: 15, top: 45, grip: 6.8, mass: 2000, hp: 1400, wr: 0.42, wf: 0.82, wb: 0.18,
    body: [[0, .52], [0, 1.05], [.75, 1.05], [.95, .98], [1, .88], [1, .52], [.97, .44], [.03, .44]],
    cabin: [[.4, 1.05], [.44, 1.76], [.66, 1.76], [.76, 1.05]], colors: COMMON_COLORS, value: 600,
  },
  super: {
    name: '闪电 SX', L: 4.5, Wd: 2.0, power: 31, top: 78, grip: 10.5, mass: 1350, hp: 900, wr: 0.36, wf: 0.8, wb: 0.18,
    body: [[0, .34], [0, .74], [.05, .82], [.3, .84], [.62, .72], [.9, .56], [1, .46], [1, .3], [.97, .22], [.03, .22]],
    cabin: [[.25, .82], [.42, 1.13], [.56, 1.13], [.73, .7]], colors: [0xd7263d, 0xff6fb5, 0xe0c341, 0x2ef2ff, 0xffffff, 0x3dff7a, 0xff7a00], value: 3000,
  },
  van: {
    name: '货运厢车', L: 5.3, Wd: 2.05, power: 11, top: 38, grip: 6.2, mass: 2600, hp: 1600, wr: 0.38, wf: 0.82, wb: 0.16,
    body: [[0, .46], [0, 2.15], [.78, 2.15], [.78, 1.2], [.97, 1.1], [1, .95], [1, .46], [.97, .38], [.03, .38]],
    cabin: [[.775, 1.18], [.775, 2.13], [.8, 2.13], [.93, 1.2]], colors: [0xf4f4f4, 0x8c8c8c, 0x2e86ab], value: 400,
  },
  armored: {
    name: '装甲运钞车', L: 5.6, Wd: 2.2, power: 13, top: 40, grip: 6.5, mass: 4200, hp: 5000, wr: 0.44, wf: 0.82, wb: 0.16,
    body: [[0, .5], [0, 2.2], [.76, 2.2], [.76, 1.3], [.97, 1.2], [1, 1.0], [1, .5], [.97, .4], [.03, .4]],
    cabin: [[.755, 1.28], [.755, 2.18], [.78, 2.18], [.92, 1.3]], colors: [0x4a5a4a], value: 2000,
  },
  motorcycle: {
    name: '飞隼摩托', L: 2.2, Wd: 0.55, power: 18, top: 62, grip: 6.5, mass: 220, hp: 300,
    wr: 0.34, wf: 0.85, wb: 0.15, bike: true,
    body: null, cabin: null, colors: [0xd7263d, 0x111111, 0x2e86ab, 0xf18f01, 0xff6fb5, 0x5b2a86, 0xf4f4f4], value: 1200,
  },
  sportbike: {
    name: '闪电猎豹', L: 2.1, Wd: 0.5, power: 26, top: 78, grip: 7.5, mass: 190, hp: 250,
    wr: 0.33, wf: 0.86, wb: 0.14, bike: true,
    body: null, cabin: null, colors: [0xd7263d, 0x2ef2ff, 0xffd166, 0x3dff7a, 0xff3fa4], value: 3500,
  },
  dirtbike: {
    name: '越野摩托', L: 2.0, Wd: 0.5, power: 15, top: 52, grip: 8, mass: 160, hp: 220,
    wr: 0.38, wf: 0.84, wb: 0.16, bike: true,
    body: null, cabin: null, colors: [0xf18f01, 0xd7263d, 0x2e86ab, 0x3dff7a, 0xf4f4f4], value: 800,
  },
  jetski: {
    name: '海鲨水摩', L: 2.8, Wd: 1.2, power: 16, top: 45, grip: 4, mass: 300, hp: 500,
    wr: 0, wf: 0, wb: 0, boat: true,
    body: null, cabin: null, colors: [0xd7263d, 0x2ef2ff, 0xf4f4f4, 0xff6fb5], value: 1800,
  },
  speedboat: {
    name: '碧波快艇', L: 7.0, Wd: 2.4, power: 22, top: 52, grip: 3.5, mass: 1200, hp: 1200,
    wr: 0, wf: 0, wb: 0, boat: true,
    body: null, cabin: null, colors: [0xffffff, 0x2e86ab, 0xd7263d], value: 5000,
  },
};
export const TRAFFIC_MIX = ['sedan', 'sedan', 'sedan', 'coupe', 'suv', 'suv', 'taxi', 'taxi', 'pickup', 'van', 'muscle', 'coupe', 'super', 'motorcycle', 'motorcycle'];

// ---------------- shared materials ----------------
const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x0c1218, metalness: 0.3, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.6 });
const trimMat = stdMat(0x121212, 0.55, 0.1);
const chromeMat = stdMat(0xdddddd, 0.15, 1.0);
const tireMat = stdMat(0x161616, 0.92, 0.0);
const rimMat = stdMat(0xb8b8b8, 0.22, 1.0);
const burntMat = stdMat(0x1b1714, 0.95, 0.2);
export const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4dd, emissiveIntensity: 1.5, roughness: 0.1 });
const tailBase = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff0820, emissiveIntensity: 0.6, roughness: 0.2 });
const glowTex = glowTexture();

const geomCache = new Map();
function buildGeometry(key, t) {
  if (geomCache.has(key)) return geomCache.get(key);
  const L = t.L, Wd = t.Wd;
  const shapeFrom = (pts) => {
    const s = new THREE.Shape();
    pts.forEach(([u, h], k) => { const x = (u - 0.5) * L; if (k === 0) s.moveTo(x, h); else s.lineTo(x, h); });
    s.closePath();
    return s;
  };
  const extrude = (pts, width, bevel) => {
    const g = new THREE.ExtrudeGeometry(shapeFrom(pts), {
      depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 3, curveSegments: 4,
    });
    g.rotateY(-Math.PI / 2);
    g.translate((width - bevel * 2) / 2, 0, 0);
    g.computeVertexNormals();
    return g;
  };
  const body = extrude(t.body, Wd, 0.09);
  const cabin = extrude(t.cabin, Wd - 0.22, 0.07);
  // trims: bumpers, skirts, mirrors, grille
  const tg = [];
  const box = (w, h, d, x, y, z) => { const b = new THREE.BoxGeometry(w, h, d); b.translate(x, y, z); tg.push(b); };
  const yb = t.body[t.body.length - 1][1];
  box(Wd + 0.04, 0.22, 0.25, 0, yb + 0.1, L / 2 - 0.05);
  box(Wd + 0.04, 0.22, 0.25, 0, yb + 0.1, -L / 2 + 0.05);
  box(0.06, 0.12, L * 0.55, Wd / 2 + 0.01, yb + 0.05, 0);
  box(0.06, 0.12, L * 0.55, -Wd / 2 - 0.01, yb + 0.05, 0);
  const mirrorY = t.cabin[0][1] + 0.1, mirrorZ = (t.cabin[t.cabin.length - 1][0] - 0.5) * L - 0.15;
  box(0.22, 0.12, 0.14, Wd / 2 + 0.08, mirrorY, mirrorZ);
  box(0.22, 0.12, 0.14, -Wd / 2 - 0.08, mirrorY, mirrorZ);
  const frontH = t.body.find(([u]) => u === 1) ? Math.max(...t.body.filter(([u]) => u === 1).map(([, h]) => h)) : 0.7;
  box(Wd * 0.5, 0.14, 0.05, 0, (frontH + yb) / 2, L / 2 + 0.07);
  const trims = mergeGeometries(tg.map((g) => { g.deleteAttribute('uv'); return g; }));
  // lights
  const lightY = (frontH + yb) / 2 + 0.08;
  const hl = []; const tl = [];
  for (const s of [-1, 1]) {
    const h = new THREE.BoxGeometry(0.42, 0.13, 0.08); h.translate(s * (Wd / 2 - 0.3), lightY, L / 2 + 0.02); hl.push(h);
    const backH = Math.max(...t.body.filter(([u]) => u === 0).map(([, h]) => h));
    const tt = new THREE.BoxGeometry(0.45, 0.12, 0.08); tt.translate(s * (Wd / 2 - 0.3), backH - 0.18, -L / 2 - 0.02); tl.push(tt);
  }
  const head = mergeGeometries(hl), tail = mergeGeometries(tl);
  const res = { body, cabin, trims, head, tail, frontH, lightY };
  geomCache.set(key, res);
  return res;
}

function buildBikeGeometry(key, t) {
  if (geomCache.has(key)) return geomCache.get(key);
  const L = t.L;
  const geos = [];
  const box = (w, h, d, x, y, z) => { const b = new THREE.BoxGeometry(w, h, d); b.translate(x, y, z); geos.push(b); };
  // main frame tube
  box(0.07, 0.12, L * 0.65, 0, 0.62, 0);
  // gas tank
  box(0.28, 0.18, 0.44, 0, 0.78, L * 0.12);
  // seat
  box(0.24, 0.07, 0.55, 0, 0.78, -L * 0.12);
  // engine block
  box(0.3, 0.22, 0.32, 0, 0.46, L * 0.02);
  // front fork tubes
  for (const s of [-0.06, 0.06]) {
    const f = new THREE.CylinderGeometry(0.025, 0.025, 0.65, 6);
    f.rotateX(-0.25); f.translate(s, 0.62, L * 0.35); geos.push(f);
  }
  // handlebars
  box(0.52, 0.035, 0.035, 0, 0.92, L * 0.3);
  // exhaust pipes
  for (const s of [0.14, -0.14]) {
    const ex = new THREE.CylinderGeometry(0.025, 0.035, 0.7, 6);
    ex.rotateX(Math.PI / 2 + 0.15); ex.translate(s, 0.38, -L * 0.2); geos.push(ex);
  }
  // rear fender
  box(0.2, 0.035, 0.4, 0, 0.48, -L * 0.3);
  // headlight
  const hl = new THREE.BoxGeometry(0.16, 0.1, 0.06); hl.translate(0, 0.82, L * 0.46);
  // taillight
  const tl = new THREE.BoxGeometry(0.1, 0.06, 0.04); tl.translate(0, 0.56, -L * 0.48);
  const merged = mergeGeometries(geos.map(g => { g.deleteAttribute('uv'); return g; }));
  const res = { body: merged, cabin: null, trims: null, head: hl, tail: tl, frontH: 0.92, lightY: 0.82 };
  geomCache.set(key, res);
  return res;
}

function buildBoatGeometry(key, t) {
  if (geomCache.has(key)) return geomCache.get(key);
  const L = t.L, Wd = t.Wd;
  const geos = [];
  const box = (w, h, d, x, y, z) => { const b = new THREE.BoxGeometry(w, h, d); b.translate(x, y, z); geos.push(b); };
  // hull bottom
  box(Wd, 0.15, L, 0, 0.08, 0);
  // hull sides
  box(0.1, 0.5, L, Wd / 2, 0.35, 0);
  box(0.1, 0.5, L, -Wd / 2, 0.35, 0);
  // stern
  box(Wd, 0.5, 0.1, 0, 0.35, -L / 2);
  // deck
  box(Wd - 0.2, 0.08, L * 0.9, 0, 0.16, -L * 0.05);
  // bow point (wedge from cone)
  const bow = new THREE.ConeGeometry(Wd / 2, L * 0.25, 4, 1);
  bow.rotateY(Math.PI / 4); bow.rotateX(-Math.PI / 2);
  bow.translate(0, 0.3, L / 2 + L * 0.08); geos.push(bow);
  // windshield
  const ws = new THREE.BoxGeometry(Wd * 0.6, 0.45, 0.06);
  ws.rotateX(-0.3); ws.translate(0, 0.65, L * 0.15); geos.push(ws);
  // console
  box(0.5, 0.3, 0.4, 0, 0.35, L * 0.08);
  // seats
  box(0.4, 0.25, 0.35, 0.35, 0.3, -L * 0.1);
  box(0.4, 0.25, 0.35, -0.35, 0.3, -L * 0.1);
  // engine cowl (rear)
  box(Wd * 0.5, 0.25, L * 0.18, 0, 0.3, -L * 0.38);
  // headlight
  const hl = new THREE.BoxGeometry(0.2, 0.1, 0.06); hl.translate(0, 0.5, L / 2 + 0.02);
  // taillight
  const tl = new THREE.BoxGeometry(Wd * 0.4, 0.08, 0.06); tl.translate(0, 0.35, -L / 2 - 0.02);
  const merged = mergeGeometries(geos.map(g => { g.deleteAttribute('uv'); return g; }));
  const res = { body: merged, cabin: null, trims: null, head: hl, tail: tl, frontH: 0.65, lightY: 0.5 };
  geomCache.set(key, res);
  return res;
}

const wheelGeo = (() => {
  const tire = new THREE.CylinderGeometry(1, 1, 0.28, 20); tire.rotateZ(Math.PI / 2);
  const rim = new THREE.CylinderGeometry(0.66, 0.66, 0.3, 10); rim.rotateZ(Math.PI / 2);
  return { tire, rim };
})();

let VID = 0;
export class Vehicle {
  constructor(typeKey, color, opts = {}) {
    this.id = ++VID;
    this.typeKey = typeKey;
    this.t = CAR_TYPES[typeKey];
    const t = this.t;
    this.color = color ?? pick(t.colors);
    this.mesh = new THREE.Group();
    this.mesh.rotation.order = 'YXZ';
    this.body = new THREE.Group();
    this.mesh.add(this.body);
    const g = t.bike ? buildBikeGeometry(typeKey, t) : t.boat ? buildBoatGeometry(typeKey, t) : buildGeometry(typeKey, t);
    this.paint = paintMaterial(this.color);
    this.bodyMesh = new THREE.Mesh(g.body, this.paint);
    let roofH = g.frontH;
    let roofZ = 0;
    if (t.bike || t.boat) {
      this.cabinMesh = new THREE.Object3D();
      this.roof = new THREE.Object3D();
      this.trimMesh = new THREE.Object3D();
    } else {
      this.cabinMesh = new THREE.Mesh(g.cabin, glassMat);
      const roofPts = t.cabin;
      roofH = Math.max(...roofPts.map((p) => p[1]));
      const roofU = roofPts.filter((p) => p[1] === roofH).map((p) => p[0]);
      const roofLen = (Math.max(...roofU) - Math.min(...roofU)) * t.L;
      roofZ = ((Math.max(...roofU) + Math.min(...roofU)) / 2 - 0.5) * t.L;
      this.roof = new THREE.Mesh(new THREE.BoxGeometry(t.Wd - 0.3, 0.05, roofLen + 0.05), this.paint);
      this.roof.position.set(0, roofH + 0.06, roofZ);
      this.trimMesh = new THREE.Mesh(g.trims, trimMat);
    }
    this.headMesh = g.head ? new THREE.Mesh(g.head, headMat) : new THREE.Object3D();
    this.tailMat = tailBase.clone();
    this.tailMesh = g.tail ? new THREE.Mesh(g.tail, this.tailMat) : new THREE.Object3D();
    this.body.add(this.bodyMesh, this.cabinMesh, this.roof, this.trimMesh, this.headMesh, this.tailMesh);
    this.roofY = roofH;
    this.H = roofH + 0.1;
    for (const m of [this.bodyMesh, this.cabinMesh, this.roof]) { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } }

    if (t.police) {
      // white doors / livery
      const door = new THREE.Mesh(new THREE.BoxGeometry(t.Wd + 0.02, 0.42, t.L * 0.4), stdMat(0xf4f4f4, 0.35, 0.1));
      door.position.set(0, 0.62, -0.1);
      this.body.add(door);
      this.sirenR = new THREE.MeshStandardMaterial({ color: 0x200000, emissive: 0xff1030, emissiveIntensity: 0 });
      this.sirenB = new THREE.MeshStandardMaterial({ color: 0x000020, emissive: 0x1050ff, emissiveIntensity: 0 });
      const bar = new THREE.Group();
      const r = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.14, 0.26), this.sirenR); r.position.x = -0.3;
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.14, 0.26), this.sirenB); b.position.x = 0.3;
      bar.add(r, b); bar.position.set(0, roofH + 0.16, roofZ);
      this.body.add(bar);
    }
    if (t.taxi) {
      const sign = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.24, 0.3), new THREE.MeshStandardMaterial({ color: 0x332200, emissive: 0xffcc33, emissiveIntensity: 1.5 }));
      sign.position.set(0, roofH + 0.2, roofZ);
      this.body.add(sign);
      const checker = new THREE.Mesh(new THREE.BoxGeometry(t.Wd + 0.02, 0.12, t.L * 0.5), stdMat(0x111111, 0.5));
      checker.position.set(0, 0.78, 0);
      this.body.add(checker);
    }
    // wheels
    this.wheels = [];
    if (t.bike) {
      const wr = t.wr;
      const zf = (t.wf - 0.5) * t.L, zr = (t.wb - 0.5) * t.L;
      for (const [z, front] of [[zf, true], [zr, false]]) {
        const pivot = new THREE.Group();
        pivot.position.set(0, wr, z);
        const spin = new THREE.Group();
        const tire = new THREE.Mesh(wheelGeo.tire, tireMat); tire.scale.set(0.5, wr, wr);
        const rim = new THREE.Mesh(wheelGeo.rim, rimMat); rim.scale.set(0.5, wr, wr);
        tire.castShadow = true;
        spin.add(tire, rim); pivot.add(spin);
        this.mesh.add(pivot);
        this.wheels.push({ pivot, spin, front });
      }
      this.wheelBase = Math.abs(zf - zr);
    } else if (t.boat) {
      this.wheelBase = t.L * 0.6;
    } else {
      const wr = t.wr;
      const zf = (t.wf - 0.5) * t.L, zr = (t.wb - 0.5) * t.L;
      for (const [x, z, front] of [[1, zf, true], [-1, zf, true], [1, zr, false], [-1, zr, false]]) {
        const pivot = new THREE.Group();
        pivot.position.set(x * (t.Wd / 2 - 0.12), wr, z);
        const spin = new THREE.Group();
        const tire = new THREE.Mesh(wheelGeo.tire, tireMat); tire.scale.set(1, wr, wr);
        const rim = new THREE.Mesh(wheelGeo.rim, rimMat); rim.scale.set(1, wr, wr);
        tire.castShadow = true;
        spin.add(tire, rim); pivot.add(spin);
        this.mesh.add(pivot);
        this.wheels.push({ pivot, spin, front });
      }
      this.wheelBase = Math.abs(zf - zr);
    }
    // underglow
    this.glow = new THREE.Mesh(new THREE.PlaneGeometry(t.Wd * 1.8, t.L * 1.3), new THREE.MeshBasicMaterial({ map: glowTex, color: 0xff00ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.glow.rotation.x = -Math.PI / 2; this.glow.position.y = 0.06; this.glow.visible = false;
    this.mesh.add(this.glow);

    // state
    this.x = 0; this.z = 0; this.y = 0; this.h = 0;
    this.vx = 0; this.vz = 0; this.vy = 0; this.yawRate = 0;
    this.vF = 0; this.vR = 0;
    this.grounded = true; this.airTime = 0;
    this.input = { throttle: 0, steer: 0, handbrake: false, nitro: false };
    this.steerVis = 0;
    this.maxHp = t.hp * (opts.armorMul || 1); this.hp = this.maxHp;
    this.powerMul = opts.powerMul || 1;
    this.nitroMax = opts.nitroMax ?? 0; this.nitro = this.nitroMax;
    this.dead = false; this.burning = 0; this.sinking = 0;
    this.driver = null;   // 'player' | ped object | null
    this.ai = null;
    this.obb = { x: 0, z: 0, hw: t.Wd / 2, hd: t.L / 2, a: 0 };
    this.mass = t.mass;
    this.siren = false; this.sirenT = 0;
    this.pitch = 0; this.roll = 0;
    this.lastHit = 0;
    this.smokeT = 0;
    this.persistent = !!opts.persistent;
    this.isPolice = !!t.police;
    this.lockedForMission = false;
  }

  setGlow(color) {
    if (color == null) { this.glow.visible = false; this.glowColor = null; return; }
    this.glow.visible = true; this.glow.material.color.set(color).multiplyScalar(2.5); this.glowColor = color;
  }
  setColor(hex) { this.color = hex; this.paint = paintMaterial(hex); this.bodyMesh.material = this.paint; if (this.roof.material) this.roof.material = this.paint; }

  place(x, z, h) {
    this.x = x; this.z = z; this.h = h;
    if (this.t.boat && groundHeight(x, z) < -5) this.y = WATER_Y;
    else this.y = Math.max(0, groundHeight(x, z));
    this.vx = this.vz = this.vy = 0; this.yawRate = 0;
    this.syncMesh();
  }

  get speed() { return Math.hypot(this.vx, this.vz); }
  get fwdX() { return Math.sin(this.h); }
  get fwdZ() { return Math.cos(this.h); }

  // seat position (left side door) for exits
  doorPos(side = 1) {
    const rx = -Math.cos(this.h), rz = Math.sin(this.h);
    return { x: this.x - rx * side * (this.t.Wd / 2 + 0.8), z: this.z - rz * side * (this.t.Wd / 2 + 0.8) };
  }

  update(dt) {
    const t = this.t;
    if (this.dead) {
      this.vx *= 1 - Math.min(1, dt * 2); this.vz *= 1 - Math.min(1, dt * 2);
      this.x += this.vx * dt; this.z += this.vz * dt;
      this.integrateVertical(dt, 0);
      this.syncMesh();
      return;
    }
    const inp = this.input;
    const fx = Math.sin(this.h), fz = Math.cos(this.h);
    const rx = -fz, rz = fx;
    let vF = this.vx * fx + this.vz * fz;
    let vR = this.vx * rx + this.vz * rz;
    const wet = 1 - (G.sky ? G.sky.rain * 0.25 : 0);
    const prevVF = vF;
    let drifting = false;
    if (this.grounded && this.sinking <= 0) {
      const top = t.top * this.powerMul * (inp.nitro && this.nitro > 0 ? 1.25 : 1);
      const power = t.power * this.powerMul;
      let f = 0;
      if (inp.throttle > 0.05) {
        if (vF < -0.5) f = inp.throttle * 22;
        else f = inp.throttle * power * (1 - Math.pow(clamp(vF / top, 0, 1), 2)) * (vF < 8 ? 1.25 : 1);
      } else if (inp.throttle < -0.05) {
        if (vF > 0.5) f = inp.throttle * 24;
        else f = vF > -14 ? inp.throttle * power * 0.55 : 0;
      }
      if (inp.nitro && this.nitro > 0 && inp.throttle > 0.05) {
        f += power * 0.9; this.nitro = Math.max(0, this.nitro - dt * 0.28); this.nitroOn = true;
      } else this.nitroOn = false;
      vF += f * dt;
      const coast = Math.abs(inp.throttle) < 0.05 ? 0.35 : 0.06;
      vF -= vF * (coast + Math.abs(vF) * 0.0028) * dt;
      if (inp.handbrake) vF -= Math.sign(vF) * Math.min(Math.abs(vF), 7 * dt);
      // lateral grip
      const slideFac = Math.abs(vR) > 3.5 ? 0.42 : 1;
      const grip = t.grip * (inp.handbrake ? 0.12 : 1) * slideFac * wet;
      vR -= vR * Math.min(1, grip * dt);
      drifting = Math.abs(vR) > 3.2 && Math.abs(vF) > 8;
      // steering (bicycle model)
      const sp = Math.abs(vF);
      const steerAng = inp.steer * 0.62 * lerp(1, 0.32, clamp(sp / 45, 0, 1));
      this.steerVis = damp(this.steerVis, inp.steer * 0.5, 12, dt);
      let yawT = -(vF / this.wheelBase) * Math.tan(steerAng);
      if (inp.handbrake && sp > 6) yawT *= 1.5;
      if (drifting) yawT *= 1.25; // counter-steer authority
      this.yawRate = damp(this.yawRate, yawT, inp.handbrake || drifting ? 5 : 11, dt);
      this.airTime = 0;
    } else {
      this.yawRate *= 1 - Math.min(1, dt * 0.5);
      if (!this.grounded) this.airTime += dt;
    }
    this.vF = vF; this.vR = vR; this.drifting = drifting;
    this.vx = fx * vF + rx * vR;
    this.vz = fz * vF + rz * vR;
    this.h += this.yawRate * dt;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.accel = (vF - prevVF) / Math.max(dt, 1e-4);
    this.integrateVertical(dt, vF);
    this.collideStatic();

    // visual dynamics
    const pitchT = clamp(-this.accel * 0.004, -0.05, 0.05);
    const rollT = clamp(this.yawRate * vF * 0.0035, -0.07, 0.07);
    this.pitch = damp(this.pitch, pitchT, 6, dt);
    this.roll = damp(this.roll, rollT, 6, dt);
    if (t.bike) {
      const leanT = clamp(-this.yawRate * Math.max(8, Math.abs(vF)) * 0.012, -0.5, 0.5);
      this.roll = damp(this.roll, leanT, 8, dt);
    }
    for (const w of this.wheels) {
      if (t.wr > 0) w.spin.rotation.x += vF * dt / t.wr;
      if (w.front) w.pivot.rotation.y = -this.steerVis;
    }
    // brake lights
    const braking = (inp.throttle < -0.05 && vF > 1) || (inp.throttle > 0.05 && vF < -1) || inp.handbrake;
    this.tailMat.emissiveIntensity = braking ? 6 : 0.4 + (G.sky ? G.sky.night * 1.2 : 0);
    // siren
    if (this.isPolice) {
      this.sirenT += dt;
      const on = this.siren;
      const p = Math.floor(this.sirenT * 6) % 2;
      this.sirenR.emissiveIntensity = on && p ? 12 : 0;
      this.sirenB.emissiveIntensity = on && !p ? 12 : 0;
    }
    this.damageEffects(dt);
    this.syncMesh();
  }

  integrateVertical(dt, vF) {
    const gh = groundHeight(this.x, this.z);
    const t = this.t;
    if (t.boat) {
      if (gh > -5) {
        this.grounded = true;
        this.y = Math.max(0, gh);
        this.vx *= 1 - Math.min(1, dt * 3);
        this.vz *= 1 - Math.min(1, dt * 3);
        return;
      }
      this.grounded = true;
      this.sinking = 0;
      const waveY = WATER_Y + Math.sin(G.time * 1.2 + this.x * 0.3) * 0.15 + Math.cos(G.time * 0.8 + this.z * 0.2) * 0.1;
      this.y = damp(this.y, waveY, 4, dt);
      this.vy = 0;
      const drag = 0.6 + Math.abs(vF) * 0.008;
      this.vx *= 1 - Math.min(1, dt * drag * 0.3);
      this.vz *= 1 - Math.min(1, dt * drag * 0.3);
      this.gPitch = damp(this.gPitch || 0, Math.sin(G.time * 1.5 + this.x) * 0.03 + clamp(-(this.accel || 0) * 0.006, -0.08, 0.08), 4, dt);
      return;
    }
    if (gh < -10) {
      // over water
      this.grounded = false;
      this.vy -= 22 * dt;
      this.y += this.vy * dt;
      if (this.y < WATER_Y - 0.4) {
        this.y = Math.max(this.y, WATER_Y - 2.4);
        this.vy *= 0.3;
        this.vx *= 1 - Math.min(1, dt * 2.5); this.vz *= 1 - Math.min(1, dt * 2.5);
        this.sinking += dt;
        if (this.sinking > 0.1 && !this.splashed) { this.splashed = true; G.fx && G.fx.splash(this.x, WATER_Y, this.z); G.audio && G.audio.splash(); }
        if (this.sinking > 3 && !this.dead) { this.dead = true; this.hp = 0; G.events.emit('vehicleSunk', this); }
      }
      return;
    }
    const groundPitch = () => {
      const fx = Math.sin(this.h), fz = Math.cos(this.h), hl = t.L * 0.4;
      const a = groundHeight(this.x + fx * hl, this.z + fz * hl), b = groundHeight(this.x - fx * hl, this.z - fz * hl);
      return -Math.atan2(a - b, hl * 2);
    };
    if (this.grounded) {
      if (gh >= this.y - 0.4) {
        const nvy = (gh - this.y) / Math.max(dt, 1e-4);
        this.vy = clamp(nvy, -6, 14);
        this.y = gh;
        this.gPitch = damp(this.gPitch || 0, groundPitch(), 20, dt);
      } else {
        this.grounded = false; // launched
        this.launchY = this.y;
      }
    } else {
      this.vy -= 20 * dt;
      this.y += this.vy * dt;
      const airPitch = clamp(-Math.atan2(this.vy, Math.max(6, Math.abs(vF))) * 0.6, -0.5, 0.5);
      this.gPitch = damp(this.gPitch || 0, airPitch, 2.5, dt);
      if (this.y <= gh) {
        const impact = -this.vy;
        this.y = gh; this.grounded = true;
        if (impact > 9) { this.damage((impact - 9) * 25, 'land'); G.fx && G.fx.sparks(this.x, gh + 0.2, this.z, 12); }
        if (impact > 3) { G.events.emit('vehicleLanded', this, impact); this.landBounce = Math.min(0.25, impact * 0.015); }
        this.vy = 0;
        this.gPitch = groundPitch();
      }
    }
  }

  collideStatic() {
    if (this.t.boat && groundHeight(this.x, this.z) < -5) return;
    const o = this.obb;
    o.x = this.x; o.z = this.z; o.a = this.h;
    const r = this.t.L / 2 + 1;
    const items = G.world.statics.query(this.x - r, this.z - r, this.x + r, this.z + r, this._q || (this._q = []));
    for (const it of items) {
      if (this.y > it.y1 - 0.2 || this.y + this.H < it.y0) continue;
      let nx, nz, depth;
      if (it.kind === 'box') {
        const s = satOBB(o, it.obb);
        if (!s) continue;
        nx = s.nx; nz = s.nz; depth = s.depth;
      } else {
        const c = circleOBB(it.x, it.z, it.r, o);
        if (!c) continue;
        nx = -c.nx; nz = -c.nz; depth = c.depth;
      }
      this.x += nx * depth; this.z += nz * depth;
      o.x = this.x; o.z = this.z;
      const vn = this.vx * nx + this.vz * nz;
      if (vn < 0) {
        const e = 0.25;
        this.vx -= (1 + e) * vn * nx; this.vz -= (1 + e) * vn * nz;
        this.vx *= 0.92; this.vz *= 0.92;
        // spin from off-center impact
        const fx = Math.sin(this.h), fz = Math.cos(this.h);
        const side = (fx * nz - fz * nx);
        this.yawRate += side * Math.min(3, -vn * 0.08) * (Math.random() < 0.5 ? 1 : -1) * 0.3;
        const imp = -vn;
        if (imp > 4) {
          this.damage((imp - 4) * 18, 'crash');
          if (G.time - this.lastHit > 0.25) {
            this.lastHit = G.time;
            G.fx && G.fx.sparks(this.x - nx * this.t.L * 0.4, this.y + 0.5, this.z - nz * this.t.L * 0.4, Math.min(30, imp * 2));
            G.audio && G.audio.crash(Math.min(1, imp / 25), this.x, this.z);
            G.events.emit('vehicleCrash', this, imp);
          }
        }
      }
    }
  }

  damage(amount, cause = 'damage', attacker = null) {
    if (this.dead) return;
    this.hp -= amount;
    if (attacker) this.lastAttacker = attacker;
    if (this.hp <= 0 && !this.burning) {
      this.burning = 4.5; // seconds until boom
      this.hp = 0;
    }
    G.events.emit('vehicleDamaged', this, amount, cause, attacker);
  }

  damageEffects(dt) {
    this.smokeT -= dt;
    const frac = this.hp / this.maxHp;
    if (frac < 0.4 && this.smokeT <= 0 && G.fx) {
      this.smokeT = frac < 0.15 ? 0.05 : 0.12;
      const fx = Math.sin(this.h), fz = Math.cos(this.h);
      const hx = this.x + fx * this.t.L * 0.35, hz = this.z + fz * this.t.L * 0.35;
      const smokeH = this.t.body ? this.t.body[1][1] : 0.6;
      G.fx.smoke(hx, this.y + smokeH + 0.2, hz, frac < 0.15 ? 0.15 : 0.6, 1);
      if (this.burning > 0) G.fx.fire(hx, this.y + 0.9, hz);
    }
    if (this.burning > 0) {
      this.burning -= dt;
      if (this.burning <= 0) this.explode();
    }
  }

  explode() {
    if (this.dead) return;
    this.dead = true; this.hp = 0; this.burning = 0;
    this.bodyMesh.material = burntMat; if (this.roof.material) this.roof.material = burntMat;
    if (this.headMesh.isMesh) this.headMesh.visible = false;
    if (this.tailMesh.isMesh) this.tailMesh.visible = false;
    this.glow.visible = false;
    this.vy = 7; this.grounded = false;
    this.yawRate = (Math.random() - 0.5) * 3;
    if (G.fx) G.fx.explosion(this.x, this.y + 1, this.z, 1.3);
    G.events.emit('vehicleExploded', this);
    this.deadTime = G.time;
  }

  syncMesh() {
    this.mesh.position.set(this.x, this.y, this.z);
    this.mesh.rotation.y = this.h;
    this.mesh.rotation.x = this.gPitch || 0;
    this.landBounce = Math.max(0, (this.landBounce || 0) - 0.02);
    this.body.rotation.x = this.pitch + (this.landBounce || 0) * 0.3;
    this.body.rotation.z = this.roll;
    this.body.position.y = -(this.landBounce || 0) * 0.4;
    this.obb.x = this.x; this.obb.z = this.z; this.obb.a = this.h;
  }

  dispose() {
    this.mesh.removeFromParent();
    if (this.tailMat && this.tailMat.dispose) this.tailMat.dispose();
    if (this.sirenR) { this.sirenR.dispose(); this.sirenB.dispose(); }
    if (this.glow && this.glow.material) this.glow.material.dispose();
  }
}

// ---------------- vehicle manager (car-car collisions, lifecycle) ----------------
export class VehicleSystem {
  constructor(scene) { this.scene = scene; this.list = []; }
  spawn(type, x, z, h, color, opts) {
    const v = new Vehicle(type, color, opts);
    v.place(x, z, h);
    this.scene.add(v.mesh);
    this.list.push(v);
    return v;
  }
  remove(v) {
    const i = this.list.indexOf(v);
    if (i >= 0) this.list.splice(i, 1);
    v.dispose();
    v.removed = true;
  }
  update(dt) {
    const L = this.list;
    for (const v of L) {
      if (v.ai && !v.dead) v.ai.update(dt);
      v.update(dt);
    }
    // pairwise collisions
    for (let a = 0; a < L.length; a++) {
      const A = L[a];
      for (let b = a + 1; b < L.length; b++) {
        const B = L[b];
        const dx = A.x - B.x, dz = A.z - B.z;
        if (dx * dx + dz * dz > 49) continue;
        if (Math.abs(A.y - B.y) > 2) continue;
        const s = satOBB(A.obb, B.obb);
        if (!s) continue;
        const mA = A.mass, mB = B.mass, tot = mA + mB;
        A.x += s.nx * s.depth * (mB / tot); A.z += s.nz * s.depth * (mB / tot);
        B.x -= s.nx * s.depth * (mA / tot); B.z -= s.nz * s.depth * (mA / tot);
        const vrel = (A.vx - B.vx) * s.nx + (A.vz - B.vz) * s.nz;
        if (vrel < 0) {
          const e = 0.3;
          const j = -(1 + e) * vrel / (1 / mA + 1 / mB);
          A.vx += j / mA * s.nx; A.vz += j / mA * s.nz;
          B.vx -= j / mB * s.nx; B.vz -= j / mB * s.nz;
          const imp = -vrel;
          A.yawRate += (Math.random() - 0.5) * imp * 0.05;
          B.yawRate += (Math.random() - 0.5) * imp * 0.05;
          if (imp > 3) {
            A.damage((imp - 3) * 14 * (mB / tot) * 2, 'crash', B.driver === 'player' ? 'player' : null);
            B.damage((imp - 3) * 14 * (mA / tot) * 2, 'crash', A.driver === 'player' ? 'player' : null);
            if (G.time - A.lastHit > 0.2) {
              A.lastHit = G.time;
              G.fx && G.fx.sparks((A.x + B.x) / 2, (A.y + B.y) / 2 + 0.6, (A.z + B.z) / 2, Math.min(25, imp * 2));
              G.audio && G.audio.crash(Math.min(1, imp / 20), A.x, A.z);
            }
            G.events.emit('carCollision', A, B, imp);
          }
        }
        A.syncMesh(); B.syncMesh();
      }
    }
    // explosions chain / cleanup of wrecks
    for (let k = L.length - 1; k >= 0; k--) {
      const v = L[k];
      if (v.dead && v.deadTime && G.time - v.deadTime > 40 && !v.persistent) {
        const p = G.player;
        if (!p || Math.hypot(p.x - v.x, p.z - v.z) > 60) this.remove(v);
      }
    }
  }
  nearest(x, z, maxD = 4, filter = () => true) {
    let best = null, bd = maxD * maxD;
    for (const v of this.list) {
      if (!filter(v)) continue;
      const d = (v.x - x) ** 2 + (v.z - z) ** 2;
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }
}
