import { json, assetURL } from './assets.js';

// HUD rebuilt from the original huds.bsprite: every element is an original atlas module placed at the
// original screen position, anchored to its screen corner and scaled to the viewport.
const W0 = 1024, H0 = 768; // the iPad HD layout the sprite positions were authored for

// original weapon icon frames (module, x, y) inside the weapon box
const WEAPON_ICON = {
  fist: [121, 868, 63], bat: [132, 835, 84], beretta: [122, 873, 67], uzi: [123, 867, 64],
  ak47: [124, 854, 70], sniper: [126, 860, 75], rpg: [125, 842, 72],
};
// digit sprites: small white "1234567890/", big white/green/red "1234567890$,." (+ / -)
const SMALL = { 1: 67, 2: 68, 3: 69, 4: 70, 5: 71, 6: 72, 7: 73, 8: 74, 9: 75, 0: 76, '/': 66 };
const BIG = {
  white: { 1: 78, 2: 79, 3: 80, 4: 81, 5: 82, 6: 83, 7: 84, 8: 85, 9: 86, 0: 87, $: 77, ',': 88, '.': 89 },
  green: { 1: 91, 2: 92, 3: 93, 4: 94, 5: 95, 6: 96, 7: 97, 8: 98, 9: 99, 0: 100, $: 90, ',': 101, '.': 102, '+': 103 },
  red: { 1: 105, 2: 106, 3: 107, 4: 108, 5: 109, 6: 110, 7: 111, 8: 112, 9: 113, 0: 114, $: 104, ',': 115, '.': 116, '-': 117 },
};
// radio station name plates (huds modules 146–151) in STATIONS order: 80s, electro, hiphop, latino, rock
const RADIO_PLATE = [146, 149, 150, 147, 148];
// minimap icons by blip colour
const ICON = { '#ffd23c': 42, '#ff2a2a': 44, '#3fd4ff': 55, '#ff2fb0': 41, '#ff9a1f': 54, '#9aff5a': 56, '#c77dff': 55, house: 52, side: 45, badge: 57 };

/** Rich text from the original tables: \0..\1 highlights, | line breaks. */
export function fmt(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/\\0|\u0000/g, '<b>').replace(/\\1|\u0001/g, '</b>').replace(/\|/g, '<br>').replace(/\\n/g, '<br>');
}

export class Hud {
  constructor(game) {
    this.g = game;
    const ui = document.getElementById('ui');
    ui.innerHTML = `
      <div id="hud" class="hidden"></div>
      <div id="banner"><div class="txt"></div></div>
      <div id="msg"><div class="txt"></div></div>
      <div id="objective"></div>
      <div id="letterbox" class="hidden"><div class="top"></div><div class="bottom"><div class="who"></div><div class="line"></div></div><div class="skip"></div></div>
      <div id="overlay"></div>
      <div id="damage"></div>
      <div id="crosshair"></div>
      <div id="mapview" class="hidden"><button class="mapclose" type="button" aria-label="关闭地图">✕</button><div class="mapwrap"><img data-asset="tex/minimap_map.webp"><canvas width="1024" height="1024"></canvas></div><div class="legend"></div></div>
      <div id="screen" class="hidden"></div>
      <div id="loading"><img data-asset="tex/title.webp"><div class="bar"><i></i></div><div class="msg">正在载入…</div></div>`;
    this.ui = ui;
    this.el = (s) => ui.querySelector(s);
    this.hud = this.el('#hud');
    this.mapImg = new Image();
    assetURL('tex/minimap_map.webp').then((u) => { this.mapImg.src = u; });
    for (const img of ui.querySelectorAll('img[data-asset]')) assetURL(img.dataset.asset).then((u) => { img.src = u; });
    // images used from CSS + the original fonts, resolved through the asset packs
    const root = document.documentElement.style;
    for (const [v, f] of [['--huds', 'tex/huds.webp'], ['--cin', 'tex/cinematics_hud.webp'], ['--title', 'tex/title.webp']])
      assetURL(f).then((u) => root.setProperty(v, `url("${u}")`));
    for (const [f, range] of [['fonts/font_latin.ttf', 'U+0000-024F'], ['fonts/font_chinese.ttf', undefined]]) {
      assetURL(f).then((u) => fetch(u)).then((r) => r.arrayBuffer()).then((buf) => {
        const face = new FontFace('GLFont', buf, range ? { unicodeRange: range } : {});
        document.fonts.add(face);
        return face.load();
      }).catch(() => {});
    }
    this.route = null;
    this.blips = [];
    this.parts = {};
    this.lastMoney = null;
    this.popups = [];
    this.bannerT = 0; this.msgT = 0;
    // close: the ✕ button, or a tap on the dark area around the map (touch screens have no M / Esc key)
    this.el('#mapview').addEventListener('click', (e) => {
      if (e.target.closest('.mapwrap')) return;
      this.g.mapOpen = false; this.toggleMap(false);
    });
    this.el('#mapview canvas').addEventListener('click', (e) => {
      const r = e.target.getBoundingClientRect();
      const M = this.g.roads.map;
      const u = (e.clientX - r.left) / r.width * M.size, v = (e.clientY - r.top) / r.height * M.size;
      this.g.setWaypoint(M.x0 + u * M.scale, M.z0 + v * M.scale);
      this.drawBigMap();
    });
    this.ready = json('ui/huds.json').then((s) => { this.sprite = s; this.build(); });
    addEventListener('resize', () => this.layout());
  }

