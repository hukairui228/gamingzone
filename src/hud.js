import { WEAPONS } from './player.js';

const TEX = './assets/tex/';
// rects in the original huds.webp atlas (1024x1024)
const ICONS = {
  fist: [670, 62, 92, 76], bat: [566, 4, 140, 52], beretta: [893, 88, 105, 62], uzi: [606, 148, 96, 70],
  ak47: [724, 148, 134, 66], sniper: [496, 316, 120, 52], rpg: [862, 166, 150, 56],
};
const RING = [184, 0, 136, 132];
// dialogue portraits from the original character art sheets
export const PORTRAITS = {
  罗斯科: ['characters1', 0, 0, 340, 420], 贝蒂: ['characters1', 340, 0, 340, 420], 波拉诺: ['characters1', 680, 0, 344, 420],
  莫尼克: ['characters1', 0, 420, 340, 420], 维加: ['characters1', 340, 420, 340, 420], 乔伊: ['characters1', 680, 420, 344, 420],
  强尼: ['characters2', 0, 0, 340, 440], 赫尔曼: ['characters2', 340, 0, 340, 440], 汤米: ['characters2', 680, 0, 344, 440],
  阿梅利亚: ['characters2', 0, 440, 280, 420], LC: ['characters2', 260, 440, 300, 420],
};

function sprite(el, [x, y, w, h], scale, file = 'huds') {
  el.style.backgroundImage = `url(${TEX}${file}.webp)`;
  el.style.backgroundSize = `${1024 * scale}px ${1024 * scale}px`;
  el.style.backgroundPosition = `${-x * scale}px ${-y * scale}px`;
  el.style.width = w * scale + 'px';
  el.style.height = h * scale + 'px';
}

/** Rich text from the original tables: \0..\1 highlights, | line breaks. */
export function fmt(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/\\0|\u0000/g, '<b>').replace(/\\1|\u0001/g, '</b>').replace(/\|/g, '<br>');
}

export class Hud {
  constructor(game) {
    this.g = game;
    const ui = document.getElementById('ui');
    ui.innerHTML = `
      <div id="hud" class="hidden">
        <div id="radar"><canvas width="360" height="360"></canvas><div class="ring"></div><div class="north">N</div></div>
        <div id="bars"><div class="bar hp"><i></i></div><div class="bar ar"><i></i></div></div>
        <div id="topright">
          <div id="weapon"><div class="icon"></div><div class="ammo"></div></div>
          <div id="money">$0</div>
          <div id="wanted"></div>
        </div>
        <div id="objective"></div>
        <div id="notify"></div>
        <div id="big"></div>
        <div id="timer"></div>
        <div id="speedo"></div>
        <div id="crosshair"></div>
        <div id="damage"></div>
      </div>
      <div id="dialog" class="hidden"><div class="portrait"></div><div class="box"><div class="who"></div><div class="line"></div><div class="hint">点击 / 空格 继续</div></div></div>
      <div id="mapview" class="hidden"><div class="mapwrap"><img src="${TEX}minimap_map.webp"><canvas width="1024" height="1024"></canvas></div><div class="legend">M / Tab 关闭 · 点击地图设置导航点</div></div>
      <div id="screen" class="hidden"></div>
      <div id="loading"><div class="logo"><span>GANGSTAR</span><small>孤胆车神：雄霸迈阿密</small></div><div class="msg">正在载入原版素材…</div><div class="prog"><i></i></div></div>`;
    this.el = (s) => ui.querySelector(s);
    this.hud = this.el('#hud');
    this.radar = this.el('#radar canvas').getContext('2d');
    sprite(this.el('#radar .ring'), RING, 1.42);
    this.mapImg = new Image();
    this.mapImg.src = TEX + 'minimap_map.webp';
    this.notifyT = 0;
    this.bigT = 0;
    this.route = null;
    this.blips = [];
    this.lastWeapon = '';
    this.el('#mapview canvas').addEventListener('click', (e) => {
      const r = e.target.getBoundingClientRect();
      const M = this.g.roads.map;
      const u = (e.clientX - r.left) / r.width * M.size, v = (e.clientY - r.top) / r.height * M.size;
      this.g.setWaypoint(M.x0 + u * M.scale, M.z0 + v * M.scale);
      this.drawBigMap();
    });
  }

