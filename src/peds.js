// Pedestrians + on-foot NPC AI (civilians, cops, gang members, mission NPCs).
import { G } from './state.js';
import { Character, randomOutfit, copOutfit, gangOutfit } from './character.js';
import { WEAPONS } from './weapons.js';
import { blockBounds, NX, NZ, P, BEACH, CITY, groundHeight, blockDistrict, DISTRICT, WATER_Y } from './layout.js';
import { clamp, damp, dampAngle, rand, pick, chance, circleOBB } from './util.js';

let PID = 0;
export class Ped {
  constructor(team = 'civ', outfit) {
    this.id = ++PID;
    this.team = team;
    this.char = new Character(outfit || (team === 'cop' ? copOutfit() : team === 'gang' ? gangOutfit() : randomOutfit()));
    G.scene.add(this.char.mesh);
    this.state = 'walk';
    this.hostile = team === 'gang';
    this.speed = rand(1.2, 1.6);
    this.panic = 0;
    this.shootCd = rand(0.5, 1.5);
    this.accuracy = team === 'cop' ? 0.06 : 0.09;
    this.dmgMul = team === 'cop' ? 0.55 : 0.45;
    this.spreadMul = 1;
    this.inVehicle = null;
    this.mission = null;
    this.ring = null; // sidewalk path
    this.deadT = 0;
    this.goal = null;
    this.stuckT = 0;
    this.vy = 0;
    this.dodgeT = 0;
    this.arrestT = 0;
    this.lastSeenPlayer = -99;
    this.persistent = false;
    if (team === 'cop') { this.char.hp = this.char.maxHp = 120; }
    if (team === 'gang') { this.char.hp = this.char.maxHp = 110; }
  }

  get x() { return this.char.x; }
  get z() { return this.char.z; }

  setWeapon(id) { this.weapon = id; this.char.setWeapon(id); }

  hurt(dmg, attacker, dx = 0, dz = 0, part = 'body', melee = false, force = 0) {
    const c = this.char;
    if (c.dead) return;
    c.hp -= dmg;
    c.hitFlash = 1;
    G.audio && G.audio.hurt(false, c.x, c.z);
    if (attacker === G.player) {
      G.events.emit('actorHurt', this, attacker);
      if (this.team === 'civ' && chance(0.15) && this.state !== 'flee') { this.state = 'fight'; }
      else if (this.team === 'civ') { this.state = 'flee'; this.threat = { x: G.player.x, z: G.player.z }; this.panic = 8; }
      if (this.team === 'cop' || this.team === 'gang') this.state = 'attack';
    }
    if (c.hp <= 0) {
      c.hp = 0;
      c.groundY = c.y;
      c.die(dx, dz, force);
      this.state = 'dead';
      G.events.emit('actorKilled', this, attacker, part);
      G.pickups && G.pickups.dropFromPed(this);
    }
  }

