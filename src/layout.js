// City layout of Solara Bay (original fictional city). Pure data + queries, no rendering.
import { hash2 } from './util.js';

export const P = 90;          // block pitch (road center to road center)
export const W = 18;          // road width
export const HALF = W / 2;
export const LANE_OFF = [2.4, 6.6]; // lane centers from road center line
export const NX = 10, NZ = 12; // blocks
export const SIDEWALK = 4;
export const CURB_H = 0.18;

export const CITY = { x0: -HALF - 46, x1: NX * P + HALF, z0: -HALF - 26, z1: NZ * P + HALF + 26 };
export const BEACH = { x0: CITY.x1, x1: CITY.x1 + 95, z0: CITY.z0, z1: CITY.z1 };
export const CZ = 5 * P; // causeway z
export const CAUSEWAY = { x0: CITY.x1, x1: CITY.x1 + 300, z0: CZ - HALF - 2, z1: CZ + HALF + 2 };
export const ISLAND = { x0: CAUSEWAY.x1, x1: CAUSEWAY.x1 + 240, z0: CZ - 150, z1: CZ + 150 };
export const ISLAND_END_X = ISLAND.x0 + 150; // road end (roundabout)
export const WATER_Y = -0.9;
export const WORLD_HALF = 3000;

// ----- districts -----
export const DISTRICT = { PORT: 0, DOWNTOWN: 1, MIDTOWN: 2, RESIDENTIAL: 3, DECO: 4, PARK: 5, SPECIAL: 6 };
export const DISTRICT_NAME = ['集装箱码头', '金融中心', '中城', '棕榈住宅区', '海滨装饰艺术区', '日落公园', ''];

// special named blocks: [i, j, id]
export const SPECIAL = {
  safehouse: { i: 2, j: 9, name: '安全屋' },
  garage: { i: 1, j: 5, name: '老萨尔的车行' },
  gunshop: { i: 6, j: 7, name: '烈焰枪械店' },
  hospital: { i: 3, j: 1, name: '圣玛丽医院' },
  police: { i: 7, j: 3, name: '太阳湾警局' },
  park: { i: 5, j: 9, name: '日落公园' },
  park2: { i: 4, j: 9, name: '日落公园' },
  plaza: { i: 4, j: 4, name: '市政广场' },
};

export function blockDistrict(i, j) {
  if (i < 0 || j < 0 || i >= NX || j >= NZ) return -1;
  if ((i === 5 || i === 4) && j === 9) return DISTRICT.PARK;
  if (i === 0) return DISTRICT.PORT;
  if (i >= NX - 2) return DISTRICT.DECO;
  if (i >= 3 && i <= 6 && j >= 2 && j <= 6) return DISTRICT.DOWNTOWN;
  if (j >= 8) return DISTRICT.RESIDENTIAL;
  return DISTRICT.MIDTOWN;
}

export function specialAt(i, j) {
  for (const k in SPECIAL) { const s = SPECIAL[k]; if (s.i === i && s.j === j) return k; }
  return null;
}

// block interior bounds (including sidewalk ring)
export function blockBounds(i, j) {
  return { x0: i * P + HALF, x1: (i + 1) * P - HALF, z0: j * P + HALF, z1: (j + 1) * P - HALF };
}
export function blockCenter(i, j) { return { x: i * P + P / 2, z: j * P + P / 2 }; }

export function zoneName(x, z) {
  if (inRect(x, z, ISLAND) || inRect(x, z, CAUSEWAY) && x > BEACH.x1) return '珊瑚岛';
  if (inRect(x, z, BEACH)) return '日落海滩';
  if (x < 0) return DISTRICT_NAME[0];
  const i = Math.floor(x / P), j = Math.floor(z / P);
  const d = blockDistrict(Math.min(NX - 1, Math.max(0, i)), Math.min(NZ - 1, Math.max(0, j)));
  return DISTRICT_NAME[d] ?? '';
}

