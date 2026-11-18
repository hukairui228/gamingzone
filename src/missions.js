import { Vehicle } from './vehicle.js';
import { buildModel } from './models.js';
import { STORY } from './story/index.js';
import { Pursuit } from './police.js';

class Abort extends Error {}

/**
 * Mission runtime. Story missions are async scripts (see story.js) written against this API,
 * using the original game's Chinese text tables for every line of dialogue and objective.
 */
export class Missions {
  constructor(game) {
    this.g = game;
    this.done = [];
    this.waiters = [];
    this.active = null;
    this.markers = [];
    this.giverMarkers = new Map();
    this.loadingGiver = new Set();
    this.objs = [];
  }

  /** main missions unlock in order; side missions (side: true) unlock once `requires` is done */
  available(m) {
    if (this.done.includes(m.id)) return true;
    if (m.side) return !m.requires || this.done.includes(m.requires);
    const main = STORY.filter((x) => !x.side);
    const i = main.indexOf(m);
    return i === 0 || this.done.includes(main[i - 1].id);
  }

  list() {
    return STORY.map((m) => ({ ...m, done: this.done.includes(m.id), available: this.available(m) }));
  }

  next() { return STORY.find((m) => !m.side && !this.done.includes(m.id)); }

  /** missions whose start marker should be on the map right now */
  givers() {
    const out = [];
    const n = this.next();
    if (n && n.giver) out.push(n);
    for (const m of STORY) if (m.side && m.giver && !this.done.includes(m.id) && this.available(m)) out.push(m);
    return out;
  }

  startStory() { const n = this.next(); if (n) this.play(n.id); }

  /** Launch a mission by id. */
  async play(id) {
    const def = STORY.find((m) => m.id === id);
    if (!def || this.active) return;
    const g = this.g;
    g.police.clear();
    const m = new MissionCtx(this, def);
    this.active = m;
    g.mission = m;
    g.audio.play('m_mission_start', { vol: 0.6 });
    g.hud.big(def.title, `第${def.chapter}章`, 3);
    try {
      if (def.start) { const [x, z, yaw] = def.start; g.placePlayer(x, z, yaw || 0); }
      await def.run(m);
      this.complete(m);
    } catch (e) {
      if (!(e instanceof Abort)) { console.error(e); g.hud.notify('任务脚本错误：' + e.message, 4); }
    } finally {
      m.cleanup();
      if (this.active === m) { this.active = null; g.mission = null; }
    }
  }

  complete(m) {
    const g = this.g;
    if (!this.done.includes(m.def.id)) this.done.push(m.def.id);
    const reward = m.def.reward || 0;
    g.money += reward;
    g.audio.play('m_mission_end', { vol: 0.7 });
    g.hud.big(g.t('global', 83) || '任务完成', reward ? `+$${reward}` : '', 4);
    g.save();
  }

  fail(reason) {
    const m = this.active;
    if (!m || m.failed) return;
    m.failed = true;
    const g = this.g;
    setTimeout(() => {
      g.hud.big(g.t('global', 87) || '任务失败', reason || '', 4, 'red');
      g.audio.play('m_mission_failed', { vol: 0.7 });
    }, g.player.dead ? 4600 : 0);
    for (const w of this.waiters) w.reject(new Abort());
    this.waiters = [];
  }

  abort() {
    const m = this.active;
    if (!m) return;
    m.failed = true;
    this.active = null; this.g.mission = null;
    this.g.hud.big(this.g.t('global', 88) || '任务中止', '', 2.5, 'red');
    for (const w of this.waiters) w.reject(new Abort());
    this.waiters = [];
  }

  update(dt) {
    const g = this.g;
    const m = this.active;
    if (m && !m.failed) {
      m.time += dt;
      for (const c of m.checks) { const r = c(dt); if (r) { this.fail(r); break; } }
      for (const w of [...this.waiters]) {
        if (w.pred(dt)) { this.waiters.splice(this.waiters.indexOf(w), 1); w.resolve(); }
      }
      if (m.timerLeft != null) { m.timerLeft -= dt; g.hud.timer(m.timerLeft); if (m.timerLeft <= 0) { m.timerLeft = null; g.hud.timer(null); this.fail('时间到了！'); } }
      for (const mk of m.markers) mk.obj.rotation.y += dt * 1.5;
    }
    // free roam: mission start markers like the original ("M" checkpoints)
    if (!m && !g.player.dead) {
      const want = this.givers();
      for (const [id, mk] of this.giverMarkers) if (!want.some((x) => x.id === id)) { g.scene.remove(mk); this.giverMarkers.delete(id); }
      for (const n of want) {
        const mk = this.giverMarkers.get(n.id);
        if (!mk) {
          if (this.loadingGiver.has(n.id)) continue;
          this.loadingGiver.add(n.id);
          buildModel('checkpoint_mission').then((o) => {
            const [x, z] = n.giver;
            o.position.set(x, g.world.floor(x, z) + 0.05, z);
            o.scale.setScalar(1.5);
            g.scene.add(o);
            this.giverMarkers.set(n.id, o);
            this.loadingGiver.delete(n.id);
          });
          continue;
        }
        mk.rotation.y += dt;
        const p = g.focus;
        if (Math.hypot(p.x - mk.position.x, p.z - mk.position.z) < 3 && Math.abs(p.y - mk.position.y) < 3) { this.play(n.id); break; }
      }
    }
  }

