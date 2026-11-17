// Traffic + AI driving (cruise / pursue / flee / route) over the road graph.
import { G } from './state.js';
import { nodes, HALF, LANE_OFF, P, NX, NZ, nearestNode, findPath, lightPhase, hasLights, isRoad, CITY } from './layout.js';
import { clamp, angleDiff, rand, pick, chance } from './util.js';
import { TRAFFIC_MIX, CAR_TYPES } from './vehicle.js';
import { randomOutfit } from './character.js';

function laneGeom(a, b, lane) {
  const A = nodes[a], B = nodes[b];
  let dx = B.x - A.x, dz = B.z - A.z; const L = Math.hypot(dx, dz); dx /= L; dz /= L;
  const rx = -dz, rz = dx, off = LANE_OFF[lane];
  return { A, B, dx, dz, rx, rz, off, L };
}

export class Driver {
  constructor(v, opts = {}) {
    this.v = v;
    this.mode = opts.mode || 'cruise';
    this.lane = opts.lane ?? (chance(0.5) ? 0 : 1);
    this.cruise = opts.speed || rand(10.5, 14.5);
    this.queue = [];
    this.from = null; this.to = null;
    this.stuck = 0; this.reverseT = 0;
    this.target = opts.target || null;
    this.aggressive = !!opts.aggressive;
    this.ignoreLights = !!opts.ignoreLights;
    this.hornT = 0;
    this.route = opts.route || null; // array of {x,z}
    this.routeIdx = 0;
    this.blockedT = 0;
    this.onArrive = opts.onArrive || null;
    this.slowRadius = opts.slowRadius ?? 0;
  }

  setEdge(a, b) {
    this.from = a; this.to = b;
    this.queue.length = 0;
    this.pushEdge(a, b);
  }

  pushEdge(a, b) {
    const g = laneGeom(a, b, this.lane);
    const s0 = HALF + 3, s1 = g.L - HALF - 5.2;
    for (let s = s0; s <= s1; s += 9) this.queue.push({ x: g.A.x + g.dx * s + g.rx * g.off, z: g.A.z + g.dz * s + g.rz * g.off });
    this.queue.push({ x: g.A.x + g.dx * s1 + g.rx * g.off, z: g.A.z + g.dz * s1 + g.rz * g.off, stop: b, axis: Math.abs(g.dz) > 0.5 ? 'ns' : 'ew' });
    this.lastEdge = { a, b, g };
  }

  chooseNext() {
    const { a, b, g } = this.lastEdge;
    const B = nodes[b];
    let opts = B.links.filter((n) => n !== a);
    if (!opts.length) opts = [a];
    let c;
    if (this.mode === 'flee') {
      const pl = G.player;
      c = opts.reduce((best, n) => { const d = Math.hypot(nodes[n].x - pl.x, nodes[n].z - pl.z) + rand(0, 40); return d > best.d ? { n, d } : best; }, { n: opts[0], d: -1 }).n;
    } else if (this.mode === 'pursue' && this.path && this.path.length) {
      c = this.path.shift();
      if (!B.links.includes(c)) c = pick(opts);
    } else {
      // prefer straight
      const straight = opts.find((n) => { const N = nodes[n]; const dx = N.x - B.x, dz = N.z - B.z, L = Math.hypot(dx, dz); return dx / L * g.dx + dz / L * g.dz > 0.9; });
      c = straight && chance(0.55) ? straight : pick(opts);
    }
    // turn curve
    const g2 = laneGeom(b, c, this.lane);
    const e = this.queue.length ? this.queue[this.queue.length - 1] : { x: B.x, z: B.z };
    const sx = B.x + g2.dx * (HALF + 3) + g2.rx * g2.off, sz = B.z + g2.dz * (HALF + 3) + g2.rz * g2.off;
    const dot = g.dx * g2.dx + g.dz * g2.dz;
    if (dot < -0.5) {
      // U-turn: wide arc
      for (let k = 1; k <= 6; k++) { const t = k / 7; const ang = Math.PI * t; this.queue.push({ x: B.x + g.dx * Math.sin(ang) * 4 + g.rx * g.off * Math.cos(ang), z: B.z + g.dz * Math.sin(ang) * 4 + g.rz * g.off * Math.cos(ang), turn: true }); }
    } else if (dot < 0.5) {
      const cx = B.x + g.rx * g.off + g2.rx * g2.off, cz = B.z + g.rz * g.off + g2.rz * g2.off;
      for (let k = 1; k <= 5; k++) {
        const t = k / 6, u = 1 - t;
        this.queue.push({ x: u * u * e.x + 2 * u * t * cx + t * t * sx, z: u * u * e.z + 2 * u * t * cz + t * t * sz, turn: true });
      }
    }
    this.pushEdge(b, c);
  }

