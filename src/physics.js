import { binary } from './assets.js';

const GCELL = 16;   // ground triangle grid
const WCELL = 8;    // wall segment grid

/**
 * Static world collision: original ground mesh (triangles) + wall segments derived from building geometry.
 */
export class World {
  async load() {
    const [col, walls] = await Promise.all([binary('city/ground.bin'), binary('city/walls.bin')]);
    const head = new Uint32Array(col, 0, 2);
    this.gp = new Float32Array(col, 8, head[0] * 3);
    this.gt = new Uint32Array(col, 8 + head[0] * 12, head[1]);
    this.ground = new Map();
    const p = this.gp, t = this.gt;
    for (let i = 0; i < t.length; i += 3) {
      const a = t[i] * 3, b = t[i + 1] * 3, c = t[i + 2] * 3;
      const ny = (p[b + 2] - p[a + 2]) * (p[c] - p[a]) - (p[b] - p[a]) * (p[c + 2] - p[a + 2]);
      if (Math.abs(ny) < 1e-6) continue; // vertical, not walkable
      const x0 = Math.floor(Math.min(p[a], p[b], p[c]) / GCELL), x1 = Math.floor(Math.max(p[a], p[b], p[c]) / GCELL);
      const z0 = Math.floor(Math.min(p[a + 2], p[b + 2], p[c + 2]) / GCELL), z1 = Math.floor(Math.max(p[a + 2], p[b + 2], p[c + 2]) / GCELL);
      if ((x1 - x0 + 1) * (z1 - z0 + 1) > 4000) continue; // sea floor etc.
      for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) this.push(this.ground, gx, gz, i);
    }
    this.w = new Float32Array(walls);
    this.walls = new Map();
    const w = this.w;
    for (let i = 0; i < w.length; i += 6) {
      const x0 = Math.floor(Math.min(w[i], w[i + 2]) / WCELL), x1 = Math.floor(Math.max(w[i], w[i + 2]) / WCELL);
      const z0 = Math.floor(Math.min(w[i + 1], w[i + 3]) / WCELL), z1 = Math.floor(Math.max(w[i + 1], w[i + 3]) / WCELL);
      for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) this.push(this.walls, gx, gz, i);
    }
    this.extraWalls = [];
  }

  push(map, gx, gz, v) {
    const k = gx * 65536 + gz;
    const a = map.get(k);
    if (a) a.push(v); else map.set(k, [v]);
  }

  /** Highest walkable surface under (x,z) not above yRef + step. Returns -Infinity over open water. */
  height(x, z, yRef = 1e9, step = 1.2) {
    const list = this.ground.get(Math.floor(x / GCELL) * 65536 + Math.floor(z / GCELL));
    let best = -Infinity;
    if (!list) return best;
    const p = this.gp, t = this.gt, lim = yRef + step;
    for (const i of list) {
      const a = t[i] * 3, b = t[i + 1] * 3, c = t[i + 2] * 3;
      const ax = p[a], az = p[a + 2], bx = p[b], bz = p[b + 2], cx = p[c], cz = p[c + 2];
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(d) < 1e-9) continue;
      const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
      if (u < -1e-4) continue;
      const v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
      if (v < -1e-4 || u + v > 1.0001) continue;
      const y = u * p[a + 1] + v * p[b + 1] + (1 - u - v) * p[c + 1];
      if (y <= lim && y > best) best = y;
    }
    return best;
  }

  /**
   * Push a vertical cylinder (x,z,radius) at feet height y with given height out of walls.
   * Mutates pos; returns {hit, nx, nz, depth} for the deepest contact.
   */
  collide(pos, radius, height, out = { hit: false, nx: 0, nz: 0, depth: 0 }) {
    out.hit = false; out.depth = 0;
    const w = this.w;
    const y0 = pos.y + 0.45, y1 = pos.y + height;
    const gx0 = Math.floor((pos.x - radius) / WCELL), gx1 = Math.floor((pos.x + radius) / WCELL);
    const gz0 = Math.floor((pos.z - radius) / WCELL), gz1 = Math.floor((pos.z + radius) / WCELL);
    const seen = this._seen || (this._seen = new Set());
    seen.clear();
    for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) {
      const list = this.walls.get(gx * 65536 + gz);
      if (!list) continue;
      for (const i of list) {
        if (seen.has(i)) continue;
        seen.add(i);
        if (w[i + 4] > y1 || w[i + 5] < y0) continue;
        this.pushOut(pos, radius, w[i], w[i + 1], w[i + 2], w[i + 3], out);
      }
    }
    for (const s of this.extraWalls) this.pushOut(pos, radius, s[0], s[1], s[2], s[3], out);
    return out;
  }

  pushOut(pos, r, ax, az, bx, bz, out) {
    const dx = bx - ax, dz = bz - az;
    const L2 = dx * dx + dz * dz || 1e-9;
    let t = ((pos.x - ax) * dx + (pos.z - az) * dz) / L2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = pos.x - (ax + dx * t), qz = pos.z - (az + dz * t);
    const d2 = qx * qx + qz * qz;
    if (d2 >= r * r) return;
    const d = Math.sqrt(d2) || 1e-4;
    const pen = r - d;
    let nx = qx / d, nz = qz / d;
    if (d2 < 1e-8) { nx = -dz; nz = dx; const l = Math.hypot(nx, nz); nx /= l; nz /= l; }
    pos.x += nx * pen; pos.z += nz * pen;
    out.hit = true;
    if (pen > out.depth) { out.depth = pen; out.nx = nx; out.nz = nz; }
  }

  /** Ray vs walls (2D with height band) and ground. Returns distance or Infinity. */
  raycast(ox, oy, oz, dx, dy, dz, maxDist) {
    let best = maxDist;
    const w = this.w;
    const steps = Math.ceil(maxDist / WCELL) + 1;
    const seen = new Set();
    for (let s = 0; s <= steps; s++) {
      const px = ox + dx * s * WCELL, pz = oz + dz * s * WCELL;
      for (let gx = Math.floor(px / WCELL) - 1; gx <= Math.floor(px / WCELL) + 1; gx++)
        for (let gz = Math.floor(pz / WCELL) - 1; gz <= Math.floor(pz / WCELL) + 1; gz++) {
          const list = this.walls.get(gx * 65536 + gz);
          if (!list) continue;
          for (const i of list) {
            if (seen.has(i)) continue;
            seen.add(i);
            const ax = w[i], az = w[i + 1], ex = w[i + 2] - ax, ez = w[i + 3] - az;
            const den = dx * ez - dz * ex;
            if (Math.abs(den) < 1e-9) continue;
            const t = ((ax - ox) * ez - (az - oz) * ex) / den;
            const u = ((ax - ox) * dz - (az - oz) * dx) / den;
            if (t < 0 || t > best || u < 0 || u > 1) continue;
            const y = oy + dy * t;
            if (y < w[i + 4] || y > w[i + 5]) continue;
            best = t;
          }
        }
      if (s * WCELL > best) break;
    }
    // ground: march
    if (dy < 0) {
      for (let t = 0; t < best; t += 1.5) {
        const y = oy + dy * t, g = this.height(ox + dx * t, oz + dz * t, y);
        if (g > y) { best = Math.max(0, t - 0.75); break; }
      }
    }
    return best;
  }
}