  blips() {
    const out = [];
    if (this.active) for (const b of this.active.blipList) out.push(typeof b === 'function' ? b() : b);
    else for (const n of this.givers()) out.push({ x: n.giver[0], z: n.giver[1], color: n.side ? '#3fd4ff' : '#ffd23c', label: n.title });
    return out.filter(Boolean);
  }
}

/** Per-mission API given to story scripts. */
export class MissionCtx {
  constructor(mgr, def) {
    this.mgr = mgr; this.g = mgr.g; this.def = def;
    this.time = 0;
    this.checks = [];
    this.markers = [];
    this.blipList = [];
    this.spawned = [];
    this.timerLeft = null;
  }

  /** text from the original tables: number -> this chapter's file, or [file, index] */
  T(i) {
    if (typeof i === 'string') return i;
    if (Array.isArray(i)) return this.g.t(i[0], i[1]);
    return this.g.t(this.def.file, i);
  }

  until(pred) {
    if (this.failed) return Promise.reject(new Abort());
    return new Promise((resolve, reject) => this.mgr.waiters.push({ pred, resolve, reject }));
  }

  wait(sec) { let t = 0; return this.until((dt) => (t += dt) >= sec); }

  /** dialogue: [[speaker, textIndex|string, voiceClip?], ...] */
  async say(lines) {
    if (this.failed) throw new Abort();
    const g = this.g;
    g.dialogOpen = true;
    const pv = g.player.vehicle;
    if (pv) pv.vf *= 0.3;
    await g.hud.dialog(lines.map(([who, t, voice]) => [who, this.T(t), voice]));
    g.dialogOpen = false;
    g.inputBlockT = 0.3;
    if (this.failed) throw new Abort();
  }

  objective(t, notify = true) {
    const s = t == null ? '' : this.T(t);
    this.g.hud.objective(s);
    if (s && notify) this.g.audio.play('int_mission_task_appear', { vol: 0.5 });
  }

  caption(t, sec = 3) { this.g.hud.big(this.T(t), '', sec); return this.wait(sec * 0.8); }

  /** Place a glowing checkpoint and wait until the player reaches it. */
  async goto(x, z, { r = 5, text, car = false, model, vehicle } = {}) {
    const g = this.g;
    if (text != null) this.objective(text);
    this.hint = { type: 'goto', x, z, car, vehicle };
    const mk = await this.marker(x, z, model || (car || vehicle ? 'checkpoint_drive' : 'checkpoint_walk'));
    const blip = { x, z, color: '#ffd23c' };
    this.blipList.push(blip);
    g.setWaypoint(x, z);
    await this.until(() => {
      const p = g.focus;
      if (vehicle && g.player.vehicle !== vehicle) return false;
      if (car && !g.player.vehicle) return false;
      return Math.hypot(p.x - x, p.z - z) < r;
    });
    this.removeMarker(mk);
    this.blipList.splice(this.blipList.indexOf(blip), 1);
    g.waypoint = null; g.hud.route = null;
    g.audio.play('int_race_checkpoint', { vol: 0.5 });
  }

  async marker(x, z, model = 'checkpoint_walk') {
    const g = this.g;
    const o = await buildModel(model);
    o.position.set(x, g.world.floor(x, z) + 0.05, z);
    o.scale.setScalar(1.6);
    g.scene.add(o);
    const mk = { obj: o };
    this.markers.push(mk);
    return mk;
  }

  removeMarker(mk) {
    this.g.scene.remove(mk.obj);
    this.markers.splice(this.markers.indexOf(mk), 1);
  }

  async spawnCar(model, x, z, yaw = 0, { driver = null, health, keep = true } = {}) {
    const g = this.g;
    const v = await new Vehicle(model).load();
    const h = g.world.floor(x, z);
    v.place(x, h > -Infinity ? h : 0.5, z, yaw);
    v.mission = true; v.keep = keep;
    v.driver = driver;
    if (health) v.health = health;
    g.scene.add(v.root);
    g.parked.add(v);
    this.spawned.push(v);
    return v;
  }

