// Amelia & Albert's "car emancipation" side jobs and Reginald's errands (original chx text table + cin_chx_* voice).
import { Pursuit } from '../police.js';
import { voice, road } from './util.js';

const GARAGE = [-250, 244];   // Albert's garage
const REGGIE = [574, 176];    // Reginald's place on South Beach
const SEASIDE = [706, -150];  // 45th & Seaside
const VEGA = [241, 52];       // Vega's mansion on the island
const GOLF = [-535, -547];    // the Golf Club
const HARBOR = [295, 259];
const CRANE = [330, 268];
const BANK = [0, -280];
const AIRPORT = [-399, -298];

/** Amelia and Albert waiting at the garage. */
async function garageCrew(m, who = ['amelia', 'albert']) {
  const [x, z] = road(m, GARAGE[0], GARAGE[1], 1);
  const out = {};
  if (who.includes('amelia')) out.amelia = await m.spawnPed('char_amelia', x + 1.2, z, { kind: 'ally', sex: 'female', yaw: Math.PI });
  if (who.includes('albert')) out.albert = await m.spawnPed('char_mechanic', x - 1.2, z + 0.5, { kind: 'ally', yaw: Math.PI, idle: 'sl__civilian_male__chat_cross_arms' });
  return out;
}

async function reggie(m) {
  const [x, z] = road(m, REGGIE[0], REGGIE[1], 1);
  return m.spawnPed('char_reginald', x, z, { kind: 'ally', yaw: Math.PI, idle: 'sl__civilian_male__chat_cross_arms' });
}

/** Target vehicle drives to dest; the player tails it. Fails if he loses it (global 93 "你跟丢了目标"). */
async function tail(m, v, dest, text, { speed = 0.6, lose = 170 } = {}) {
  const g = m.g;
  const purs = new Pursuit(g, v);
  let on = true;
  m.check((dt) => {
    if (!on || v.health <= 0) return null;
    purs.update(dt, dest[0], dest[1], { maxSpeed: speed, stopAt: 8 });
    const p = g.focus;
    const far = Math.hypot(p.x - v.pos.x, p.z - v.pos.z) > lose && Math.hypot(p.x - dest[0], p.z - dest[1]) > 60;
    return far ? m.T(['global', 93]) : null;
  });
  const b = () => (on ? { x: v.pos.x, z: v.pos.z, color: '#ff2a2a' } : null);
  m.blipList.push(b);
  m.objective(text);
  m.hint = { type: 'goto', x: dest[0], z: dest[1], car: true };
  await m.until(() => Math.hypot(g.focus.x - dest[0], g.focus.z - dest[1]) < 45 || Math.hypot(v.pos.x - dest[0], v.pos.z - dest[1]) < 12);
  on = false;
  m.unblip(b);
  // the target pulls up at its destination
  if (Math.hypot(v.pos.x - dest[0], v.pos.z - dest[1]) > 12) {
    const h = g.world.floor(dest[0], dest[1]);
    v.place(dest[0], h > -Infinity ? h : v.pos.y, dest[1], v.yaw);
  }
  v.vf = 0;
}

/** Catch up with a fleeing vehicle (within r metres). */
async function catchUp(m, v, text, r = 9) {
  const g = m.g;
  m.objective(text);
  m.hint = { type: 'goto', get x() { return v.pos.x + 3; }, get z() { return v.pos.z; }, car: true };
  const b = () => ({ x: v.pos.x, z: v.pos.z, color: '#ff2a2a' });
  m.blipList.push(b);
  await m.until(() => v.health <= 0 || Math.hypot(g.focus.x - v.pos.x, g.focus.z - v.pos.z) < r);
  m.unblip(b);
  v.driver = null; v.vf = 0;
}

function bump(m, level) {
  const P = m.g.police;
  P.heat = Math.max(P.heat, level + 0.2);
  P.level = Math.max(P.level, level);
}