  // ------------------------------------------------------------ sprite helpers
  /** div showing atlas module m; anchor: which screen corner the original x,y is relative to */
  mod(m, x, y, { anchor = 'tl', flip = 0, parent = this.hud, cls = '' } = {}) {
    const d = document.createElement('div');
    d.className = 'spr ' + cls;
    this.paint(d, m, flip);
    d.dataset.x = x; d.dataset.y = y; d.dataset.a = anchor;
    parent.appendChild(d);
    this.items.push(d);
    return d;
  }

  paint(d, m, flip = 0) {
    const [mx, my, mw, mh] = this.sprite.modules[m];
    d.style.width = mw + 'px'; d.style.height = mh + 'px';
    d.style.backgroundPosition = `${-mx}px ${-my}px`;
    d.style.transform = `scale(${flip & 256 ? -1 : 1}, ${flip & 512 ? -1 : 1})`;
    d.dataset.w = mw; d.dataset.h = mh;
  }

  /** all modules of an original frame as one group */
  frame(i, anchor, parent) {
    return this.sprite.frames[i].map(([m, x, y, fl]) => this.mod(m, x, y, { anchor, flip: fl, parent }));
  }

  build() {
    const H = this.hud;
    H.innerHTML = '';
    this.items = [];
    // minimap (frame 5 border pieces around the map window)
    const mm = document.createElement('div');
    mm.id = 'minimap'; mm.dataset.x = 23; mm.dataset.y = 24; mm.dataset.a = 'tl'; mm.dataset.w = 154; mm.dataset.h = 152;
    mm.innerHTML = '<canvas width="308" height="304"></canvas>';
    H.appendChild(mm); this.items.push(mm);
    this.radar = mm.querySelector('canvas').getContext('2d');
    this.frame(5, 'tl');
    this.north = this.mod(40, 0, 0, { cls: 'north' });
    mm.addEventListener('pointerdown', () => { this.g.mapOpen = !this.g.mapOpen; this.toggleMap(this.g.mapOpen); });
    // radio panel (frames 152/153) + station plate
    this.radio = [this.mod(61, 216, 22), this.mod(62, 393, 22), this.mod(146, 282, 38, { cls: 'plate' })];
    this.radio[1].addEventListener('pointerdown', () => this.g.hud.notify(this.g.audio.cycleStation(), 1.5));
    // health / armour / vehicle bars (frames 26–31, 120–122)
    this.bar1 = [this.mod(26, 798, 17, { anchor: 'tr' }), this.mod(21, 798, 17, { anchor: 'tr', cls: 'fill' }), this.mod(27, 989, 13, { anchor: 'tr' })];
    this.bar2 = [this.mod(26, 797, 34, { anchor: 'tr' }), this.mod(25, 797, 34, { anchor: 'tr', cls: 'fill' }), this.mod(31, 989, 31, { anchor: 'tr' })];
    // weapon box with switch arrows (frame 4)
    const [, la, ra] = this.frame(4, 'tr');
    la.addEventListener('pointerdown', () => { if (!this.g.player.vehicle) this.g.player.nextWeapon(); });
    ra.addEventListener('pointerdown', () => { if (!this.g.player.vehicle) this.g.player.nextWeapon(); });
    this.weaponIcon = this.mod(121, 868, 63, { anchor: 'tr', cls: 'wicon' });
    this.ammo = this.group(904, 112, 'tr');
    // wanted level: police badges (frames 32–36)
    this.badges = [0, 1, 2, 3, 4].map((k) => this.mod(32, 850 + 26 * k, 148, { anchor: 'tr', cls: 'badge' }));
    // money (original white digit font) under the badges
    this.money = this.group(975, 176, 'tr', 'right');
    this.timerEl = this.group(480, 96, 'tc', 'center');
    this.layout();
  }