export const inRect = (x, z, r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;

// ----- road queries -----
// signed local coordinate relative to nearest road line
export function roadLocal(v) { return v - Math.round(v / P) * P; }

export function isRoad(x, z) {
  if (inRect(x, z, CAUSEWAY)) return Math.abs(z - CZ) < HALF;
  if (inRect(x, z, ISLAND)) return Math.abs(z - CZ) < HALF && x < ISLAND_END_X + 14;
  if (x < -HALF || x > NX * P + HALF || z < -HALF || z > NZ * P + HALF) return false;
  return Math.abs(roadLocal(x)) < HALF || Math.abs(roadLocal(z)) < HALF;
}

export function isLand(x, z) {
  return inRect(x, z, CITY) || inRect(x, z, CAUSEWAY) || inRect(x, z, ISLAND) || inRect(x, z, BEACH);
}

// beach height profile: 0 at road edge going to below water
export function beachHeight(x) {
  const t = (x - BEACH.x0) / (BEACH.x1 - BEACH.x0);
  if (t < 0.12) return 0.0;
  return -Math.pow((t - 0.12) / 0.88, 1.3) * 2.6;
}

// is inside a raised block (sidewalk/lot) in the main city grid
export function inBlock(x, z) {
  if (x < -HALF || x > NX * P + HALF || z < -HALF || z > NZ * P + HALF) return false;
  return Math.abs(roadLocal(x)) >= HALF && Math.abs(roadLocal(z)) >= HALF;
}

// stunt ramps registered by world gen: {x,z,a,hw,hd,h}
export const ramps = [];

export function groundHeight(x, z) {
  let h;
  if (inRect(x, z, CAUSEWAY) || inRect(x, z, ISLAND)) h = 0;
  else if (inRect(x, z, CITY)) h = inBlock(x, z) ? CURB_H : 0;
  else if (inRect(x, z, BEACH)) h = beachHeight(x);
  else return -50; // sea floor
  for (const r of ramps) {
    const c = Math.cos(r.a), s = Math.sin(r.a);
    const dx = x - r.x, dz = z - r.z;
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    if (Math.abs(lx) < r.hw && lz > -r.hd && lz < r.hd) {
      const t = (lz + r.hd) / (2 * r.hd);
      h = Math.max(h, t * r.h);
    }
  }
  return h;
}

// ----- road graph (intersections) -----
export const nodes = []; // {id,x,z,links:[ids], i,j}
export function nodeId(i, j) { return j * (NX + 1) + i; }
(function buildGraph() {
  for (let j = 0; j <= NZ; j++) for (let i = 0; i <= NX; i++) {
    nodes.push({ id: nodeId(i, j), x: i * P, z: j * P, i, j, links: [] });
  }
  const link = (a, b) => { nodes[a].links.push(b); nodes[b].links.push(a); };
  for (let j = 0; j <= NZ; j++) for (let i = 0; i <= NX; i++) {
    if (i < NX) link(nodeId(i, j), nodeId(i + 1, j));
    if (j < NZ) link(nodeId(i, j), nodeId(i, j + 1));
  }
  // causeway: extra node at island end
  const end = { id: nodes.length, x: ISLAND_END_X, z: CZ, i: -1, j: -1, links: [], island: true };
  nodes.push(end);
  link(nodeId(NX, 5), end.id);
})();

export function nearestNode(x, z) {
  if (x > CITY.x1 + 40 && Math.abs(z - CZ) < 200) return nodes[nodes.length - 1];
  const i = Math.max(0, Math.min(NX, Math.round(x / P)));
  const j = Math.max(0, Math.min(NZ, Math.round(z / P)));
  return nodes[nodeId(i, j)];
}

// BFS shortest path (grid so BFS by hops ~ fine; uses Dijkstra on distances)
export function findPath(fromId, toId) {
  const n = nodes.length;
  const distA = new Float32Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), done = new Uint8Array(n);
  distA[fromId] = 0;
  for (let it = 0; it < n; it++) {
    let u = -1, best = Infinity;
    for (let k = 0; k < n; k++) if (!done[k] && distA[k] < best) { best = distA[k]; u = k; }
    if (u < 0 || u === toId) break;
    done[u] = 1;
    for (const v of nodes[u].links) {
      const d = best + Math.hypot(nodes[u].x - nodes[v].x, nodes[u].z - nodes[v].z);
      if (d < distA[v]) { distA[v] = d; prev[v] = u; }
    }
  }
  const path = [];
  for (let u = toId; u >= 0; u = prev[u]) { path.push(u); if (u === fromId) break; }
  return path.reverse();
}

// find nearest point on a road lane, with heading of the lane
export function nearestLanePoint(x, z) {
  // choose closest road axis
  const lx = roadLocal(x), lz = roadLocal(z);
  if (inRect(x, z, CAUSEWAY) || (inRect(x, z, ISLAND))) {
    const side = z > CZ ? 1 : -1;
    return { x, z: CZ + side * LANE_OFF[0], h: side > 0 ? -Math.PI / 2 : Math.PI / 2 };
  }
  if (Math.abs(lx) < Math.abs(lz)) { // vertical road (runs along z)
    const rx = x - lx;
    const side = lx >= 0 ? 1 : -1;
    // right-hand traffic: heading +z (h=0) drives on right => right vector (-1,0) => x < center
    return { x: rx + side * LANE_OFF[0], z, h: side < 0 ? 0 : Math.PI };
  } else {
    const rz = z - lz;
    const side = lz >= 0 ? 1 : -1;
    // heading +x (h=PI/2): right = (0,1) => z > center
    return { x, z: rz + side * LANE_OFF[0], h: side > 0 ? Math.PI / 2 : -Math.PI / 2 };
  }
}

// deterministic per-block random
export const blockRand = (i, j, k = 0) => hash2(i * 31 + k * 977, j * 17 + k * 131);

// traffic light phase per intersection. returns 'ns' or 'ew' green or 'y' (all yellow/red)
export function lightPhase(nodeIdx, t) {
  const off = (hash2(nodeIdx, 7) * 20) | 0;
  const p = (t + off) % 22;
  if (p < 9) return 'ns';
  if (p < 11) return 'y_ns';
  if (p < 20) return 'ew';
  return 'y_ew';
}
export function hasLights(n) {
  return n && !n.island && n.i > 0 && n.i < NX && n.j > 0 && n.j < NZ;
}
