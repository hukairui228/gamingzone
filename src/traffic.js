import * as THREE from 'three';
import { Vehicle } from './vehicle.js';

const CIVIL = ['car_taxi', 'car_buck', 'car_cooperv8_berlin', 'car_cooperv8_hatchback', 'car_homm', 'car_laufer', 'car_tawny',
  'car_plymouth', 'car_suv_detour', 'car_truck', 'car_van', 'car_vamp', 'car_limo', 'car_delivery', 'car_lamb'];
const WEIGHT = { car_lamb: 0.3, car_limo: 0.4, car_delivery: 0.6, car_laufer: 0.6 };
const _pt = {}, _v = new THREE.Vector3();

export class Traffic {
  constructor(game) {
    this.g = game;
    this.cars = [];
    this.max = 22;
    this.timer = 0;
    this.loading = 0;
  }

  pickModel() {
    const tot = CIVIL.reduce((a, m) => a + (WEIGHT[m] || 1), 0);
    let r = Math.random() * tot;
    for (const m of CIVIL) { r -= WEIGHT[m] || 1; if (r <= 0) return m; }
    return CIVIL[0];
  }

  async spawn(model, lane, opts = {}) {
    const g = this.g, R = g.roads;
    this.loading++;
    const v = await new Vehicle(model).load().finally(() => this.loading--);
    const e = R.edges[lane.e];
    R.point(e, lane.dir, lane.s, R.laneOffset(e), _pt);
    const y = g.world.height(_pt.x, _pt.z, 60);
    if (y === -Infinity) return null;
    v.place(_pt.x, y, _pt.z, Math.atan2(_pt.tx, _pt.tz));
    v.ai = { e: lane.e, dir: lane.dir, s: lane.s, speed: opts.speed ?? 10, cruise: opts.cruise ?? 9 + Math.random() * 5, mode: 'lane', stuck: 0 };
    v.driver = opts.driver ?? 'npc';
    g.scene.add(v.root);
    this.cars.push(v);
    return v;
  }

  remove(v) {
    const i = this.cars.indexOf(v);
    if (i >= 0) this.cars.splice(i, 1);
    this.g.scene.remove(v.root);
    if (this.g.audio) this.g.audio.stopLoop('npc_' + v.root.id);
  }

  /** Release a car from lane-following (player jacked it, crash, police). */
  detach(v) {
    const i = this.cars.indexOf(v);
    if (i >= 0) this.cars.splice(i, 1);
    v.ai = null;
  }