export const CHX = [
  {
    id: 'chx_m01', chapter: 'X', file: 'chx', title: '小小罗宾汉', side: true, requires: 'ch1_m03', giver: GARAGE, reward: 1000,
    async run(m) {
      const v = voice('CHX_M01_INTRO');
      await garageCrew(m);
      await m.say([['阿尔伯特', 7, v()], ['强尼', 8, v()], ['阿梅利亚', 9, v()], ['强尼', 10, v()], ['阿梅利亚', 11, v()], ['强尼', 12, v()],
        ['阿梅利亚', 13, v()], ['强尼', 14, v()], ['阿梅利亚', 15, v()], ['强尼', 16, v()], ['阿梅利亚', 17, v()], ['强尼', 18, v()],
        ['阿梅利亚', 19, v()], ['阿梅利亚', 20, v()], ['强尼', 21, v()]]);
      const [cx, cz, cyaw] = road(m, ...SEASIDE);
      const car = await m.spawnCar('car_plymouth_barracuda', cx, cz, cyaw); // the yellow Galoppino
      m.protect(car, ['global', 322]);
      await m.getIn(car, 22);
      const [gx, gz] = road(m, ...GARAGE);
      await m.goto(gx, gz, { r: 8, text: 23, vehicle: car });
      await m.say([['阿梅利亚', 24, 'cin_chx_m01_end_00']]);
    },
  },
  {
    id: 'chx_m02', chapter: 'X', file: 'chx', title: '借用的尊严', side: true, requires: 'chx_m01', giver: GARAGE, reward: 1500,
    async run(m) {
      const v = voice('CHX_M02_INTRO');
      await garageCrew(m);
      await m.say([['阿梅利亚', 28, v()], ['强尼', 29, v()], ['阿梅利亚', 30, v()], ['阿梅利亚', 31, v()], ['阿尔伯特', 32, v()],
        ['强尼', 33, v()], ['阿尔伯特', 34, v()], ['阿尔伯特', 35, v()], ['强尼', 36, v()], ['阿梅利亚', 37, v()], ['阿梅利亚', 38, v()]]);
      // Eddie Fallon's Fat Damsel, parked by the bikers' hangout up north
      const [bx, bz, byaw] = road(m, -472, -657);
      const bike = await m.spawnCar('bike_harley', bx, bz, byaw);
      m.protect(bike, ['global', 322]);
      await m.goto(bx + 3, bz, { r: 6, text: 39 });
      const bikers = [];
      for (let i = 0; i < 3; i++) bikers.push(await m.spawnPed('char_biker', bx - 6 + i * 3, bz + 7, { hostile: true, weapon: i ? 'bat' : 'beretta' }));
      await m.getIn(bike, 27);
      await m.escape(bikers, 110, 40);
      const [gx, gz] = road(m, ...GARAGE);
      await m.goto(gx, gz, { r: 8, text: 41, vehicle: bike });
      const e = voice('CHX_M02_END');
      await garageCrew(m);
      await m.say([['阿尔伯特', 42, e()], ['阿梅利亚', 43, e()], ['阿尔伯特', 44, e()]]);
    },
  },
  {
    id: 'chx_m03', chapter: 'X', file: 'chx', title: '生意兴隆', side: true, requires: 'chx_m02', giver: GARAGE, reward: 2500,
    async run(m) {
      const g = m.g, v = voice('CHX_M03_INTRO');
      await garageCrew(m, ['amelia']);
      await m.say([['阿梅利亚', 48, v()], ['强尼', 49, v()], ['强尼', 50, v()], ['阿梅利亚', 51, v()], ['阿梅利亚', 52, v()],
        ['阿梅利亚', 53, v()], ['阿梅利亚', 54, v()], ['强尼', 55, v()], ['阿梅利亚', 56, v()]]);
      const [vx, vz, vyaw] = road(m, ...VEGA);
      await m.goto(vx - 25, vz, { r: 12, text: 57 });
      const lauf = await m.spawnCar('car_laufer', vx, vz, vyaw);
      const [sx, sz] = road(m, VEGA[0], VEGA[1], 1);
      const vega = await m.spawnPed('char_vega', sx, sz, { kind: 'ally', yaw: 0 });
      const carlos = await m.spawnPed('char_mafia_a', sx + 1.5, sz, { kind: 'ally', yaw: Math.PI });
      const mv = voice('CHX_M03_MIDDLE');
      await m.say([['卡洛斯', 58, mv()], ['维加', 59, mv()], ['维加', 60, mv()]]);
      // Vega drives off to the golf club; Johnny tails him
      vega.root.visible = false; vega.ai = null; vega.pos.set(0, -50, 0);
      void carlos;
      lauf.driver = 'npc';
      const [dx, dz] = road(m, ...GOLF);
      await tail(m, lauf, [dx, dz], 61);
      const [px, pz] = road(m, GOLF[0], GOLF[1], 1);
      vega.root.visible = true; vega.pos.set(px, g.world.floor(px, pz), pz); vega.goal = [px + 25, pz + 10, false]; vega.ai = (dt) => m.pedAI(vega, dt);
      lauf.driver = null;
      await m.getIn(lauf, 62);
      bump(m, 2);
      const [gx, gz] = road(m, ...GARAGE);
      await m.goto(gx, gz, { r: 8, text: 63, vehicle: lauf });
      await garageCrew(m, ['amelia']);
      const e = voice('CHX_M03_END');
      await m.say([['强尼', 64, e()], ['阿梅利亚', 65, e()], ['强尼', 66, e()], ['阿梅利亚', 67, e()], ['强尼', 68, e()], ['阿梅利亚', 69, e()]]);
    },
  },
  {
    id: 'chx_m04', chapter: 'X', file: 'chx', title: '装甲拐卖', side: true, requires: 'chx_m03', giver: GARAGE, reward: 3000,
    async run(m) {
      const v = voice('CHX_M04_INTRO');
      await garageCrew(m, ['amelia']);
      await m.say([['阿梅利亚', 73, v()], ['强尼', 74, v()], ['阿梅利亚', 75, v()], ['强尼', 76, v()], ['阿梅利亚', 77, v()]]);
      const [hx, hz, hyaw] = road(m, ...HARBOR);
      await m.goto(hx, hz, { r: 10, text: 78 });
      const truck = await m.spawnCar('car_bearcat', hx + 10, hz + 6, hyaw);
      const guards = [];
      for (let i = 0; i < 3; i++) guards.push(await m.spawnPed('char_cubangang_1', CRANE[0] + i * 3 - 3, CRANE[1] + 6, { weapon: 'beretta', hostile: false }));
      await m.goto(CRANE[0], CRANE[1], { r: 5, text: 79 });
      for (const p of guards) p.hostile = true;
      await m.killAll(guards, 80);
      const mv = voice('CHX_M04_MIDDLE');
      await m.say([['守卫', 81, mv()], ['守卫', 82, mv()], ['守卫', 83, mv()]]);
      m.protect(truck, ['global', 322]);
      const wave = [];
      for (let i = 0; i < 4; i++) wave.push(await m.spawnPed('char_cubangang_2', truck.pos.x - 12 + i * 4, truck.pos.z + 14, { weapon: i % 2 ? 'uzi' : 'beretta', hostile: true }));
      await m.killAll(wave, 84);
      await m.getIn(truck, 85);
      const [gx, gz] = road(m, ...GARAGE);
      await m.goto(gx, gz, { r: 8, text: 86, vehicle: truck });
      await garageCrew(m, ['amelia']);
      const e = voice('CHX_M04_END');
      await m.say([['强尼', 87, e()], ['阿梅利亚', 88, e()]]);
    },
  },
  {
    id: 'chx_m05', chapter: 'X', file: 'chx', title: '转运', side: true, requires: 'chx_m04', giver: GARAGE, reward: 10000,
    async run(m) {
      const v = voice('CHX_M05_INTRO');
      await garageCrew(m, ['amelia']);
      await m.say([['阿梅利亚', 92, v()], ['强尼', 93, v()], ['阿梅利亚', 94, v()], ['强尼', 95, v()], ['阿梅利亚', 96, v()],
        ['阿梅利亚', 97, v()], ['强尼', 98, v()], ['阿梅利亚', 99, v()]]);
      // the off-roader belongs to Reginald, parked outside his place
      const [tx, tz, tyaw] = road(m, ...REGGIE);
      const truck = await m.spawnCar('car_suv_detour', tx, tz, tyaw);
      await m.goto(tx - 4, tz, { r: 6, text: 100 });
      const reg = await reggie(m);
      const a = voice('CHX_M05_MIDDLE_A');
      await m.say([['雷金纳德', 101, a()], ['雷金纳德', 102, a()], ['强尼', 103, a()], ['强尼', 104, a()], ['强尼', 105, a()],
        ['雷金纳德', 106, a()], ['强尼', 107, a()], ['强尼', 108, a()], ['雷金纳德', 109, a()], ['雷金纳德', 110, a()],
        ['雷金纳德', 111, a()], ['阿梅利亚', 112, a()], ['雷金纳德', 113, a()], ['阿梅利亚', 114, a()], ['雷金纳德', 115, a()]]);
      reg.follow = true;
      m.protect(reg, ['global', 11]);
      await m.getIn(truck, 116);
      const [gx, gz] = road(m, ...GARAGE);
      await m.goto(gx, gz, { r: 8, text: 116, vehicle: truck });
      await garageCrew(m);
      const b = voice('CHX_M05_MIDDLE_B');
      await m.say([['雷金纳德', 117, b()], ['雷金纳德', 118, b()], ['阿尔伯特', 119, b()], ['阿梅利亚', 120, b()], ['阿尔伯特', 121, b()],
        ['阿尔伯特', 122, b()], ['阿梅利亚', 123, b()], ['阿尔伯特', 124, b()], ['雷金纳德', 125, b()], ['强尼', 126, b()]]);
      const [kx, kz] = road(m, ...BANK);
      await m.goto(kx, kz, { r: 10, text: 127, car: true });
      m.g.audio.play('sfx_cop_siren', { vol: 0.6 });
      await m.wait(4);
      bump(m, 3);
      await m.loseWanted(128);
      const e = voice('CHX_M05_END');
      await m.say([['阿尔伯特', 129, e()], ['阿尔伯特', 130, e()], ['阿梅利亚', 131, e()], ['阿梅利亚', 132, e()], ['阿尔伯特', 133, e()],
        ['阿梅利亚', 134, e()], ['阿尔伯特', 135, e()]]);
    },
  },
  {
    id: 'chx_m06', chapter: 'X', file: 'chx', title: '香艳布鲁斯', side: true, requires: 'chx_m05', giver: REGGIE, reward: 800,
    async run(m) {
      const g = m.g, v = voice('CHX_M06_INTRO');
      const reg = await reggie(m);
      await m.say([['雷金纳德', 139, v()], ['强尼', 140, v()], ['雷金纳德', 141, v()], ['强尼', 142, v()], ['雷金纳德', 143, v()],
        ['强尼', 144, v()], ['雷金纳德', 145, v()]]);
      const [cx, cz, cyaw] = road(m, REGGIE[0] + 10, REGGIE[1] + 8);
      const limo = await m.spawnCar('car_limo', cx, cz, cyaw);
      const girls = [];
      for (let i = 0; i < 2; i++) {
        const p = await m.spawnPed(i ? 'char_hoochiemama_b' : 'char_hoochiemama_a', reg.pos.x + 2 + i, reg.pos.z + 1, { kind: 'ally', sex: 'female' });
        p.follow = true; girls.push(p);
      }
      m.protect(limo, ['global', 322]);
      await m.getIn(limo, 138);
      // smooth ride: a hard crash ends the tour ("糟糕驾驶")
      m.check(() => (g.player.vehicle === limo && limo.impact > 7 ? m.T(['global', 155]) : null));
      for (const [x, z] of [[706, -150], [609, 238], [361, 256]]) {
        const [rx, rz] = road(m, x, z);
        await m.goto(rx, rz, { r: 14, text: 138, vehicle: limo });
      }
      const [dx, dz] = road(m, ...REGGIE);
      await m.goto(dx, dz, { r: 10, text: 146, vehicle: limo });
      for (const p of girls) { p.follow = false; p.goal = [reg.pos.x + 3, reg.pos.z + 3, false]; }
    },
  },
  {
    id: 'chx_m07', chapter: 'X', file: 'chx', title: '街上的女人', side: true, requires: 'chx_m06', giver: REGGIE, reward: 1000,
    async run(m) {
      const g = m.g, v = voice('CHX_M07_INTRO');
      const reg = await reggie(m);
      const tracy = await m.spawnPed('char_hoochiemama_a', reg.pos.x + 1.5, reg.pos.z, { kind: 'ally', sex: 'female', yaw: Math.PI });
      m.protect(tracy, ['global', 19]);
      await m.say([['雷金纳德', 150, v()], ['翠西', 151, v()], ['雷金纳德', 152, v()], ['强尼', 153, v()], ['雷金纳德', 154, v()]]);
      const [ax, az, ayaw] = road(m, REGGIE[0] + 12, REGGIE[1]);
      const [bx, bz, byaw] = road(m, REGGIE[0] - 12, REGGIE[1]);
      const c1 = await m.spawnCar('car_laufer', ax, az, ayaw);
      const c2 = await m.spawnCar('car_vamp', bx, bz, byaw);
      tracy.follow = true;
      m.objective(155);
      m.hint = { type: 'getin', v: c1 };
      await m.until(() => g.player.vehicle === c1 || g.player.vehicle === c2);
      // the client waits across town, up north
      const [dx, dz] = road(m, 79, -643);
      m.timer(150);
      await m.goto(dx, dz, { r: 10, text: 155, car: true });
      m.stopTimer();
      await m.exitVehicle();
      tracy.follow = false;
      tracy.goal = [dx + 10, dz + 6, false];
      await m.say([['强尼', 156, 'cin_chx_m07_end_00']]);
    },
  },
  {
    id: 'chx_m08', chapter: 'X', file: 'chx', title: '逐爱', side: true, requires: 'chx_m07', giver: REGGIE, reward: 1500,
    async run(m) {
      const v = voice('CHX_M08_INTRO');
      const reg = await reggie(m);
      await m.say([['雷金纳德', 160, v()], ['强尼', 161, v()], ['雷金纳德', 162, v()], ['雷金纳德', 163, v()], ['强尼', 164, v()],
        ['雷金纳德', 165, v()], ['强尼', 166, v()], ['雷金纳德', 167, v()]]);
      const [bx, bz, byaw] = road(m, REGGIE[0] + 8, REGGIE[1] + 4);
      const bike = await m.spawnCar('bike_dirt', bx, bz, byaw);
      await m.getIn(bike, 168);
      const [gx, gz, gyaw] = road(m, ...GOLF);
      await m.goto(gx, gz, { r: 25, text: 168, car: true });
      const [px, pz] = road(m, GOLF[0], GOLF[1], 1);
      const tracy = await m.spawnPed('char_hoochiemama_a', px + 6, pz, { kind: 'ally', sex: 'female' });
      const ralf = await m.spawnPed('char_civ_man', px + 7, pz + 1.2, { kind: 'civ', yaw: Math.PI });
      m.protect(tracy, ['global', 19]);
      const a = voice('CHX_M08_MIDDLE_A');
      await m.say([['翠西', 169, a()], ['拉尔夫', 170, a()], ['强尼', 171, a()], ['翠西', 172, a()], ['拉尔夫', 173, a()]]);
      // they run for Ralf's car
      const car = await m.spawnCar('car_tawny', gx + 8, gz + 3, gyaw, { driver: 'npc' });
      for (const p of [tracy, ralf]) { p.root.visible = false; p.ai = null; p.pos.set(0, -50, 0); }
      m.driveAround(car, 0.7);
      await catchUp(m, car, 174);
      const h = m.g.world.height(car.pos.x, car.pos.z, car.pos.y + 2);
      ralf.pos.set(car.pos.x + 2, h, car.pos.z); ralf.root.visible = true; ralf.ai = (dt) => m.pedAI(ralf, dt);
      tracy.pos.set(car.pos.x - 2, h, car.pos.z); tracy.root.visible = true; tracy.ai = (dt) => m.pedAI(tracy, dt);
      await m.exitVehicle();
      await m.beat(ralf, 175);
      const b = voice('CHX_M08_MIDDLE_B');
      await m.say([['翠西', 176, b()], ['强尼', 177, b()]]);
      tracy.follow = true;
      const [rx, rz] = road(m, ...REGGIE);
      await m.goto(rx, rz, { r: 10, text: 178, car: true });
      const e = voice('CHX_M08_END');
      await m.say([['雷金纳德', 179, e()], ['翠西', 180, e()], ['雷金纳德', 181, e()]]);
      void reg;
    },
  },
  {
    id: 'chx_m09', chapter: 'X', file: 'chx', title: '妓院挖角记', side: true, requires: 'chx_m08', giver: REGGIE, reward: 2500,
    async run(m) {
      const v = voice('CHX_M09_INTRO');
      await reggie(m);
      await m.say([['雷金纳德', 185, v()], ['雷金纳德', 186, v()], ['强尼', 187, v()], ['雷金纳德', 188, v()]]);
      const [tx, tz, tyaw] = road(m, REGGIE[0] + 10, REGGIE[1] + 8);
      const truck = await m.spawnCar('car_van', tx, tz, tyaw);
      await m.getIn(truck, 184);
      const mid = voice('CHX_M09_MIDDLE');
      const girls = [];
      const girl = async (x, z, model, text) => {
        const [gx, gz] = road(m, x, z, 1);
        await m.goto(gx, gz, { r: 9, text });
        const p = await m.spawnPed(model, gx + 1, gz, { kind: 'ally', sex: 'female' });
        p.follow = true; girls.push(p);
        return [gx, gz];
      };
      await girl(609, 238, 'char_hoochiemama_a', 189);
      await m.say([['强尼', 190, mid()]]);
      const [g2x, g2z] = await girl(706, -150, 'char_hoochiemama_b', 191);
      const pimp = await m.spawnPed('char_bigbossman', g2x + 3, g2z + 2, { kind: 'gang', yaw: Math.PI });
      await m.say([['皮条客', 192, mid()]]);
      await m.beat(pimp, 193);
      const [g3x, g3z] = await girl(361, 256, 'char_northcuban_girl', 194);
      await m.say([['强尼', 195, mid()]]);
      const thugs = [];
      for (let i = 0; i < 3; i++) thugs.push(await m.spawnPed('char_cubangang_1', g3x - 10 + i * 4, g3z + 12, { hostile: true, weapon: 'beretta' }));
      await m.escape(thugs, 100, 196);
      const [g4x, g4z] = await girl(0, -280, 'char_girlgang_a', 197);
      const guards = [];
      for (let i = 0; i < 3; i++) guards.push(await m.spawnPed('char_cubangang_2', g4x + 12, g4z - 8 + i * 4, { hostile: true, weapon: 'uzi' }));
      await m.escape(guards, 100, 198);
      const [g5x, g5z] = road(m, -293, -160, 1);
      await m.goto(g5x, g5z, { r: 9, text: 199 });
      const keepers = [];
      for (let i = 0; i < 3; i++) keepers.push(await m.spawnPed('char_cubangang_1', g5x + 6 + i * 3, g5z + 6, { hostile: true, weapon: i ? 'beretta' : 'ak47' }));
      await m.killAll(keepers, 200);
      const last = await m.spawnPed('char_girlgang_b', g5x + 1, g5z, { kind: 'ally', sex: 'female' });
      last.follow = true; girls.push(last);
      const [rx, rz] = road(m, ...REGGIE);
      await m.goto(rx, rz, { r: 10, text: 201, car: true });
      const e = voice('CHX_M09_END');
      await m.say([['雷金纳德', 202, e()], ['女孩', 203, e()]]);
    },
  },
  {
    id: 'chx_m10', chapter: 'X', file: 'chx', title: 'S曲线诱惑', side: true, requires: 'chx_m09', giver: REGGIE, reward: 3000,
    async run(m) {
      const v = voice('CHX_M10_INTRO');
      await reggie(m);
      await m.say([['雷金纳德', 207, v()], ['雷金纳德', 208, v()], ['强尼', 209, v()], ['雷金纳德', 210, v()], ['雷金纳德', 211, v()],
        ['强尼', 212, v()], ['雷金纳德', 213, v()]]);
      const [hx, hz, hyaw] = road(m, REGGIE[0] + 14, REGGIE[1] + 6);
      const heli = await m.spawnCar('heli_news', hx, hz, hyaw);
      m.protect(heli, ['global', 322]);
      await m.getIn(heli, 214);
      const [ax, az, ayaw] = road(m, ...AIRPORT);
      await m.goto(ax, az, { r: 30, text: 214, vehicle: heli });
      // the husband leaves the airport by limo for his beach hotel
      const limo = await m.spawnCar('car_limo', ax + 6, az, ayaw, { driver: 'npc' });
      const [dx, dz] = road(m, 609, 238);
      await tail(m, limo, [dx, dz], 215, { speed: 0.55, lose: 220 });
      const e = voice('CHX_M10_END');
      await m.say([['女孩', 216, e()], ['强尼', 217, e()]]);
    },
  },
];
