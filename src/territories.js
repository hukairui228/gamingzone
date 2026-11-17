// Gang territory capture system inspired by Gangstar: Miami Vindication.
import { G } from './state.js';
import { DISTRICT, DISTRICT_NAME, blockDistrict, blockCenter, NX, NZ, P } from './layout.js';
import { clamp, rand, pick } from './util.js';

const GANGS = [
  { id: 'armada', name: '阿马达帮', color: 0xd7263d, css: '#d7263d' },
  { id: 'swamp', name: '沼泽帮', color: 0x3dff7a, css: '#3dff7a' },
  { id: 'beach', name: '海滩帮', color: 0x2e86ab, css: '#2e86ab' },
  { id: 'street', name: '街头帮', color: 0xe0c341, css: '#e0c341' },
];

const TURF_DISTRICTS = [
  { district: DISTRICT.PORT, gang: 'armada', blocks: [] },
  { district: DISTRICT.DOWNTOWN, gang: null, blocks: [] },
  { district: DISTRICT.MIDTOWN, gang: 'street', blocks: [] },
  { district: DISTRICT.RESIDENTIAL, gang: 'swamp', blocks: [] },
  { district: DISTRICT.DECO, gang: 'beach', blocks: [] },
  { district: DISTRICT.PARK, gang: null, blocks: [] },
];

export class Territories {
  constructor() {
    this.zones = [];
    this.battleActive = false;
    this.battleZone = null;
    this.battleProgress = 0;
    this.battleWaves = 0;
    this.battleEnemies = [];
    this.incomeTimer = 0;
    this.flashTimer = 0;
    this.killCount = 0;
    this.killZone = null;
    this._killCb = null;
  }

