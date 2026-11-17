import * as THREE from 'three';
import { buildModel } from './models.js';

// Original Gangstar 2 vehicles (names from the game's own text table) with handling + engine sound bank.
export const CARS = {
  car_taxi: { name: '出租车', speed: 46, accel: 13, grip: 7.5, engine: 'v6na' },
  car_buck: { name: "Lil'Alice", speed: 44, accel: 12, grip: 7, engine: 'v6na' },
  car_cooperv8_berlin: { name: 'W4C', speed: 50, accel: 15, grip: 8.5, engine: 'cyl4' },
  car_cooperv8_hatchback: { name: 'W4C-H', speed: 48, accel: 15, grip: 8.5, engine: 'cyl4' },
  car_homm: { name: 'Homm', speed: 55, accel: 17, grip: 8.5, engine: 'v6t' },
  car_homm_black: { name: 'Homm', speed: 55, accel: 17, grip: 8.5, engine: 'v6t' },
  car_lamb: { name: 'Sorraia', speed: 68, accel: 24, grip: 10, engine: 'murcielago' },
  car_lamb_01: { name: 'Sorraia', speed: 68, accel: 24, grip: 10, engine: 'murcielago' },
  car_laufer: { name: 'Läufer', speed: 62, accel: 21, grip: 9.5, engine: 'ruf' },
  car_laufer_black: { name: 'Läufer', speed: 62, accel: 21, grip: 9.5, engine: 'ruf' },
  car_limo: { name: 'Limousine', speed: 42, accel: 10, grip: 6, engine: 'v6na', mass: 1.6 },
  car_plymouth: { name: 'Superlative', speed: 54, accel: 18, grip: 7, engine: 'z06' },
  car_plymouth_barracuda: { name: 'Galoppino', speed: 56, accel: 19, grip: 7, engine: 'z06' },
  car_plymouth_flames: { name: 'Galoppino', speed: 56, accel: 19, grip: 7, engine: 'z06' },
  car_police_rich: { name: '警车', speed: 58, accel: 19, grip: 9, engine: 'v6t', police: true },
  car_police_poor: { name: '警车', speed: 54, accel: 17, grip: 8.5, engine: 'v6na', police: true },
  car_suv_cop: { name: '警车', speed: 52, accel: 16, grip: 8, engine: 'sb', police: true, mass: 1.4 },
  car_suv_fbi: { name: 'Grand Detour', speed: 54, accel: 17, grip: 8, engine: 'sb', police: true, mass: 1.4 },
  car_suv_detour: { name: 'Grand Detour', speed: 50, accel: 15, grip: 8, engine: 'sb', mass: 1.4 },
  car_tawny: { name: 'Tawny 40o', speed: 48, accel: 13, grip: 7.5, engine: 'cyl4' },
  car_truck: { name: 'D340', speed: 44, accel: 12, grip: 6.5, engine: 'f450', mass: 1.5 },
  car_truck_redneck: { name: 'D340', speed: 46, accel: 13, grip: 6.5, engine: 'f450', mass: 1.5 },
  car_van: { name: 'Box ES', speed: 40, accel: 10, grip: 6, engine: 'f450', mass: 1.7 },
  car_van_white: { name: 'Box ES', speed: 40, accel: 10, grip: 6, engine: 'f450', mass: 1.7 },
  car_vamp: { name: 'VampSquid', speed: 60, accel: 20, grip: 9, engine: 'v6t' },
  car_vamp_green: { name: 'VampSquid', speed: 60, accel: 20, grip: 9, engine: 'v6t' },
  car_ambulance: { name: '救护车', speed: 46, accel: 12, grip: 6.5, engine: 'f450', mass: 1.7 },
  car_bearcat: { name: 'Teddy', speed: 42, accel: 11, grip: 7, engine: 'f450', police: true, mass: 2.5 },
  car_delivery: { name: '送货车', speed: 38, accel: 9, grip: 6, engine: 'f450', mass: 1.8 },
  car_hearse: { name: '灵车', speed: 44, accel: 11, grip: 6.5, engine: 'v6na', mass: 1.4 },
  bike_harley: { name: 'Fat Damsel', type: 'bike', speed: 52, accel: 18, grip: 8, engine: 'npc_harley', mass: 0.5 },
  bike_harley_black: { name: 'Fat Damsel', type: 'bike', speed: 52, accel: 18, grip: 8, engine: 'npc_harley', mass: 0.5 },
  bike_dirt: { name: 'Sanchez', type: 'bike', speed: 48, accel: 20, grip: 8, engine: 'motocross', mass: 0.4 },
  bike_kawa: { name: 'Yamakasi', type: 'bike', speed: 62, accel: 24, grip: 9, engine: 'npc_bike', mass: 0.4 },
  bike_kawa_sport: { name: 'Yamakasi', type: 'bike', speed: 64, accel: 25, grip: 9, engine: 'npc_bike', mass: 0.4 },
  boat_speedboat_cigar: { name: 'Sea-Gar', type: 'boat', speed: 50, accel: 14, grip: 2.5, engine: 'boat', mass: 2 },
  boat_speedboat_riva: { name: 'Feresa', type: 'boat', speed: 44, accel: 12, grip: 2.5, engine: 'boat', mass: 1.6 },
  boat_speedboat_yacht: { name: 'Megaptera', type: 'boat', speed: 34, accel: 7, grip: 2, engine: 'boat', mass: 4 },
  boat_speedboat_police: { name: '警艇', type: 'boat', speed: 48, accel: 13, grip: 2.5, engine: 'boat', police: true, mass: 2 },
  boat_seadoo: { name: 'Sea-Ride', type: 'boat', speed: 40, accel: 16, grip: 3.5, engine: 'boat', mass: 0.6 },
  boat_floatingpoint_single: { name: 'Floating Point', type: 'boat', speed: 38, accel: 12, grip: 2.2, engine: 'airboat', mass: 0.9, swamp: true },
  heli_police: { name: '直升机', type: 'heli', speed: 40, accel: 10, grip: 3, engine: 'helicopter', police: true },
  heli_news: { name: '直升机', type: 'heli', speed: 40, accel: 10, grip: 3, engine: 'helicopter' },
};

