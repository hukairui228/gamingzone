import { buildModel } from './models.js';
import { WEAPONS } from './player.js';
import { Vehicle, CARS } from './vehicle.js';

// Original districts (menu table 76–83), rough zones on the original map.
const DISTRICTS = [
  [78, (x, z) => z < -650],                    // 乡村
  [81, (x, z) => x < -620 && z > -150],        // 沼泽地
  [83, (x, z) => x > 450 && z < -250],         // 北部海滩
  [82, (x, z) => x > 450],                     // 南部海滩
  [79, (x, z) => x > 180 && z > 60],           // 港口
  [76, (x, z) => z > 140 && x < 100],          // 椰树林
  [77, (x, z) => z < -300],                    // 小海地
  [80, () => true],                            // 市中心
];

const SHOPS = [
  { type: 'gun', at: [-60, -250] }, { type: 'gun', at: [-250, -505] }, { type: 'gun', at: [640, 150] }, { type: 'gun', at: [-430, 330] },
  { type: 'repair', at: [-200, 60] }, { type: 'repair', at: [560, -420] }, { type: 'repair', at: [-380, 320] }, { type: 'repair', at: [250, 160] },
  { type: 'rental', at: [40, -110] }, { type: 'rental', at: [700, 40] },
];
const SHOP_MODEL = { gun: 'checkpoint_store_gun', repair: 'checkpoint_store_repair', rental: 'checkpoint_store_rental' };
const PRICES = { bat: 150, beretta: 400, uzi: 1200, ak47: 2800, sniper: 3500, rpg: 6000 };
const AMMO_PRICE = { beretta: 60, uzi: 150, ak47: 300, sniper: 400, rpg: 900 };
const RENTALS = ['car_tawny', 'car_cooperv8_berlin', 'car_homm', 'car_vamp', 'car_plymouth_barracuda', 'car_laufer', 'car_lamb', 'bike_harley', 'bike_kawa'];
const RENT_PRICE = { car_tawny: 200, car_cooperv8_berlin: 300, car_homm: 600, car_vamp: 900, car_plymouth_barracuda: 1100, car_laufer: 1800, car_lamb: 3000, bike_harley: 500, bike_kawa: 900 };

/** Shops, police badges, collectibles, district names and the taxi/ambulance/delivery jobs. */
export class Services {
  constructor(game) {
    this.g = game;
    this.shops = [];
    this.badges = [];
    this.items = [];
    this.district = -1;
    this.job = null;
    this.cool = 0;
  }

  async init() {
    const g = this.g, R = g.roads;
    for (const s of SHOPS) {
      const n = R.nearest(s.at[0], s.at[1], 200);
      const e = R.edges[n.e];
      const p = R.point(e, 1, n.s, R.sidewalkOffset(e) * (s.type === 'repair' ? 0 : 1), {});
      s.x = p.x; s.z = p.z;
      const m = await buildModel(SHOP_MODEL[s.type]);
      m.position.set(p.x, g.world.height(p.x, p.z, 80) + 0.05, p.z);
      m.scale.setScalar(1.6);
      g.scene.add(m);
      s.m = m;
      this.shops.push(s);
    }
    // police badges lower the wanted level (original mechanic) + surfboards on the beach, wheels in the streets
    const rnd = mulberry(11);
    const collected = new Set(g.collected || []);
    const place = async (kind, model, n, filter) => {
      for (let i = 0, tries = 0; i < n && tries < 400; tries++) {
        const lane = R.randomLane(rnd);
        const e = R.edges[lane.e];
        const p = R.point(e, 1, lane.s, R.sidewalkOffset(e) + 1, {});
        if (filter && !filter(p.x, p.z)) continue;
        const y = g.world.height(p.x, p.z, 80);
        if (y === -Infinity) continue;
        const id = `${kind}${i}`;
        i++;
        if (collected.has(id)) continue;
        const m = await buildModel(model);
        m.position.set(p.x, y + 0.6, p.z);
        g.scene.add(m);
        (kind === 'badge' ? this.badges : this.items).push({ id, kind, m, x: p.x, z: p.z, y, t: Math.random() * 6 });
      }
    };
    await place('badge', 'col_badge', 14);
    await place('surf', 'col_surfboard', 8, (x) => x > 560);
    await place('wheel', 'col_wheel', 8);
  }

  districtName(x, z) { return this.g.t('menu', DISTRICTS.find(([, f]) => f(x, z))[0]); }