  // initialise on nearest lane to vehicle position
  snapToRoad() {
    const v = this.v;
    const n = nearestNode(v.x, v.z);
    let best = null, bd = Infinity;
    for (const m of n.links) {
      for (const [a, b] of [[n.id, m], [m, n.id]]) {
        const g = laneGeom(a, b, this.lane);
        const px = v.x - (g.A.x + g.rx * g.off), pz = v.z - (g.A.z + g.rz * g.off);
        const s = clamp(px * g.dx + pz * g.dz, 0, g.L);
        const qx = g.A.x + g.dx * s + g.rx * g.off, qz = g.A.z + g.dz * s + g.rz * g.off;
        let d = Math.hypot(qx - v.x, qz - v.z);
        d += Math.abs(angleDiff(v.h, Math.atan2(g.dx, g.dz))) * 6;
        if (d < bd) { bd = d; best = { a, b, s }; }
      }
    }
    if (best) {
      this.setEdge(best.a, best.b);
      // drop points behind
      const v2 = this.v;
      while (this.queue.length > 1) {
        const q = this.queue[0];
        const ahead = (q.x - v2.x) * Math.sin(v2.h) + (q.z - v2.z) * Math.cos(v2.h);
        if (ahead < 3) this.queue.shift(); else break;
      }
    }
  }

