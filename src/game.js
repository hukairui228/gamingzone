import * as THREE from 'three';
import { Gfx } from './gfx.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { World } from './physics.js';
import { Roads } from './roads.js';
import { loadCity } from './city.js';
import { Player, WEAPONS } from './player.js';
import { GameCamera } from './camera.js';
import { Traffic } from './traffic.js';
import { Peds, PED_MODELS } from './peds.js';
import { Police } from './police.js';
import { Fx } from './fx.js';
import { Hud } from './hud.js';
import { Vehicle } from './vehicle.js';
import { buildModel } from './models.js';
import { json } from './assets.js';
import { Missions } from './missions.js';
import { Services } from './services.js';
import { Achievements } from './achievements.js';

// Landmarks (world metres, Y-up) picked from the original minimap.
export const PLACES = {
  start: [-95, -105],
  hospital: [492, -42],
  police: [-178, -205],
};

const _v = new THREE.Vector3(), _m = new THREE.Matrix4(), _r = new THREE.Ray(), _b = new THREE.Box3();

export class Game {
  constructor() {
    this.settings = Object.assign({ sensitivity: 1, autoRadio: true, sfx: 0.8, music: 0.55 }, JSON.parse(localStorage.getItem('gm_settings') || '{}'));
    this.gfx = new Gfx(document.getElementById('c'));
    this.scene = this.gfx.scene;
    this.input = new Input(this.gfx.renderer.domElement);
    this.audio = new Audio();
    this.audio.volume.sfx = this.settings.sfx; this.audio.volume.music = this.settings.music;
    this.world = new World();
    this.roads = new Roads();
    this.hud = new Hud(this);
    this.fx = new Fx(this.scene);
    this.camera = new GameCamera(this.gfx.camera, this);
    this.player = new Player(this);
    this.traffic = new Traffic(this);
    this.peds = new Peds(this);
    this.police = new Police(this);
    this.parked = new Set();
    this.pickups = [];
    this.projectiles = [];
    this.money = 0;
    this.trafficDensity = this.pedDensity = this.gfx.quality === 'low' ? 0.55 : 1;
    this.focus = new THREE.Vector3();
    this.state = 'loading';
    this.ctl = {};
    this.stats = { kills: 0, stolen: 0, wasted: 0, busted: 0 };
    this.texts = {};
  }