const templates = new Map();
const WHEELS = ['wheel_front_left', 'wheel_front_right', 'wheel_back_left', 'wheel_back_right', 'wheel_front', 'wheel_back'];
const _fw = new THREE.Vector3(), _rt = new THREE.Vector3(), _p = new THREE.Vector3();
const _col = { hit: false, nx: 0, nz: 0, depth: 0 };

export class Vehicle {
  constructor(model) {
    this.model = model;
    const d = CARS[model] || CARS.car_taxi;
    // original-feel tuning: brisk but controllable on Miami's short blocks
    this.def = { ...d, speed: d.speed * 0.72, accel: d.accel * 0.55 };
    this.type = d.type || 'car';
    this.root = new THREE.Group();
    this.pos = this.root.position;
    this.yaw = 0;
    this.vf = 0; this.vs = 0; this.vy = 0;
    this.steer = 0; this.spin = 0;
    this.pitch = 0; this.roll = 0;
    this.health = this.type === 'bike' ? 500 : 1000;
    this.onGround = true;
    this.driver = null;
    this.rpm = 0;
    this.impact = 0;
    this.alt = 0;
  }

  async load() {
    let tpl = templates.get(this.model);
    if (!tpl) { tpl = buildModel(this.model, { paint: true, skip: /collision|damage|shadow|water_clipping/ }); templates.set(this.model, tpl); }
    const m = (await tpl).clone(true);
    this.mesh = m;
    this.root.add(m);
    m.updateMatrixWorld(true);
    const n = {};
    m.traverse((o) => { if (o.name && !o.isMesh) n[o.name] = o; });
    this.nodes = n;
    this.wheels = WHEELS.map((k) => n[k]).filter(Boolean);
    this.pivots = this.wheels.map((w) => n[w.name + '_PIVOT'] || w);
    this.rotors = [n.Helis_00, n.Helis_01, n.Helis_00_alpha, n.Helis_01_alpha, n.propellor].filter(Boolean);
    const body = m.getObjectByName('car_body-mesh') || m;
    const box = new THREE.Box3().setFromObject(body);
    this.length = box.max.z - box.min.z;
    this.width = box.max.x - box.min.x;
    this.height = box.max.y - box.min.y;
    this.offsetZ = (box.max.z + box.min.z) / 2;
    const wp = (w) => { const v = new THREE.Vector3(); w.getWorldPosition(v); return v; };
    if (this.type === 'car' && this.wheels.length === 4) {
      this.wheelPos = this.wheels.map(wp);
    } else if (this.type === 'bike' && this.wheels.length === 2) {
      const [f, b] = this.wheels.map(wp);
      this.wheelPos = [f, f.clone(), b, b.clone()];
      this.wheelPos[0].x -= 0.15; this.wheelPos[1].x += 0.15; this.wheelPos[2].x -= 0.15; this.wheelPos[3].x += 0.15;
    } else {
      const hz = this.length * 0.35, hx = this.width * 0.35;
      this.wheelPos = [new THREE.Vector3(hx, 0, hz + this.offsetZ), new THREE.Vector3(-hx, 0, hz + this.offsetZ),
        new THREE.Vector3(hx, 0, -hz + this.offsetZ), new THREE.Vector3(-hx, 0, -hz + this.offsetZ)];
    }
    this.wheelBase = Math.abs(this.wheelPos[0].z - this.wheelPos[2].z) || this.length * 0.6;
    this.track = Math.abs(this.wheelPos[0].x - this.wheelPos[1].x) || this.width * 0.8;
    this.wheelR = 0.33;
    this.root.traverse((o) => { if (o.isMesh) o.userData.vehicle = this; });
    return this;
  }

