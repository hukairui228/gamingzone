import { Pursuit } from '../police.js';
import { voice } from './util.js';

// Chapter 2 — "迈阿密一等通缉": every line comes from public/assets/text/ch2.chinese.json by index,
// voices are cin_ch2_m_NN_{intro,middle,end}_XX in dialogue order.

// ------------------------------------------------------------------ shared helpers (also used by ch3.js)
export const LOC = {
  betty: [-387.8, -470], kiddush: [43.1, -200], vega: [709.1, -248], haiti: [-280, -520], design: [60, -560],
  police: [-178, -205], port: [250, 230], slaughter: [-241.4, -725], swamp: [-813, 240], swamp2: [-705, 6],
  lcHotel: [741.2, 100.3], villa: [347, 10], albert: [-20, 40], airport: [-600, -250],
};

/** sidewalk/road point near (x,z), shifted ds metres along the road; off: 0 road centre, ±1 preferred sidewalk side.
 *  Falls back to the other side / the road centre when a sidewalk point has no ground or sits on a structure. */
export function spot(m, x, z, off = 1, ds = 0) {
  const R = m.g.roads, W = m.g.world, n = R.nearest(x, z, 400);
  if (!n) return [x, z, 0];
  const e = R.edges[n.e], s = Math.max(0, Math.min(e.length, n.s + ds));
  const c = R.point(e, 1, s, 0, {});
  const hc = W.height(c.x, c.z, 8);
  for (const k of off ? [Math.sign(off), -Math.sign(off)] : []) {
    const p = R.point(e, 1, s, R.sidewalkOffset(e) * k, {});
    const h = W.height(p.x, p.z, 8);
    if (h > -Infinity && Math.abs(h - hc) < 1.2) return [p.x, p.z, Math.atan2(p.tx, p.tz)];
  }
  return [c.x, c.z, Math.atan2(c.tx, c.tz)];
}

/** nearest walkable ground below roof level (used off the road network, e.g. the swamp) */
export function land(m, x, z) {
  const W = m.g.world;
  for (let r = 0; r < 120; r += 4) {
    for (let a = 0; a < 6.28; a += r ? 4 / r : 7) {
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r, h = W.height(px, pz, 8, 0);
      if (h > 0.2) return [px, pz];
    }
  }
  return [x, z];
}

/** open water (no ground within ~8 m) nearest to (x,z) */
export function water(m, x, z) {
  const W = m.g.world;
  const wet = (px, pz) => !(W.height(px, pz, 2, 0) > -1.2);
  for (let r = 0; r < 400; r += 6) {
    for (let a = 0; a < 6.28; a += r ? 6 / r : 7) {
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (wet(px, pz) && wet(px + 9, pz) && wet(px - 9, pz) && wet(px, pz + 9) && wet(px, pz - 9)) return [px, pz];
    }
  }
  return [x, z];
}

/** a custom objective; the autopilot test can complete it through the hint proxy */
export function custom(m, text, pred, pos) {
  if (text != null) m.objective(text);
  const proxy = { health: 100, pos: pos || m.g.focus };
  m.hint = { type: 'beat', p: proxy, threshold: 0 };
  return m.until((dt) => proxy.health < 0 || pred(dt));
}

/** destroy vehicles (shoot / ram / rockets) */
export async function destroy(m, cars, text) {
  const g = m.g;
  if (text != null) m.objective(text);
  const proxies = cars.map((v) => ({ pos: v.pos, dead: false, kind: 'civ', play() {}, c: { overlay() {} }, onDeath() { if (!v.exploded) g.explodeVehicle(v); } }));
  m.hint = { type: 'kill', peds: proxies };
  const bl = cars.map((v) => () => (v.health > 0 ? { x: v.pos.x, z: v.pos.z, color: '#ff2a2a' } : null));
  m.blipList.push(...bl);
  await m.until(() => cars.every((v) => v.health <= 0 || v.exploded));
  for (const b of bl) m.unblip(b);
}

