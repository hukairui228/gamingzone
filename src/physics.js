// Static collision world: axis-aligned building boxes + circular props in a spatial hash.
import { rayAABB, circleOBB } from './util.js';

const CELL = 24;

export class StaticWorld {
  constructor() {
    this.cells = new Map();
    this.items = [];
    this._stamp = 0;
  }
  key(cx, cz) { return cx * 73856093 ^ cz * 19349663; }
  insert(item, minx, minz, maxx, maxz) {
    item._s = 0;
    this.items.push(item);
    const x0 = Math.floor(minx / CELL), x1 = Math.floor(maxx / CELL);
    const z0 = Math.floor(minz / CELL), z1 = Math.floor(maxz / CELL);
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const k = this.key(x, z);
      let a = this.cells.get(k);
      if (!a) this.cells.set(k, (a = []));
      a.push(item);
    }
  }
  // box: building / solid. y0..y1 vertical extent
  addBox(minx, minz, maxx, maxz, y0, y1, tag = 'building') {
    const it = {
      kind: 'box', minx, minz, maxx, maxz, y0, y1, tag,
      obb: { x: (minx + maxx) / 2, z: (minz + maxz) / 2, hw: (maxx - minx) / 2, hd: (maxz - minz) / 2, a: 0 },
    };
    this.insert(it, minx, minz, maxx, maxz);
    return it;
  }
  addCircle(x, z, r, y1, tag = 'prop') {
    const it = { kind: 'circle', x, z, r, y0: 0, y1, tag };
    this.insert(it, x - r, z - r, x + r, z + r);
    return it;
  }
  query(minx, minz, maxx, maxz, out = []) {
    out.length = 0;
    const st = ++this._stamp;
    const x0 = Math.floor(minx / CELL), x1 = Math.floor(maxx / CELL);
    const z0 = Math.floor(minz / CELL), z1 = Math.floor(maxz / CELL);
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const a = this.cells.get(this.key(x, z));
      if (!a) continue;
      for (const it of a) if (it._s !== st) { it._s = st; out.push(it); }
    }
    return out;
  }
  // circle collision against static items. returns aggregated push or null
  collideCircle(x, z, r, yFeet, out) {
    const items = this.query(x - r, z - r, x + r, z + r, this._tmp || (this._tmp = []));
    let px = 0, pz = 0, hit = false;
    for (const it of items) {
      if (yFeet > it.y1 - 0.3) continue;
      if (it.kind === 'box') {
        const c = circleOBB(x + px, z + pz, r, it.obb);
        if (c) { px += c.nx * c.depth; pz += c.nz * c.depth; hit = true; }
      } else {
        const dx = x + px - it.x, dz = z + pz - it.z, rr = r + it.r;
        const d2 = dx * dx + dz * dz;
        if (d2 < rr * rr) {
          const d = Math.sqrt(d2) || 0.001;
          px += dx / d * (rr - d); pz += dz / d * (rr - d); hit = true;
        }
      }
    }
    if (!hit) return null;
    out.x = px; out.z = pz;
    return out;
  }
  // 3D ray cast, returns {t, item} or null
  raycast(ox, oy, oz, dx, dy, dz, maxT) {
    const ex = ox + dx * maxT, ez = oz + dz * maxT;
    const items = this.query(Math.min(ox, ex), Math.min(oz, ez), Math.max(ox, ex), Math.max(oz, ez), this._tmp2 || (this._tmp2 = []));
    let best = maxT, bi = null;
    for (const it of items) {
      let t;
      if (it.kind === 'box') t = rayAABB(ox, oy, oz, dx, dy, dz, it.minx, it.y0, it.minz, it.maxx, it.y1, it.maxz, best);
      else t = rayAABB(ox, oy, oz, dx, dy, dz, it.x - it.r, 0, it.z - it.r, it.x + it.r, it.y1, it.z + it.r, best);
      if (t >= 0 && t < best) { best = t; bi = it; }
    }
    // ground plane
    if (dy < -1e-4) {
      const tg = (0 - oy) / dy;
      if (tg >= 0 && tg < best) return { t: tg, item: null, ground: true };
    }
    return bi ? { t: best, item: bi } : null;
  }
  // line of sight between two points (buildings only)
  lineOfSight(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const L = Math.hypot(dx, dy, dz);
    if (L < 0.01) return true;
    const ex = ax + dx, ez = az + dz;
    const items = this.query(Math.min(ax, ex), Math.min(az, ez), Math.max(ax, ex), Math.max(az, ez), this._tmp3 || (this._tmp3 = []));
    for (const it of items) {
      if (it.kind !== 'box') continue;
      const t = rayAABB(ax, ay, az, dx / L, dy / L, dz / L, it.minx, it.y0, it.minz, it.maxx, it.y1, it.maxz, L);
      if (t >= 0 && t < L) return false;
    }
    return true;
  }
}