  update(dt) {
    const g = this.g, p = g.focus, pl = g.player;
    this.cool -= dt;
    // district banner
    const d = DISTRICTS.findIndex(([, f]) => f(p.x, p.z));
    if (d !== this.district) { if (this.district >= 0 && !g.mission) g.hud.notify(g.t('menu', DISTRICTS[d][0]), 2.2); this.district = d; }
    for (const b of this.badges) {
      b.t += dt; b.m.rotation.y += dt * 2; b.m.position.y = b.y + 0.7 + Math.sin(b.t * 3) * 0.1;
      if (!b.taken && Math.hypot(b.x - p.x, b.z - p.z) < 2.2 && Math.abs(b.y - p.y) < 3) {
        if (g.police.level === 0) continue;
        b.taken = true; b.m.visible = false; setTimeout(() => { b.taken = false; b.m.visible = true; }, 120000);
        g.police.level -= 1; g.police.heat = g.police.level; g.police.unseen = 0;
        if (!g.police.level) g.police.clear();
        g.audio.play('sfx_pickup_star', { vol: 0.7 });
        g.hud.notify(g.t('menu', 89) + '：' + (g.police.level ? '通缉等级下降' : '你已摆脱警察！'), 2);
      }
    }
    for (const c of [...this.items]) {
      c.t += dt; c.m.rotation.y += dt * 1.5; c.m.position.y = c.y + 0.7 + Math.sin(c.t * 3) * 0.12;
      if (Math.hypot(c.x - p.x, c.z - p.z) < 2.2 && Math.abs(c.y - p.y) < 3) {
        g.scene.remove(c.m); this.items.splice(this.items.indexOf(c), 1);
        g.collected = [...(g.collected || []), c.id];
        const left = this.items.filter((x) => x.kind === c.kind).length;
        g.audio.play('sfx_pickup_star', { vol: 0.7 });
        g.money += 100;
        const label = c.kind === 'surf' ? g.t('global', 318) : g.t('global', 320);
        g.hud.notify(`${label}  ${8 - left}/8`, 2.5);
        if (!left) { g.hud.big(g.t('global', 84) || '特技完成', g.t('global', c.kind === 'surf' ? 319 : 321), 5); g.audio.play('int_trophy'); }
        g.save();
      }
    }
    // shops
    if (!g.mission || !g.mission.noShops) for (const s of this.shops) {
      s.m.rotation.y += dt;
      const near = Math.hypot(s.x - p.x, s.z - p.z) < 3.5 && Math.abs(s.m.position.y - p.y) < 3;
      if (near && !s.inside && this.cool <= 0) { s.inside = true; this.open(s); }
      if (!near) s.inside = false;
    }
    if (this.job) this.updateJob(dt);
    else if (pl.vehicle && !g.mission && g.ctl.radio === false && g.input.hit('KeyT')) this.offerJob(pl.vehicle);
  }

  // ------------------------------------------------------------ shops
  open(s) {
    const g = this.g, pl = g.player;
    if (s.type === 'repair') {
      const v = pl.vehicle;
      if (!v) return;
      if (v.health >= (v.type === 'bike' ? 500 : 1000)) { g.hud.notify(g.t('global', 37)); return; }
      const cost = Math.ceil(((v.type === 'bike' ? 500 : 1000) - v.health) * 0.6);
      if (g.money < cost) { g.hud.notify(g.t('global', 36)); return; }
      g.money -= cost;
      v.health = v.type === 'bike' ? 500 : 1000;
      g.audio.play('int_menu_repair', { vol: 0.8 });
      g.hud.notify(`Fix-o-Matic  -$${cost}`, 2.5);
      if (g.police.level && !g.mission) { g.police.clear(); g.hud.notify('Fix-o-Matic：车辆重新喷漆，你已摆脱警察！', 3); }
      g.stats.repairs = (g.stats.repairs || 0) + 1;
      return;
    }
    if (pl.vehicle) return;
    g.state = 'shop';
    document.exitPointerLock?.();
    g.audio.play('int_menu_tab', { vol: 0.5 });
    const title = s.type === 'gun' ? `${g.t('menu', 98)} · 子弹时间` : `${g.t('menu', 99)} · Dale's Deals`;
    const rows = s.type === 'gun'
      ? Object.entries(PRICES).map(([k, price]) => {
        const own = pl.weapons[k];
        const ammo = AMMO_PRICE[k];
        return own && ammo ? `<button data-k="ammo:${k}">${WEAPONS[k].name} 弹药 +${WEAPONS[k].clip * 2}　$${ammo}</button>`
          : own ? `<button disabled>${WEAPONS[k].name}（已拥有）</button>` : `<button data-k="gun:${k}">${WEAPONS[k].name}　$${price}</button>`;
      }).concat([`<button data-k="health">${g.t('global', 75)}　$100</button>`, `<button data-k="armor">${g.t('global', 76)}　$250</button>`])
      : RENTALS.map((k) => `<button data-k="rent:${k}">${CARS[k].name}　$${RENT_PRICE[k]}</button>`);
    const scr = g.hud.screen(`<h2>${title}</h2><div class="missions">${rows.join('')}</div>
      <div class="row" style="margin-top:10px">$${Math.floor(g.money)}</div>
      <div class="menu" style="margin-top:10px"><button data-a="close">${g.t('menu', 43) || '返回'}</button></div>`);
    scr.onclick = (e) => {
      const k = e.target.dataset.k;
      if (e.target.dataset.a === 'close') { this.close(); return; }
      if (!k) return;
      const [kind, id] = k.split(':');
      const price = kind === 'gun' ? PRICES[id] : kind === 'ammo' ? AMMO_PRICE[id] : kind === 'rent' ? RENT_PRICE[id] : kind === 'health' ? 100 : 250;
      if (g.money < price) { g.audio.play('int_menu_cannot_select'); g.hud.notify(g.t('global', 30)); return; }
      g.money -= price;
      g.audio.play('sfx_pickup_cash', { vol: 0.6 });
      if (kind === 'gun') pl.give(id);
      if (kind === 'ammo') pl.give(id, WEAPONS[id].clip * 2);
      if (kind === 'health') pl.health = 100;
      if (kind === 'armor') pl.armor = 100;
      if (kind === 'rent') { this.close(); this.rent(id, s); return; }
      this.open(s);
    };
  }

