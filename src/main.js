// 霓虹港湾：街头之王 — entry point / game loop.
import * as THREE from 'three';
import { G, defaultSave } from './state.js';
import { Gfx } from './gfx.js';
import { World } from './world.js';
import { Atmosphere } from './sky.js';
import { FX } from './fx.js';
import { Input } from './input.js';
import { AudioEngine } from './audio.js';
import { VehicleSystem } from './vehicle.js';
import { TrafficSystem } from './traffic.js';
import { PedSystem } from './peds.js';
import { Police } from './police.js';
import { Combat } from './weapons.js';
import { Player } from './player.js';
import { Pickups } from './pickups.js';
import { Activities } from './activities.js';
import { Missions } from './missions.js';
import { HUD } from './hud.js';
import { clamp, lerp, fmtMoney } from './util.js';
import { shared } from './materials.js';
import { CITY, BEACH, P, CZ, groundHeight } from './layout.js';

const $ = (id) => document.getElementById(id);
const SAVE_KEY = 'neonharbor_save_v1', SET_KEY = 'neonharbor_settings_v1';

// ---------------- persistence ----------------
function loadSettings() {
  try { Object.assign(G.settings, JSON.parse(localStorage.getItem(SET_KEY) || '{}')); } catch (e) { /* ignore */ }
}
G.saveSettings = () => { try { localStorage.setItem(SET_KEY, JSON.stringify(G.settings)); } catch (e) { /* ignore */ } };
function readSave() { try { const s = localStorage.getItem(SAVE_KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
G.persist = () => {
  if (!G.save) return;
  G.save.hour = G.hour;
  G.save.armor = G.player ? G.player.char.armor : 0;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(G.save)); } catch (e) { /* ignore */ }
};
G.addMoney = (n, quiet) => {
  G.save.money += n;
  if (!quiet && n > 0) G.audio.ui('cash');
  else if (quiet) G.audio.ui('pickup');
};

// ---------------- boot ----------------
async function boot() {
  loadSettings();
  const canvas = $('game');
  const gfx = (G.gfx = new Gfx(canvas));
  G.renderer = gfx.renderer; G.camera = gfx.camera;
  gfx.quality = G.settings.quality; gfx.setup();
  const scene = (G.scene = new THREE.Scene());
  gfx.setScene(scene);
  G.input = new Input(canvas);
  G.input.onTouchMode = () => G.hud && G.hud.showHUD(G.started && !G.paused);
  G.audio = new AudioEngine();
  G.hud = new HUD();

  const prog = (p, t) => { $('loadfill').style.width = p * 100 + '%'; $('loadtext').textContent = t; };
  prog(0.02, '点亮霓虹灯…');
  await new Promise((r) => setTimeout(r, 30));
  G.sky = new Atmosphere(scene, G.renderer);
  G.world = new World(scene);
  await G.world.build(prog);
  G.fx = new FX(scene);
  G.vehicles = new VehicleSystem(scene);
  G.combat = new Combat(scene);
  G.pedSys = new PedSystem();
  G.traffic = new TrafficSystem();
  G.police = new Police();
  G.pickups = new Pickups();
  G.activities = new Activities();
  G.missions = new Missions();
  G.player = new Player(scene);
  G.player.char.mesh.visible = false;
  G.player.place(BEACH.x0 - 20, 6 * P, 0); // title-screen anchor so traffic spawns around the camera
  G._camDir = new THREE.Vector3(0, 0, -1);
  prog(0.92, '编译着色器…');
  setupLights(scene);
  G.applyQuality();
  // warm-up render (compile shaders)
  G.camera.position.set(BEACH.x0 + 60, 25, 6 * P);
  G.camera.lookAt(5 * P, 30, 5 * P);
  G.sky.update(0.016, G.hour, false, G.camera.position, null);
  G.world.update(0.016, 0, G.sky.night, G.sky.sunDir, G.sky.sunColor);
  try { G.renderer.compile(scene, G.camera); } catch (e) { /* ignore */ }
  G.gfx.render(0.016, G.sky.night);
  G.hud.buildMap();
  prog(1, '完成');
  setupMenus();
  $('loading').classList.add('hidden');
  showTitle();
  requestAnimationFrame(loop);
}

// ---------------- street light pool ----------------
let lightPool = [];
function setupLights(scene) {
  for (let k = 0; k < 10; k++) {
    const l = new THREE.PointLight(0xffc68a, 0, 26, 1.6);
    scene.add(l);
    lightPool.push(l);
  }
}
let lightT = 0;
function updateLights(dt) {
  lightT -= dt;
  if (lightT > 0) return;
  lightT = 0.3;
  const night = G.sky.night;
  const cp = G.camera.position;
  const srcs = G.world.lightSources;
  if (night < 0.05) { for (const l of lightPool) l.intensity = 0; return; }
  // pick nearest lamps in front of camera
  const dir = G._camDir;
  const scored = [];
  for (const s of srcs) {
    if (s.sky) continue;
    const dx = s.x - cp.x, dz = s.z - cp.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > 90 * 90) continue;
    const d = Math.sqrt(d2) || 1;
    const front = (dx * dir.x + dz * dir.z) / d;
    scored.push({ s, k: d2 * (front < -0.2 ? 4 : 1) });
  }
  scored.sort((a, b) => a.k - b.k);
  lightPool.forEach((l, i) => {
    const e = scored[i];
    if (!e) { l.intensity = 0; return; }
    l.position.set(e.s.x, e.s.y, e.s.z);
    l.color.copy(e.s.color);
    l.distance = e.s.range;
    l.intensity = e.s.intensity * night * (e.s.lamp ? 1 : 0.8);
  });
}

