// Albert's street races (original chr text table + cin_chr_* voice clips).
import { Pursuit } from '../police.js';
import { voice, road } from './util.js';

const GARAGE = [-166, 62];           // race giver: Albert's boulevard
const BOAT_N = { dock: [163, -400], boat: [178, -400, Math.PI / 2],
  course: [[240, -400], [300, -450], [350, -550], [420, -450], [400, -300], [300, -180], [200, -350], [190, -400]] };
const BOAT_S = { dock: [250, 314], boat: [252, 324, 0],
  course: [[250, 370], [150, 400], [350, 480], [550, 420], [450, 350], [300, 370]] };
// street courses: waypoints joined along the road graph
const COURSE_DOWNTOWN = [[-293, -160], [0, -280], [-105, -500], [-399, -298], [-293, -160]];
const COURSE_BEACH = [[574, 176], [609, 238], [706, -150], [724, -187], [574, 176]];
const COURSE_NORTH = [[-535, -547], [-472, -657], [79, -643], [0, -280], [-293, -160]];

/** Resample a road route through waypoints into checkpoints ~spacing metres apart. */
function streetCheckpoints(m, wps, spacing = 85) {
  const R = m.g.roads, pts = [];
  for (let i = 0; i < wps.length - 1; i++) {
    const r = R.route(wps[i][0], wps[i][1], wps[i + 1][0], wps[i + 1][1]);
    for (const p of (i ? r.slice(1) : r)) pts.push(p);
  }
  const out = [];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (acc >= spacing) { out.push(pts[i]); acc = 0; }
  }
  const last = pts[pts.length - 1];
  if (!out.length || Math.hypot(out[out.length - 1][0] - last[0], out[out.length - 1][1] - last[1]) > 25) out.push(last);
  else out[out.length - 1] = last;
  return out;
}

function steerBoat(g, v, tx, tz, dt, maxSpeed) {
  const want = Math.atan2(tx - v.pos.x, tz - v.pos.z);
  let err = want - v.yaw; err = Math.atan2(Math.sin(err), Math.cos(err));
  v.update(dt, { throttle: maxSpeed * (1 - Math.min(0.5, Math.abs(err) * 0.3)), steer: Math.max(-1, Math.min(1, -err * 2)) }, g.world);
}

/**
 * Race: countdown, original checkpoint models, AI rivals, live position, fail if a rival finishes first.
 * opts: cps [[x,z]..], rivals [model..], skill (0..1 max throttle), winText (table index), grid [x,z,yaw]
 */
async function race(m, { cps, rivals = [], skill = 0.82, winText, grid, rivalCars = [] }) {
  const g = m.g, pl = g.player, pv = pl.vehicle;
  const boat = pv && pv.type === 'boat';
  const [gx, gz, gyaw] = grid || [pv.pos.x, pv.pos.z, pv.yaw];
  pv.place(gx, pv.pos.y, gz, gyaw);
  const fx = Math.sin(gyaw), fz = Math.cos(gyaw), rx = Math.cos(gyaw), rz = -Math.sin(gyaw);
  // grid: rivals beside and behind the player
  const field = [...rivalCars];
  for (let i = 0; i < rivals.length; i++) {
    const side = i % 2 ? -1 : 1, row = Math.floor(i / 2);
    const x = gx + rx * side * 4.5 - fx * row * 8, z = gz + rz * side * 4.5 - fz * row * 8;
    field.push(await m.spawnCar(rivals[i], x, z, gyaw, { driver: 'npc' }));
  }
  for (const v of field) { v.race = { cp: 0, purs: boat ? null : new Pursuit(g, v) }; v.place(v.pos.x, v.pos.y, v.pos.z, gyaw); }
  let frozen = true, finished = false;
  const total = field.length + 1;
  let playerCp = 0, posTimer = 0;
  const progress = (cp, x, z) => (cp >= cps.length ? 1e9 : cp * 1e5 - Math.hypot(cps[cp][0] - x, cps[cp][1] - z));
  const position = () => {
    const p = pl.vehicle || pl;
    const mine = progress(playerCp, p.pos.x, p.pos.z);
    return 1 + field.filter((v) => progress(v.race.cp, v.pos.x, v.pos.z) > mine).length;
  };
  const blips = field.map((v) => () => ({ x: v.pos.x, z: v.pos.z, color: '#ff8a00', small: true }));
  m.blipList.push(...blips);
  m.check((dt) => {
    if (frozen && pl.vehicle) { pl.vehicle.vf = 0; pl.vehicle.vs = 0; }
    for (const v of field) {
      if (frozen || finished || v.health <= 0 || v.race.cp >= cps.length) continue;
      const [tx, tz] = cps[v.race.cp];
      if (boat) steerBoat(g, v, tx, tz, dt, skill);
      else v.race.purs.update(dt, tx, tz, { maxSpeed: skill });
      if (Math.hypot(tx - v.pos.x, tz - v.pos.z) < 16) {
        v.race.cp++;
        if (v.race.cp >= cps.length && !finished) return `第${position()}名`;
      }
    }
    posTimer -= dt;
    if (!frozen && !finished && posTimer <= 0) { posTimer = 0.5; m.objective(`${m.T(winText)}　${position()}/${total}`, false); }
    return null;
  });
  // 3-2-1-出发 (original "123" and "出发" strings)
  const digits = m.T(['global', 317]) || '123';
  for (const d of [...digits].reverse()) { g.audio.play('int_race_321', { vol: 0.7 }); await m.caption(d, 1); }
  g.audio.play('int_race_go', { vol: 0.8 });
  g.hud.big(m.T(['global', 315]) || 'GO', '', 1);
  frozen = false;
  for (let i = 0; i < cps.length; i++) {
    const [x, z] = cps[i];
    await m.goto(x, z, { r: boat ? 14 : 12, car: true, model: i === cps.length - 1 ? 'checkpoint_race_end' : 'checkpoint_race' });
    playerCp = i + 1;
  }
  finished = true;
  for (const b of blips) m.unblip(b);
  m.objective(null);
  for (const v of field) { v.driver = null; }
}

