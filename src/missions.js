// Story campaign: "Gangstar: Miami Vindication" — Johnny searches for his kidnapped brother Joey.
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
    this.betty = null;
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
    this.updateBetty();
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

  updateBetty() {
    const m = G.world.markers.garage;
    if (!G.save.unlocked.garage && G.save.mission < 1) return;
    const pl = G.player;
    const near = Math.hypot(pl.x - m.x, pl.z - m.z) < 120;
    if (near && (!this.betty || this.betty.removed)) {
      this.betty = G.pedSys.spawn('civ', m.x + 6, m.z - 10, Math.PI, OUTFITS.betty);
      this.betty.state = 'stand'; this.betty.persistent = true; this.betty.mission = { noWanted: false, blip: true, blipCol: '#ffb02e' };
      this.betty.faceTarget = pl.char;
      this.betty.char.hp = this.betty.char.maxHp = 400;
    } else if (!near && this.betty && !this.betty.removed && !this.active) { G.pedSys.remove(this.betty); this.betty = null; }
    if (this.betty && !this.betty.removed && this.betty.char.dead && !this.bettyDeadNote) { this.bettyDeadNote = true; G.hud.notify('贝蒂被打晕了……她明天会回来的。'); setTimeout(() => { if (this.betty) { G.pedSys.remove(this.betty); this.betty = null; } this.bettyDeadNote = false; }, 15000); }
  }

  async start(idx) {
    const m = this.list[idx];
    this.active = m;
    this.noPolice = !!m.noPolice;
    G.activities.cancelAll();
    const ch = m.chapter ? `第${m.chapter}章 · ` : '';
    G.hud.big(m.title, 'gold', `${ch}任务 ${idx + 1} / ${this.list.length}`, 2.6);
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
// Campaign: "GANGSTAR: MIAMI VINDICATION"
// Johnny arrives in Miami to find his kidnapped brother Joey. He meets Betty, a contact
// for old Roscoe in the Swamp. Through 5 chapters of escalating violence, Johnny works
// with Herman, Albert, Amelia, Reginald, and LC to uncover a conspiracy that leads from
// street thugs all the way to the puppet-master Clive Klick.
// =====================================================================================
function buildMissions(M) {
  const W = () => G.world.markers;
  return [
    // ===== CHAPTER 1: 城里新来的小子 (New Kid in Town) =====
    {
      title: '前路漫漫', chapter: 1, reward: 500, needCar: false,
      where: () => ({ x: G.world.markers.safehouse.x + 9, z: G.world.markers.safehouse.z }),
      async run(M) {
        await M.say('强尼', '老弟啊老弟，我到底该拿你怎么办？读书被学校开除，当小混混被关起来，现在又陷在迈阿密了。');
        await M.say('强尼', '就算中间隔着个银河系，我也要把你给带回去。');
        await M.say('强尼', '不过看来在这之前，我得先搞辆车。');
        M.objective('弄一辆车（靠近车辆按 F）');
        await M.waitUntil(() => G.player.inVehicle);
        G.hud.notify('提示：WASD 移动 · 空格手刹漂移 · Shift 氮气加速');
        await M.say('强尼', '迈阿密闹市区……我得先找到贝蒂，她是罗斯科的人。');
        const g = W().garage;
        await M.goto(g.x, g.z, { car: true, stop: true, label: '开车去见贝蒂', r: 5 });
        G.save.unlocked.garage = true;
        await M.say('贝蒂', '你就是从潘汉德尔来的那个找弟弟的家伙吗？');
        await M.say('强尼', '那么你就是罗斯科的联络人了？');
        await M.say('贝蒂', '没这么简单。罗斯科老了，脾气暴躁。你最好带份礼物去见他，一大包嚼烟就行。');
        await M.say('强尼', '嚼烟？那些味道像泥巴一样的东西？');
        await M.say('贝蒂', '相信我。那样事情会好办些。这里以后就是你的据点——修车、喷漆、改装，开进黄圈就行。');
      },
    },
    {
      title: '弟弟和我', chapter: 1, reward: 1000, needCar: false,
      where: () => W().garage,
      async run(M) {
        await M.say('贝蒂', '先去买些嚼烟，然后我带你去沼泽区见罗斯科。');
        const gun = W().gunshop;
        await M.goto(gun.x, gun.z, { label: '去嚼烟店', r: 5 });
        await M.say('混混', '喂，牛仔，你是来参加骑牛比赛的吗？');
        await M.say('强尼', '只是来买点嚼烟而已。这没你什么事吧？');
        await M.say('混混', '要不要试试从我这里拿点去？');
        const thug = M.ped('gang', gun.x + 4, gun.z + 2, Math.PI, gangOutfit(), 'bat');
        thug.state = 'attack'; thug.char.hp = 60;
        M.objective('打倒这个蠢货，拿走嚼烟');
        await M.waitUntil(() => thug.char.dead);
        G.hud.notify('拿到了嚼烟');
        G.player.giveWeapon('pistol', 36);
        G.hud.notify('🔫 获得 手枪（按 Q / 数字键 切换武器）');
        const lp = nearestLanePoint(2 * P, 10 * P);
        await M.goto(lp.x, lp.z, { car: true, stop: true, label: '开车去沼泽区见罗斯科', r: 6 });
        await M.say('罗斯科', '你要找你的弟弟？');
        await M.say('强尼', '是。对了，小小礼物，不成敬意。');
        await M.say('罗斯科', '啊，多谢多谢，年轻人。你怎么知道我喜欢这个的？');
        await M.say('强尼', '像您这样的人，有哪个不喜欢这东西？');
        await M.say('罗斯科', '这么说你需要帮助。好，我帮你，不过你也得帮我。');
      },
    },
    {
      title: '正面交锋', chapter: 1, reward: 1500, needCar: false, noPolice: true,
      where: () => ({ x: 2 * P, z: 10 * P }),
      async run(M) {
        await M.say('罗斯科', '我的手下汉克去跟鳄鱼练手，已经好一会儿了。你去看看吧？');
        await M.say('罗斯科', '带上这把枪，以防万一。');
        await M.say('强尼', '您多虑了，我的枪会好好招待它们的。');
        await M.say('罗斯科', '从现在开始到把你弟弟找回来，要用枪的时候还多着呢。');
        const yard = { x: 1 * P, z: 11 * P };
        const goons = [];
        for (let k = 0; k < 6; k++) {
          const x = yard.x + rand(-20, 20), z = yard.z + rand(-15, 15);
          const p = M.ped('gang', x, z, rand(0, 6), gangOutfit(), k < 2 ? 'bat' : 'pistol');
          p.state = 'stand'; p.hostile = true; p.char.hp = 50;
          goons.push(p);
        }
        const hank = M.ped('civ', yard.x + 5, yard.z, 0, OUTFITS.betty);
        hank.state = 'stand'; hank.char.hp = hank.char.maxHp = 300;
        M.objective('救出汉克——干掉那些家伙');
        M.gpsTarget = yard;
        let alerted = false;
        await M.waitUntil(() => {
          if (!alerted && dist(G.player.x, G.player.z, yard.x, yard.z) < 40) {
            alerted = true; goons.forEach(p => { if (!p.char.dead) p.state = 'attack'; });
          }
          const left = goons.filter(p => !p.char.dead).length;
          if (alerted) M.objective(`干掉这些家伙 · 剩余 ${left}`);
          return left === 0;
        });
        M.gpsTarget = null;
        await M.say('汉克', '我的枪被其中一个家伙吞了！谢天谢地你来了！');
        await M.say('强尼', '回去告诉罗斯科，他欠我一个人情。');
      },
    },
    {
      title: '劫持灵车', chapter: 1, reward: 2000, needCar: false,
      where: () => ({ x: 2 * P, z: 10 * P }),
      async run(M) {
        await M.say('罗斯科', '知道我的弟弟可能在谁手上吗？');
        await M.say('罗斯科', '迈阿密的坏家伙遍地都是。我建议你都去招惹一下，到时候自然就会得到信息。');
        await M.say('罗斯科', '先去搞辆灵车回来。城北有个帮派的葬礼，他们的灵车里有我需要的东西。');
        const lp = nearestLanePoint(7 * P + 30, 2 * P);
        const hearse = M.vehicle('van', lp.x, lp.z, lp.h, 0x111111);
        hearse.blip = '#ff3355';
        hearse.maxHp = hearse.hp = 2000;
        const guards = [];
        for (let k = 0; k < 4; k++) {
          const p = M.ped('gang', lp.x + rand(-8, 8), lp.z + rand(-8, 8), rand(0, 6), gangOutfit(), 'pistol');
          p.state = 'stand'; p.hostile = true;
          guards.push(p);
        }
        M.objective('去城北，劫持灵车（小地图红色三角）');
        await M.waitUntil(() => G.player.inVehicle === hearse);
        hearse.blip = null;
        guards.forEach(p => { if (!p.char.dead) p.state = 'attack'; });
        G.police.setLevel(2);
        M.failIf(() => hearse.dead, '灵车被毁了');
        M.objective('甩掉追兵，把灵车开回沼泽区');
        const dest = { x: 2 * P, z: 10 * P };
        await M.goto(dest.x, dest.z, { car: hearse, stop: true, label: '把灵车开回罗斯科处', r: 6 });
        await M.say('罗斯科', '好样的，年轻人。这里面的信息够让我们查清你弟弟的下落了。');
        await M.say('罗斯科', '我打听到，一个叫维克多·维加的人跟这事有关。他在海滩区有家大酒店。');
      },
    },

    // ===== CHAPTER 2: 新线索 (New Leads) =====
    {
      title: '渗入调查', chapter: 2, reward: 2500, needCar: false,
      where: () => W().garage,
      async run(M) {
        await M.say('贝蒂', '赫尔曼·凯是维加手下的一个情报商，他可能知道你弟弟的位置。');
        await M.say('贝蒂', '他在中城那栋楼里做生意。去找他，别太粗暴——他是个生意人。');
        const bld = { x: 5 * P + 45, z: 5 * P };
        await M.goto(bld.x, bld.z, { label: '去中城找赫尔曼·凯', r: 5 });
        await M.say('赫尔曼', '维加那家伙真浪费了我不少时间……');
        await M.say('强尼', '我在找我弟弟。有人说维加跟这事有关。');
        await M.say('赫尔曼', '维加？他用海滩上那间大酒店来洗贩毒和走私豪车来的黑钱。');
        await M.say('赫尔曼', '我有些关于维加手下的情报在港口仓库里。帮我去取出来，我就告诉你更多。');
        G.player.giveWeapon('smg', 90);
        G.hud.notify('🔫 获得 冲锋枪');
        const yard = { x: P / 2, z: 4 * P + 45 };
        const enemies = [];
        for (let k = 0; k < 8; k++) {
          const x = yard.x + rand(-25, 25), z = yard.z + rand(-20, 20);
          const p = M.ped('gang', x, z, rand(0, 6), gangOutfit(), k % 3 === 0 ? 'smg' : 'pistol');
          p.state = 'stand'; p.hostile = true;
          enemies.push(p);
        }
        M.objective('去港口仓库取回情报');
        M.gpsTarget = yard;
        let alerted = false;
        await M.waitUntil(() => {
          if (!alerted && dist(G.player.x, G.player.z, yard.x, yard.z) < 45) {
            alerted = true; enemies.forEach(p => { if (!p.char.dead) p.state = 'attack'; });
            G.hud.subtitle(SAY('帮派成员', '有人闯进来了！干掉他！'), 2.5);
            M.gpsTarget = null;
          }
          const left = enemies.filter(p => !p.char.dead).length;
          if (alerted) M.objective(`清除仓库守卫 · 剩余 ${left}`);
          return left === 0;
        });
        G.hud.notify('找到了情报文件');
        await M.goto(bld.x, bld.z, { label: '把情报带回赫尔曼处', r: 5 });
        await M.say('赫尔曼', '好。维加有个信使，每晚从港口运送账本。截住他，就能找到维加的老巢。');
      },
    },
    {
      title: '获得答案', chapter: 2, reward: 3000, needCar: false,
      where: () => ({ x: 5 * P + 45, z: 5 * P }),
      async run(M) {
        await M.say('赫尔曼', '维加的信使开着一辆红色肌肉车，他每晚从码头出发。');
        await M.say('赫尔曼', '追上他，把他拦下来。温柔点——我们需要他活着说话。');
        G.hour = 21; G.sky.envTimer = 0;
        const lp = nearestLanePoint(3 * P + 30, 6 * P);
        const courier = M.vehicle('muscle', lp.x, lp.z, lp.h, 0xc0392b);
        courier.driver = { team: 'gang', outfit: gangOutfit(), weapon: 'pistol' };
        courier.ai = new Driver(courier, { speed: 15 });
        courier.blip = '#ff3355';
        courier.maxHp = courier.hp = 1400;
        M.objective('找到并追上信使的红色肌肉车');
        let fleeing = false;
        M.failIf(() => !courier.dead && dist(courier.x, courier.z, G.player.x, G.player.z) > 450 && fleeing, '信使跑掉了');
        await M.waitUntil(() => {
          if (!fleeing && dist(courier.x, courier.z, G.player.x, G.player.z) < 45) {
            fleeing = true; courier.ai.mode = 'flee'; courier.ai.cruise = 26; courier.ai.ignoreLights = true;
            G.hud.subtitle(SAY('信使', '妈的，有人跟着我！'), 2.5);
          }
          return courier.hp <= 0 || courier.dead || (courier.driver === 'player');
        });
        G.hud.notify('信使的车报废了！公文包掉了出来！');
        await M.wait(1.2);
        const bc = G.pickups.add('briefcase', courier.x + 3, courier.z + 2, {});
        M.spawned.pickups.push(bc);
        let got = false;
        const off = G.events.on('briefcase', () => (got = true));
        M.gpsTarget = { x: bc.x, z: bc.z };
        M.objective('捡起公文包');
        await M.waitUntil(() => got);
        off();
        await M.goto(5 * P + 45, 5 * P, { label: '把公文包带回赫尔曼处', r: 5 });
        await M.say('赫尔曼', '账本上全是维加的交易记录。他在海滩区有个秘密据点。');
        await M.say('强尼', '那我的弟弟呢？');
        await M.say('赫尔曼', '耐心点。先除掉维加的据点，答案就在里面。');
      },
    },
    {
      title: '高速路出口', chapter: 2, reward: 3500, needCar: false,
      where: () => W().garage,
      async run(M) {
        await M.say('贝蒂', '维加的人在警局里有内线。那个警察探长知道你弟弟的下落。');
        await M.say('贝蒂', '去找到他，让他开口。');
        const policeLot = W().policeLot || { x: 7 * P + 45, z: 3 * P + 45 };
        const cop = M.vehicle('police', policeLot.x, policeLot.z, Math.PI);
        cop.blip = '#2e7dff';
        M.objective('从警局偷一辆警车');
        await M.waitUntil(() => G.player.inVehicle === cop);
        cop.blip = null;
        G.police.setLevel(3);
        G.hud.subtitle(SAY('警方广播', '所有单位注意，一辆警车被盗！'), 3);
        M.failIf(() => cop.dead, '警车被毁了');
        M.objective('甩掉警察（★ 消失）');
        await M.waitUntil(() => G.police.level === 0 && G.player.inVehicle === cop);
        const g = W().garage;
        await M.goto(g.x, g.z, { car: cop, stop: true, label: '把警车开回据点', r: 5 });
        await M.say('贝蒂', '电脑里的信息……维加下周要把一笔现金从港口运到珊瑚岛。');
        await M.say('贝蒂', '我们截住那批钱，就能引他出来。');
        G.save.unlocked.nitro = true;
        await M.say('贝蒂', '以后车行给你装氮气免费。另外枪店有更多武器卖了。');
      },
    },

    // ===== CHAPTER 3: 讨债 (Collecting Debts) =====
    {
      title: '来自洛杉矶', chapter: 3, reward: 4000, needCar: false,
      where: () => W().garage,
      async run(M) {
        await M.say('强尼', '我在圣莫尼卡有个朋友，叫LC。他以前在伊拉克当过兵。');
        await M.say('贝蒂', '现在是需要帮手的时候了。');
        await M.say('强尼', 'LC说他到了迈阿密，让我去酒店接他。');
        const hotel = { x: 8 * P + 45, z: 8 * P };
        await M.goto(hotel.x, hotel.z, { car: true, stop: true, label: '去酒店接LC', r: 5 });
        await M.say('LC', '好久不见，兄弟！迈阿密比洛杉矶还热闹。');
        await M.say('强尼', '我与那个世界的老大关系匪浅。现在我弟弟被绑了，需要你帮忙。');
        await M.say('LC', '你帮过我一命，这次轮到我了。先给我搞辆车。');
        M.objective('弄一辆车给LC');
        await M.waitUntil(() => G.player.inVehicle);
        const chase = { x: 6 * P, z: 7 * P };
        await M.say('LC', '先去认识下地盘。我听说维加手下有个叫阿尔伯特的人在南边做生意。');
        await M.goto(chase.x, chase.z, { car: true, stop: true, label: '去南边找阿尔伯特', r: 5 });
        await M.say('阿尔伯特', '你们是强尼？罗斯科提到过你。我能帮你找到维加，但你得先帮我干掉竞争对手。');
        const enemies = [];
        for (let k = 0; k < 6; k++) {
          const p = M.ped('gang', chase.x + rand(-20, 20), chase.z + rand(-15, 15), rand(0, 6), gangOutfit(), pick(['smg', 'pistol', 'shotgun']));
          p.state = 'attack'; p.char.hp = 80;
          enemies.push(p);
        }
        M.objective('帮阿尔伯特消灭竞争对手');
        await M.waitUntil(() => { const l = enemies.filter(p => !p.char.dead).length; M.objective(`消灭对手 · 剩余 ${l}`); return l === 0; });
        await M.say('阿尔伯特', '好样的。维加的手下在市场边上有个藏武器的地方。你可能用得上。');
        G.player.giveWeapon('shotgun', 30);
        G.hud.notify('🔫 获得 霰弹枪');
      },
    },
    {
      title: '找到武器', chapter: 3, reward: 5000, needCar: false, noPolice: true,
      where: () => ({ x: 6 * P, z: 7 * P }),
      async run(M) {
        await M.say('阿尔伯特', '政府在迈阿密藏了一批秘密武器。如果我们能搞到，对付维加就容易多了。');
        await M.say('LC', '拿出你在巴格达那时的气势来，兄弟。');
        const depot = { x: 9 * P + 20, z: 1 * P + 20 };
        const guards = [];
        for (let k = 0; k < 10; k++) {
          const p = M.ped('gang', depot.x + rand(-25, 25), depot.z + rand(-20, 20), rand(0, 6), { ...gangOutfit(), shirt: 0x2a4a2a }, pick(['rifle', 'smg', 'shotgun']));
          p.state = 'stand'; p.hostile = true; p.char.hp = 100;
          guards.push(p);
        }
        M.objective('突袭武器仓库');
        M.gpsTarget = depot;
        let alerted = false;
        await M.waitUntil(() => {
          if (!alerted && dist(G.player.x, G.player.z, depot.x, depot.z) < 50) {
            alerted = true; guards.forEach(p => { if (!p.char.dead) p.state = 'attack'; });
            G.hud.subtitle(SAY('守卫', '有人闯入！保护武器！'), 2.5);
            M.gpsTarget = null;
          }
          const left = guards.filter(p => !p.char.dead).length;
          if (alerted) M.objective(`清除守卫 · 剩余 ${left}`);
          return left === 0;
        });
        G.player.giveWeapon('rifle', 120);
        G.player.giveWeapon('rocket', 8);
        G.hud.notify('🎯 获得 突击步枪 + 火箭筒');
        await M.say('LC', '哈！这些装备够我们打一场小型战争了。');
        await M.say('强尼', '那就准备开战吧。维加的末日到了。');
      },
    },
    {
      title: '夜赛', chapter: 3, reward: 6000, needCar: false,
      where: () => ({ x: 9 * P + 45, z: 3 * P + HALF + 3 }),
      async run(M) {
        G.hour = 22.3; G.sky.envTimer = 0;
        await M.say('阿梅利亚', '强尼？阿尔伯特说你需要帮忙。我叫阿梅利亚，海滨大道地下赛车我办的。');
        await M.say('阿梅利亚', '维加的车手每周都来抢冠军。赢了他们，我就告诉你维加的藏身处。');
        const s = { x: 10 * P + 3, z: 3 * P + 30, h: 0 };
        const car = M.vehicle('coupe', s.x - 5, s.z - 14, s.h, 0x2ef2ff, { nitroMax: 1 });
        car.setGlow(0x2ef2ff);
        car.blip = '#2ef2ff';
        await M.say('阿梅利亚', '借你这辆车，装了氮气（Shift）。别给我撞坏了。', 3);
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
        racers.forEach(r => (r.ai.mode = 'route'));
        M.failIf(() => car.dead, '赛车被毁了');
        M.failIf(() => G.player.inVehicle !== car, '你离开了赛车');
        M.failIf(() => racers.some(r => r.ai && r.ai.routeIdx >= cps.length), '维加的车手先冲线了');
        for (let k = 0; k < cps.length; k++) {
          await M.goto(cps[k][0], cps[k][1], { car, r: 10, label: `夜赛 · 检查点 ${k + 1}/${cps.length}`, color: 0x2ef2ff });
        }
        G.save.unlocked.supercar = true;
        await M.say('阿梅利亚', '漂亮！维加在珊瑚岛上有座别墅，所有脏活都在那里安排。');
        await M.say('阿梅利亚', '冠军奖品——那辆闪电超跑，以后去车行提车吧。');
      },
    },

    // ===== CHAPTER 4: 阿马达陷入困境 (Armada in Trouble) =====
    {
      title: '赶去贝蒂家', chapter: 4, reward: 7000, needCar: false,
      where: () => W().garage,
      async run(M) {
        await M.say('强尼（电话）', '贝蒂！？');
        await M.say('神秘人（电话）', '仔细听着。阿马达留有口讯给你。你最好乘首架航班离开迈阿密。如果你还想见到你的女人的话。');
        await M.say('强尼', '他们抓了贝蒂！');
        const stopTimer = M.timer(120);
        const bettyHome = { x: 3 * P + 45, z: 8 * P + 45 };
        M.failIf(() => false, '');
        await M.goto(bettyHome.x, bettyHome.z, { car: true, label: '赶去贝蒂家！限时两分钟！', r: 5 });
        stopTimer();
        await M.say('贝蒂', '强尼！一大帮暴徒冲进我的公寓，他们在墙上写了关于阿马达的东西……');
        await M.say('强尼', '你安全就好。我不知道他们是谁，但他们给我打了电话。我以为他们把你抓走了。');
        await M.say('贝蒂', '我很抱歉我离开了，强尼。');
        await M.say('强尼', '这一切很快就会结束了。然后我们就去过你向往的那种生活。');
        const lp = nearestLanePoint(3 * P, 9 * P);
        const attackers = [];
        for (let k = 0; k < 6; k++) {
          const p = M.ped('gang', lp.x + rand(-15, 15), lp.z + rand(-15, 15), rand(0, 6), gangOutfit(), pick(['smg', 'pistol']));
          p.state = 'attack'; p.char.hp = 80;
          attackers.push(p);
        }
        G.hud.subtitle(SAY('贝蒂', '他们追来了！'), 2);
        M.objective('保护贝蒂——消灭袭击者');
        await M.waitUntil(() => { const l = attackers.filter(p => !p.char.dead).length; M.objective(`消灭袭击者 · 剩余 ${l}`); return l === 0; });
        await M.say('LC', '贝蒂，跟我走。强尼，你去查清这些人的来历。');
      },
    },
    {
      title: '保护别墅', chapter: 4, reward: 8000, needCar: false, noPolice: true,
      where: () => ({ x: 3 * P + 45, z: 8 * P + 45 }),
      async run(M) {
        await M.say('LC', '别墅周围的情况不妙。有人在监视我们。');
        await M.say('强尼', '那就让他们来吧。');
        const villa = { x: 3 * P + 45, z: 8 * P + 45 };
        M.gpsTarget = villa;
        const waves = [
          { count: 5, delay: 3, msg: '第一波来了！' },
          { count: 7, delay: 8, msg: '又来了一波！' },
          { count: 4, delay: 5, msg: '最后一波！带上头儿了！', elite: true },
        ];
        for (let w = 0; w < waves.length; w++) {
          const wave = waves[w];
          await M.wait(wave.delay);
          G.hud.subtitle(SAY('LC', wave.msg), 2.5);
          const enemies = [];
          for (let k = 0; k < wave.count; k++) {
            const a = Math.random() * Math.PI * 2;
            const r = 35 + rand(0, 15);
            const p = M.ped('gang', villa.x + Math.cos(a) * r, villa.z + Math.sin(a) * r, a + Math.PI, gangOutfit(), pick(['smg', 'rifle', 'shotgun', 'pistol']));
            p.state = 'attack';
            if (wave.elite) { p.char.hp = p.char.maxHp = 150; p.accuracy = 0.08; }
            enemies.push(p);
          }
          M.objective(`保护别墅 · 第 ${w + 1} 波 · 剩余 ${enemies.length}`);
          await M.waitUntil(() => { const l = enemies.filter(p => !p.char.dead).length; M.objective(`保护别墅 · 第 ${w + 1} 波 · 剩余 ${l}`); return l === 0; });
        }
        M.gpsTarget = null;
        await M.say('强尼', '结束了……暂时的。');
        await M.say('LC', '那些暴徒……他们反复提起一个名字：琼斯。');
        await M.say('强尼', '莫尼克·琼斯。我知道是怎么回事了。');
      },
    },
    {
      title: '跟踪暴徒', chapter: 4, reward: 10000, needCar: false,
      where: () => ({ x: 3 * P + 45, z: 8 * P + 45 }),
      async run(M) {
        await M.say('LC', '别墅被袭之后，我一直在这儿守着，看会不会有人再来。');
        await M.say('LC', '看来好像有情况了。一辆红色摩托车上的家伙刚钻进辆停着的汽车。');
        await M.say('强尼', '赶紧跟上，看看他们去哪儿。');
        const lp = nearestLanePoint(4 * P, 7 * P);
        const target = M.vehicle('sedan', lp.x, lp.z, lp.h, 0x922b21);
        target.driver = { team: 'gang', outfit: gangOutfit() };
        target.ai = new Driver(target, { speed: 12 });
        target.blip = '#ff3355';
        const route = [[5 * P, 7 * P], [6 * P, 6 * P], [7 * P, 5 * P], [8 * P, 4 * P], [9 * P, 3 * P]].map(([x, z]) => ({ x, z, radius: 8, speed: 14 }));
        target.ai = new Driver(target, { mode: 'route', route, ignoreLights: false });
        M.failIf(() => dist(target.x, target.z, G.player.x, G.player.z) > 120, '你跟丢了目标');
        M.failIf(() => dist(target.x, target.z, G.player.x, G.player.z) < 12 && G.player.inVehicle, '太近了，你被发现了！');
        M.objective('跟踪这辆车——保持距离，不要被发现');
        let arrived = false;
        target.ai.onArrive = () => (arrived = true);
        await M.waitUntil(() => arrived);
        target.blip = null;
        await M.say('强尼', '他们在比斯坎湾有块地方，看上去像个小型军营。');
        await M.say('LC', '我躲起来偷听了一下，他们反复提起一个名字：琼斯。');
        const hideout = { x: 9 * P + 20, z: 3 * P + 20 };
        const enemies = [];
        for (let k = 0; k < 8; k++) {
          const p = M.ped('gang', hideout.x + rand(-20, 20), hideout.z + rand(-15, 15), rand(0, 6), gangOutfit(), pick(['rifle', 'smg', 'shotgun']));
          p.state = 'stand'; p.hostile = true; p.char.hp = 100;
          enemies.push(p);
        }
        M.objective('剿灭琼斯老巢');
        M.gpsTarget = hideout;
        let alert2 = false;
        await M.waitUntil(() => {
          if (!alert2 && dist(G.player.x, G.player.z, hideout.x, hideout.z) < 40) {
            alert2 = true; enemies.forEach(p => { if (!p.char.dead) p.state = 'attack'; });
            M.gpsTarget = null;
          }
          const l = enemies.filter(p => !p.char.dead).length;
          if (alert2) M.objective(`剿灭琼斯老巢 · 剩余 ${l}`);
          return l === 0;
        });
        await M.say('强尼', '琼斯的人全完了。但她本人不在这里。');
        await M.say('LC', '我在这里找到了地址——维加的秘密仓库。你弟弟可能就在那里。');
      },
    },
    {
      title: '救出乔伊', chapter: 4, reward: 12000, needCar: false, noPolice: true,
      where: () => W().garage,
      async run(M) {
        await M.say('强尼', '没事了，我在这儿呢。我终于找到你了。别哭，孩子。');
        await M.say('强尼', '先去维加的仓库，乔伊一定在那里。');
        await M.say('LC', '我跟你一起去。带上所有的家伙。');
        const warehouse = { x: 1 * P, z: 2 * P };
        const guards = [];
        for (let k = 0; k < 12; k++) {
          const x = warehouse.x + rand(-30, 30), z = warehouse.z + rand(-25, 25);
          const p = M.ped('gang', x, z, rand(0, 6), { ...gangOutfit(), shirt: 0x222222 }, pick(['rifle', 'smg', 'shotgun', 'pistol']));
          p.state = 'stand'; p.hostile = true; p.char.hp = 120;
          guards.push(p);
        }
        M.objective('突袭维加的仓库，找到乔伊');
        M.gpsTarget = warehouse;
        let alerted = false;
        await M.waitUntil(() => {
          if (!alerted && dist(G.player.x, G.player.z, warehouse.x, warehouse.z) < 50) {
            alerted = true; guards.forEach(p => { if (!p.char.dead) p.state = 'attack'; });
            G.hud.subtitle(SAY('守卫', '闯入者！保护货物！'), 2.5);
            M.gpsTarget = null;
          }
          const left = guards.filter(p => !p.char.dead).length;
          if (alerted) M.objective(`清除仓库守卫 · 剩余 ${left}`);
          return left === 0;
        });
        await M.wait(1.5);
        G.hud.notify('在仓库深处发现了乔伊！');
        await M.say('乔伊', '强尼！你真的来了！');
        await M.say('强尼', '别说抱歉。做好准备就行了。');
        await M.say('乔伊', '那些抓我的家伙，其中一个断了手臂，橙色头发。那是老费斯。');
        await M.say('贝蒂', '老费斯……他因为还不起罗斯科的赌债被咬掉了手臂。这事跟罗斯科有关。');
        await M.say('强尼', '罗斯科……那个老狐狸一开始就在利用我们。');
        const g = W().garage;
        await M.goto(g.x, g.z, { car: true, stop: true, label: '带乔伊回据点', r: 6 });
        await M.say('LC', '先把乔伊和贝蒂安置好。然后我们去找罗斯科算账。');
      },
    },

    // ===== CHAPTER 5: 机场送别 (Airport Farewell) =====
    {
      title: '回到别墅', chapter: 5, reward: 15000, needCar: false, noPolice: true,
      where: () => W().garage,
      async run(M) {
        await M.say('强尼', '一定是罗斯科干的。别人收买了他让他绑架乔伊。');
        await M.say('LC', '更大的幕后黑手——克莱夫·可里克。我一年前就闻到了邪恶的味道。');
        await M.say('强尼', '先去沼泽找罗斯科。');
        const swamp = { x: 1 * P + 20, z: 11 * P };
        const guards = [];
        for (let k = 0; k < 8; k++) {
          const p = M.ped('gang', swamp.x + rand(-25, 25), swamp.z + rand(-20, 20), rand(0, 6), gangOutfit(), pick(['rifle', 'smg', 'shotgun']));
          p.state = 'stand'; p.hostile = true; p.char.hp = 110;
          guards.push(p);
        }
        M.objective('前往沼泽，找到罗斯科');
        M.gpsTarget = swamp;
        let alerted = false;
        await M.waitUntil(() => {
          if (!alerted && dist(G.player.x, G.player.z, swamp.x, swamp.z) < 45) {
            alerted = true; guards.forEach(p => { if (!p.char.dead) p.state = 'attack'; });
            G.hud.subtitle(SAY('罗斯科', '你来了，强尼？哈！我就知道你会来。'), 3);
            M.gpsTarget = null;
          }
          const left = guards.filter(p => !p.char.dead).length;
          if (alerted) M.objective(`消灭罗斯科的手下 · 剩余 ${left}`);
          return left === 0;
        });
        await M.say('强尼', '什么也没有。罗斯科跑了。');
        await M.say('LC', '他会回来的。但现在更重要的是——克莱夫·可里克。那才是真正的幕后黑手。');
        await M.say('强尼', '从潘汉德尔到迈阿密，他一直把我当棋子。是时候结束了。');
      },
    },
    {
      title: '干掉汤米', chapter: 5, reward: 18000, needCar: false, noPolice: true,
      where: () => W().garage,
      async run(M) {
        await M.say('LC', '别无选择了，强尼。我们只能跟他们拼了。');
        await M.say('强尼', '先弄清楚对手是谁。那些在机场想干掉我们的人……');
        await M.say('乔伊', '那些家伙看起来很像你从乡下带回来的那些人，强尼。');
        await M.say('强尼', '汤米……那个老混蛋一直在替克莱夫卖命。');
        const hideout = { x: 5 * P, z: 2 * P };
        await M.goto(hideout.x, hideout.z, { car: true, label: '开车去乡巴佬聚所', r: 5 });
        await M.say('汤米', '强尼·盖恩斯维尔！你回来做什么？');
        await M.say('强尼', '汤米。我想弄清楚，克莱夫老板是不是绑架我弟弟的幕后真凶。');
        await M.say('汤米', '你可能以为我在开玩笑？镇上到处都是我们的人马。');
        await M.say('强尼', '看来我能做的只有一件事了。');
        const enemies = [];
        for (let k = 0; k < 10; k++) {
          const p = M.ped('gang', hideout.x + rand(-30, 30), hideout.z + rand(-20, 20), rand(0, 6), gangOutfit(), pick(['rifle', 'smg', 'shotgun']));
          p.state = 'attack'; p.char.hp = 120;
          enemies.push(p);
        }
        const tommy = M.ped('gang', hideout.x + 5, hideout.z, Math.PI, { ...gangOutfit(), shirt: 0x880000, hat: null }, 'rifle');
        tommy.state = 'attack'; tommy.char.hp = tommy.char.maxHp = 350; tommy.accuracy = 0.09;
        enemies.push(tommy);
        M.objective('干掉汤米和他的手下');
        await M.waitUntil(() => { const l = enemies.filter(p => !p.char.dead).length; M.objective(`消灭敌人 · 剩余 ${l}`); return l === 0; });
        await M.say('强尼', '汤米完了。现在只剩克莱夫·可里克了。');
        await M.say('LC', '带上狙击枪。这次我们玩真格的。');
        G.player.giveWeapon('sniper', 30);
        G.hud.notify('🎯 获得 狙击枪');
      },
    },
    {
      title: '开车去机场', chapter: 5, reward: 20000, needCar: true,
      where: () => W().garage,
      async run(M) {
        await M.say('LC', '老朋友，要不是你，我可成功不了。我想是说再见的时候了。');
        await M.say('强尼', '暂别而已，又不是见不着了。天使之城随时欢迎你们。');
        await M.say('乔伊', '你想怎样都行，兄弟。开车去机场怎么样？');
        await M.say('强尼', '非常乐意。');
        const g = W().garageCar || W().garage;
        const car = M.vehicle('muscle', g.x + 6, g.z, Math.PI / 2, 0x111111, { nitroMax: 1 });
        car.setGlow(0xffb02e);
        car.blip = '#3dff7a';
        M.objective('上车');
        await M.waitUntil(() => G.player.inVehicle === car);
        car.blip = null;
        const airportDest = { x: CAUSEWAY.x0 - 30, z: CZ + LANE_OFF[0] };
        M.failIf(() => car.dead, '车被毁了');
        const attackers = [];
        const wave = (n) => {
          for (let k = 0; k < n; k++) {
            const a = Math.random() * Math.PI * 2;
            const l2 = nearestLanePoint(car.x + Math.cos(a) * 130, car.z + Math.sin(a) * 130);
            const c = M.vehicle('muscle', l2.x, l2.z, l2.h, 0xc0392b);
            c.driver = { team: 'gang', outfit: gangOutfit(), weapon: 'smg' };
            c.ai = new Driver(c, { mode: 'ram', target: car, aggressive: true });
            c.blip = '#ff3355';
            c.shootCd = 2;
            attackers.push(c);
          }
        };
        this.update = (dt) => {
          for (const c of attackers) {
            if (c.dead || !c.driver || c.driver === 'player') { c.blip = null; continue; }
            c.shootCd -= dt;
            const d = dist(c.x, c.z, G.player.x, G.player.z);
            if (c.shootCd <= 0 && d < 30) {
              c.shootCd = rand(0.15, 0.3);
              if (Math.random() < 0.08) c.shootCd = 2;
              let dx = G.player.x - c.x + rand(-2, 2), dy = 0.2, dz = G.player.z - c.z + rand(-2, 2); const L = Math.hypot(dx, dy, dz); dx /= L; dy /= L; dz /= L;
              G.combat.fire({ dmgMul: 0.4, spreadMul: 2, inVehicle: c }, 'smg', c.x, c.y + 1.4, c.z, dx, dy, dz);
            }
          }
        };
        await M.wait(5);
        G.hud.subtitle(SAY('乔伊', '噢，他妈的。他们把我们包围了。'), 2.5);
        wave(2);
        M.objective('甩掉追击，开车去机场！');
        await M.wait(10);
        G.hud.subtitle(SAY('LC', '忘了飞机吧，这些家伙不是来护送我们的！'), 2.5);
        wave(3);
        await M.goto(airportDest.x, airportDest.z, { car, label: '冲向机场方向', r: 8 });
        this.update = null;
        await M.say('强尼', '只有调头最安全。回别墅！');
        const villa = W().garage;
        await M.goto(villa.x, villa.z, { car, stop: true, label: '逃回据点', r: 6 });
        await M.say('LC', '听我说，朋友，你为我们做的已经够多了。');
        await M.say('强尼', '不了结这事儿，我坚决不走。从之前发生的一切来看，这事儿肯定没完。');
      },
      cleanup() { this.update = null; },
    },
    {
      title: '终结「老板」', chapter: 5, reward: 50000, needCar: true, noPolice: true,
      where: () => ({ x: CAUSEWAY.x0 - 20, z: CZ + LANE_OFF[0] }),
      async run(M) {
        G.hour = Math.max(G.hour, 19.2) % 24; G.sky.envTimer = 0;
        await M.say('LC', '克莱夫·可里克就在珊瑚岛的别墅里。跨海大桥是唯一的路。');
        await M.say('强尼', '你可以把全世界的废物都招来对付我，克莱夫·可里克，但到最后，我肯定会站到你面前。');
        const end = W().islandEnd;
        await M.goto(end.x - 40, end.z, { car: true, label: '穿过跨海大桥，冲进珊瑚岛', r: 8 });
        const man = W().mansion;
        const guards = [];
        for (let k = 0; k < 14; k++) {
          const x = man.x + rand(-10, 50), z = man.z + rand(-55, 55);
          const p = M.ped('gang', x, z, Math.PI / 2, { ...gangOutfit(), shirt: 0x222222, hat: null, glasses: true }, pick(['rifle', 'smg', 'shotgun', 'pistol']));
          p.state = 'attack'; p.char.hp = p.char.maxHp = 150; p.accuracy = 0.08;
          guards.push(p);
        }
        G.hud.subtitle(SAY('克莱夫（广播）', '强尼？哈哈哈……你真以为能活着走进来？'), 3.5);
        await M.waitUntil(() => { const l = guards.filter(p => !p.char.dead).length; M.objective(`消灭别墅保镖 · 剩余 ${l}`); return l <= 2; });
        const boss = M.vehicle('super', man.x + 10, man.z + 30, -Math.PI / 2, 0xf4f4f4, { nitroMax: 1, armorMul: 2.5 });
        boss.setGlow(0xffd166);
        boss.driver = { team: 'gang', outfit: OUTFITS.boss, weapon: 'smg' };
        boss.ai = new Driver(boss, { mode: 'flee', speed: 28, ignoreLights: true });
        boss.ai.cruise = 30;
        boss.blip = '#ffd166';
        await M.say('克莱夫', '想要我的命？先追上我！', 2.5);
        M.objective('追上并摧毁克莱夫的超跑');
        M.failIf(() => !boss.dead && dist(boss.x, boss.z, G.player.x, G.player.z) > 500, '克莱夫逃掉了');
        await M.waitUntil(() => boss.dead || boss.hp <= 0 || boss.driver === 'player');
        await M.wait(2.5);
        G.hud.big('克莱夫·可里克 · 终', 'gold', '迈阿密重获自由', 4);
        await M.wait(3);
        await M.say('LC', '……结束了？哈！迈阿密从今晚起是你的了，强尼。');
        await M.say('强尼', '不，是我们的。走吧，兄弟，该回家了。');
        await M.say('乔伊', '谢谢你，哥。');
      },
      after() {
        G.hud.big('孤胆车神：雄霸迈阿密', 'gold', '剧情通关 · 自由探索继续 · 收集秘密道具和冲浪板吧', 6);
      },
    },
  ];
}

export { Fail };
void ISLAND; void ISLAND_END_X; void BEACH; void groundHeight;