/** hostile squad spread along the road near (x,z) */
export async function squad(m, models, x, z, n, opts = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const model = models[i % models.length];
    let px, pz;
    if (opts.raw) [px, pz] = land(m, x + Math.cos(i * 2.1) * (4 + i * 1.5), z + Math.sin(i * 2.1) * (4 + i * 1.5));
    else [px, pz] = spot(m, x, z, i % 2 ? 1 : -1, (i - n / 2) * 5);
    out.push(await m.spawnPed(model, px, pz, { kind: opts.kind || 'gang', hostile: opts.hostile ?? true, weapon: opts.weapon || 'beretta', health: opts.health, yaw: Math.random() * 6 }));
  }
  return out;
}

/** friendly character standing at a point */
export function ally(m, model, x, z, sex = 'male', yaw = 0) {
  return m.spawnPed(model, x, z, { kind: 'ally', sex, yaw, idle: sex === 'female' ? 'sl__civilian_female__idle' : 'sl__civilian_male__idle' });
}

/** tail a car to its destination without losing it */
export async function follow(m, v, dest, text) {
  const g = m.g;
  if (text != null) m.objective(text);
  const purs = new Pursuit(g, v);
  let arrived = false;
  m.check((dt) => {
    if (m.following !== v) return null;
    if (!arrived && Math.hypot(v.pos.x - dest[0], v.pos.z - dest[1]) < 15) arrived = true;
    if (arrived) { v.vf *= 0.9; v.update(dt, { throttle: 0, steer: 0, handbrake: true }, g.world); } else purs.update(dt, dest[0], dest[1], { maxSpeed: 0.62 });
    const d = Math.hypot(v.pos.x - g.focus.x, v.pos.z - g.focus.z);
    const nearDest = Math.hypot(g.focus.x - dest[0], g.focus.z - dest[1]) < 30;
    return d > 170 && !nearDest ? m.T(['global', 93]) : null;
  });
  m.following = v;
  const b = () => ({ x: v.pos.x, z: v.pos.z, color: '#ff2a2a' });
  m.blipList.push(b);
  m.hint = { type: 'goto', x: dest[0], z: dest[1] };
  await m.until(() => (arrived && Math.hypot(v.pos.x - g.focus.x, v.pos.z - g.focus.z) < 60) || Math.hypot(g.focus.x - dest[0], g.focus.z - dest[1]) < 20);
  m.unblip(b);
  m.following = null;
}

/** enemy boats ram after the player on the water */
export function boatChase(m, boats) {
  const g = m.g;
  m.check((dt) => {
    for (const b of boats) {
      if (b.health <= 0 || m.chaseOff) continue;
      const t = g.focus, dx = t.x - b.pos.x, dz = t.z - b.pos.z;
      let err = Math.atan2(dx, dz) - b.yaw; err = Math.atan2(Math.sin(err), Math.cos(err));
      b.update(dt, { throttle: Math.hypot(dx, dz) < 8 ? 0.3 : 1, steer: Math.max(-1, Math.min(1, -err * 2)) }, g.world);
    }
    return null;
  });
}

/** keep a passenger in the car while the player drives fast enough for `sec` seconds */
export function scareRide(m, car, text, sec = 10, minSpeed = 16) {
  const g = m.g;
  let t = 0;
  return custom(m, text, (dt) => {
    const v = g.player.vehicle;
    if (v && (!car || v === car) && v.speed > minSpeed) t += dt;
    g.hud.timer(sec - t);
    if (t >= sec) { g.hud.timer(null); return true; }
    return false;
  });
}

/** stand still at a spot for a few seconds (plant bombs / cameras, grab files) */
export function plant(m, x, z, text, sec = 2.5, sfx = 'sfx_grenade_arm') {
  const g = m.g;
  let t = 0;
  return custom(m, text, (dt) => {
    if (Math.hypot(g.focus.x - x, g.focus.z - z) < 4 && !g.player.vehicle) t += dt; else t = 0;
    if (t >= sec) { g.audio.play(sfx, { vol: 0.8 }); return true; }
    return false;
  }, { x, z });
}