  /** container for runs of digit sprites */
  group(x, y, anchor, align = 'left') {
    const d = document.createElement('div');
    d.className = 'digits ' + align;
    d.dataset.x = x; d.dataset.y = y; d.dataset.a = anchor; d.dataset.w = 0; d.dataset.h = 26;
    this.hud.appendChild(d); this.items.push(d);
    return d;
  }

  digits(el, text, set = 'white', small = false) {
    if (el._text === text) return;
    el._text = text;
    el.innerHTML = '';
    const map = small ? SMALL : BIG[set];
    for (const ch of String(text)) {
      const m = map[ch];
      if (m === undefined) continue;
      const s = document.createElement('i');
      s.className = 'spr';
      this.paint(s, m);
      el.appendChild(s);
    }
  }

  get scale() {
    const s = Math.min(innerWidth / W0, innerHeight / H0);
    return Math.max(0.5, Math.min(1.35, s * (this.g.settings?.hudScale || 1)));
  }

  /** safe-area insets (notch / Dynamic Island) in px */
  insets() {
    if (!this.probe) {
      this.probe = document.createElement('div');
      this.probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
      document.body.appendChild(this.probe);
    }
    const cs = getComputedStyle(this.probe);
    return { t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0, b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0 };
  }

  layout() {
    if (!this.items) return;
    const s = this.scale;
    const ins = this._ins = this.insets();
    this.hud.style.setProperty('--s', s);
    for (const d of this.items) {
      const x = +d.dataset.x, y = +d.dataset.y, a = d.dataset.a;
      // k > 1 (touch controls) scales a whole cluster about its screen corner, so buttons never overlap
      const zs = s * +(d.dataset.k || 1);
      let px = x * zs + ins.l, py = y * zs + ins.t;
      if (a[1] === 'r') px = innerWidth - ins.r - (W0 - x) * zs;
      if (a[1] === 'c') px = innerWidth / 2 + (x - W0 / 2) * zs;
      if (a[0] === 'b') py = innerHeight - ins.b - (H0 - y) * zs;
      if (d.id === 'minimap') { d.style.left = px + 'px'; d.style.top = py + 'px'; d.style.width = d.dataset.w * s + 'px'; d.style.height = d.dataset.h * s + 'px'; }
      else { d.style.zoom = zs; d.style.left = px / zs + 'px'; d.style.top = py / zs + 'px'; }
    }
  }

  // ------------------------------------------------------------ screens / text
  loading(p, msg) {
    this.el('#loading .bar i').style.width = Math.round(p * 100) + '%';
    if (msg) this.el('#loading .msg').textContent = msg;
    if (p >= 1) setTimeout(() => this.el('#loading').classList.add('hidden'), 300);
  }

  show(on) {
    this.hud.classList.toggle('hidden', !on);
    document.getElementById('touch')?.classList.toggle('hidden', !on);
  }

  /** original message box sliding in from the left (huds frame 142–147) */
  notify(text, t = 2.5) {
    const m = this.el('#msg');
    m.querySelector('.txt').innerHTML = fmt(text);
    m.classList.add('on');
    this.msgT = t;
  }