// ---------------- quality ----------------
G.applyQuality = () => {
  const q = G.settings.quality;
  G.gfx.setQuality(q);
  G.sky.setShadowQuality(q);
  G.world.setWaterQuality(q === 'high' || q === 'ultra');
  G.renderer.shadowMap.needsUpdate = true;
  G.pedSys && (G.pedSys.maxCiv = { low: 18, medium: 28, high: 34, ultra: 42 }[q]);
  G.traffic && (G.traffic.max = { low: 14, medium: 22, high: 26, ultra: 32 }[q]);
  G.scene.traverse((o) => { if (o.isPointLight && lightPool.includes(o)) o.visible = q !== 'low'; });
};

// ---------------- game state transitions ----------------
function newGame() {
  G.save = defaultSave();
  startGame(true);
}
function continueGame() {
  const s = readSave();
  G.save = Object.assign(defaultSave(), s || {});
  G.save.stats = Object.assign(defaultSave().stats, G.save.stats || {});
  G.save.unlocked = Object.assign(defaultSave().unlocked, G.save.unlocked || {});
  startGame(false);
}

function startGame(fresh) {
  G.audio.init();
  G.hour = G.save.hour ?? 18.55;
  const pl = G.player;
  pl.load(G.save);
  pl.char.revive(); pl.char.hp = 100;
  pl.char.mesh.visible = true;
  const sh = G.world.markers.safehouse;
  pl.place(sh.x - 6, sh.z + 0.5, Math.PI / 2);
  pl.camYaw = Math.PI / 2 + 0.5;
  spawnGarageCar();
  G.started = true;
  G.titleCam = false;
  G.setPaused(false);
  G.pickups.items.length || G.pickups.init();
  G.activities.markers.gunshop || G.activities.init();
  G.hud.weapon();
  G.hud.stars(0);
  if (fresh) {
    setTimeout(() => G.hud.big('霓虹港湾', 'gold', '太阳湾 · 黄昏', 3.5), 300);
    G.hud.notify('跟随黄色光柱开始剧情任务 ★');
    G.hud.notify('按 M 打开地图 · Esc 暂停 · 详细操作见菜单');
  } else G.hud.notify('欢迎回来，凯。');
  G.input.wantLock = true;
  if (!G.input.touchMode) G.input.lock();
}

function spawnGarageCar() {
  const c = G.save.garageCar;
  const m = G.world.markers.safehouseCar;
  if (G.safeCar && !G.safeCar.removed) G.vehicles.remove(G.safeCar);
  const v = c ? G.vehicles.spawn(c.type, m.x, m.z, m.h, c.color, { powerMul: c.power, nitroMax: c.nitro, armorMul: c.armored ? 1.6 : 1, persistent: true })
    : G.vehicles.spawn('sedan', m.x, m.z, m.h, 0x2e86ab, { persistent: true });
  if (c && c.glow != null) v.setGlow(c.glow);
  if (c && c.armored) v.armored = true;
  G.safeCar = v;
}

G.setPaused = (p, why) => {
  G.paused = p;
  G.pauseWhy = why;
  G.hud.showHUD(!p || why === 'shop');
  if (p && document.pointerLockElement) document.exitPointerLock();
  if (!p && G.started && !G.input.touchMode && !G.photo) { G.input.wantLock = true; G.input.lock(); }
};