  /**
   * Spawn a character. opts: yaw, kind ('gang'|'civ'|'ally'), weapon, hostile, health, idle clip, sex, variant.
   * Hostile peds chase and attack the player.
   */
  async spawnPed(model, x, z, opts = {}) {
    const g = this.g;
    const p = await g.peds.create(model, opts.kind || 'gang', opts.sex || 'male', opts.variant);
    const h = g.world.floor(x, z);
    p.pos.set(x, h > -Infinity ? h : 0, z);
    p.yaw = opts.yaw || 0; p.root.rotation.y = p.yaw;
    p.mission = true;
    p.hostile = !!opts.hostile;
    p.weapon = opts.weapon || null;
    if (opts.health) p.health = opts.health;
    p.state = 'idle';
    p.idleClip = opts.idle || (p.sex === 'female' ? 'sl__civilian_female__idle' : 'sl__civilian_male__idle');
    p.ai = (dt) => this.pedAI(p, dt);
    this.spawned.push(p);
    return p;
  }

  pedAI(p, dt) {
    const g = this.g, pl = g.player;
    const tgt = pl.vehicle ? pl.vehicle.pos : pl.pos;
    const dx = tgt.x - p.pos.x, dz = tgt.z - p.pos.z, d = Math.hypot(dx, dz);
    if (p.follow) { // ally following the player on foot
      if (pl.vehicle) { p.root.visible = false; p.pos.copy(pl.vehicle.pos); return; }
      p.root.visible = true;
      if (d > 3) { g.peds.moveTo(p, tgt.x, tgt.z, d > 8 ? 5 : 2, dt); p.play(p.clip(d > 8 ? 'run' : 'walk')); } else p.play(p.idleClip);
      return;
    }
    if (p.goal) { // scripted walk
      const [gx, gz, run] = p.goal;
      const l = Math.hypot(gx - p.pos.x, gz - p.pos.z);
      if (l > 0.6) { g.peds.moveTo(p, gx, gz, run ? 5 : 1.6, dt); p.play(p.clip(run ? 'run' : 'walk')); return; }
      p.goal = null;
    }
    if (!p.hostile && !p.provoked) { p.play(p.idleClip); return; }
    p.yaw = Math.atan2(dx, dz); p.root.rotation.y = p.yaw;
    const gun = p.weapon && p.weapon !== 'fist' && p.weapon !== 'bat';
    const range = gun ? 16 : 1.4;
    if (d > range) {
      g.peds.moveTo(p, tgt.x, tgt.z, gun ? 4.5 : 5.2, dt);
      p.play('sl__player__run' + (p.weapon === 'ak47' ? '_armed2handed' : ''));
      p.c.overlay(null);
      return;
    }
    p.play(p.weapon === 'ak47' ? 'sl__player__idle_armed2handed' : gun ? 'sl__player__idle' : 'fl__player__melee_idle');
    p.cool = (p.cool ?? 0.8) - dt;
    if (gun) p.c.overlay(p.weapon === 'ak47' ? 'wo__player__rifle9pts_front' : 'wo__player__handgun9pts_front');
    if (p.cool > 0) return;
    if (gun) {
      p.cool = p.weapon === 'ak47' || p.weapon === 'uzi' ? 0.3 : 0.9;
      const clear = g.world.raycast(p.pos.x, p.pos.y + 1.5, p.pos.z, dx / d, 0, dz / d, d) >= d - 1;
      if (!clear) return;
      g.audio.play({ ak47: 'sfx_ak47_shoot', uzi: 'sfx_uzi_shoot' }[p.weapon] || 'sfx_berreta', { vol: g.audioVol(p.pos, 0.7) });
      const a = { x: p.pos.x + dx / d * 0.6, y: p.pos.y + 1.4, z: p.pos.z + dz / d * 0.6 };
      g.fx.muzzle(a, { x: dx / d, y: 0, z: dz / d });
      if (Math.random() < Math.max(0.12, 0.5 - d * 0.015)) {
        if (pl.vehicle) pl.vehicle.health -= 10; else pl.hurt(6, p.pos);
        g.fx.tracer(a, { x: tgt.x, y: tgt.y + 1.2, z: tgt.z });
      } else g.fx.tracer(a, { x: tgt.x + (Math.random() - 0.5) * 3, y: tgt.y + 1.4, z: tgt.z + (Math.random() - 0.5) * 3 });
    } else if (!pl.vehicle) {
      p.cool = 0.9;
      p.c.play(`fo__player__melee_hit_0${1 + Math.floor(Math.random() * 3)}`, { loop: false, fade: 0.05, timeScale: 1.3 });
      p.anim = '';
      g.audio.play('sfx_combat_punch', { vol: 0.6 });
      pl.hurt(p.weapon === 'bat' ? 14 : 7, p.pos);
    }
  }