  // --------------- AI ---------------
  update(dt) {
    const c = this.char;
    if (c.dead) { c.animate(dt, 0); this.deadT += dt; return; }
    const pl = G.player;
    let mvx = 0, mvz = 0, spd = 0, panic = false, handsUp = false;
    this.shootCd -= dt;
    this.dodgeT -= dt;
    switch (this.state) {
      case 'walk': {
        const t = this.ringTarget();
        if (t) { mvx = t.x - c.x; mvz = t.z - c.z; spd = this.speed; }
        break;
      }
      case 'idle': case 'stand':
        if (this.faceTarget) c.h = dampAngle(c.h, Math.atan2(this.faceTarget.x - c.x, this.faceTarget.z - c.z), 5, dt);
        break;
      case 'goto': {
        if (this.goal) {
          mvx = this.goal.x - c.x; mvz = this.goal.z - c.z; spd = this.goal.run ? 5.5 : 1.6;
          if (Math.hypot(mvx, mvz) < 0.8) { this.state = this.goal.then || 'idle'; this.goal = null; spd = 0; }
        }
        break;
      }
      case 'flee': {
        this.panic -= dt;
        const th = this.threat || { x: pl.x, z: pl.z };
        mvx = c.x - th.x; mvz = c.z - th.z; spd = 5.8; panic = true;
        if (this.panic <= 0) { this.state = 'walk'; this.ring = null; }
        break;
      }
      case 'fight': {
        const tx = pl.x - c.x, tz = pl.z - c.z, d = Math.hypot(tx, tz);
        if (pl.dead || d > 25 || pl.inVehicle) { this.state = 'flee'; this.panic = 6; break; }
        if (d > 1.3) { mvx = tx; mvz = tz; spd = 5; }
        else {
          c.h = dampAngle(c.h, Math.atan2(tx, tz), 10, dt);
          if (this.shootCd <= 0) { this.shootCd = 0.9; c.punchT = 0.35; G.combat.melee(this, c.x, c.z, c.h); }
        }
        break;
      }
      case 'attack': this.attackAI(dt, (x, z, s) => { mvx = x; mvz = z; spd = s; }); break;
      case 'arrest': {
        const tx = pl.x - c.x, tz = pl.z - c.z, d = Math.hypot(tx, tz);
        if (d > 1.6) { mvx = tx; mvz = tz; spd = 5.5; } else { c.h = dampAngle(c.h, Math.atan2(tx, tz), 10, dt); }
        if (d < 2.2 && !pl.inVehicle && !pl.dead) {
          this.arrestT += dt;
          if (this.arrestT > 1.6) G.police && G.police.bust();
        } else this.arrestT = Math.max(0, this.arrestT - dt);
        if (G.police && G.police.level >= 2) this.state = 'attack';
        break;
      }
      case 'cower': handsUp = true; this.panic -= dt; if (this.panic <= 0) { this.state = 'flee'; this.panic = 5; } break;
    }
    // dodge fast cars
    if (this.dodgeT <= 0 && this.state !== 'attack') {
      for (const v of G.vehicles.list) {
        const sp = v.speed;
        if (sp < 8) continue;
        const dx = c.x - v.x, dz = c.z - v.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > 140) continue;
        const ahead = (dx * v.vx + dz * v.vz) / sp;
        const lat = Math.abs(dx * v.vz - dz * v.vx) / sp;
        if (ahead > 0 && ahead < sp * 0.9 && lat < 2.5 && chance(0.6)) {
          // jump sideways
          const side = (dx * v.vz - dz * v.vx) > 0 ? 1 : -1;
          c.vx = v.vz / sp * side * 6; c.vz = -v.vx / sp * side * 6;
          this.vy = 3.5; this.dodgeT = 1.5;
          if (this.team === 'civ') { this.state = 'flee'; this.threat = { x: v.x, z: v.z }; this.panic = 5; }
          G.audio && chance(0.5) && G.audio.scream(c.x, c.z);
          break;
        }
      }
    }
    // steering
    const L = Math.hypot(mvx, mvz);
    if (L > 0.01 && spd > 0) {
      const tx = mvx / L * spd, tz = mvz / L * spd;
      c.vx = damp(c.vx || 0, tx, 8, dt); c.vz = damp(c.vz || 0, tz, 8, dt);
      if (this.state !== 'attack' || !this.aiming) c.h = dampAngle(c.h, Math.atan2(mvx, mvz), 8, dt);
    } else {
      c.vx = damp(c.vx || 0, 0, 10, dt); c.vz = damp(c.vz || 0, 0, 10, dt);
    }
    const ox = c.x, oz = c.z;
    c.x += (c.vx || 0) * dt; c.z += (c.vz || 0) * dt;
    const push = G.world.statics.collideCircle(c.x, c.z, 0.35, c.y, this._p || (this._p = {}));
    if (push) { c.x += push.x; c.z += push.z; }
    // ped-vehicle collision / run over
    for (const v of G.vehicles.list) {
      const dx = v.x - c.x, dz = v.z - c.z;
      if (dx * dx + dz * dz > 25 || c.y > v.y + v.H) continue;
      const col = circleOBB(c.x, c.z, 0.35, v.obb);
      if (!col) continue;
      const sp = v.speed;
      if (sp > 4.5 && !v.dead) {
        const attacker = v.driver === 'player' ? G.player : null;
        const nx = v.vx / sp, nz = v.vz / sp;
        this.hurt(sp * (sp > 9 ? 12 : 4), attacker, nx, nz, 'body', false, sp * 0.75);
        if (!c.dead) { c.vx = nx * sp * 0.6; c.vz = nz * sp * 0.6; this.state = this.team === 'civ' ? 'flee' : this.state; }
        G.fx && G.fx.blood(c.x, c.y + 1, c.z, nx, nz);
        G.audio && G.audio.thud(c.x, c.z);
        if (attacker) G.events.emit('runOver', this);
        v.vx *= 0.97; v.vz *= 0.97;
      }
      c.x += col.nx * col.depth; c.z += col.nz * col.depth;
    }
    // vertical
    const gh = groundHeight(c.x, c.z);
    if (this.vy !== 0 || c.y > gh + 0.6) {
      this.vy -= 18 * dt; c.y += this.vy * dt;
      if (c.y <= gh) { c.y = gh; this.vy = 0; }
    } else c.y = damp(c.y, gh, 20, dt);
    if (gh < -10 && c.y < WATER_Y) { this.hurt(999, null); }
    // stuck detection
    const moved = Math.hypot(c.x - ox, c.z - oz);
    if (spd > 0.5 && moved < spd * dt * 0.25) { this.stuckT += dt; if (this.stuckT > 1.2 && this.state === 'walk') { this.ringDir *= -1; this.stuckT = 0; } }
    else this.stuckT = 0;
    c.animate(dt, Math.hypot(c.vx || 0, c.vz || 0), { panic: panic && this.team === 'civ' && Math.random() < 2, handsUp, air: this.vy > 0.5 });
    c.sync();
  }

  attackAI(dt, move) {
    const c = this.char;
    const tgt = this.target || G.player;
    const tx = tgt.x - c.x, tz = tgt.z - c.z, d = Math.hypot(tx, tz);
    if (tgt.dead || (tgt.char && tgt.char.dead)) { this.aiming = false; c.aim = false; return; }
    const range = this.weapon === 'shotgun' ? 12 : this.weapon ? 26 : 1.4;
    const ty = (tgt.y || 0) + (tgt.inVehicle ? 0.9 : 1.2);
    const los = d < 70 && G.world.statics.lineOfSight(c.x, c.y + 1.5, c.z, tgt.x, ty, tgt.z);
    if (los) this.lastSeen = G.time;
    if (!this.weapon) {
      if (d > 1.3) move(tx, tz, 5.6);
      else { c.h = dampAngle(c.h, Math.atan2(tx, tz), 10, dt); if (this.shootCd <= 0) { this.shootCd = 0.8; c.punchT = 0.35; G.combat.melee(this, c.x, c.z, c.h); } }
      return;
    }
    if (d > range || !los) {
      this.aiming = false; c.aim = false;
      move(tx, tz, 5.2);
      return;
    }
    // in range with LOS: strafe and shoot
    this.aiming = true; c.aim = true;
    c.h = dampAngle(c.h, Math.atan2(tx, tz), 12, dt);
    c.aimPitch = Math.atan2(ty - (c.y + 1.45), d) * 0.9;
    this.strafeT = (this.strafeT || 0) - dt;
    if (this.strafeT <= 0) { this.strafeT = rand(1, 2.5); this.strafeDir = pick([-1, 0, 0, 1]); }
    if (this.strafeDir) move(-tz * this.strafeDir, tx * this.strafeDir, 2.2);
    if (d < range * 0.4) move(-tx, -tz, 2.5);
    if (this.shootCd <= 0) {
      const w = WEAPONS[this.weapon];
      this.shootCd = w.rate * (w.auto ? 1.6 : 3.2) + rand(0.1, 0.6);
      if (w.auto && chance(0.35)) this.shootCd = 1.2 + rand(0, 1);
      const ox = c.x + Math.sin(c.h) * 0.5, oy = c.y + 1.45, oz = c.z + Math.cos(c.h) * 0.5;
      const acc = this.accuracy * (tgt.inVehicle ? 1.6 : 1) * (G.player.focusOn ? 2.2 : 1) + d * 0.002;
      let dx = tx + rand(-1, 1) * acc * d, dy = ty - oy + rand(-1, 1) * acc * d * 0.5, dz = tz + rand(-1, 1) * acc * d;
      const L = Math.hypot(dx, dy, dz); dx /= L; dy /= L; dz /= L;
      G.combat.fire(this, this.weapon, ox, oy, oz, dx, dy, dz, { x: ox + dx * 0.4, y: oy, z: oz + dz * 0.4 });
      c.recoil = 1;
    }
  }

  // sidewalk ring following
  initRing(i, j, s) {
    const b = blockBounds(i, j);
    const inset = 1.8;
    this.ring = { x0: b.x0 + inset, x1: b.x1 - inset, z0: b.z0 + inset, z1: b.z1 - inset, s };
    this.ringDir = chance(0.5) ? 1 : -1;
    const p = this.ringPoint(s);
    this.char.place(p.x, p.z, 0);
    this.char.y = groundHeight(p.x, p.z);
  }
  initLine(x, z0, z1) { // beach promenade
    this.line = { x, z0, z1 }; this.ringDir = chance(0.5) ? 1 : -1;
  }
  ringPoint(s) {
    const r = this.ring, w = r.x1 - r.x0, h = r.z1 - r.z0, per = 2 * (w + h);
    s = ((s % per) + per) % per;
    if (s < w) return { x: r.x0 + s, z: r.z0 };
    if (s < w + h) return { x: r.x1, z: r.z0 + (s - w) };
    if (s < 2 * w + h) return { x: r.x1 - (s - w - h), z: r.z1 };
    return { x: r.x0, z: r.z1 - (s - 2 * w - h) };
  }
  ringTarget() {
    if (this.line) {
      const L = this.line, c = this.char;
      if (c.z > L.z1) this.ringDir = -1; if (c.z < L.z0) this.ringDir = 1;
      return { x: L.x, z: c.z + this.ringDir * 3 };
    }
    if (!this.ring) {
      // find nearest block ring
      const i = clamp(Math.floor(this.char.x / P), 0, NX - 1), j = clamp(Math.floor(this.char.z / P), 0, NZ - 1);
      const b = blockBounds(i, j);
      this.ring = { x0: b.x0 + 1.8, x1: b.x1 - 1.8, z0: b.z0 + 1.8, z1: b.z1 - 1.8, s: 0 };
      this.ringDir = 1;
      // project position to s
      const r = this.ring, c = this.char, w = r.x1 - r.x0, h = r.z1 - r.z0;
      const dTop = Math.abs(c.z - r.z0), dR = Math.abs(c.x - r.x1), dB = Math.abs(c.z - r.z1), dL = Math.abs(c.x - r.x0);
      const m = Math.min(dTop, dR, dB, dL);
      if (m === dTop) r.s = clamp(c.x - r.x0, 0, w);
      else if (m === dR) r.s = w + clamp(c.z - r.z0, 0, h);
      else if (m === dB) r.s = w + h + clamp(r.x1 - c.x, 0, w);
      else r.s = 2 * w + h + clamp(r.z1 - c.z, 0, h);
    }
    const r = this.ring;
    const p = this.ringPoint(r.s);
    const c = this.char;
    if (Math.hypot(p.x - c.x, p.z - c.z) < 1.5) r.s += this.ringDir * 2.5;
    return this.ringPoint(r.s);
  }

  dispose() { this.char.dispose(); }
}