function respawn(kind) {
  const pl = G.player;
  const m = kind === 'busted' ? G.world.markers.police : G.world.markers.hospital;
  G.missions.active && G.missions.fail(kind === 'busted' ? '你被捕了' : '你倒下了');
  G.activities.cancelAll();
  G.police.setLevel(0);
  G.police.bustedNow = false;
  if (pl.inVehicle) pl.exitVehicle(true);
  const lost = Math.min(G.save.money, kind === 'busted' ? 500 + Math.floor(G.save.money * 0.05) : 300 + Math.floor(G.save.money * 0.03));
  G.save.money -= lost;
  if (kind === 'busted') {
    G.save.stats.busted++;
    // lose a portion of ammo
    for (const w in G.save.ammo) G.save.ammo[w] = Math.floor(G.save.ammo[w] * 0.5);
  } else G.save.stats.deaths++;
  pl.char.revive(); pl.char.hp = 100; pl.char.armor = 0;
  pl.place(m.x, m.z + 2, 0);
  pl.invuln = 3;
  pl.mag = {};
  pl.selectWeapon('fist');
  G.hour = (G.hour + 6) % 24; G.sky.envTimer = 0;
  G.hud.notify(kind === 'busted' ? `保释金 ${fmtMoney(lost)}，没收了一半弹药。` : `医疗费 ${fmtMoney(lost)}。`);
  G.timeScaleTarget = 1;
}

// ---------------- events ----------------
function wireEvents() {
  G.events.on('playerDied', () => {
    G.hud.big('阵 亡', 'red', '', 4);
    G.timeScaleTarget = 0.3;
    setTimeout(() => respawn('dead'), 4000);
  });
  G.events.on('busted', () => {
    G.hud.big('被 捕', 'blue', '', 4);
    const pl = G.player;
    if (pl.inVehicle) pl.exitVehicle(true);
    pl.char.aim = false;
    G.bustAnim = 4;
    setTimeout(() => respawn('busted'), 3500);
  });
  G.events.on('actorKilled', (p, attacker) => {
    if (attacker === G.player) {
      G.save.stats.kills++;
      G.player.focus = Math.min(1, G.player.focus + 0.12);
    }
  });
  G.events.on('vehicleCrash', (v, imp) => { if (v.driver === 'player') { G.player.bankDrift(true); G.fx.shake = Math.max(G.fx.shake, Math.min(0.6, imp / 30)); } });
  G.events.on('carCollision', (a, b, imp) => { if (a.driver === 'player' || b.driver === 'player') { G.player.bankDrift(true); G.fx.shake = Math.max(G.fx.shake, Math.min(0.6, imp / 30)); } });
  G.events.on('vehicleSunk', (v) => { if (v === G.player.inVehicle) { G.player.exitVehicle(true); G.player.rescueFromWater(); } });
}

