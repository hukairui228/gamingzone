// Side activities & services: shops, garage tuning, hospital, safehouse, taxi, street races, drift trial.
import { G } from './state.js';
import { Marker } from './pickups.js';
import { WEAPONS, WEAPON_ORDER } from './weapons.js';
import { Driver } from './traffic.js';
import { fmtMoney, rand, pick, clamp, dist } from './util.js';
import { P, HALF, LANE_OFF, BEACH, CZ, nodes, nearestLanePoint, CITY, NX, NZ } from './layout.js';
import { CAR_TYPES } from './vehicle.js';

const $ = (id) => document.getElementById(id);
const PAINTS = [0xd7263d, 0xff6fb5, 0xf18f01, 0xe0c341, 0x3dff7a, 0x1b998b, 0x2ef2ff, 0x2e86ab, 0x5b2a86, 0xb44dff, 0xf4f4f4, 0x8c8c8c, 0x111111, 0x6b3e1f];
const GLOWS = [null, 0xff3fa4, 0x2ef2ff, 0xb44dff, 0x3dff7a, 0xffb02e, 0xff3355, 0xffffff];

// race routes (checkpoints by world coords)
const RACES = [
  {
    name: '海滨大道冲刺', start: { x: 10 * P + 3, z: 11 * P - 30, h: Math.PI }, prize: 2500,
    cps: [[10 * P, 8 * P], [10 * P, 5 * P + 30], [10 * P, 2 * P], [8 * P, 1 * P], [8 * P, 4 * P], [6 * P, 4 * P], [6 * P, 7 * P], [9 * P, 7 * P], [9 * P, 10 * P], [10 * P, 11 * P + 30]],
  },
  {
    name: '码头环线', start: { x: 0 * P - 3, z: 1 * P + 30, h: 0 }, prize: 3500,
    cps: [[0, 4 * P], [0, 8 * P], [0, 11 * P], [3 * P, 11 * P], [3 * P, 8 * P], [2 * P, 8 * P], [2 * P, 4 * P], [3 * P, 2 * P], [1 * P, 1 * P], [0, 1 * P + 10]],
  },
];

export class Activities {
  constructor() {
    this.markers = {};
    this.taxi = null;
    this.race = null;
    this.drift = null;
    this.shopOpen = false;
    this.cool = 0;
  }

  init() {
    const m = G.world.markers;
    this.markers.gunshop = new Marker(m.gunshop.x, m.gunshop.z, 0xff3355, 1.6, 6);
    this.markers.hospital = new Marker(m.hospital.x, m.hospital.z, 0xff5577, 1.6, 6);
    this.markers.safehouse = new Marker(m.safehouse.x, m.safehouse.z, 0x3dff7a, 1.6, 6);
    this.markers.garage = new Marker(m.garage.x, m.garage.z, 0xffb02e, 3.5, 6);
    this.raceMarkers = RACES.map((r) => new Marker(r.start.x, r.start.z, 0x2ef2ff, 3, 18));
    this.driftMarker = new Marker(-20, 6 * P + 40, 0xb44dff, 3, 18);
  }

  blips() {
    const out = [];
    RACES.forEach((r) => out.push({ x: r.start.x, z: r.start.z, ch: '🏁', col: '#2ef2ff', label: r.name }));
    out.push({ x: this.driftMarker.x, z: this.driftMarker.z, ch: 'D', col: '#b44dff', label: '漂移挑战' });
    if (this.taxi && this.taxi.target) out.push({ x: this.taxi.target.x, z: this.taxi.target.z, ch: '●', col: '#ffd166', edge: true, mission: true });
    if (this.race && this.race.cps[this.race.idx]) { const c = this.race.cps[this.race.idx]; out.push({ x: c[0], z: c[1], ch: '●', col: '#2ef2ff', edge: true, mission: true }); }
    return out;
  }

  busy() { return !!(this.taxi || this.race || this.drift) || (G.missions && G.missions.active); }

