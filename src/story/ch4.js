import { Pursuit } from '../police.js';
import { voice, road } from './util.js';

// Chapter 4 — "未知攻击者 / 阿马达陷入困境". Every on-screen line is the original ch4 table text by index;
// voice clips cin_ch4_m_NN_<part>_XX follow each mission's dialogue lines in order.

// ---------------------------------------------------------------- shared helpers (also used by ch5.js)
export const SPOT = {
  villa: [228.5, 4.2], // the Gainesvilles' villa on Star Island
  betty: [-397.4, -432.6],
  lookout: [29.6, -247.3],
  jones: [136.8, -426.7], // Jones' crew, Biscayne Bay waterfront
  vega: [599, -754.3],
  dealer: [-225.8, 226.5],
  stereo: [-149.8, 374.8],
  police: [-231.7, -221.9],
  swamp: [-666.6, 263.6],
  concert: [-64, -130.3],
  restaurant: [296.8, 259.7],
  airport: [-571, -426.7],
  hillbilly: [-436.4, -703.6],
  mall: [-134.2, 103.7],
  clive: [489.8, -617.8],
};

/** add a per-frame check; returns a remover */
export function addCheck(m, fn) {
  m.checks.push(fn);
  return () => { const i = m.checks.indexOf(fn); if (i >= 0) m.checks.splice(i, 1); };
}

export function setWanted(g, n) {
  g.police.heat = n + 0.5;
  g.police.level = n;
  g.police.unseen = 0;
}

/** nearest open water (no ground within `clear` metres) around x,z */
export function findWater(g, x, z, clear = 12, maxR = 260) {
  const wet = (px, pz) => g.world.height(px, pz, 2, 0) === -Infinity;
  for (let r = 0; r <= maxR; r += 6) {
    const n = Math.max(1, Math.round(r / 4));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (!wet(px, pz)) continue;
      let ok = true;
      for (let j = 0; j < 8 && ok; j++) ok = wet(px + Math.cos(j * 0.785) * clear, pz + Math.sin(j * 0.785) * clear);
      if (ok) return [px, pz];
    }
  }
  return [x, z];
}

/** spawn a group of characters around a point (snapped to walkable sidewalks) */
export async function squad(m, models, x, z, opts = {}, spread = 10) {
  const out = [];
  for (let i = 0; i < models.length; i++) {
    const a = (i / models.length) * Math.PI * 2;
    const [px, pz] = road(m, x + Math.cos(a) * spread, z + Math.sin(a) * spread, i % 2 ? 1 : -1);
    const weapon = Array.isArray(opts.weapon) ? opts.weapon[i % opts.weapon.length] : opts.weapon;
    out.push(await m.spawnPed(models[i], px, pz, { ...opts, weapon, yaw: a + Math.PI }));
  }
  return out;
}

/** wait until every vehicle is destroyed; optional `lose` distance fails the mission */
export async function destroy(m, cars, text, lose = 0) {
  if (text != null) m.objective(text);
  const bl = cars.map((v) => () => (v.health > 0 ? { x: v.pos.x, z: v.pos.z, color: '#ff2a2a', small: true } : null));
  m.blipList.push(...bl);
  m.hint = { type: 'escape', chasers: cars };
  const stop = lose ? addCheck(m, () => (cars.some((v) => v.health > 0 && Math.hypot(v.pos.x - m.g.focus.x, v.pos.z - m.g.focus.z) > lose) ? m.T(['global', 93]) : null)) : null;
  await m.until(() => cars.every((v) => v.health <= 0));
  if (stop) stop();
  for (const b of bl) m.unblip(b);
}

/** AI car driving to `dest` (route-following); returns {stop, arrived()} */
export function driveTo(m, v, dest, speed = 0.7) {
  const P = new Pursuit(m.g, v);
  let arrived = false;
  v.driver = v.driver || 'npc';
  const stop = addCheck(m, (dt) => {
    if (v.health <= 0) return null;
    if (!arrived) { if (P.update(dt, dest[0], dest[1], { maxSpeed: speed, stopAt: 6 }) < 14) arrived = true; }
    else v.update(dt, { throttle: 0, steer: 0, handbrake: true }, m.g.world);
    return null;
  });
  return { stop, arrived: () => arrived };
}