// ---------------- menus ----------------
function setupMenus() {
  $('btnNew').onclick = () => {
    // in-page confirmation (native confirm() dialogs may be blocked in embedded viewers)
    const b = $('btnNew');
    if (readSave() && !b.dataset.armed) {
      b.dataset.armed = '1'; b.textContent = '再点一次：覆盖旧存档开始新游戏';
      setTimeout(() => { delete b.dataset.armed; b.textContent = '新的游戏'; }, 4000);
      return;
    }
    $('title').classList.add('hidden'); newGame();
  };
  $('btnContinue').onclick = () => { $('title').classList.add('hidden'); continueGame(); };
  $('btnSettings1').onclick = () => openSettings('title');
  $('btnHelp1').onclick = () => { $('helpBody').innerHTML = G.hud.helpHTML(); $('helpPanel').classList.remove('hidden'); };
  $('btnHelpBack').onclick = () => $('helpPanel').classList.add('hidden');
  $('btnSettingsBack').onclick = () => $('settingsPanel').classList.add('hidden');
  $('btnResume').onclick = () => closePause();
  $('btnSave').onclick = () => {
    if (G.police.level > 0) { G.hud.notify('被通缉时不能存档'); return; }
    G.persist(); $('btnSave').textContent = '已保存 ✔'; setTimeout(() => ($('btnSave').textContent = '保存'), 1500);
  };
  $('btnQuit').onclick = () => { G.persist(); location.reload(); };
  document.querySelectorAll('#pause .tab').forEach((t) => t.addEventListener('click', () => selectTab(t.dataset.tab)));
  wireEvents();
  // browsers swallow Esc to release pointer lock: treat losing the lock mid-game as a pause request
  document.addEventListener('pointerlockchange', () => {
    if (!document.pointerLockElement && G.started && !G.paused && !G.photo && !G.input.touchMode && G.input.wantLock) openPause();
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden && G.started && !G.paused) openPause(); });
  // first interaction unlocks audio for title music
  const unlock = () => { G.audio.init(); removeEventListener('pointerdown', unlock); removeEventListener('keydown', unlock); };
  addEventListener('pointerdown', unlock); addEventListener('keydown', unlock);
}
function openSettings() {
  $('settingsBody').innerHTML = G.hud.settingsHTML();
  G.hud.bindSettings($('settingsBody'));
  $('settingsPanel').classList.remove('hidden');
}
function selectTab(tab) {
  document.querySelectorAll('#pause .tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  for (const k of ['map', 'stats', 'settings', 'help']) $('tab-' + k).classList.toggle('hidden', k !== tab);
  if (tab === 'map') G.hud.drawBigMap();
  if (tab === 'stats') $('tab-stats').innerHTML = G.hud.statsHTML();
  if (tab === 'settings') { $('tab-settings').innerHTML = G.hud.settingsHTML(); G.hud.bindSettings($('tab-settings')); }
  if (tab === 'help') $('tab-help').innerHTML = G.hud.helpHTML();
}
function openPause() {
  G.setPaused(true, 'menu');
  $('pause').classList.remove('hidden');
  selectTab('map');
}
function closePause() {
  $('pause').classList.add('hidden');
  G.setPaused(false);
}
function showTitle() {
  $('title').classList.remove('hidden');
  $('btnContinue').classList.toggle('hidden', !readSave());
  G.titleCam = true;
  G.paused = true;
  G.hud.showHUD(false);
}

// ---------------- photo mode ----------------
function togglePhoto() {
  G.photo = !G.photo;
  $('photo').classList.toggle('hidden', !G.photo);
  G.hud.showHUD(!G.photo);
  if (G.photo) {
    G.photoCam = { yaw: G.player.camYaw + Math.PI, pitch: 0.25, dist: 7, filter: 0 };
    if (document.pointerLockElement) document.exitPointerLock();
    G.paused = true;
  } else {
    G.gfx.grade.uniforms.uFilter.value = 0;
    G.setPaused(false);
  }
}
let photoDrag = null;
addEventListener('mousedown', (e) => { if (G.photo) photoDrag = { x: e.clientX, y: e.clientY }; });
addEventListener('mouseup', () => (photoDrag = null));
addEventListener('mousemove', (e) => {
  if (!G.photo || !photoDrag) return;
  G.photoCam.yaw -= (e.clientX - photoDrag.x) * 0.006; G.photoCam.pitch = clamp(G.photoCam.pitch + (e.clientY - photoDrag.y) * 0.004, -0.2, 1.4);
  photoDrag = { x: e.clientX, y: e.clientY };
});
addEventListener('wheel', (e) => { if (G.photo) G.photoCam.dist = clamp(G.photoCam.dist * (e.deltaY > 0 ? 1.1 : 0.9), 2, 40); }, { passive: true });
addEventListener('keydown', (e) => {
  if (G.photo && /^Digit[1-5]$/.test(e.code)) G.gfx.grade.uniforms.uFilter.value = +e.code.slice(5) - 1;
});

// ---------------- main loop ----------------
let last = performance.now(), fpsAcc = 0, fpsN = 0, fpsEl = null;
G.frame = 0;
G.timeScaleTarget = 1;
function loop(now) {
  requestAnimationFrame(loop);
  let rdt = Math.min(0.05, (now - last) / 1000);
  last = now;
  G.frame++;
  const inp = G.input;
  inp.poll();

  // FPS
  if (G.settings.showFps) {
    fpsAcc += rdt; fpsN++;
    if (!fpsEl) { fpsEl = document.createElement('div'); fpsEl.style.cssText = 'position:fixed;left:8px;top:6px;font:12px monospace;color:#0f0;z-index:20;text-shadow:0 0 2px #000'; document.body.appendChild(fpsEl); }
    if (fpsAcc > 0.5) { fpsEl.textContent = Math.round(fpsN / fpsAcc) + ' fps · ' + G.renderer.info.render.calls + ' draws'; fpsAcc = 0; fpsN = 0; }
  } else if (fpsEl) { fpsEl.remove(); fpsEl = null; }

  if (G.started) {
    if (inp.pressed('pause') && !G.photo) {
      if (!$('pause').classList.contains('hidden')) closePause();
      else if (!$('shop').classList.contains('hidden')) G.activities.closePanel();
      else if (!G.paused) openPause();
    }
    if (inp.pressed('photo') && (!G.paused || G.photo)) togglePhoto();
  }

  // time scale (bullet time / slow-mo jumps)
  const pl = G.player;
  let target = G.timeScaleTarget;
  if (pl && pl.focusOn) target = Math.min(target, 0.35);
  G.timeScale = lerp(G.timeScale, target, 1 - Math.exp(-rdt * 8));
  const dt = rdt * G.timeScale;

  if (G.titleCam) {
    titleCamera(rdt);
  } else if (G.photo) {
    photoCamera(rdt);
  } else if (G.started && !G.paused) {
    simStep(dt, rdt);
  }
  G.camera.getWorldDirection(G._camDir);
  // world/atmosphere always update for visuals
  const simDt = G.paused && !G.titleCam ? 0 : dt;
  G.sky.update(rdt, G.hour, false, G.camera.position, G.audio);
  G.world.update(simDt || rdt * 0.2, G.time, G.sky.night, G.sky.sunDir, G.sky.sunColor);
  if (!(G.started && !G.paused && !G.titleCam && !G.photo)) G.fx.update(simDt);
  updateLights(rdt);
  shared.uTime.value += rdt;
  G.audio.update(rdt);
  // post fx params
  const gu = G.gfx.grade.uniforms;
  gu.uFocus.value = lerp(gu.uFocus.value, pl && pl.focusOn ? 1 : 0, 1 - Math.exp(-rdt * 6));
  const v = pl && pl.inVehicle;
  gu.uBlur.value = lerp(gu.uBlur.value, v && v.nitroOn ? 1 : v ? clamp((v.speed - 30) / 40, 0, 0.4) : 0, 1 - Math.exp(-rdt * 4));
  G.gfx.render(rdt, G.sky.night);
}

function simStep(dt, rdt) {
  const pl = G.player, inp = G.input;
  G.time += dt;
  G.save.stats.playTime += rdt;
  G.hour = (G.hour + dt * G.settings.timeSpeed / 60) % 24;
  if (G.bustAnim > 0) pl.updateDeadCam(rdt); else pl.update(dt, rdt, inp);
  G.vehicles.update(dt);
  G.traffic.update(dt);
  G.pedSys.update(dt);
  G.police.update(dt);
  G.combat.update(dt);
  G.pickups.update(dt);
  G.activities.update(dt);
  G.missions.update(dt);
  G.fx.update(dt);
  if (G.bustAnim > 0) { G.bustAnim -= rdt; pl.char.animate(rdt, 0, { handsUp: true }); }
  G.hud.update(rdt);
}
G.simStep = simStep;

let titleT = 0;
function titleCamera(rdt) {
  titleT += rdt * 0.04;
  // slow orbit over the beach skyline at sunset
  const cx = BEACH.x0 + 20, cz = 6 * P;
  const a = Math.PI * 0.5 + Math.sin(titleT) * 0.6;
  const cam = G.camera;
  cam.position.set(cx + Math.cos(a) * 180, 34 + Math.sin(titleT * 1.7) * 8, cz + Math.sin(a) * 260);
  cam.lookAt(8 * P, 30, cz);
  if (G.vehicles.list.length < 10 && G.frame % 30 === 0) G.traffic.spawnOne();
  G.time += rdt;
  G.vehicles.update(rdt);
  G.traffic.update(rdt);
  G.hour = 18.4 + Math.sin(titleT * 0.5) * 0.4;
  if (G.audio.ok && G.audio.station === 0) G.audio.station = 1;
}

function photoCamera(rdt) {
  const pc = G.photoCam, pl = G.player;
  const cam = G.camera;
  cam.position.set(pl.x + Math.sin(pc.yaw) * pc.dist * Math.cos(pc.pitch), pl.y + 1.2 + Math.sin(pc.pitch) * pc.dist, pl.z + Math.cos(pc.yaw) * pc.dist * Math.cos(pc.pitch));
  cam.lookAt(pl.x, pl.y + 1.1, pl.z);
}

// stand-in player object for title screen (systems read G.player position)
window.__G = G;
boot().catch((e) => {
  console.error(e);
  $('loadtext').textContent = '加载失败：' + e.message + '（请使用支持 WebGL2 的现代浏览器）';
});

void CITY; void CZ; void groundHeight;