  update(dt) {
    const pl = G.player;
    for (const k in this.markers) this.markers[k].update(dt);
    this.raceMarkers.forEach((m) => m.update(dt));
    this.driftMarker.update(dt);
    this.markers.garage.setVisible(G.save.unlocked.garage);
    this.cool -= dt;
    if (pl.dead || this.shopOpen) return;
    const onFoot = !pl.inVehicle;
    const mk = this.markers;
    const inMission = G.missions && G.missions.active;
    if (this.cool <= 0 && !inMission) {
      if (onFoot && mk.gunshop.inside(pl.x, pl.z)) { this.cool = 3; this.openGunShop(); }
      else if (onFoot && mk.hospital.inside(pl.x, pl.z)) { this.cool = 3; this.hospital(); }
      else if (onFoot && mk.safehouse.inside(pl.x, pl.z)) { this.cool = 4; this.safehouse(); }
      else if (!onFoot && G.save.unlocked.garage && mk.garage.inside(pl.x, pl.z, 1)) {
        if (pl.inVehicle.speed < 2) { this.cool = 4; this.openGarage(); } else G.hud.prompt('停车进入车行');
      }
    }
    // activity starts (only when free)
    if (!this.busy()) {
      RACES.forEach((r, k) => {
        if (this.raceMarkers[k].inside(pl.x, pl.z, 1)) {
          G.hud.prompt(pl.inVehicle ? `街头赛「${r.name}」 奖金 ${fmtMoney(r.prize)} — 停车开始` : '需要一辆车参加街头赛');
          if (pl.inVehicle && pl.inVehicle.speed < 2) this.startRace(k);
        }
      });
      if (this.driftMarker.inside(pl.x, pl.z, 1)) {
        G.hud.prompt(pl.inVehicle ? '漂移挑战：60 秒内拿到 25,000 分 — 停车开始' : '需要一辆车参加漂移挑战');
        if (pl.inVehicle && pl.inVehicle.speed < 2) this.startDrift();
      }
      if (pl.inVehicle && pl.inVehicle.t.taxi) {
        G.hud.prompt(G.input.touchMode ? '' : '按 <kbd>T</kbd> 开始出租车载客', 0.3);
        if (G.input.pressed('taxi')) this.startTaxi();
      }
    }
    if (this.taxi) this.updateTaxi(dt);
    if (this.race) this.updateRace(dt);
    if (this.drift) this.updateDrift(dt);
  }