/** AI car hunting the player (rams) */
export function hunt(m, v, speed = 0.95) {
  const P = new Pursuit(m.g, v);
  v.driver = v.driver || 'npc';
  return addCheck(m, (dt) => { if (v.health > 0) P.update(dt, m.g.focus.x, m.g.focus.z, { maxSpeed: speed }); return null; });
}

/**
 * Tail a target vehicle until it reaches `dest`. Fails (original "你跟丢了目标") past `lose` metres,
 * shows `warn` when drifting away.
 */
export async function trail(m, v, dest, { text, lose = 230, warn, speed = 0.65 } = {}) {
  const g = m.g;
  if (text != null) m.objective(text);
  const d = driveTo(m, v, dest, speed);
  const b = () => (v.health > 0 ? { x: v.pos.x, z: v.pos.z, color: '#ff2a2a' } : null);
  m.blipList.push(b);
  let t = 0, warned = 0;
  const stop = addCheck(m, (dt) => {
    t += dt;
    // keep a fresh "stay close" hint (used by automated playtests)
    if (Math.floor(t) !== Math.floor(t - dt)) m.hint = { type: 'goto', x: v.pos.x - Math.sin(v.yaw) * 14, z: v.pos.z - Math.cos(v.yaw) * 14, car: true };
    const dist = Math.hypot(v.pos.x - g.focus.x, v.pos.z - g.focus.z);
    if (warn != null && dist > lose * 0.65 && t - warned > 6) { warned = t; g.hud.notify(m.T(warn), 2.5); }
    return dist > lose ? m.T(['global', 93]) : null;
  });
  await m.until(() => d.arrived() || v.health <= 0);
  stop(); d.stop();
  m.hint = null;
  m.unblip(b);
}

/** simple boat AI cycling through water waypoints */
export function boatPatrol(m, b, pts, speed = 0.8) {
  let i = 0;
  return addCheck(m, (dt) => {
    if (b.health <= 0) return null;
    const [x, z] = pts[i];
    if (Math.hypot(x - b.pos.x, z - b.pos.z) < 18) i = (i + 1) % pts.length;
    let e = Math.atan2(x - b.pos.x, z - b.pos.z) - b.yaw;
    e = Math.atan2(Math.sin(e), Math.cos(e));
    b.update(dt, { throttle: speed, steer: Math.max(-1, Math.min(1, -e * 2)), handbrake: false }, m.g.world);
    return null;
  });
}

/** boat chasing the player and firing at it */
export function boatAttack(m, b) {
  const g = m.g;
  let cool = 1;
  return addCheck(m, (dt) => {
    if (b.health <= 0) return null;
    const t = g.focus;
    let e = Math.atan2(t.x - b.pos.x, t.z - b.pos.z) - b.yaw;
    e = Math.atan2(Math.sin(e), Math.cos(e));
    const d = Math.hypot(t.x - b.pos.x, t.z - b.pos.z);
    b.update(dt, { throttle: d > 14 ? 0.95 : 0.2, steer: Math.max(-1, Math.min(1, -e * 2)), handbrake: false }, g.world);
    cool -= dt;
    if (cool <= 0 && d < 45) {
      cool = 0.35;
      g.audio.play('sfx_uzi_shoot', { vol: g.audioVol(b.pos, 0.7) });
      const a = { x: b.pos.x, y: b.pos.y + 1.5, z: b.pos.z };
      g.fx.tracer(a, { x: t.x + (Math.random() - 0.5) * 2, y: t.y + 1, z: t.z + (Math.random() - 0.5) * 2 });
      if (Math.random() < 0.3) { if (g.player.vehicle) g.player.vehicle.health -= 8; else g.player.hurt(5, b.pos); }
    }
    return null;
  });
}

/** allies hanging around a spot (non-hostile) */
export async function cast(m, list, x, z) {
  const out = {};
  let i = 0;
  for (const [name, model, sex] of list) {
    const [px, pz] = road(m, x + 3 + i * 1.6, z + 2 - i, 1);
    out[name] = await m.spawnPed(model, px, pz, { kind: 'ally', sex: sex || 'male', yaw: Math.PI });
    i++;
  }
  return out;
}