  /** original wide banner sliding in (huds frames 53–58): mission titles, 任务完成, 你已严重受伤… */
  big(text, sub = '', t = 3, cls = '') {
    const b = this.el('#banner');
    b.className = 'on ' + cls;
    b.querySelector('.txt').innerHTML = `${fmt(text)}${sub ? `<small>${fmt(sub)}</small>` : ''}`;
    this.bannerT = t;
    if (cls === 'red') this.overlay(this.g.player.dead && /被捕/.test(text) ? 'glass' : 'blood');
  }

  overlay(kind) {
    const o = this.el('#overlay');
    o.className = kind ? 'on ' + kind : '';
    if (kind) setTimeout(() => { o.className = ''; }, 4200);
  }

  objective(text) {
    const o = this.el('#objective');
    o.innerHTML = text ? fmt(text) : '';
    o.classList.toggle('on', !!text);
    if (text && text !== this.lastObjective) this.notify(text, 3.5);
    this.lastObjective = text;
  }

  timer(sec) {
    if (!this.timerEl) return;
    if (sec == null) { this.digits(this.timerEl, ''); return; }
    const s = Math.max(0, Math.ceil(sec));
    this.digits(this.timerEl, `${Math.floor(s / 60)}.${String(s % 60).padStart(2, '0')}`, s <= 10 ? 'red' : 'white');
  }

  damageFlash(a) {
    const d = this.el('#damage');
    d.style.transition = 'none'; d.style.opacity = Math.min(0.85, a + 0.25);
    requestAnimationFrame(() => { d.style.transition = 'opacity .8s'; d.style.opacity = 0; });
  }

  /** Cut-scene dialogue: letterbox bars with subtitles, like the original cinematics HUD. */
  dialog(lines) {
    return new Promise((resolve) => {
      const box = this.el('#letterbox');
      let i = 0;
      const step = () => {
        if (i >= lines.length) { box.classList.add('hidden'); this.hud.classList.remove('cine'); cleanup(); resolve(); return; }
        const [who, text, voice] = lines[i++];
        box.classList.remove('hidden');
        this.hud.classList.add('cine');
        box.querySelector('.who').textContent = who || '';
        box.querySelector('.line').innerHTML = fmt(text);
        if (this.voice) try { this.voice.stop(); } catch { /* ended */ }
        this.voice = null;
        if (voice) this.g.audio.play(voice, { vol: 0.95 }).then((s) => { this.voice = s; });
      };
      const key = (e) => { if (['Space', 'Enter', 'KeyF'].includes(e.code)) { e.preventDefault(); step(); } };
      const click = () => step();
      const cleanup = () => { removeEventListener('keydown', key); box.removeEventListener('pointerdown', click); };
      addEventListener('keydown', key);
      box.addEventListener('pointerdown', click);
      step();
    });
  }

  screen(html, cls = '') {
    const s = this.el('#screen');
    s.innerHTML = html;
    s.className = html ? cls : 'hidden';
    return s;
  }

  toggleMap(on) {
    const m = this.el('#mapview');
    m.classList.toggle('hidden', !on);
    m.querySelector('.legend').textContent = `${this.g.t('menu', 91)} · 点击地图设置导航点 · 点 ✕ 或空白处关闭`;
    if (on) this.drawBigMap();
  }

  iconFor(b) {
    return b.icon ?? ICON[b.color] ?? null;
  }

  drawIcon(c, m, x, y, k = 1) {
    if (!this.atlas) { this.atlas = new Image(); assetURL('tex/huds.webp').then((u) => { this.atlas.src = u; }); }
    if (!this.atlas.complete) return;
    const [mx, my, mw, mh] = this.sprite.modules[m];
    c.drawImage(this.atlas, mx, my, mw, mh, x - mw * k / 2, y - mh * k / 2, mw * k, mh * k);
  }