  forward(v = _fw) { return v.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }

  place(x, y, z, yaw) {
    this.pos.set(x, this.type === 'boat' ? 0 : y, z); this.yaw = yaw; this.vf = this.vs = this.vy = 0;
    this.root.rotation.set(0, yaw, 0);
  }

  get speed() { return Math.abs(this.vf); }

  /** ctl: {throttle -1..1, steer -1..1, handbrake bool, up/down for helicopters} */
  update(dt, ctl, world) {
    if (this.type === 'heli') return this.fly(dt, ctl, world);
    const d = this.def;
    const dead = this.health <= 0;
    const thr = dead ? 0 : ctl.throttle;
    const max = d.speed;
    const boat = this.type === 'boat';
    const traction = boat ? 1 : this.onGround ? 1 : 0.1;
    // longitudinal
    if (thr > 0) {
      if (this.vf < -0.5) this.vf += 30 * dt * traction;
      else this.vf += d.accel * thr * (1 - Math.max(0, this.vf) / max) * dt * traction;
    } else if (thr < 0) {
      if (this.vf > 0.5) this.vf -= (boat ? 12 : 32) * dt * traction;
      else this.vf -= d.accel * 0.55 * -thr * (1 + this.vf / (max * 0.35)) * dt * traction;
    }
    if (ctl.handbrake && this.onGround && !boat) this.vf -= Math.sign(this.vf) * Math.min(Math.abs(this.vf), 14 * dt);
    if (boat) this.vf -= this.vf * (thr === 0 ? 0.5 : 0.12) * dt;
    else if (this.onGround) this.vf -= this.vf * (thr === 0 ? 0.35 : 0.05) * dt + Math.sign(this.vf) * Math.min(Math.abs(this.vf), (thr === 0 ? 1.6 : 0) * dt);

    // steering: bicycle model, reduced at speed
    const target = ctl.steer * (0.62 - Math.min(0.42, Math.abs(this.vf) / max * 0.45));
    this.steer += (target - this.steer) * Math.min(1, dt * 8);
    if (this.onGround || boat) {
      const yawRate = boat ? (this.vf / 6) * this.steer * 1.4 : this.vf / this.wheelBase * Math.tan(this.steer);
      this.yaw -= yawRate * dt;
      const grip = ctl.handbrake && !boat ? 1.2 : d.grip;
      this.vs += yawRate * this.vf * (boat ? 0.25 : 0.08) * dt * (ctl.handbrake ? 3 : 1);
      this.vs -= this.vs * Math.min(1, grip * dt);
    }

    // integrate
    this.forward(_fw);
    _rt.set(_fw.z, 0, -_fw.x);
    const ox = this.pos.x, oz = this.pos.z;
    this.pos.x += (_fw.x * this.vf + _rt.x * this.vs) * dt;
    this.pos.z += (_fw.z * this.vf + _rt.z * this.vs) * dt;

    this.impact = 0;
    if (boat) return this.floatOnWater(dt, world, ox, oz, thr);

    // walls: circles along the body
    const r = Math.max(0.45, this.width * 0.5);
    const half = Math.max(0, this.length * 0.5 - r);
    for (const k of [-1, 0, 1]) {
      _p.set(this.pos.x + _fw.x * (half * k + this.offsetZ), this.pos.y, this.pos.z + _fw.z * (half * k + this.offsetZ));
      const px = _p.x, pz = _p.z;
      world.collide(_p, r, 1.4, _col);
      if (_col.hit) {
        this.pos.x += _p.x - px; this.pos.z += _p.z - pz;
        const vx = _fw.x * this.vf + _rt.x * this.vs, vz = _fw.z * this.vf + _rt.z * this.vs;
        const vn = vx * _col.nx + vz * _col.nz;
        if (vn < 0) {
          const nvx = vx - vn * _col.nx * 1.35, nvz = vz - vn * _col.nz * 1.35;
          this.vf = nvx * _fw.x + nvz * _fw.z;
          this.vs = nvx * _rt.x + nvz * _rt.z;
          this.impact = Math.max(this.impact, -vn);
        }
      }
    }
    if (this.impact > 4) this.health -= (this.impact - 4) * 9;

    // suspension: sample ground under the wheels
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const gh = [];
    for (let i = 0; i < 4; i++) {
      const w = this.wheelPos[i];
      const wx = this.pos.x + w.x * cy + w.z * sy, wz = this.pos.z - w.x * sy + w.z * cy;
      let h = world.height(wx, wz, this.pos.y + 0.6, 1.0);
      if (h === -Infinity) h = -3;
      gh.push(h);
    }
    const hf = (gh[0] + gh[1]) / 2, hb = (gh[2] + gh[3]) / 2, hl = (gh[0] + gh[2]) / 2, hr = (gh[1] + gh[3]) / 2;
    const groundY = (hf + hb) / 2;
    if (this.pos.y > groundY + 0.25) { this.onGround = false; this.vy -= 22 * dt; }
    this.pos.y += this.vy * dt;
    if (this.pos.y <= groundY) {
      if (!this.onGround && this.vy < -9) this.impact = Math.max(this.impact, -this.vy * 0.5);
      this.pos.y = groundY;
      this.vy = Math.max(0, this.vy);
      this.onGround = true;
    } else if (this.onGround && this.pos.y > groundY) {
      this.pos.y = Math.max(groundY, this.pos.y - 8 * dt);
    }
    if (this.onGround) {
      const ramp = (hf - hb) / this.wheelBase;
      this.vy = ramp > 0.05 ? ramp * this.vf : 0; // ramps launch the car
      this.pitch += (Math.atan2(hf - hb, this.wheelBase) - this.pitch) * Math.min(1, dt * 10);
      const roll = this.type === 'bike' ? -this.steer * Math.min(1, this.speed / 12) * 0.9 : Math.atan2(hl - hr, this.track);
      this.roll += (roll - this.roll) * Math.min(1, dt * (this.type === 'bike' ? 5 : 10));
    } else {
      this.pitch += (-0.05 - this.pitch) * dt;
    }
    const lean = this.type === 'bike' ? 0 : THREE.MathUtils.clamp(this.vs * 0.02 + this.steer * this.vf * 0.004, -0.08, 0.08);
    this.pose(this.roll + lean);

    this.spin += this.vf * dt / this.wheelR;
    this.pivots.forEach((p) => { p.rotation.x = -this.spin; });
    const front = this.wheels.filter((w) => /front/.test(w.name));
    for (const w of front) w.rotation.z = -this.steer;
    this.rpm = THREE.MathUtils.clamp(Math.abs(this.vf) / max, 0, 1);
    if (this.pos.y < -2.5 && this.health > 0) { this.health = 0; this.sunk = true; }
  }