/** ensure the player has a weapon with ammo */
export function arm(g, w, ammo) {
  const pl = g.player;
  pl.give(w, ammo);
}

const ARMADA = ['char_northcuban_1', 'char_northcuban_2', 'char_cubangang_1', 'char_cubangang_2', 'char_northcuban_1'];
const JONES = ['char_girlgang_a', 'char_girlgang_b', 'char_hoochiemama_a', 'char_girlgang_a', 'char_hoochiemama_b'];

export const CH4 = [
  {
    id: 'ch4_m01', chapter: 4, file: 'ch4', title: '潜入阿马达', reward: 4000,
    giver: SPOT.villa,
    async run(m) {
      const g = m.g, v = voice('CH4_M_01_INTRO');
      const [vx, vz] = SPOT.villa;
      const fam = await cast(m, [['LC', 'char_lc'], ['乔伊', 'char_joey']], vx, vz);
      m.objective(4);
      await m.say([['LC', 5, v()], ['乔伊', 6, v()], ['强尼', 7, v()], ['强尼', 8, v()], ['阿马达', 9, v()], ['强尼', 10, v()], ['阿马达', 11, v()], ['强尼', 12, v()]]);
      void fam;
      const [bx, bz] = road(m, SPOT.betty[0], SPOT.betty[1], 1);
      await m.goto(bx, bz, { r: 9, text: 13 });
      const va = voice('CH4_M_01_MIDDLE_A');
      await m.say([['强尼', 14, va()], ['贝蒂', 15, va()], ['强尼', 16, va()]]);
      await m.goto(vx, vz, { r: 12, text: 17 });
      const thugs = await squad(m, ARMADA.slice(0, 4), vx, vz, { hostile: true, weapon: ['beretta', 'uzi'] }, 14);
      await m.killAll(thugs, 18);
      const betty = await m.spawnPed('char_betty', ...road(m, vx + 4, vz - 3, 1).slice(0, 2), { kind: 'ally', sex: 'female' });
      m.protect(betty, ['global', 327]);
      const vb = voice('CH4_M_01_MIDDLE_B');
      await m.say([['贝蒂', 19, vb()], ['强尼', 20, vb()], ['贝蒂', 21, vb()], ['强尼', 22, vb()], ['贝蒂', 23, vb()]]);
      for (let w = 0; w < 2; w++) {
        const wave = await squad(m, ARMADA.slice(w, w + 4), vx + 30, vz + (w ? 25 : -25), { hostile: true, weapon: ['uzi', 'beretta', 'ak47'] }, 10);
        await m.killAll(wave, 24);
      }
      const ve = voice('CH4_M_01_END');
      await m.say([['LC', 25, ve()], ['强尼', 26, ve()], ['强尼', 27, ve()], ['贝蒂', 28, ve()], ['LC', 29, ve()], ['乔伊', 30, ve()]]);
    },
  },
  {
    id: 'ch4_m02', chapter: 4, file: 'ch4', title: '瞭望台上的LC', reward: 4000,
    giver: SPOT.lookout,
    async run(m) {
      const g = m.g, v = voice('CH4_M_02_INTRO');
      const [lx, lz] = SPOT.lookout;
      await cast(m, [['LC', 'char_lc']], lx, lz);
      m.objective(33);
      await m.say([['强尼', 34, v()], ['LC', 35, v()], ['强尼', 36, v()], ['LC', 37, v()], ['强尼', 38, v()], ['LC', 39, v()], ['强尼', 40, v()]]);
      const [kx, kz, kyaw] = road(m, lx + 8, lz + 6);
      const bike = await m.spawnCar('bike_kawa', kx, kz, kyaw);
      const [tx, tz, tyaw] = road(m, lx + 60, lz + 20);
      const thug = await m.spawnCar('bike_kawa_sport', tx, tz, tyaw, { driver: 'npc' });
      const [cx, cz, cyaw] = road(m, lx + 70, lz + 30);
      const car = await m.spawnCar('car_homm_black', cx, cz, cyaw, { driver: 'npc' });
      driveTo(m, car, road(m, 450, -300), 0.55);
      m.protect(bike, ['global', 322]);
      await m.getIn(bike, 41);
      await trail(m, thug, road(m, SPOT.police[0], SPOT.police[1]), { text: 33, lose: 220 });
      const vm = voice('CH4_M_02_MIDDLE');
      await m.say([['警方无线电', 42, vm()], ['强尼', 43, vm()], ['LC', 44, vm()]]);
      m.checks.length = 0;
      setWanted(g, 3);
      await m.loseWanted(45);
      await m.caption(46, 3);
      await m.goto(SPOT.villa[0], SPOT.villa[1], { r: 12, text: 17 });
      const ve = voice('CH4_M_02_END');
      await m.say([['强尼', 48, ve()], ['LC', 49, ve()], ['LC', 50, ve()], ['强尼', 51, ve()]]);
    },
  },
  {
    id: 'ch4_m03', chapter: 4, file: 'ch4', title: '跟踪琼斯', reward: 5000,
    giver: SPOT.villa,
    async run(m) {
      const g = m.g, v = voice('CH4_M_03_INTRO');
      const [vx, vz] = SPOT.villa;
      const { LC: lc } = await cast(m, [['LC', 'char_lc']], vx, vz);
      m.objective(54);
      await m.say([['LC', 55, v()], ['强尼', 56, v()], ['LC', 57, v()], ['强尼', 58, v()], ['LC', 59, v()], ['强尼', 60, v()], ['LC', 61, v()], ['强尼', 62, v()]]);
      lc.follow = true;
      m.protect(lc, ['global', 328]);
      const [wx, wz] = findWater(g, vx, vz);
      const boat = await m.spawnCar('boat_speedboat_cigar', wx, wz, 0);
      m.protect(boat, ['global', 325]);
      await m.getIn(boat, ['global', 104]);
      const [jx, jz] = SPOT.jones;
      const [jwx, jwz] = findWater(g, jx, jz);
      await m.goto(jwx, jwz, { r: 25, text: 63, vehicle: boat });
      const guards = await squad(m, JONES.slice(0, 5), jx, jz, { hostile: true, weapon: ['uzi', 'ak47', 'beretta'], sex: 'female' }, 12);
      await m.killAll(guards, 64);
      const vm = voice('CH4_M_03_MIDDLE');
      await m.say([['强尼', 65, vm()], ['LC', 66, vm()], ['强尼', 67, vm()]]);
      const [ax, az] = findWater(g, jwx + 60, jwz + 40);
      const attack = await m.spawnCar('boat_speedboat_police', ax, az, Math.PI, { driver: 'npc' });
      boatAttack(m, attack);
      await m.escape([attack], 160, 68);
      await m.goto(wx, wz, { r: 25, text: 69, vehicle: boat });
      await m.exitVehicle();
      const fam = await cast(m, [['贝蒂', 'char_betty', 'female'], ['乔伊', 'char_joey']], vx, vz);
      void fam;
      const ve = voice('CH4_M_03_END');
      await m.say([['强尼', 70, ve()], ['贝蒂', 71, ve()], ['强尼', 72, ve()], ['LC', 73, ve()], ['贝蒂', 74, ve()], ['贝蒂', 75, ve()], ['LC', 76, ve()], ['强尼', 77, ve()]]);
    },
  },
  {
    id: 'ch4_m04', chapter: 4, file: 'ch4', title: '燃烧的迈阿密', reward: 5000,
    giver: SPOT.villa,
    async run(m) {
      const g = m.g, v = voice('CH4_M_04_INTRO');
      const [vx, vz] = SPOT.villa;
      await cast(m, [['LC', 'char_lc'], ['乔伊', 'char_joey']], vx, vz);
      m.objective(80);
      await m.say([['LC', 81, v()], ['强尼', 82, v()], ['LC', 83, v()], ['强尼', 84, v()], ['LC', 85, v()], ['乔伊', 86, v()], ['LC', 87, v()],
        ['强尼', 88, v()], ['LC', 89, v()], ['强尼', 90, v()], ['乔伊', 91, v()], ['强尼', 92, v()], ['LC', 93, v()]]);
      // molotovs are not in this arsenal: LC hands over explosives instead
      arm(g, 'rpg', 8);
      const [gx, gz] = road(m, SPOT.vega[0], SPOT.vega[1], 1);
      await m.goto(gx, gz, { r: 14, text: 94 });
      const vcars = [];
      const pool = ['car_lamb', 'car_laufer', 'car_vamp', 'car_plymouth_flames', 'car_homm'];
      for (let i = 0; i < pool.length; i++) {
        const [cx, cz, cyaw] = road(m, gx + 10 + i * 7, gz + (i % 2 ? 8 : -8));
        vcars.push(await m.spawnCar(pool[i], cx, cz, cyaw));
      }
      await destroy(m, vcars, 95);
      const vm = voice('CH4_M_04_MIDDLE');
      await m.say([['强尼', 96, vm()], ['强尼', 97, vm()]]);
      const [dx, dz] = road(m, SPOT.dealer[0], SPOT.dealer[1], 1);
      await m.goto(dx, dz, { r: 14, text: 98 });
      const lot = [];
      for (let i = 0; i < 4; i++) {
        const [cx, cz, cyaw] = road(m, dx + 12 + i * 7, dz + (i % 2 ? 6 : -6));
        lot.push(await m.spawnCar(['car_tawny', 'car_cooperv8_berlin', 'car_buck', 'car_suv_detour'][i], cx, cz, cyaw));
      }
      await destroy(m, lot, 99);
      const guards = await squad(m, ['char_mafia_a', 'char_mafia_b', 'char_mafia_c'], dx, dz, { hostile: true, weapon: ['beretta', 'uzi'] }, 16);
      await m.killAll(guards, 100);
      await m.goto(dx, dz, { r: 8, text: 101 });
      const [sx, sz] = road(m, dx + 3, dz + 2, 1);
      await m.spawnPed('char_cutscenes_male', sx, sz, { kind: 'civ', yaw: Math.PI });
      const ve = voice('CH4_M_04_END');
      await m.say([['车商', 102, ve()], ['强尼', 103, ve()], ['车商', 104, ve()], ['强尼', 105, ve()], ['车商', 106, ve()], ['强尼', 107, ve()]]);
    },
  },
  {
    id: 'ch4_m05', chapter: 4, file: 'ch4', title: '音响', reward: 4500,
    giver: SPOT.stereo,
    async run(m) {
      const g = m.g;
      const [sx, sz] = SPOT.stereo;
      const [vx, vz, vyaw] = road(m, sx + 10, sz + 4);
      const van = await m.spawnCar('car_van_white', vx, vz, vyaw, { driver: 'npc' });
      m.protect(van, ['global', 322]);
      await m.getIn(van, 110);
      const v = voice('CH4_M_05_INTRO');
      await m.say([['强尼', 111, v()], ['音响商', 112, v()], ['强尼', 113, v()], ['音响商', 114, v()], ['强尼', 115, v()], ['强尼', 116, v()], ['音响商', 117, v()]]);
      // scare him: a fast reckless run through the streets
      m.timer(100);
      for (const [px, pz] of [[sx + 140, sz - 90], [sx + 40, sz - 220], [sx - 120, sz - 150]]) {
        const [cx, cz] = road(m, px, pz);
        await m.goto(cx, cz, { r: 10, text: 118, vehicle: van });
      }
      m.stopTimer();
      const vm = voice('CH4_M_05_MIDDLE');
      await m.say([['音响商', 119, vm()], ['强尼', 120, vm()], ['音响商', 121, vm()]]);
      const [bx, bz] = road(m, sx, sz);
      await m.goto(bx, bz, { r: 10, text: 122, vehicle: van });
      await m.exitVehicle();
      const [px, pz] = road(m, sx + 2, sz + 2, 1);
      await m.spawnPed('char_cutscenes_male', px, pz, { kind: 'civ' });
      const ve = voice('CH4_M_05_END');
      await m.say([['音响商', 123, ve()], ['强尼', 124, ve()], ['音响商', 125, ve()], ['强尼', 126, ve()], ['音响商', 127, ve()], ['音响商', 128, ve()], ['强尼', 129, ve()]]);
      void g;
    },
  },
  {
    id: 'ch4_m06', chapter: 4, file: 'ch4', title: '强尼的审判', reward: 6000,
    giver: SPOT.villa,
    async run(m) {
      const g = m.g, v = voice('CH4_M_06_INTRO');
      const [vx, vz] = SPOT.villa;
      await cast(m, [['乔伊', 'char_joey']], vx, vz);
      m.objective(132);
      await m.say([['乔伊', 133, v()], ['强尼', 134, v()], ['乔伊', 135, v()], ['强尼', 136, v()], ['强尼', 137, v()]]);
      arm(g, 'ak47', 120);
      const [px, pz] = road(m, SPOT.police[0], SPOT.police[1]);
      m.timer(150);
      await m.goto(px, pz, { r: 30, text: 138 });
      m.stopTimer();
      const [cx, cz, cyaw] = road(m, px + 15, pz + 10);
      const cruiser = await m.spawnCar('car_police_rich', cx, cz, cyaw, { driver: 'cop', health: 700 });
      const d = driveTo(m, cruiser, road(m, 300, 250), 0.6);
      await destroy(m, [cruiser], 139, 260);
      d.stop();
      const [wx, wz] = road(m, cruiser.pos.x + 2, cruiser.pos.z + 2, 1);
      const vega = await m.spawnPed('char_vega', wx, wz, { hostile: true, weapon: 'beretta', health: 120 });
      g.hud.notify(m.T(141), 2.5);
      await m.killAll([vega], 140);
      setWanted(g, 3);
      await m.loseWanted(142);
      const ve = voice('CH4_M_06_END');
      await m.say([['强尼', 143, ve()], ['LC', 144, ve()], ['强尼', 145, ve()], ['LC', 146, ve()]]);
    },
  },
  {
    id: 'ch4_m07', chapter: 4, file: 'ch4', title: '挚爱', reward: 5000,
    giver: SPOT.villa,
    async run(m) {
      const g = m.g;
      const [bx, bz] = road(m, SPOT.swamp[0], SPOT.swamp[1], 1);
      await m.goto(bx, bz, { r: 10, text: 149 });
      const betty = await m.spawnPed('char_betty', bx + 2, bz + 1.5, { kind: 'ally', sex: 'female', yaw: -Math.PI / 2 });
      m.protect(betty, ['global', 327]);
      const v = voice('CH4_M_07_INTRO');
      await m.say([['强尼', 150, v()], ['贝蒂', 151, v()], ['强尼', 152, v()], ['贝蒂', 153, v()], ['强尼', 154, v()], ['贝蒂', 155, v()],
        ['强尼', 156, v()], ['贝蒂', 157, v()], ['强尼', 158, v()], ['贝蒂', 159, v()]]);
      // the spy runs for it across the swamp; Roscoe's old airboat is moored at the bank
      const [ax, az] = findWater(g, bx - 20, bz, 6);
      const airboat = await m.spawnCar('boat_floatingpoint_single', ax, az, -Math.PI / 2);
      const [ex, ez] = findWater(g, bx - 70, bz + 40, 8);
      const spyBoat = await m.spawnCar('boat_seadoo', ex, ez, 0, { driver: 'npc', health: 500 });
      const route = [findWater(g, ex - 80, ez + 60, 8), findWater(g, ex - 40, ez + 160, 8), findWater(g, ex + 20, ez + 80, 8), [ex, ez]];
      const stop = boatPatrol(m, spyBoat, route, 0.6);
      await m.getIn(airboat, ['global', 104]);
      await destroy(m, [spyBoat], 160, 400);
      stop();
      const [sx, sz] = road(m, spyBoat.pos.x, spyBoat.pos.z, 1);
      const spy = await m.spawnPed('char_civ_trash_1', sx, sz, { kind: 'gang' });
      spy.goal = [sx + 4, sz + 4, true];
      await m.beat(spy, 161);
      const ve = voice('CH4_M_07_END');
      await m.say([['强尼', 162, ve()], ['探子', 163, ve()], ['强尼', 164, ve()], ['探子', 165, ve()]]);
    },
  },
  {
    id: 'ch4_m08', chapter: 4, file: 'ch4', title: '美妙陷阱', reward: 8000,
    giver: SPOT.swamp,
    async run(m) {
      const g = m.g, v = voice('CH4_M_08_INTRO');
      const [sx, sz] = SPOT.swamp;
      const betty = await m.spawnPed('char_betty', ...road(m, sx + 2, sz + 2, 1).slice(0, 2), { kind: 'ally', sex: 'female' });
      void betty;
      m.objective(168);
      await m.say([['贝蒂', 169, v()], ['强尼', 170, v()], ['贝蒂', 171, v()], ['强尼', 172, v()], ['贝蒂', 173, v()], ['强尼', 174, v()], ['强尼', 175, v()], ['强尼', 176, v()]]);
      const [lx, lz, lyaw] = road(m, 40, -320);
      const limo = await m.spawnCar('car_limo', lx, lz, lyaw, { driver: 'npc' });
      const unprotect = addCheck(m, () => (limo.health <= 0 ? m.T(['global', 322]) : null));
      await m.getIn(limo, 177);
      const [cx, cz] = road(m, SPOT.concert[0], SPOT.concert[1]);
      await m.goto(cx, cz, { r: 10, text: 178, vehicle: limo });
      const va = voice('CH4_M_08_MIDDLE_A');
      await m.say([['男伴', 179, va()], ['莫尼克', 180, va()], ['强尼', 181, va()]]);
      // "drive carefully": a hard crash gives the game away
      const careful = addCheck(m, () => (limo.impact > 9 ? m.T(['global', 154]) : null));
      const [rx, rz] = road(m, SPOT.restaurant[0], SPOT.restaurant[1]);
      await m.goto(rx, rz, { r: 12, text: 182, vehicle: limo });
      careful();
      const vb = voice('CH4_M_08_MIDDLE_B');
      await m.say([['莫尼克', 183, vb()], ['强尼', 184, vb()], ['男伴', 185, vb()], ['莫尼克', 186, vb()], ['强尼', 187, vb()], ['莫尼克', 188, vb()],
        ['莫尼克', 189, vb()], ['强尼', 190, vb()], ['莫尼克', 191, vb()], ['莫尼克', 192, vb()], ['莫尼克', 193, vb()]]);
      // decide her fate: drive her to the airport, or get out and destroy the car
      unprotect();
      const [ax, az] = road(m, SPOT.airport[0], SPOT.airport[1]);
      m.objective(194);
      const bl = m.blip(ax, az);
      g.setWaypoint(ax, az);
      m.hint = { type: 'goto', x: ax, z: az, vehicle: limo };
      const atAirport = () => g.player.vehicle === limo && Math.hypot(limo.pos.x - ax, limo.pos.z - az) < 14;
      await m.until(() => limo.health <= 0 || !g.player.vehicle || atAirport());
      m.unblip(bl);
      g.waypoint = null; g.hud.route = null;
      if (!atAirport() && limo.health > 0) {
        m.hint = { type: 'escape', chasers: [limo] };
        m.objective(195);
        await m.until(() => limo.health <= 0);
      }
      if (g.player.vehicle) await m.exitVehicle();
      const fam = await cast(m, [['LC', 'char_lc'], ['乔伊', 'char_joey'], ['贝蒂', 'char_betty', 'female']], g.player.pos.x, g.player.pos.z);
      void fam;
      const ve = voice('CH4_M_08_END');
      await m.say([['强尼', 196, ve()], ['LC', 197, ve()], ['乔伊', 198, ve()], ['强尼', 199, ve()], ['LC', 200, ve()], ['乔伊', 201, ve()],
        ['强尼', 202, ve()], ['乔伊', 203, ve()], ['强尼', 204, ve()], ['乔伊', 205, ve()], ['贝蒂', 206, ve()]]);
    },
  },
];
