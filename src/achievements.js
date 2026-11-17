// Achievement/stats tracking — based on Gangstar: Miami Vindication original achievements
import { G } from './state.js';

const ACHIEVEMENTS = [
  // Story progress (original: 6 chapters, we have 5)
  { id: 'ch1', name: '第1章', desc: '完成第1章', icon: '📖', check: () => G.save.mission >= 4 },
  { id: 'ch2', name: '第2章', desc: '完成第2章', icon: '📖', check: () => G.save.mission >= 7 },
  { id: 'ch3', name: '第3章', desc: '完成第3章', icon: '📖', check: () => G.save.mission >= 10 },
  { id: 'ch4', name: '第4章', desc: '完成第4章', icon: '📖', check: () => G.save.mission >= 14 },
  { id: 'ch5', name: '第5章', desc: '完成第5章', icon: '📖', check: () => G.save.mission >= 18 },
  // Discovery (探索发现)
  { id: 'gangstar', name: '美国黑帮', desc: '首次达到通缉等级5', icon: '⭐', check: () => G.save.stats.maxWanted >= 5 },
  { id: 'nra', name: '武器会员', desc: '拥有全套武器', icon: '🎯', check: () => { const w = G.save.weapons; return w.pistol && w.smg && w.shotgun && w.rifle && w.sniper && w.rocket && w.bat && w.flamethrower; } },
  { id: 'carlover', name: '汽车爱好者', desc: '将所有车辆都驾驶过至少一次', icon: '🚗', check: () => Object.keys(G.save.stats.vehiclesDriven || {}).length >= 14 },
  // Performance (行为表现)
  { id: 'stuntman', name: '替身演员', desc: '飞车达100米', icon: '🏍️', check: () => (G.save.stats.longestJump || 0) >= 100 },
  { id: 'medic', name: '急救车！', desc: '将10名病人送到医院', icon: '🚑', check: () => (G.save.stats.ambulanceTrips || 0) >= 10 },
  { id: 'taxidriver', name: '出租司机！', desc: '在一辆出租上载过10个人', icon: '🚕', check: () => (G.save.stats.taxiTrips || 0) >= 10 },
  { id: 'delivery', name: '快餐宅急送！', desc: '给10人送餐', icon: '🍔', check: () => (G.save.stats.deliveryTrips || 0) >= 10 },
  // Exploration (探索)
  { id: 'surf', name: '海滨小子', desc: '全种类冲浪板收集', icon: '🏄', check: () => (G.save.surfboards || []).length >= 15 },
  { id: 'rims', name: '集车大师', desc: '全种类车轮收集', icon: '🛞', check: () => (G.save.wheels || []).length >= 15 },
  { id: 'badges', name: '秘密道具', desc: '收集全部隐藏道具', icon: '💎', check: () => G.save.badges.length >= 25 },
  // Statistics (数学家)
  { id: 'psycho', name: '变态杀手', desc: '杀死10名市民', icon: '💀', check: () => (G.save.stats.civKills || 0) >= 10 },
  { id: 'reckless', name: '鲁莽驾驶', desc: '在修车铺修过10次车', icon: '🔧', check: () => (G.save.stats.repairCount || 0) >= 10 },
  { id: 'thief', name: '汽车大盗', desc: '偷过30辆车', icon: '🔑', check: () => G.save.stats.carsStolen >= 30 },
  { id: 'rubber', name: '橡胶气味', desc: '30次漂移', icon: '🏎️', check: () => (G.save.stats.drifts || 0) >= 30 },
  { id: 'serial', name: '连续杀人犯', desc: '总共杀死100个人', icon: '☠️', check: () => G.save.stats.kills >= 100 },
  { id: 'breaker', name: '毁车狂', desc: '破坏50辆汽车', icon: '💥', check: () => (G.save.stats.carsDestroyed || 0) >= 50 },
  { id: 'grinder', name: '绞肉机', desc: '总共杀死500个人', icon: '🔥', check: () => G.save.stats.kills >= 500 },
  { id: 'trust', name: '中产阶级', desc: '拥有100000美元', icon: '💰', check: () => (G.save.stats.totalEarned || 0) >= 100000 },
  { id: 'ceo', name: '大富翁', desc: '拥有500000美元', icon: '🏦', check: () => (G.save.stats.totalEarned || 0) >= 500000 },
  { id: 'bacon', name: '警察猎手', desc: '杀死30名警察', icon: '🥓', check: () => (G.save.stats.copsKilled || 0) >= 30 },
  // Misc
  { id: 'racer', name: '赛车手', desc: '赢得5场街头赛', icon: '🏁', check: () => G.save.stats.racesWon >= 5 },
  { id: 'sailor', name: '水手之心', desc: '驾船行驶2公里', icon: '⛵', check: () => (G.save.stats.distanceWater || 0) >= 2000 },
  { id: 'roadtrip', name: '公路旅行', desc: '驾车行驶5公里', icon: '🛣️', check: () => (G.save.stats.distanceCar || 0) >= 5000 },
  { id: 'turf', name: '地盘之王', desc: '占领全部帮派地盘', icon: '👑', check: () => G.territories && G.territories.zones.every(z => !z.gang || z.captured) },
];