  async boot() {
    const H = this.hud;
    H.loading(0.05, '载入迈阿密城市模型…');
    if (this.input.isTouch) H.ready.then(() => this.input.buildTouch(H));
    await Promise.all([this.world.load(), this.roads.load(), loadCity(this.scene)]);
    H.loading(0.55, '载入角色与动画…');
    await this.player.load();
    for (const f of ['ch1', 'ch2', 'ch3', 'ch4', 'ch5', 'chx', 'chr', 'global', 'menu'])
      this.texts[f] = await json(`text/${f}.chinese.json`).catch(() => []);
    this.missions = new Missions(this);
    this.services = new Services(this);
    this.achievements = new Achievements(this);
    H.loading(0.8, '准备街道…');
    this.load();
    const [sx, sz] = this.spawnPoint || PLACES.start;
    this.placePlayer(sx, sz);
    this.focus.copy(this.player.pos);
    // warm up a few cars and pedestrians around the player
    for (let i = 0; i < 4; i++) { this.traffic.timer = 0; this.traffic.update(0.016); this.peds.timer = 0; this.peds.update(0.016); }
    this.spawnPickups();
    this.services.init().then(() => { this.servicesReady = true; });
    H.loading(1, '');
    window.__ready = true;
    this.title();
    let last = performance.now();
    this.gfx.renderer.setAnimationLoop((now) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      this.frame(dt);
    });
    addEventListener('pointerdown', () => this.audio.unlock());
    addEventListener('keydown', () => this.audio.unlock());
  }

  t(file, i) { return (this.texts[file] || [])[i] ?? ''; }

  placePlayer(x, z, yaw = 0) {
    const pl = this.player;
    if (pl.vehicle) pl.exit();
    const h = this.world.floor(x, z);
    pl.pos.set(x, h > -Infinity ? h : 2, z);
    pl.yaw = yaw; pl.vy = 0;
    this.camera.yaw = yaw;
    this.camera.target.set(x, pl.pos.y + 1.5, z);
  }

  vehicles() {
    const out = [...this.traffic.cars, ...this.parked];
    if (this.player.vehicle && !out.includes(this.player.vehicle)) out.push(this.player.vehicle);
    return out;
  }

  weaponDef() { return WEAPONS[this.player.weapon]; }

  audioVol(pos, base = 1) {
    const d = this.focus.distanceTo(pos);
    return base * Math.max(0, 1 - d / 90);
  }

  // ------------------------------------------------------------ menus
  title() {
    this.state = 'title';
    this.hud.show(false);
    this.audio.music('m_menu');
    const has = !!localStorage.getItem('gm_save');
    const s = this.hud.screen(`
      <div class="menu">
        ${has ? '<button data-a="continue">继续游戏</button>' : ''}
        <button data-a="new">${this.t('menu', 38) || '新游戏'}</button>
        <button data-a="free">自由漫游</button>
        <button data-a="missions">任务选择</button>
        <button data-a="settings">${this.t('menu', 51) || '设置'}</button>
        <button data-a="help">操作说明</button>
      </div>`, 'title');
    s.onclick = (e) => {
      const a = e.target.dataset.a;
      if (!a) return;
      this.audio.unlock();
      this.audio.play('int_menu_ok', { vol: 0.5 });
      if (a === 'continue') this.start();
      if (a === 'new') { localStorage.removeItem('gm_save'); this.money = 250; this.missions.done = []; this.start(); this.missions.startStory(); }
      if (a === 'free') this.start();
      if (a === 'missions') this.missionMenu(() => this.title());
      if (a === 'settings') this.settingsMenu(() => this.title());
      if (a === 'help') this.helpMenu(() => this.title());
    };
  }

  start() {
    this.state = 'play';
    this.hud.screen('');
    this.hud.show(true);
    this.audio.music(null);
    this.audio.unlock();
  }

  pause() {
    if (this.state !== 'play') return;
    this.state = 'pause';
    document.exitPointerLock?.();
    this.audio.play('int_menu_pause', { vol: 0.5 });
    this.audio.engine(null, 0, 0, false);
    const s = this.hud.screen(`
      <h2>暂停</h2>
      <div class="menu">
        <button data-a="resume">${this.t('menu', 42) || '继续'}</button>
        <button data-a="map">${this.t('menu', 53) || '地图'}</button>
        <button data-a="missions">任务选择</button>
        ${this.mission ? '<button data-a="abort">放弃任务</button>' : ''}
        <button data-a="ach">${this.t('menu', 104) || '成就'}</button>
        <button data-a="settings">${this.t('menu', 51) || '设置'}</button>
        <button data-a="help">操作说明</button>
        <button data-a="title">主菜单</button>
      </div>`);
    s.onclick = (e) => {
      const a = e.target.dataset.a;
      if (!a) return;
      this.audio.play('int_menu_ok', { vol: 0.4 });
      if (a === 'resume') this.resume();
      if (a === 'map') { this.resume(); this.hud.toggleMap(true); this.mapOpen = true; }
      if (a === 'abort') { this.missions.abort(); this.resume(); }
      if (a === 'missions') this.missionMenu(() => { this.state = 'play'; this.pause(); });
      if (a === 'settings') this.settingsMenu(() => { this.state = 'play'; this.pause(); });
      if (a === 'help') this.helpMenu(() => { this.state = 'play'; this.pause(); });
      if (a === 'ach') { const sc = this.hud.screen(`<h2>${this.t('menu', 104)}</h2><div class="help missions">${this.achievements.html()}</div><div class="menu" style="margin-top:12px"><button data-a="back">${this.t('menu', 43)}</button></div>`); sc.onclick = (ev) => { if (ev.target.dataset.a === 'back') { this.state = 'play'; this.pause(); } }; }
      if (a === 'title') { this.save(); this.missions.abort(); this.title(); }
    };
  }

  resume() {
    this.state = 'play';
    this.hud.screen('');
    this.audio.play('int_menu_unpause', { vol: 0.4 });
  }

  missionMenu(back) {
    const list = this.missions.list();
    const s = this.hud.screen(`<h2>${this.t('global', 31) || '选择一个任务'}</h2><div class="missions">
      ${list.map((m, i) => `<button data-i="${i}" class="${m.done ? 'done' : ''}" ${m.available ? '' : 'disabled'}>第${m.chapter}章 · ${m.title}</button>`).join('')}
      </div><div class="menu" style="margin-top:14px"><button data-a="back">${this.t('menu', 43) || '返回'}</button></div>`);
    s.onclick = (e) => {
      if (e.target.dataset.a === 'back') return back();
      const i = e.target.dataset.i;
      if (i === undefined || e.target.disabled) return;
      this.start();
      this.missions.play(list[+i].id);
    };
  }

  settingsMenu(back) {
    const q = this.gfx.quality, S = this.settings;
    const s = this.hud.screen(`<h2>${this.t('menu', 51) || '设置'}</h2><div class="menu">
      <div class="row">画质 <select data-k="quality">${['low', 'medium', 'high', 'ultra'].map((k) => `<option value="${k}" ${k === q ? 'selected' : ''}>${{ low: '低', medium: '中', high: '高', ultra: '极致' }[k]}</option>`).join('')}</select></div>
      <div class="row">${this.t('menu', 25) || '音效'} <input data-k="sfx" type="range" min="0" max="1" step="0.05" value="${S.sfx}"></div>
      <div class="row">${this.t('menu', 24) || '音乐'} <input data-k="music" type="range" min="0" max="1" step="0.05" value="${S.music}"></div>
      <div class="row">视角灵敏度 <input data-k="sensitivity" type="range" min="0.3" max="2.5" step="0.1" value="${S.sensitivity}"></div>
      <div class="row">上车自动开电台 <input data-k="autoRadio" type="checkbox" ${S.autoRadio ? 'checked' : ''}></div>
      <div class="row">时间 <input data-k="hour" type="range" min="0" max="24" step="0.25" value="${this.gfx.hour}"></div>
      <button data-a="back">${this.t('menu', 43) || '返回'}</button></div>`);
    s.oninput = s.onchange = (e) => {
      const k = e.target.dataset.k;
      if (!k) return;
      const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      if (k === 'quality') { this.gfx.setQuality(v); this.trafficDensity = this.pedDensity = v === 'low' ? 0.55 : 1; }
      else if (k === 'hour') this.gfx.hour = +v;
      else S[k] = typeof S[k] === 'number' ? +v : v;
      if (k === 'sfx' && this.audio.sfxBus) this.audio.sfxBus.gain.value = +v;
      if (k === 'music' && this.audio.musicBus) { this.audio.volume.music = +v; this.audio.musicBus.gain.value = +v; }
      localStorage.setItem('gm_settings', JSON.stringify(S));
    };
    s.onclick = (e) => { if (e.target.dataset.a === 'back') back(); };
  }

  helpMenu(back) {
    const s = this.hud.screen(`<h2>${this.t('menu', 19) || '操作'}</h2><div class="help">
      <b>WASD / 方向键</b> 移动 · 驾驶<br><b>鼠标</b> 视角 · <b>左键</b> 开火/出拳 · <b>右键</b> 瞄准<br>
      <b>Shift</b> 冲刺 · <b>空格</b> 跳跃 / 手刹<br><b>F / Enter</b> 上下车（可劫车）<br>
      <b>Q / E / 滚轮</b> 切换武器 · <b>R</b> 切换电台 · <b>H</b> 喇叭<br><b>T</b> 驾驶出租车/救护车/送货车时开始支线工作<br>直升机：<b>空格</b> 上升 · <b>Shift</b> 下降<br><b>M / Tab</b> 地图（点击设置导航）· <b>Esc / P</b> 暂停<br>
      触屏：左侧摇杆移动，右侧拖动视角，按钮操作</div><div class="menu" style="margin-top:14px"><button data-a="back">${this.t('menu', 43) || '返回'}</button></div>`);
    s.onclick = (e) => { if (e.target.dataset.a === 'back') back(); };
  }

  // ------------------------------------------------------------ save
  save() {
    const pl = this.player;
    const p = pl.vehicle ? pl.vehicle.pos : pl.pos;
    localStorage.setItem('gm_save', JSON.stringify({
      money: this.money, weapons: pl.weapons, weapon: pl.weapon, health: pl.health, armor: pl.armor,
      pos: [p.x, p.z], done: this.missions.done, hour: this.gfx.hour, stats: this.stats, collected: this.collected || [],
    }));
  }

  load() {
    const s = JSON.parse(localStorage.getItem('gm_save') || 'null');
    this.money = 250;
    this.player.give('beretta', 48);
    this.player.weapon = 'fist';
    if (!s) return;
    this.money = s.money ?? 250;
    this.player.weapons = s.weapons || this.player.weapons;
    this.player.weapon = s.weapon || 'fist';
    this.player.showWeapon();
    this.player.health = s.health ?? 100; this.player.armor = s.armor ?? 0;
    this.missions.done = s.done || [];
    this.gfx.hour = s.hour ?? 11;
    this.stats = Object.assign(this.stats, s.stats || {});
    this.collected = s.collected || [];
    if (s.pos) this.spawnPoint = s.pos;
  }

  // ------------------------------------------------------------ combat
  /** Closest hit along a ray among pedestrians, vehicles and the static world. */
  hitscan(o, d, max, shooter) {
    let best = null;
    const wall = this.world.raycast(o.x, o.y, o.z, d.x, d.y, d.z, max);
    if (wall < max) best = { type: 'world', dist: wall };
    _r.set(o, d);
    for (const p of this.peds.list) {
      if (p.dead || p === shooter) continue;
      for (const [hy, r, head] of [[1.2, 0.38, false], [1.65, 0.2, true], [0.6, 0.3, false]]) {
        _v.set(p.pos.x, p.pos.y + hy, p.pos.z);
        const dist = _r.distanceSqToPoint(_v);
        if (dist < r * r) {
          const t = _v.sub(o).dot(d);
          if (t > 0 && (!best || t < best.dist)) best = { type: 'ped', obj: p, dist: t, head };
        }
      }
    }
    for (const v of this.vehicles()) {
      if (v === this.player.vehicle && shooter === this.player) continue;
      _m.makeRotationY(v.yaw).setPosition(v.pos.x, v.pos.y, v.pos.z).invert();
      const lr = _r.clone().applyMatrix4(_m);
      _b.min.set(-v.width / 2, 0.2, v.offsetZ - v.length / 2); _b.max.set(v.width / 2, v.height, v.offsetZ + v.length / 2);
      const hit = lr.intersectBox(_b, _v);
      if (hit) { const t = hit.distanceTo(lr.origin); if (!best || t < best.dist) best = { type: 'car', obj: v, dist: t }; }
    }
    if (best) best.point = o.clone().addScaledVector(d, best.dist);
    return best;
  }

  autoAim(o, d, cone) {
    let best = null, bd = cone;
    for (const p of this.peds.list) {
      if (p.dead || (p.kind === 'civ' && !p.hostile)) continue;
      _v.set(p.pos.x, p.pos.y + 1.2, p.pos.z).sub(o);
      const dist = _v.length(), dot = _v.dot(d) / dist;
      if (dist < 60 && dot > bd) { bd = dot; best = new THREE.Vector3(p.pos.x, p.pos.y + 1.2, p.pos.z); }
    }
    return best;
  }

  applyHit(hit, dmg, from, kind) {
    if (hit.type === 'ped') {
      const p = hit.obj;
      this.peds.damage(p, hit.head ? dmg * 3 : dmg, from, kind);
      this.audio.play('sfx_impact_bullet_body', { vol: 0.6 });
      if (p.kind === 'cop') this.crime(p.dead ? 'killcop' : 'hitcop', p.pos);
      else if (!p.hostile) this.crime(p.dead ? 'kill' : 'assault', p.pos);
      if (p.onHit) p.onHit(kind);
    } else if (hit.type === 'car') {
      const v = hit.obj;
      v.health -= dmg * 0.8;
      this.fx.impact(hit.point.x, hit.point.y, hit.point.z);
      this.audio.play('sfx_impact_bullet_car', { vol: 0.5 });
      if (v.ai && v.ai.mode === 'lane') { v.ai.cruise = 22; this.peds.panic(v.pos.x, v.pos.z, 10); }
      if (v.health <= 0 && !v.exploded) this.explodeVehicle(v);
      if (v.onHit) v.onHit(kind);
    } else {
      this.fx.impact(hit.point.x, hit.point.y, hit.point.z);
      if (Math.random() < 0.4) this.audio.play('sfx_impact_bullet_ground', { vol: 0.4 });
    }
  }

  rocket(from, to) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe0a0 }));
    mesh.position.copy(from);
    this.scene.add(mesh);
    const dir = to.clone().sub(from); const len = dir.length(); dir.normalize();
    this.projectiles.push({ mesh, dir, left: len, speed: 70 });
  }

  explode(x, y, z, radius = 7, dmg = 300) {
    this.fx.explosion(x, y, z);
    this.audio.play('sfx_rpg_explosion', { vol: this.audioVol(_v.set(x, y, z), 1) });
    this.camera.shake(Math.max(0, 1 - this.focus.distanceTo(_v) / 60));
    for (const p of this.peds.list) {
      const d = Math.hypot(p.pos.x - x, p.pos.y - y, p.pos.z - z);
      if (d < radius) this.peds.damage(p, dmg * (1 - d / radius), { x, z }, 'explosion');
    }
    for (const v of this.vehicles()) {
      const d = Math.hypot(v.pos.x - x, v.pos.z - z);
      if (d < radius && !v.exploded) { v.health -= dmg * 2 * (1 - d / radius); if (v.health <= 0) setTimeout(() => this.explodeVehicle(v), 200 + Math.random() * 400); }
    }
    const pl = this.player, pd = (pl.vehicle ? pl.vehicle.pos : pl.pos).distanceTo(_v.set(x, y, z));
    if (pd < radius && !pl.vehicle) pl.hurt(dmg * 0.5 * (1 - pd / radius), { x, z });
    this.peds.panic(x, z, 60);
    this.crime('explode', { x, z });
  }

  explodeVehicle(v) {
    if (v.exploded) return;
    v.exploded = true;
    v.health = 0;
    v.vy = 7;
    v.onGround = false;
    this.explode(v.pos.x, v.pos.y + 0.8, v.pos.z, 7, 120);
    this.audio.play('sfx_car_explode', { vol: this.audioVol(v.pos, 1) });
    v.root.traverse((o) => {
      if (o.isMesh && o.material && !o.material.transparent) {
        o.material = o.material.clone();
        o.material.color = new THREE.Color(0x1a1714);
        if (o.material.clearcoat !== undefined) o.material.clearcoat = 0;
        o.material.roughness = 1;
      }
    });
    if (v.ai) { this.traffic.detach(v); this.parked.add(v); }
    v.burnT = 9;
    this.stats.carsDestroyed = (this.stats.carsDestroyed || 0) + 1;
    if (this.player.vehicle === v) { this.player.exit(); this.player.hurt(200); }
    if (v.onDestroyed) v.onDestroyed();
  }

  dropVehicle(v) {
    this.parked.delete(v);
    this.scene.remove(v.root);
  }

  async ejectDriver(v) {
    const [model, sex, variant] = v.driver === 'cop' ? ['char_skinny_cop', 'male'] : PED_MODELS[Math.floor(Math.random() * PED_MODELS.length)];
    const p = await this.peds.create(model, v.driver === 'cop' ? 'cop' : 'civ', sex, variant);
    const left = Math.cos(v.yaw), leftz = -Math.sin(v.yaw);
    p.pos.set(v.pos.x + left * 2, v.pos.y, v.pos.z + leftz * 2);
    p.c.play('fo__player__car_thrown_out_low_left', { loop: false });
    p.anim = '';
    p.state = 'flee'; p.fleeFrom = { x: v.pos.x, z: v.pos.z }; p.fleeT = 10;
    this.audio.play(sex === 'female' ? 'sfx_female_hey' : 'sfx_male_hey', { vol: 0.8 });
    this.stats.stolen++;
  }

  crime(kind, pos) { this.police.crime(kind, pos); }

  onPedKilled(p, kind) {
    this.stats.kills++;
    if (p.kind === 'cop') this.stats.copsKilled = (this.stats.copsKilled || 0) + 1;
    else if (p.kind === 'civ' && !p.hostile) this.stats.civKills = (this.stats.civKills || 0) + 1;
    if (Math.random() < 0.6 || p.kind !== 'civ') this.dropPickup('money', p.pos.x, p.pos.y, p.pos.z, 10 + Math.floor(Math.random() * 60));
    if (p.weapon && Math.random() < 0.7) this.dropPickup(p.weapon, p.pos.x + 0.6, p.pos.y, p.pos.z, 20);
    if (p.onDeath) p.onDeath(kind);
  }

  /** wasted / busted / drown, using the original screens and texts. */
  die(kind) {
    const pl = this.player;
    if (pl.dead) return;
    pl.dead = true;
    const g = this;
    if (pl.vehicle) pl.exit();
    pl.c.overlay(null);
    pl.c.play(kind === 'busted' ? 'sl__civilian_all__hands_up' : 'fo__player__idle_to_dead_01', { loop: kind === 'busted', fade: 0.1 });
    if (kind !== 'busted') this.audio.bark('vfx_johnny_killed', 4);
    this.audio.play('m_mission_die', { vol: 0.8 });
    const busted = kind === 'busted';
    const fee = Math.min(this.money, busted ? 500 + this.police.level * 300 : 400);
    this.hud.big(busted ? this.t('global', 110) : this.t('global', 107), `${busted ? this.t('global', 111) : this.t('global', 108)}：$${fee}`, 4.5, 'red');
    if (busted) this.stats.busted++; else this.stats.wasted++;
    if (this.mission) this.missions.fail(busted ? this.t('global', 110) : this.t('global', 333));
    setTimeout(() => {
      g.money -= fee;
      g.police.clear();
      const [x, z] = busted ? PLACES.police : PLACES.hospital;
      pl.dead = false; pl.health = 100; pl.armor = 0;
      if (busted) { const keep = pl.weapons.fist; pl.weapons = { fist: keep }; pl.weapon = 'fist'; pl.showWeapon(); }
      g.placePlayer(x, z);
      pl.c.play('sl__player__idle', { fade: 0 });
      g.hud.notify(busted ? g.t('global', 113) : g.t('global', 109), 5);
      g.save();
    }, 4500);
  }

  setWaypoint(x, z) {
    const p = this.focus;
    this.waypoint = { x, z };
    this.hud.route = this.roads.route(p.x, p.z, x, z);
    this.routeT = 2;
  }

  // ------------------------------------------------------------ pickups
  async spawnPickups() {
    // health / armour / weapons scattered on road sides like the original
    const kinds = ['health', 'health', 'armor', 'beretta', 'uzi', 'ak47', 'bat', 'sniper', 'rpg', 'health', 'armor', 'uzi'];
    const rnd = mulberry(7);
    for (let i = 0; i < 40; i++) {
      const lane = this.roads.randomLane(rnd);
      const e = this.roads.edges[lane.e];
      const pt = this.roads.point(e, 1, lane.s, this.roads.sidewalkOffset(e), {});
      const y = this.world.height(pt.x, pt.z, 60);
      if (y === -Infinity) continue;
      this.dropPickup(kinds[i % kinds.length], pt.x, y, pt.z, null, true);
    }
  }

  async dropPickup(kind, x, y, z, amount, respawn = false) {
    const model = { money: 'col_money', health: 'col_health_crate', armor: 'col_armor_vest' }[kind] || WEAPONS[kind]?.model;
    if (!model) return;
    const m = await buildModel(model);
    if (WEAPONS[kind]) m.scale.setScalar(1.4);
    m.position.set(x, y + 0.5, z);
    this.scene.add(m);
    this.pickups.push({ kind, m, amount, respawn, home: [x, y, z], t: 0 });
  }

  updatePickups(dt) {
    const p = this.player.vehicle ? this.player.vehicle.pos : this.player.pos;
    for (const k of [...this.pickups]) {
      k.t += dt;
      if (k.hidden) {
        if (k.t > 60) { k.hidden = false; k.m.visible = true; }
        continue;
      }
      k.m.rotation.y += dt * 2;
      k.m.position.y = k.home[1] + 0.5 + Math.sin(k.t * 3) * 0.12;
      if (Math.hypot(k.m.position.x - p.x, k.m.position.z - p.z) < 1.6 && Math.abs(k.m.position.y - p.y) < 2.2) {
        const pl = this.player;
        if (k.kind === 'money') { this.money += k.amount; this.audio.play('sfx_pickup_cash', { vol: 0.6 }); }
        else if (k.kind === 'health') { if (pl.health >= 100) continue; pl.health = 100; this.audio.play('sfx_pickup_life', { vol: 0.6 }); this.hud.notify(this.t('global', 75) || '急救包'); }
        else if (k.kind === 'armor') { pl.armor = 100; this.audio.play('sfx_pickup_vest', { vol: 0.6 }); this.hud.notify(this.t('global', 76) || '防弹衣'); }
        else {
          if (pl.vehicle) continue;
          const had = pl.weapons[k.kind];
          pl.give(k.kind, k.amount ?? WEAPONS[k.kind].ammo);
          if (!had) this.hud.notify(WEAPONS[k.kind].name);
          this.audio.play('sfx_pickup_weapons', { vol: 0.6 });
        }
        if (k.respawn) { k.hidden = true; k.t = 0; k.m.visible = false; }
        else { this.scene.remove(k.m); this.pickups.splice(this.pickups.indexOf(k), 1); }
      }
    }
  }

  // ------------------------------------------------------------ frame
  frame(dt) {
    const input = this.input;
    const ctl = this.ctl = input.state();
    if (this.state === 'play') {
      if (ctl.pause) { if (this.mapOpen) { this.mapOpen = false; this.hud.toggleMap(false); } else this.pause(); }
      if (ctl.map) { this.mapOpen = !this.mapOpen; this.hud.toggleMap(this.mapOpen); }
      if (this.inputBlockT > 0) { this.inputBlockT -= dt; ctl.jump = ctl.enter = ctl.fire = false; }
      if (this.dialogOpen || this.mapOpen) { ctl.x = ctl.y = 0; ctl.fire = ctl.aim = ctl.enter = ctl.jump = false; ctl.lookX = ctl.lookY = 0; }
      this.update(dt, ctl);
    } else if (this.state === 'pause') {
      if (ctl.pause) this.resume();
    } else if (this.state === 'shop') {
      if (ctl.pause) this.services.close();
    } else if (this.state === 'title') {
      // slow orbit over Miami behind the title menu
      const t = performance.now() / 1000;
      this.gfx.camera.position.set(Math.sin(t * 0.03) * 520 + 100, 160, Math.cos(t * 0.03) * 520 - 120);
      this.gfx.camera.lookAt(80, 0, -120);
      this.gfx.update(dt, this.gfx.camera.position);
    }
    input.endFrame();
    this.gfx.render();
  }

  update(dt, ctl) {
    const pl = this.player;
    this.gfx.hour = (this.gfx.hour + dt / 60) % 24; // one game hour per real minute
    this.camera.update(dt, ctl, pl);
    pl.update(dt, ctl, this.camera);
    pl.speedNow = Math.hypot(ctl.x, ctl.y) * (ctl.sprint ? 2 : 1);
    this.focus.copy(pl.vehicle ? pl.vehicle.pos : pl.pos);
    this.traffic.update(dt);
    this.peds.update(dt);
    this.police.update(dt);
    // free vehicles (crashed, parked, burning)
    for (const v of this.parked) {
      if (v === pl.vehicle || v.cop || v.mission) continue;
      if (v.speed > 0.2 || !v.onGround) v.update(dt, { throttle: 0, steer: 0, handbrake: true }, this.world);
      if (v.burnT > 0) { v.burnT -= dt; if (Math.random() < dt * 20) this.fx.smokeFrom(v.pos.x, v.pos.y + 1, v.pos.z, v.burnT > 5); }
      if (v.pos.distanceTo(this.focus) > 300 && !v.keep) this.dropVehicle(v);
    }
    // car vs car / car vs pedestrian
    const cars = this.vehicles();
    for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i], b = cars[j];
      if (Math.abs(a.pos.x - b.pos.x) > 8 || Math.abs(a.pos.z - b.pos.z) > 8) continue;
      Traffic.collide(a, b, (x, y, rel) => {
        for (const c of [x, y]) {
          c.health -= rel * 12;
          if (c.ai && c.ai.mode === 'lane') { c.ai.mode = 'physics'; c.ai.calm = 0; }
          if (!this.parked.has(c) && !c.ai && c !== pl.vehicle) this.parked.add(c);
        }
        if (rel > 3) this.audio.play(rel > 10 ? 'sfx_car_impact_hard' : 'sfx_car_impact_medium', { vol: this.audioVol(x.pos, Math.min(1, rel / 12)) });
        if ((x === pl.vehicle || y === pl.vehicle) && rel > 6) { this.camera.shake(Math.min(0.5, rel / 30)); const o = x === pl.vehicle ? y : x; if (o.driver === 'cop') this.crime('hitcop', o.pos); }
      });
    }
    for (const v of cars) {
      if (v.speed < 3) continue;
      for (const p of this.peds.list) {
        if (p.dead) continue;
        const dx = p.pos.x - v.pos.x, dz = p.pos.z - v.pos.z;
        const lx = dx * Math.cos(v.yaw) - dz * Math.sin(v.yaw), lz = dx * Math.sin(v.yaw) + dz * Math.cos(v.yaw) - v.offsetZ;
        if (Math.abs(lx) < v.width / 2 + 0.3 && Math.abs(lz) < v.length / 2 + 0.3 && Math.abs(p.pos.y - v.pos.y) < 2) {
          this.peds.damage(p, v.speed * 8, v.pos, 'car');
          if (v === pl.vehicle) { this.crime(p.kind === 'cop' ? 'killcop' : 'runover', p.pos); this.audio.play('sfx_impact_bullet_body', { vol: 0.8 }); }
          p.pos.x += Math.sin(v.yaw) * 1.5; p.pos.z += Math.cos(v.yaw) * 1.5;
        }
      }
    }
    // projectiles
    for (const pr of [...this.projectiles]) {
      const step = pr.speed * dt;
      pr.mesh.position.addScaledVector(pr.dir, step);
      pr.left -= step;
      if (Math.random() < 0.8) this.fx.emit('smoke', pr.mesh.position.x, pr.mesh.position.y, pr.mesh.position.z, { size: 0.5, life: 0.8, grow: 3, opacity: 0.5 });
      if (pr.left <= 0) {
        this.scene.remove(pr.mesh);
        this.projectiles.splice(this.projectiles.indexOf(pr), 1);
        this.explode(pr.mesh.position.x, pr.mesh.position.y, pr.mesh.position.z, 8, 400);
      }
    }
    this.updatePickups(dt);
    if (this.missions) this.missions.update(dt);
    if (this.servicesReady) this.services.update(dt);
    this.achievements.update(dt);
    // waypoint GPS
    if (this.waypoint) {
      this.routeT -= dt;
      if (this.routeT <= 0) { this.routeT = 2; this.hud.route = this.roads.route(this.focus.x, this.focus.z, this.waypoint.x, this.waypoint.z); }
      if (Math.hypot(this.focus.x - this.waypoint.x, this.focus.z - this.waypoint.z) < 15 && !this.mission) { this.waypoint = null; this.hud.route = null; }
    }
    this.hud.blips = this.collectBlips();
    this.input.setTouchMode(!!pl.vehicle);
    this.fx.update(dt);
    this.gfx.update(dt, this.focus);
    this.hud.update(dt);
    this.saveT = (this.saveT || 0) + dt;
    if (this.saveT > 20 && !this.mission) { this.saveT = 0; this.save(); }
  }

  collectBlips() {
    const out = [];
    for (const v of this.police.cars) out.push({ x: v.pos.x, z: v.pos.z, color: Math.floor(performance.now() / 300) % 2 ? '#2a6cff' : '#ff2a2a', small: true });
    for (const p of this.police.foot) out.push({ x: p.pos.x, z: p.pos.z, color: '#2a6cff', small: true });
    if (this.missions) out.push(...this.missions.blips());
    if (this.waypoint) out.push({ x: this.waypoint.x, z: this.waypoint.z, color: '#ff2fb0' });
    if (this.servicesReady) for (const s of this.services.shops) out.push({ x: s.x, z: s.z, color: { gun: '#ff9a1f', repair: '#9aff5a', rental: '#c77dff' }[s.type], small: true });
    return out;
  }
}

function mulberry(a) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

export { Vehicle };
