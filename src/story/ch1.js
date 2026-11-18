import * as THREE from 'three';
import { Pursuit } from '../police.js';
import { voice, road } from './util.js';

// Chapter 1 "城里新来的小子", scripted from the original Chinese text table (public/assets/text/ch1.chinese.json).
// Every number passed to say()/objective()/caption() is a line index in that table; ['global', n] uses global.chinese.json.
// Voice clips cin_ch1_mNN_* follow each mission's dialogue lines in order.

const G = (i) => ['global', i];

// Locations (world metres) picked from the original minimap; water points verified as open water connected to the sea.
const P = {
  start: [-300, -790],
  gas: [-95, -640], // Albert's gas station / garage
  betty: [-400, -497],
  chew: [-255, -365],
  swampLand: [-677, 252], swampWater: [-686, 252], // dock on the mainland edge of the swamp
  roscoeLand: [-746, 21], roscoeWater: [-746, 33], roscoe: [-744, 12], // Roscoe's island hideout
  hank: [-820, 160],
  funeral: [-480, 380],
  hideout: [-60, -30],
  gunshop: [-240, -150],
  portEntry: [95, 108],
  pierLand: [231, 116], pierWater: [222, 116],
  bridgeWater: [302, 20], bridgeDeck: [302, 9],
  store: [-120, -250],
  albert: [150, 140], vantage: [190, 165],
  truckStart: [290, 215], warehouse: [120, 160],
  warehouse2: [330, 250], hide: [305, 228],
  docLand: [-179, 407], docWater: [-174, 416],
  havana: [-450, 250], roof: [-430, 235], havanaGang: [-470, 205],
  police: [-178, -205],
  hotel: [700, -30], beachLand: [797, -48], beachWater: [806, -48],
};

// ---------------------------------------------------------------- helpers

/** sidewalk point near (x,z) with verified street-level ground; falls back to the road centre */
function walk(m, x, z) {
  const w = m.g.world, floor = (a, b) => (w.floor ? w.floor(a, b) : w.height(a, b, 80));
  const s = road(m, x, z, 1);
  if (floor(s[0], s[1]) > -1) return s;
  return road(m, x, z);
}

/** wait on an arbitrary condition; exposes a skippable hint for the test autopilot */
async function custom(m, pred, onSkip) {
  const proxy = { health: 1 };
  m.hint = { type: 'beat', p: proxy, threshold: 0 };
  await m.until((dt) => {
    if (proxy.health < 0) { if (onSkip) onSkip(); return true; }
    return pred(dt);
  });
}

function addCheck(m, fn) {
  m.checks.push(fn);
  return () => { const i = m.checks.indexOf(fn); if (i >= 0) m.checks.splice(i, 1); };
}

/** checkpoint markers placed over open water get an infinite ground height: keep them at the surface */
function waterMarkers(m) {
  addCheck(m, () => {
    for (const mk of m.markers) if (!Number.isFinite(mk.obj.position.y)) mk.obj.position.y = 0.2;
    return null;
  });
}

const dist = (a, x, z) => Math.hypot(a.pos.x - x, a.pos.z - z);

/** step off a boat onto the nearby bank */
function disembark(m, x, z) {
  const g = m.g, v = g.player.vehicle;
  if (v) { v.vf = 0; v.vs = 0; }
  g.placePlayer(x, z, g.player.yaw);
}

function wanted(m, level) {
  const pol = m.g.police;
  pol.heat = Math.max(pol.heat, level + 0.5);
  pol.level = Math.floor(pol.heat);
}

function bark(m, name) { m.g.audio.play(name, { vol: 0.8 }); }

/** drive an AI vehicle along the roads toward a moving or fixed target */
function drive(m, v, target, { speed = 0.8, stopAt = 0 } = {}) {
  const g = m.g, purs = new Pursuit(g, v);
  return addCheck(m, (dt) => {
    if (v.health <= 0 || g.player.vehicle === v || v.stop) return null;
    const [tx, tz] = typeof target === 'function' ? target() : target;
    purs.update(dt, tx, tz, { maxSpeed: speed, stopAt });
    return null;
  });
}

/** steer a boat directly through open-water waypoints */
function sail(m, v, path, speed = 0.8) {
  const g = m.g;
  let i = 0;
  return addCheck(m, (dt) => {
    if (v.health <= 0 || g.player.vehicle === v || v.stop) return null;
    const [tx, tz] = path[Math.min(i, path.length - 1)];
    if (Math.hypot(tx - v.pos.x, tz - v.pos.z) < 12 && i < path.length - 1) i++;
    let err = Math.atan2(tx - v.pos.x, tz - v.pos.z) - v.yaw;
    err = Math.atan2(Math.sin(err), Math.cos(err));
    v.update(dt, { throttle: i >= path.length - 1 && Math.hypot(tx - v.pos.x, tz - v.pos.z) < 15 ? 0 : speed, steer: THREE.MathUtils.clamp(-err * 2, -1, 1), handbrake: false }, g.world);
    return null;
  });
}

/** swamp alligator: the model has no usable clips here, so it crawls in its rest pose */
async function gator(m, x, z) {
  const g = m.g;
  const p = await m.spawnPed('char_alligator', x, z, { kind: 'gang', hostile: true, health: 70, yaw: Math.random() * 6.28 });
  p.play = () => {};
  p.c.mixer.stopAllAction();
  p.cool = 1;
  p.onDeath = () => g.audio.play('sfx_alligator_killed', { vol: g.audioVol(p.pos, 0.9) });
  p.ai = (dt) => {
    const pl = g.player, d = dist(p, pl.pos.x, pl.pos.z);
    if (d > 35) return;
    if (!p.heard) { p.heard = true; g.audio.play('sfx_alligator_coming', { vol: g.audioVol(p.pos, 0.8) }); }
    if (d > 1.8) g.peds.moveTo(p, pl.pos.x, pl.pos.z, 2.6, dt);
    p.cool -= dt;
    if (d < 2.2 && p.cool <= 0 && !pl.vehicle) {
      p.cool = 1.3;
      g.audio.play('sfx_alligator_attack_' + (1 + Math.floor(Math.random() * 2)), { vol: 0.9 });
      pl.hurt(9, p.pos);
    }
  };
  return p;
}