  update(dt) {
    const v = this.v;
    const inp = v.input;
    if (v.dead || v.driver === 'player') return;
    if (!v.driver) { inp.throttle = 0; inp.steer = 0; inp.handbrake = true; return; }
    if (this.mode === 'parked') { inp.throttle = 0; inp.handbrake = true; inp.steer = 0; return; }
    let tx, tz, target = this.cruise;
    const sp = v.vF;
    // ---- choose target point ----
    if (this.mode === 'pursue' || this.mode === 'ram') {
      const T = this.target || G.player;
      const d = Math.hypot(T.x - v.x, T.z - v.z);
      const los = d < 60 && G.world.statics.lineOfSight(v.x, v.y + 1.2, v.z, T.x, (T.y || 0) + 1.2, T.z);
      if (los || d < 22) {
        const tv = T.inVehicle || (T.vx !== undefined ? T : null);
        const lead = clamp(d / 30, 0, 1.2);
        tx = T.x + (tv ? (tv.vx || 0) * lead : 0); tz = T.z + (tv ? (tv.vz || 0) * lead : 0);
        target = this.aggressive ? 60 : 38;
        if (d < 14 && !(T.inVehicle) && this.mode === 'pursue') target = Math.max(0, (d - 7) * 1.5);
        this.queue.length = 0;
      } else {
        this.repathT = (this.repathT || 0) - dt;
        if (this.repathT <= 0 || !this.queue.length) {
          this.repathT = 2.5;
          const from = nearestNode(v.x, v.z), to = nearestNode(T.x, T.z);
          this.path = findPath(from.id, to.id);
          this.queue.length = 0;
          if (this.path.length >= 2) { this.path.shift(); const nx = this.path.shift(); this.lane = 0; this.lastEdge = null; this.setEdge(from.id, nx); }
          else { this.queue.push({ x: T.x, z: T.z }); }
        }
        target = 34;
      }
    } else if (this.mode === 'route') {
      const r = this.route[this.routeIdx];
      if (!r) { inp.throttle = 0; inp.handbrake = true; inp.steer = 0; return; }
      tx = r.x; tz = r.z;
      target = r.speed || this.cruise;
      const d = Math.hypot(tx - v.x, tz - v.z);
      if (d < (r.radius || 10)) {
        this.routeIdx++;
        if (this.routeIdx >= this.route.length && this.onArrive) this.onArrive(this);
      }
      // look ahead slowdown at sharp corners
      const nxt = this.route[this.routeIdx + 1];
      if (nxt && d < 30) {
        const a1 = Math.atan2(tx - v.x, tz - v.z), a2 = Math.atan2(nxt.x - tx, nxt.z - tz);
        const turn = Math.abs(angleDiff(a1, a2));
        if (turn > 0.8) target = Math.min(target, 13 + (1 - turn / Math.PI) * 10 + d * 0.4);
      }
    }
    if (tx === undefined) {
      if (!this.queue.length || !this.lastEdge) this.snapToRoad();
      if (this.queue.length < 8 && this.lastEdge) this.chooseNext();
      const look = clamp(Math.abs(sp) * 0.35, 3.5, 9);
      while (this.queue.length > 1) {
        const q = this.queue[0];
        const d = Math.hypot(q.x - v.x, q.z - v.z);
        const ahead = (q.x - v.x) * Math.sin(v.h) + (q.z - v.z) * Math.cos(v.h);
        if (d < look || ahead < 0.5) {
          if (q.stop !== undefined) this.passedStop = q.stop;
          this.queue.shift();
        } else break;
      }
      const q = this.queue[0];
      if (!q) return;
      tx = q.x; tz = q.z;
      if (this.queue.slice(0, 3).some((p) => p.turn)) target = Math.min(target, this.mode === 'flee' ? 15 : 8);
      if (this.mode === 'flee') target = Math.max(target, 24);
      // traffic lights
      if (!this.ignoreLights && this.mode === 'cruise') {
        const sq = this.queue.find((p) => p.stop !== undefined);
        if (sq) {
          const ds = Math.hypot(sq.x - v.x, sq.z - v.z);
          const n = nodes[sq.stop];
          if (hasLights(n) && ds < 30) {
            const ph = lightPhase(n.id, G.time);
            if (ph !== sq.axis && ds > 1.2) {
              const yellowClose = ph === 'y_' + sq.axis && ds < 8;
              if (!yellowClose) target = Math.min(target, Math.max(0, (ds - 1.5) * 0.9));
            }
          }
        }
      }
    }
    // ---- obstacle awareness (cruise / flee / route) ----
    if (this.mode !== 'pursue' && this.mode !== 'ram') {
      const fx = Math.sin(v.h), fz = Math.cos(v.h);
      let minD = 99, blockSpeed = 0, blocker = null;
      for (const o of G.vehicles.list) {
        if (o === v) continue;
        const dx = o.x - v.x, dz = o.z - v.z;
        const ahead = dx * fx + dz * fz;
        if (ahead < 0 || ahead > 22) continue;
        const lat = Math.abs(dx * fz - dz * fx);
        if (lat > 2.4) continue;
        if (ahead < minD) { minD = ahead; blockSpeed = Math.max(0, o.vx * fx + o.vz * fz); blocker = o; }
      }
      // pedestrians / player
      const pl = G.player;
      const chk = [pl.inVehicle ? null : pl.char];
      for (const p of G.pedSys.list) if (!p.char.dead && Math.abs(p.x - v.x) < 20 && Math.abs(p.z - v.z) < 20) chk.push(p.char);
      for (const c of chk) {
        if (!c) continue;
        const dx = c.x - v.x, dz = c.z - v.z;
        const ahead = dx * fx + dz * fz;
        if (ahead < 0 || ahead > 14) continue;
        if (Math.abs(dx * fz - dz * fx) > 1.8) continue;
        if (ahead < minD) { minD = ahead; blockSpeed = 0; blocker = c === pl.char ? 'player' : 'ped'; }
      }
      if (minD < 99 && this.mode !== 'flee') {
        const L = v.t.L;
        target = Math.min(target, blockSpeed + Math.max(0, minD - L - 2.5) * 0.8);
        if (minD < L + 3 && Math.abs(sp) < 1) {
          this.blockedT += dt;
          if (this.blockedT > 2 && blocker === 'player' && this.hornT <= 0) { G.audio && G.audio.horn(v.x, v.z, true); this.hornT = rand(2, 4); }
        } else this.blockedT = 0;
      }
      this.hornT -= dt;
    }
    // ---- steering ----
    const hd = Math.atan2(tx - v.x, tz - v.z);
    let err = angleDiff(v.h, hd);
    let steer = clamp(-err * 2.2, -1, 1);
    // throttle
    let thr = clamp((target - sp) * 0.35, -1, 1);
    if (Math.abs(err) > 1.2 && sp > 8) thr = Math.min(thr, -0.3);
    // stuck recovery
    if (this.reverseT > 0) {
      this.reverseT -= dt;
      inp.throttle = -1; inp.steer = -this.revSteer; inp.handbrake = false; inp.nitro = false;
      return;
    }
    if (thr > 0.3 && Math.abs(sp) < 1.2) {
      this.stuck += dt;
      if (this.stuck > (this.mode === 'cruise' ? 4 : 1.4)) { this.stuck = 0; this.reverseT = rand(0.8, 1.4); this.revSteer = steer >= 0 ? 1 : -1; if (this.mode === 'cruise') this.lastEdge = null; }
    } else this.stuck = Math.max(0, this.stuck - dt);
    inp.throttle = thr;
    inp.steer = steer;
    inp.handbrake = (this.mode === 'pursue' || this.mode === 'route' || this.mode === 'ram') && Math.abs(err) > 1.0 && sp > 14;
    inp.nitro = this.aggressive && Math.abs(err) < 0.2 && sp > 10 && v.nitroMax > 0;
  }
}