  init() {
    if (!this._killCb) {
      this._killCb = G.events.on('actorKilled', (ped, attacker) => {
        if (attacker !== G.player || this.battleActive) return;
        if (!ped.team) return;
        const zone = this.zoneAt(ped.x, ped.z);
        if (!zone || zone.captured || zone.gang !== ped.team) return;
        if (this.killZone !== zone) { this.killZone = zone; this.killCount = 0; }
        this.killCount++;
        if (this.killCount >= 3) {
          this.killCount = 0;
          this.startBattle(zone);
        }
      });
    }
    if (G.save.territories) {
      this.zones = G.save.territories;
      return;
    }
    this.zones = [];
    for (const td of TURF_DISTRICTS) {
      const blocks = [];
      for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
        if (blockDistrict(i, j) === td.district) blocks.push({ i, j });
      }
      this.zones.push({
        district: td.district,
        name: DISTRICT_NAME[td.district],
        gang: td.gang,
        owner: td.gang,
        blocks,
        captured: false,
      });
    }
    G.save.territories = this.zones;
  }

  get gangs() { const m = {}; for (const g of GANGS) m[g.id] = g; return m; }
  gangInfo(id) { return GANGS.find(g => g.id === id) || null; }

  zoneAt(x, z) {
    const i = Math.floor(x / P), j = Math.floor(z / P);
    return this.zones.find(z => z.blocks.some(b => b.i === i && b.j === j)) || null;
  }

  startBattle(zone) {
    if (this.battleActive || !zone || zone.captured || !zone.gang) return;
    this.battleActive = true;
    this.battleZone = zone;
    this.battleProgress = 0;
    this.battleWaves = 0;
    this.battleEnemies = [];
    G.hud && G.hud.notify(`地盘争夺战开始！消灭${this.gangInfo(zone.gang)?.name || '敌人'}！`);
    G.hud && G.hud.objective(`占领 ${zone.name}`);
    this.spawnWave();
  }

  spawnWave() {
    if (!this.battleZone || !G.pedSys) return;
    this.battleWaves++;
    const count = Math.min(3 + this.battleWaves, 8);
    const zone = this.battleZone;
    const center = zone.blocks[Math.floor(zone.blocks.length / 2)];
    const cx = center.i * P + P / 2, cz = center.j * P + P / 2;
    const gang = this.gangInfo(zone.gang);

    for (let k = 0; k < count; k++) {
      const angle = (k / count) * Math.PI * 2 + rand(-0.3, 0.3);
      const dist = rand(15, 35);
      const px = cx + Math.sin(angle) * dist, pz = cz + Math.cos(angle) * dist;
      const ped = G.pedSys.spawn('gang', px, pz, Math.random() * Math.PI * 2);
      if (ped) {
        ped.hostile = true;
        ped.team = zone.gang;
        ped.setWeapon(pick(['pistol', 'smg', 'shotgun']));
        ped.char.hp = ped.char.maxHp = 80 + this.battleWaves * 20;
        ped.state = 'attack';
        ped.persistent = true;
      }
      if (ped) this.battleEnemies.push(ped);
    }
  }

  update(dt) {
    const pl = G.player;
    if (!pl || pl.dead) return;

    // Territory income
    this.incomeTimer += dt;
    if (this.incomeTimer >= 60) {
      this.incomeTimer = 0;
      let income = 0;
      for (const z of this.zones) {
        if (z.captured) income += 200;
      }
      if (income > 0) {
        G.addMoney(income, true);
        G.hud && G.hud.notify(`地盘收入 +${income}`);
      }
    }

    // Battle progress
    if (this.battleActive) {
      this.battleEnemies = this.battleEnemies.filter(e => e.char && !e.char.dead && !e.removed);
      if (this.battleEnemies.length === 0) {
        if (this.battleWaves < 3) {
          this.battleProgress = this.battleWaves / 3;
          this.spawnWave();
        } else {
          this.captureZone(this.battleZone);
        }
      }
      // Check if player left the area
      const zone = this.battleZone;
      const pZone = this.zoneAt(pl.x, pl.z);
      if (pZone !== zone) {
        this.flashTimer += dt;
        if (this.flashTimer > 15) {
          this.failBattle();
        }
      } else {
        this.flashTimer = 0;
      }
    }

    // Check if player enters enemy territory and kills gang members
    if (!this.battleActive) {
      const zone = this.zoneAt(pl.x, pl.z);
      if (zone && zone.gang && !zone.captured && this.killZone !== zone) {
        this.killZone = null;
        this.killCount = 0;
      }
    }
  }

  captureZone(zone) {
    zone.captured = true;
    zone.owner = 'player';
    this.battleActive = false;
    this.battleZone = null;
    this.battleProgress = 1;
    this.battleEnemies = [];
    G.hud && G.hud.big(`${zone.name} 已占领！`, 'gold', '地盘收入 +$200/分钟', 4);
    G.hud && G.hud.objective('');
    G.addMoney(2000);
    G.save.territories = this.zones;
    G.persist();
  }

  failBattle() {
    this.battleActive = false;
    this.battleZone = null;
    this.battleProgress = 0;
    for (const e of this.battleEnemies) {
      if (e.char && !e.char.dead) e.char.hp = 0;
    }
    this.battleEnemies = [];
    this.flashTimer = 0;
    G.hud && G.hud.notify('你离开了战区，占领失败！');
    G.hud && G.hud.objective('');
  }

  blips() {
    const out = [];
    for (const z of this.zones) {
      if (!z.gang || z.captured) continue;
      const center = z.blocks[Math.floor(z.blocks.length / 2)];
      const gang = this.gangInfo(z.gang);
      out.push({
        x: center.i * P + P / 2,
        z: center.j * P + P / 2,
        ch: '⚔',
        col: gang ? gang.css : '#ff0000',
        label: `${z.name} (${gang?.name || '敌人'})`,
      });
    }
    return out;
  }

  mapOverlay(ctx, w2m) {
    for (const z of this.zones) {
      if (!z.gang && !z.captured) continue;
      const gang = z.captured ? null : this.gangInfo(z.gang);
      const col = z.captured ? 'rgba(61,255,122,0.12)' : gang ? hexToRGBA(gang.css, 0.1) : 'rgba(255,255,255,0.05)';
      ctx.fillStyle = col;
      for (const b of z.blocks) {
        const [mx, mz] = w2m(b.i * P + P / 2, b.j * P + P / 2);
        const size = P * (ctx.canvas.width / 1800);
        ctx.fillRect(mx - size / 2, mz - size / 2, size, size);
      }
    }
  }
}

function hexToRGBA(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