  pose(roll) {
    this.root.rotation.set(0, 0, 0);
    this.root.rotateY(this.yaw);
    this.root.rotateX(-this.pitch);
    this.root.rotateZ(roll);
  }

  floatOnWater(dt, world, ox, oz, thr) {
    // land is a wall for boats (the airboat may cross shallow swamp ground)
    const probe = (x, z) => world.height(x, z, 2, 0);
    const nose = probe(this.pos.x + _fw.x * this.length * 0.45, this.pos.z + _fw.z * this.length * 0.45);
    const here = probe(this.pos.x, this.pos.z);
    const limit = this.def.swamp ? 0.6 : -0.3;
    if (nose > limit || here > limit) {
      this.pos.x = ox; this.pos.z = oz;
      this.impact = Math.abs(this.vf);
      this.vf *= -0.3; this.vs *= 0.5;
    }
    const t = performance.now() / 1000;
    const plane = Math.min(1, this.speed / 15);
    this.pos.y = Math.sin(t * 1.7 + this.pos.x * 0.1) * 0.08 * (1 - plane * 0.5) - 0.15 + plane * 0.2;
    this.pitch += ((plane * 0.12 + thr * 0.03) - this.pitch) * Math.min(1, dt * 3);
    this.roll += (-this.steer * plane * 0.25 + Math.sin(t * 1.3) * 0.03 - this.roll) * Math.min(1, dt * 3);
    this.pose(this.roll);
    this.onGround = true;
    this.rpm = THREE.MathUtils.clamp(Math.abs(this.vf) / this.def.speed, 0, 1);
    for (const r of this.rotors) r.rotation.y += dt * 40;
    if (this.impact > 6) this.health -= this.impact * 5;
  }

