// HUD, minimap/GPS, big map, notifications and menu panels.
import { G } from './state.js';
import { CITY, BEACH, CAUSEWAY, ISLAND, ISLAND_END_X, CZ, P, W, NX, NZ, HALF, blockBounds, blockDistrict, DISTRICT, nearestNode, findPath, nodes, zoneName } from './layout.js';
import { fmtMoney, clamp } from './util.js';
import { WEAPONS } from './weapons.js';

const $ = (id) => document.getElementById(id);
const MAP = { x0: CITY.x0 - 160, z0: CITY.z0 - 160, x1: ISLAND.x1 + 160 };
MAP.size = Math.max(MAP.x1 - MAP.x0, CITY.z1 + 160 - MAP.z0);
MAP.z1 = MAP.z0 + MAP.size; MAP.x1 = MAP.x0 + MAP.size;

export class HUD {
  constructor() {
    this.mm = $('minimap'); this.mctx = this.mm.getContext('2d');
    this.bigCanvas = $('bigmap'); this.bctx = this.bigCanvas.getContext('2d');
    this.mapImg = null;
    this.notes = [];
    this.subT = 0; this.bigT = 0; this.driftT = 0; this.promptT = 0;
    this.gps = null; this.gpsT = 0;
    this.bigZoom = 1.7; this.bigCenter = null;
    this.bigCanvas.addEventListener('click', (e) => this.onMapClick(e));
    this.bigCanvas.addEventListener('wheel', (e) => { this.bigZoom = clamp(this.bigZoom * (e.deltaY > 0 ? 0.85 : 1.18), 1, 4); this.drawBigMap(); }, { passive: true });
  }

