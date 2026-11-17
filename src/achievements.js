// Original achievements (global text table 169–256): [title index, description index, test(game)].
const LIST = [
  [184, 185, (g) => g.police.level >= 5],
  [186, 187, (g) => ['bat', 'beretta', 'uzi', 'ak47', 'sniper', 'rpg'].every((k) => g.player.weapons[k])],
  [188, 189, (g) => (g.stats.driven || []).length >= 20],
  [191, 192, (g) => (g.stats.longestJump || 0) >= 100],
  [193, 194, (g) => (g.stats.ambulance || 0) >= 10],
  [195, 196, (g) => (g.stats.taxi || 0) >= 10],
  [197, 198, (g) => (g.stats.food || 0) >= 10],
  [211, 212, (g) => (g.stats.civKills || 0) >= 10],
  [213, 214, (g) => (g.stats.repairs || 0) >= 10],
  [215, 216, (g) => (g.stats.stolen || 0) >= 30],
  [219, 220, (g) => (g.stats.kills || 0) >= 100],
  [221, 222, (g) => (g.stats.carsDestroyed || 0) >= 50],
  [223, 224, (g) => (g.stats.kills || 0) >= 500],
  [225, 226, (g) => g.money >= 100000],
  [227, 228, (g) => g.money >= 500000],
  [229, 230, (g) => (g.collected || []).filter((c) => c.startsWith('wheel')).length >= 8],
  [231, 232, (g) => (g.collected || []).filter((c) => c.startsWith('surf')).length >= 8],
  [233, 234, (g) => (g.stats.copsKilled || 0) >= 30],
  ...[1, 2, 3, 4, 5].map((c) => [169 + c * 2, 170 + c * 2, (g) => g.missions && g.missions.list().filter((m) => m.chapter === c).every((m) => m.done) && g.missions.list().some((m) => m.chapter === c)]),
];

export class Achievements {
  constructor(game) {
    this.g = game;
    this.got = new Set(JSON.parse(localStorage.getItem('gm_achievements') || '[]'));
    this.t = 0;
  }

  update(dt) {
    const g = this.g;
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 1;
    const v = g.player.vehicle;
    if (v) {
      const d = g.stats.driven || (g.stats.driven = []);
      if (!d.includes(v.model)) d.push(v.model);
      if (!v.onGround) { v.airFrom = v.airFrom || v.pos.clone(); } else if (v.airFrom) {
        const jump = Math.hypot(v.pos.x - v.airFrom.x, v.pos.z - v.airFrom.z);
        g.stats.longestJump = Math.max(g.stats.longestJump || 0, jump);
        if (jump > 25) g.hud.notify(`${g.t('global', 86)}${Math.round(jump)} m`, 2);
        v.airFrom = null;
      }
    }
    for (const [ti, di, test] of LIST) {
      if (this.got.has(ti) || !test(g)) continue;
      this.got.add(ti);
      localStorage.setItem('gm_achievements', JSON.stringify([...this.got]));
      g.audio.play('int_trophy', { vol: 0.8 });
      g.hud.big(g.t('global', ti), `${g.t('global', 169)} · ${g.t('global', di)}`, 4);
      break;
    }
  }

  html() {
    const g = this.g;
    return LIST.map(([ti, di]) => `<div class="row"><span>${this.got.has(ti) ? '★' : '☆'} ${g.t('global', ti)}</span><small>${g.t('global', di)}</small></div>`).join('');
  }
}
