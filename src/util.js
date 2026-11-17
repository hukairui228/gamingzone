// Small math / helper utilities shared across the game.
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const rand = (a, b) => a + Math.random() * (b - a);
export const randi = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const chance = (p) => Math.random() < p;
export const TAU = Math.PI * 2;

export function angleDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}
export function dampAngle(a, b, lambda, dt) {
  return a + angleDiff(a, b) * (1 - Math.exp(-lambda * dt));
}

// deterministic PRNG (xorshift)
export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export const dist2 = (ax, az, bx, bz) => { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; };
export const dist = (ax, az, bx, bz) => Math.sqrt(dist2(ax, az, bx, bz));

// Heading convention: forward = (sin h, cos h) in xz. Driver's right = (-cos h, sin h).
export const fwdX = (h) => Math.sin(h);
export const fwdZ = (h) => Math.cos(h);
export const headingTo = (dx, dz) => Math.atan2(dx, dz);

// ---------- 2D oriented boxes ----------
// OBB: { x, z, hw, hd, a }  hw = half width along local x, hd = half depth along local z, a = rotation.y
function axes(a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [c, -s, s, c]; // local x axis (c,-s), local z axis (s,c)
}

export function satOBB(A, B) {
  const a = axes(A.a), b = axes(B.a);
  const dx = A.x - B.x, dz = A.z - B.z;
  let best = Infinity, nx = 0, nz = 0;
  const list = [a[0], a[1], a[2], a[3], b[0], b[1], b[2], b[3]];
  for (let k = 0; k < 8; k += 2) {
    const ax = list[k], az = list[k + 1];
    const ra = A.hw * Math.abs(a[0] * ax + a[1] * az) + A.hd * Math.abs(a[2] * ax + a[3] * az);
    const rb = B.hw * Math.abs(b[0] * ax + b[1] * az) + B.hd * Math.abs(b[2] * ax + b[3] * az);
    const d = dx * ax + dz * az;
    const o = ra + rb - Math.abs(d);
    if (o <= 0) return null;
    if (o < best) { best = o; const sg = d < 0 ? -1 : 1; nx = ax * sg; nz = az * sg; }
  }
  return { nx, nz, depth: best };
}

// circle vs OBB, returns push for the circle
export function circleOBB(cx, cz, r, B) {
  const c = Math.cos(B.a), s = Math.sin(B.a);
  const dx = cx - B.x, dz = cz - B.z;
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  const qx = clamp(lx, -B.hw, B.hw), qz = clamp(lz, -B.hd, B.hd);
  let ex = lx - qx, ez = lz - qz;
  const d2 = ex * ex + ez * ez;
  if (d2 > r * r) return null;
  let depth;
  if (d2 < 1e-9) {
    const px = B.hw - Math.abs(lx), pz = B.hd - Math.abs(lz);
    if (px < pz) { ex = lx < 0 ? -1 : 1; ez = 0; depth = px + r; }
    else { ex = 0; ez = lz < 0 ? -1 : 1; depth = pz + r; }
  } else {
    const d = Math.sqrt(d2);
    depth = r - d; ex /= d; ez /= d;
  }
  // local -> world : ex*(c,-s) + ez*(s,c)
  return { nx: ex * c + ez * s, nz: -ex * s + ez * c, depth };
}

export function pointInOBB(px, pz, B, pad = 0) {
  const c = Math.cos(B.a), s = Math.sin(B.a);
  const dx = px - B.x, dz = pz - B.z;
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  return Math.abs(lx) <= B.hw + pad && Math.abs(lz) <= B.hd + pad;
}

// Ray (origin o, dir d normalized) vs axis-aligned box. returns t or -1
export function rayAABB(ox, oy, oz, dx, dy, dz, minx, miny, minz, maxx, maxy, maxz, maxT) {
  let tmin = 0, tmax = maxT;
  const o = [ox, oy, oz], d = [dx, dy, dz], mn = [minx, miny, minz], mx = [maxx, maxy, maxz];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < mn[i] || o[i] > mx[i]) return -1;
    } else {
      const inv = 1 / d[i];
      let t1 = (mn[i] - o[i]) * inv, t2 = (mx[i] - o[i]) * inv;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
  }
  return tmin;
}

// Ray vs oriented box (rotation about Y only)
export function rayOBB3(ox, oy, oz, dx, dy, dz, B, y0, y1, maxT) {
  const c = Math.cos(B.a), s = Math.sin(B.a);
  const rx = ox - B.x, rz = oz - B.z;
  const lox = rx * c - rz * s, loz = rx * s + rz * c;
  const ldx = dx * c - dz * s, ldz = dx * s + dz * c;
  return rayAABB(lox, oy, loz, ldx, dy, ldz, -B.hw, y0, -B.hd, B.hw, y1, B.hd, maxT);
}

// ray vs sphere
export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r, maxT) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tc = lx * dx + ly * dy + lz * dz;
  if (tc < 0) return -1;
  const d2 = lx * lx + ly * ly + lz * lz - tc * tc;
  if (d2 > r * r) return -1;
  const t = tc - Math.sqrt(r * r - d2);
  return t >= 0 && t <= maxT ? t : -1;
}

export function fmtMoney(n) {
  return '$' + Math.floor(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// simple event emitter
export class Emitter {
  constructor() { this.l = {}; }
  on(e, f) { (this.l[e] ||= []).push(f); return () => this.off(e, f); }
  off(e, f) { const a = this.l[e]; if (a) { const i = a.indexOf(f); if (i >= 0) a.splice(i, 1); } }
  emit(e, ...args) { const a = this.l[e]; if (a) for (const f of a.slice()) f(...args); }
}