export class TrafficSystem {
  constructor() {
    this.max = 26;
    this.spawnT = 0;
  }
  count() { let n = 0; for (const v of G.vehicles.list) if (v.traffic && !v.dead) n++; return n; }

  spawnOne() {
    const pl = G.player;
    // random node near player
    const n0 = nearestNode(pl.x + rand(-200, 200), pl.z + rand(-200, 200));
    if (n0.island) return;
    const m = pick(n0.links);
    if (m === undefined || nodes[m].island) return;
    const [a, b] = chance(0.5) ? [n0.id, m] : [m, n0.id];
    const lane = chance(0.5) ? 0 : 1;
    const g = laneGeom(a, b, lane);
    const s = rand(HALF + 6, g.L - HALF - 12);
    const x = g.A.x + g.dx * s + g.rx * g.off, z = g.A.z + g.dz * s + g.rz * g.off;
    const d = Math.hypot(x - pl.x, z - pl.z);
    if (d < 75 || d > 230) return;
    // don't spawn on top of other cars
    for (const v of G.vehicles.list) if (Math.abs(v.x - x) < 9 && Math.abs(v.z - z) < 9) return;
    // avoid spawning in view if close
    if (d < 120 && this.inView(x, z)) return;
    const type = pick(TRAFFIC_MIX);
    const v = G.vehicles.spawn(type, x, z, Math.atan2(g.dx, g.dz));
    v.traffic = true;
    v.driver = { team: 'civ', outfit: randomOutfit() };
    const ai = new Driver(v, { lane });
    ai.setEdge(a, b);
    while (ai.queue.length > 1 && ((ai.queue[0].x - x) * g.dx + (ai.queue[0].z - z) * g.dz) < 2) ai.queue.shift();
    v.ai = ai;
    const sp = ai.cruise * 0.8;
    v.vx = g.dx * sp; v.vz = g.dz * sp;
    return v;
  }

  inView(x, z) {
    const cam = G.camera;
    const dx = x - cam.position.x, dz = z - cam.position.z;
    const fx = -Math.sin(cam.rotation.y), fz = -Math.cos(cam.rotation.y);
    const cd = cam.getWorldDirection ? null : null;
    void cd;
    const dir = G._camDir;
    const L = Math.hypot(dx, dz) || 1;
    const dot = (dx * dir.x + dz * dir.z) / (L * (Math.hypot(dir.x, dir.z) || 1));
    void fx; void fz;
    return dot > 0.55;
  }

  update(dt) {
    this.spawnT -= dt;
    const night = G.sky ? G.sky.night : 0;
    const max = Math.round(this.max * (G.settings.quality === 'low' ? 0.6 : 1) * (1 - night * 0.3));
    if (this.spawnT <= 0) {
      this.spawnT = 0.25;
      if (this.count() < max) this.spawnOne();
    }
    const pl = G.player;
    for (const v of G.vehicles.list.slice()) {
      if (!v.traffic || v.persistent || v.driver === 'player') continue;
      const d = Math.hypot(v.x - pl.x, v.z - pl.z);
      if (d > 280 || (v.dead && d > 120)) G.vehicles.remove(v);
      else if (!v.driver && !v.dead && d > 160) G.vehicles.remove(v);
    }
  }
}