export class Achievements {
  constructor() {
    this.unlocked = new Set(G.save.achievements || []);
    this.queue = [];
    this.popTimer = 0;
    this.showing = null;
  }

  check() {
    for (const a of ACHIEVEMENTS) {
      if (this.unlocked.has(a.id)) continue;
      try { if (a.check()) this.unlock(a); } catch (e) {}
    }
  }

  unlock(a) {
    this.unlocked.add(a.id);
    if (!G.save.achievements) G.save.achievements = [];
    G.save.achievements.push(a.id);
    G.persist();
    this.queue.push(a);
  }

  update(dt) {
    this.popTimer -= dt;
    if (this.popTimer <= 0) {
      this.popTimer = 2;
      this.check();
    }
    if (!this.showing && this.queue.length > 0) {
      const a = this.queue.shift();
      this.showing = { a, t: 4 };
      G.hud && G.hud.achievementPopup(a.icon, a.name, a.desc);
      G.audio && G.audio.ui('badge');
    }
    if (this.showing) {
      this.showing.t -= dt;
      if (this.showing.t <= 0) this.showing = null;
    }
  }

  list() { return ACHIEVEMENTS; }
  progress() { return { unlocked: this.unlocked.size, total: ACHIEVEMENTS.length }; }

  statsHTML() {
    const s = G.save.stats;
    const fmt = (n) => Math.floor(n).toLocaleString();
    const time = (sec) => { const m = Math.floor(sec / 60), h = Math.floor(m / 60); return h > 0 ? `${h}h ${m % 60}m` : `${m}m`; };
    let h = '<div class="stats-grid">';
    h += `<div>累计击杀</div><div>${fmt(s.kills)}</div>`;
    h += `<div>平民击杀</div><div>${fmt(s.civKills || 0)}</div>`;
    h += `<div>警察击杀</div><div>${fmt(s.copsKilled || 0)}</div>`;
    h += `<div>死亡次数</div><div>${fmt(s.deaths)}</div>`;
    h += `<div>被捕次数</div><div>${fmt(s.busted)}</div>`;
    h += `<div>最高通缉</div><div>${'⭐'.repeat(s.maxWanted)}</div>`;
    h += `<div>偷车次数</div><div>${fmt(s.carsStolen)}</div>`;
    h += `<div>车辆摧毁</div><div>${fmt(s.carsDestroyed || 0)}</div>`;
    h += `<div>最长漂移</div><div>${fmt(s.bestDrift)}m</div>`;
    h += `<div>漂移次数</div><div>${fmt(s.drifts || 0)}</div>`;
    h += `<div>比赛获胜</div><div>${fmt(s.racesWon)}</div>`;
    h += `<div>出租车载客</div><div>${fmt(s.taxiTrips || 0)}</div>`;
    h += `<div>救护车任务</div><div>${fmt(s.ambulanceTrips || 0)}</div>`;
    h += `<div>外卖配送</div><div>${fmt(s.deliveryTrips || 0)}</div>`;
    h += `<div>驾车距离</div><div>${fmt(s.distanceCar || 0)}m</div>`;
    h += `<div>步行距离</div><div>${fmt(s.distanceFoot || 0)}m</div>`;
    h += `<div>水上距离</div><div>${fmt(s.distanceWater || 0)}m</div>`;
    h += `<div>累计收入</div><div>$${fmt(s.totalEarned || 0)}</div>`;
    h += `<div>游戏时间</div><div>${time(s.playTime)}</div>`;
    h += '</div>';
    return h;
  }

  achievementsHTML() {
    let h = '<div class="achiev-grid">';
    for (const a of ACHIEVEMENTS) {
      const done = this.unlocked.has(a.id);
      h += `<div class="achiev-item ${done ? 'done' : ''}"><span class="achiev-icon">${done ? a.icon : '🔒'}</span><div><b>${a.name}</b><div class="desc">${a.desc}</div></div></div>`;
    }
    h += '</div>';
    const p = this.progress();
    h += `<p style="text-align:center;margin-top:12px">${p.unlocked} / ${p.total} 成就已解锁</p>`;
    return h;
  }
}
