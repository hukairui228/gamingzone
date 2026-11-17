import { json } from './assets.js';

/** Road graph traced from the original minimap: lanes for traffic, sidewalks for pedestrians, GPS routing. */
export class Roads {
  async load() {
    const r = await json('city/roads.json');
    this.map = r.map;
    this.nodes = r.nodes;
    this.edges = r.edges.map(([a, b, width, pts]) => {
      const len = [0];
      for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      return { a, b, width: Math.max(7, width), pts, len, length: len[len.length - 1] };
    }).filter((e) => e.length > 2);
    this.adj = this.nodes.map(() => []);
    this.edges.forEach((e, i) => { this.adj[e.a].push(i); this.adj[e.b].push(i); });
  }

  /** Point at distance s along edge e in direction dir (+1 a->b, -1 b->a), shifted sideways by offset (right of travel). */
  point(e, dir, s, offset, out) {
    const L = e.length;
    let d = dir > 0 ? s : L - s;
    d = Math.max(0, Math.min(L, d));
    let i = 1;
    while (i < e.len.length - 1 && e.len[i] < d) i++;
    const p0 = e.pts[i - 1], p1 = e.pts[i];
    const seg = e.len[i] - e.len[i - 1] || 1e-6;
    const t = (d - e.len[i - 1]) / seg;
    let tx = (p1[0] - p0[0]) / seg, tz = (p1[1] - p0[1]) / seg;
    if (dir < 0) { tx = -tx; tz = -tz; }
    // right-hand side of travel direction (Y-up, looking along t): right = (-tz, tx)
    out.x = p0[0] + (p1[0] - p0[0]) * t - tz * offset;
    out.z = p0[1] + (p1[1] - p0[1]) * t + tx * offset;
    out.tx = tx; out.tz = tz;
    return out;
  }

  laneOffset(e) { return Math.min(3.6, e.width * 0.25); }
  sidewalkOffset(e) { return e.width * 0.5 + 1.8; }

  /** next edge after arriving at node n from edge ei (avoid u-turns unless dead end) */
  nextEdge(ei, n, rnd = Math.random) {
    const opts = this.adj[n].filter((x) => x !== ei);
    if (!opts.length) return { e: ei, dir: this.edges[ei].a === n ? 1 : -1 };
    const e = opts[Math.floor(rnd() * opts.length)];
    return { e, dir: this.edges[e].a === n ? 1 : -1 };
  }

  nearest(x, z, maxD = 1e9) {
    let best = null, bd = maxD * maxD;
    const tmp = {};
    this.edges.forEach((e, ei) => {
      for (let i = 1; i < e.pts.length; i++) {
        const [ax, az] = e.pts[i - 1], [bx, bz] = e.pts[i];
        const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9;
        let t = ((x - ax) * dx + (z - az) * dz) / L2; t = Math.max(0, Math.min(1, t));
        const px = ax + dx * t, pz = az + dz * t, d = (px - x) ** 2 + (pz - z) ** 2;
        if (d < bd) { bd = d; best = { e: ei, s: e.len[i - 1] + Math.sqrt(L2) * t, x: px, z: pz, dist: Math.sqrt(d) }; }
      }
    });
    void tmp;
    return best;
  }

  nearestNode(x, z) {
    let best = 0, bd = Infinity;
    this.nodes.forEach((n, i) => { const d = (n[0] - x) ** 2 + (n[1] - z) ** 2; if (d < bd && this.adj[i].length) { bd = d; best = i; } });
    return best;
  }

  /** Dijkstra on nodes; returns polyline [[x,z],...] from (x0,z0) to (x1,z1). */
  route(x0, z0, x1, z1) {
    const s = this.nearestNode(x0, z0), t = this.nearestNode(x1, z1);
    const N = this.nodes.length, dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), prevE = new Int32Array(N).fill(-1);
    const done = new Uint8Array(N);
    dist[s] = 0;
    for (;;) {
      let u = -1, du = Infinity;
      for (let i = 0; i < N; i++) if (!done[i] && dist[i] < du) { du = dist[i]; u = i; }
      if (u < 0 || u === t) break;
      done[u] = 1;
      for (const ei of this.adj[u]) {
        const e = this.edges[ei], v = e.a === u ? e.b : e.a;
        if (dist[u] + e.length < dist[v]) { dist[v] = dist[u] + e.length; prev[v] = u; prevE[v] = ei; }
      }
    }
    if (prev[t] < 0 && s !== t) return [[x0, z0], [x1, z1]];
    const out = [[x1, z1]];
    for (let v = t; v !== s; v = prev[v]) {
      const e = this.edges[prevE[v]];
      const pts = e.a === v ? e.pts : [...e.pts].reverse();
      for (const p of pts) out.push(p);
    }
    out.push([x0, z0]);
    return out.reverse();
  }

  randomLane(rnd = Math.random) {
    const total = this.edges.reduce((a, e) => a + e.length, 0);
    let r = rnd() * total;
    for (let i = 0; i < this.edges.length; i++) { r -= this.edges[i].length; if (r <= 0) return { e: i, s: rnd() * this.edges[i].length, dir: rnd() < 0.5 ? 1 : -1 }; }
    return { e: 0, s: 0, dir: 1 };
  }
}