const v2 = (n, part) => voice(`CH2_M_${String(n).padStart(2, '0')}_${part}`);

// ------------------------------------------------------------------ chapter 2
export const CH2 = [
  {
    id: 'ch2_m01', chapter: 2, file: 'ch2', title: '高速路出口', reward: 2000,
    giver: LOC.vega,
    async run(m) {
      const g = m.g, vi = v2(1, 'INTRO'), vm = v2(1, 'MIDDLE'), ve = v2(1, 'END');
      const [hx, hz] = spot(m, ...LOC.vega, 1);
      const betty = await ally(m, 'char_betty', ...spot(m, hx, hz, 1, 1.5).slice(0, 2), 'female');
      m.protect(betty, ['global', 327]);
      await m.say([['强尼', 7, vi()], ['贝蒂', 8, vi()], ['强尼', 9, vi()], ['贝蒂', 10, vi()], ['强尼', 11, vi()], ['贝蒂', 12, vi()],
        ['强尼', 13, vi()], ['贝蒂', 14, vi()], ['强尼', 15, vi()]]);
      const cops = await squad(m, ['char_skinny_cop', 'char_fat_cop'], hx, hz + 25, 4, { kind: 'cop', weapon: 'beretta' });
      await m.say([['警察', 16, vi()], ['贝蒂', 17, vi()], ['贝蒂', 18, vi()]]);
      g.police.crime('hitcop', { x: hx, z: hz });
      let t = 0, said = false;
      await custom(m, 19, (dt) => {
        t += dt; g.hud.timer(35 - t);
        if (!said && t > 18) { said = true; g.hud.notify(m.T(20), 3); g.audio.play(vm(), { vol: 0.9 }); }
        return t >= 35 || cops.every((c) => c.dead);
      });
      g.hud.timer(null);
      await m.say([['贝蒂', 21, vm()]]);
      betty.follow = true;
      const [bx, bz] = water(m, 600, -250);
      const boat = await m.spawnCar('boat_speedboat_cigar', bx, bz, -Math.PI / 2);
      await m.getIn(boat, 23);
      await m.loseWanted(24);
      const [dx, dz] = water(m, 120, -120);
      await m.goto(dx, dz, { r: 25, text: 25, vehicle: boat });
      await m.say([['强尼', 27, ve()], ['贝蒂', 28, ve()], ['强尼', 29, ve()], ['贝蒂', 30, ve()], ['强尼', 31, ve()]]);
    },
  },
  {
    id: 'ch2_m02', chapter: 2, file: 'ch2', title: '“自首”', reward: 2500,
    giver: LOC.betty,
    async run(m) {
      const g = m.g, vi = v2(2, 'INTRO'), vm = v2(2, 'MIDDLE'), ve = v2(2, 'END');
      m.noWanted = true;
      const [bx, bz] = spot(m, ...LOC.betty, 1);
      await ally(m, 'char_betty', ...spot(m, bx, bz, 1, 1.5).slice(0, 2), 'female');
      await m.say([['强尼', 35, vi()], ['贝蒂', 36, vi()]]);
      const [px, pz, pyaw] = spot(m, ...LOC.police, 1);
      await m.goto(px, pz, { r: 8, text: 37 });
      const det = await m.spawnPed('char_fbi', ...spot(m, px, pz, 1, 6).slice(0, 2), { kind: 'civ', yaw: pyaw + Math.PI });
      await m.say([['探长', 38, vm()], ['强尼', 39, vm()], ['探长', 40, vm()], ['强尼', 41, vm()], ['探长', 42, vm()], ['强尼', 43, vm()], ['强尼', 44, vm()]]);
      // he bolts down the street
      det.ai = (dt) => {
        const dx = det.pos.x - g.player.pos.x, dz = det.pos.z - g.player.pos.z, l = Math.hypot(dx, dz) || 1;
        g.peds.moveTo(det, det.pos.x + dx / l * 4, det.pos.z + dz / l * 4, 4.2, dt);
        det.play(det.clip('run'));
      };
      const b = () => ({ x: det.pos.x, z: det.pos.z, color: '#ff2a2a' });
      m.blipList.push(b);
      await custom(m, 45, () => Math.hypot(det.pos.x - g.player.pos.x, det.pos.z - g.player.pos.z) < 2.5);
      m.unblip(b);
      det.ai = (dt) => m.pedAI(det, dt);
      await m.beat(det, 46);
      const [cx, cz, cyaw] = spot(m, det.pos.x, det.pos.z, 0, 8);
      const car = await m.spawnCar('car_police_rich', cx, cz, cyaw);
      await m.getIn(car, 47);
      det.follow = true; det.hostile = false;
      await scareRide(m, car, 48, 12);
      const [dx, dz] = spot(m, ...LOC.port, 0);
      await m.goto(dx, dz, { r: 12, text: 49, vehicle: car });
      await m.exitVehicle();
      det.follow = false;
      det.pos.set(car.pos.x + Math.cos(car.yaw) * 2, car.pos.y, car.pos.z - Math.sin(car.yaw) * 2);
      await m.say([['强尼', 50, ve()], ['探长', 51, ve()], ['强尼', 52, ve()], ['探长', 53, ve()], ['强尼', 54, ve()], ['探长', 55, ve()]]);
    },
  },
  {
    id: 'ch2_m03', chapter: 2, file: 'ch2', title: '派对礼物', reward: 3000,
    giver: LOC.betty,
    async run(m) {
      const g = m.g, vi = v2(3, 'INTRO'), vm = v2(3, 'MIDDLE'), ve = v2(3, 'END');
      const [bx, bz] = spot(m, ...LOC.betty, 1);
      await ally(m, 'char_betty', ...spot(m, bx, bz, 1, 1.5).slice(0, 2), 'female');
      await m.say([['强尼', 59, vi()], ['贝蒂', 60, vi()], ['强尼', 61, vi()], ['贝蒂', 62, vi()], ['强尼', 63, vi()], ['贝蒂', 64, vi()],
        ['强尼', 65, vi()], ['贝蒂', 66, vi()]]);
      const [kx, kz] = spot(m, ...LOC.kiddush, 1);
      await m.goto(kx, kz, { r: 6, text: 67 });
      await ally(m, 'char_herman', ...spot(m, kx, kz, 1, 3).slice(0, 2));
      await ally(m, 'char_mafia_a', ...spot(m, kx, kz, 1, 6).slice(0, 2));
      await m.say([['赫尔曼', 68, vm()], ['强尼', 69, vm()], ['赫尔曼', 70, vm()], ['强尼', 71, vm()], ['赫尔曼', 72, vm()], ['强尼', 73, vm()],
        ['赫尔曼', 74, vm()], ['赫尔曼', 75, vm()], ['强尼', 76, vm()], ['赫尔曼', 77, vm()]]);
      const [hx, hz] = spot(m, ...LOC.port, 1);
      await m.goto(hx, hz, { r: 15, text: 78 });
      const guards = await squad(m, ['char_cubangang_1', 'char_cubangang_2'], hx, hz, 3, { hostile: false, weapon: 'uzi' });
      const [bombX, bombZ] = spot(m, hx, hz, 1, 10);
      const mk = await m.marker(bombX, bombZ, 'checkpoint_walk');
      await plant(m, bombX, bombZ, 79, 3);
      m.removeMarker(mk);
      for (const p of guards) p.hostile = true;
      const [safeX, safeZ] = spot(m, bombX, bombZ, 0, -70);
      await m.goto(safeX, safeZ, { r: 10, text: 80 });
      g.explode(bombX, g.world.height(bombX, bombZ, 8) + 1, bombZ, 14, 500);
      await m.wait(1.5);
      await m.say([['强尼', 81, ve()], ['赫尔曼', 82, ve()], ['强尼', 83, ve()]]);
    },
  },
  {
    id: 'ch2_m04', chapter: 2, file: 'ch2', title: '盆景爱好者小海地', reward: 3500,
    giver: LOC.kiddush,
    async run(m) {
      const g = m.g, vi = v2(4, 'INTRO'), vm = v2(4, 'MIDDLE'), ve = v2(4, 'END');
      const [kx, kz] = spot(m, ...LOC.kiddush, 1);
      await ally(m, 'char_herman', ...spot(m, kx, kz, 1, 1.5).slice(0, 2));
      await m.say([['赫尔曼', 87, vi()], ['赫尔曼', 88, vi()], ['强尼', 89, vi()], ['强尼', 90, vi()], ['强尼', 91, vi()], ['赫尔曼', 92, vi()], ['赫尔曼', 93, vi()]]);
      const [cx, cz, cyaw] = spot(m, kx, kz, 0, 10);
      await m.spawnCar('car_homm_black', cx, cz, cyaw);
      const [hx, hz] = spot(m, ...LOC.haiti, 1);
      await m.goto(hx, hz, { r: 10, text: 94, car: true });
      const moishe = await ally(m, 'char_mafia_b', ...spot(m, hx, hz, 1, 3).slice(0, 2));
      m.protect(moishe, ['global', 332]);
      await m.say([['莫伊舍', 95, vm()], ['莫伊舍', 96, vm()], ['强尼', 97, vm()], ['莫伊舍', 98, vm()], ['强尼', 99, vm()], ['莫伊舍', 100, vm()]]);
      const [vx, vz, vyaw] = spot(m, hx, hz, 0, 45);
      const van = await m.spawnCar('car_van_white', vx, vz, vyaw, { health: 600 });
      const guards = await squad(m, ['char_northcuban_1', 'char_northcuban_2', 'char_girlgang_a'], vx, vz, 4, { hostile: false, weapon: 'beretta' });
      m.check(() => { if (Math.hypot(g.focus.x - vx, g.focus.z - vz) < 30) for (const p of guards) p.hostile = true; return null; });
      await destroy(m, [van], 101);
      for (const p of guards) p.hostile = true;
      await m.killAll(guards, 102);
      moishe.follow = true;
      await m.goto(kx, kz, { r: 8, text: 103 });
      moishe.follow = false;
      await m.say([['赫尔曼', 104, ve()], ['强尼', 105, ve()]]);
    },
  },
  {
    id: 'ch2_m05', chapter: 2, file: 'ch2', title: '空中景观', reward: 4000,
    giver: LOC.kiddush,
    async run(m) {
      const g = m.g, vi = v2(5, 'INTRO'), ve = v2(5, 'END');
      const [kx, kz] = spot(m, ...LOC.kiddush, 1);
      await ally(m, 'char_herman', ...spot(m, kx, kz, 1, 1.5).slice(0, 2));
      await m.say([['赫尔曼', 109, vi()], ['赫尔曼', 110, vi()], ['强尼', 111, vi()], ['赫尔曼', 112, vi()], ['强尼', 113, vi()], ['赫尔曼', 114, vi()], ['强尼', 115, vi()]]);
      const [px, pz, pyaw] = spot(m, ...LOC.police, 0);
      await m.goto(px, pz, { r: 12, text: 116 });
      const [hx, hz] = spot(m, px, pz, 0, 25);
      const heli = await m.spawnCar('heli_police', hx, hz, pyaw);
      m.protect(heli, ['global', 322]);
      await m.getIn(heli, 117);
      const [jx, jz] = spot(m, ...LOC.haiti, 0);
      await m.goto(jx, jz, { r: 45, text: 118, vehicle: heli });
      const cops = await squad(m, ['char_skinny_cop', 'char_fat_cop'], jx, jz, 4, { kind: 'cop', weapon: 'beretta' });
      await m.killAll(cops, 119);
      await custom(m, 120, () => heli.onGround && heli.speed < 3 && Math.hypot(heli.pos.x - jx, heli.pos.z - jz) > 60);
      await m.loseWanted(121);
      await m.say([['强尼', 122, ve()], ['赫尔曼', 123, ve()]]);
    },
  },
  {
    id: 'ch2_m06', chapter: 2, file: 'ch2', title: '螳臂当车', reward: 4500,
    giver: LOC.kiddush,
    async run(m) {
      const g = m.g, vi = v2(6, 'INTRO'), ve = v2(6, 'END');
      const [kx, kz] = spot(m, ...LOC.kiddush, 1);
      await ally(m, 'char_herman', ...spot(m, kx, kz, 1, 1.5).slice(0, 2));
      await m.say([['强尼', 127, vi()], ['赫尔曼', 128, vi()], ['强尼', 129, vi()], ['赫尔曼', 130, vi()], ['强尼', 131, vi()], ['赫尔曼', 132, vi()],
        ['赫尔曼', 133, vi()], ['赫尔曼', 134, vi()], ['强尼', 135, vi()]]);
      const [bx, bz] = water(m, 150, -120);
      const boat = await m.spawnCar('boat_speedboat_riva', bx, bz, 0);
      await m.getIn(boat, 136);
      const [sx, sz] = water(m, 400, 40);
      const cargo = await m.spawnCar('boat_speedboat_yacht', sx, sz, Math.PI);
      await m.goto(sx, sz, { r: 18, text: 137, vehicle: boat });
      g.audio.play('sfx_pickup_star', { vol: 0.8 });
      cargo.health = 0;
      const chasers = [];
      for (const [ox, oz] of [[sx + 60, sz + 30], [sx - 50, sz - 40]]) {
        const [wx, wz] = water(m, ox, oz);
        chasers.push(await m.spawnCar('boat_speedboat_police', wx, wz, 0, { driver: 'npc' }));
      }
      boatChase(m, chasers);
      await m.escape(chasers, 150, 138);
      m.chaseOff = true;
      const [ax, az] = water(m, -820, -200);
      await m.goto(ax, az, { r: 30, text: 139, vehicle: boat });
      await m.say([['强尼', 140, ve()], ['接头人', 141, ve()], ['强尼', 142, ve()], ['强尼', 143, ve()], ['赫尔曼', 144, ve()], ['强尼', 145, ve()]]);
    },
  },
  {
    id: 'ch2_m07', chapter: 2, file: 'ch2', title: '一言胜千言', reward: 4000,
    giver: LOC.betty,
    async run(m) {
      const g = m.g, vi = v2(7, 'INTRO'), vm = v2(7, 'MIDDLE'), ve = v2(7, 'END');
      const [bx, bz] = spot(m, ...LOC.betty, 1);
      await ally(m, 'char_betty', ...spot(m, bx, bz, 1, 1.5).slice(0, 2), 'female');
      await m.say([['贝蒂', 149, vi()], ['贝蒂', 150, vi()], ['强尼', 151, vi()], ['贝蒂', 152, vi()], ['强尼', 153, vi()], ['贝蒂', 154, vi()],
        ['强尼', 155, vi()], ['贝蒂', 156, vi()], ['强尼', 157, vi()]]);
      const [gx, gz, gyaw] = spot(m, -300, -560, 1);
      await m.goto(...spot(m, gx, gz, 0, -70).slice(0, 2), { r: 12, text: 158 });
      const gang = await squad(m, ['char_northcuban_1', 'char_northcuban_2', 'char_northcuban_girl'], gx, gz, 3, { hostile: false });
      const [cx, cz] = spot(m, gx, gz, 0, 6);
      const car = await m.spawnCar('car_suv_detour', cx, cz, gyaw, { driver: 'npc' });
      await m.goto(...spot(m, gx, gz, -1, -32).slice(0, 2), { r: 5, text: 159 });
      // photographs: aim the camera at each member and press fire / aim
      const pl = g.player;
      const keep = pl.weapon;
      pl.weapon = 'fist'; pl.showWeapon();
      const shot = new Set();
      let cool = 0;
      await custom(m, 160, (dt) => {
        cool -= dt;
        if (cool > 0 || !(g.ctl.fire || g.ctl.aim)) return false;
        const cam = g.camera.cam, o = cam.position, d = { x: 0, y: 0, z: 0 };
        const dir = cam.getWorldDirection(new o.constructor());
        for (const p of gang) {
          if (shot.has(p)) continue;
          d.x = p.pos.x - o.x; d.y = p.pos.y + 1.3 - o.y; d.z = p.pos.z - o.z;
          const L = Math.hypot(d.x, d.y, d.z);
          if (L < 80 && (d.x * dir.x + d.y * dir.y + d.z * dir.z) / L > 0.97) {
            shot.add(p); cool = 0.8;
            g.audio.play('sfx_camera_clic', { vol: 0.9 });
            g.hud.notify(m.T(['global', 96]), 1.2);
            break;
          }
        }
        return shot.size >= gang.length;
      }, { x: gx, z: gz });
      pl.weapon = keep; pl.showWeapon();
      for (const p of gang) g.peds.remove(p);
      await m.say([['贝蒂', 161, vm()]]);
      const dest = spot(m, ...LOC.port, 0);
      await follow(m, car, dest, 162);
      await m.goto(...spot(m, dest[0], dest[1], 1, 12).slice(0, 2), { r: 6, text: 163 });
      await m.say([['强尼', 164, ve()], ['贝蒂', 165, ve()]]);
    },
  },
  {
    id: 'ch2_m08', chapter: 2, file: 'ch2', title: '盗取软件', reward: 4000,
    giver: LOC.betty,
    async run(m) {
      const g = m.g, vi = v2(8, 'INTRO'), vm = v2(8, 'MIDDLE'), ve = v2(8, 'END');
      const [bx, bz] = spot(m, ...LOC.betty, 1);
      await ally(m, 'char_betty', ...spot(m, bx, bz, 1, 1.5).slice(0, 2), 'female');
      await m.say([['强尼', 169, vi()], ['贝蒂', 170, vi()], ['强尼', 171, vi()], ['贝蒂', 172, vi()], ['强尼', 173, vi()], ['贝蒂', 174, vi()], ['强尼', 175, vi()]]);
      const [px, pz] = spot(m, ...LOC.police, 1);
      await m.goto(px, pz, { r: 6, text: 176 });
      const [fx, fz] = spot(m, px, pz, 1, 9);
      const mk = await m.marker(fx, fz, 'checkpoint_briefcase');
      await plant(m, fx, fz, null, 3, 'sfx_pickup_star');
      m.removeMarker(mk);
      await m.say([['强尼', 177, vm()]]);
      g.police.crime('hitcop', { x: px, z: pz });
      g.police.crime('hitcop', { x: px, z: pz });
      await m.loseWanted(178);
      await m.goto(bx, bz, { r: 6, text: 179 });
      await m.say([['强尼', 180, ve()], ['贝蒂', 181, ve()]]);
    },
  },
  {
    id: 'ch2_m09', chapter: 2, file: 'ch2', title: '一加一等于二', reward: 5000,
    giver: LOC.betty,
    async run(m) {
      const vi = v2(9, 'INTRO'), ve = v2(9, 'END');
      const [bx, bz] = spot(m, ...LOC.betty, 1);
      await ally(m, 'char_betty', ...spot(m, bx, bz, 1, 1.5).slice(0, 2), 'female');
      await m.say([['强尼', 185, vi()], ['贝蒂', 186, vi()], ['强尼', 187, vi()], ['贝蒂', 188, vi()], ['贝蒂', 189, vi()], ['强尼', 190, vi()]]);
      const [wx, wz] = water(m, -480, -560);
      const boat = await m.spawnCar('boat_seadoo', wx, wz, 0);
      await m.getIn(boat, 191);
      const sites = [
        [water(m, 610, -250), 192, true], [spot(m, ...LOC.design, 1), 193], [spot(m, ...LOC.haiti, 1), 194],
        [spot(m, -60, -330, 1), 195], [spot(m, 120, -380, 1), 196]];
      for (const [[x, z], text, byBoat] of sites) {
        if (byBoat) await m.goto(x, z, { r: 20, text, vehicle: boat });
        else {
          await m.goto(x, z, { r: 4, text });
          await plant(m, x, z, text, 1.5, 'sfx_camera_clic');
        }
      }
      await m.say([['强尼', 197, ve()], ['贝蒂', 198, ve()]]);
    },
  },
  {
    id: 'ch2_m10', chapter: 2, file: 'ch2', title: '谁动了我兄弟', reward: 5000,
    giver: LOC.betty,
    async run(m) {
      const g = m.g, vi = v2(10, 'INTRO'), vm = v2(10, 'MIDDLE'), ve = v2(10, 'END');
      const [bx, bz, byaw] = spot(m, ...LOC.betty, 1);
      await ally(m, 'char_betty', ...spot(m, bx, bz, 1, 1.5).slice(0, 2), 'female');
      const [cx, cz, cyaw] = spot(m, bx, bz, 0, 10);
      await m.spawnCar('car_plymouth_barracuda', cx, cz, cyaw || byaw);
      await m.say([['强尼', 202, vi()], ['贝蒂', 203, vi()], ['贝蒂', 204, vi()], ['强尼', 205, vi()], ['强尼', 206, vi()]]);
      const [rx, rz] = spot(m, ...LOC.design, 1);
      await m.goto(rx, rz, { r: 10, text: 207, car: true });
      const reg = await m.spawnPed('char_reginald', ...spot(m, rx, rz, 1, 4).slice(0, 2), { kind: 'civ' });
      await m.say([['雷金纳德', 208, vm()], ['强尼', 209, vm()], ['雷金纳德', 210, vm()], ['强尼', 211, vm()], ['雷金纳德', 212, vm()],
        ['强尼', 213, vm()], ['雷金纳德', 214, vm()], ['强尼', 215, vm()]]);
      reg.follow = true;
      await scareRide(m, null, 216, 12);
      g.police.crime('runover', g.focus);
      await m.loseWanted(217);
      await m.exitVehicle();
      reg.follow = false;
      reg.pos.set(g.player.pos.x + 1.5, g.player.pos.y, g.player.pos.z + 1);
      await m.beat(reg, 218);
      await m.say([['雷金纳德', 219, ve()], ['强尼', 220, ve()], ['雷金纳德', 221, ve()], ['强尼', 222, ve()], ['雷金纳德', 223, ve()],
        ['强尼', 224, ve()], ['雷金纳德', 225, ve()]]);
    },
  },
  {
    id: 'ch2_m11', chapter: 2, file: 'ch2', title: '最后一笑', reward: 6000,
    giver: LOC.betty,
    async run(m) {
      const g = m.g, vi = v2(11, 'INTRO'), ve = v2(11, 'END');
      const [bx, bz] = spot(m, ...LOC.betty, 1);
      const betty = await ally(m, 'char_betty', ...spot(m, bx, bz, 1, 1.5).slice(0, 2), 'female');
      m.protect(betty, ['global', 327]);
      await m.say([['强尼', 229, vi()], ['贝蒂', 230, vi()], ['强尼', 231, vi()], ['贝蒂', 232, vi()], ['强尼', 233, vi()], ['贝蒂', 234, vi()],
        ['强尼', 235, vi()], ['贝蒂', 236, vi()], ['强尼', 237, vi()]]);
      betty.follow = true;
      const [sx, sz] = spot(m, ...LOC.slaughter, 1);
      await m.goto(sx, sz, { r: 12, text: 238 });
      const guards = await squad(m, ['char_redneck', 'char_biker', 'char_civ_trash_1'], sx, sz, 5, { weapon: 'uzi' });
      await m.killAll(guards, 239);
      await ally(m, 'char_herman', ...spot(m, sx, sz, -1, 6).slice(0, 2));
      await m.say([['赫尔曼', 240, ve()], ['贝蒂', 241, ve()]]);
      g.audio.play('sfx_combat_hit', { vol: 1 });
      g.hud.damageFlash(1);
      await m.wait(1);
    },
  },
];
