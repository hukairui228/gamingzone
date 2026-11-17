import { createCharacter } from './character.js';

const MODELS = [
  ['char_civ_man', 'male'], ['char_civ_woman', 'female'], ['char_pedestrians_male', 'male', 0], ['char_pedestrians_male', 'male', 1],
  ['char_pedestrians_female', 'female', 0], ['char_pedestrians_female', 'female', 1], ['char_civ_trash_1', 'male'],
  ['char_civ_trash_2', 'male'], ['char_cubanguy', 'male'], ['char_northcuban_girl', 'female'], ['char_hoochiemama_a', 'female'],
  ['char_construction_guy', 'male'], ['char_mechanic', 'male'], ['char_northcuban_1', 'male'],
];
const _pt = {};

/** A walking civilian / gang member / cop on foot. */
export class Ped {
  constructor(char, kind, sex) {
    this.c = char;
    this.root = char.root;
    this.pos = char.root.position;
    this.kind = kind; // civ | cop | gang
    this.sex = sex;
    this.health = kind === 'cop' ? 100 : 60;
    this.yaw = 0;
    this.speed = 0;
    this.state = 'walk';
    this.dead = false;
    this.anim = '';
    this.root.traverse((o) => { if (o.isMesh) o.userData.ped = this; });
  }

  play(name, opts) {
    if (this.anim === name) return;
    this.anim = name;
    this.c.play(name, opts);
  }

  clip(kind) {
    const s = this.sex === 'female' ? 'female' : 'male';
    return { idle: `sl__civilian_${s}__idle`, walk: `sl__civilian_${s}__walk`, run: `sl__civilian_${s}__run` }[kind];
  }
}

export class Peds {
  constructor(game) {
    this.g = game;
    this.list = [];
    this.max = 14;
    this.loading = 0;
    this.timer = 0;
  }

  async create(model, kind = 'civ', sex = 'male', variant) {
    this.loading++;
    try {
      const c = await createCharacter(model, variant === undefined ? {} : { variant });
      const p = new Ped(c, kind, sex);
      p.model = model;
      this.g.scene.add(p.root);
      this.list.push(p);
      return p;
    } finally { this.loading--; }
  }

  async spawnWalker() {
    const g = this.g, R = g.roads, P = g.focus;
    for (let k = 0; k < 8; k++) {
      const lane = R.randomLane();
      const e = R.edges[lane.e];
      R.point(e, lane.dir, lane.s, R.sidewalkOffset(e), _pt);
      const d = Math.hypot(_pt.x - P.x, _pt.z - P.z);
      if (d < 45 || d > 120) continue;
      const y = g.world.height(_pt.x, _pt.z, 60);
      if (y === -Infinity) continue;
      const [model, sex, variant] = MODELS[Math.floor(Math.random() * MODELS.length)];
      const p = await this.create(model, 'civ', sex, variant);
      p.pos.set(_pt.x, y, _pt.z);
      p.lane = lane;
      p.walkSpeed = 1.2 + Math.random() * 0.4;
      p.play(p.clip('walk'));
      return p;
    }
    return null;
  }

  remove(p) {
    const i = this.list.indexOf(p);
    if (i >= 0) this.list.splice(i, 1);
    this.g.scene.remove(p.root);
  }

  /** Scare everyone near a point (gunshots, crashes). */
  panic(x, z, r = 35) {
    for (const p of this.list) {
      if (p.dead || p.kind !== 'civ') continue;
      if (Math.hypot(p.pos.x - x, p.pos.z - z) < r) { p.state = 'flee'; p.fleeFrom = { x, z }; p.fleeT = 8; }
    }
  }