  loading(p, msg) {
    this.el('#loading .prog i').style.width = Math.round(p * 100) + '%';
    if (msg) this.el('#loading .msg').textContent = msg;
    if (p >= 1) setTimeout(() => this.el('#loading').classList.add('hidden'), 300);
  }

  show(on) { this.hud.classList.toggle('hidden', !on); }

  notify(text, t = 2.5) {
    const n = this.el('#notify');
    n.innerHTML = fmt(text);
    n.classList.add('on');
    this.notifyT = t;
  }

  /** Big centred banner like the original "任务完成" / "你已严重受伤". */
  big(text, sub = '', t = 3, cls = '') {
    const b = this.el('#big');
    b.className = 'on ' + cls;
    b.innerHTML = `<div>${fmt(text)}</div>${sub ? `<small>${fmt(sub)}</small>` : ''}`;
    this.bigT = t;
  }

  objective(text) {
    const o = this.el('#objective');
    o.innerHTML = text ? fmt(text) : '';
    o.classList.toggle('on', !!text);
  }

  timer(sec) {
    const t = this.el('#timer');
    if (sec == null) { t.textContent = ''; return; }
    const s = Math.max(0, Math.ceil(sec));
    t.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  damageFlash(a) {
    const d = this.el('#damage');
    d.style.transition = 'none'; d.style.opacity = Math.min(0.85, a + 0.25);
    requestAnimationFrame(() => { d.style.transition = 'opacity .8s'; d.style.opacity = 0; });
  }

  /** Sequential dialogue with portraits; resolves when finished. lines: [[speaker, text], ...] */
  dialog(lines) {
    return new Promise((resolve) => {
      const box = this.el('#dialog');
      let i = 0;
      const step = () => {
        if (i >= lines.length) { box.classList.add('hidden'); cleanup(); resolve(); return; }
        const [who, text, voice] = lines[i++];
        box.classList.remove('hidden');
        this.el('#dialog .who').textContent = who || '';
        this.el('#dialog .line').innerHTML = fmt(text);
        const p = this.el('#dialog .portrait');
        const r = PORTRAITS[who];
        if (r) { p.style.display = ''; sprite(p, r.slice(1), 0.42, r[0]); } else p.style.display = 'none';
        box.classList.toggle('right', who !== '强尼');
        if (voice) this.g.audio.play(voice, { vol: 0.9 });
        this.g.audio.play('int_tutorial_appear', { vol: 0.25 });
      };
      const key = (e) => { if (['Space', 'Enter', 'KeyF'].includes(e.code)) { e.preventDefault(); step(); } };
      const click = () => step();
      const cleanup = () => { removeEventListener('keydown', key); box.removeEventListener('pointerdown', click); };
      addEventListener('keydown', key);
      box.addEventListener('pointerdown', click);
      step();
    });
  }

  screen(html) {
    const s = this.el('#screen');
    s.innerHTML = html;
    s.classList.toggle('hidden', !html);
    return s;
  }

  toggleMap(on) {
    const m = this.el('#mapview');
    m.classList.toggle('hidden', !on);
    if (on) this.drawBigMap();
  }

  drawBigMap() {
    const g = this.g, M = g.roads.map, c = this.el('#mapview canvas').getContext('2d');
    c.clearRect(0, 0, 1024, 1024);
    const toMap = (x, z) => [(x - M.x0) / M.scale, (z - M.z0) / M.scale];
    if (this.route) {
      c.strokeStyle = '#ff2fb0'; c.lineWidth = 5; c.beginPath();
      this.route.forEach(([x, z], i) => { const [u, v] = toMap(x, z); i ? c.lineTo(u, v) : c.moveTo(u, v); });
      c.stroke();
    }
    for (const b of this.blips) {
      const [u, v] = toMap(b.x, b.z);
      c.fillStyle = b.color; c.strokeStyle = '#000'; c.lineWidth = 3;
      c.beginPath(); c.arc(u, v, 11, 0, 7); c.fill(); c.stroke();
      if (b.label) { c.font = 'bold 22px sans-serif'; c.fillStyle = '#fff'; c.strokeText(b.label, u + 14, v + 7); c.fillText(b.label, u + 14, v + 7); }
    }
    const p = g.focus, [u, v] = toMap(p.x, p.z);
    c.save(); c.translate(u, v); c.rotate(-g.camera.yaw + Math.PI);
    c.fillStyle = '#fff'; c.strokeStyle = '#000'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(0, -18); c.lineTo(12, 14); c.lineTo(0, 7); c.lineTo(-12, 14); c.closePath(); c.fill(); c.stroke();
    c.restore();
  }

  drawRadar() {
    const g = this.g, M = g.roads.map, c = this.radar, S = 360;
    const p = g.focus, zoom = 1.6 + Math.min(1.2, (g.player.vehicle ? g.player.vehicle.speed : 0) / 30);
    const rot = g.camera.yaw + Math.PI;
    c.save();
    c.clearRect(0, 0, S, S);
    c.beginPath(); c.arc(S / 2, S / 2, S / 2 - 6, 0, 7); c.clip();
    c.fillStyle = '#63a09f'; c.fillRect(0, 0, S, S);
    c.translate(S / 2, S / 2);
    c.rotate(rot);
    c.scale(zoom, zoom);
    const u = (p.x - M.x0) / M.scale, v = (p.z - M.z0) / M.scale;
    if (this.mapImg.complete) c.drawImage(this.mapImg, -u, -v);
    if (this.route) {
      c.strokeStyle = '#ff2fb0'; c.lineWidth = 3.5 / zoom * 1.6; c.beginPath();
      this.route.forEach(([x, z], i) => { const a = (x - M.x0) / M.scale - u, b = (z - M.z0) / M.scale - v; i ? c.lineTo(a, b) : c.moveTo(a, b); });
      c.stroke();
    }
    c.restore();
    // blips (clamped to the rim)
    for (const b of this.blips) {
      let dx = ((b.x - M.x0) / M.scale - u) * zoom, dy = ((b.z - M.z0) / M.scale - v) * zoom;
      const cr = Math.cos(rot), sr = Math.sin(rot);
      let rx = dx * cr - dy * sr, ry = dx * sr + dy * cr;
      const L = Math.hypot(rx, ry), R = S / 2 - 18;
      if (L > R) { rx *= R / L; ry *= R / L; }
      c.fillStyle = b.color; c.strokeStyle = '#000'; c.lineWidth = 3;
      c.beginPath(); c.arc(S / 2 + rx, S / 2 + ry, b.small ? 6 : 10, 0, 7); c.fill(); c.stroke();
    }
    c.fillStyle = '#fff'; c.strokeStyle = '#000'; c.lineWidth = 3;
    c.save(); c.translate(S / 2, S / 2);
    c.rotate(rot - (g.player.vehicle ? g.player.vehicle.yaw : g.player.yaw) - Math.PI);
    c.beginPath(); c.moveTo(0, -16); c.lineTo(11, 12); c.lineTo(0, 6); c.lineTo(-11, 12); c.closePath(); c.fill(); c.stroke();
    c.restore();
    this.el('#radar .north').style.transform = `rotate(${rot}rad) translateY(-80px) rotate(${-rot}rad)`;
  }

  update(dt) {
    const g = this.g, pl = g.player;
    this.notifyT -= dt;
    if (this.notifyT <= 0) this.el('#notify').classList.remove('on');
    this.bigT -= dt;
    if (this.bigT <= 0) this.el('#big').classList.remove('on');
    this.el('.bar.hp i').style.width = Math.max(0, pl.health) + '%';
    this.el('.bar.ar i').style.width = Math.max(0, pl.armor) + '%';
    this.el('.bar.ar').style.display = pl.armor > 0 ? '' : 'none';
    this.el('#money').textContent = '$' + Math.floor(g.money).toLocaleString('en-US');
    const lv = g.police.level;
    this.el('#wanted').innerHTML = lv ? Array.from({ length: 5 }, (_, i) => `<span class="${i < lv ? 'on' : ''}">★</span>`).join('') : '';
    if (this.lastWeapon !== pl.weapon) {
      this.lastWeapon = pl.weapon;
      sprite(this.el('#weapon .icon'), ICONS[pl.weapon], 0.9);
    }
    const w = WEAPONS[pl.weapon], slot = pl.weapons[pl.weapon];
    this.el('#weapon .ammo').textContent = w.melee ? '' : `${slot.clip} / ${slot.ammo}`;
    const aiming = !pl.vehicle && !w.melee && (g.ctl.aim || g.ctl.fire);
    const ch = this.el('#crosshair');
    ch.className = aiming ? (w.scope ? 'scope' : 'on') : '';
    const sp = this.el('#speedo');
    sp.textContent = pl.vehicle ? `${Math.round(pl.vehicle.speed * 3.6)} km/h` : '';
    this.drawRadar();
  }
}
