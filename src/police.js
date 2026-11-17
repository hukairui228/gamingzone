import { Vehicle } from './vehicle.js';

const HEAT = { gunfire: 0.25, assault: 0.4, jack: 0.6, kill: 1.0, hitcop: 1.3, killcop: 2.0, copcar: 1.2, runover: 0.8, explode: 1.0 };
const LEVEL_CARS = [[], ['car_police_poor'], ['car_police_poor', 'car_police_rich'], ['car_police_rich', 'car_suv_cop'],
  ['car_suv_cop', 'car_suv_fbi', 'car_police_rich'], ['car_bearcat', 'car_suv_fbi', 'car_police_rich']];
const LEVEL_FOOT = ['char_skinny_cop', 'char_skinny_cop', 'char_fat_cop', 'char_skinny_cop', 'char_fbi', 'char_swat'];

/** Route-following pursuit controller for AI-driven vehicles (police, mission enemies). */
export class Pursuit {
  constructor(game, v, aggressive = true) {
    this.g = game; this.v = v; this.aggr = aggressive;
    this.path = null; this.pathT = 0; this.wp = 0; this.stuck = 0; this.reverse = 0;
  }

  update(dt, tx, tz, { stopAt = 0, maxSpeed = 1 } = {}) {
    const g = this.g, v = this.v;
    this.pathT -= dt;
    const direct = Math.hypot(tx - v.pos.x, tz - v.pos.z);
    if (this.pathT <= 0 && direct > 35) {
      this.pathT = 2;
      this.path = g.roads.route(v.pos.x, v.pos.z, tx, tz);
      this.wp = 1;
    }
    let ax = tx, az = tz;
    if (this.path && direct > 35) {
      while (this.wp < this.path.length - 1 && Math.hypot(this.path[this.wp][0] - v.pos.x, this.path[this.wp][1] - v.pos.z) < 12) this.wp++;
      [ax, az] = this.path[Math.min(this.wp, this.path.length - 1)];
    }
    const want = Math.atan2(ax - v.pos.x, az - v.pos.z);
    let err = want - v.yaw; err = Math.atan2(Math.sin(err), Math.cos(err));
    let throttle = direct < stopAt ? -0.4 : maxSpeed * (1 - Math.min(0.6, Math.abs(err) * 0.4));
    let steer = Math.max(-1, Math.min(1, -err * 2.2));
    if (v.speed < 1.5 && throttle > 0) this.stuck += dt; else this.stuck = Math.max(0, this.stuck - dt);
    if (this.stuck > 1.6) { this.reverse = 1.2; this.stuck = 0; }
    if (this.reverse > 0) { this.reverse -= dt; throttle = -1; steer = -steer; }
    v.update(dt, { throttle, steer, handbrake: Math.abs(err) > 1.4 && v.speed > 12 }, g.world);
    return direct;
  }
}

export class Police {
  constructor(game) {
    this.g = game;
    this.heat = 0;       // continuous 0..5.99
    this.level = 0;
    this.cars = [];
    this.foot = [];
    this.unseen = 0;
    this.spawnT = 0;
  }