/** photograph a character: aim the camera at them (aim or fire) within range */
async function photo(m, target, text) {
  const g = m.g, dir = new THREE.Vector3();
  m.objective(text);
  const b = () => (target.dead ? null : { x: target.pos.x, z: target.pos.z, color: '#ff2fb0', small: true });
  m.blipList.push(b);
  await custom(m, () => {
    if (g.player.vehicle || !(g.ctl.aim || g.ctl.fire)) return false;
    const cam = g.camera.cam;
    cam.getWorldDirection(dir);
    const tx = target.pos.x - cam.position.x, ty = target.pos.y + 1.5 - cam.position.y, tz = target.pos.z - cam.position.z;
    const l = Math.hypot(tx, ty, tz);
    return l < 70 && (dir.x * tx + dir.y * ty + dir.z * tz) / l > 0.97;
  });
  m.unblip(b);
  g.audio.play('sfx_camera_clic', { vol: 0.9 });
  g.hud.notify(g.t('global', 96), 2);
}

/** keep a vehicle within reach while it drives to dest */
async function tail(m, v, dest, { far = 140, text, speed = 0.6 } = {}) {
  const g = m.g;
  if (text != null) m.objective(text);
  const stop = drive(m, v, dest, { speed });
  const b = () => (v.health > 0 ? { x: v.pos.x, z: v.pos.z, color: '#3fd4ff' } : null);
  m.blipList.push(b);
  const lost = addCheck(m, () => (dist(v, g.focus.x, g.focus.z) > far ? g.t('global', 93) : null));
  await custom(m, () => dist(v, dest[0], dest[1]) < 16, () => v.place(dest[0], g.world.height(dest[0], dest[1], 80), dest[1], v.yaw));
  stop(); lost(); m.unblip(b);
  v.vf = 0; v.stop = true;
}

/** street race through checkpoints against an AI rival */
async function race(m, cps, rival, text) {
  const g = m.g;
  let ri = 0;
  const stop = drive(m, rival, () => cps[Math.min(ri, cps.length - 1)], { speed: 0.85 });
  const adv = addCheck(m, () => {
    if (ri < cps.length && dist(rival, cps[ri][0], cps[ri][1]) < 16) ri++;
    return ri >= cps.length ? '​' : null; // rival crossed the line first
  });
  m.blipList.push(() => ({ x: rival.pos.x, z: rival.pos.z, color: '#ff2a2a', small: true }));
  for (let i = 0; i < cps.length; i++) {
    await m.goto(cps[i][0], cps[i][1], { r: 12, car: true, text, model: i === cps.length - 1 ? 'checkpoint_race_end' : 'checkpoint_race' });
  }
  adv(); stop();
  rival.vf = 0; rival.stop = true;
}

// ---------------------------------------------------------------- chapter 1

