import { voice } from './util.js';
import { LOC, spot, land, water, custom, destroy, squad, ally, boatChase, plant } from './ch2.js';

// Chapter 3 — "寻找货物 / 讨债": lines from public/assets/text/ch3.chinese.json by index,
// voices cin_ch3_m_NN_{intro,middle,middle_a..,end,end_a}_XX in dialogue order.

const v3 = (n, part) => voice(`CH3_M_${String(n).padStart(2, '0')}_${part}`);

export const CH3 = [
  {
    id: 'ch3_m01', chapter: 3, file: 'ch3', title: '来自洛杉矶', reward: 5000,
    giver: LOC.slaughter,
    async run(m) {
      const g = m.g, vi = v3(1, 'INTRO'), vm = v3(1, 'MIDDLE'), ve = v3(1, 'END');
      const [sx, sz, syaw] = spot(m, ...LOC.slaughter, 1);
      g.placePlayer(sx, sz, syaw);
      const joey = await ally(m, 'char_joey', ...spot(m, sx, sz, 1, 2).slice(0, 2));
      const betty = await ally(m, 'char_betty', ...spot(m, sx, sz, 1, -2).slice(0, 2), 'female');
      m.protect(betty, ['global', 327]);
      await m.caption(3, 3);
      await m.say([['强尼', 5, vi()], ['强尼', 6, vi()], ['乔伊', 7, vi()], ['强尼', 8, vi()], ['乔伊', 9, vi()], ['强尼', 10, vi()],
        ['乔伊', 11, vi()], ['强尼', 12, vi()], ['强尼', 13, vi()], ['乔伊', 14, vi()]]);
      const guard = await m.spawnPed('char_redneck', ...spot(m, sx, sz, -1, 4).slice(0, 2), { kind: 'gang' });
      await m.say([['守卫', 15, vi()], ['贝蒂', 16, vi()], ['守卫', 17, vi()], ['守卫', 18, vi()], ['守卫', 19, vi()]]);
      await m.beat(guard, 20);
      await m.say([['贝蒂', 21, vm()], ['贝蒂', 22, vm()], ['强尼', 23, vm()], ['贝蒂', 24, vm()], ['贝蒂', 25, vm()], ['LC', 26, vm()],
        ['贝蒂', 27, vm()], ['LC', 28, vm()]]);
      // LC's rescue run: take a helicopter in town and fly to the barn
      const [hx, hz, hyaw] = spot(m, ...LOC.police, 0, 25);
      g.placePlayer(...spot(m, hx, hz, 1, -8).slice(0, 2), hyaw);
      joey.root.visible = false; betty.root.visible = false;
      const heli = await m.spawnCar('heli_news', hx, hz, hyaw);
      await m.getIn(heli, 29);
      await m.goto(sx, sz, { r: 50, text: 30, vehicle: heli });
      const guards = await squad(m, ['char_redneck', 'char_biker'], sx, sz, 4, { weapon: 'uzi' });
      await m.killAll(guards, 31);
      joey.root.visible = true; betty.root.visible = true;
      await m.say([['强尼', 32, ve()], ['乔伊', 33, ve()], ['强尼', 34, ve()], ['乔伊', 35, ve()], ['LC', 36, ve()], ['乔伊', 37, ve()],
        ['LC', 38, ve()], ['贝蒂', 39, ve()], ['LC', 40, ve()], ['强尼', 41, ve()], ['LC', 42, ve()]]);
    },
  },
  {
    id: 'ch3_m02', chapter: 3, file: 'ch3', title: '开火', reward: 5000,
    giver: LOC.betty,
    async run(m) {
      const g = m.g, vi = v3(2, 'INTRO'), vm = v3(2, 'MIDDLE');
      const [bx, bz, byaw] = spot(m, ...LOC.betty, 1);
      await ally(m, 'char_betty', bx + 1.2, bz, 'female');
      await ally(m, 'char_joey', ...spot(m, bx, bz, 1, 2).slice(0, 2));
      const lc = await ally(m, 'char_lc', ...spot(m, bx, bz, 1, -2).slice(0, 2));
      m.protect(lc, ['global', 328]);
      await m.say([['强尼', 46, vi()], ['乔伊', 47, vi()], ['强尼', 48, vi()], ['乔伊', 49, vi()], ['LC', 50, vi()], ['贝蒂', 51, vi()],
        ['LC', 52, vi()], ['强尼', 53, vi()]]);
      const [cx, cz, cyaw] = spot(m, bx, bz, 0, 12);
      const car = await m.spawnCar('car_suv_detour', cx, cz, cyaw || byaw);
      lc.follow = true;
      const [wx, wz] = spot(m, ...LOC.port, 1, 20);
      await m.goto(wx, wz, { r: 14, text: 54 });
      await m.say([['LC', 55, vm()]]);
      const cops = await squad(m, ['char_swat', 'char_skinny_cop'], wx, wz, 5, { kind: 'cop', weapon: 'ak47' });
      await m.killAll(cops, 56);
      const [kx, kz] = spot(m, wx, wz, -1, 8);
      const mk = await m.marker(kx, kz, 'checkpoint_briefcase');
      await plant(m, kx, kz, 56, 1.5, 'sfx_pickup_weapons');
      m.removeMarker(mk);
      await m.say([['LC', 57, vm()]]);
      lc.follow = false; lc.root.visible = false;
      g.police.crime('killcop', { x: wx, z: wz });
      g.police.crime('killcop', { x: wx, z: wz });
      await m.goto(car.pos.x, car.pos.z, { r: 6, text: 58 });
      await m.loseWanted(59);
      await m.say([['LC', 60, vm()], ['强尼', 61, vm()], ['LC', 62, vm()], ['强尼', 63, vm()]]);
    },
  },
  {
    id: 'ch3_m03', chapter: 3, file: 'ch3', title: '暴烤鳄鱼', reward: 5500,
    giver: LOC.betty,
    async run(m) {
      const g = m.g, vi = v3(3, 'INTRO'), vm = v3(3, 'MIDDLE');
      const [bx, bz, byaw] = spot(m, ...LOC.betty, 1);
      await ally(m, 'char_joey', bx + 1.2, bz);
      const lc = await ally(m, 'char_lc', ...spot(m, bx, bz, 1, -2).slice(0, 2));
      m.protect(lc, ['global', 328]);
      // the government's secret weapon (flamethrower in the original) is handed over as the rocket launcher
      g.player.give('rpg', 8);
      await m.say([['乔伊', 67, vi()], ['LC', 68, vi()], ['强尼', 69, vi()], ['乔伊', 70, vi()], ['强尼', 71, vi()]]);
      lc.follow = true;
      const [cx, cz, cyaw] = spot(m, bx, bz, 0, 12);
      await m.spawnCar('car_truck', cx, cz, cyaw || byaw);
      const [sx, sz] = land(m, ...LOC.swamp);
      await m.goto(sx, sz, { r: 15, text: 72 });
      await m.say([['强尼', 73, vm()]]);
      const targets = [];
      const models = ['car_truck_redneck', 'car_van', 'car_buck', 'car_delivery'];
      for (let i = 0; i < 4; i++) {
        const [px, pz] = land(m, sx + Math.cos(i * 1.6) * 16, sz + Math.sin(i * 1.6) * 16);
        targets.push(await m.spawnCar(models[i], px, pz, i));
      }
      await squad(m, ['char_redneck', 'char_civ_trash_2'], sx, sz, 3, { raw: true, weapon: 'beretta' });
      await destroy(m, targets, 74);
      await m.say([['LC', 75, vm()], ['强尼', 76, vm()], ['贝蒂', 77, vm()], ['贝蒂', 78, vm()], ['LC', 79, vm()]]);
      await m.goto(bx, bz, { r: 8, text: 80 });
      const [hx, hz] = spot(m, ...LOC.lcHotel, 0);
      await m.goto(hx, hz, { r: 10, text: 81, car: true });
      lc.follow = false;
    },
  },
  {
    id: 'ch3_m04', chapter: 3, file: 'ch3', title: '贝蒂的老板', reward: 6000,
    giver: LOC.betty,
    async run(m) {
      const g = m.g, vi = v3(4, 'INTRO'), vm = v3(4, 'MIDDLE'), ve = v3(4, 'END');
      g.gfx.hour = 23;
      const [bx, bz] = spot(m, ...LOC.betty, 1);
      const betty = await ally(m, 'char_betty', bx + 1.2, bz, 'female');
      m.protect(betty, ['global', 327]);
      await m.say([['强尼', 85, vi()], ['贝蒂', 86, vi()], ['强尼', 87, vi()], ['贝蒂', 88, vi()], ['贝蒂', 89, vi()], ['强尼', 90, vi()],
        ['贝蒂', 91, vi()], ['强尼', 92, vi()], ['贝蒂', 93, vi()], ['强尼', 94, vi()], ['贝蒂', 95, vi()]]);
      betty.follow = true;
      const [sx, sz] = land(m, ...LOC.swamp2);
      await m.goto(sx, sz, { r: 12, text: 96 });
      betty.follow = false;
      const [rx, rz] = land(m, sx + 6, sz + 3);
      const roscoe = await m.spawnPed('char_roscoe', rx, rz, { kind: 'gang', health: 150 });
      betty.pos.set(rx - 2, roscoe.pos.y, rz - 1);
      await m.say([['罗斯科', 97, vm()], ['贝蒂', 98, vm()], ['罗斯科', 99, vm()], ['贝蒂', 100, vm()], ['贝蒂', 101, vm()], ['贝蒂', 102, vm()],
        ['罗斯科', 103, vm()], ['贝蒂', 104, vm()], ['贝蒂', 105, vm()], ['罗斯科', 106, vm()], ['贝蒂', 107, vm()]]);
      await m.beat(roscoe, 108);
      await m.say([['强尼', 109, ve()], ['贝蒂', 110, ve()], ['贝蒂', 111, ve()]]);
    },
  },
  {
    id: 'ch3_m05', chapter: 3, file: 'ch3', title: '罗斯科的“好下场”', reward: 6000,
    giver: LOC.lcHotel,
    async run(m) {
      const g = m.g, vi = v3(5, 'INTRO'), vm = v3(5, 'MIDDLE');
      const [hx, hz] = spot(m, ...LOC.lcHotel, 1);
      await ally(m, 'char_joey', hx + 1.2, hz);
      await ally(m, 'char_lc', ...spot(m, hx, hz, 1, 2).slice(0, 2));
      await ally(m, 'char_betty', ...spot(m, hx, hz, 1, -2).slice(0, 2), 'female');
      await m.say([['乔伊', 115, vi()], ['强尼', 116, vi()], ['LC', 117, vi()], ['LC', 118, vi()], ['贝蒂', 119, vi()], ['乔伊', 120, vi()],
        ['贝蒂', 121, vi()], ['贝蒂', 122, vi()], ['强尼', 123, vi()]]);
      const [sx, sz] = land(m, ...LOC.swamp2);
      await m.goto(sx, sz, { r: 20, text: 124 });
      const [rx, rz] = land(m, sx + 8, sz - 4);
      await m.spawnPed('char_roscoe', rx, rz, { kind: 'civ' });
      await m.spawnPed('char_redneck', ...land(m, rx + 2, rz + 1), { kind: 'civ' });
      await m.goto(rx, rz, { r: 14, text: 125 });
      await m.say([['罗斯科', 126, vm()], ['罗斯科', 127, vm()]]);
      await custom(m, 128, () => g.police.level >= 3);
    },
  },
  {
    id: 'ch3_m06', chapter: 3, file: 'ch3', title: '音乐领地', reward: 8000,
    giver: LOC.lcHotel,
    async run(m) {
      const g = m.g, vi = v3(6, 'INTRO'), vm = v3(6, 'MIDDLE'), ve = v3(6, 'END');
      const [hx, hz, hyaw] = spot(m, ...LOC.lcHotel, 1);
      const lc = await ally(m, 'char_lc', hx + 1.2, hz);
      await ally(m, 'char_betty', ...spot(m, hx, hz, 1, -2).slice(0, 2), 'female');
      m.protect(lc, ['global', 328]);
      await m.say([['强尼', 132, vi()], ['LC', 133, vi()], ['贝蒂', 134, vi()], ['LC', 135, vi()], ['贝蒂', 136, vi()], ['强尼', 137, vi()],
        ['贝蒂', 138, vi()], ['强尼', 139, vi()], ['贝蒂', 140, vi()], ['强尼', 141, vi()], ['LC', 142, vi()]]);
      const [cx, cz, cyaw] = spot(m, hx, hz, 0, 12);
      await m.spawnCar('car_vamp', cx, cz, cyaw || hyaw);
      lc.follow = true;
      const [vx, vz] = spot(m, ...LOC.villa, 1);
      await m.goto(vx, vz, { r: 12, text: 143, car: true });
      await m.say([['LC', 144, vm()], ['强尼', 145, vm()], ['LC', 146, vm()], ['强尼', 147, vm()], ['LC', 148, vm()]]);
      const guards = await squad(m, ['char_mafia_a', 'char_mafia_b', 'char_mafia_c'], vx, vz, 6, { weapon: 'uzi' });
      await m.killAll(guards, 149);
      await m.say([['LC', 150, vm()]]);
      const [bx, bz] = water(m, vx, vz + 30);
      const boat = await m.spawnCar('boat_speedboat_cigar', bx, bz, 0);
      await m.getIn(boat, 151);
      const chasers = [];
      for (const [ox, oz] of [[bx - 70, bz], [bx + 70, bz + 20]]) {
        const [wx, wz] = water(m, ox, oz);
        chasers.push(await m.spawnCar('boat_speedboat_police', wx, wz, 0, { driver: 'npc' }));
      }
      boatChase(m, chasers);
      await m.escape(chasers, 150, 152);
      m.chaseOff = true;
      const [ex, ez] = water(m, 600, 100);
      await m.goto(ex, ez, { r: 30, text: 153, vehicle: boat });
      lc.follow = false;
      await m.say([['LC', 154, ve()], ['乔伊', 155, ve()], ['强尼', 156, ve()], ['强尼', 157, ve()]]);
    },
  },
  {
    id: 'ch3_m07', chapter: 3, file: 'ch3', title: 'B计划', reward: 12000,
    giver: LOC.lcHotel,
    async run(m) {
      const g = m.g, vi = v3(7, 'INTRO'), va = v3(7, 'MIDDLE_A'), vb = v3(7, 'MIDDLE_B'), vc = v3(7, 'MIDDLE_C'), vea = v3(7, 'END_A'), ve = v3(7, 'END');
      const [hx, hz, hyaw] = spot(m, ...LOC.lcHotel, 1);
      const lc = await ally(m, 'char_lc', hx + 1.2, hz);
      const joey = await ally(m, 'char_joey', ...spot(m, hx, hz, 1, 2).slice(0, 2));
      m.protect(lc, ['global', 328]);
      await m.say([['LC', 161, vi()], ['乔伊', 162, vi()], ['强尼', 163, vi()], ['LC', 164, vi()], ['LC', 165, vi()], ['乔伊', 166, vi()],
        ['强尼', 167, vi()], ['乔伊', 168, vi()]]);
      const [cx, cz, cyaw] = spot(m, hx, hz, 0, 12);
      await m.spawnCar('car_cooperv8_berlin', cx, cz, cyaw || hyaw);
      lc.follow = true;
      const [vx, vz] = spot(m, ...LOC.villa, 1);
      await m.goto(vx, vz, { r: 12, text: 169 });
      await m.say([['LC', 170, va()], ['强尼', 171, va()], ['LC', 172, va()], ['强尼', 173, va()]]);
      const [kx, kz, kyaw] = spot(m, vx, vz, 0, 15);
      const kayeCar = await m.spawnCar('car_laufer_black', kx, kz, kyaw);
      await m.getIn(kayeCar, 174);
      const [ax, az] = spot(m, ...LOC.albert, 0);
      await m.goto(ax, az, { r: 10, text: 175, vehicle: kayeCar });
      await ally(m, 'char_mechanic', ...spot(m, ax, az, 1, 3).slice(0, 2));
      await m.say([['阿尔伯特', 176, vb()], ['LC', 177, vb()], ['阿尔伯特', 178, vb()], ['阿尔伯特', 179, vb()], ['强尼', 180, vb()], ['阿尔伯特', 181, vb()]]);
      // rigged car: one hard knock and it blows
      m.check(() => {
        if (g.player.vehicle === kayeCar && kayeCar.impact > 3 && !kayeCar.exploded) { g.explodeVehicle(kayeCar); return m.T(['global', 322]); }
        return null;
      });
      await m.goto(kx, kz, { r: 10, text: 182, vehicle: kayeCar });
      m.checks.length = 0;
      m.protect(lc, ['global', 328]);
      await m.exitVehicle();
      await m.say([['LC', 183, vb()], ['强尼', 184, vb()], ['LC', 185, vb()], ['强尼', 186, vb()], ['强尼', 187, vb()], ['LC', 188, vb()]]);
      g.player.give('sniper', 15);
      m.objective(189);
      await m.say([['LC', 190, vc()], ['LC', 191, vc()]]);
      // Kaye flees in his limousine
      const [lx, lz, lyaw] = spot(m, vx, vz, 0, -25);
      const limo = await m.spawnCar('car_limo', lx, lz, lyaw, { driver: 'npc', health: 1400 });
      m.driveAround(limo, 0.7);
      m.check(() => (limo.health > 0 && Math.hypot(limo.pos.x - g.focus.x, limo.pos.z - g.focus.z) > 230 ? m.T(['global', 93]) : null));
      await destroy(m, [limo], 192);
      lc.follow = false; joey.follow = false;
      await m.say([['LC', 193, vea()]]);
      await m.say([['强尼', 194, ve()], ['LC', 195, ve()], ['乔伊', 196, ve()], ['乔伊', 197, ve()], ['LC', 198, ve()], ['强尼', 199, ve()],
        ['LC', 200, ve()], ['强尼', 201, ve()], ['乔伊', 202, ve()], ['强尼', 203, ve()], ['LC', 204, ve()]]);
    },
  },
];