  // ---------------- shop UI ----------------
  openPanel(title, build) {
    this.shopOpen = true;
    G.setPaused(true, 'shop');
    $('shopTitle').textContent = title;
    const render = () => { $('shopBody').innerHTML = build(); bind(); };
    const bind = () => {
      $('shopBody').querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => { this.onAct(b.dataset.act, b.dataset.arg); render(); }));
    };
    this.rerender = render;
    render();
    $('shop').classList.remove('hidden');
    $('btnShopClose').onclick = () => this.closePanel();
  }
  closePanel() {
    $('shop').classList.add('hidden');
    this.shopOpen = false;
    G.setPaused(false);
    G.persist();
  }
  buy(price) {
    if (G.save.money < price) { G.audio.ui('fail'); G.hud.notify('钱不够！'); return false; }
    G.save.money -= price; G.audio.ui('cash');
    return true;
  }
  discount() { return 1 - Math.min(0.5, Math.floor(G.save.badges.length / 5) * 0.1); }

  openGunShop() {
    this.openPanel('烈焰枪械店', () => {
      const d = this.discount();
      let h = d < 1 ? `<p>💎 徽章会员折扣 ${Math.round((1 - d) * 100)}%</p>` : '';
      for (const id of WEAPON_ORDER) {
        if (id === 'fist') continue;
        const w = WEAPONS[id];
        const owned = !!G.save.weapons[id];
        const lock = id === 'rocket' && G.save.mission < 6;
        h += `<div class="shop-item"><div><b>${w.icon} ${w.name}</b><div class="desc">${owned ? '弹药 ' + (G.save.ammo[id] || 0) : '未拥有'}${lock ? ' · 完成第 6 个任务后解锁' : ''}</div></div><div>`;
        if (!owned && !lock) h += `<button class="mbtn small" data-act="weapon" data-arg="${id}">购买 ${fmtMoney(Math.round(w.price * d))}</button>`;
        if (owned) h += `<button class="mbtn small" data-act="ammo" data-arg="${id}">弹药 +${w.ammoPack} ${fmtMoney(Math.round(w.ammoPrice * d))}</button>`;
        h += '</div></div>';
      }
      h += `<div class="shop-item"><div><b>🛡️ 防弹衣</b><div class="desc">当前 ${Math.round(G.player.char.armor)}/100</div></div><button class="mbtn small" data-act="armor">${fmtMoney(Math.round(400 * d))}</button></div>`;
      return h;
    });
  }

  openGarage() {
    const v = G.player.inVehicle;
    if (!v) return;
    this.openPanel("老萨尔的车行", () => {
      const cost = Math.round((1 - v.hp / v.maxHp) * 600);
      let h = `<p>当前车辆：<b>${v.t.name}</b> · 车况 ${Math.round(v.hp / v.maxHp * 100)}%</p>`;
      h += `<div class="shop-item"><div><b>🔧 修理</b></div><button class="mbtn small" data-act="repair">${fmtMoney(cost)}</button></div>`;
      if (G.police.level > 0) h += `<div class="shop-item"><div><b>🎨 喷漆换牌（清除通缉）</b><div class="desc">${G.police.level} 星通缉</div></div><button class="mbtn small" data-act="clearwanted">${fmtMoney(250 * G.police.level)}</button></div>`;
      h += '<h3>车漆（$150）</h3><div class="swatches">' + PAINTS.map((c) => `<div class="swatch" style="background:#${c.toString(16).padStart(6, '0')}" data-act="paint" data-arg="${c}"></div>`).join('') + '</div>';
      h += '<h3>霓虹底盘灯（$800）</h3><div class="swatches">' + GLOWS.map((c) => `<div class="swatch" style="background:${c === null ? 'repeating-linear-gradient(45deg,#333,#333 4px,#555 4px,#555 8px)' : '#' + c.toString(16).padStart(6, '0')};box-shadow:0 0 10px ${c === null ? 'transparent' : '#' + c.toString(16).padStart(6, '0')}" data-act="glow" data-arg="${c}"></div>`).join('') + '</div>';
      h += '<h3>性能改装</h3>';
      const lv = v.powerMul > 1.25 ? 3 : v.powerMul > 1.1 ? 2 : v.powerMul > 1 ? 1 : 0;
      h += `<div class="shop-item"><div><b>⚙️ 引擎调校 Lv.${lv}/3</b><div class="desc">+12% 动力与极速</div></div>${lv < 3 ? `<button class="mbtn small" data-act="engine">${fmtMoney(2000 + lv * 1500)}</button>` : '已满级'}</div>`;
      h += `<div class="shop-item"><div><b>🛡️ 装甲车身</b><div class="desc">车身耐久 +60%</div></div>${v.armored ? '已安装' : `<button class="mbtn small" data-act="carmor">${fmtMoney(2500)}</button>`}</div>`;
      h += `<div class="shop-item"><div><b>🔥 氮气加速套件</b><div class="desc">Shift 释放 · 漂移可补充</div></div>${v.nitroMax > 0 ? '已安装' : `<button class="mbtn small" data-act="nitro">${fmtMoney(G.save.unlocked.nitro ? 0 : 4000)}</button>`}</div>`;
      h += `<div class="shop-item"><div><b>💾 停入安全屋车库</b><div class="desc">以后会停在安全屋门口</div></div><button class="mbtn small" data-act="savecar">免费</button></div>`;
      if (G.save.unlocked.supercar) h += `<div class="shop-item"><div><b>⚡ 提取「闪电 SX」超跑</b><div class="desc">夜赛冠军奖励</div></div><button class="mbtn small" data-act="getsuper">免费</button></div>`;
      return h;
    });
  }

  onAct(act, arg) {
    const pl = G.player, v = pl.inVehicle, d = this.discount();
    switch (act) {
      case 'weapon': { const w = WEAPONS[arg]; if (this.buy(Math.round(w.price * d))) { pl.giveWeapon(arg, w.ammoPack); G.hud.notify(`购买了 ${w.name}`); } break; }
      case 'ammo': { const w = WEAPONS[arg]; if (this.buy(Math.round(w.ammoPrice * d))) { G.save.ammo[arg] = (G.save.ammo[arg] || 0) + w.ammoPack; if (!pl.mag[arg]) pl.mag[arg] = Math.min(w.mag, G.save.ammo[arg]); G.hud.weapon(); } break; }
      case 'armor': if (pl.char.armor < 100 && this.buy(Math.round(400 * d))) pl.char.armor = 100; break;
      case 'repair': { const c = Math.round((1 - v.hp / v.maxHp) * 600); if (this.buy(c)) { v.hp = v.maxHp; v.burning = 0; } break; }
      case 'clearwanted': if (this.buy(250 * G.police.level)) { G.police.setLevel(0); G.hud.notify('换了车漆和车牌，警察认不出你了'); G.events.emit('wantedCleared'); } break;
      case 'paint': if (this.buy(150)) { v.setColor(+arg); } break;
      case 'glow': if (this.buy(800)) { v.setGlow(arg === 'null' ? null : +arg); } break;
      case 'engine': { const lv = v.powerMul > 1.25 ? 3 : v.powerMul > 1.1 ? 2 : v.powerMul > 1 ? 1 : 0; if (lv < 3 && this.buy(2000 + lv * 1500)) v.powerMul = 1 + (lv + 1) * 0.12; break; }
      case 'carmor': if (!v.armored && this.buy(2500)) { v.armored = true; v.maxHp *= 1.6; v.hp = v.maxHp; } break;
      case 'nitro': if (v.nitroMax <= 0 && this.buy(G.save.unlocked.nitro ? 0 : 4000)) { v.nitroMax = 1; v.nitro = 1; } break;
      case 'savecar':
        G.save.garageCar = { type: v.typeKey, color: v.color, glow: v.glowColor ?? null, power: v.powerMul, armored: !!v.armored, nitro: v.nitroMax };
        G.hud.notify('车辆已保存，会停在安全屋门口。');
        break;
      case 'getsuper': {
        const m = G.world.markers.garageCar;
        const s = G.vehicles.spawn('super', m.x, m.z, m.h, 0xff3fa4, { nitroMax: 1, persistent: true });
        s.setGlow(0x2ef2ff);
        G.hud.notify('超跑已停在车行门口！');
        break;
      }
    }
    G.hud.weapon();
  }

  hospital() {
    const pl = G.player;
    if (pl.char.hp >= 100) { G.hud.notify('圣玛丽医院：你很健康。'); return; }
    if (G.save.money >= 100) { G.save.money -= 100; pl.char.hp = 100; G.hud.notify('医生帮你包扎好了伤口（-$100）'); G.audio.ui('pickup'); }
  }

  safehouse() {
    if (G.police.level > 0) { G.hud.notify('被通缉时不能存档。'); return; }
    G.persist();
    G.hud.big('游戏已保存', 'blue', '安全屋', 2);
    G.player.char.hp = 100;
    G.audio.ui('evade');
  }

  // ---------------- taxi ----------------
  startTaxi() {
    this.taxi = { streak: 0, state: 'find', timer: 0 };
    G.hud.notify('🚕 出租车任务开始！在黄色光柱处接乘客。');
    this.nextFare();
  }
  nextFare() {
    const T = this.taxi, pl = G.player;
    // pickup point on a nearby sidewalk
    const a = Math.random() * Math.PI * 2, r = rand(120, 260);
    let x = clamp(pl.x + Math.cos(a) * r, 0, NX * P), z = clamp(pl.z + Math.sin(a) * r, 0, NZ * P);
    const lp = nearestLanePoint(x, z);
    x = lp.x; z = lp.z;
    T.state = 'pickup'; T.target = { x, z }; T.timer = 60;
    T.marker = new Marker(x, z, 0xffd166, 3, 14);
    T.ped = G.pedSys.spawn('civ', x + (Math.random() < 0.5 ? 9 : -9) * 0.5, z, 0);
    T.ped.state = 'stand'; T.ped.mission = { blip: false };
    G.hud.objective('接上乘客');
  }
  updateTaxi(dt) {
    const T = this.taxi, pl = G.player, v = pl.inVehicle;
    if (T.marker) T.marker.update(dt);
    if (!v || !v.t.taxi || v.dead) { this.endTaxi('你离开了出租车，载客结束。'); return; }
    T.timer -= dt;
    G.hud.timer(T.timer);
    if (T.timer <= 0) { this.endTaxi('超时了！乘客很生气。'); return; }
    if (T.state === 'pickup') {
      if (T.ped.char.dead) { this.endTaxi('乘客……死了。'); return; }
      if (T.marker.inside(v.x, v.z, 1.5) && v.speed < 2) {
        T.ped.dispose(); G.pedSys.list.splice(G.pedSys.list.indexOf(T.ped), 1);
        T.marker.dispose();
        let x, z, tries = 0;
        do { x = rand(0, NX * P); z = rand(0, NZ * P); tries++; } while (dist(x, z, v.x, v.z) < 350 && tries < 30);
        const lp = nearestLanePoint(x, z);
        T.target = { x: lp.x, z: lp.z };
        T.marker = new Marker(lp.x, lp.z, 0xffd166, 3, 14);
        T.state = 'drop';
        T.distance = dist(lp.x, lp.z, v.x, v.z);
        T.timer = 20 + T.distance / 11;
        G.audio.ui('checkpoint');
        G.hud.subtitle(pick(['<b>乘客</b>：去这儿，快点！', '<b>乘客</b>：我赶飞机……开玩笑的，没机场。快走！', '<b>乘客</b>：别开太猛，我刚吃完海鲜。', '<b>乘客</b>：老兄，放点音乐？', '<b>乘客</b>：听说珊瑚帮最近很嚣张啊。']), 3);
        G.hud.objective('把乘客送到目的地');
      }
    } else if (T.state === 'drop') {
      if (T.marker.inside(v.x, v.z, 1.5) && v.speed < 2) {
        T.streak++;
        const fare = Math.floor(T.distance * 0.6 + T.timer * 6) + T.streak * 50;
        G.addMoney(fare);
        G.save.stats.taxiFares += fare;
        G.hud.big(`车费 ${fmtMoney(fare)}`, 'gold', `连续载客 ${T.streak}`, 2);
        T.marker.dispose();
        this.nextFare();
      }
    }
  }
  endTaxi(msg) {
    const T = this.taxi;
    if (T.marker) T.marker.dispose();
    if (T.ped && !T.ped.removed && T.state === 'pickup') { T.ped.state = 'walk'; T.ped.mission = null; }
    this.taxi = null;
    G.hud.timer(null); G.hud.objective('');
    if (msg) G.hud.notify(msg);
  }

  // ---------------- street race ----------------
  startRace(k) {
    const R = RACES[k], pl = G.player, v = pl.inVehicle;
    const s = R.start;
    v.place(s.x, s.z, s.h);
    const racers = [];
    const types = ['super', 'coupe', 'muscle'];
    for (let i = 0; i < 3; i++) {
      const off = [[LANE_OFF[1] * 0 - 4.5, -8], [4.5, -8], [0, -15]][i];
      const fx = Math.sin(s.h), fz = Math.cos(s.h), rx = -Math.cos(s.h), rz = Math.sin(s.h);
      const x = s.x + rx * off[0] + fx * off[1], z = s.z + rz * off[0] + fz * off[1];
      const rc = G.vehicles.spawn(types[i], x, z, s.h, undefined, { powerMul: 0.92 + i * 0.03, persistent: true });
      rc.setGlow(pick([0xff3fa4, 0x2ef2ff, 0xb44dff]));
      rc.driver = { team: 'civ' };
      const route = R.cps.map(([cx, cz]) => ({ x: cx + rand(-2, 2), z: cz + rand(-2, 2), radius: 12, speed: 42 }));
      rc.ai = new Driver(rc, { mode: 'route', route, aggressive: true, ignoreLights: true });
      rc.ai.mode = 'parked';
      rc.ai._route = 'route';
      racers.push(rc);
    }
    this.race = { k, R, racers, idx: 0, count: 3.99, t: 0, cps: R.cps, marker: null };
    v.input.throttle = 0;
    G.hud.objective(`街头赛：${R.name}`);
    G.hud.notify('🏁 准备……');
  }
  updateRace(dt) {
    const S = this.race, pl = G.player, v = pl.inVehicle;
    if (S.count > 0) {
      S.count -= dt;
      if (v) { v.vx *= 0.5; v.vz *= 0.5; }
      const n = Math.ceil(S.count);
      if (S.lastN !== n) { S.lastN = n; G.hud.big(n > 0 ? String(n) : 'GO!', n > 0 ? 'gold' : 'blue', '', 0.8); G.audio.ui(n > 0 ? 'click' : 'start'); }
      if (S.count <= 0) {
        for (const r of S.racers) r.ai.mode = 'route';
        this.placeCp();
      }
      return;
    }
    S.t += dt;
    G.hud.timer(S.t);
    if (!v || v.dead) { this.endRace(false, '你的车毁了 / 离开了车辆'); return; }
    if (S.marker) S.marker.update(dt);
    const cp = S.cps[S.idx];
    if (Math.hypot(v.x - cp[0], v.z - cp[1]) < 14) {
      S.idx++;
      G.audio.ui('checkpoint');
      if (S.idx >= S.cps.length) {
        // position
        const ahead = S.racers.filter((r) => r.ai && r.ai.routeIdx >= S.cps.length).length;
        this.endRace(ahead === 0, ahead === 0 ? '冠军！' : `第 ${ahead + 1} 名`);
        return;
      }
      this.placeCp();
    }
    // live position
    const myProg = S.idx * 10000 - Math.hypot(v.x - cp[0], v.z - cp[1]);
    let pos = 1;
    for (const r of S.racers) {
      if (!r.ai || r.dead) continue;
      const rc = S.cps[Math.min(r.ai.routeIdx, S.cps.length - 1)];
      const prog = r.ai.routeIdx * 10000 - Math.hypot(r.x - rc[0], r.z - rc[1]);
      if (prog > myProg) pos++;
    }
    G.hud.objective(`街头赛：${S.R.name} · 名次 ${pos}/4 · 检查点 ${S.idx}/${S.cps.length}`);
  }
  placeCp() {
    const S = this.race;
    if (S.marker) S.marker.dispose();
    const c = S.cps[S.idx];
    S.marker = new Marker(c[0], c[1], 0x2ef2ff, 6, 25);
  }
  endRace(win, msg) {
    const S = this.race;
    if (S.marker) S.marker.dispose();
    for (const r of S.racers) { r.persistent = false; r.traffic = true; if (r.ai) { r.ai.mode = 'cruise'; r.ai.lastEdge = null; } }
    this.race = null;
    G.hud.timer(null); G.hud.objective('');
    if (win) { G.addMoney(S.R.prize); G.save.stats.racesWon++; G.hud.big('冠军！', 'gold', `奖金 ${fmtMoney(S.R.prize)} · 用时 ${S.t.toFixed(1)}s`, 4); G.audio.ui('mission'); }
    else { G.hud.big('比赛结束', 'red', msg, 3); G.audio.ui('fail'); }
  }

  // ---------------- drift trial ----------------
  startDrift() {
    this.drift = { t: 60, score: 0 };
    G.hud.big('漂移挑战', 'blue', '60 秒内拿到 25,000 分！', 2);
    this.driftOff = G.events.on('driftBanked', (pts) => { if (this.drift) this.drift.score += pts; });
  }
  updateDrift(dt) {
    const D = this.drift, pl = G.player;
    D.t -= dt;
    G.hud.timer(D.t);
    const live = pl.drift.active ? Math.floor(pl.drift.score) : 0;
    G.hud.objective(`漂移挑战 · ${(D.score + live).toLocaleString()} / 25,000`);
    if (D.t <= 0 || !pl.inVehicle) {
      pl.bankDrift();
      const ok = D.score >= 25000;
      if (ok) { G.addMoney(5000); G.hud.big('漂移之王！', 'gold', `${D.score.toLocaleString()} 分 · 奖金 $5,000`, 4); G.audio.ui('mission'); }
      else G.hud.big('挑战失败', 'red', `${D.score.toLocaleString()} 分`, 3);
      this.driftOff && this.driftOff();
      this.drift = null; G.hud.timer(null); G.hud.objective('');
    }
  }

  cancelAll() {
    if (this.taxi) this.endTaxi();
    if (this.race) this.endRace(false, '');
    if (this.drift) { this.driftOff && this.driftOff(); this.drift = null; G.hud.timer(null); G.hud.objective(''); }
  }
}

void BEACH; void CZ; void nodes; void CITY; void HALF; void CAR_TYPES;