  crime(kind, pos) {
    const g = this.g;
    if (g.mission && g.mission.noWanted) return;
    const witnessed = this.level > 0 || kind === 'gunfire' || kind.includes('cop') || g.peds.list.some((p) => !p.dead && Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z) < 30);
    if (!witnessed) return;
    const before = this.level;
    this.heat = Math.min(5.99, this.heat + (HEAT[kind] || 0.3) * (kind === 'gunfire' && this.level >= 1 ? 0.1 : 1));
    this.level = Math.floor(this.heat);
    this.unseen = 0;
    if (this.level > before) {
      g.hud.notify('通缉等级 ' + '★'.repeat(this.level), 1.6);
      g.audio.bark('vfx_cop_chase', 3, { vol: 0.8 });
    }
  }

  clear() {
    this.heat = 0; this.level = 0;
    for (const c of this.cars) this.g.dropVehicle(c);
    for (const p of this.foot) p.ai = null, p.mission = false;
    this.cars = []; this.foot = [];
    this.g.audio.stopLoop('siren');
  }

  async spawnCar() {
    const g = this.g, R = g.roads, P = g.focus;
    for (let k = 0; k < 10; k++) {
      const lane = R.randomLane();
      const e = R.edges[lane.e];
      const pt = R.point(e, lane.dir, lane.s, R.laneOffset(e), {});
      const d = Math.hypot(pt.x - P.x, pt.z - P.z);
      if (d < 80 || d > 170) continue;
      const y = g.world.height(pt.x, pt.z, 60);
      if (y === -Infinity) continue;
      const list = LEVEL_CARS[this.level];
      const v = await new Vehicle(list[Math.floor(Math.random() * list.length)]).load();
      v.place(pt.x, y, pt.z, Math.atan2(P.x - pt.x, P.z - pt.z));
      v.driver = 'cop';
      v.cop = new Pursuit(g, v);
      v.crew = 1 + (this.level >= 3 ? 1 : 0);
      g.scene.add(v.root);
      g.parked.add(v);
      this.cars.push(v);
      return;
    }
  }

  async spawnCop(x, z, y) {
    const g = this.g;
    const model = LEVEL_FOOT[Math.min(5, this.level)];
    const p = await g.peds.create(model, 'cop', 'male');
    p.pos.set(x, y, z);
    p.mission = true;
    p.weapon = this.level >= 4 ? 'ak47' : 'beretta';
    p.cool = 1 + Math.random();
    p.ai = (dt) => this.copAI(p, dt);
    this.foot.push(p);
    return p;
  }

  copAI(p, dt) {
    const g = this.g, pl = g.player;
    const tgt = pl.vehicle ? pl.vehicle.pos : pl.pos;
    const dx = tgt.x - p.pos.x, dz = tgt.z - p.pos.z, d = Math.hypot(dx, dz);
    if (this.level === 0) { p.ai = null; p.state = 'walk'; p.mission = false; return; }
    p.yaw = Math.atan2(dx, dz); p.root.rotation.y = p.yaw;
    const aimClip = p.weapon === 'ak47' ? 'wo__player__rifle9pts_front' : 'wo__player__handgun9pts_front';
    if (d > 14) {
      g.peds.moveTo(p, tgt.x, tgt.z, 5, dt);
      p.play('sl__player__run' + (p.weapon === 'ak47' ? '_armed2handed' : ''));
      p.c.overlay(null);
    } else {
      p.play(p.weapon === 'ak47' ? 'sl__player__idle_armed2handed' : 'sl__player__idle');
      p.c.overlay(aimClip);
      if (!pl.vehicle && d < 1.8 && this.level <= 2 && pl.speedNow < 1) g.die('busted');
    }
    p.cool -= dt;
    if (p.cool <= 0 && d < 40) {
      p.cool = p.weapon === 'ak47' ? 0.25 : 0.8;
      const clear = g.world.raycast(p.pos.x, p.pos.y + 1.5, p.pos.z, dx / d, 0, dz / d, d) >= d - 1;
      if (clear) {
        g.audio.play(p.weapon === 'ak47' ? 'sfx_ak47_shoot' : 'sfx_berreta', { vol: g.audioVol(p.pos, 0.7) });
        const a = { x: p.pos.x + dx / d * 0.6, y: p.pos.y + 1.4, z: p.pos.z + dz / d * 0.6 };
        const acc = Math.max(0.15, 0.55 - d * 0.012) * (pl.vehicle ? 0.6 : 1);
        if (Math.random() < acc) {
          if (pl.vehicle) { pl.vehicle.health -= 12; g.fx.impact(tgt.x, tgt.y + 1, tgt.z); }
          else pl.hurt(p.weapon === 'ak47' ? 9 : 7, p.pos);
          g.fx.tracer(a, { x: tgt.x, y: tgt.y + 1.2, z: tgt.z });
        } else g.fx.tracer(a, { x: tgt.x + (Math.random() - 0.5) * 3, y: tgt.y + 1.5, z: tgt.z + (Math.random() - 0.5) * 3 });
        g.fx.muzzle(a, { x: dx / d, y: 0, z: dz / d });
      }
    }
  }

  update(dt) {
    const g = this.g, pl = g.player, P = g.focus;
    if (this.level <= 0) { if (this.cars.length || this.foot.length) this.clear(); return; }
    // evading
    const near = [...this.cars, ...this.foot].some((c) => Math.hypot(c.pos.x - P.x, c.pos.z - P.z) < 70);
    this.unseen = near ? 0 : this.unseen + dt;
    if (this.unseen > 18 + this.level * 6) {
      this.heat = Math.max(0, this.level - 1 + 0.5) - 0.5;
      this.level = Math.max(0, this.level - 1);
      this.heat = this.level;
      this.unseen = 0;
      g.hud.notify(this.level ? '通缉等级下降' : '你已摆脱警察！', 2);
      if (!this.level) { this.clear(); return; }
    }
    // patrol cars already in traffic join the chase
    for (const v of [...g.traffic.cars]) {
      if (v.driver !== 'cop' || Math.hypot(v.pos.x - P.x, v.pos.z - P.z) > 90) continue;
      g.traffic.detach(v);
      v.cop = new Pursuit(g, v);
      v.crew = 1;
      g.parked.add(v);
      this.cars.push(v);
    }
    // reinforcements
    this.spawnT -= dt;
    const wantCars = Math.min(5, this.level + (this.level >= 3 ? 1 : 0));
    if (this.spawnT <= 0 && this.cars.length < wantCars) { this.spawnT = 4; this.spawnCar(); }
    // drive
    let nearest = Infinity;
    for (const v of [...this.cars]) {
      if (v.health <= 0) { if (!v.exploded) g.explodeVehicle(v); continue; }
      const d = Math.hypot(v.pos.x - P.x, v.pos.z - P.z);
      nearest = Math.min(nearest, d);
      if (d > 300) { this.cars.splice(this.cars.indexOf(v), 1); g.dropVehicle(v); continue; }
      if (v.crew > 0 && !pl.vehicle && d < 18 && v.speed < 4) {
        while (v.crew > 0) { v.crew--; this.spawnCop(v.pos.x + Math.cos(v.yaw) * 2 * (v.crew ? -1 : 1), v.pos.z - Math.sin(v.yaw) * 2, v.pos.y); }
        v.driver = null; v.cop = null;
        continue;
      }
      if (v.cop) v.cop.update(dt, P.x, P.z, { stopAt: pl.vehicle ? 0 : 9 });
    }
    // siren on the closest cruiser
    if (nearest < 120) {
      g.audio.loop('siren', 'sfx_cop_siren');
      g.audio.setLoop('siren', Math.max(0, 0.6 - nearest / 200));
    } else g.audio.stopLoop('siren');
    this.foot = this.foot.filter((p) => !p.dead && g.peds.list.includes(p));
  }
}