export class PedSystem {
  constructor() {
    this.list = [];
    this.spawnT = 0;
    this.maxCiv = 34;
    G.events.on('gunshot', (x, z, shooter, melee) => this.onNoise(x, z, shooter, melee ? 12 : 45));
    G.events.on('explosion', (x, y, z) => this.onNoise(x, z, null, 60));
  }

  spawn(team, x, z, h = 0, outfit) {
    const p = new Ped(team, outfit);
    p.char.place(x, z, h);
    p.char.y = Math.max(0, groundHeight(x, z));
    this.list.push(p);
    return p;
  }

  remove(p) { const i = this.list.indexOf(p); if (i >= 0) this.list.splice(i, 1); p.dispose(); p.removed = true; }

  ejectDriver(v, drv) {
    const d = v.doorPos(1);
    const team = drv && drv.team ? drv.team : 'civ';
    const p = this.spawn(team, d.x, d.z, v.h + Math.PI / 2, drv && drv.outfit);
    p.char.vx = -Math.cos(v.h) * -3; p.char.vz = Math.sin(v.h) * -3;
    if (team === 'civ') { p.state = chance(0.2) ? 'fight' : 'flee'; p.threat = { x: v.x, z: v.z }; p.panic = 8; G.audio && G.audio.scream(d.x, d.z); }
    else { if (drv.weapon) p.setWeapon(drv.weapon); p.state = 'attack'; }
    p.wasDriver = true;
    v.driver = null;
    return p;
  }

