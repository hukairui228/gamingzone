// Original story campaign for Solara Bay: async mission scripting with fail/cancel support.
import { G } from './state.js';
import { Marker } from './pickups.js';
import { Driver } from './traffic.js';
import { OUTFITS, gangOutfit } from './character.js';
import { P, HALF, LANE_OFF, CZ, ISLAND, ISLAND_END_X, CAUSEWAY, BEACH, nearestLanePoint, groundHeight, nodes, nearestNode } from './layout.js';
import { fmtMoney, rand, pick, dist } from './util.js';

class Fail extends Error {}

const SAY = (who, text) => `<b>${who}</b>：${text}`;

export class Missions {
  constructor() {
    this.active = null;
    this.waiters = [];
    this.failChecks = [];
    this.spawned = { vehicles: [], peds: [], markers: [], pickups: [] };
    this.gpsTarget = null;
    this.startMarker = null;
    this.noPolice = false;
    this.list = buildMissions(this);
    this.sal = null;
    G.events.on('playerDied', () => this.active && this.fail('你倒下了'));
    G.events.on('busted', () => this.active && this.fail('你被捕了'));
  }

  // ---------- scripting helpers ----------
  waitUntil(fn) { return new Promise((res, rej) => this.waiters.push({ fn, res, rej })); }
  wait(sec) { const end = G.time + sec; return this.waitUntil(() => G.time >= end); }
  async say(who, text, sec = 3.6) { G.hud.subtitle(SAY(who, text), sec); await this.wait(sec * 0.92); }
  objective(t) { G.hud.objective(t); }
  marker(x, z, color = 0xffd166, r = 3, h = 22) { const m = new Marker(x, z, color, r, h); this.spawned.markers.push(m); return m; }
  removeMarker(m) { m.dispose(); const a = this.spawned.markers; const i = a.indexOf(m); if (i >= 0) a.splice(i, 1); }
  async goto(x, z, { r = 4, car = null, stop = false, label = '', color = 0xffd166, onFoot = false } = {}) {
    const m = this.marker(x, z, color, r);
    this.gpsTarget = { x, z };
    if (label) this.objective(label);
    await this.waitUntil(() => {
      const pl = G.player;
      if (car === true && !pl.inVehicle) return false;
      if (car && car !== true && pl.inVehicle !== car) return false;
      if (onFoot && pl.inVehicle) return false;
      if (stop && pl.inVehicle && pl.inVehicle.speed > 3) return false;
      return m.inside(pl.x, pl.z, 1);
    });
    this.removeMarker(m);
    this.gpsTarget = null;
    G.audio.ui('checkpoint');
  }
  failIf(fn, reason) { const c = { fn, reason }; this.failChecks.push(c); return () => { const i = this.failChecks.indexOf(c); if (i >= 0) this.failChecks.splice(i, 1); }; }
  vehicle(type, x, z, h, color, opts) { const v = G.vehicles.spawn(type, x, z, h, color, { persistent: true, ...opts }); this.spawned.vehicles.push(v); return v; }
  ped(team, x, z, h, outfit, weapon) {
    const p = G.pedSys.spawn(team, x, z, h, outfit);
    p.mission = { noWanted: team === 'gang', blip: team === 'gang' };
    p.persistent = true;
    if (weapon) p.setWeapon(weapon);
    this.spawned.peds.push(p);
    return p;
  }
  timer(sec) {
    const end = G.time + sec;
    this.timerEnd = end;
    const off = this.failIf(() => G.time > end, '时间到了');
    return () => { off(); this.timerEnd = null; G.hud.timer(null); };
  }

  // ---------- lifecycle ----------
  blips() {
    const out = [];
    if (!this.active && this.list[G.save.mission]) {
      const m = this.list[G.save.mission];
      const p = m.where();
      out.push({ x: p.x, z: p.z, ch: '★', col: '#ffd166', label: m.title, edge: true, mission: true });
    }
    if (this.gpsTarget) out.push({ x: this.gpsTarget.x, z: this.gpsTarget.z, ch: '●', col: '#ffd166', edge: true, mission: true });
    for (const v of this.spawned.vehicles) if (v.blip && !v.dead && !v.removed) out.push({ x: v.x, z: v.z, ch: '▲', col: v.blip, edge: true, mission: true });
    return out;
  }