  /** wait until all given peds are dead */
  async killAll(peds, text) {
    if (text != null) this.objective(text);
    this.hint = { type: 'kill', peds };
    const bl = peds.map((p) => () => (p.dead ? null : { x: p.pos.x, z: p.pos.z, color: '#ff2a2a', small: true }));
    this.blipList.push(...bl);
    await this.until(() => peds.every((p) => p.dead));
    for (const b of bl) this.blipList.splice(this.blipList.indexOf(b), 1);
  }

  /** beat a character down with fists (they give up instead of dying) */
  async beat(p, text, threshold = 25) {
    if (text != null) this.objective(text);
    this.hint = { type: 'beat', p, threshold };
    p.provoked = true; p.hostile = true;
    p.health = Math.max(p.health, 80);
    const b = () => ({ x: p.pos.x, z: p.pos.z, color: '#ff2a2a', small: true });
    this.blipList.push(b);
    await this.until(() => p.dead || p.health <= threshold);
    this.blipList.splice(this.blipList.indexOf(b), 1);
    if (!p.dead) { p.hostile = false; p.provoked = false; p.state = 'idle'; p.idleClip = 'fl__player__down_idle'; p.c.overlay(null); }
  }

  /** get away from a set of chasers (peds or cars) */
  async escape(chasers, dist = 120, text) {
    if (text != null) this.objective(text);
    this.hint = { type: 'escape', chasers, dist };
    await this.until(() => chasers.every((c) => c.dead || c.health <= 0 || Math.hypot(c.pos.x - this.g.focus.x, c.pos.z - this.g.focus.z) > dist));
  }

  async exitVehicle(text) {
    if (text != null) this.objective(text);
    this.hint = { type: 'exit' };
    await this.until(() => !this.g.player.vehicle);
  }

  async loseWanted(text) {
    if (text != null) this.objective(text);
    this.hint = { type: 'wanted' };
    await this.until(() => this.g.police.level === 0);
  }

  /** wait until the player is driving vehicle v (or any vehicle matching fn) */
  async getIn(v, text) {
    if (text != null) this.objective(text);
    this.hint = { type: 'getin', v };
    const b = () => (v.health > 0 ? { x: v.pos.x, z: v.pos.z, color: '#3fd4ff' } : null);
    if (v.pos) this.blipList.push(b);
    await this.until(() => this.g.player.vehicle === v);
    this.blipList.splice(this.blipList.indexOf(b), 1);
  }

  /** chasing enemy car that drives to random destinations; resolves when destroyed */
  driveAround(v, speed = 0.75) {
    const g = this.g;
    let dest = null;
    const purs = new Pursuit(g, v);
    v.mission = true;
    this.checks.push((dt) => {
      if (v.health <= 0 || v.driver == null) return null;
      if (!dest || Math.hypot(dest[0] - v.pos.x, dest[1] - v.pos.z) < 20) { const l = g.roads.randomLane(); const e = g.roads.edges[l.e]; dest = [e.pts[0][0], e.pts[0][1]]; }
      purs.update(dt, dest[0], dest[1], { maxSpeed: speed });
      return null;
    });
  }

  /** fail the mission when fn returns a message */
  check(fn) { this.checks.push(fn); }

  protect(entity, msg) {
    this.check(() => ((entity.dead || entity.health <= 0) ? this.T(msg) : null));
  }

  timer(sec) { this.timerLeft = sec; }
  stopTimer() { this.timerLeft = null; this.g.hud.timer(null); }
  blip(x, z, color = '#ffd23c') { const b = { x, z, color }; this.blipList.push(b); return b; }
  unblip(b) { const i = this.blipList.indexOf(b); if (i >= 0) this.blipList.splice(i, 1); }

  cleanup() {
    const g = this.g;
    for (const mk of [...this.markers]) this.removeMarker(mk);
    g.hud.objective('');
    g.hud.timer(null);
    g.waypoint = null; g.hud.route = null;
    g.dialogOpen = false;
    // leave spawned things in the world but release them to normal behaviour
    for (const s of this.spawned) {
      if (s.c) { s.mission = false; if (!s.dead) { s.ai = null; s.state = 'flee'; s.fleeFrom = g.focus.clone(); s.fleeT = 6; } }
      else { s.mission = false; s.keep = false; }
    }
  }
}