export const CH1 = [
  {
    id: 'ch1_m00', chapter: 1, file: 'ch1', title: '前路漫漫……', reward: 300,
    giver: null, start: [-300, -790, Math.PI / 2],
    async run(m) {
      const g = m.g, v = voice('CH1_M00_TEXT');
      const [sx, sz, syaw] = road(m, ...P.start);
      g.placePlayer(sx, sz, syaw);
      await m.caption(18, 3); // 佛罗里达州，斯塔克市，前一天
      const [cx, cz, cyaw] = road(m, sx + 8, sz + 4);
      const car = await m.spawnCar('car_buck', cx, cz, cyaw);
      await m.say([['强尼', 7, v()], ['LC', 8, v()], ['强尼', 9, v()], ['LC', 10, v()], ['LC', 11, v()], ['强尼', 12, v()]]);
      await m.getIn(car, 13);
      await m.say([['强尼', 14, v()], ['强尼', 15, v()], ['强尼', 16, v()]]);
      await m.caption(19, 3); // 现在，迈阿密附近……
      const [gx, gz] = walk(m, ...P.gas);
      await m.goto(gx, gz, { r: 10, text: 17, car: true });
    },
  },
  {
    id: 'ch1_m01', chapter: 1, file: 'ch1', title: '迈阿密边界！', reward: 400,
    giver: P.gas,
    async run(m) {
      const g = m.g, v = voice('CH1_M01_TEXT');
      const [gx, gz, gyaw] = walk(m, ...P.gas);
      await m.caption(21, 2.5);
      const [cx, cz, cyaw] = road(m, gx + 6, gz - 3);
      const own = g.player.vehicle || await m.spawnCar('car_buck', cx, cz, cyaw);
      const albert = await m.spawnPed('char_mechanic', gx + 3, gz + 2, { kind: 'civ', yaw: gyaw + Math.PI });
      if (g.player.vehicle) await m.exitVehicle();
      await m.say([['强尼', 23, v()], ['阿尔伯特', 24, v()], ['强尼', 25, v()]]);
      // somebody trashes Johnny's car while he talks
      own.health = 80;
      g.fx.explosion(own.pos.x, own.pos.y, own.pos.z);
      g.audio.play('sfx_car_impact_hard');
      own.burnT = 30;
      await m.say([['强尼', 26, v()], ['强尼', 27, v()], ['阿尔伯特', 28, v()], ['强尼', 29, v()], ['强尼', 30, v()], ['强尼', 31, v()], ['阿尔伯特', 32, v()]]);
      const [px, pz, pyaw] = road(m, gx + 14, gz + 8);
      const prize = await m.spawnCar('car_tawny', px, pz, pyaw);
      await m.beat(albert, 33);
      m.protect(prize, G(322));
      await m.getIn(prize, 34);
      // Albert gives chase in his pickup
      const [ox, oz, oyaw] = road(m, gx - 18, gz - 12);
      const chaser = await m.spawnCar('car_truck', ox, oz, oyaw, { driver: 'npc' });
      drive(m, chaser, () => [g.focus.x, g.focus.z], { speed: 0.9 });
      m.blipList.push(() => (chaser.health > 0 ? { x: chaser.pos.x, z: chaser.pos.z, color: '#ff2a2a' } : null));
      await m.escape([chaser], 130, 35);
    },
  },
  {
    id: 'ch1_m02', chapter: 1, file: 'ch1', title: '嚼烟来了！', reward: 500,
    giver: P.betty,
    async run(m) {
      const g = m.g, v = voice('CH1_M02_TEXT');
      const [bx, bz, byaw] = walk(m, ...P.betty);
      const betty = await m.spawnPed('char_betty', bx + 1.5, bz, { kind: 'civ', sex: 'female', yaw: byaw });
      m.protect(betty, G(327));
      m.objective(38);
      await m.say([['贝蒂', 39, v()], ['强尼', 40, v()], ['贝蒂', 41, v()], ['强尼', 42, v()], ['贝蒂', 43, v()], ['强尼', 44, v()],
        ['贝蒂', 45, v()], ['强尼', 46, v()], ['贝蒂', 47, v()]]);
      const [sx, sz, syaw] = walk(m, ...P.chew);
      await m.goto(sx, sz, { r: 6, text: 48 });
      const thug = await m.spawnPed('char_biker', sx + 2.5, sz + 1, { kind: 'gang', yaw: syaw + Math.PI, idle: 'sl__civilian_male__chat_cross_arms' });
      await m.say([['小混混', 49, v()], ['强尼', 50, v()], ['小混混', 51, v()]]);
      await m.beat(thug, 52);
      g.audio.play('sfx_pickup_star', { vol: 0.7 });
      await m.goto(bx, bz, { r: 6, text: 53 });
      await m.say([['强尼', 54, v()], ['贝蒂', 55, v()], ['强尼', 56, v()], ['贝蒂', 57, v()], ['贝蒂', 58, v()]]);
    },
  },
  {
    id: 'ch1_m03', chapter: 1, file: 'ch1', title: '沼泽布吉乐', reward: 800,
    giver: P.swampLand,
    async run(m) {
      const g = m.g, v = voice('CH1_M03_TEXT');
      waterMarkers(m);
      m.objective(61);
      const betty = await m.spawnPed('char_betty', P.swampLand[0] + 1.5, P.swampLand[1] - 2, { kind: 'civ', sex: 'female' });
      const boat = await m.spawnCar('boat_floatingpoint_single', ...P.swampWater, -Math.PI / 2);
      await m.getIn(boat, G(104));
      g.peds.remove(betty);
      await m.goto(...P.roscoeWater, { r: 8, vehicle: boat });
      disembark(m, ...P.roscoeLand);
      const roscoe = await m.spawnPed('char_roscoe', ...P.roscoe, { kind: 'civ', yaw: Math.PI });
      await m.spawnPed('char_betty', P.roscoe[0] + 2, P.roscoe[1] + 1, { kind: 'civ', sex: 'female', yaw: Math.PI });
      m.protect(roscoe, G(330));
      await m.say([['贝蒂', 62, v()], ['罗斯科', 63, v()], ['强尼', 64, v()], ['罗斯科', 65, v()], ['强尼', 66, v()],
        ['罗斯科', 67, v()], ['罗斯科', 68, v()], ['罗斯科', 69, v()], ['强尼', 70, v()], ['罗斯科', 71, v()]]);
      g.player.give('beretta', 36);
      g.hud.notify(g.t('global', 69));
      const [hx, hz] = P.hank;
      const hank = await m.spawnPed('char_redneck', hx, hz, { kind: 'civ', idle: 'fl__npc__wavehand' });
      await m.goto(hx, hz, { r: 8, text: 72 });
      await m.say([['汉克', 73, v()]]);
      const gators = [];
      for (const [dx, dz] of [[8, 6], [-7, 9], [10, -6], [-9, -5]]) gators.push(await gator(m, hx + dx, hz + dz));
      m.protect(hank, G(87));
      await m.killAll(gators, 74);
      await m.say([['汉克', 75, v()]]);
    },
  },
  {
    id: 'ch1_m04', chapter: 1, file: 'ch1', title: '劫持灵车', reward: 1200,
    giver: P.swampLand,
    async run(m) {
      const g = m.g, vi = voice('CH1_M04_INTRO');
      await m.spawnPed('char_roscoe', P.swampLand[0] + 1.5, P.swampLand[1] - 1.5, { kind: 'civ', yaw: -Math.PI / 2 });
      await m.say([['罗斯科', 79, vi()], ['强尼', 80, vi()], ['罗斯科', 81, vi()], ['强尼', 82, vi()], ['罗斯科', 83, vi()],
        ['强尼', 84, vi()], ['罗斯科', 85, vi()], ['罗斯科', 86, vi()]]);
      const [fx, fz, fyaw] = road(m, ...P.funeral);
      const hearse = await m.spawnCar('car_hearse', fx, fz, fyaw);
      const mourners = [];
      for (const [i, mdl] of ['char_mafia_a', 'char_mafia_b', 'char_mafia_c'].entries())
        mourners.push(await m.spawnPed(mdl, fx + Math.cos(fyaw) * (4 + i * 1.5), fz - Math.sin(fyaw) * (4 + i * 1.5), { kind: 'gang', weapon: 'beretta', yaw: fyaw }));
      await m.goto(fx, fz, { r: 25, text: 87 });
      m.protect(hearse, G(324));
      await m.getIn(hearse, 88);
      for (const p of mourners) { p.hostile = true; }
      await m.say([['强尼', 89, voice('CH1_M04_MIDDLE_A')()]]);
      const chasers = [];
      for (const [k, mdl] of ['car_limo', 'car_homm_black'].entries()) {
        const [cx, cz, cyaw] = road(m, fx - 20 - k * 12, fz + 10);
        const c = await m.spawnCar(mdl, cx, cz, cyaw, { driver: 'npc' });
        drive(m, c, () => [g.focus.x, g.focus.z], { speed: 0.85 });
        m.blipList.push(() => (c.health > 0 ? { x: c.pos.x, z: c.pos.z, color: '#ff2a2a' } : null));
        chasers.push(c);
      }
      await m.escape(chasers, 140, 90);
      const vb = voice('CH1_M04_MIDDLE_B');
      await m.say([['强尼', 91, vb()], ['贝蒂', 92, vb()], ['贝蒂', 93, vb()], ['强尼', 94, vb()], ['贝蒂', 95, vb()]]);
      const [hx, hz] = walk(m, ...P.hideout);
      await m.goto(hx, hz, { r: 8, vehicle: hearse, text: 96 });
      await m.exitVehicle();
      await m.spawnPed('char_betty', hx + 2, hz + 1, { kind: 'civ', sex: 'female' });
      const ve = voice('CH1_M04_END');
      await m.say([['贝蒂', 97, ve()], ['贝蒂', 98, ve()], ['强尼', 99, ve()], ['贝蒂', 100, ve()]]);
    },
  },
  {
    id: 'ch1_m05', chapter: 1, file: 'ch1', title: '大船和坏蛋', reward: 1500,
    giver: P.swampLand,
    async run(m) {
      const g = m.g, vi = voice('CH1_M05_INTRO');
      waterMarkers(m);
      m.objective(103);
      await m.spawnPed('char_betty', P.swampLand[0] + 1.5, P.swampLand[1] - 1.5, { kind: 'civ', sex: 'female', yaw: -Math.PI / 2 });
      await m.say([['贝蒂', 104, vi()], ['强尼', 105, vi()], ['贝蒂', 106, vi()], ['强尼', 107, vi()], ['贝蒂', 108, vi()]]);
      const [sx, sz] = walk(m, ...P.gunshop);
      await m.goto(sx, sz, { r: 6, text: 109 });
      g.player.give('uzi', 90);
      g.audio.play('sfx_pickup_weapons', { vol: 0.7 });
      g.hud.notify(g.t('global', 23));
      const boat = await m.spawnCar('boat_speedboat_cigar', ...P.pierWater, Math.PI / 2);
      const [lx, lz] = P.pierLand;
      await m.goto(lx, lz, { r: 14, text: 110 });
      const thugs = [];
      for (const [i, mdl] of ['char_cubangang_1', 'char_cubangang_2', 'char_cubangang_1'].entries())
        thugs.push(await m.spawnPed(mdl, lx + 3 + i * 2, lz + (i - 1) * 3, { kind: 'gang', hostile: true, weapon: i === 1 ? 'uzi' : 'beretta' }));
      await m.say([['手下', 111, voice('CH1_M05_MID_A')()]]);
      await m.killAll(thugs, 112);
      await m.spawnPed('char_betty', lx - 2, lz - 2, { kind: 'civ', sex: 'female' });
      const vb = voice('CH1_M05_MID_B');
      await m.say([['贝蒂', 113, vb()], ['强尼', 114, vb()], ['贝蒂', 115, vb()], ['强尼', 116, vb()], ['贝蒂', 117, vb()]]);
      m.protect(boat, G(325));
      await m.getIn(boat, G(104));
      await m.goto(...P.swampWater, { r: 10, vehicle: boat, text: 118 });
      disembark(m, ...P.swampLand);
      await m.spawnPed('char_roscoe', P.swampLand[0] + 1.5, P.swampLand[1] - 1.5, { kind: 'civ', yaw: -Math.PI / 2 });
      const ve = voice('CH1_M05_END');
      await m.say([['罗斯科', 119, ve()], ['罗斯科', 120, ve()], ['强尼', 121, ve()]]);
    },
  },
  {
    id: 'ch1_m06', chapter: 1, file: 'ch1', title: '大桥之下', reward: 1500,
    giver: P.swampLand,
    async run(m) {
      const g = m.g, v = voice('CH1_M06_TEXT');
      waterMarkers(m);
      m.objective(124);
      await m.spawnPed('char_roscoe', P.swampLand[0] + 1.5, P.swampLand[1] - 1.5, { kind: 'civ', yaw: -Math.PI / 2 });
      await m.say([['罗斯科', 125, v()], ['强尼', 126, v()], ['罗斯科', 127, v()], ['罗斯科', 128, v()], ['罗斯科', 129, v()],
        ['强尼', 130, v()], ['罗斯科', 131, v()]]);
      const boat = await m.spawnCar('boat_speedboat_cigar', ...P.swampWater, -Math.PI / 2);
      await m.getIn(boat, 132);
      const [bx, bz] = P.bridgeWater;
      const theirs = await m.spawnCar('boat_speedboat_riva', bx + 14, bz + 4, Math.PI / 2, { health: 260 });
      await m.goto(bx, bz, { r: 14, vehicle: boat, text: 133 });
      const men = [];
      for (const [i, mdl] of ['char_mafia_a', 'char_mafia_b', 'char_mafia_c'].entries())
        men.push(await m.spawnPed(mdl, P.bridgeDeck[0] - 4 + i * 4, P.bridgeDeck[1] - 1, { kind: 'gang', weapon: i === 1 ? 'uzi' : 'beretta', yaw: 0 }));
      await m.say([['强尼', 134, v()], ['黑帮', 135, v()], ['黑帮', 136, v()], ['强尼', 137, v()], ['黑帮', 138, v()],
        ['强尼', 139, v()], ['黑帮', 140, v()]]);
      for (const p of men) p.hostile = true;
      await m.killAll(men, 141);
      await m.say([['强尼', 142, v()], ['贝蒂', 143, v()], ['强尼', 144, v()]]);
      m.objective(145);
      const b = () => (theirs.health > 0 ? { x: theirs.pos.x, z: theirs.pos.z, color: '#ff2a2a' } : null);
      m.blipList.push(b);
      await custom(m, () => theirs.health <= 0 || theirs.exploded, () => g.explodeVehicle(theirs));
      if (!theirs.exploded) g.explodeVehicle(theirs);
      m.unblip(b);
    },
  },
  {
    id: 'ch1_m07', chapter: 1, file: 'ch1', title: '强尼快跑！', reward: 2000,
    giver: P.betty,
    async run(m) {
      const g = m.g, v = voice('CH1_M07_TEXT');
      const [bx, bz, byaw] = walk(m, ...P.betty);
      const betty = await m.spawnPed('char_betty', bx + 1.5, bz, { kind: 'civ', sex: 'female', yaw: byaw });
      m.objective(148);
      await m.say([['贝蒂', 149, v()], ['强尼', 150, v()], ['贝蒂', 151, v()], ['强尼', 152, v()], ['贝蒂', 153, v()], ['贝蒂', 154, v()]]);
      const [cx, cz, cyaw] = road(m, bx + 6, bz + 6);
      const car = await m.spawnCar('car_vamp', cx, cz, cyaw);
      m.protect(car, G(322));
      await m.getIn(car, 155);
      m.objective(156);
      g.setWaypoint(...P.swampLand);
      const s0 = [g.focus.x, g.focus.z];
      await custom(m, () => Math.hypot(g.focus.x - s0[0], g.focus.z - s0[1]) > 180);
      // Betty is ambushed in town
      const [tx, tz, tyaw] = walk(m, ...P.store);
      betty.pos.set(tx, g.world.height(tx, tz, 80), tz);
      betty.root.visible = true;
      m.protect(betty, G(327));
      await m.say([['贝蒂', 157, v()]]);
      const thugs = [];
      for (const [i, mdl] of ['char_cubangang_1', 'char_cubangang_2', 'char_biker', 'char_cubangang_1'].entries())
        thugs.push(await m.spawnPed(mdl, tx + Math.cos(i * 1.6) * 7, tz + Math.sin(i * 1.6) * 7, { kind: 'gang', weapon: i % 2 ? 'bat' : 'beretta', yaw: tyaw }));
      await m.goto(tx, tz, { r: 30, text: 158 });
      for (const p of thugs) p.hostile = true;
      await m.killAll(thugs, 159);
      await m.say([['强尼', 160, v()], ['贝蒂', 161, v()], ['贝蒂', 162, v()], ['贝蒂', 163, v()]]);
      wanted(m, 2);
      betty.root.visible = false;
      await m.loseWanted(164);
      betty.root.visible = true;
      await m.goto(tx, tz, { r: 6, text: 165 });
      await m.say([['贝蒂', 166, v()], ['强尼', 167, v()], ['贝蒂', 168, v()], ['贝蒂', 169, v()], ['贝蒂', 170, v()]]);
      await m.goto(...P.swampLand, { r: 10, vehicle: car, text: 156 });
    },
  },
  {
    id: 'ch1_m08', chapter: 1, file: 'ch1', title: '狂飙迈阿密', reward: 2500,
    giver: P.gas,
    async run(m) {
      const g = m.g, v = voice('CH1_M08_TEXT');
      const [gx, gz, gyaw] = road(m, ...P.gas);
      const albert = await m.spawnPed('char_mechanic', gx + 2, gz + 2, { kind: 'civ', yaw: gyaw + Math.PI });
      m.objective(173);
      await m.say([['阿尔伯特', 174, v()], ['强尼', 175, v()], ['阿尔伯特', 176, v()], ['强尼', 177, v()], ['阿尔伯特', 178, v()],
        ['强尼', 179, v()], ['阿尔伯特', 180, v()], ['强尼', 181, v()], ['阿尔伯特', 182, v()], ['阿尔伯特', 183, v()], ['阿尔伯特', 184, v()]]);
      const side = (k) => [gx + Math.cos(gyaw) * k, gz - Math.sin(gyaw) * k];
      const mine = g.player.vehicle || await m.spawnCar('car_tawny', ...side(2.2), gyaw);
      const rival = await m.spawnCar('car_plymouth', ...side(-2.2), gyaw, { driver: 'npc' });
      g.peds.remove(albert);
      await m.getIn(mine, G(103));
      g.audio.play('int_race_321', { vol: 0.8 });
      await m.caption(G(317), 2.5);
      g.audio.play('int_race_go', { vol: 0.8 });
      const cps = [[-20, -700], [60, -640], [60, -450], [-120, -400], [-250, -500], [-200, -640], [gx, gz]].map(([x, z]) => road(m, x, z).slice(0, 2));
      await race(m, cps, rival, 185);
      await m.say([['阿尔伯特', 186, v()], ['阿尔伯特', 187, v()]]);
    },
  },
  {
    id: 'ch1_m09', chapter: 1, file: 'ch1', title: '亮相', reward: 2500,
    giver: P.betty,
    async run(m) {
      const g = m.g, vi = voice('CH1_M09_INTRO');
      const [bx, bz, byaw] = walk(m, ...P.betty);
      await m.spawnPed('char_betty', bx + 1.5, bz, { kind: 'civ', sex: 'female', yaw: byaw });
      m.objective(190);
      await m.say([['贝蒂', 191, vi()], ['贝蒂', 192, vi()], ['贝蒂', 193, vi()], ['贝蒂', 194, vi()], ['贝蒂', 195, vi()],
        ['强尼', 196, vi()], ['强尼', 197, vi()]]);
      const [ex, ez] = road(m, ...P.portEntry);
      await m.goto(ex, ez, { r: 12, text: 198 });
      const [ax, az, ayaw] = walk(m, ...P.albert);
      const albert = await m.spawnPed('char_mechanic', ax, az, { kind: 'civ', yaw: ayaw });
      m.protect(albert, G(326));
      await m.goto(ax, az, { r: 3, text: 199 });
      const va = voice('CH1_M09_MIDDLE_A');
      await m.say([['阿尔伯特', 200, va()], ['阿尔伯特', 201, va()]]);
      const [vx, vz] = walk(m, ...P.vantage);
      await m.goto(vx, vz, { r: 3, text: 202 });
      albert.pos.set(vx + 1.2, g.world.height(vx + 1.2, vz, 80), vz);
      await m.say([['强尼', 203, va()], ['阿尔伯特', 204, va()], ['强尼', 205, va()], ['阿尔伯特', 206, va()], ['强尼', 207, va()],
        ['阿尔伯特', 208, va()], ['强尼', 209, va()], ['阿尔伯特', 210, va()], ['强尼', 211, va()]]);
      g.peds.remove(albert);
      const [sx, sz, syaw] = road(m, ...P.truckStart);
      const truck = await m.spawnCar('car_truck', sx, sz, syaw, { driver: 'npc' });
      const dest = walk(m, ...P.warehouse).slice(0, 2);
      await tail(m, truck, dest, { text: 212, speed: 0.45, far: 200 });
      const vega = await m.spawnPed('char_vega', dest[0] + 3, dest[1] + 2, { kind: 'gang' });
      await m.spawnPed('char_mafia_a', dest[0] - 2, dest[1] + 3, { kind: 'gang', weapon: 'beretta' });
      const vb = voice('CH1_M09_MIDDLE_B');
      await m.say([['维加', 213, vb()], ['手下', 214, vb()], ['维加', 215, vb()], ['手下', 216, vb()], ['维加', 217, vb()]]);
      await photo(m, vega, 218);
      const ve = voice('CH1_M09_END');
      await m.say([['强尼', 219, ve()], ['阿尔伯特', 220, ve()]]);
    },
  },
  {
    id: 'ch1_m10', chapter: 1, file: 'ch1', title: '阿尔伯特的史诗级冒险', reward: 3000,
    giver: P.betty,
    async run(m) {
      const g = m.g, vi = voice('CH1_M10_INTRO');
      const [bx, bz, byaw] = walk(m, ...P.betty);
      await m.spawnPed('char_betty', bx + 1.5, bz, { kind: 'civ', sex: 'female', yaw: byaw });
      m.objective(223);
      await m.say([['贝蒂', 224, vi()], ['强尼', 225, vi()], ['贝蒂', 226, vi()], ['强尼', 227, vi()], ['阿尔伯特', 228, vi()],
        ['强尼', 229, vi()], ['阿尔伯特', 230, vi()], ['维加', 231, vi()], ['手下', 232, vi()]]);
      const [cx, cz, cyaw] = road(m, bx + 6, bz + 6);
      const car = g.player.vehicle || await m.spawnCar('car_buck', cx, cz, cyaw);
      const [gx, gz] = walk(m, ...P.gas);
      const albert = await m.spawnPed('char_mechanic', gx + 2, gz, { kind: 'civ' });
      m.protect(albert, G(326));
      await m.goto(gx, gz, { r: 8, text: 233, car: true });
      await m.say([['阿尔伯特', 234, vi()], ['强尼', 235, vi()]]);
      albert.follow = true;
      const truckPos = road(m, ...P.warehouse);
      const truck = await m.spawnCar('car_truck', truckPos[0], truckPos[1], truckPos[2]);
      const guards = [];
      for (const [i, mdl] of ['char_mafia_a', 'char_mafia_b', 'char_cubangang_1'].entries())
        guards.push(await m.spawnPed(mdl, truckPos[0] + 5 + i * 2, truckPos[1] + 4 - i * 3, { kind: 'gang', weapon: 'beretta' }));
      await m.goto(truckPos[0], truckPos[1], { r: 15, text: 236 });
      void car;
      const vm = voice('CH1_M10_MIDDLE');
      await m.say([['强尼', 237, vm()], ['阿尔伯特', 238, vm()], ['强尼', 239, vm()], ['手下', 240, vm()], ['阿尔伯特', 241, vm()], ['强尼', 242, vm()]]);
      // Albert drives the D340 home while Vega's men try to stop it
      albert.follow = false; albert.root.visible = false;
      truck.driver = 'npc';
      for (const p of guards) p.hostile = true;
      m.protect(truck, G(323));
      const [hx, hz] = road(m, ...P.gas);
      for (const [k, mdl] of ['car_homm_black', 'car_suv_detour'].entries()) {
        const [ex, ez, eyaw] = road(m, truckPos[0] + 40 + k * 20, truckPos[1] + 20);
        const e = await m.spawnCar(mdl, ex, ez, eyaw, { driver: 'npc' });
        drive(m, e, () => [truck.pos.x, truck.pos.z], { speed: 0.9 });
        m.blipList.push(() => (e.health > 0 ? { x: e.pos.x, z: e.pos.z, color: '#ff2a2a', small: true } : null));
      }
      m.objective(243);
      await tail(m, truck, [hx, hz], { far: 160, speed: 0.55 });
      m.objective(244, false);
      albert.pos.set(hx + 2, g.world.height(hx + 2, hz, 80), hz);
      albert.root.visible = true;
      const ve = voice('CH1_M10_END');
      await m.say([['强尼', 245, ve()], ['阿尔伯特', 246, ve()], ['强尼', 247, ve()], ['阿尔伯特', 248, ve()]]);
    },
  },
  {
    id: 'ch1_m11', chapter: 1, file: 'ch1', title: '背信弃义', reward: 3000,
    giver: P.betty,
    async run(m) {
      const g = m.g, vi = voice('CH1_M11_INTRO');
      const [bx, bz, byaw] = walk(m, ...P.betty);
      await m.spawnPed('char_betty', bx + 1.5, bz, { kind: 'civ', sex: 'female', yaw: byaw });
      m.objective(251);
      await m.say([['贝蒂', 252, vi()], ['贝蒂', 253, vi()], ['贝蒂', 254, vi()], ['贝蒂', 255, vi()], ['贝蒂', 256, vi()], ['强尼', 257, vi()]]);
      const [wx, wz] = road(m, ...P.warehouse2);
      m.timer(150);
      await m.goto(wx, wz, { r: 12, text: 258 });
      m.stopTimer();
      const [hx, hz] = P.hide;
      await m.goto(hx, hz, { r: 4, text: 259 });
      const vega = await m.spawnPed('char_vega', wx + 4, wz + 3, { kind: 'gang' });
      const bolano = await m.spawnPed('char_bolano', wx + 6, wz + 1, { kind: 'cop' });
      const guards = [];
      for (const [i, mdl] of ['char_mafia_a', 'char_mafia_b', 'char_mafia_c'].entries())
        guards.push(await m.spawnPed(mdl, wx + 2 + i * 3, wz - 4, { kind: 'gang', weapon: i === 2 ? 'uzi' : 'beretta' }));
      const vm = voice('CH1_M11_MIDDLE');
      await m.say([['波拉诺', 260, vm()], ['维加', 261, vm()], ['维加', 262, vm()], ['波拉诺', 263, vm()], ['维加', 264, vm()],
        ['波拉诺', 265, vm()], ['维加', 266, vm()], ['强尼', 267, vm()]]);
      await photo(m, bolano, 268);
      vega.goal = [wx + 60, wz + 30, false];
      bolano.goal = [wx + 60, wz + 34, false];
      for (const p of guards) p.hostile = true;
      await m.escape(guards, 70, 269);
      for (const p of [vega, bolano]) if (!p.dead) g.peds.remove(p);
      const ve = voice('CH1_M11_END');
      await m.say([['贝蒂', 270, ve()], ['贝蒂', 271, ve()], ['强尼', 272, ve()], ['强尼', 273, ve()], ['强尼', 274, ve()]]);
    },
  },
  {
    id: 'ch1_m12', chapter: 1, file: 'ch1', title: '急救', reward: 2000,
    giver: P.swampLand,
    async run(m) {
      const g = m.g, v = voice('CH1_M12_TEXT');
      waterMarkers(m);
      m.objective(277);
      await m.spawnPed('char_betty', P.swampLand[0] + 1.5, P.swampLand[1] - 1.5, { kind: 'civ', sex: 'female', yaw: -Math.PI / 2 });
      await m.say([['贝蒂', 278, v()], ['强尼', 279, v()], ['贝蒂', 280, v()], ['强尼', 281, v()], ['贝蒂', 282, v()],
        ['贝蒂', 283, v()], ['贝蒂', 284, v()], ['强尼', 285, v()]]);
      const boat = await m.spawnCar('boat_floatingpoint_single', ...P.swampWater, -Math.PI / 2);
      m.protect(boat, G(322));
      await m.getIn(boat, 286);
      const doc = await m.spawnPed('char_civ_man', ...P.docLand, { kind: 'civ', idle: 'fl__npc__wavehand' });
      m.protect(doc, G(87));
      await m.goto(...P.docWater, { r: 10, vehicle: boat, text: 287 });
      boat.vf = 0;
      await m.say([['强尼', 288, v()], ['医生', 289, v()], ['强尼', 290, v()]]);
      doc.root.visible = false;
      doc.follow = true;
      m.timer(150);
      await m.goto(...P.roscoeWater, { r: 10, vehicle: boat, text: 291 });
      m.stopTimer();
      disembark(m, ...P.roscoeLand);
    },
  },
  {
    id: 'ch1_m13', chapter: 1, file: 'ch1', title: '抢劫警车', reward: 3500,
    giver: P.swampLand,
    async run(m) {
      const g = m.g, vi = voice('CH1_M13_INTRO');
      const [lx, lz] = P.swampLand;
      await m.spawnPed('char_roscoe', lx + 1.5, lz - 1.5, { kind: 'civ', yaw: -Math.PI / 2 });
      await m.spawnPed('char_betty', lx + 3, lz - 0.5, { kind: 'civ', sex: 'female', yaw: -Math.PI / 2 });
      m.objective(294);
      await m.say([['强尼', 295, vi()], ['罗斯科', 296, vi()], ['贝蒂', 297, vi()], ['强尼', 298, vi()], ['贝蒂', 299, vi()],
        ['强尼', 300, vi()], ['贝蒂', 301, vi()], ['强尼', 302, vi()], ['贝蒂', 303, vi()]]);
      g.dropPickup('sniper', lx + 2, g.world.height(lx + 2, lz + 3, 80), lz + 3, 20);
      m.objective(304);
      m.blip(lx + 2, lz + 3, '#3fd4ff');
      await custom(m, () => !!g.player.weapons.sniper, () => g.player.give('sniper', 20));
      await m.say([['强尼', 305, voice('CH1_M13_MIDDLE_A')()]]);
      const [hx, hz] = walk(m, ...P.havana);
      await m.goto(hx, hz, { r: 15, text: 306 });
      const [rx, rz] = walk(m, ...P.roof);
      await m.goto(rx, rz, { r: 3, text: 307 });
      const [gx, gz, gyaw] = walk(m, ...P.havanaGang);
      const men = [];
      for (const [i, mdl] of ['char_cubangang_1', 'char_cubangang_2', 'char_northcuban_1', 'char_cubangang_1'].entries())
        men.push(await m.spawnPed(mdl, gx + Math.cos(i * 1.5) * 5, gz + Math.sin(i * 1.5) * 5, { kind: 'gang', weapon: 'beretta', yaw: gyaw }));
      for (const p of men) p.onHit = () => { for (const q of men) q.provoked = true; };
      await m.killAll(men, 308);
      await m.say([['手下', 309, voice('CH1_M13_MIDDLE_B')()]]);
      await m.goto(rx, rz, { r: 3, text: 310 });
      const [px, pz, pyaw] = road(m, gx + 6, gz + 6);
      const cruiser = await m.spawnCar('car_police_rich', px, pz, pyaw);
      const cops = [];
      for (const k of [-1, 1]) cops.push(await m.spawnPed('char_skinny_cop', px + Math.cos(pyaw) * 2.2 * k, pz - Math.sin(pyaw) * 2.2 * k, { kind: 'cop', weapon: 'beretta' }));
      for (const p of cops) p.onHit = () => { for (const q of cops) q.provoked = true; };
      await m.killAll(cops, 311);
      m.protect(cruiser, G(322));
      await m.getIn(cruiser, 312);
      if (g.police.level < 1) wanted(m, 2);
      await m.loseWanted(313);
      const [ax, az] = walk(m, ...P.gas);
      await m.goto(ax, az, { r: 10, vehicle: cruiser, text: 314 });
      await m.exitVehicle();
      await m.spawnPed('char_mechanic', ax + 2, az + 1, { kind: 'civ' });
      const ve = voice('CH1_M13_END');
      await m.say([['阿尔伯特', 315, ve()], ['强尼', 316, ve()], ['阿尔伯特', 317, ve()], ['强尼', 318, ve()], ['阿尔伯特', 319, ve()],
        ['强尼', 320, ve()], ['阿尔伯特', 321, ve()]]);
    },
  },
  {
    id: 'ch1_m14', chapter: 1, file: 'ch1', title: '火烧巡逻车', reward: 4000,
    giver: P.gas,
    async run(m) {
      const g = m.g, vi = voice('CH1_M14_INTRO');
      const [gx, gz, gyaw] = walk(m, ...P.gas);
      await m.spawnPed('char_mechanic', gx + 2, gz + 1, { kind: 'civ', yaw: gyaw + Math.PI });
      m.objective(324);
      await m.say([['阿尔伯特', 325, vi()], ['强尼', 326, vi()], ['阿尔伯特', 327, vi()], ['阿尔伯特', 328, vi()]]);
      const [cx, cz, cyaw] = road(m, gx + 6, gz + 4);
      const bomb = await m.spawnCar('car_police_rich', cx, cz, cyaw);
      m.noWanted = true;
      await m.getIn(bomb, G(103));
      // the tripwire is loose: a hard knock sets it off
      const fragile = addCheck(m, () => {
        if (g.player.vehicle === bomb && bomb.impact > 5) { g.explodeVehicle(bomb); return g.t('global', 322); }
        return null;
      });
      const [sx, sz, syaw] = road(m, ...P.police);
      await m.goto(sx, sz, { r: 12, vehicle: bomb, text: 329 });
      fragile();
      await m.say([['强尼', 330, vi()]]);
      const [bx, bz, byaw] = road(m, sx + Math.sin(syaw) * 14, sz + Math.cos(syaw) * 14);
      const bolanoCar = await m.spawnCar('car_police_poor', bx, bz, byaw);
      await m.getIn(bolanoCar, 331);
      m.objective(332);
      await custom(m, () => Math.hypot(g.focus.x - sx, g.focus.z - sz) > 140);
      m.objective(333);
      await m.wait(1.5);
      g.explodeVehicle(bomb);
      const [ox, oz] = walk(m, sx + 60, sz + 40);
      await m.goto(ox, oz, { r: 5, text: 334 });
      const vm = voice('CH1_M14_MIDDLE');
      await m.say([['强尼', 335, vm()], ['强尼', 336, vm()], ['强尼', 337, vm()], ['强尼', 338, vm()], ['强尼', 339, vm()],
        ['强尼', 340, vm()], ['强尼', 341, vm()]]);
      m.noWanted = false;
      const bolano = await m.spawnPed('char_bolano', sx, sz, { kind: 'cop', hostile: true, weapon: 'beretta', health: 220 });
      await m.killAll([bolano], 342);
    },
  },
  {
    id: 'ch1_m15', chapter: 1, file: 'ch1', title: '目击爆炸', reward: 6000,
    giver: P.betty,
    async run(m) {
      const g = m.g, vi = voice('CH1_M15_INTRO');
      waterMarkers(m);
      const [bx, bz, byaw] = walk(m, ...P.betty);
      await m.spawnPed('char_betty', bx + 1.5, bz, { kind: 'civ', sex: 'female', yaw: byaw });
      m.objective(345);
      await m.say([['强尼', 346, vi()], ['贝蒂', 347, vi()], ['强尼', 348, vi()], ['强尼', 349, vi()], ['贝蒂', 350, vi()],
        ['强尼', 351, vi()], ['强尼', 352, vi()], ['贝蒂', 353, vi()], ['贝蒂', 354, vi()], ['强尼', 355, vi()]]);
      const [hx, hz, hyaw] = walk(m, ...P.hotel);
      await m.goto(hx, hz, { r: 10, text: 356 });
      if (g.player.vehicle) await m.exitVehicle();
      m.noWanted = true;
      const ramirez = await m.spawnPed('char_skinny_cop', hx + 3, hz + 2, { kind: 'civ', yaw: hyaw });
      const cops = [ramirez, await m.spawnPed('char_fat_cop', hx + 5, hz + 1, { kind: 'civ' })];
      const men = [];
      for (const [i, mdl] of ['char_mafia_a', 'char_mafia_b', 'char_cubangang_1', 'char_mafia_c', 'char_cubangang_2'].entries())
        men.push(await m.spawnPed(mdl, hx + 6 + (i % 3) * 3, hz - 4 + Math.floor(i / 3) * 6, { kind: 'gang', weapon: i % 2 ? 'uzi' : 'beretta' }));
      const va = voice('CH1_M15_MIDDLE_A');
      await m.say([['强尼', 357, va()], ['拉米雷斯', 358, va()], ['拉米雷斯', 359, va()], ['强尼', 360, va()], ['拉米雷斯', 361, va()],
        ['拉米雷斯', 362, va()], ['强尼', 363, va()], ['拉米雷斯', 364, va()], ['拉米雷斯', 365, va()], ['无线电', 366, va()],
        ['无线电', 367], ['拉米雷斯', 368, va()], ['手下', 369, va()], ['拉米雷斯', 370, va()]]);
      for (const c of cops) c.goal = [hx - 60, hz, true];
      m.noWanted = false;
      for (const p of men) p.hostile = true;
      await m.killAll(men, 371);
      for (const c of cops) if (!c.dead) g.peds.remove(c);
      const vb = voice('CH1_M15_MIDDLE_B');
      await m.say([['手下', 372, vb()], ['强尼', 373, vb()]]);
      const [lx, lz] = P.beachLand;
      const more = [];
      for (const [i, mdl] of ['char_mafia_b', 'char_cubangang_2', 'char_mafia_a'].entries())
        more.push(await m.spawnPed(mdl, lx - 15 + i * 6, lz + 8 - i * 6, { kind: 'gang', hostile: true, weapon: 'beretta' }));
      await m.goto(lx, lz, { r: 8, text: 374 });
      const [wx, wz] = P.beachWater;
      const fleeing = await m.spawnCar('boat_speedboat_cigar', wx + 25, wz + 10, Math.PI / 2, { driver: 'npc', health: 3000 });
      const ride = await m.spawnCar('boat_seadoo', wx, wz, Math.PI / 2);
      sail(m, fleeing, [[860, 40], [900, 180], [930, 320], [960, 520], [1100, 700]], 0.55);
      await m.getIn(ride, G(104));
      m.objective(375);
      const b = () => ({ x: fleeing.pos.x, z: fleeing.pos.z, color: '#ff2a2a' });
      m.blipList.push(b);
      const lost = addCheck(m, () => (dist(fleeing, g.focus.x, g.focus.z) > 380 ? g.t('global', 93) : null));
      await custom(m, () => dist(fleeing, g.focus.x, g.focus.z) < 10);
      lost(); m.unblip(b);
      fleeing.stop = true; fleeing.vf = 0;
      bark(m, 'sfx_boat_impact_small');
      const ve = voice('CH1_M15_END');
      await m.say([['贝蒂', 376, ve()], ['强尼', 377, ve()], ['强尼', 378, ve()], ['贝蒂', 379, ve()], ['强尼', 380, ve()], ['贝蒂', 381, ve()],
        ['强尼', 382, ve()], ['阿尔伯特', 383, ve()], ['阿尔伯特', 384, ve()], ['强尼', 385, ve()], ['阿尔伯特', 386, ve()], ['强尼', 387, ve()]]);
    },
  },
];