  /** Arcade helicopter: throttle = forward tilt, steer = yaw, up/down = collective. */
  fly(dt, ctl, world) {
    const d = this.def;
    this.rotorSpin = Math.min(1, (this.rotorSpin || 0) + dt * (this.health > 0 ? 0.6 : -0.3));
    const lift = this.rotorSpin >= 1 ? (ctl.up ? 1 : 0) - (ctl.down ? 1 : 0) : -0.3;
    this.vy += (lift * 7 - this.vy) * Math.min(1, dt * 2);
    if (this.health <= 0) this.vy -= 15 * dt;
    this.vf += (ctl.throttle * d.speed - this.vf) * Math.min(1, dt * 0.8);
    this.yaw -= ctl.steer * 1.4 * dt;
    this.forward(_fw);
    this.pos.x += _fw.x * this.vf * dt; this.pos.z += _fw.z * this.vf * dt;
    this.pos.y += this.vy * dt;
    const g = world.height(this.pos.x, this.pos.z, this.pos.y + 0.5, 0);
    const floor = g === -Infinity ? 0.2 : g;
    this.onGround = this.pos.y <= floor + 0.05;
    if (this.pos.y < floor) { if (this.vy < -8) this.impact = -this.vy; this.pos.y = floor; this.vy = Math.max(0, this.vy); if (this.onGround) this.vf *= 0.9; }
    this.pos.y = Math.min(this.pos.y, 260);
    _p.set(this.pos.x, this.pos.y - 0.5, this.pos.z);
    const px = _p.x, pz = _p.z;
    world.collide(_p, this.width * 0.6, 2.5, _col);
    if (_col.hit) { this.pos.x += _p.x - px; this.pos.z += _p.z - pz; this.impact = Math.abs(this.vf); this.vf *= -0.4; this.health -= this.impact * 15; }
    this.alt = this.pos.y - floor;
    this.pitch += (ctl.throttle * 0.18 - this.pitch) * Math.min(1, dt * 2);
    this.roll += (-ctl.steer * 0.15 - this.roll) * Math.min(1, dt * 2);
    this.pose(this.roll);
    for (const r of this.rotors) {
      if (/Helis_01/.test(r.name)) r.rotation.x += dt * 60 * this.rotorSpin; else r.rotation.z += dt * 45 * this.rotorSpin;
    }
    this.rpm = this.rotorSpin;
  }
}
