// Procedural construction of Miami.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Water } from 'three/addons/objects/Water.js';
import {
  P, W, HALF, NX, NZ, SIDEWALK, CURB_H, CITY, BEACH, CZ, CAUSEWAY, ISLAND, ISLAND_END_X, WATER_Y,
  blockDistrict, DISTRICT, specialAt, SPECIAL, blockBounds, beachHeight, ramps, nodes, hasLights, lightPhase,
} from './layout.js';
import { rng, hash2 } from './util.js';
import { buildingMaterial, groundMaterial, stdMat, shared } from './materials.js';
import { StaticWorld } from './physics.js';
import { waterNormals, sandTexture, neonSignTexture, palmFrondTexture, tileTexture } from './textures.js';

const tmpColor = new THREE.Color();
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

const GLASS = [0x8db8cc, 0x7aaabb, 0xa0c8d8, 0x6a9aaf, 0xb0d0dd, 0x78b0b8, 0x9cc0cc, 0x88c0d4];
const MID = [0xf0e6d2, 0xe8dcc8, 0xf5eed8, 0xddd0b8, 0xeac8a0, 0xf2ece0, 0xd8e0e8, 0xe8d8c4, 0xf0dcc0];
const PASTEL = [0xffb3c7, 0xa0eee0, 0xcfc0ff, 0xffd8b0, 0xb0e0ff, 0xfff4d0, 0xffaabb, 0xc0f5c0, 0xf8c8ff, 0xffffff];
const HOUSE = [0xfaf4ea, 0xffe8cc, 0xe4f4f2, 0xf6dce8, 0xede8ff, 0xfffae0, 0xecdcc8];
const NEON = [[3.4, 1.0, 1.6], [3.2, 2.0, 0.6], [2.0, 1.2, 3.0], [3.6, 2.4, 1.0], [3.0, 0.8, 1.2], [2.6, 2.8, 3.0]];
const NEON_CSS = ['#ff5090', '#ffaa44', '#8866dd', '#ffcc44', '#ff6688', '#88ccff'];
const HOTEL_NAMES = ['SOLARA', 'CORAL', 'MARLIN', 'AZURE', 'LUNA', 'OASIS', 'TIDE', 'PALMAS', 'NOVA', 'BREEZE', 'LAGUNA', 'SIRENA', 'COSTA', 'ESTRELLA'];

export class World {
  constructor(scene) {
    this.scene = scene;
    this.statics = new StaticWorld();
    this.chunks = new Map(); // building geoms per chunk
    this.neonGeoms = [];
    this.lightSources = [];   // {x,y,z,color:THREE.Color,intensity,range}
    this.footprints = [];     // minimap rects {x0,z0,x1,z1,c}
    this.palms = [];          // {x,z,s,r}
    this.lamps = [];          // {x,z,a}
    this.signals = [];        // traffic signal heads {x,y,z,a,axis,node}
    this.benches = [];
    this.markers = {};        // named positions
    this.badgeSpots = [];
    this.pickupSpots = [];
    this.parkingSpots = [];   // {x,z,h}
    this.rampList = ramps;
    this.mansion = null;
    this.signMeshes = [];
    this.bldMat = buildingMaterial();
    this.groundMat = groundMaterial();
    this.neonMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.t = 0;
  }

