// Achievement/stats tracking inspired by Gangstar: Miami Vindication
import { G } from './state.js';

const ACHIEVEMENTS = [
  { id: 'ch1', name: '第一章', desc: '完成第一章', icon: '📖', check: () => G.save.mission >= 3 },
  { id: 'ch2', name: '第二章', desc: '完成第二章', icon: '📖', check: () => G.save.mission >= 6 },
  { id: 'ch3', name: '第三章', desc: '完成全部故事', icon: '📖', check: () => G.save.mission >= 9 },
  { id: 'psycho', name: '疯狂杀手', desc: '杀死 10 名行人', icon: '💀', check: () => (G.save.stats.civKills || 0) >= 10 },
  { id: 'serial', name: '连环杀手', desc: '累计击杀 100 人', icon: '☠️', check: () => G.save.stats.kills >= 100 },
  { id: 'grinder', name: '绞肉机', desc: '累计击杀 500 人', icon: '🔥', check: () => G.save.stats.kills >= 500 },
  { id: 'nra', name: '武器大师', desc: '拥有所有武器', icon: '🎯', check: () => { const w = G.save.weapons; return w.pistol && w.smg && w.shotgun && w.rifle && w.rocket && w.bat && w.flamethrower; } },
  { id: 'pyro', name: '纵火犯', desc: '烧死 30 人', icon: '🔥', check: () => (G.save.stats.peopleBurnt || 0) >= 30 },
  { id: 'bacon', name: '闻到培根味了', desc: '消灭 30 名警察', icon: '🥓', check: () => (G.save.stats.copsKilled || 0) >= 30 },
  { id: 'carlover', name: '爱车一族', desc: '驾驶过 10 种不同的车', icon: '🚗', check: () => Object.keys(G.save.stats.vehiclesDriven || {}).length >= 10 },
  { id: 'stuntman', name: '特技演员', desc: '完成 100 米的飞车跳跃', icon: '🏍️', check: () => (G.save.stats.longestJump || 0) >= 100 },
  { id: 'wheelie', name: '翘头王', desc: '完成 50 米的翘头', icon: '🏍️', check: () => (G.save.stats.longestWheelie || 0) >= 50 },
  { id: 'rubber', name: '橡胶味', desc: '漂移 30 次', icon: '🏎️', check: () => (G.save.stats.drifts || 0) >= 30 },
  { id: 'thief', name: '偷车大盗', desc: '偷 30 辆车', icon: '🔑', check: () => G.save.stats.carsStolen >= 30 },
  { id: 'breaker', name: '车辆终结者', desc: '摧毁 50 辆车', icon: '💥', check: () => (G.save.stats.carsDestroyed || 0) >= 50 },
  { id: 'trust', name: '信托基金', desc: '累计赚到 $100,000', icon: '💰', check: () => (G.save.stats.totalEarned || 0) >= 100000 },
  { id: 'ceo', name: '银行 CEO', desc: '累计赚到 $500,000', icon: '🏦', check: () => (G.save.stats.totalEarned || 0) >= 500000 },
  { id: 'taxidriver', name: '出租车司机', desc: '完成 10 次出租车载客', icon: '🚕', check: () => (G.save.stats.taxiTrips || 0) >= 10 },
  { id: 'medic', name: '急救员', desc: '完成 10 次救护车任务', icon: '🚑', check: () => (G.save.stats.ambulanceTrips || 0) >= 10 },
  { id: 'delivery', name: '快递小哥', desc: '完成 10 次外卖配送', icon: '🍔', check: () => (G.save.stats.deliveryTrips || 0) >= 10 },
  { id: 'racer', name: '赛车手', desc: '赢得 5 场街头赛', icon: '🏁', check: () => G.save.stats.racesWon >= 5 },
  { id: 'badges', name: '徽章收藏家', desc: '收集全部霓虹徽章', icon: '💎', check: () => G.save.badges.length >= 25 },
  { id: 'surf', name: '冲浪达人', desc: '收集全部冲浪板', icon: '🏄', check: () => (G.save.surfboards || []).length >= 15 },
  { id: 'rims', name: '轮毂狂人', desc: '收集全部特殊轮毂', icon: '🛞', check: () => (G.save.wheels || []).length >= 15 },
  { id: 'gangstar', name: '孤胆车神', desc: '达到 5 星通缉等级', icon: '⭐', check: () => G.save.stats.maxWanted >= 5 },
  { id: 'sailor', name: '水手之心', desc: '驾船行驶 2 公里', icon: '⛵', check: () => (G.save.stats.distanceWater || 0) >= 2000 },
  { id: 'hiker', name: '城市徒步者', desc: '步行 2 公里', icon: '🚶', check: () => (G.save.stats.distanceFoot || 0) >= 2000 },
  { id: 'roadtrip', name: '公路旅行', desc: '驾车行驶 5 公里', icon: '🛣️', check: () => (G.save.stats.distanceCar || 0) >= 5000 },
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