  onNoise(x, z, shooter, radius) {
    for (const p of this.list) {
      if (p.char.dead || p.team !== 'civ' || p.state === 'stand' || p.mission) continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < radius) {
        if (d < 10 && chance(0.4)) { p.state = 'cower'; p.panic = rand(1, 3); }
        else { p.state = 'flee'; p.panic = rand(5, 10); }
        p.threat = { x, z };
        if (chance(0.15)) G.audio && G.audio.scream(p.x, p.z);
      }
    }
  }

  populate() {
    const pl = G.player;
    let civ = 0;
    for (const p of this.list) if (p.team === 'civ' && !p.char.dead) civ++;
    const night = G.sky ? G.sky.night : 0;
    const target = Math.round(this.maxCiv * (1 - night * 0.4) * (G.sky ? 1 - G.sky.rain * 0.5 : 1) * (G.settings.quality === 'low' ? 0.6 : 1));
    let tries = 4;
    while (civ < target && tries-- > 0) {
      // beach promenade
      if (pl.x > BEACH.x0 - 60 && chance(0.4)) {
        const z = pl.z + rand(-120, 120);
        if (z < CITY.z0 || z > CITY.z1) continue;
        if (Math.abs(z - pl.z) < 30) continue;
        const p = this.spawn('civ', BEACH.x0 + rand(2, 9), z, 0);
        p.initLine(p.char.x, CITY.z0 + 10, CITY.z1 - 10);
        if (chance(0.5)) p.char.outfit.shorts = true;
        civ++;
        continue;
      }
      const i = clamp(Math.floor(pl.x / P) + Math.floor(rand(-2, 3)), 0, NX - 1);
      const j = clamp(Math.floor(pl.z / P) + Math.floor(rand(-2, 3)), 0, NZ - 1);
      if (blockDistrict(i, j) === DISTRICT.PORT && chance(0.6)) continue;
      const p = new Ped('civ');
      p.initRing(i, j, rand(0, 300));
      const d = Math.hypot(p.char.x - pl.x, p.char.z - pl.z);
      if (d < 28 || d > 150) { p.dispose(); continue; }
      this.list.push(p);
      civ++;
    }
  }

  update(dt) {
    this.spawnT -= dt;
    if (this.spawnT <= 0) { this.spawnT = 0.5; this.populate(); }
    const pl = G.player;
    for (let k = this.list.length - 1; k >= 0; k--) {
      const p = this.list[k];
      const d = Math.hypot(p.x - pl.x, p.z - pl.z);
      if (!p.persistent && !p.mission && (d > 180 || (p.char.dead && (p.deadT > 25 || d > 90)))) { this.remove(p); continue; }
      // LOD: far peds update at lower rate
      if (d > 90 && !p.mission && (G.frame + p.id) % 3) { p.char.sync(); continue; }
      p.update(dt);
    }
  }
}