  update(dt) {
    // start marker
    const next = this.list[G.save.mission];
    if (!this.active && next) {
      const p = next.where();
      if (!this.startMarker || this.startMarker.mid !== G.save.mission) {
        if (this.startMarker) this.startMarker.dispose();
        this.startMarker = new Marker(p.x, p.z, 0xffd166, 2.4, 40);
        this.startMarker.mid = G.save.mission;
      }
      this.startMarker.update(dt);
      const pl = G.player;
      if (!pl.dead && this.startMarker.inside(pl.x, pl.z, 0.5) && !G.activities.busy() && G.police.level === 0) {
        if (next.needCar && !pl.inVehicle) G.hud.prompt('需要开车来');
        else if (!next.needCar && pl.inVehicle && pl.inVehicle.speed > 2) G.hud.prompt('停车开始任务');
        else this.start(G.save.mission);
      } else if (!pl.dead && this.startMarker.inside(pl.x, pl.z, 0.5) && G.police.level > 0) G.hud.prompt('先甩掉警察再开始任务');
    } else if (this.startMarker && this.active) { this.startMarker.dispose(); this.startMarker = null; }
    // Sal standing at the garage once unlocked
    this.updateSal();
    if (!this.active) return;
    if (this.timerEnd) G.hud.timer(Math.max(0, this.timerEnd - G.time));
    for (const c of this.failChecks.slice()) if (c.fn()) { this.fail(c.reason); return; }
    for (const w of this.waiters.slice()) {
      let ok = false;
      try { ok = w.fn(); } catch (e) { console.error(e); }
      if (ok) { this.waiters.splice(this.waiters.indexOf(w), 1); w.res(); }
    }
    if (this.active.update) this.active.update(dt);
  }

  updateSal() {
    const m = G.world.markers.garage;
    if (!G.save.unlocked.garage && G.save.mission < 1) return;
    const pl = G.player;
    const near = Math.hypot(pl.x - m.x, pl.z - m.z) < 120;
    if (near && (!this.sal || this.sal.removed)) {
      this.sal = G.pedSys.spawn('civ', m.x + 6, m.z - 10, Math.PI, OUTFITS.sal);
      this.sal.state = 'stand'; this.sal.persistent = true; this.sal.mission = { noWanted: false, blip: true, blipCol: '#ffb02e' };
      this.sal.faceTarget = pl.char;
      this.sal.char.hp = this.sal.char.maxHp = 400;
    } else if (!near && this.sal && !this.sal.removed && !this.active) { G.pedSys.remove(this.sal); this.sal = null; }
    if (this.sal && !this.sal.removed && this.sal.char.dead && !this.salDeadNote) { this.salDeadNote = true; G.hud.notify('萨尔被打晕了……他明天会回来的。'); setTimeout(() => { if (this.sal) { G.pedSys.remove(this.sal); this.sal = null; } this.salDeadNote = false; }, 15000); }
  }

  async start(idx) {
    const m = this.list[idx];
    this.active = m;
    this.noPolice = !!m.noPolice;
    G.activities.cancelAll();
    G.hud.big(m.title, 'gold', `任务 ${idx + 1} / ${this.list.length}`, 2.6);
    G.audio.ui('start');
    try {
      await m.run(this);
      this.complete(m);
    } catch (e) {
      if (!(e instanceof Fail)) console.error(e);
    }
  }

  complete(m) {
    this.cleanup(true);
    G.save.mission++;
    G.addMoney(m.reward);
    G.hud.big('任务完成', 'gold', `+${fmtMoney(m.reward)}`, 4);
    G.audio.ui('mission');
    G.player.focus = 1;
    G.persist();
    this.active = null;
    if (m.after) m.after(this);
  }

  fail(reason) {
    if (!this.active) return;
    const ws = this.waiters; this.waiters = [];
    for (const w of ws) w.rej(new Fail(reason));
    G.hud.big('任务失败', 'red', reason, 3.5);
    G.audio.ui('fail');
    this.cleanup(false);
    this.active = null;
  }