  // ---------------- geometry helpers ----------------
  chunkOf(x, z) { return Math.floor(x / 270) + ',' + Math.floor(z / 270); }
  addGeom(g, color, facade, cx, cz) {
    g.deleteAttribute('uv');
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3), fac = new Float32Array(n * 4);
    tmpColor.setHex(color);
    for (let i = 0; i < n; i++) {
      col[i * 3] = tmpColor.r; col[i * 3 + 1] = tmpColor.g; col[i * 3 + 2] = tmpColor.b;
      fac[i * 4] = facade[0]; fac[i * 4 + 1] = facade[1]; fac[i * 4 + 2] = facade[2]; fac[i * 4 + 3] = facade[3];
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aFacade', new THREE.BufferAttribute(fac, 4));
    const k = this.chunkOf(cx, cz);
    let a = this.chunks.get(k); if (!a) this.chunks.set(k, (a = []));
    a.push(g);
  }
  box(cx, y0, cz, w, h, d, color, facade = [3.5, 3, 4, 0], collide = true, tag = 'building') {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(cx, y0 + h / 2, cz);
    this.addGeom(g, color, facade, cx, cz);
    if (collide) this.statics.addBox(cx - w / 2, cz - d / 2, cx + w / 2, cz + d / 2, y0, y0 + h, tag);
  }
  neonBox(cx, cy, cz, w, h, d, rgb) {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(cx, cy, cz);
    g.deleteAttribute('uv');
    const n = g.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = rgb[0]; col[i * 3 + 1] = rgb[1]; col[i * 3 + 2] = rgb[2]; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.neonGeoms.push(g);
  }
  roofPrism(cx, y0, cz, w, d, h, color, alongX) {
    // gable roof
    const hw = w / 2, hd = d / 2;
    let v;
    if (alongX) {
      v = [-hw, 0, -hd, hw, 0, -hd, hw, 0, hd, -hw, 0, hd, -hw, h, 0, hw, h, 0];
    } else {
      v = [-hw, 0, -hd, hw, 0, -hd, hw, 0, hd, -hw, 0, hd, 0, h, -hd, 0, h, hd];
    }
    const idx = alongX
      ? [0, 4, 1, 1, 4, 5, 2, 5, 3, 3, 5, 4, 3, 4, 0, 1, 5, 2]
      : [0, 4, 1, 3, 2, 5, 0, 3, 4, 3, 5, 4, 1, 4, 5, 1, 5, 2];
    // build non-indexed for flat normals
    const pos = [];
    for (const i of idx) pos.push(v[i * 3] + cx, v[i * 3 + 1] + y0, v[i * 3 + 2] + cz);
    let g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    // ensure outward normals (flip faces whose normal points inward)
    const p = g.attributes.position, nrm = g.attributes.normal;
    for (let f = 0; f < p.count; f += 3) {
      const mx = (p.getX(f) + p.getX(f + 1) + p.getX(f + 2)) / 3 - cx;
      const my = (p.getY(f) + p.getY(f + 1) + p.getY(f + 2)) / 3 - y0 - h * 0.3;
      const mz = (p.getZ(f) + p.getZ(f + 1) + p.getZ(f + 2)) / 3 - cz;
      if (nrm.getX(f) * mx + nrm.getY(f) * my + nrm.getZ(f) * mz < 0) {
        // swap vertex 1 and 2
        for (const arr of [p]) {
          const x = arr.getX(f + 1), y = arr.getY(f + 1), z = arr.getZ(f + 1);
          arr.setXYZ(f + 1, arr.getX(f + 2), arr.getY(f + 2), arr.getZ(f + 2));
          arr.setXYZ(f + 2, x, y, z);
        }
      }
    }
    g.computeVertexNormals();
    g.setIndex(null);
    // make indexed to match boxes for merging
    const n = p.count; const index = []; for (let i = 0; i < n; i++) index.push(i);
    g.setIndex(index);
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
    this.addGeom(g, color, [3, 3, 4, 0], cx, cz);
  }
  sign(text, color, x, y, z, a, w, h, vertical = false, sub = '') {
    const tex = neonSignTexture(text, color, vertical, sub);
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: 0xffffff });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(x, y, z); m.rotation.y = a;
    this.scene.add(m);
    this.signMeshes.push(m);
    tmpColor.set(color);
    this.lightSources.push({ x: x + Math.sin(a) * 2, y, z: z + Math.cos(a) * 2, color: tmpColor.clone(), intensity: 40, range: 22 });
    return m;
  }

  // ---------------- build ----------------
  async build(progress = () => {}) {
    const R = rng(1337);
    progress(0.05, '铺设道路…');
    this.buildGround();
    await nextFrame();
    progress(0.15, '建造街区…');
    for (let j = 0; j < NZ; j++) {
      for (let i = 0; i < NX; i++) this.buildBlock(i, j, R);
      if (j % 3 === 2) { progress(0.15 + 0.45 * j / NZ, '建造街区…'); await nextFrame(); }
    }
    this.buildPort(R);
    this.buildIsland(R);
    progress(0.62, '种植棕榈树…');
    await nextFrame();
    this.buildStreetFurniture(R);
    this.buildBeach(R);
    this.buildRamps();
    progress(0.75, '合并网格…');
    await nextFrame();
    this.finalizeMeshes();
    progress(0.85, '注入海水…');
    await nextFrame();
    this.buildWater();
    this.computeSpots(R);
  }

  buildGround() {
    const geoms = [];
    const plane = (x0, z0, x1, z1, y = 0) => {
      const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, Math.ceil((x1 - x0) / 60), Math.ceil((z1 - z0) / 60));
      g.rotateX(-Math.PI / 2);
      g.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
      geoms.push(g);
    };
    plane(CITY.x0, CITY.z0, CITY.x1, CITY.z1);
    plane(CAUSEWAY.x0, CAUSEWAY.z0, CAUSEWAY.x1, CAUSEWAY.z1, 0.0);
    plane(ISLAND.x0, ISLAND.z0, ISLAND.x1, ISLAND.z1);
    // raised block slabs (sidewalk + lot)
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
      const b = blockBounds(i, j);
      const g = new THREE.BoxGeometry(b.x1 - b.x0, CURB_H, b.z1 - b.z0, 1, 1, 1);
      g.translate((b.x0 + b.x1) / 2, CURB_H / 2, (b.z0 + b.z1) / 2);
      geoms.push(g);
    }
    const merged = mergeGeometries(geoms.map((g) => { g.deleteAttribute('uv'); return g.index ? g : g; }));
    const mesh = new THREE.Mesh(merged, this.groundMat);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.ground = mesh;

    // sea walls
    const wallMat = stdMat(0x8a8780, 0.9);
    const walls = [];
    const wall = (x0, z0, x1, z1) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const g = new THREE.BoxGeometry(len, 5, 0.6);
      g.rotateY(-Math.atan2(z1 - z0, x1 - x0));
      g.translate((x0 + x1) / 2, -2.5 + 0.01, (z0 + z1) / 2);
      walls.push(g);
    };
    wall(CITY.x0, CITY.z0, CITY.x1, CITY.z0);
    wall(CITY.x0, CITY.z1, CITY.x1, CITY.z1);
    wall(CITY.x0, CITY.z0, CITY.x0, CITY.z1);
    wall(CAUSEWAY.x0 + BEACH.x1 - BEACH.x0 - 20, CAUSEWAY.z0, CAUSEWAY.x1, CAUSEWAY.z0);
    wall(CAUSEWAY.x0 + BEACH.x1 - BEACH.x0 - 20, CAUSEWAY.z1, CAUSEWAY.x1, CAUSEWAY.z1);
    wall(ISLAND.x0, ISLAND.z0, ISLAND.x1, ISLAND.z0);
    wall(ISLAND.x0, ISLAND.z1, ISLAND.x1, ISLAND.z1);
    wall(ISLAND.x0, ISLAND.z0, ISLAND.x0, CAUSEWAY.z0);
    wall(ISLAND.x0, CAUSEWAY.z1, ISLAND.x0, ISLAND.z1);
    wall(ISLAND.x1, ISLAND.z0, ISLAND.x1, ISLAND.z1);
    const wm = new THREE.Mesh(mergeGeometries(walls), wallMat);
    this.scene.add(wm);

    // causeway railings
    const rail = [];
    for (const zz of [CAUSEWAY.z0 + 0.3, CAUSEWAY.z1 - 0.3]) {
      const g = new THREE.BoxGeometry(CAUSEWAY.x1 - CAUSEWAY.x0, 0.9, 0.35);
      g.translate((CAUSEWAY.x0 + CAUSEWAY.x1) / 2, 0.45, zz);
      rail.push(g);
      this.statics.addBox(CAUSEWAY.x0 + 30, zz - 0.25, CAUSEWAY.x1, zz + 0.25, 0, 1.0, 'rail');
    }
    this.scene.add(new THREE.Mesh(mergeGeometries(rail), stdMat(0xe8e4dc, 0.6)));

    // invisible boundaries at sea walls are not needed: cars that fall in water sink.
  }

  // ---------------- blocks ----------------
  buildBlock(i, j, R) {
    const d = blockDistrict(i, j);
    const sp = specialAt(i, j);
    const b = blockBounds(i, j);
    const L = { x0: b.x0 + SIDEWALK + 1, x1: b.x1 - SIDEWALK - 1, z0: b.z0 + SIDEWALK + 1, z1: b.z1 - SIDEWALK - 1 };
    const cx = (L.x0 + L.x1) / 2, cz = (L.z0 + L.z1) / 2;
    const door = { x: (b.x0 + b.x1) / 2, z: b.z1 - 2.2 };

    if (sp) { this.buildSpecial(sp, i, j, L, door, R); return; }
    switch (d) {
      case DISTRICT.DOWNTOWN: this.buildDowntown(L, R, i, j); break;
      case DISTRICT.MIDTOWN: this.buildMidtown(L, R, i, j); break;
      case DISTRICT.RESIDENTIAL: this.buildResidential(L, R, i, j); break;
      case DISTRICT.DECO: this.buildDeco(L, R, i, j); break;
      case DISTRICT.PORT: this.buildPortBlock(L, R, i, j); break;
      case DISTRICT.PARK: this.buildPark(L, R, i, j); break;
    }
    void cx; void cz;
  }

  tower(x, z, w, d, h, R, color, style = 0) {
    const seed = R() * 100;
    const fac = style === 0 ? [3.8, 2.4, 0, seed] : [3.6, 3.0, 1, seed];
    // podium
    const ph = 6 + Math.floor(R() * 2) * 4;
    this.box(x, CURB_H, z, w + 6, ph, d + 6, style === 0 ? 0xbdb6aa : color, [ph, 4.5, 1, seed]);
    let y = CURB_H + ph, cw = w, cd = d, rest = h - ph;
    const tiers = 1 + Math.floor(R() * 3);
    for (let t = 0; t < tiers; t++) {
      const th = t === tiers - 1 ? rest : rest * (0.45 + R() * 0.25);
      this.box(x, y, z, cw, th, cd, color, fac);
      y += th; rest -= th;
      // ledge
      this.box(x, y, z, cw + 0.8, 0.6, cd + 0.8, 0xd8d8d8, [3, 3, 4, 0], false);
      y += 0.6;
      cw *= 0.72 + R() * 0.12; cd *= 0.72 + R() * 0.12;
    }
    // crown
    if (R() < 0.6) {
      this.box(x, y, z, cw * 0.6, 4, cd * 0.6, 0x9aa0a6, [3, 3, 4, 0], false);
      this.box(x, y + 4, z, 0.4, 14 + R() * 10, 0.4, 0xcccccc, [3, 3, 4, 0], false);
      this.neonBox(x, y + 4 + 15, z, 0.8, 0.8, 0.8, [6, 0.2, 0.1]);
    } else {
      // neon crown outline
      const c = NEON[Math.floor(R() * NEON.length)];
      const hw = cw / 2 + 0.45, hd = cd / 2 + 0.45, ny = y - 0.3;
      this.neonBox(x, ny, z - hd, cw + 0.9, 0.25, 0.12, c);
      this.neonBox(x, ny, z + hd, cw + 0.9, 0.25, 0.12, c);
      this.neonBox(x - hw, ny, z, 0.12, 0.25, cd + 0.9, c);
      this.neonBox(x + hw, ny, z, 0.12, 0.25, cd + 0.9, c);
      this.lightSources.push({ x, y: ny, z, color: new THREE.Color(c[0], c[1], c[2]).multiplyScalar(0.3), intensity: 0, range: 0, sky: true });
    }
    this.footprints.push({ x0: x - w / 2 - 3, z0: z - d / 2 - 3, x1: x + w / 2 + 3, z1: z + d / 2 + 3, c: '#3a4a5c', h });
  }

  buildDowntown(L, R, i, j) {
    const cx = (L.x0 + L.x1) / 2, cz = (L.z0 + L.z1) / 2;
    if (R() < 0.45) {
      const h = 90 + R() * 110;
      this.tower(cx, cz, 30 + R() * 8, 30 + R() * 8, h, R, GLASS[Math.floor(R() * GLASS.length)], 0);
    } else {
      const q = (L.x1 - L.x0) / 4;
      for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        if (R() < 0.15) continue;
        const h = 40 + R() * 80;
        const st = R() < 0.7 ? 0 : 1;
        this.tower(cx + ox * q, cz + oz * q, 18 + R() * 4, 18 + R() * 4, h, R, st === 0 ? GLASS[Math.floor(R() * GLASS.length)] : MID[Math.floor(R() * MID.length)], st);
      }
    }
    void i; void j;
  }

  midrise(x, z, w, d, h, R, color) {
    const seed = R() * 100;
    this.box(x, CURB_H, z, w, h, d, color, [3.4, 3.1, 1, seed]);
    // cornice
    this.box(x, CURB_H + h, z, w + 0.6, 0.7, d + 0.6, 0xe8e2d4, [3, 3, 4, 0], false);
    // rooftop stuff
    const n = 1 + Math.floor(R() * 3);
    for (let k = 0; k < n; k++) {
      this.box(x + (R() - 0.5) * w * 0.6, CURB_H + h + 0.7, z + (R() - 0.5) * d * 0.6, 2 + R() * 2, 1.5 + R(), 2 + R() * 2, 0x9a9a9a, [3, 3, 4, 0], false);
    }
    if (R() < 0.35) { // water tank
      this.box(x + w * 0.25, CURB_H + h + 0.7, z - d * 0.2, 3, 4, 3, 0x7a5a40, [3, 3, 4, 0], false);
    }
    this.footprints.push({ x0: x - w / 2, z0: z - d / 2, x1: x + w / 2, z1: z + d / 2, c: '#4a4652', h });
  }

  buildMidtown(L, R, i, j) {
    const q = (L.x1 - L.x0) / 4;
    const cx = (L.x0 + L.x1) / 2, cz = (L.z0 + L.z1) / 2;
    for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      if (R() < 0.12) { // small parking / plaza: palms
        this.palms.push({ x: cx + ox * q, z: cz + oz * q, s: 0.9 + R() * 0.3, r: R() * 6 });
        this.parkingSpots.push({ x: cx + ox * q, z: cz + oz * q + 4, h: 0 });
        continue;
      }
      const w = 22 + R() * 7, d = 22 + R() * 7, h = 10 + R() * 34;
      this.midrise(cx + ox * q, cz + oz * q, w, d, h, R, MID[Math.floor(R() * MID.length)]);
      // occasional neon shop sign
      if (R() < 0.35) {
        const c = Math.floor(R() * NEON.length);
        const sx = cx + ox * q, sz = cz + oz * q + oz * (d / 2 + 0.15);
        this.neonBox(sx, CURB_H + 3.8, sz, w * 0.6, 0.18, 0.12, NEON[c]);
      }
    }
    void i; void j;
  }

  buildResidential(L, R, i, j) {
    const n = 3, s = (L.x1 - L.x0) / n;
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
      const x = L.x0 + s * (a + 0.5), z = L.z0 + s * (b + 0.5);
      if (a === 1 && b === 1) { // backyard pool / palms
        this.palms.push({ x: x - 3, z, s: 1 + R() * 0.3, r: R() * 6 });
        this.palms.push({ x: x + 4, z: z + 3, s: 0.9 + R() * 0.3, r: R() * 6 });
        this.pool(x, z + 1, 9, 5);
        continue;
      }
      if (R() < 0.15) {
        // small apartment
        this.midrise(x, z, 15, 15, 9 + R() * 8, R, PASTEL[Math.floor(R() * PASTEL.length)]);
        continue;
      }
      const w = 10 + R() * 4, d = 9 + R() * 3, floors = R() < 0.5 ? 1 : 2;
      const h = floors * 3.3;
      const col = HOUSE[Math.floor(R() * HOUSE.length)];
      this.box(x, CURB_H, z, w, h, d, col, [3.3, 4.2, 2, R() * 100]);
      this.roofPrism(x, CURB_H + h, z, w + 1, d + 1, 2.2, R() < 0.7 ? 0xb5553a : 0x6b6b72, R() < 0.5);
      this.footprints.push({ x0: x - w / 2, z0: z - d / 2, x1: x + w / 2, z1: z + d / 2, c: '#6b5650', h });
      if (R() < 0.6) this.palms.push({ x: x + (R() < 0.5 ? -1 : 1) * (w / 2 + 2), z: z + (d / 2 + 2.5), s: 0.8 + R() * 0.4, r: R() * 6 });
    }
    void i; void j;
  }

  pool(x, z, w, d) {
    const g = new THREE.BoxGeometry(w + 1, 0.12, d + 1); g.translate(x, CURB_H + 0.06, z);
    this.addGeom(g, 0xeeeeee, [3, 3, 4, 0], x, z);
    const water = new THREE.Mesh(new THREE.PlaneGeometry(w, d), stdMat(0x22c8e8, 0.05, 0.1, { emissive: 0x0a4a5a, emissiveIntensity: 0.6 }));
    water.rotation.x = -Math.PI / 2; water.position.set(x, CURB_H + 0.14, z);
    this.scene.add(water);
  }

  decoHotel(x, z, w, d, h, facing, R, nameIdx) {
    const col = PASTEL[Math.floor(R() * PASTEL.length)];
    const seed = R() * 100;
    const floorH = 3.3;
    this.box(x, CURB_H, z, w, h, d, col, [floorH, 3.0, 1, seed]);
    // eyebrow ledges
    const floors = Math.floor(h / floorH);
    for (let f = 1; f < floors; f++) {
      if (f % 2 === 0 && floors > 4) continue;
      this.box(x, CURB_H + f * floorH - 0.1, z, w + 1.0, 0.22, d + 1.0, 0xffffff, [3, 3, 4, 0], false);
    }
    // roof parapet with stepped top
    this.box(x, CURB_H + h, z, w + 0.4, 1.2, d + 0.4, 0xffffff, [3, 3, 4, 0], false);
    const fx = Math.sin(facing), fz = Math.cos(facing);
    // central fin
    const finW = 3, finH = h + 7 + R() * 6;
    const fxp = x + fx * (d / 2 + 0.8), fzp = z + fz * (d / 2 + 0.8);
    const alongX = Math.abs(fz) > 0.5;
    this.box(fxp, CURB_H, fzp, alongX ? finW : 1.6, finH, alongX ? 1.6 : finW, 0xffffff, [3, 3, 4, 0], false);
    // neon
    const ci = Math.floor(R() * NEON.length);
    const c = NEON[ci];
    const hw = w / 2 + 0.25, hd = d / 2 + 0.25, ny = CURB_H + h + 1.25;
    this.neonBox(x, ny, z - hd, w + 0.5, 0.18, 0.12, c);
    this.neonBox(x, ny, z + hd, w + 0.5, 0.18, 0.12, c);
    this.neonBox(x - hw, ny, z, 0.12, 0.18, d + 0.5, c);
    this.neonBox(x + hw, ny, z, 0.12, 0.18, d + 0.5, c);
    // ground floor neon strip
    this.neonBox(x + fx * (d / 2 + 0.55), CURB_H + 3.2, z + fz * (d / 2 + 0.55), alongX ? w : 0.1, 0.12, alongX ? 0.1 : w, NEON[(ci + 2) % NEON.length]);
    // vertical sign on the fin
    const name = HOTEL_NAMES[nameIdx % HOTEL_NAMES.length];
    const sx = x + fx * (d / 2 + 1.65), sz = z + fz * (d / 2 + 1.65);
    this.sign(name, NEON_CSS[ci], sx, CURB_H + finH * 0.55, sz, facing, 2.6, Math.min(finH * 0.7, name.length * 2.6), true);
    this.footprints.push({ x0: x - w / 2, z0: z - d / 2, x1: x + w / 2, z1: z + d / 2, c: '#7a5a6a', h });
  }

  buildDeco(L, R, i, j) {
    const q = (L.x1 - L.x0) / 4;
    const cx = (L.x0 + L.x1) / 2, cz = (L.z0 + L.z1) / 2;
    let k = i * 7 + j * 3;
    for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const w = 22 + R() * 5, d = 20 + R() * 5, h = 10 + Math.floor(R() * 5) * 3.3;
      // face outward along x (east for right column, west for left)
      const facing = ox > 0 ? Math.PI / 2 : -Math.PI / 2;
      this.decoHotel(cx + ox * q, cz + oz * q, d, w, h, facing, R, k++);
      this.palms.push({ x: cx + ox * (q * 2 + 1), z: cz + oz * q - 7, s: 1.1 + R() * 0.3, r: R() * 6 });
      this.palms.push({ x: cx + ox * (q * 2 + 1), z: cz + oz * q + 7, s: 1.0 + R() * 0.3, r: R() * 6 });
    }
  }

  buildPortBlock(L, R, i, j) {
    const cx = (L.x0 + L.x1) / 2, cz = (L.z0 + L.z1) / 2;
    if (j % 3 === 1) {
      this.containers(L, R);
      return;
    }
    // warehouses
    const w = L.x1 - L.x0 - 6, d = 24 + R() * 6;
    for (const oz of [-1, 1]) {
      const col = [0x8a9aa8, 0x7a6a5a, 0x5a7a8a, 0xa88a6a, 0x9a9a9a][Math.floor(R() * 5)];
      const z = cz + oz * (d / 2 + 2);
      const h = 9 + R() * 5;
      this.box(cx, CURB_H, z, w, h, d, col, [4, 4, 3, R() * 50]);
      this.roofPrism(cx, CURB_H + h, z, w + 0.6, d + 0.6, 2.4, 0x6a6a6a, true);
      // roll-up doors
      for (let k = -2; k <= 2; k++) this.box(cx + k * 10, CURB_H, z + oz * (d / 2 + 0.05), 6, 5, 0.2, 0x555b60, [3, 3, 3, 0], false);
      this.footprints.push({ x0: cx - w / 2, z0: z - d / 2, x1: cx + w / 2, z1: z + d / 2, c: '#5a5a5a', h });
    }
    void i;
  }

  containers(L, R) {
    const cols = [0xc0392b, 0x2471a3, 0x1e8449, 0xd68910, 0x7d3c98, 0xaab7b8, 0xb9770e, 0x117a65];
    const rows = Math.floor((L.z1 - L.z0) / 7);
    for (let r = 0; r < rows; r++) {
      const z = L.z0 + 4 + r * 7;
      if (r === Math.floor(rows / 2)) continue; // aisle
      for (let c = 0; c < 4; c++) {
        if (R() < 0.18) continue;
        const x = L.x0 + 8 + c * 15;
        const stack = 1 + Math.floor(R() * 3);
        for (let s = 0; s < stack; s++) {
          this.box(x, CURB_H + s * 2.6, z, 12, 2.6, 2.45, cols[Math.floor(R() * cols.length)], [3, 3, 5, 0], s === 0, 'container');
        }
        this.statics.addBox(x - 6, z - 1.22, x + 6, z + 1.22, 0, CURB_H + stack * 2.6, 'container');
        this.footprints.push({ x0: x - 6, z0: z - 1.2, x1: x + 6, z1: z + 1.2, c: '#7a4a3a', h: stack * 2.6 });
      }
    }
  }

  buildPort(R) {
    // dock pad west of x=-HALF: gantry cranes along water edge
    const x = CITY.x0 + 9;
    for (let k = 0; k < 4; k++) {
      const z = 1.5 * P + k * 3 * P;
      const col = k % 2 ? 0xd35400 : 0xe8c547;
      for (const dz of [-7, 7]) {
        this.box(x - 6, 0, z + dz, 1.2, 34, 1.2, col, [3, 3, 4, 0], true, 'crane');
        this.box(x + 6, 0, z + dz, 1.2, 34, 1.2, col, [3, 3, 4, 0], true, 'crane');
      }
      this.box(x, 34, z - 7, 14, 1.6, 1.4, col, [3, 3, 4, 0], false);
      this.box(x, 34, z + 7, 14, 1.6, 1.4, col, [3, 3, 4, 0], false);
      this.box(x - 14, 36, z, 58, 2.2, 3, col, [3, 3, 4, 0], false); // boom over water
      this.box(x, 37, z, 10, 5, 6, 0xeeeeee, [3, 3, 4, 0], false); // cab
      this.neonBox(x - 42, 37.4, z, 0.6, 0.6, 0.6, [6, 0.2, 0.1]);
      this.footprints.push({ x0: x - 7, z0: z - 8, x1: x + 7, z1: z + 8, c: '#8a6a2a', h: 34 });
    }
    // bollards & cargo ship silhouette
    const ship = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(30, 10, 160), stdMat(0x2c3e50, 0.6, 0.2));
    hull.position.y = -1; ship.add(hull);
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(24, 12, 14), stdMat(0xeeeeee, 0.6));
    bridge.position.set(0, 10, -62); ship.add(bridge);
    const cols = [0xc0392b, 0x2471a3, 0x1e8449, 0xd68910];
    for (let k = 0; k < 18; k++) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(24, 2.6 * (1 + (k % 3)), 12), stdMat(cols[k % 4], 0.7, 0.2));
      c.position.set(0, 4 + 1.3 * (1 + (k % 3)), -42 + k * 6.5);
      if (k % 2 === 0) ship.add(c);
    }
    ship.position.set(CITY.x0 - 30, 0, 5 * P);
    ship.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.scene.add(ship);
    this.statics.addBox(CITY.x0 - 45, 5 * P - 80, CITY.x0 - 15, 5 * P + 80, -10, 20, 'ship');
    this.markers.port = { x: P / 2, z: 4 * P + P / 2 };
    this.markers.portYard = { x: P / 2, z: 4 * P + P / 2 };
  }

  buildPark(L, R, i, j) {
    const cx = (L.x0 + L.x1) / 2, cz = (L.z0 + L.z1) / 2;
    for (let k = 0; k < 18; k++) {
      const a = (k / 18) * Math.PI * 2;
      const r = 18 + (k % 2) * 8;
      this.palms.push({ x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r, s: 0.9 + R() * 0.5, r: R() * 6 });
    }
    // fountain
    const f = new THREE.Mesh(new THREE.CylinderGeometry(5, 5.4, 0.8, 32), stdMat(0xe6dccb, 0.6));
    f.position.set(cx, CURB_H + 0.4, cz); f.receiveShadow = true; this.scene.add(f);
    const fw = new THREE.Mesh(new THREE.CircleGeometry(4.6, 32), stdMat(0x3fb8d8, 0.05, 0.2, { emissive: 0x0a3a4a, emissiveIntensity: 0.5 }));
    fw.rotation.x = -Math.PI / 2; fw.position.set(cx, CURB_H + 0.82, cz); this.scene.add(fw);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 3, 16), stdMat(0xe6dccb, 0.6));
    col.position.set(cx, CURB_H + 2, cz); this.scene.add(col);
    this.statics.addCircle(cx, cz, 5.2, 1.0, 'fountain');
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + 0.2;
      this.benches.push({ x: cx + Math.cos(a) * 11, z: cz + Math.sin(a) * 11, a: -a + Math.PI / 2 });
    }
    void i; void j;
  }

  buildSpecial(sp, i, j, L, door, R) {
    const cx = (L.x0 + L.x1) / 2, cz = (L.z0 + L.z1) / 2;
    const backZ = L.z0 + 16;
    const info = SPECIAL[sp];
    this.markers[sp] = { x: door.x, z: door.z, name: info.name };
    switch (sp) {
      case 'safehouse': {
        this.box(cx, CURB_H, backZ + 4, 30, 7, 20, 0xf4f4f0, [3.4, 3.6, 2, 7]);
        this.box(cx + 6, CURB_H + 7, backZ + 2, 16, 4, 14, 0xf4f4f0, [3.4, 3.6, 0, 8]);
        this.box(cx, CURB_H + 7, backZ + 4, 31, 0.4, 21, 0x333333, [3, 3, 4, 0], false);
        this.neonBox(cx, CURB_H + 6.9, backZ + 14.3, 30, 0.12, 0.12, NEON[1]);
        this.pool(cx - 6, cz + 10, 12, 6);
        this.palms.push({ x: cx + 12, z: cz + 12, s: 1.2, r: 1 }, { x: cx - 16, z: cz + 14, s: 1.1, r: 2 });
        this.footprints.push({ x0: cx - 15, z0: backZ - 6, x1: cx + 15, z1: backZ + 14, c: '#4a8a8a', h: 7 });
        this.markers.safehouseCar = { x: door.x + 10, z: door.z - 8, h: Math.PI };
        break;
      }
      case 'garage': {
        this.box(cx, CURB_H, backZ + 2, 46, 9, 24, 0x6a5a8a, [4.5, 4, 3, 3]);
        this.roofPrism(cx, CURB_H + 9, backZ + 2, 46.6, 24.6, 2, 0x555555, true);
        this.sign("SAL'S", '#ffb02e', cx, CURB_H + 7, backZ + 14.2, 0, 12, 3.6, false, 'AUTO · PAINT');
        for (let k = -1; k <= 1; k++) this.box(cx + k * 14, CURB_H, backZ + 14.1, 8, 5.5, 0.2, 0x333840, [3, 3, 3, 0], false);
        this.footprints.push({ x0: cx - 23, z0: backZ - 10, x1: cx + 23, z1: backZ + 14, c: '#7a5aaa', h: 9 });
        this.markers.garage = { x: cx, z: cz + 14, name: info.name };
        this.markers.garageCar = { x: cx - 12, z: cz + 14, h: Math.PI };
        break;
      }
      case 'gunshop': {
        this.midrise(cx, backZ + 6, 40, 26, 12, R, 0x5a4a4a);
        this.sign('GUNS', '#ff3355', cx, CURB_H + 6, backZ + 19.2, 0, 10, 3.2, false, '烈焰枪械');
        this.markers.gunshop = { x: cx, z: backZ + 22, name: info.name };
        break;
      }
      case 'hospital': {
        this.midrise(cx, backZ + 8, 48, 30, 22, R, 0xf2f2f2);
        this.neonBox(cx, CURB_H + 16, backZ + 23.2, 1.2, 6, 0.2, [4, 0.2, 0.2]);
        this.neonBox(cx, CURB_H + 16, backZ + 23.2, 6, 1.2, 0.2, [4, 0.2, 0.2]);
        this.markers.hospital = { x: cx, z: backZ + 26, name: info.name };
        break;
      }
      case 'police': {
        this.midrise(cx, backZ + 4, 46, 22, 14, R, 0x3a4a6a);
        this.sign('POLICE', '#2ef2ff', cx, CURB_H + 10, backZ + 15.2, 0, 14, 3.2, false, '迈阿密警局');
        this.markers.police = { x: cx, z: backZ + 18, name: info.name };
        for (let k = 0; k < 4; k++) this.parkingSpots.push({ x: cx - 18 + k * 8, z: cz + 16, h: Math.PI, police: true });
        this.markers.policeLot = { x: cx, z: cz + 16 };
        break;
      }
      case 'park': case 'park2':
        this.buildPark(L, R, i, j);
        delete this.markers[sp];
        break;
      case 'plaza': {
        // civic plaza with abstract sculpture
        const base = new THREE.Mesh(new THREE.CylinderGeometry(6, 6.5, 1, 6), stdMat(0xd8d0c0, 0.5));
        base.position.set(cx, CURB_H + 0.5, cz); this.scene.add(base);
        const sculpt = new THREE.Mesh(new THREE.TorusKnotGeometry(2.4, 0.5, 120, 16), stdMat(0xd4af37, 0.18, 1));
        sculpt.position.set(cx, CURB_H + 5, cz); sculpt.castShadow = true; this.scene.add(sculpt);
        this.statics.addCircle(cx, cz, 6.3, 8, 'monument');
        for (let k = 0; k < 12; k++) {
          const a = (k / 12) * Math.PI * 2;
          this.palms.push({ x: cx + Math.cos(a) * 24, z: cz + Math.sin(a) * 24, s: 1.1, r: k });
        }
        this.box(cx, CURB_H, L.z0 + 6, 50, 14, 10, 0xe9e1d0, [4, 3, 1, 9]);
        delete this.markers[sp];
        this.markers.plaza = { x: cx, z: cz };
        break;
      }
    }
  }

  // ---------------- island ----------------
  buildIsland(R) {
    const mx = ISLAND_END_X + 50, mz = CZ;
    this.markers.mansion = { x: mx - 30, z: mz };
    this.markers.islandEnd = { x: ISLAND_END_X, z: CZ };
    // mansion: modernist stacked boxes
    this.box(mx, 0, mz, 34, 7, 46, 0xf7f7f2, [3.5, 3.0, 0, 51]);
    this.box(mx + 4, 7, mz - 4, 28, 6, 34, 0xf7f7f2, [3.5, 3.0, 0, 52]);
    this.box(mx + 4, 13, mz - 4, 30, 0.6, 36, 0x222222, [3, 3, 4, 0], false);
    this.neonBox(mx - 13, 6.9, mz, 0.12, 0.12, 46, NEON[2]);
    this.neonBox(mx - 10.2, 12.9, mz - 4, 0.12, 0.12, 34, NEON[0]);
    this.pool(mx - 22, mz + 24, 10, 16);
    this.footprints.push({ x0: mx - 17, z0: mz - 23, x1: mx + 17, z1: mz + 23, c: '#aaaaaa', h: 13 });
    // walls around estate with gate gap
    const wallC = 0xe8e0d0;
    this.box(mx + 10, 0, mz - 60, 90, 2.4, 1, wallC, [3, 3, 4, 0]);
    this.box(mx + 10, 0, mz + 60, 90, 2.4, 1, wallC, [3, 3, 4, 0]);
    this.box(mx + 55, 0, mz, 1, 2.4, 120, wallC, [3, 3, 4, 0]);
    this.box(mx - 35, 0, mz - 37, 1, 2.4, 46, wallC, [3, 3, 4, 0]);
    this.box(mx - 35, 0, mz + 37, 1, 2.4, 46, wallC, [3, 3, 4, 0]);
    // other villas
    for (const [vx, vz] of [[ISLAND.x0 + 40, ISLAND.z0 + 40], [ISLAND.x0 + 40, ISLAND.z1 - 40], [ISLAND.x0 + 100, ISLAND.z0 + 30], [ISLAND.x0 + 100, ISLAND.z1 - 30]]) {
      this.box(vx, 0, vz, 22, 6, 16, PASTEL[Math.floor(R() * PASTEL.length)], [3.3, 3.6, 2, R() * 50]);
      this.roofPrism(vx, 6, vz, 23, 17, 2.5, 0xb5553a, true);
      this.footprints.push({ x0: vx - 11, z0: vz - 8, x1: vx + 11, z1: vz + 8, c: '#7a6a5a', h: 6 });
      this.palms.push({ x: vx + 14, z: vz, s: 1.2, r: R() * 6 }, { x: vx - 14, z: vz + 4, s: 1.0, r: R() * 6 });
    }
    for (let k = 0; k < 30; k++) {
      const t = k / 30;
      this.palms.push({ x: ISLAND.x0 + 6 + t * (ISLAND.x1 - ISLAND.x0 - 12), z: ISLAND.z0 + 5, s: 1 + R() * 0.3, r: R() * 6 });
      this.palms.push({ x: ISLAND.x0 + 6 + t * (ISLAND.x1 - ISLAND.x0 - 12), z: ISLAND.z1 - 5, s: 1 + R() * 0.3, r: R() * 6 });
    }
    for (let k = 0; k < 10; k++) {
      this.palms.push({ x: CAUSEWAY.x0 + 110 + k * 18, z: CAUSEWAY.z0 - 0.0, s: 0.0, r: 0 }); // placeholder skip
    }
    this.palms = this.palms.filter((p) => p.s > 0);
    // yacht at pier east of island
    const yacht = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(9, 3.4, 34), stdMat(0xffffff, 0.25, 0.1));
    hull.position.y = 0.5; yacht.add(hull);
    const bow = new THREE.Mesh(new THREE.ConeGeometry(4.5, 10, 4, 1), stdMat(0xffffff, 0.25, 0.1));
    bow.rotation.x = Math.PI / 2; bow.rotation.y = Math.PI / 4; bow.scale.set(1, 1, 0.75); bow.position.set(0, 0.5, 21); yacht.add(bow);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(7, 2.6, 16), stdMat(0x1a2a3a, 0.05, 0.8));
    cabin.position.set(0, 3.5, -2); yacht.add(cabin);
    const top = new THREE.Mesh(new THREE.BoxGeometry(6, 2, 9), stdMat(0xffffff, 0.3));
    top.position.set(0, 5.8, -4); yacht.add(top);
    yacht.position.set(ISLAND.x1 + 22, WATER_Y + 0.3, CZ + 40);
    yacht.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.scene.add(yacht);
    this.yacht = yacht;
    // pier
    this.box(ISLAND.x1 + 8, -0.6, CZ + 40, 16, 0.6, 4, 0x8a6a4a, [3, 3, 4, 0], false);
  }

  // ---------------- beach ----------------
  buildBeach(R) {
    const w = BEACH.x1 - BEACH.x0, d = BEACH.z1 - BEACH.z0;
    const g = new THREE.PlaneGeometry(w, d, 40, 10);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position, uv = g.attributes.uv;
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k) + BEACH.x0 + w / 2, z = pos.getZ(k) + BEACH.z0 + d / 2;
      pos.setXYZ(k, x, beachHeight(x), z);
      uv.setXY(k, x / 10, z / 10);
    }
    g.computeVertexNormals();
    const sand = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: sandTexture(), roughness: 0.95 }));
    sand.receiveShadow = true;
    this.scene.add(sand);
    // promenade tiles
    const prom = new THREE.PlaneGeometry(10, d);
    prom.rotateX(-Math.PI / 2);
    const tex = tileTexture(); tex.repeat.set(2.5, d / 4);
    const pm = new THREE.Mesh(prom, new THREE.MeshStandardMaterial({ map: tex, color: 0xfff0e8, roughness: 0.7 }));
    pm.position.set(BEACH.x0 + 5, 0.03, BEACH.z0 + d / 2);
    pm.receiveShadow = true;
    this.scene.add(pm);
    // low wall along promenade (with gaps)
    for (let z = BEACH.z0 + 20; z < BEACH.z1 - 20; z += 60) {
      if (Math.abs(z - CZ) < 30) continue;
      this.box(BEACH.x0 + 10.5, 0, z + 20, 0.5, 0.7, 36, 0xf2ebe0, [3, 3, 4, 0], true, 'wall');
    }
    // palms along promenade
    for (let z = BEACH.z0 + 10; z < BEACH.z1; z += 13) {
      if (Math.abs(z - CZ) < 16) continue;
      this.palms.push({ x: BEACH.x0 + 7.5, z, s: 1.15 + R() * 0.35, r: R() * 6 });
      if (R() < 0.5) this.palms.push({ x: BEACH.x0 + 24 + R() * 20, z: z + R() * 6, s: 1 + R() * 0.4, r: R() * 6 });
    }
    // umbrellas
    const umbs = [];
    const umbCols = [0xff5a8a, 0x2ec4d6, 0xffd166, 0xffffff, 0x8a5aff];
    const umbMeshes = umbCols.map((c) => new THREE.InstancedMesh(new THREE.ConeGeometry(1.8, 0.7, 12, 1, true), stdMat(c, 0.7, 0, { side: THREE.DoubleSide }), 200));
    const poleMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.04, 0.04, 2.4, 6), stdMat(0xdddddd, 0.4, 0.5), 1000);
    const towelMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.05, 1.9), stdMat(0xffffff, 0.9), 1000);
    const counts = umbCols.map(() => 0); let pc = 0, tc = 0;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s1 = new THREE.Vector3(1, 1, 1);
    for (let z = BEACH.z0 + 20; z < BEACH.z1 - 10; z += 9 + R() * 8) {
      if (Math.abs(z - CZ) < 20) continue;
      const x = BEACH.x0 + 26 + R() * 30, y = beachHeight(x);
      const ci = Math.floor(R() * umbCols.length);
      m4.compose(new THREE.Vector3(x, y + 2.45, z), q, s1);
      umbMeshes[ci].setMatrixAt(counts[ci]++, m4);
      m4.compose(new THREE.Vector3(x, y + 1.2, z), q, s1);
      poleMesh.setMatrixAt(pc++, m4);
      q.setFromEuler(new THREE.Euler(0, R() * 0.6, 0));
      m4.compose(new THREE.Vector3(x + 1.2, y + 0.05, z + 0.6), q, s1);
      towelMesh.setMatrixAt(tc++, m4);
      towelMesh.setColorAt(tc - 1, new THREE.Color(umbCols[Math.floor(R() * umbCols.length)]));
      q.identity();
      umbs.push({ x, z });
      this.statics.addCircle(x, z, 0.12, 2.2, 'umbrella');
    }
    umbMeshes.forEach((m, k) => { m.count = counts[k]; m.castShadow = true; this.scene.add(m); });
    poleMesh.count = pc; towelMesh.count = tc;
    this.scene.add(poleMesh, towelMesh);
    // lifeguard towers
    const towerCols = [0xff7aa8, 0x6fe0d0, 0xffd27a, 0xb49aff];
    for (let k = 0; k < 6; k++) {
      const z = BEACH.z0 + 90 + k * 190;
      if (Math.abs(z - CZ) < 30) continue;
      const x = BEACH.x0 + 52, y = beachHeight(x);
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) this.box(x + dx * 1.4, y, z + dz * 1.4, 0.2, 2.4, 0.2, 0xffffff, [3, 3, 4, 0], false);
      this.box(x, y + 2.4, z, 4, 0.3, 4, 0xffffff, [3, 3, 4, 0], false);
      this.box(x, y + 2.7, z, 3.2, 2.4, 3.2, towerCols[k % 4], [3, 3, 4, 0], false);
      this.roofPrism(x, y + 5.1, z, 3.8, 3.8, 1.0, 0xffffff, true);
      this.statics.addBox(x - 2, z - 2, x + 2, z + 2, y, y + 6, 'tower');
    }
    this.markers.beach = { x: BEACH.x0 + 30, z: 7 * P };
  }

  // ---------------- street furniture ----------------
  buildStreetFurniture(R) {
    // street lamps along each road segment, both sides
    const lampSpots = [];
    for (let j = 0; j <= NZ; j++) for (let i = 0; i < NX; i++) {
      for (const s of [-1, 1]) {
        for (const t of [0.3, 0.7]) {
          const x = i * P + t * P, z = j * P + s * (HALF + 0.9);
          if (z < CITY.z0 + 1 || z > CITY.z1 - 1) continue;
          if (j === 0 && s < 0 || j === NZ && s > 0) continue;
          lampSpots.push({ x, z, a: s > 0 ? Math.PI : 0 });
        }
      }
    }
    for (let i = 0; i <= NX; i++) for (let j = 0; j < NZ; j++) {
      for (const s of [-1, 1]) {
        for (const t of [0.3, 0.7]) {
          const x = i * P + s * (HALF + 0.9), z = j * P + t * P;
          if (i === 0 && s < 0) continue;
          if (i === NX && s > 0) continue;
          lampSpots.push({ x, z, a: s > 0 ? -Math.PI / 2 : Math.PI / 2 });
        }
      }
    }
    // causeway lamps
    for (let x = CAUSEWAY.x0 + 40; x < CAUSEWAY.x1; x += 30) {
      lampSpots.push({ x, z: CAUSEWAY.z0 + 0.8, a: 0 });
      lampSpots.push({ x: x + 15, z: CAUSEWAY.z1 - 0.8, a: Math.PI });
    }
    this.lamps = lampSpots;
    // pole geometry: forward (local +z) arm points over road
    const poleG = new THREE.CylinderGeometry(0.09, 0.13, 7.5, 8); poleG.translate(0, 3.75, 0);
    const armG = new THREE.BoxGeometry(0.1, 0.1, 2.4); armG.translate(0, 7.4, 1.1);
    const pg = mergeGeometries([poleG, armG.toNonIndexed().index ? armG : armG]);
    const headG = new THREE.BoxGeometry(0.45, 0.14, 0.9); headG.translate(0, 7.3, 2.2);
    const poles = new THREE.InstancedMesh(pg, stdMat(0x3a3d42, 0.5, 0.7), lampSpots.length);
    const heads = new THREE.InstancedMesh(headG, new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3.2, 2.2) }), lampSpots.length);
    this.lampHeadMat = heads.material;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s1 = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
    lampSpots.forEach((l, k) => {
      const y = (l.x > CITY.x1 ? 0 : CURB_H);
      q.setFromAxisAngle(up, l.a);
      m4.compose(new THREE.Vector3(l.x, y, l.z), q, s1);
      poles.setMatrixAt(k, m4); heads.setMatrixAt(k, m4);
      this.statics.addCircle(l.x, l.z, 0.18, 7.5, 'lamp');
      this.lightSources.push({ x: l.x + Math.sin(l.a) * 2.2, y: 7.0, z: l.z + Math.cos(l.a) * 2.2, color: new THREE.Color(1, 0.78, 0.5), intensity: 60, range: 26, lamp: true });
    });
    poles.castShadow = true;
    this.scene.add(poles, heads);

    // street palms in deco & residential & downtown sidewalks
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
      const d = blockDistrict(i, j);
      if (d === DISTRICT.PORT) continue;
      const b = blockBounds(i, j);
      const every = d === DISTRICT.DOWNTOWN ? 30 : 22;
      for (let x = b.x0 + 10; x < b.x1 - 6; x += every) {
        this.palms.push({ x: x + 5, z: b.z0 + 1.6, s: 0.9 + hash2(x, j) * 0.4, r: hash2(x, j + 9) * 6 });
        this.palms.push({ x: x + 5, z: b.z1 - 1.6, s: 0.9 + hash2(x + 3, j) * 0.4, r: hash2(x, j + 19) * 6 });
      }
    }
    this.buildPalms();

    // traffic signals
    const signals = [];
    for (const n of nodes) {
      if (!hasLights(n)) continue;
      // heads: [cornerX, cornerZ, faceAngle (toward approaching traffic), axis]
      const o = HALF + 1.2;
      signals.push({ x: n.x - o, z: n.z - o, a: Math.PI, axis: 'ns', node: n.id, arm: Math.PI / 2 });     // southbound approach (from -z)
      signals.push({ x: n.x + o, z: n.z + o, a: 0, axis: 'ns', node: n.id, arm: -Math.PI / 2 });          // northbound
      signals.push({ x: n.x - o, z: n.z + o, a: -Math.PI / 2, axis: 'ew', node: n.id, arm: Math.PI });     // eastbound (from -x)
      signals.push({ x: n.x + o, z: n.z - o, a: Math.PI / 2, axis: 'ew', node: n.id, arm: 0 });           // westbound
    }
    this.signals = signals;
    const sPole = new THREE.CylinderGeometry(0.12, 0.15, 6, 8); sPole.translate(0, 3, 0);
    const sArm = new THREE.BoxGeometry(0.12, 0.12, 5); sArm.translate(0, 5.8, 2.5);
    const sHead = new THREE.BoxGeometry(0.5, 1.4, 0.4); sHead.translate(0, 5.2, 4.2);
    const spg = mergeGeometries([sPole, sArm, sHead]);
    const sMesh = new THREE.InstancedMesh(spg, stdMat(0x2a2c30, 0.5, 0.6), signals.length);
    const bulbG = new THREE.SphereGeometry(0.15, 8, 6);
    const bulbs = new THREE.InstancedMesh(bulbG, new THREE.MeshBasicMaterial({ color: 0xffffff }), signals.length * 3);
    const e = new THREE.Euler();
    signals.forEach((s, k) => {
      // pole at corner, arm extending over approaching lanes
      q.setFromEuler(e.set(0, s.arm, 0));
      m4.compose(new THREE.Vector3(s.x, CURB_H, s.z), q, s1);
      sMesh.setMatrixAt(k, m4);
      const fx = Math.sin(s.arm), fz = Math.cos(s.arm);
      const hx = s.x + fx * 4.2, hz = s.z + fz * 4.2;
      const faceX = Math.sin(s.a), faceZ = Math.cos(s.a);
      for (let b = 0; b < 3; b++) {
        m4.makeTranslation(hx + faceX * 0.22, CURB_H + 5.65 - b * 0.45, hz + faceZ * 0.22);
        bulbs.setMatrixAt(k * 3 + b, m4);
        bulbs.setColorAt(k * 3 + b, new THREE.Color(0.05, 0.05, 0.05));
      }
      this.statics.addCircle(s.x, s.z, 0.2, 6, 'signal');
    });
    sMesh.castShadow = true;
    this.scene.add(sMesh, bulbs);
    this.bulbs = bulbs;
    this.signalTimer = 0;

    // benches
    if (this.benches.length) {
      const bg = new THREE.BoxGeometry(1.8, 0.45, 0.6); bg.translate(0, 0.45, 0);
      const bm = new THREE.InstancedMesh(bg, stdMat(0x8a5a3a, 0.8), this.benches.length);
      this.benches.forEach((b, k) => { q.setFromAxisAngle(up, b.a); m4.compose(new THREE.Vector3(b.x, CURB_H, b.z), q, s1); bm.setMatrixAt(k, m4); });
      this.scene.add(bm);
    }
  }

  buildPalms() {
    // trunk: tube along slightly curved spline; fronds: bent planes
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.25, 3, 0), new THREE.Vector3(0.7, 6.5, 0), new THREE.Vector3(1.2, 9, 0)]);
    const trunk = new THREE.TubeGeometry(curve, 10, 0.2, 7, false);
    // taper
    const p = trunk.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const y = p.getY(k), t = y / 9;
      const c = curve.getPoint(Math.min(1, Math.max(0, t)));
      const sc = 1.35 - t * 0.5;
      p.setX(k, c.x + (p.getX(k) - c.x) * sc);
      p.setZ(k, c.z + (p.getZ(k) - c.z) * sc);
    }
    trunk.computeVertexNormals();
    const fronds = [];
    const top = new THREE.Vector3(1.2, 9, 0);
    for (let f = 0; f < 10; f++) {
      const g = new THREE.PlaneGeometry(1.4, 4.6, 1, 6);
      g.translate(0, 2.3, 0);
      const fp = g.attributes.position;
      for (let k = 0; k < fp.count; k++) {
        const y = fp.getY(k), t = y / 4.6;
        // lay along +x, droop
        fp.setXYZ(k, y, 1.2 * t - 2.4 * t * t + (f % 2 ? 0.2 : 0), fp.getX(k) * (1 - t * 0.5));
      }
      g.rotateZ(0.15 + (f % 3) * 0.12);
      g.rotateY((f / 10) * Math.PI * 2 + (f % 2) * 0.2);
      g.translate(top.x, top.y, top.z);
      fronds.push(g);
    }
    const frondG = mergeGeometries(fronds);
    frondG.computeVertexNormals();
    const trunkMat = stdMat(0x7a6048, 0.9);
    const frondMat = new THREE.MeshStandardMaterial({ map: palmFrondTexture(), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.8 });
    const n = this.palms.length;
    const tM = new THREE.InstancedMesh(trunk, trunkMat, n);
    const fM = new THREE.InstancedMesh(frondG, frondMat, n);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    this.palms.forEach((pl, k) => {
      q.setFromAxisAngle(up, pl.r);
      const s = pl.s;
      let y = 0;
      if (pl.x > BEACH.x0 && pl.x < BEACH.x1 && !(Math.abs(pl.z - CZ) < HALF + 2)) y = beachHeight(pl.x);
      else if (pl.x >= -HALF && pl.x <= NX * P + HALF && pl.z >= -HALF && pl.z <= NZ * P + HALF) y = CURB_H;
      m4.compose(new THREE.Vector3(pl.x, y, pl.z), q, new THREE.Vector3(s, s, s));
      tM.setMatrixAt(k, m4); fM.setMatrixAt(k, m4);
      this.statics.addCircle(pl.x, pl.z, 0.3 * s, 9 * s, 'palm');
    });
    tM.castShadow = true; fM.castShadow = true; tM.receiveShadow = true; fM.receiveShadow = true;
    this.scene.add(tM, fM);
    this.palmMeshes = [tM, fM];
  }

  buildRamps() {
    const defs = [
      { x: -28, z: 3 * P + 40, a: 0, name: '码头飞跃' },
      { x: BEACH.x0 + 38, z: 9 * P + 20, a: Math.PI, name: '海滩起飞' },
      { x: 5 * P + 45, z: 9 * P + 25, a: Math.PI / 2, name: '公园腾空' },
      { x: 4 * P + 70, z: 4 * P + 45, a: -Math.PI / 2, name: '广场之翼' },
      { x: ISLAND.x0 + 60, z: CZ + 70, a: Math.PI / 2, name: '珊瑚岛跳台' },
      { x: 9 * P + 45, z: 1 * P + 30, a: 0, name: '海滨冲天' },
    ];
    const mat = stdMat(0xf2c200, 0.6, 0.2);
    const stripe = stdMat(0x111111, 0.6);
    defs.forEach((d, k) => {
      const hw = 3, hd = 7, h = 3.2;
      const base = d.x > BEACH.x0 && d.x < BEACH.x1 ? beachHeight(d.x) : (d.x > -HALF && d.x < NX * P + HALF ? CURB_H : 0);
      const shape = new THREE.Shape();
      shape.moveTo(-hd, 0); shape.lineTo(hd, h); shape.lineTo(hd, 0); shape.lineTo(-hd, 0);
      const g = new THREE.ExtrudeGeometry(shape, { depth: hw * 2, bevelEnabled: false });
      // shape x -> local z (forward), extrude z -> local x
      g.rotateY(-Math.PI / 2);
      g.translate(hw, 0, 0);
      const mesh = new THREE.Mesh(g, [mat, stripe]);
      mesh.position.set(d.x, base, d.z);
      mesh.rotation.y = d.a;
      mesh.castShadow = true; mesh.receiveShadow = true;
      this.scene.add(mesh);
      ramps.push({ x: d.x, z: d.z, a: d.a, hw, hd, h: h + base, base, name: d.name, id: k });
    });
  }

  finalizeMeshes() {
    this.buildingMeshes = [];
    for (const [, geoms] of this.chunks) {
      const g = mergeGeometries(geoms);
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, this.bldMat);
      m.castShadow = true; m.receiveShadow = true;
      this.scene.add(m);
      this.buildingMeshes.push(m);
    }
    this.chunks.clear();
    if (this.neonGeoms.length) {
      const g = mergeGeometries(this.neonGeoms);
      this.neon = new THREE.Mesh(g, this.neonMat);
      this.scene.add(this.neon);
    }
  }

  buildWater() {
    const geo = new THREE.PlaneGeometry(8000, 8000);
    this.water = new Water(geo, {
      textureWidth: 512, textureHeight: 512, waterNormals: waterNormals(),
      sunDirection: new THREE.Vector3(0.7, 0.7, 0), sunColor: 0xfff0c0, waterColor: 0x0099aa, distortionScale: 2.5, fog: true,
    });
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.y = WATER_Y;
    this.water.material.uniforms.size.value = 8;
    this.scene.add(this.water);
    // cheap fallback water for low quality
    const n = waterNormals(); n.repeat.set(400, 400);
    this.waterLow = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x1a8a9a, roughness: 0.06, metalness: 0.4, normalMap: n, normalScale: new THREE.Vector2(0.5, 0.5) }));
    this.waterLow.rotation.x = -Math.PI / 2; this.waterLow.position.y = WATER_Y;
    this.waterLow.visible = false;
    this.scene.add(this.waterLow);
  }

  setWaterQuality(high) {
    this.water.visible = high;
    this.waterLow.visible = !high;
  }

  computeSpots(R) {
    // badges: spread across districts on sidewalks / special places
    const spots = [];
    for (let k = 0; k < 25; k++) {
      const i = Math.floor(R() * NX), j = Math.floor(R() * NZ);
      const b = blockBounds(i, j);
      const side = Math.floor(R() * 4);
      let x, z;
      if (side === 0) { x = b.x0 + 2; z = b.z0 + 6 + R() * (b.z1 - b.z0 - 12); }
      else if (side === 1) { x = b.x1 - 2; z = b.z0 + 6 + R() * (b.z1 - b.z0 - 12); }
      else if (side === 2) { z = b.z0 + 2; x = b.x0 + 6 + R() * (b.x1 - b.x0 - 12); }
      else { z = b.z1 - 2; x = b.x0 + 6 + R() * (b.x1 - b.x0 - 12); }
      spots.push({ x, z, y: CURB_H + 1, id: k });
    }
    // a few special ones
    spots[0] = { x: BEACH.x0 + 70, z: 2 * P, y: beachHeight(BEACH.x0 + 70) + 1, id: 0 };
    spots[1] = { x: ISLAND.x1 - 10, z: ISLAND.z0 + 12, y: 1, id: 1 };
    spots[2] = { x: CITY.x0 + 10, z: 10 * P, y: 1, id: 2 };
    this.badgeSpots = spots;
    // weapon / health pickups
    this.pickupSpots = [
      { x: 2 * P + 20, z: 7 * P + HALF + 2, type: 'pistol' },
      { x: 8 * P + 20, z: 2 * P + HALF + 2, type: 'health' },
      { x: 30, z: 4 * P + 30, type: 'smg' },
      { x: 6 * P + 50, z: 10 * P + HALF + 2, type: 'armor' },
      { x: BEACH.x0 + 40, z: 5.5 * P, type: 'shotgun' },
      { x: 4 * P + 45, z: 4 * P + 60, type: 'health' },
      { x: 9 * P + 30, z: 11 * P + HALF + 2, type: 'grenade' },
      { x: 1 * P + 50, z: 1 * P + HALF + 2, type: 'armor' },
    ];
  }

  // ---------------- per-frame ----------------
  update(dt, t, night, sunDir, sunColor) {
    this.t += dt;
    if (this.water.visible) {
      this.water.material.uniforms.time.value += dt * 0.6;
      const wu = this.water.material.uniforms;
      wu.sunDirection.value.copy(sunDir).y = Math.abs(sunDir.y);
      wu.sunColor.value.copy(sunColor).multiplyScalar(1 - night * 0.75);
      // deeper tropical ocean at day, dark navy at night
      const dR = 0.02 * (1 - night) + 0.003, dG = 0.22 * (1 - night) + 0.01, dB = 0.32 * (1 - night) + 0.03;
      wu.waterColor.value.setRGB(dR, dG, dB);
    }
    // neon intensity (lower during day)
    const ni = 0.15 + night * 1.0;
    this.neonMat.color.setScalar(ni);
    for (const m of this.signMeshes) m.material.color.setScalar(0.3 + night * 2.4);
    this.lampHeadMat.color.setRGB(0.8 + night * 4, 0.7 + night * 3.2, 0.55 + night * 2.2);
    // traffic lights
    this.signalTimer -= dt;
    if (this.signalTimer <= 0) {
      this.signalTimer = 0.25;
      const c = new THREE.Color();
      const off = 0.04, on = 5;
      this.signals.forEach((s, k) => {
        const ph = lightPhase(s.node, t);
        const green = ph === s.axis, yellow = ph === 'y_' + s.axis;
        const red = !green && !yellow;
        this.bulbs.setColorAt(k * 3, c.setRGB(red ? on : off, red ? 0.1 : off, off));
        this.bulbs.setColorAt(k * 3 + 1, c.setRGB(yellow ? on : off, yellow ? on * 0.6 : off, off));
        this.bulbs.setColorAt(k * 3 + 2, c.setRGB(off, green ? on : off, green ? on * 0.5 : off));
      });
      this.bulbs.instanceColor.needsUpdate = true;
    }
  }
}
