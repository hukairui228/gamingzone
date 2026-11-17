import { Pursuit } from '../police.js';
import { voice, road } from './util.js';

// Story missions, scripted from the original Chinese text tables (public/assets/text/chN.chinese.json).
// Numbers passed to say()/objective() are indices into the chapter's table; every line is the original text.
// Voice clips cin_<CH>_<M>_TEXT_nn follow the dialogue lines of each mission in order.

export const CH1 = [
  {
    id: 'ch1_m00', chapter: 1, file: 'ch1', title: '前路漫漫……', reward: 300,
    giver: null, start: [-300, -790, Math.PI / 2],
    async run(m) {
      const g = m.g, v = voice('CH1_M00_TEXT');
      const [sx, sz, syaw] = road(m, -300, -790);
      g.placePlayer(sx, sz, syaw);
      await m.caption(18, 3); // 佛罗里达州，斯塔克市，前一天
      const [cx, cz, cyaw] = road(m, sx + 6, sz + 4);
      const car = await m.spawnCar('car_buck', cx, cz, cyaw);
      await m.say([['阿尔伯特', 7, v()], ['阿尔伯特', 8, v()], ['强尼', 9, v()], ['阿尔伯特', 10, v()], ['阿尔伯特', 11, v()], ['强尼', 12, v()]]);
      m.protect(car, ['global', 323]);
      await m.getIn(car, 13);
      await m.say([['强尼', 14, v()], ['强尼', 15, v()], ['强尼', 16, v()]]);
      await m.caption(19, 3); // 现在，迈阿密附近……
      const [gx, gz] = road(m, -95, -640, 1);
      await m.goto(gx, gz, { r: 9, text: 17, car: true });
      m.checks.length = 0;
      await m.caption(21, 2.5);
      // gas station: the owner chats while Johnny's car gets trashed
      const v1 = voice('CH1_M01_TEXT');
      const owner = await m.spawnPed('char_redneck', gx + 3, gz + 2, { kind: 'civ', yaw: Math.PI });
      await m.exitVehicle();
      await m.say([['强尼', 23, v1()], ['加油站老板', 24, v1()], ['强尼', 25, v1()]]);
      car.health = 60;
      g.fx.explosion(car.pos.x, car.pos.y, car.pos.z);
      g.audio.play('sfx_car_impact_hard');
      car.burnT = 30;
      await m.say([['强尼', 26, v1()], ['强尼', 27, v1()], ['加油站老板', 28, v1()], ['强尼', 29, v1()], ['强尼', 30, v1()], ['强尼', 31, v1()], ['加油站老板', 32, v1()]]);
      const [px, pz, pyaw] = road(m, gx + 12, gz + 8);
      const prize = await m.spawnCar('car_tawny', px, pz, pyaw);
      await m.beat(owner, 33);
      m.protect(prize, ['global', 322]);
      await m.getIn(prize, 34);
      // the owner chases in a pickup
      const [ox, oz, oyaw] = road(m, gx - 15, gz - 10);
      const chaser = await m.spawnCar('car_truck', ox, oz, oyaw, { driver: 'npc' });
      const purs = new Pursuit(g, chaser);
      m.check((dt) => { if (chaser.health > 0) purs.update(dt, g.focus.x, g.focus.z, { maxSpeed: 0.9 }); return null; });
      m.blipList.push(() => (chaser.health > 0 ? { x: chaser.pos.x, z: chaser.pos.z, color: '#ff2a2a' } : null));
      await m.escape([chaser], 130, 35);
    },
  },
  {
    id: 'ch1_m01', chapter: 1, file: 'ch1', title: '嚼烟来了！', reward: 500,
    giver: [-415, -470],
    async run(m) {
      const g = m.g, v = voice('CH1_M02_TEXT');
      const [bx, bz] = road(m, -415, -470, 1);
      const betty = await m.spawnPed('char_betty', bx + 1.5, bz, { kind: 'ally', sex: 'female', yaw: -Math.PI / 2 });
      m.protect(betty, ['global', 327]);
      m.objective(38);
      await m.say([['贝蒂', 39, v()], ['强尼', 40, v()], ['贝蒂', 41, v()], ['强尼', 42, v()], ['贝蒂', 43, v()], ['强尼', 44, v()],
        ['贝蒂', 45, v()], ['强尼', 46, v()], ['贝蒂', 47, v()]]);
      const [sx, sz] = road(m, -255, -365, 1);
      await m.goto(sx, sz, { r: 6, text: 48 });
      const thug = await m.spawnPed('char_biker', sx + 2.5, sz + 1, { kind: 'gang', yaw: Math.PI, idle: 'sl__civilian_male__chat_cross_arms' });
      await m.say([['小混混', 49, v()], ['强尼', 50, v()], ['小混混', 51, v()]]);
      await m.beat(thug, 52);
      g.audio.play('sfx_pickup_star', { vol: 0.7 });
      await m.goto(bx, bz, { r: 6, text: 53 });
      await m.say([['强尼', 54, v()], ['贝蒂', 55, v()], ['强尼', 56, v()], ['贝蒂', 57, v()], ['贝蒂', 58, v()]]);
    },
  },
];