/** Player's ride: spawn it beside the giver (or at the dock) and wait until he takes it. */
async function ride(m, model, text, at) {
  const [x, z, yaw] = at || road(m, GARAGE[0] + 8, GARAGE[1] + 6);
  const v = await m.spawnCar(model, x, z, yaw);
  m.protect(v, ['global', 322]);
  await m.getIn(v, text);
  return v;
}

/** Albert drives his own vehicle to the start line ahead of the player. */
async function albertLeads(m, model, to, text) {
  const g = m.g;
  const [x, z, yaw] = road(m, GARAGE[0] - 10, GARAGE[1] - 6);
  const al = await m.spawnCar(model, x, z, yaw, { driver: 'npc' });
  const purs = new Pursuit(g, al);
  let leading = true;
  m.check((dt) => { if (leading && al.health > 0) purs.update(dt, to[0], to[1], { maxSpeed: 0.55, stopAt: 10 }); return null; });
  m.blipList.push(() => (leading ? { x: al.pos.x, z: al.pos.z, color: '#3fd4ff' } : null));
  await m.goto(to[0], to[1], { r: 14, car: true, text, model: 'checkpoint_race_start' });
  leading = false;
  return al;
}

function street(m, course) { return streetCheckpoints(m, course); }

const G = GARAGE;
export const CHR = [
  {
    id: 'chr_m01', chapter: 'R', file: 'chr', title: '低调爆弹', side: true, requires: 'chx_m04', giver: G, reward: 800,
    async run(m) {
      const v = voice('CHR_M01_INTRO');
      await m.say([['阿尔伯特', 8, v()], ['阿尔伯特', 9, v()], ['强尼', 10, v()], ['阿尔伯特', 11, v()], ['阿尔伯特', 12, v()], ['强尼', 13, v()]]);
      await ride(m, 'car_truck_redneck', 7);
      await race(m, { cps: street(m, COURSE_DOWNTOWN.slice(1)), rivals: ['car_truck', 'car_suv_detour', 'car_van'], skill: 0.75, winText: 14 });
      await m.say([['阿尔伯特', 15, 'cin_chr_m01_ending_00']]);
    },
  },
  {
    id: 'chr_m02', chapter: 'R', file: 'chr', title: 'S.O.S.', side: true, requires: 'chr_m01', giver: G, reward: 1000,
    async run(m) {
      const v = voice('CHR_M02_INTRO');
      await m.say([['阿尔伯特', 19, v()], ['强尼', 20, v()], ['阿尔伯特', 21, v()], ['强尼', 22, v()], ['阿尔伯特', 23, v()],
        ['强尼', 24, v()], ['阿尔伯特', 25, v()], ['强尼', 26, v()], ['阿尔伯特', 27, v()], ['阿尔伯特', 28, v()]]);
      await ride(m, 'car_plymouth', 18);
      const cps = street(m, COURSE_BEACH);
      const [sx, sz] = road(m, ...COURSE_BEACH[0]);
      await m.goto(sx, sz, { r: 14, car: true, text: 29, model: 'checkpoint_race_start' });
      const yaw = Math.atan2(cps[0][0] - sx, cps[0][1] - sz);
      await race(m, { cps, rivals: ['car_laufer', 'car_vamp', 'car_homm'], skill: 0.8, winText: 30, grid: [sx, sz, yaw] });
    },
  },
  {
    id: 'chr_m03', chapter: 'R', file: 'chr', title: '炫酷新车', side: true, requires: 'chr_m02', giver: G, reward: 1000,
    async run(m) {
      const v = voice('CHR_M03_INTRO');
      await m.say([['阿尔伯特', 34, v()], ['强尼', 35, v()], ['阿尔伯特', 36, v()], ['强尼', 37, v()]]);
      await ride(m, 'car_plymouth_flames', 33);
      const [ax, az, ayaw] = road(m, G[0] - 10, G[1] - 6);
      const al = await m.spawnCar('car_plymouth_barracuda', ax, az, ayaw, { driver: 'npc' });
      await race(m, { cps: street(m, COURSE_DOWNTOWN.slice(1)), rivalCars: [al], skill: 0.85, winText: 38 });
      await m.say([['阿尔伯特', 39, 'cin_chr_m03_ending_00']]);
    },
  },
  {
    id: 'chr_m04', chapter: 'R', file: 'chr', title: '遍地开花', side: true, requires: 'chr_m03', giver: G, reward: 1500,
    async run(m) {
      const v = voice('CHR_M04_INTRO');
      await m.say([['阿尔伯特', 43, v()], ['强尼', 44, v()], ['阿尔伯特', 45, v()], ['强尼', 46, v()], ['阿尔伯特', 47, v()]]);
      await ride(m, 'car_homm', 42);
      const cps = street(m, COURSE_NORTH);
      const [sx, sz] = road(m, ...COURSE_NORTH[0]);
      await m.goto(sx, sz, { r: 14, car: true, text: 48, model: 'checkpoint_race_start' });
      const yaw = Math.atan2(cps[0][0] - sx, cps[0][1] - sz);
      // Rodriguez fronts for Vega in the black Läufer
      await race(m, { cps, rivals: ['car_laufer_black', 'car_vamp_green', 'car_homm_black'], skill: 0.86, winText: 49, grid: [sx, sz, yaw] });
    },
  },
  {
    id: 'chr_m05', chapter: 'R', file: 'chr', title: '双轮迅雷', side: true, requires: 'chr_m04', giver: G, reward: 1500,
    async run(m) {
      const v = voice('CHR_M05_INTRO');
      await m.say([['阿尔伯特', 53, v()], ['强尼', 54, v()], ['阿尔伯特', 55, v()], ['强尼', 56, v()], ['阿尔伯特', 57, v()], ['强尼', 58, v()]]);
      await ride(m, 'bike_harley', 52);
      const [ax, az, ayaw] = road(m, G[0] - 10, G[1] - 6);
      const al = await m.spawnCar('bike_kawa_sport', ax, az, ayaw, { driver: 'npc' });
      m.g.hud.big(m.T(60), '', 2);
      await race(m, { cps: street(m, COURSE_DOWNTOWN.slice(1)), rivalCars: [al], rivals: ['bike_dirt'], skill: 0.8, winText: 59 });
    },
  },
  {
    id: 'chr_m06', chapter: 'R', file: 'chr', title: '单人秀', side: true, requires: 'chr_m05', giver: G, reward: 1800,
    async run(m) {
      const v = voice('CHR_M06_INTRO');
      await m.say([['阿尔伯特', 64, v()], ['强尼', 65, v()], ['阿尔伯特', 66, v()], ['阿尔伯特', 67, v()], ['阿尔伯特', 68, v()]]);
      await ride(m, 'bike_kawa', 63);
      const cps = street(m, COURSE_BEACH);
      const [sx, sz] = road(m, ...COURSE_BEACH[0]);
      const al = await albertLeads(m, 'bike_kawa_sport', [sx, sz], 69);
      const yaw = Math.atan2(cps[0][0] - sx, cps[0][1] - sz);
      await race(m, { cps, rivalCars: [al], rivals: ['bike_dirt', 'bike_harley_black'], skill: 0.82, winText: 70, grid: [sx, sz, yaw] });
    },
  },
  {
    id: 'chr_m07', chapter: 'R', file: 'chr', title: '最后警告', side: true, requires: 'chr_m06', giver: G, reward: 2000,
    async run(m) {
      const v = voice('CHR_M07_INTRO');
      await m.say([['阿尔伯特', 74, v()], ['强尼', 75, v()], ['阿尔伯特', 76, v()], ['阿尔伯特', 77, v()]]);
      await ride(m, 'bike_kawa_sport', 73);
      const cps = street(m, COURSE_NORTH);
      const [sx, sz] = road(m, ...COURSE_NORTH[0]);
      const al = await albertLeads(m, 'bike_kawa', [sx, sz], 78);
      const yaw = Math.atan2(cps[0][0] - sx, cps[0][1] - sz);
      await race(m, { cps, rivalCars: [al], rivals: ['bike_harley', 'bike_dirt', 'bike_kawa'], skill: 0.85, winText: 79, grid: [sx, sz, yaw] });
    },
  },
  {
    id: 'chr_m08', chapter: 'R', file: 'chr', title: '特殊赛事', side: true, requires: 'chr_m07', giver: G, reward: 2000,
    async run(m) {
      const v = voice('CHR_M08_INTRO');
      await m.say([['强尼', 83, v()], ['阿尔伯特', 84, v()], ['强尼', 85, v()], ['阿尔伯特', 86, v()]]);
      await m.goto(BOAT_N.dock[0], BOAT_N.dock[1], { r: 5, text: 87 });
      await ride(m, 'boat_speedboat_cigar', 87, BOAT_N.boat);
      await race(m, { cps: BOAT_N.course, rivals: ['boat_speedboat_riva', 'boat_seadoo'], skill: 0.8, winText: 88, grid: BOAT_N.boat });
    },
  },
  {
    id: 'chr_m09', chapter: 'R', file: 'chr', title: '赌我赢', side: true, requires: 'chr_m08', giver: G, reward: 2200,
    async run(m) {
      const v = voice('CHR_M09_INTRO');
      await m.say([['阿尔伯特', 92, v()], ['强尼', 93, v()], ['阿尔伯特', 94, v()]]);
      await m.goto(BOAT_S.dock[0], BOAT_S.dock[1], { r: 5, text: 95 });
      await ride(m, 'boat_speedboat_cigar', 95, BOAT_S.boat);
      await race(m, { cps: BOAT_S.course, rivals: ['boat_speedboat_riva', 'boat_speedboat_police', 'boat_seadoo'], skill: 0.82, winText: 96, grid: BOAT_S.boat });
    },
  },
  {
    id: 'chr_m10', chapter: 'R', file: 'chr', title: '艾迪登场', side: true, requires: 'chr_m09', giver: G, reward: 2500,
    async run(m) {
      const v = voice('CHR_M10_INTRO');
      await m.say([['阿尔伯特', 100, v()], ['强尼', 101, v()], ['阿尔伯特', 102, v()], ['阿尔伯特', 103, v()], ['强尼', 104, v()], ['阿尔伯特', 105, v()]]);
      await ride(m, 'bike_harley', 106); // Eddie Fallon's Fat Damsel
      const cps = street(m, COURSE_DOWNTOWN);
      const [sx, sz] = road(m, ...COURSE_DOWNTOWN[0]);
      await m.goto(sx, sz, { r: 14, car: true, text: 107, model: 'checkpoint_race_start' });
      const yaw = Math.atan2(cps[0][0] - sx, cps[0][1] - sz);
      await race(m, { cps, rivals: ['bike_kawa_sport', 'bike_kawa', 'bike_dirt'], skill: 0.86, winText: 108, grid: [sx, sz, yaw] });
    },
  },
  {
    id: 'chr_m11', chapter: 'R', file: 'chr', title: '水上时间', side: true, requires: 'chr_m10', giver: G, reward: 2500,
    async run(m) {
      const v = voice('CHR_M11_INTRO');
      await m.say([['强尼', 112, v()], ['阿尔伯特', 113, v()], ['强尼', 114, v()], ['阿尔伯特', 115, v()]]);
      await m.goto(BOAT_N.dock[0], BOAT_N.dock[1], { r: 5, text: 116 });
      await ride(m, 'boat_seadoo', 116, BOAT_N.boat);
      const cps = [...BOAT_N.course];
      await m.goto(cps[0][0], cps[0][1], { r: 14, car: true, text: 117, model: 'checkpoint_race_start' });
      await race(m, { cps: cps.slice(1), rivals: ['boat_seadoo', 'boat_seadoo', 'boat_speedboat_riva'], skill: 0.8, winText: 118,
        grid: [cps[0][0], cps[0][1], Math.atan2(cps[1][0] - cps[0][0], cps[1][1] - cps[0][1])] });
    },
  },
  {
    id: 'chr_m12', chapter: 'R', file: 'chr', title: '放马过来', side: true, requires: 'chr_m11', giver: G, reward: 2800,
    async run(m) {
      const v = voice('CHR_M12_INTRO');
      await m.say([['阿尔伯特', 122, v()], ['强尼', 123, v()], ['阿尔伯特', 124, v()], ['强尼', 125, v()]]);
      await m.goto(BOAT_S.dock[0], BOAT_S.dock[1], { r: 5, text: 126 });
      await ride(m, 'boat_speedboat_cigar', 126, BOAT_S.boat);
      const cps = BOAT_S.course;
      await m.goto(cps[0][0], cps[0][1], { r: 14, car: true, text: 127, model: 'checkpoint_race_start' });
      await race(m, { cps: cps.slice(1), rivals: ['boat_speedboat_cigar', 'boat_speedboat_riva', 'boat_speedboat_police', 'boat_seadoo'], skill: 0.85, winText: 128,
        grid: [cps[0][0], cps[0][1], Math.atan2(cps[1][0] - cps[0][0], cps[1][1] - cps[0][1])] });
    },
  },
  {
    id: 'chr_m13', chapter: 'R', file: 'chr', title: '大汇总', side: true, requires: 'chr_m12', giver: G, reward: 2800,
    async run(m) {
      await m.say([['阿尔伯特', 132, 'cin_chr_m13_intro_00']]);
      await ride(m, 'bike_kawa_sport', 133);
      const cps = street(m, COURSE_NORTH);
      const [sx, sz] = road(m, ...COURSE_NORTH[0]);
      const al = await albertLeads(m, 'bike_harley_black', [sx, sz], 134);
      const yaw = Math.atan2(cps[0][0] - sx, cps[0][1] - sz);
      await race(m, { cps, rivalCars: [al], rivals: ['bike_kawa', 'bike_kawa_sport', 'bike_dirt'], skill: 0.88, winText: 135, grid: [sx, sz, yaw] });
    },
  },
  {
    id: 'chr_m14', chapter: 'R', file: 'chr', title: '重压在身', side: true, requires: 'chr_m13', giver: G, reward: 3000,
    async run(m) {
      const v = voice('CHR_M14_INTRO');
      await m.say([['阿尔伯特', 139, v()], ['强尼', 140, v()], ['阿尔伯特', 141, v()], ['强尼', 142, v()], ['阿尔伯特', 143, v()]]);
      await ride(m, 'car_vamp', 144);
      const cps = street(m, COURSE_BEACH);
      const [sx, sz] = road(m, ...COURSE_BEACH[0]);
      m.timer(75); // the race is already starting
      await m.goto(sx, sz, { r: 14, car: true, text: 144, model: 'checkpoint_race_start' });
      m.stopTimer();
      const yaw = Math.atan2(cps[0][0] - sx, cps[0][1] - sz);
      await race(m, { cps, rivals: ['car_lamb', 'car_laufer', 'car_vamp_green'], skill: 0.88, winText: 145, grid: [sx, sz, yaw] });
    },
  },
  {
    id: 'chr_m15', chapter: 'R', file: 'chr', title: '一如往昔', side: true, requires: 'chr_m14', giver: G, reward: 3500,
    async run(m) {
      const v = voice('CHR_M15_INTRO');
      await m.say([['阿尔伯特', 149, v()], ['阿尔伯特', 150, v()], ['强尼', 151, v()], ['阿尔伯特', 152, v()], ['强尼', 153, v()], ['阿尔伯特', 154, v()]]);
      await m.goto(BOAT_N.dock[0], BOAT_N.dock[1], { r: 5, text: 155 });
      await ride(m, 'boat_speedboat_cigar', 155, BOAT_N.boat);
      const cps = BOAT_N.course;
      await m.goto(cps[0][0], cps[0][1], { r: 14, car: true, text: 156, model: 'checkpoint_race_start' });
      // the Cubans show up in their old boats
      await race(m, { cps: [...cps.slice(1), cps[0]], rivals: ['boat_speedboat_yacht', 'boat_speedboat_riva', 'boat_floatingpoint_single'], skill: 0.85, winText: 157,
        grid: [cps[0][0], cps[0][1], Math.atan2(cps[1][0] - cps[0][0], cps[1][1] - cps[0][1])] });
      const e = voice('CHR_M15_ENDING');
      await m.say([['阿尔伯特', 158, e()], ['阿尔伯特', 159, e()]]);
    },
  },
];