  drawBigMap() {
    const g = this.g, M = g.roads.map, c = this.el('#mapview canvas').getContext('2d');
    c.clearRect(0, 0, 1024, 1024);
    const toMap = (x, z) => [(x - M.x0) / M.scale, (z - M.z0) / M.scale];
    if (this.route) {
      c.strokeStyle = '#ff2fb0'; c.lineWidth = 6; c.lineJoin = 'round'; c.beginPath();
      this.route.forEach(([x, z], i) => { const [u, v] = toMap(x, z); i ? c.lineTo(u, v) : c.moveTo(u, v); });
      c.stroke();
    }
    for (const b of this.blips) {
      const [u, v] = toMap(b.x, b.z), ic = this.iconFor(b);
      if (ic != null && this.sprite) this.drawIcon(c, ic, u, v, 1.4);
      else { c.fillStyle = b.color; c.beginPath(); c.arc(u, v, 9, 0, 7); c.fill(); }
      if (b.label) { c.font = '22px GLFont, sans-serif'; c.lineWidth = 4; c.strokeStyle = '#000'; c.fillStyle = '#fff'; c.strokeText(b.label, u + 18, v + 8); c.fillText(b.label, u + 18, v + 8); }
    }
    const p = g.focus, [u, v] = toMap(p.x, p.z);
    c.save(); c.translate(u, v); c.rotate(Math.PI - (g.player.vehicle ? g.player.vehicle.yaw : g.player.yaw));
    if (this.sprite) this.drawIcon(c, 38, 0, 0, 1.8);
    c.restore();
  }

  drawRadar() {
    const g = this.g, M = g.roads.map, c = this.radar, S = 308, SH = 304;
    const p = g.focus, zoom = 2.2 + Math.min(1.4, (g.player.vehicle ? g.player.vehicle.speed : 0) / 25);
    const rot = g.camera.yaw + Math.PI;
    const u = (p.x - M.x0) / M.scale, v = (p.z - M.z0) / M.scale;
    c.save();
    c.fillStyle = '#5f9c9b'; c.fillRect(0, 0, S, SH);
    c.translate(S / 2, SH / 2); c.rotate(rot); c.scale(zoom, zoom);
    if (this.mapImg.complete) c.drawImage(this.mapImg, -u, -v);
    if (this.route) {
      c.strokeStyle = '#ff2fb0'; c.lineWidth = 3 / zoom * 2.2; c.lineJoin = 'round'; c.beginPath();
      this.route.forEach(([x, z], i) => { const a = (x - M.x0) / M.scale - u, b = (z - M.z0) / M.scale - v; i ? c.lineTo(a, b) : c.moveTo(a, b); });
      c.stroke();
    }
    c.restore();
    const cr = Math.cos(rot), sr = Math.sin(rot), lim = S / 2 - 16;
    for (const b of this.blips) {
      const dx = ((b.x - M.x0) / M.scale - u) * zoom, dy = ((b.z - M.z0) / M.scale - v) * zoom;
      let rx = dx * cr - dy * sr, ry = dx * sr + dy * cr;
      const m = Math.max(Math.abs(rx), Math.abs(ry));
      if (m > lim) { rx *= lim / m; ry *= lim / m; }
      const ic = this.iconFor(b);
      if (ic != null) this.drawIcon(c, ic, S / 2 + rx, SH / 2 + ry, b.small ? 1.0 : 1.3);
      else { c.fillStyle = b.color; c.strokeStyle = '#000'; c.lineWidth = 3; c.beginPath(); c.arc(S / 2 + rx, SH / 2 + ry, 8, 0, 7); c.fill(); c.stroke(); }
    }
    // player: the original red arrow
    c.save(); c.translate(S / 2, SH / 2);
    c.rotate(rot - (g.player.vehicle ? g.player.vehicle.yaw : g.player.yaw) - Math.PI);
    this.drawIcon(c, 38, 0, 0, 1.9);
    c.restore();
    // "N" rides the frame edge
    const nx = -sr, ny = -cr, k = 1 / Math.max(Math.abs(nx), Math.abs(ny));
    this.north.dataset.x = 23 + 77 + nx * k * 80 - 13;
    this.north.dataset.y = 24 + 76 + ny * k * 80 - 15;
  }

