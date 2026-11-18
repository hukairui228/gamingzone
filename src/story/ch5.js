import { voice, road } from './util.js';
import { SPOT, setWanted, squad, cast, hunt, trail, arm, walkable } from './ch4.js';

// Chapter 5 — "王座之前", the finale. Every on-screen line is the original ch5 table text by index;
// voice clips cin_ch5_m_NN_<part>_XX follow each mission's dialogue lines in order.

const HILLBILLIES = ['char_redneck', 'char_biker', 'char_redneck', 'char_construction_guy', 'char_biker'];
const KLICK = ['char_mafia_a', 'char_mafia_b', 'char_mafia_c', 'char_redneck', 'char_biker'];

export const CH5 = [
  {
    id: 'ch5_m01', chapter: 5, file: 'ch5', title: '机场送别', reward: 6000,
    giver: SPOT.villa,
    async run(m) {
      const g = m.g, v = voice('CH5_M_01_INTRO');
      const [vx, vz] = SPOT.villa;
      const fam = await cast(m, [['LC', 'char_lc'], ['贝蒂', 'char_betty', 'female'], ['乔伊', 'char_joey']], vx, vz);
      m.objective(3);
      await m.say([['强尼', 4, v()], ['LC', 5, v()], ['贝蒂', 6, v()], ['LC', 7, v()], ['强尼', 8, v()]]);
      for (const p of Object.values(fam)) p.follow = true;
      m.protect(fam.LC, ['global', 328]);
      m.protect(fam['贝蒂'], ['global', 327]);
      const [cx, cz, cyaw] = road(m, vx + 8, vz + 6);
      const car = await m.spawnCar('car_suv_detour', cx, cz, cyaw);
      m.protect(car, ['global', 322]);
      await m.getIn(car, ['global', 103]);
      const [ax, az] = road(m, SPOT.airport[0], SPOT.airport[1]);
      await m.goto(ax, az, { r: 14, text: 9, vehicle: car });
      const vm = voice('CH5_M_01_MIDDLE');
      await m.say([['强尼', 10, vm()], ['乔伊', 11, vm()], ['LC', 12, vm()], ['贝蒂', 13, vm()], ['LC', 14, vm()]]);
      const trucks = [];
      for (let i = 0; i < 3; i++) {
        const [tx, tz, tyaw] = road(m, ax + 40 * Math.cos(i * 2.1), az + 40 * Math.sin(i * 2.1));
        const t = await m.spawnCar('car_truck_redneck', tx, tz, tyaw, { driver: 'npc' });
        hunt(m, t, 0.9);
        trucks.push(t);
      }
      m.blipList.push(...trucks.map((t) => () => (t.health > 0 ? { x: t.pos.x, z: t.pos.z, color: '#ff2a2a', small: true } : null)));
      await m.escape(trucks, 170, 15);
      await m.goto(vx, vz, { r: 14, text: 16, vehicle: car });
      const ve = voice('CH5_M_01_END');
      await m.say([['强尼', 17, ve()], ['贝蒂', 18, ve()], ['强尼', 19, ve()], ['LC', 20, ve()]]);
    },
  },
  {
    id: 'ch5_m02', chapter: 5, file: 'ch5', title: '终极背叛', reward: 7000,
    giver: SPOT.villa,
    async run(m) {
      const g = m.g, v = voice('CH5_M_02_INTRO');
      const [vx, vz] = SPOT.villa;
      await cast(m, [['LC', 'char_lc'], ['贝蒂', 'char_betty', 'female'], ['乔伊', 'char_joey']], vx, vz);
      m.objective(23);
      await m.say([['LC', 24, v()], ['强尼', 25, v()], ['乔伊', 26, v()], ['强尼', 27, v()], ['LC', 28, v()], ['贝蒂', 29, v()], ['强尼', 30, v()], ['贝蒂', 31, v()], ['强尼', 32, v()]]);
      const [hx, hz] = walkable(m, SPOT.hillbilly[0], SPOT.hillbilly[1]);
      await m.goto(hx, hz, { r: 12, text: 33 });
      const tammie = await m.spawnPed('char_tammie', ...walkable(m, hx + 6, hz + 3).slice(0, 2), { kind: 'gang', weapon: 'beretta', health: 140 });
      const goons = await squad(m, HILLBILLIES.slice(0, 4), hx + 6, hz + 3, { kind: 'gang', weapon: ['uzi', 'beretta', 'ak47'] }, 9);
      const vm = voice('CH5_M_02_MIDDLE');
      await m.say([['汤米', 34, vm()], ['强尼', 35, vm()], ['汤米', 36, vm()], ['强尼', 37, vm()], ['汤米', 38, vm()], ['强尼', 39, vm()],
        ['汤米', 40, vm()], ['汤米', 41, vm()], ['强尼', 42, vm()]]);
      for (const p of [tammie, ...goons]) p.hostile = true;
      arm(g, 'ak47', 90);
      await m.killAll([tammie, ...goons], 43);
      setWanted(g, 2);
      await m.loseWanted(44);
    },
  },
  {
    id: 'ch5_m03', chapter: 5, file: 'ch5', title: '克莱夫的老巢', reward: 8000,
    giver: SPOT.villa,
    async run(m) {
      const g = m.g, v = voice('CH5_M_03_INTRO');
      const [vx, vz] = SPOT.villa;
      await cast(m, [['LC', 'char_lc'], ['贝蒂', 'char_betty', 'female'], ['乔伊', 'char_joey']], vx, vz);
      m.objective(47);
      await m.say([['LC', 48, v()], ['强尼', 49, v()], ['强尼', 50, v()], ['LC', 51, v()], ['乔伊', 52, v()], ['强尼', 53, v()], ['贝蒂', 54, v()], ['LC', 55, v()], ['LC', 56, v()]]);
      arm(g, 'sniper', 25);
      const [hx, hz, hyaw] = road(m, vx + 12, vz - 10);
      const heli = await m.spawnCar('heli_news', hx, hz, hyaw);
      m.protect(heli, ['global', 322]);
      await m.getIn(heli, 57);
      const [cx, cz] = SPOT.clive;
      await m.goto(cx - 50, cz + 60, { r: 30, text: 58, vehicle: heli });
      const guards = await squad(m, KLICK, cx, cz, { hostile: true, weapon: ['ak47', 'uzi', 'beretta'] }, 14);
      await m.killAll(guards, 59);
      const [gx, gz] = walkable(m, cx, cz);
      await m.goto(gx, gz, { r: 8, text: 60 });
      const ve = voice('CH5_M_03_END');
      await m.say([['强尼', 61, ve()]]);
    },
  },
  {
    id: 'ch5_m04', chapter: 5, file: 'ch5', title: '何时反攻？', reward: 8000,
    giver: SPOT.villa,
    async run(m) {
      const g = m.g, v = voice('CH5_M_04_INTRO');
      const [vx, vz] = SPOT.villa;
      const fam = await cast(m, [['LC', 'char_lc'], ['贝蒂', 'char_betty', 'female'], ['乔伊', 'char_joey']], vx, vz);
      m.objective(64);
      await m.say([['贝蒂', 65, v()], ['强尼', 66, v()], ['贝蒂', 67, v()], ['贝蒂', 68, v()], ['LC', 69, v()], ['强尼', 70, v()], ['强尼', 71, v()], ['乔伊', 72, v()], ['LC', 73, v()]]);
      m.protect(fam['贝蒂'], ['global', 327]);
      arm(g, 'ak47', 150);
      const sides = [[35, 20], [-30, 25], [10, -35]];
      for (let w = 0; w < 3; w++) {
        const [ox, oz] = sides[w];
        const wave = await squad(m, KLICK.slice(w, w + 4), vx + ox, vz + oz, { hostile: true, weapon: ['ak47', 'uzi', 'beretta'] }, 8);
        await m.killAll(wave, 74);
      }
      const ve = voice('CH5_M_04_END');
      await m.say([['强尼', 75, ve()]]);
    },
  },
  {
    id: 'ch5_m05', chapter: 5, file: 'ch5', title: '猎狮', reward: 20000,
    giver: SPOT.villa,
    async run(m) {
      const g = m.g, v = voice('CH5_M_05_INTRO');
      const [vx, vz] = SPOT.villa;
      const { LC: lc } = await cast(m, [['LC', 'char_lc']], vx, vz);
      m.objective(78);
      await m.say([['LC', 79, v()], ['强尼', 80, v()], ['LC', 81, v()], ['强尼', 82, v()], ['LC', 83, v()], ['强尼', 84, v()], ['LC', 85, v()],
        ['强尼', 86, v()], ['LC', 87, v()], ['强尼', 88, v()]]);
      lc.follow = true;
      m.protect(lc, ['global', 328]);
      const [cx, cz, cyaw] = road(m, vx + 8, vz + 6);
      const car = await m.spawnCar('car_vamp', cx, cz, cyaw);
      await m.getIn(car, ['global', 103]);
      const [mx, mz] = road(m, SPOT.mall[0], SPOT.mall[1]);
      await m.goto(mx, mz, { r: 12, text: 89, car: true });
      const va = voice('CH5_M_05_MIDDLE_A');
      await m.say([['LC', 90, va()], ['强尼', 91, va()], ['LC', 92, va()], ['强尼', 93, va()], ['LC', 94, va()]]);
      const [px, pz] = walkable(m, mx + 30, mz + 30);
      await m.goto(px, pz, { r: 5, text: 95 });
      const vb = voice('CH5_M_05_MIDDLE_B');
      await m.say([['LC', 96, vb()], ['强尼', 97, vb()], ['LC', 98, vb()], ['强尼', 99, vb()]]);
      arm(g, 'sniper', 15);
      // Clive is out of reach on the roof: one good hit sends him running
      const [kx, kz] = walkable(m, mx - 25, mz - 30);
      const clive = await m.spawnPed('char_bigbossman', kx, kz, { kind: 'gang', health: 9999, yaw: 0 });
      m.objective(100);
      m.hint = { type: 'beat', p: clive, threshold: 9998 };
      const cb = () => ({ x: clive.pos.x, z: clive.pos.z, color: '#ff2a2a' });
      m.blipList.push(cb);
      await m.until(() => clive.health < 9999 || clive.dead);
      m.unblip(cb);
      g.peds.remove(clive);
      const [gx, gz, gyaw] = road(m, g.player.pos.x + 6, g.player.pos.z + 6);
      const getaway = await m.spawnCar('car_laufer', gx, gz, gyaw);
      await m.getIn(getaway, 101);
      await m.caption(102, 2);
      await m.say([['强尼', 103, vb()], ['LC', 104, vb()], ['强尼', 105, vb()]]);
      await m.exitVehicle();
      const goons = await squad(m, KLICK.slice(0, 4), g.player.pos.x, g.player.pos.z, { hostile: true, weapon: ['ak47', 'uzi'] }, 18);
      arm(g, 'ak47', 120);
      await m.killAll(goons, 106);
      const vc = voice('CH5_M_05_MIDDLE_C');
      await m.say([['LC', 107, vc()], ['强尼', 108, vc()], ['LC', 109, vc()]]);
      const [tx, tz, tyaw] = road(m, g.player.pos.x + 40, g.player.pos.z - 30);
      const tank = await m.spawnCar('car_bearcat', tx, tz, tyaw, { driver: 'npc', health: 99999 });
      await m.getIn(getaway, ['global', 103]);
      await trail(m, tank, road(m, SPOT.airport[0], SPOT.airport[1]), { text: 110, warn: 111, lose: 260, speed: 0.7 });
      const vd = voice('CH5_M_05_MIDDLE_D');
      await m.say([['LC', 112, vd()], ['强尼', 113, vd()]]);
      const [ex, ez] = walkable(m, tank.pos.x + 3, tank.pos.z + 3);
      const boss = await m.spawnPed('char_bigbossman', ex, ez, { hostile: true, weapon: 'ak47', health: 300 });
      const guards = await squad(m, KLICK.slice(1, 3), ex, ez, { hostile: true, weapon: 'uzi' }, 5);
      await m.killAll([boss, ...guards], 114);
      if (g.player.vehicle) await m.exitVehicle();
      const fam = await cast(m, [['贝蒂', 'char_betty', 'female'], ['乔伊', 'char_joey']], g.player.pos.x, g.player.pos.z);
      void fam;
      const ve = voice('CH5_M_05_END');
      await m.say([['强尼', 115, ve()], ['强尼', 116, ve()], ['强尼', 117, ve()], ['LC', 118, ve()], ['贝蒂', 119, ve()], ['强尼', 120, ve()], ['贝蒂', 121, ve()], ['LC', 122, ve()]]);
      const vf = voice('CH5_M_05_END_B');
      await m.say([['乔伊', 123, vf()], ['强尼', 124, vf()], ['乔伊', 125, vf()], ['强尼', 126, vf()], ['强尼', 127, vf()], ['乔伊', 128, vf()],
        ['强尼', 129, vf()], ['乔伊', 130, vf()], ['乔伊', 131, vf()], ['强尼', 132, vf()], ['LC', 133, vf()]]);
      const vg = voice('CH5_M_05_END_C');
      await m.say([['贝蒂', 134, vg()], ['强尼', 135, vg()], ['路人', 136, vg()], ['贝蒂', 137, vg()], ['强尼', 138, vg()]]);
      g.hud.big(m.T(['global', 335]), m.T(['global', 336]), 10);
      await m.wait(6);
    },
  },
];