  update(dt) {
    const g = this.g, R = g.roads, P = g.focus;
    // spawn / despawn
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 0.4;
      for (const v of [...this.cars]) {
        const d = Math.hypot(v.pos.x - P.x, v.pos.z - P.z);
        if (d > 260 && !v.mission) this.remove(v);
      }
      if (this.cars.length + this.loading < this.max * g.trafficDensity) {
        for (let k = 0; k < 6; k++) {
          const lane = R.randomLane();
          const e = R.edges[lane.e];
          R.point(e, lane.dir, lane.s, R.laneOffset(e), _pt);
          const d = Math.hypot(_pt.x - P.x, _pt.z - P.z);
          if (d < 90 || d > 220) continue;
          if (this.cars.some((c) => Math.hypot(c.pos.x - _pt.x, c.pos.z - _pt.z) < 14)) continue;
          const cop = Math.random() < 0.07;
          this.spawn(cop ? 'car_police_poor' : this.pickModel(), lane, { driver: cop ? 'cop' : 'npc' });
          break;
        }
      }
    }
    for (const v of this.cars) this.drive(v, dt);
  }

  drive(v, dt) {
    const g = this.g, R = g.roads, ai = v.ai;
    if (!ai) return;
    if (ai.mode === 'physics') {
      v.update(dt, { throttle: 0, steer: 0, handbrake: true }, g.world);
      ai.calm = (ai.calm || 0) + dt;
      if (ai.calm > 6 && v.speed < 0.5 && v.health > 0 && v.driver) this.reattach(v);
      return;
    }
    if (ai.mode === 'parked') return;
    let e = R.edges[ai.e];
    // obstacle ahead: other cars / player / peds
    const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
    let block = 99;
    const scan = (x, z, r) => {
      const dx = x - v.pos.x, dz = z - v.pos.z;
      const fwd = dx * fx + dz * fz;
      if (fwd < 0 || fwd > 22) return;
      const side = Math.abs(dx * fz - dz * fx);
      if (side < 2.2 + r) block = Math.min(block, fwd);
    };
    for (const o of g.vehicles()) {
      if (o === v) continue;
      scan(o.pos.x, o.pos.z, 0.6);
      // crossing traffic at junctions: yield to a car close by in our front half; when both have the other in
      // front (meeting at right angles) one fixed car of the pair gives way, so they never drive into each other
      const dx = o.pos.x - v.pos.x, dz = o.pos.z - v.pos.z, d = Math.hypot(dx, dz);
      if (d > 11 || d < 0.1) continue;
      const mine = (dx * fx + dz * fz) / d;
      if (mine < 0.25) continue;
      // parallel or oncoming cars in other lanes are the straight scan's business
      if (Math.abs(fx * Math.sin(o.yaw) + fz * Math.cos(o.yaw)) > 0.8) continue;
      const theirs = -(dx * Math.sin(o.yaw) + dz * Math.cos(o.yaw)) / d;
      if (theirs > 0.25 && o.ai && o.ai.mode === 'lane' && v.root.id < o.root.id) continue;
      block = Math.min(block, d * mine);
    }
    if (!g.player.vehicle) scan(g.player.pos.x, g.player.pos.z, 0.3);
    for (const p of g.peds.list) if (!p.dead) scan(p.pos.x, p.pos.z, 0.2);
    let target = ai.cruise;
    if (block < 22) target = Math.min(target, Math.max(0, (block - 6) * 1.1));
    // slow for curves
    R.point(e, ai.dir, ai.s + 10, 0, _pt);
    const curve = Math.abs(Math.atan2(_pt.tx * fz - _pt.tz * fx, _pt.tx * fx + _pt.tz * fz));
    target = Math.min(target, 16 - curve * 9);
    if (g.honk && block < 8 && Math.random() < dt * 0.4) g.audio.play('sfx_npc_horn', { vol: g.audioVol(v.pos, 0.6) });
    ai.speed += THREE.MathUtils.clamp(target - ai.speed, -12 * dt, 4 * dt);
    ai.s += ai.speed * dt;
    while (ai.s > e.length) {
      ai.s -= e.length;
      const node = ai.dir > 0 ? e.b : e.a;
      const nx = R.nextEdge(ai.e, node);
      ai.e = nx.e; ai.dir = nx.dir; e = R.edges[ai.e];
    }
    R.point(e, ai.dir, ai.s, R.laneOffset(e), _pt);
    const k = Math.min(1, dt * 6);
    v.pos.x += (_pt.x - v.pos.x) * k;
    v.pos.z += (_pt.z - v.pos.z) * k;
    const h = g.world.height(v.pos.x, v.pos.z, v.pos.y + 1.5);
    if (h > -Infinity) v.pos.y += (h - v.pos.y) * Math.min(1, dt * 10);
    const yaw = Math.atan2(_pt.tx, _pt.tz);
    let dy = yaw - v.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    v.yaw += dy * Math.min(1, dt * 5);
    v.vf = ai.speed; v.vs = 0;
    // wheel angle from the turn rate actually driven (bicycle model), not from the raw heading error
    const yawRate = dy * Math.min(1, dt * 5) / Math.max(dt, 1e-3);
    v.steer = THREE.MathUtils.clamp(-Math.atan2(yawRate * v.wheelBase, Math.max(3, v.vf)), -0.5, 0.5);
    v.root.rotation.set(0, v.yaw, 0);
    v.animateWheels(dt);
  }

  reattach(v) {
    const R = this.g.roads;
    const n = R.nearest(v.pos.x, v.pos.z, 12);
    if (!n) return;
    const e = R.edges[n.e];
    R.point(e, 1, n.s, 0, _pt);
    const dir = _pt.tx * Math.sin(v.yaw) + _pt.tz * Math.cos(v.yaw) > 0 ? 1 : -1;
    v.ai = { e: n.e, dir, s: dir > 0 ? n.s : e.length - n.s, speed: 0, cruise: 9 + Math.random() * 4, mode: 'lane' };
  }

  /** Simple impulse response between two cars (approximated by circles). */
  static collide(a, b, onHit) {
    const ra = Math.max(a.width, a.length) * 0.42, rb = Math.max(b.width, b.length) * 0.42;
    const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
    if (Math.abs(a.pos.y - b.pos.y) > 2.5) return;
    const d = Math.hypot(dx, dz);
    if (d > ra + rb || d < 1e-3) return;
    // refine with oriented boxes: separation along the line between centres
    const nx = dx / d, nz = dz / d;
    const ext = (v, x, z) => Math.abs(Math.sin(v.yaw) * x + Math.cos(v.yaw) * z) * v.length * 0.5 +
      Math.abs(Math.cos(v.yaw) * x - Math.sin(v.yaw) * z) * v.width * 0.5;
    const pen = ext(a, nx, nz) + ext(b, nx, nz) - d;
    if (pen <= 0) return;
    const va = _v.set(Math.sin(a.yaw) * a.vf, 0, Math.cos(a.yaw) * a.vf);
    const vax = va.x, vaz = va.z;
    const vbx = Math.sin(b.yaw) * b.vf, vbz = Math.cos(b.yaw) * b.vf;
    const rel = (vax - vbx) * nx + (vaz - vbz) * nz;
    const ma = a.def.mass || 1, mb = b.def.mass || 1;
    a.pos.x -= nx * pen * mb / (ma + mb); a.pos.z -= nz * pen * mb / (ma + mb);
    b.pos.x += nx * pen * ma / (ma + mb); b.pos.z += nz * pen * ma / (ma + mb);
    if (rel > 0) {
      const j = rel * 1.3;
      const ax = vax - nx * j * mb / (ma + mb), az = vaz - nz * j * mb / (ma + mb);
      const bx = vbx + nx * j * ma / (ma + mb), bz = vbz + nz * j * ma / (ma + mb);
      a.vf = ax * Math.sin(a.yaw) + az * Math.cos(a.yaw);
      b.vf = bx * Math.sin(b.yaw) + bz * Math.cos(b.yaw);
      a.vs = ax * Math.cos(a.yaw) - az * Math.sin(a.yaw);
      b.vs = bx * Math.cos(b.yaw) - bz * Math.sin(b.yaw);
      if (onHit) onHit(a, b, rel);
    }
  }
}