  // ------------------------------------------------------------ per-frame
  update(dt) {
    const g = this.g, pl = g.player;
    if (!this.items) return;
    this.msgT -= dt; if (this.msgT <= 0) this.el('#msg').classList.remove('on');
    this.bannerT -= dt; if (this.bannerT <= 0) this.el('#banner').classList.remove('on');
    const v = pl.vehicle;
    // bars: on foot health + armour, in a vehicle the vehicle bar (purple, car icon) + health
    const vmax = v ? (v.type === 'bike' ? 500 : 1000) : 1;
    const row1 = v ? Math.max(0, v.health) / vmax : Math.max(0, pl.health) / 100;
    const row2 = v ? Math.max(0, pl.health) / 100 : Math.max(0, pl.armor) / 100;
    if (this.inVeh !== !!v) {
      this.inVeh = !!v;
      this.paint(this.bar1[1], v ? 24 : 21); this.paint(this.bar1[2], v ? 28 : 27);
      this.paint(this.bar2[1], v ? 21 : 25); this.paint(this.bar2[2], v ? 27 : 31);
    }
    this.bar1[1].style.clipPath = `inset(0 ${100 - row1 * 100}% 0 0)`;
    this.bar2[1].style.clipPath = `inset(0 ${100 - row2 * 100}% 0 0)`;
    for (const e of this.bar2) e.style.display = v || pl.armor > 0 ? '' : 'none';
    // radio
    const st = g.audio.station;
    for (const e of this.radio) e.style.display = v ? '' : 'none';
    if (v && this.station !== st) {
      this.station = st;
      this.paint(this.radio[2], st >= 0 ? RADIO_PLATE[st] : 151);
      const w = +this.radio[2].dataset.w;
      this.radio[2].dataset.x = 311 - w / 2;
      this.layout();
    }
    // weapon
    if (this.weapon !== pl.weapon) {
      this.weapon = pl.weapon;
      const [m, x, y] = WEAPON_ICON[pl.weapon] || WEAPON_ICON.fist;
      this.paint(this.weaponIcon, m);
      this.weaponIcon.dataset.x = x; this.weaponIcon.dataset.y = y;
      this.layout();
    }
    const slot = pl.weapons[pl.weapon];
    this.digits(this.ammo, slot && pl.weapon !== 'fist' && pl.weapon !== 'bat' ? `${slot.clip}/${slot.ammo}` : '', 'white', true);
    // wanted badges
    const lv = g.police.level;
    this.badges.forEach((b, i) => { b.style.display = i < lv ? '' : 'none'; b.classList.toggle('blink', i < lv && g.police.unseen > 3); });
    // money with original +/- popups
    const money = Math.floor(g.money);
    if (this.lastMoney !== null && money !== this.lastMoney) this.moneyPopup(money - this.lastMoney);
    this.lastMoney = money;
    this.digits(this.money, '$' + money.toLocaleString('en-US'), 'white');
    // crosshair: the original target reticle
    const w = g.weaponDef();
    const aiming = !v && !w.melee && (g.ctl.aim || g.ctl.fire);
    this.el('#crosshair').className = aiming ? (w.scope ? 'scope' : 'on') : '';
    this.drawRadar();
    this.placeOne(this.north);
  }

  /** reposition a single top-left element without a full layout pass */
  placeOne(d) {
    const s = this.scale, ins = this._ins || { l: 0, t: 0 };
    d.style.left = (+d.dataset.x * s + ins.l) / s + 'px';
    d.style.top = (+d.dataset.y * s + ins.t) / s + 'px';
  }

  moneyPopup(delta) {
    const d = document.createElement('div');
    d.className = 'digits right popup';
    d.dataset.x = 975; d.dataset.y = 206; d.dataset.a = 'tr';
    this.hud.appendChild(d); this.items.push(d);
    this.digits(d, (delta > 0 ? '+$' : '-$') + Math.abs(delta).toLocaleString('en-US'), delta > 0 ? 'green' : 'red');
    setTimeout(() => { d.remove(); this.items.splice(this.items.indexOf(d), 1); }, 1800);
  }
}