  close() {
    const g = this.g;
    g.hud.screen('');
    g.state = 'play';
    this.cool = 2;
  }

  async rent(model, s) {
    const g = this.g, R = g.roads;
    const n = R.nearest(s.x, s.z, 100), e = R.edges[n.e], p = R.point(e, 1, n.s, R.laneOffset(e), {});
    const v = await new Vehicle(model).load();
    v.place(p.x, g.world.height(p.x, p.z, 80), p.z, Math.atan2(p.tx, p.tz));
    g.scene.add(v.root);
    g.parked.add(v);
    v.keep = true;
    g.hud.notify(CARS[model].name, 2);
  }

  // ------------------------------------------------------------ taxi / ambulance / fast-food jobs
  offerJob(v) {
    const g = this.g;
    const kind = v.model === 'car_taxi' ? 'taxi' : v.model === 'car_ambulance' ? 'ambulance' : v.model === 'car_delivery' ? 'food' : null;
    if (!kind) return;
    this.job = { kind, stage: 'pickup', count: 0, timer: 0 };
    g.hud.big(g.t('global', { taxi: 313, ambulance: 314, food: 312 }[kind]), '', 2.5);
    this.nextFare();
  }

  nextFare() {
    const g = this.g, R = g.roads, j = this.job;
    const pick = () => {
      for (let k = 0; k < 40; k++) {
        const l = R.randomLane(); const e = R.edges[l.e]; const p = R.point(e, 1, l.s, R.sidewalkOffset(e), {});
        const d = Math.hypot(p.x - g.focus.x, p.z - g.focus.z);
        if (d > 120 && d < 500) return [p.x, p.z];
      }
      return [g.focus.x + 150, g.focus.z];
    };
    j.stage = 'pickup';
    j.at = j.kind === 'food' && j.count === 0 ? [40, -150] : pick();
    j.timer = 60 + j.count * 5;
    g.setWaypoint(j.at[0], j.at[1]);
    g.hud.objective(g.t('global', { taxi: 302, ambulance: 306, food: 310 }[j.kind]));
  }

  updateJob(dt) {
    const g = this.g, j = this.job, pl = g.player;
    if (!pl.vehicle || g.mission) { g.hud.objective(''); g.hud.timer(null); g.hud.notify(g.t('global', 88)); this.job = null; g.waypoint = null; g.hud.route = null; return; }
    j.timer -= dt;
    g.hud.timer(j.timer);
    if (j.timer <= 0) { g.hud.big(g.t('global', 87), '', 3, 'red'); g.hud.objective(''); g.hud.timer(null); this.job = null; g.waypoint = null; g.hud.route = null; return; }
    const d = Math.hypot(j.at[0] - g.focus.x, j.at[1] - g.focus.z);
    if (d < 8 && pl.vehicle.speed < 3) {
      g.audio.play('int_race_checkpoint', { vol: 0.6 });
      if (j.stage === 'pickup') {
        j.stage = 'drop';
        const R = g.roads;
        for (let k = 0; k < 40; k++) {
          const l = R.randomLane(); const e = R.edges[l.e]; const p = R.point(e, 1, l.s, R.sidewalkOffset(e), {});
          const dd = Math.hypot(p.x - g.focus.x, p.z - g.focus.z);
          if (dd > 200 && dd < 700) { j.at = [p.x, p.z]; break; }
        }
        if (j.kind === 'ambulance') j.at = [492, -42];
        j.timer += 45;
        g.setWaypoint(j.at[0], j.at[1]);
        g.hud.objective(g.t('global', { taxi: 303, ambulance: 307, food: 311 }[j.kind]));
      } else {
        j.count++;
        const pay = 60 + j.count * 40;
        g.money += pay;
        g.audio.play('sfx_pickup_cash', { vol: 0.7 });
        g.hud.notify(`${g.t('global', { taxi: 301, ambulance: 305, food: 309 }[j.kind])} ${j.count}  +$${pay}`, 2.5);
        g.stats[j.kind] = (g.stats[j.kind] || 0) + 1;
        this.nextFare();
      }
    }
  }
}

function mulberry(a) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