  damage(p, amount, from, kind = 'bullet') {
    if (p.dead) return;
    p.health -= amount;
    this.g.fx.blood(p.pos.x, p.pos.y + 1.2, p.pos.z);
    if (p.health <= 0) this.kill(p, from, kind);
    else if (p.kind === 'civ') { p.state = 'flee'; p.fleeFrom = from; p.fleeT = 10; this.g.audio.play(p.sex === 'female' ? 'sfx_female_hit' : 'sfx_male_hit', { vol: this.g.audioVol(p.pos, 0.8) }); }
    else p.provoked = true;
  }

  kill(p, from, kind) {
    p.dead = true;
    p.state = 'dead';
    p.deadT = 0;
    const clip = kind === 'car' ? 'fo__civilian_all__car_hit_front' : (Math.random() < 0.5 ? 'fo__player__idle_to_dead_01' : 'fo__player__idle_to_dead_02');
    p.anim = '';
    p.play(clip, { loop: false, fade: 0.1 });
    this.g.audio.play('sfx_character_death', { vol: this.g.audioVol(p.pos, 0.7) });
    this.g.onPedKilled(p, kind);
  }

  update(dt) {
    const g = this.g, R = g.roads, P = g.focus;
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 0.7;
      for (const p of [...this.list]) {
        const d = Math.hypot(p.pos.x - P.x, p.pos.z - P.z);
        if ((d > 150 && !p.mission) || (p.dead && p.deadT > 25)) this.remove(p);
      }
      const civs = this.list.filter((p) => p.kind === 'civ').length;
      if (civs + this.loading < this.max * g.pedDensity) this.spawnWalker();
    }
    for (const p of this.list) {
      if (p.dead) { p.deadT += dt; p.c.update(dt); continue; }
      if (p.ai) p.ai(dt);
      else if (p.state === 'walk' && p.lane) {
        const e = R.edges[p.lane.e];
        p.lane.s += p.walkSpeed * dt;
        if (p.lane.s > e.length) {
          const node = p.lane.dir > 0 ? e.b : e.a;
          const nx = R.nextEdge(p.lane.e, node);
          p.lane = { e: nx.e, dir: nx.dir, s: 0 };
        }
        R.point(R.edges[p.lane.e], p.lane.dir, p.lane.s, R.sidewalkOffset(R.edges[p.lane.e]), _pt);
        this.moveTo(p, _pt.x, _pt.z, p.walkSpeed, dt);
        p.play(p.clip('walk'));
      } else if (p.state === 'flee') {
        p.fleeT -= dt;
        const dx = p.pos.x - p.fleeFrom.x, dz = p.pos.z - p.fleeFrom.z, l = Math.hypot(dx, dz) || 1;
        this.moveTo(p, p.pos.x + dx / l * 5, p.pos.z + dz / l * 5, 5.2, dt);
        p.play(p.clip('run'), { timeScale: 1.2 });
        if (p.fleeT <= 0) {
          p.state = 'walk';
          const n = R.nearest(p.pos.x, p.pos.z, 40);
          if (n) p.lane = { e: n.e, dir: 1, s: n.s }; else p.state = 'idle';
        }
      } else if (p.state === 'idle') p.play(p.clip('idle'));
      p.c.update(dt);
    }
  }

  /** Steer toward a point with wall collision + ground following. */
  moveTo(p, tx, tz, speed, dt) {
    const dx = tx - p.pos.x, dz = tz - p.pos.z, l = Math.hypot(dx, dz);
    if (l > 0.05) {
      const step = Math.min(l, speed * dt);
      p.pos.x += dx / l * step; p.pos.z += dz / l * step;
      const yaw = Math.atan2(dx, dz);
      let d = yaw - p.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      p.yaw += d * Math.min(1, dt * 8);
      p.root.rotation.y = p.yaw;
    }
    this.g.world.collide(p.pos, 0.35, 1.7);
    const h = this.g.world.height(p.pos.x, p.pos.z, p.pos.y + 0.6, 0.6);
    if (h > -Infinity) p.pos.y += (h - p.pos.y) * Math.min(1, dt * 12);
  }
}

export { MODELS as PED_MODELS };