  cleanup(success) {
    this.failChecks = [];
    this.gpsTarget = null;
    this.timerEnd = null;
    this.noPolice = false;
    G.hud.timer(null); G.hud.objective('');
    for (const mk of this.spawned.markers) mk.dispose();
    for (const v of this.spawned.vehicles) {
      if (v.removed) continue;
      v.persistent = false; v.blip = null; v.noEnter = false;
      if (v.driver && v.driver !== 'player') { v.traffic = true; if (v.ai) { v.ai.mode = 'cruise'; v.ai.lastEdge = null; } }
      if (!v.driver && !success && v !== G.player.inVehicle) v.traffic = true;
    }
    for (const p of this.spawned.peds) { if (!p.removed) { p.persistent = false; p.mission = null; if (!p.char.dead && p.team === 'gang') p.state = 'attack'; } }
    for (const it of this.spawned.pickups) if (G.pickups.items.includes(it)) G.pickups.remove(it);
    this.spawned = { vehicles: [], peds: [], markers: [], pickups: [] };
    if (this.active && this.active.cleanup) this.active.cleanup();
  }
}

// =====================================================================================
// Campaign: "STREETS OF SOLARA BAY"
// Kai returns to Solara Bay after five years in prison, framed by his former partner
// Vex Marlowe — now boss of the Coral Syndicate. Old mechanic Sal gives him a start.
// =====================================================================================
function buildMissions(M) {
  const W = () => G.world.markers;
  return [
    {
      title: '回到太阳湾', reward: 500, needCar: false,
      where: () => ({ x: G.world.markers.safehouse.x + 9, z: G.world.markers.safehouse.z }),
      async run(M) {
        await M.say('凯', '五年了……太阳湾一点没变。还是这么吵，这么亮。');
        await M.say('萨尔（电话）', '小子！听说你出来了。来我的车行，我有活儿给你。');
        await M.say('萨尔（电话）', '先搞辆车——街上随便挑一辆，别告诉我你忘了怎么"借"车。');
        M.objective('弄一辆车（靠近车辆按 F）');
        await M.waitUntil(() => G.player.inVehicle);
        G.hud.notify('提示：空格键是手刹，可以甩尾漂移');
        const g = W().garage;
        await M.goto(g.x, g.z, { car: true, stop: true, label: '开车去老萨尔的车行', r: 5 });
        G.save.unlocked.garage = true;
        await M.say('萨尔', '哈！还是那张欠揍的脸。车行以后就是你的地盘——修车、喷漆、改装，开进黄圈就行。');
        await M.say('萨尔', '维克斯现在是珊瑚帮的老大了。他当年把你送进去，自己坐上了宝座。');
        await M.say('凯', '我回来，就是为了把这笔账算清楚。');
      },
    },
    {
      title: '急件快递', reward: 1500, needCar: false,
      where: () => W().garage,
      async run(M) {
        const g = W().garageCar;
        const van = M.vehicle('van', g.x, g.z, g.h, 0xf4f4f4);
        van.blip = '#3dff7a';
        await M.say('萨尔', '想重新站稳脚跟，先得有钱。三个客户在等货，限时四分钟。');
        await M.say('萨尔', '开我的厢车去。还有——拿着这个，以防万一。');
        G.player.giveWeapon('pistol', 48);
        G.hud.notify('🔫 获得 手枪（按 Q / 数字键 切换武器）');
        M.objective('上厢车');
        await M.waitUntil(() => G.player.inVehicle === van);
        van.blip = null;
        const stopTimer = M.timer(240);
        M.failIf(() => van.dead, '厢车被毁了');
        const pts = [[4 * P + 45, 2 * P + HALF + 2.5], [8 * P + 45, 6 * P + HALF + 2.5], [6 * P + HALF + 2.5, 10 * P + 45]];
        for (let k = 0; k < pts.length; k++) {
          const lp = nearestLanePoint(pts[k][0], pts[k][1]);
          await M.goto(lp.x, lp.z, { car: van, stop: true, label: `送货 ${k + 1} / 3`, r: 4 });
          G.addMoney(100);
          G.hud.notify(pick(['客户：东西没问题。', '客户：准时，喜欢。', '客户：告诉萨尔，下次还找他。']));
        }
        stopTimer();
        await M.say('萨尔（电话）', '干得漂亮！手艺没丢。回头来找我，我打听到珊瑚帮的一些消息。');
      },
    },
    {
      title: '截胡', reward: 2500, needCar: false,
      where: () => W().garage,
      async run(M) {
        await M.say('萨尔', '珊瑚帮有个信使，每晚开着一辆红色野牛送账本去港口。');
        await M.say('萨尔', '把那辆车撞烂，把公文包抢回来。账本能告诉我们维克斯的钱从哪来。');
        // courier spawns ahead on a road
        const n = nodes[6 * 11 + 3] || nearestNode(3 * P, 6 * P);
        const lp = nearestLanePoint(3 * P + 30, 6 * P);
        const cour = M.vehicle('muscle', lp.x, lp.z, lp.h, 0xc0392b);
        cour.driver = { team: 'gang', outfit: gangOutfit(), weapon: 'pistol' };
        cour.ai = new Driver(cour, { speed: 15 });
        cour.blip = '#ff3355';
        cour.maxHp = cour.hp = 1400;
        M.objective('找到并摧毁信使的红色野牛（小地图红色三角）');
        void n;
        let fleeing = false;
        M.failIf(() => !cour.dead && dist(cour.x, cour.z, G.player.x, G.player.z) > 450 && fleeing, '信使跑掉了');
        await M.waitUntil(() => {
          if (!fleeing && dist(cour.x, cour.z, G.player.x, G.player.z) < 45) {
            fleeing = true; cour.ai.mode = 'flee'; cour.ai.cruise = 26; cour.ai.ignoreLights = true;
            G.hud.subtitle(SAY('信使', '妈的，有人跟着我！'), 2.5);
          }
          return cour.hp <= 0 || cour.dead || (cour.driver === 'player');
        });
        G.hud.notify('信使的车完蛋了，公文包掉了出来！');
        await M.wait(1.2);
        const bc = G.pickups.add('briefcase', cour.x + 3, cour.z + 2, {});
        M.spawned.pickups.push(bc);
        let got = false;
        const off = G.events.on('briefcase', () => (got = true));
        M.gpsTarget = { x: bc.x, z: bc.z };
        M.objective('捡起公文包');
        await M.waitUntil(() => got);
        off();
        const g = W().garage;
        await M.goto(g.x, g.z, { label: '把公文包带回车行', r: 5 });
        await M.say('萨尔', '账本……维克斯在码头有个集装箱仓库，所有货都从那里走。');
        await M.say('凯', '那我们就从码头开始拆他的台。');
      },
    },
    {
      title: '霓虹夜赛', reward: 3000, needCar: false,
      where: () => ({ x: 9 * P + 45, z: 3 * P + HALF + 3 }),
      async run(M) {
        G.hour = 22.3; G.sky.envTimer = 0;
        await M.say('莉娜', '你就是萨尔说的那个人？我叫莉娜，海滨大道的地下赛车是我办的。');
        await M.say('莉娜', '珊瑚帮的车手每周都来抢冠军。赢了他们，我就告诉你维克斯的人在哪。');
        const s = { x: 10 * P + 3, z: 3 * P + 30, h: 0 };
        const car = M.vehicle('coupe', s.x - 5, s.z - 14, s.h, 0x2ef2ff, { nitroMax: 1 });
        car.setGlow(0x2ef2ff);
        car.blip = '#2ef2ff';
        await M.say('莉娜', '这辆旋风 GT 借你，装了氮气（Shift）。别给我撞坏了。', 3);
        M.objective('上车，开到起跑线');
        await M.waitUntil(() => G.player.inVehicle === car);
        car.blip = null;
        await M.goto(s.x, s.z, { car, stop: true, label: '开到起跑线', r: 4, color: 0x2ef2ff });
        car.place(s.x, s.z, s.h);
        const cps = [[10 * P, 6 * P], [10 * P, 9 * P], [9 * P, 10 * P], [7 * P, 10 * P], [7 * P, 7 * P], [5 * P, 7 * P], [5 * P, 4 * P], [7 * P, 2 * P], [9 * P, 2 * P], [10 * P, 4 * P + 40]];
        const racers = [];
        ['super', 'muscle', 'coupe'].forEach((t, i) => {
          const off = [[-4.5, -9], [4.5, -9], [-4.5, -17]][i];
          const r = M.vehicle(t, s.x + off[0] * -1, s.z + off[1], s.h, [0xc0392b, 0x922b21, 0xff6f61][i], { powerMul: 0.95 + i * 0.02, nitroMax: 1 });
          r.setGlow(0xff3355);
          r.driver = { team: 'gang', outfit: gangOutfit() };
          r.ai = new Driver(r, { mode: 'route', route: cps.map(([x, z]) => ({ x, z, radius: 12, speed: 44 })), aggressive: true, ignoreLights: true });
          r.ai.mode = 'parked';
          racers.push(r);
        });
        for (let n = 3; n > 0; n--) { G.hud.big(String(n), 'gold', '', 0.8); G.audio.ui('click'); car.vx = car.vz = 0; await M.wait(1); }
        G.hud.big('GO!', 'blue', '', 0.8); G.audio.ui('start');
        racers.forEach((r) => (r.ai.mode = 'route'));
        M.failIf(() => car.dead, '赛车被毁了');
        M.failIf(() => G.player.inVehicle !== car, '你离开了赛车');
        M.failIf(() => racers.some((r) => r.ai && r.ai.routeIdx >= cps.length), '珊瑚帮车手先冲线了');
        for (let k = 0; k < cps.length; k++) {
          await M.goto(cps[k][0], cps[k][1], { car, r: 10, label: `夜赛 · 检查点 ${k + 1}/${cps.length}`, color: 0x2ef2ff });
        }
        G.save.unlocked.supercar = true;
        await M.say('莉娜', '漂亮！珊瑚帮的人在码头集装箱区集合，今晚就有一批货。');
        await M.say('莉娜', '冠军的奖品——那辆闪电 SX，以后去萨尔那提车吧。');
      },
    },
    {
      title: '码头清场', reward: 4000, needCar: false, noPolice: true,
      where: () => ({ x: P + HALF + 3, z: 3 * P + 45 }),
      async run(M) {
        await M.say('萨尔（电话）', '码头那边全是珊瑚帮的人。我在路边给你留了家伙。');
        const pk = G.pickups.add('smg', P + HALF + 5, 3 * P + 50, { ammo: 150 });
        M.spawned.pickups.push(pk);
        M.objective('拿上冲锋枪');
        await M.waitUntil(() => G.save.weapons.smg);
        const yard = { x: P / 2, z: 4 * P + 45 };
        const L = [];
        for (let k = 0; k < 10; k++) {
          const x = yard.x + rand(-28, 28), z = yard.z + (k % 2 ? -1 : 1) * rand(2, 30);
          const p = M.ped('gang', x, z, rand(0, 6), gangOutfit(), k % 3 === 0 ? 'smg' : k % 4 === 1 ? 'shotgun' : 'pistol');
          p.state = 'stand'; p.hostile = true;
          L.push(p);
        }
        M.objective('清除集装箱区的珊瑚帮成员');
        M.gpsTarget = yard;
        let alerted = false;
        await M.waitUntil(() => {
          const pl = G.player;
          if (!alerted && (dist(pl.x, pl.z, yard.x, yard.z) < 55 || L.some((p) => p.char.hp < p.char.maxHp))) {
            alerted = true; L.forEach((p) => { if (!p.char.dead) p.state = 'attack'; });
            G.hud.subtitle(SAY('珊瑚帮', '有条子……不，是凯！干掉他！'), 3);
            M.gpsTarget = null;
          }
          const left = L.filter((p) => !p.char.dead).length;
          if (alerted) M.objective(`清除珊瑚帮成员 · 剩余 ${left}`);
          return left === 0;
        });
        // reinforcements
        await M.say('凯', '还有车过来了……', 2);
        const lp = nearestLanePoint(P, 6 * P);
        const van = M.vehicle('van', lp.x, lp.z, Math.PI, 0x922b21);
        const rein = [];
        for (let k = 0; k < 3; k++) { const p = M.ped('gang', lp.x + (k - 1) * 2.5, lp.z + 6, Math.PI, gangOutfit(), 'smg'); p.state = 'attack'; rein.push(p); }
        await M.waitUntil(() => { const left = rein.filter((p) => !p.char.dead).length; M.objective(`击退增援 · 剩余 ${left}`); return left === 0; });
        void van;
        await M.say('萨尔（电话）', '码头那批货没了，维克斯肯定气疯了。干得好，小子。');
      },
    },
    {
      title: '热度', reward: 5000, needCar: false,
      where: () => W().garage,
      async run(M) {
        await M.say('萨尔', '维克斯的人在警局里有内线，警车的电脑里存着他们的联络记录。');
        await M.say('萨尔', '去警局后院偷一辆警用拦截车开回来。会很热闹的——甩掉警察之后再回来。');
        const lot = W().policeLot;
        const cop = M.vehicle('police', lot.x, lot.z, Math.PI);
        cop.blip = '#2e7dff';
        M.objective('从警局后院偷一辆警车');
        await M.waitUntil(() => G.player.inVehicle === cop);
        cop.blip = null;
        G.police.setLevel(3);
        G.hud.subtitle(SAY('警方广播', '所有单位注意，一辆警用拦截车被盗！'), 3);
        M.failIf(() => cop.dead, '警车被毁了');
        M.objective('甩掉警察（★ 消失）');
        await M.waitUntil(() => G.police.level === 0 && G.player.inVehicle === cop);
        const g = W().garage;
        await M.goto(g.x, g.z, { car: cop, stop: true, label: '把警车开回车行', r: 5 });
        G.save.unlocked.nitro = true;
        await M.say('萨尔', '找到了！维克斯下周要把一笔现金从港口运到珊瑚岛。');
        await M.say('萨尔', '作为奖励，以后车行给你装氮气免费。另外枪店有火箭筒卖了。');
      },
    },
    {
      title: '押运', reward: 6000, needCar: false, noPolice: true,
      where: () => W().garage,
      async run(M) {
        await M.say('萨尔', '我们截了维克斯的运钞车。我来开，你在后面保护。');
        await M.say('萨尔', '珊瑚帮一定会来抢，别让他们碰到这辆车！');
        const g = W().garageCar;
        const own = M.vehicle('muscle', g.x + 8, g.z, g.h, 0x111111, { nitroMax: 1 });
        own.setGlow(0xffb02e);
        const lp = nearestLanePoint(1 * P + 45, 6 * P);
        const truck = M.vehicle('armored', lp.x, lp.z, lp.h);
        truck.driver = { team: 'civ', outfit: OUTFITS.sal };
        truck.noEnter = true;
        truck.blip = '#3dff7a';
        truck.maxHp = truck.hp = 6000;
        M.objective('上车，跟着运钞车');
        await M.waitUntil(() => G.player.inVehicle);
        const dest = { x: 10 * P - LANE_OFF[0], z: 5 * P - 30 };
        const route = [[1 * P, 6 * P], [1 * P, 7 * P], [4 * P, 7 * P], [4 * P, 5 * P], [7 * P, 5 * P], [9 * P, 5 * P], [10 * P - 3, 5 * P]].map(([x, z]) => ({ x, z, radius: 10, speed: 13 }));
        truck.ai = new Driver(truck, { mode: 'route', route, ignoreLights: true });
        let arrived = false;
        truck.ai.onArrive = () => (arrived = true);
        M.failIf(() => truck.dead || truck.hp <= 0, '运钞车被毁了');
        M.failIf(() => dist(truck.x, truck.z, G.player.x, G.player.z) > 220, '你离运钞车太远了');
        const attackers = [];
        const wave = (n) => {
          for (let k = 0; k < n; k++) {
            const a = Math.random() * Math.PI * 2;
            const l2 = nearestLanePoint(truck.x + Math.cos(a) * 140, truck.z + Math.sin(a) * 140);
            const c = M.vehicle('muscle', l2.x, l2.z, l2.h, 0xc0392b);
            c.driver = { team: 'gang', outfit: gangOutfit(), weapon: 'smg' };
            c.ai = new Driver(c, { mode: 'ram', target: truck, aggressive: true });
            c.blip = '#ff3355';
            c.shootCd = 2;
            attackers.push(c);
          }
        };
        this.update = (dt) => {
          for (const c of attackers) {
            if (c.dead || !c.driver || c.driver === 'player') { c.blip = null; continue; }
            c.shootCd -= dt;
            const tgt = dist(c.x, c.z, G.player.x, G.player.z) < dist(c.x, c.z, truck.x, truck.z) ? G.player : truck;
            const d = dist(c.x, c.z, tgt.x, tgt.z);
            if (c.shootCd <= 0 && d < 30) {
              c.shootCd = rand(0.15, 0.3);
              if (Math.random() < 0.08) c.shootCd = 2;
              let dx = tgt.x - c.x + rand(-2, 2), dy = 0.2, dz = tgt.z - c.z + rand(-2, 2); const L = Math.hypot(dx, dy, dz); dx /= L; dy /= L; dz /= L;
              G.combat.fire({ dmgMul: 0.4, spreadMul: 2, inVehicle: c }, 'smg', c.x, c.y + 1.4, c.z, dx, dy, dz);
            }
          }
        };
        await M.wait(6);
        G.hud.subtitle(SAY('萨尔', '后面有尾巴！红色的车，干掉他们！'), 3);
        wave(2);
        M.objective('保护运钞车 · 摧毁珊瑚帮车辆');
        await M.waitUntil(() => attackers.every((c) => c.dead || !c.driver) || arrived);
        await M.wait(4);
        if (!arrived) { G.hud.subtitle(SAY('萨尔', '又来了一波！'), 3); wave(3); }
        await M.waitUntil(() => arrived && attackers.every((c) => c.dead || !c.driver || dist(c.x, c.z, truck.x, truck.z) > 120));
        this.update = null;
        await M.say('萨尔', '安全了！这些钱够我们收买岛上一半的保镖。');
        await M.say('萨尔', '这是我年轻时的老伙计，一把步枪。明天，我们去珊瑚岛。');
        G.player.giveWeapon('rifle', 120);
      },
      cleanup() { this.update = null; },
    },
    {
      title: '珊瑚王座', reward: 20000, needCar: true, noPolice: true,
      where: () => ({ x: CAUSEWAY.x0 - 20, z: CZ + LANE_OFF[0] }),
      async run(M) {
        G.hour = Math.max(G.hour, 19.2) % 24; G.sky.envTimer = 0;
        await M.say('萨尔（电话）', '维克斯就在珊瑚岛的别墅里，跨海大桥是唯一的路。');
        await M.say('凯', '五年的账，今晚一次算清。');
        const end = W().islandEnd;
        await M.goto(end.x - 40, end.z, { car: true, label: '穿过跨海大桥，冲进珊瑚岛', r: 8 });
        const man = W().mansion;
        const guards = [];
        for (let k = 0; k < 12; k++) {
          const x = man.x + rand(-10, 45), z = man.z + rand(-50, 50);
          const p = M.ped('gang', x, z, Math.PI / 2, { ...gangOutfit(), shirt: 0x222222, hat: null, glasses: true }, pick(['rifle', 'smg', 'shotgun', 'pistol']));
          p.state = 'attack'; p.char.hp = p.char.maxHp = 140; p.accuracy = 0.07;
          guards.push(p);
        }
        G.hud.subtitle(SAY('维克斯（广播）', '凯？哈哈哈……你真以为能活着走进来？'), 3.5);
        await M.waitUntil(() => { const l = guards.filter((p) => !p.char.dead).length; M.objective(`消灭别墅保镖 · 剩余 ${l}`); return l <= 2; });
        // Vex escapes
        const vex = M.vehicle('super', man.x + 10, man.z + 30, -Math.PI / 2, 0xf4f4f4, { nitroMax: 1, armorMul: 2.5 });
        vex.setGlow(0xffd166);
        vex.driver = { team: 'gang', outfit: OUTFITS.boss, weapon: 'smg' };
        vex.ai = new Driver(vex, { mode: 'flee', speed: 28, ignoreLights: true });
        vex.ai.cruise = 30;
        vex.blip = '#ffd166';
        await M.say('维克斯', '想要我的命？先追上我！', 2.5);
        M.objective('追上并摧毁维克斯的白色闪电 SX');
        M.failIf(() => !vex.dead && dist(vex.x, vex.z, G.player.x, G.player.z) > 500, '维克斯逃掉了');
        await M.waitUntil(() => vex.dead || vex.hp <= 0 || vex.driver === 'player');
        await M.wait(2.5);
        G.hud.big('维克斯 · 终', 'gold', '珊瑚帮覆灭', 4);
        await M.wait(3);
        await M.say('萨尔（电话）', '……结束了？哈！太阳湾从今晚起是你的了，凯。');
        await M.say('凯', '不，是我们的。去喝一杯吧，老头。', 3);
      },
      after() {
        G.hud.big('霓虹港湾', 'gold', '剧情通关 · 自由探索继续 · 去收集徽章和特技跳台吧', 6);
      },
    },
  ];
}

export { Fail };
void ISLAND; void ISLAND_END_X; void BEACH; void groundHeight;