  // ---------- pre-render map ----------
  buildMap() {
    const S = 2048, c = document.createElement('canvas'); c.width = c.height = S;
    const ctx = c.getContext('2d');
    const s = S / MAP.size;
    const X = (x) => (x - MAP.x0) * s, Z = (z) => (z - MAP.z0) * s;
    ctx.fillStyle = '#0f4c66'; ctx.fillRect(0, 0, S, S);
    // waves texture
    ctx.globalAlpha = 0.08; ctx.strokeStyle = '#9fe8ff';
    for (let k = 0; k < 300; k++) { const x = Math.random() * S, y = Math.random() * S; ctx.beginPath(); ctx.arc(x, y, 6, 0.3, 2.8); ctx.stroke(); }
    ctx.globalAlpha = 1;
    // beach
    ctx.fillStyle = '#e3cf96'; ctx.fillRect(X(BEACH.x0), Z(BEACH.z0), (BEACH.x1 - BEACH.x0) * s * 0.7, (BEACH.z1 - BEACH.z0) * s);
    // land
    ctx.fillStyle = '#3a3a44'; ctx.fillRect(X(CITY.x0), Z(CITY.z0), (CITY.x1 - CITY.x0) * s, (CITY.z1 - CITY.z0) * s);
    ctx.fillStyle = '#4a7a48'; ctx.fillRect(X(ISLAND.x0), Z(ISLAND.z0), (ISLAND.x1 - ISLAND.x0) * s, (ISLAND.z1 - ISLAND.z0) * s);
    // blocks by district
    const dcol = { [DISTRICT.PORT]: '#4a4a52', [DISTRICT.DOWNTOWN]: '#353a4a', [DISTRICT.MIDTOWN]: '#44404c', [DISTRICT.RESIDENTIAL]: '#3f5a3f', [DISTRICT.DECO]: '#5a4252', [DISTRICT.PARK]: '#3f7a3a' };
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
      const b = blockBounds(i, j);
      ctx.fillStyle = dcol[blockDistrict(i, j)] || '#444';
      ctx.fillRect(X(b.x0), Z(b.z0), (b.x1 - b.x0) * s, (b.z1 - b.z0) * s);
    }
    // footprints
    for (const f of G.world.footprints) {
      ctx.fillStyle = f.c;
      ctx.globalAlpha = 0.9;
      ctx.fillRect(X(f.x0), Z(f.z0), (f.x1 - f.x0) * s, (f.z1 - f.z0) * s);
    }
    ctx.globalAlpha = 1;
    // roads
    ctx.fillStyle = '#8d8d9c';
    for (let i = 0; i <= NX; i++) ctx.fillRect(X(i * P - HALF), Z(-HALF), W * s, (NZ * P + W) * s);
    for (let j = 0; j <= NZ; j++) ctx.fillRect(X(-HALF), Z(j * P - HALF), (NX * P + W) * s, W * s);
    ctx.fillRect(X(CAUSEWAY.x0), Z(CZ - HALF), (ISLAND_END_X + 14 - CAUSEWAY.x0) * s, W * s);
    ctx.fillStyle = '#e8d56a'; ctx.globalAlpha = 0.35;
    for (let i = 0; i <= NX; i++) ctx.fillRect(X(i * P - 0.5), Z(-HALF), 1 * s + 0.5, (NZ * P + W) * s);
    for (let j = 0; j <= NZ; j++) ctx.fillRect(X(-HALF), Z(j * P - 0.5), (NX * P + W) * s, 1 * s + 0.5);
    ctx.globalAlpha = 1;
    this.mapImg = c; this.mapScale = s;
  }

  w2m(x, z) { return [(x - MAP.x0) * this.mapScale, (z - MAP.z0) * this.mapScale]; }

  blips() {
    const out = [];
    const mk = G.world.markers;
    const icon = (k, ch, col) => mk[k] && out.push({ x: mk[k].x, z: mk[k].z, ch, col, edge: false });
    if (G.save.unlocked.garage) icon('garage', 'S', '#ffb02e');
    icon('gunshop', '枪', '#ff3355'); icon('hospital', '+', '#ff5577'); icon('safehouse', '⌂', '#3dff7a');
    if (G.activities) for (const b of G.activities.blips()) out.push(b);
    if (G.missions) for (const b of G.missions.blips()) out.push(b);
    if (G.waypoint) out.push({ x: G.waypoint.x, z: G.waypoint.z, ch: '◆', col: '#ff3fa4', edge: true });
    return out;
  }

  // ---------- per-frame HUD ----------
  update(dt) {
    const pl = G.player;
    $('money').textContent = fmtMoney(G.save.money);
    const h = Math.floor(G.hour), m = Math.floor((G.hour % 1) * 60);
    $('clock').textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    $('hpbar').style.width = clamp(pl.char.hp, 0, 100) + '%';
    $('arbar').parentElement.style.display = pl.char.armor > 0 ? '' : 'none';
    $('arbar').style.width = clamp(pl.char.armor, 0, 100) + '%';
    $('focusbar').style.width = pl.focus * 100 + '%';
    $('focusoverlay').classList.toggle('on', pl.focusOn);
    const v = pl.inVehicle;
    if (v) {
      $('speedval').textContent = Math.round(Math.abs(v.vF) * 3.6);
      $('nitrobar').parentElement.style.display = v.nitroMax > 0 ? '' : 'none';
      $('nitrobar').style.width = (v.nitroMax > 0 ? v.nitro / v.nitroMax * 100 : 0) + '%';
    }
    // crosshair
    const ch = $('crosshair');
    const showCross = !v && pl.weapon !== 'fist' && pl.weapon !== 'grenade' && (pl.char.aim || G.input.touchMode);
    ch.classList.toggle('hidden', !showCross);
    // timed text
    if (this.subT > 0) { this.subT -= dt; if (this.subT <= 0) $('subtitle').innerHTML = ''; }
    if (this.bigT > 0) { this.bigT -= dt; if (this.bigT <= 0) $('bigtext').classList.remove('show'); }
    // drift
    const D = pl.drift;
    if (D.active && D.score > 40) {
      $('drift').innerHTML = `${Math.floor(D.score).toLocaleString()}<small>漂移 ×${D.mult}</small>`;
      this.driftT = 0;
    } else if (this.driftT > 0) { this.driftT -= dt; if (this.driftT <= 0) $('drift').innerHTML = ''; }
    else if (!D.active) $('drift').innerHTML = '';
    // prompts
    let prompt = '';
    if (!v && pl.nearCar && !pl.dead) prompt = G.input.touchMode ? '点 🚗 上车' : '按 <kbd>F</kbd> 上车';
    if (this.customPrompt && this.promptT > 0) { prompt = this.customPrompt; this.promptT -= dt; }
    if ($('prompt').innerHTML !== prompt) $('prompt').innerHTML = prompt;
    // zone name
    this.zoneT = (this.zoneT || 0) - dt;
    if (this.zoneT <= 0) { this.zoneT = 0.5; $('zone').textContent = zoneName(pl.x, pl.z); }
    this.drawMinimap(dt);
    // damage flash fade
    this.dmg = Math.max(0, (this.dmg || 0) - dt * 1.5);
    const low = pl.char.hp < 30 && !pl.dead ? 0.35 + Math.sin(G.time * 6) * 0.15 : 0;
    $('damageflash').style.boxShadow = `inset 0 0 ${120 + this.dmg * 100}px rgba(255,0,40,${Math.max(this.dmg * 0.8, low)})`;
    G.gfx.grade.uniforms.uDamage.value = Math.max(this.dmg * 0.6, low * 0.5);
  }

  drawMinimap(dt) {
    if (!this.mapImg) return;
    const ctx = this.mctx, Sz = this.mm.width, c = Sz / 2;
    const pl = G.player;
    const sp = pl.inVehicle ? pl.inVehicle.speed : 0;
    this.mmZoom = this.mmZoom ?? 1.4;
    const tz = clamp(1.6 - sp / 45, 0.75, 1.6);
    this.mmZoom += (tz - this.mmZoom) * Math.min(1, dt * 2);
    const k = this.mmZoom / this.mapScale; // map px -> minimap px (world m * mmZoom)
    const yaw = pl.camYaw;
    const rot = -Math.PI / 2 - Math.atan2(Math.cos(yaw), Math.sin(yaw));
    const [px, pz] = this.w2m(pl.x, pl.z);
    ctx.save();
    ctx.fillStyle = '#0f4c66'; ctx.fillRect(0, 0, Sz, Sz);
    ctx.translate(c, c); ctx.rotate(rot); ctx.scale(k * this.mapScale / this.mapScale, k * this.mapScale / this.mapScale);
    ctx.scale(this.mapScale / this.mapScale, 1);
    // draw map centered on player
    const scale = this.mmZoom / this.mapScale;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.translate(c, c); ctx.rotate(rot); ctx.scale(scale, scale); ctx.translate(-px, -pz);
    ctx.drawImage(this.mapImg, 0, 0);
    // GPS route
    this.gpsT -= dt;
    if (G.missions && G.missions.gpsTarget) this.gpsTo = G.missions.gpsTarget; else this.gpsTo = G.waypoint;
    if (this.gpsTo && this.gpsT <= 0) {
      this.gpsT = 1;
      const a = nearestNode(pl.x, pl.z), b = nearestNode(this.gpsTo.x, this.gpsTo.z);
      this.gps = findPath(a.id, b.id).map((id) => nodes[id]);
    }
    if (this.gpsTo && this.gps) {
      ctx.strokeStyle = G.missions && G.missions.gpsTarget ? '#ffd166' : '#ff3fa4';
      ctx.lineWidth = 5 / scale; ctx.lineJoin = 'round'; ctx.globalAlpha = 0.85;
      ctx.beginPath(); ctx.moveTo(...this.w2m(pl.x, pl.z));
      for (const n of this.gps) ctx.lineTo(...this.w2m(n.x, n.z));
      ctx.lineTo(...this.w2m(this.gpsTo.x, this.gpsTo.z));
      ctx.stroke(); ctx.globalAlpha = 1;
    }
    ctx.restore();
    // blips (screen-space)
    const toScreen = (x, z) => {
      const dx = (x - pl.x) * this.mmZoom, dz = (z - pl.z) * this.mmZoom;
      const cr = Math.cos(rot), sr = Math.sin(rot);
      return [c + dx * cr - dz * sr, c + dx * sr + dz * cr];
    };
    ctx.font = 'bold 13px "Noto Sans SC", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const R = c - 12;
    for (const b of this.blips()) {
      let [sx, sy] = toScreen(b.x, b.z);
      const dx = sx - c, dy = sy - c, d = Math.hypot(dx, dy);
      if (d > R) { if (!b.edge && !b.mission) continue; sx = c + dx / d * R; sy = c + dy / d * R; }
      ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.beginPath(); ctx.arc(sx, sy, 9, 0, 7); ctx.fill();
      ctx.fillStyle = b.col; ctx.fillText(b.ch, sx, sy + 1);
    }
    // police dots
    const blink = Math.floor(G.time * 4) % 2;
    for (const v of G.vehicles.list) {
      if (!v.isPolice || v.dead || !v.siren) continue;
      const [sx, sy] = toScreen(v.x, v.z);
      if (Math.hypot(sx - c, sy - c) > R) continue;
      ctx.fillStyle = blink ? '#ff2244' : '#2266ff'; ctx.beginPath(); ctx.arc(sx, sy, 4, 0, 7); ctx.fill();
    }
    for (const p of G.pedSys.list) {
      if (p.char.dead || !(p.hostile || (p.mission && p.mission.blip))) continue;
      const [sx, sy] = toScreen(p.x, p.z);
      if (Math.hypot(sx - c, sy - c) > R) continue;
      ctx.fillStyle = p.mission && p.mission.blipCol ? p.mission.blipCol : '#ff4444'; ctx.beginPath(); ctx.arc(sx, sy, 3.5, 0, 7); ctx.fill();
    }
    // player arrow (always up)
    ctx.save(); ctx.translate(c, c);
    const carH = pl.inVehicle ? pl.inVehicle.h : pl.char.h;
    const rel = -(carH - yaw);
    ctx.rotate(rel);
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(7, 7); ctx.lineTo(0, 3); ctx.lineTo(-7, 7); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
    // north indicator
    const [nx, ny] = toScreen(pl.x, pl.z - 10000);
    const nd = Math.hypot(nx - c, ny - c);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 12px Orbitron, sans-serif';
    ctx.fillText('N', c + (nx - c) / nd * (c - 10), c + (ny - c) / nd * (c - 10));
    // police search circle tint
    if (G.police && G.police.level > 0) {
      ctx.strokeStyle = blink ? 'rgba(255,40,70,.6)' : 'rgba(40,90,255,.6)'; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.arc(c, c, c - 3, 0, 7); ctx.stroke();
    }
  }

  drawBigMap() {
    if (!this.mapImg) return;
    const ctx = this.bctx, S = this.bigCanvas.width;
    const pl = G.player;
    const z = this.bigZoom;
    const view = MAP.size / z;
    const cx = z === 1 ? MAP.x0 + MAP.size / 2 : clamp(pl.x, MAP.x0 + view / 2, MAP.x1 - view / 2);
    const cz = z === 1 ? MAP.z0 + MAP.size / 2 : clamp(pl.z, MAP.z0 + view / 2, MAP.z1 - view / 2);
    this.bigView = { x0: cx - view / 2, z0: cz - view / 2, size: view };
    const s = S / view;
    ctx.fillStyle = '#0f4c66'; ctx.fillRect(0, 0, S, S);
    const ms = this.mapScale;
    ctx.drawImage(this.mapImg, (this.bigView.x0 - MAP.x0) * ms, (this.bigView.z0 - MAP.z0) * ms, view * ms, view * ms, 0, 0, S, S);
    const toS = (x, zz) => [(x - this.bigView.x0) * s, (zz - this.bigView.z0) * s];
    ctx.font = 'bold 18px "Noto Sans SC", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const b of this.blips()) {
      const [x, y] = toS(b.x, b.z);
      ctx.fillStyle = 'rgba(0,0,0,.65)'; ctx.beginPath(); ctx.arc(x, y, 13, 0, 7); ctx.fill();
      ctx.fillStyle = b.col; ctx.fillText(b.ch, x, y + 1);
      if (b.label) { ctx.font = '12px "Noto Sans SC"'; ctx.fillStyle = '#fff'; ctx.fillText(b.label, x, y + 22); ctx.font = 'bold 18px "Noto Sans SC", sans-serif'; }
    }
    // labels
    ctx.font = 'bold 15px "Noto Sans SC"'; ctx.fillStyle = 'rgba(255,255,255,.6)';
    const lab = [['集装箱码头', 0, 6 * P], ['金融中心', 5 * P, 4.5 * P], ['海滨装饰艺术区', 9 * P, 6 * P], ['棕榈住宅区', 3 * P, 10.5 * P], ['日落海滩', BEACH.x0 + 45, 3 * P], ['珊瑚岛', ISLAND.x0 + 120, CZ - 100], ['中城', 2 * P, 2.5 * P]];
    for (const [t, x, zz] of lab) { const [sx, sy] = toS(x, zz); ctx.fillText(t, sx, sy); }
    const [px, py] = toS(pl.x, pl.z);
    ctx.save(); ctx.translate(px, py); ctx.rotate(Math.PI - (pl.inVehicle ? pl.inVehicle.h : pl.char.h));
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(9, 9); ctx.lineTo(0, 4); ctx.lineTo(-9, 9); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  onMapClick(e) {
    const r = this.bigCanvas.getBoundingClientRect();
    const mx = (e.clientX - r.left) / r.width, my = (e.clientY - r.top) / r.height;
    const v = this.bigView;
    const x = v.x0 + mx * v.size, z = v.z0 + my * v.size;
    if (G.waypoint && Math.hypot(G.waypoint.x - x, G.waypoint.z - z) < v.size * 0.02) G.waypoint = null;
    else G.waypoint = { x, z };
    this.gpsT = 0;
    G.audio && G.audio.ui('click');
    this.drawBigMap();
  }

  // ---------- API ----------
  weapon() {
    const pl = G.player; const w = WEAPONS[pl.weapon];
    $('weaponname').textContent = `${w.icon} ${w.name}`;
    if (pl.weapon === 'fist') $('ammo').textContent = '';
    else $('ammo').textContent = pl.reload > 0 ? '换弹中…' : `${pl.mag[pl.weapon] ?? 0} / ${Math.max(0, (G.save.ammo[pl.weapon] || 0) - (pl.mag[pl.weapon] || 0))}`;
  }
  vehicle(v) {
    $('speedo').classList.toggle('hidden', !v);
    if (v) { $('carname').textContent = v.t.name; this.radio(G.audio.stations[G.audio.station]); }
  }
  radio(name) {
    $('radioname').textContent = '📻 ' + name;
    clearTimeout(this._rt);
    this._rt = setTimeout(() => ($('radioname').textContent = ''), 3500);
  }
  stars(level, flashing) {
    const el = $('stars');
    let h = '';
    for (let k = 1; k <= 5; k++) h += k <= level ? '★' : '<span class="off">★</span>';
    if (level === 0) h = '';
    if (el.innerHTML !== h) el.innerHTML = h;
    el.classList.toggle('flash', !!flashing && level > 0);
  }
  damage(f) { this.dmg = Math.min(1, (this.dmg || 0) + f); }
  hit() { const h = $('hitmarker'); h.classList.remove('show'); void h.offsetWidth; h.classList.add('show'); }
  notify(text, ms = 4500) {
    const n = document.createElement('div'); n.className = 'n'; n.innerHTML = text;
    $('notify').appendChild(n);
    setTimeout(() => n.remove(), ms);
    while ($('notify').children.length > 4) $('notify').firstChild.remove();
  }
  subtitle(html, sec = 4) { $('subtitle').innerHTML = html; this.subT = sec; }
  objective(text) { $('objective').textContent = text || ''; }
  big(text, cls = 'gold', sub = '', sec = 3) {
    const b = $('bigtext'); b.className = 'show ' + cls; b.innerHTML = text + (sub ? `<small>${sub}</small>` : ''); this.bigT = sec;
  }
  timer(sec) {
    const t = $('timer');
    if (sec == null) { t.classList.add('hidden'); return; }
    t.classList.remove('hidden');
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    t.textContent = `${m}:${String(s).padStart(2, '0')}`;
    t.style.color = sec < 10 ? '#ff3355' : '';
  }
  prompt(html, sec = 0.3) { this.customPrompt = html; this.promptT = sec; }
  driftBank(pts, cash) {
    $('drift').innerHTML = `+${fmtMoney(cash)}<small>漂移 ${pts.toLocaleString()} 分</small>`;
    this.driftT = 2;
    G.audio && G.audio.ui('cash');
  }
  driftFail() { $('drift').innerHTML = `<span style="color:#ff3355">漂移中断</span>`; this.driftT = 1.5; }
  stunt(title, dist, h, t, cash) {
    this.big(title, 'gold', `距离 ${dist.toFixed(0)}m · 高度 ${h.toFixed(1)}m · 滞空 ${t.toFixed(1)}s · +${fmtMoney(cash)}`, 3);
    G.audio && G.audio.ui('cash');
  }
  showHUD(on) { $('hud').classList.toggle('hidden', !on); $('touch').classList.toggle('hidden', !on || !G.input.touchMode); }

  // ---------- panels ----------
  settingsHTML() {
    const s = G.settings;
    const opt = (v, cur, label) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${label}</option>`;
    return `
<div class="set-row"><span>画质预设</span><select id="setQuality">${opt('low', s.quality, '低（流畅）')}${opt('medium', s.quality, '中')}${opt('high', s.quality, '高（推荐）')}${opt('ultra', s.quality, '极致')}</select></div>
<div class="set-row"><span>鼠标灵敏度</span><input id="setSens" type="range" min="0.3" max="3" step="0.1" value="${s.sensitivity}"></div>
<div class="set-row"><span>反转 Y 轴</span><input id="setInv" type="checkbox" ${s.invertY ? 'checked' : ''}></div>
<div class="set-row"><span>视野 FOV</span><input id="setFov" type="range" min="55" max="95" step="1" value="${s.fov}"></div>
<div class="set-row"><span>主音量</span><input id="setVol" type="range" min="0" max="1" step="0.05" value="${s.volume}"></div>
<div class="set-row"><span>电台音乐</span><input id="setMusic" type="range" min="0" max="1" step="0.05" value="${s.music}"></div>
<div class="set-row"><span>昼夜流速</span><select id="setTime">${opt('0', String(s.timeSpeed), '冻结时间')}${opt('0.5', String(s.timeSpeed), '慢')}${opt('1', String(s.timeSpeed), '正常 (1分钟=1小时)')}${opt('3', String(s.timeSpeed), '快')}</select></div>
<div class="set-row"><span>跳到时间</span><span><button class="mbtn small" data-hour="7">清晨</button> <button class="mbtn small" data-hour="13">正午</button> <button class="mbtn small" data-hour="18.4">黄昏</button> <button class="mbtn small" data-hour="22.5">深夜</button></span></div>
<div class="set-row"><span>天气</span><span><button class="mbtn small" data-rain="0">晴</button> <button class="mbtn small" data-rain="1">暴雨</button></span></div>
<div class="set-row"><span>显示 FPS</span><input id="setFps" type="checkbox" ${s.showFps ? 'checked' : ''}></div>`;
  }
  bindSettings(root) {
    const s = G.settings;
    const on = (id, ev, f) => { const el = root.querySelector('#' + id); if (el) el.addEventListener(ev, f); };
    on('setQuality', 'change', (e) => { s.quality = e.target.value; G.applyQuality(); G.saveSettings(); });
    on('setSens', 'input', (e) => { s.sensitivity = +e.target.value; G.saveSettings(); });
    on('setInv', 'change', (e) => { s.invertY = e.target.checked; G.saveSettings(); });
    on('setFov', 'input', (e) => { s.fov = +e.target.value; G.saveSettings(); });
    on('setVol', 'input', (e) => { s.volume = +e.target.value; G.audio.setVolumes(); G.saveSettings(); });
    on('setMusic', 'input', (e) => { s.music = +e.target.value; G.audio.setVolumes(); G.saveSettings(); });
    on('setTime', 'change', (e) => { s.timeSpeed = +e.target.value; G.saveSettings(); });
    on('setFps', 'change', (e) => { s.showFps = e.target.checked; G.saveSettings(); });
    root.querySelectorAll('[data-hour]').forEach((b) => b.addEventListener('click', () => { G.hour = +b.dataset.hour; G.sky.envTimer = 0; }));
    root.querySelectorAll('[data-rain]').forEach((b) => b.addEventListener('click', () => G.sky.setWeather(+b.dataset.rain)));
  }
  helpHTML() {
    const r = (k, d) => `<kbd>${k}</kbd><span>${d}</span>`;
    return `<h3>步行</h3><div class="help-grid">
${r('W A S D', '移动')}${r('鼠标', '视角')}${r('左键', '射击 / 出拳')}${r('右键', '瞄准')}${r('Shift', '冲刺')}${r('空格', '跳跃')}
${r('F', '上车 / 下车 / 抢车')}${r('Q / 滚轮 / 1-7', '切换武器')}${r('G', '手雷')}${r('E', '专注时间（子弹时间）')}</div>
<h3>驾驶</h3><div class="help-grid">
${r('W / S', '油门 / 刹车倒车')}${r('A / D', '转向')}${r('空格', '手刹（漂移！）')}${r('Shift', '氮气加速（需改装）')}${r('H', '喇叭')}${r('R', '切换电台')}
${r('C', '切换镜头')}${r('V', '回头看')}${r('左键', '驾车射击（手枪/冲锋枪）')}${r('T', '出租车里开始载客任务')}</div>
<h3>其它</h3><div class="help-grid">${r('M / Esc', '地图与暂停')}${r('P', '拍照模式')}</div>
<h3>玩法提示</h3>
<p>· 黄色光柱是剧情任务，跟随小地图上的黄色 GPS 路线。<br>
· 用手刹甩尾漂移可以累积连击分数，漂移结束后兑换现金并补充氮气。<br>
· 城市里藏着 25 枚霓虹徽章，还有 6 个特技跳台等你挑战。<br>
· 被通缉时，躲开警察视线一段时间即可脱身；也可以开进萨尔车行喷漆。<br>
· 手柄与触屏均支持。</p>`;
  }
  statsHTML() {
    const s = G.save.stats;
    const ms = G.missions ? G.missions.list : [];
    const line = (a, b) => `<div class="statline"><span>${a}</span><b>${b}</b></div>`;
    let h = '<h3>剧情任务</h3>';
    ms.forEach((m, k) => { h += `<div class="statline ${k < G.save.mission ? 'mission-done' : ''}"><span>${k + 1}. ${m.title}</span><b>${k < G.save.mission ? '✔ 完成' : k === G.save.mission ? '进行中' : '🔒'}</b></div>`; });
    h += '<h3>统计</h3>';
    h += line('游戏时长', `${Math.floor(s.playTime / 60)} 分钟`) + line('总资产', fmtMoney(G.save.money)) + line('霓虹徽章', `${G.save.badges.length} / 25`) +
      line('独特特技', `${G.save.stunts.length} / 6`) + line('击倒', s.kills) + line('抢车次数', s.carsStolen) + line('驾驶里程', (s.distance / 1000).toFixed(1) + ' km') +
      line('最高漂移', s.bestDrift.toLocaleString()) + line('最高通缉', '★'.repeat(s.maxWanted) || '-') + line('出租车收入', fmtMoney(s.taxiFares)) + line('街头赛胜场', s.racesWon) +
      line('阵亡', s.deaths) + line('被捕', s.busted);
    return h;
  }
}
