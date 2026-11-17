// Fully procedural audio (WebAudio): SFX, engine, ambience, and 3 original generative radio stations.
import { G } from './state.js';
import { clamp, lerp } from './util.js';

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);

export class AudioEngine {
  constructor() {
    this.ok = false;
    this.station = 1;
    this.stations = ['关闭', '霓虹浪潮 FM', '棕榈热浪 106.5', '深夜低频 Radio'];
  }

  init() {
    if (this.ok) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp); comp.connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master);
    this.music = ctx.createGain(); this.music.connect(this.master);
    // radio filter (sounds like it comes from car speakers)
    this.radioFilter = ctx.createBiquadFilter(); this.radioFilter.type = 'lowpass'; this.radioFilter.frequency.value = 9000;
    this.radioBus = ctx.createGain(); this.radioBus.connect(this.radioFilter); this.radioFilter.connect(this.music);
    // reverb (simple convolver)
    this.reverb = ctx.createConvolver();
    const len = ctx.sampleRate * 1.8, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
    this.reverb.buffer = ir;
    this.revGain = ctx.createGain(); this.revGain.gain.value = 0.25;
    this.reverb.connect(this.revGain); this.revGain.connect(this.sfx);
    // noise
    const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = nb.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    this.noiseBuf = nb;
    this.ok = true;
    this.setVolumes();
    this.startLoops();
    this.nextStep = 0; this.step = 0;
    this.schedTimer = setInterval(() => this.schedule(), 25);
  }

  setVolumes() {
    if (!this.ok) return;
    this.master.gain.value = G.settings.volume;
    this.music.gain.value = G.settings.music;
  }

  noise(dur = 2) {
    const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = dur > 1.9; return s;
  }

  // distance attenuation + pan relative to camera
  spatial(x, z, maxD = 120) {
    if (x === undefined || !G.camera) return { g: 1, pan: 0 };
    const cp = G.camera.position;
    const dx = x - cp.x, dz = z - cp.z;
    const d = Math.hypot(dx, dz);
    const g = clamp(1 - d / maxD, 0, 1) ** 1.6;
    const yaw = G.player ? G.player.camYaw : 0;
    const rx = -Math.cos(yaw), rz = Math.sin(yaw);
    const pan = clamp((dx * rx + dz * rz) / (d || 1), -1, 1) * 0.7;
    return { g, pan };
  }
  out(x, z, maxD, rev = 0.3) {
    const { g, pan } = this.spatial(x, z, maxD);
    const gain = this.ctx.createGain(); gain.gain.value = g;
    const p = this.ctx.createStereoPanner(); p.pan.value = pan;
    gain.connect(p); p.connect(this.sfx);
    if (rev > 0) { const r = this.ctx.createGain(); r.gain.value = rev * g; gain.connect(r); r.connect(this.reverb); }
    return g > 0.001 ? gain : null;
  }

  env(param, t, a, peak, dcy, end = 0.0001) {
    param.cancelScheduledValues(t);
    param.setValueAtTime(0.0001, t);
    param.exponentialRampToValueAtTime(peak, t + a);
    param.exponentialRampToValueAtTime(end, t + a + dcy);
  }

  // ---------------- one-shots ----------------
  gunshot(wid, x, z, isPlayer) {
    if (!this.ok) return;
    const dest = this.out(x, z, 260, 0.5); if (!dest) return;
    const t = this.ctx.currentTime;
    const cfg = { pistol: [1800, 0.16, 0.9], smg: [2400, 0.09, 0.7], shotgun: [1100, 0.35, 1.2], rifle: [2000, 0.18, 1.0], rocket: [600, 0.6, 0.8], grenade: [800, 0.1, 0.3] }[wid] || [1500, 0.15, 0.8];
    const n = this.noise(1); const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(cfg[0] * 3, t); f.frequency.exponentialRampToValueAtTime(cfg[0] * 0.3, t + cfg[1]);
    const g = this.ctx.createGain(); this.env(g.gain, t, 0.002, cfg[2] * (isPlayer ? 1 : 0.8), cfg[1]);
    n.connect(f); f.connect(g); g.connect(dest); n.start(t); n.stop(t + cfg[1] + 0.05);
    const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    const og = this.ctx.createGain(); this.env(og.gain, t, 0.002, cfg[2] * 0.9, 0.14);
    o.connect(og); og.connect(dest); o.start(t); o.stop(t + 0.2);
  }
  explosion(x, z) {
    if (!this.ok) return;
    const dest = this.out(x, z, 500, 0.8); if (!dest) return;
    const t = this.ctx.currentTime;
    const n = this.noise(2); const f = this.ctx.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.setValueAtTime(3000, t); f.frequency.exponentialRampToValueAtTime(120, t + 1.6);
    const g = this.ctx.createGain(); this.env(g.gain, t, 0.005, 2.2, 1.8);
    n.connect(f); f.connect(g); g.connect(dest); n.start(t); n.stop(t + 2);
    const o = this.ctx.createOscillator(); o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(25, t + 0.8);
    const og = this.ctx.createGain(); this.env(og.gain, t, 0.005, 2.0, 0.9);
    o.connect(og); og.connect(dest); o.start(t); o.stop(t + 1);
  }
  crash(intensity, x, z) {
    if (!this.ok) return;
    const dest = this.out(x, z, 150, 0.3); if (!dest) return;
    const t = this.ctx.currentTime;
    const n = this.noise(1); const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 0.7;
    const g = this.ctx.createGain(); this.env(g.gain, t, 0.003, 0.4 + intensity * 1.2, 0.25 + intensity * 0.3);
    n.connect(f); f.connect(g); g.connect(dest); n.start(t); n.stop(t + 0.7);
    for (let k = 0; k < 3; k++) {
      const o = this.ctx.createOscillator(); o.type = 'square'; o.frequency.value = 180 + Math.random() * 900;
      const og = this.ctx.createGain(); this.env(og.gain, t + k * 0.02, 0.002, 0.08 * intensity, 0.15 + Math.random() * 0.2);
      o.connect(og); og.connect(dest); o.start(t + k * 0.02); o.stop(t + 0.5);
    }
  }
  ricochet(x, z) {
    if (!this.ok) return;
    const dest = this.out(x, z, 60, 0.2); if (!dest) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(3000 + Math.random() * 2000, t); o.frequency.exponentialRampToValueAtTime(800, t + 0.25);
    const g = this.ctx.createGain(); this.env(g.gain, t, 0.002, 0.12, 0.25);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + 0.3);
  }
  punch(hit) {
    if (!this.ok) return;
    const t = this.ctx.currentTime, dest = this.sfx;
    const n = this.noise(1); const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = hit ? 900 : 2500;
    const g = this.ctx.createGain(); this.env(g.gain, t, 0.002, hit ? 0.9 : 0.15, hit ? 0.12 : 0.08);
    n.connect(f); f.connect(g); g.connect(dest); n.start(t); n.stop(t + 0.2);
  }
  thud(x, z) {
    if (!this.ok) return;
    const dest = this.out(x, z, 70, 0.1); if (!dest) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(50, t + 0.15);
    const g = this.ctx.createGain(); this.env(g.gain, t, 0.002, 1, 0.18);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + 0.25);
  }
  hurt(isPlayer, x, z) {
    if (!this.ok) return;
    const dest = isPlayer ? this.sfx : this.out(x, z, 50, 0.1); if (!dest) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'sawtooth';
    const base = isPlayer ? 160 : 140 + Math.random() * 120;
    o.frequency.setValueAtTime(base * 1.4, t); o.frequency.exponentialRampToValueAtTime(base, t + 0.18);
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 800; f.Q.value = 3;
    const g = this.ctx.createGain(); this.env(g.gain, t, 0.01, 0.25, 0.2);
    o.connect(f); f.connect(g); g.connect(dest); o.start(t); o.stop(t + 0.3);
  }
  scream(x, z) {
    if (!this.ok) return;
    const dest = this.out(x, z, 80, 0.3); if (!dest) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'sawtooth';
    const b = 500 + Math.random() * 300;
    o.frequency.setValueAtTime(b, t); o.frequency.linearRampToValueAtTime(b * 1.3, t + 0.2); o.frequency.linearRampToValueAtTime(b * 0.8, t + 0.7);
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = 7; const lg = this.ctx.createGain(); lg.gain.value = 25; lfo.connect(lg); lg.connect(o.frequency);
    const f1 = this.ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 1100; f1.Q.value = 4;
    const g = this.ctx.createGain(); this.env(g.gain, t, 0.05, 0.2, 0.65);
    o.connect(f1); f1.connect(g); g.connect(dest); o.start(t); lfo.start(t); o.stop(t + 0.8); lfo.stop(t + 0.8);
  }
  horn(x, z, ai) {
    if (!this.ok) return;
    const dest = x !== undefined ? this.out(x, z, 120, 0.3) : this.sfx; if (!dest) return;
    const t = this.ctx.currentTime;
    for (const fr of ai ? [370, 466] : [415, 523]) {
      const o = this.ctx.createOscillator(); o.type = 'square'; o.frequency.value = fr;
      const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1800;
      const g = this.ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.12, t + 0.02); g.gain.setValueAtTime(0.12, t + 0.45); g.gain.linearRampToValueAtTime(0, t + 0.5);
      o.connect(f); f.connect(g); g.connect(dest); o.start(t); o.stop(t + 0.55);
    }
  }
  door() { this.punch(false); }
  splash() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    const n = this.noise(1); const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(4000, t); f.frequency.exponentialRampToValueAtTime(300, t + 1);
    const g = this.ctx.createGain(); this.env(g.gain, t, 0.01, 1, 1);
    n.connect(f); f.connect(g); g.connect(this.sfx); n.start(t); n.stop(t + 1.2);
  }
  thunder() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    const n = this.noise(2); const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 220;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1.6, t + 0.15); g.gain.exponentialRampToValueAtTime(0.001, t + 3.5);
    n.connect(f); f.connect(g); g.connect(this.sfx); n.start(t); n.stop(t + 3.6);
  }
  focus(on) {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(on ? 800 : 200, t); o.frequency.exponentialRampToValueAtTime(on ? 120 : 700, t + 0.5);
    const g = this.ctx.createGain(); this.env(g.gain, t, 0.02, 0.35, 0.5);
    o.connect(g); g.connect(this.sfx); g.connect(this.reverb); o.start(t); o.stop(t + 0.6);
    this.radioFilter.frequency.setTargetAtTime(on ? 700 : 9000, t, 0.2);
  }
  ui(kind) {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    const seq = {
      cash: [[76, 0], [83, 0.07], [88, 0.14]], switch: [[72, 0]], reload: [[50, 0], [55, 0.15]], empty: [[40, 0]], jump: [],
      combo: [[79, 0], [86, 0.05]], wanted: [[69, 0], [69, 0.18], [69, 0.36]], evade: [[72, 0], [76, 0.1], [79, 0.2], [84, 0.3]],
      mission: [[60, 0], [64, 0.12], [67, 0.24], [72, 0.36], [76, 0.5], [79, 0.62], [84, 0.8]], fail: [[60, 0], [55, 0.25], [50, 0.5]],
      checkpoint: [[84, 0], [91, 0.08]], pickup: [[79, 0], [84, 0.06], [91, 0.12]], badge: [[84, 0], [88, 0.08], [91, 0.16], [96, 0.24]],
      click: [[90, 0]], start: [[67, 0], [72, 0.1], [79, 0.2]],
    }[kind] || [];
    for (const [n, dt] of seq) {
      const o = this.ctx.createOscillator(); o.type = kind === 'wanted' ? 'square' : 'triangle'; o.frequency.value = NOTE(n);
      const g = this.ctx.createGain(); this.env(g.gain, t + dt, 0.005, kind === 'mission' ? 0.25 : 0.18, kind === 'mission' ? 0.5 : 0.18);
      o.connect(g); g.connect(this.sfx); o.start(t + dt); o.stop(t + dt + 0.7);
    }
  }

  // ---------------- continuous loops ----------------
  startLoops() {
    const ctx = this.ctx;
    // engine
    this.eng = { o1: ctx.createOscillator(), o2: ctx.createOscillator(), o3: ctx.createOscillator(), f: ctx.createBiquadFilter(), g: ctx.createGain() };
    const e = this.eng;
    e.o1.type = 'sawtooth'; e.o2.type = 'square'; e.o3.type = 'sine';
    e.f.type = 'lowpass'; e.f.frequency.value = 600; e.f.Q.value = 2;
    const g2 = ctx.createGain(); g2.gain.value = 0.35;
    e.o1.connect(e.f); e.o2.connect(g2); g2.connect(e.f); e.o3.connect(e.f);
    e.f.connect(e.g); e.g.gain.value = 0; e.g.connect(this.sfx);
    e.o1.start(); e.o2.start(); e.o3.start();
    // tires
    this.tire = { n: this.noise(2), f: ctx.createBiquadFilter(), g: ctx.createGain() };
    this.tire.f.type = 'bandpass'; this.tire.f.frequency.value = 2200; this.tire.f.Q.value = 3;
    this.tire.n.connect(this.tire.f); this.tire.f.connect(this.tire.g); this.tire.g.gain.value = 0; this.tire.g.connect(this.sfx); this.tire.n.start();
    // wind
    this.wind = { n: this.noise(2), f: ctx.createBiquadFilter(), g: ctx.createGain() };
    this.wind.f.type = 'lowpass'; this.wind.f.frequency.value = 500;
    this.wind.n.connect(this.wind.f); this.wind.f.connect(this.wind.g); this.wind.g.gain.value = 0; this.wind.g.connect(this.sfx); this.wind.n.start();
    // rain
    this.rainL = { n: this.noise(2), f: ctx.createBiquadFilter(), g: ctx.createGain() };
    this.rainL.f.type = 'highpass'; this.rainL.f.frequency.value = 1200;
    this.rainL.n.connect(this.rainL.f); this.rainL.f.connect(this.rainL.g); this.rainL.g.gain.value = 0; this.rainL.g.connect(this.sfx); this.rainL.n.start();
    // ambience (city hum / waves)
    this.amb = { n: this.noise(2), f: ctx.createBiquadFilter(), g: ctx.createGain(), lfo: ctx.createOscillator(), lg: ctx.createGain() };
    this.amb.f.type = 'lowpass'; this.amb.f.frequency.value = 350;
    this.amb.lfo.frequency.value = 0.12; this.amb.lg.gain.value = 0.04;
    this.amb.lfo.connect(this.amb.lg); this.amb.lg.connect(this.amb.g.gain);
    this.amb.n.connect(this.amb.f); this.amb.f.connect(this.amb.g); this.amb.g.gain.value = 0.05; this.amb.g.connect(this.sfx); this.amb.n.start(); this.amb.lfo.start();
    // siren
    this.sir = { o: ctx.createOscillator(), lfo: ctx.createOscillator(), lg: ctx.createGain(), g: ctx.createGain(), p: ctx.createStereoPanner() };
    const s = this.sir;
    s.o.type = 'triangle'; s.o.frequency.value = 900; s.lfo.type = 'sine'; s.lfo.frequency.value = 0.35; s.lg.gain.value = 320;
    s.lfo.connect(s.lg); s.lg.connect(s.o.frequency); s.o.connect(s.g); s.g.connect(s.p); s.p.connect(this.sfx); s.g.gain.value = 0;
    s.o.start(); s.lfo.start();
    // heli
    this.hel = { n: this.noise(2), f: ctx.createBiquadFilter(), g: ctx.createGain(), am: ctx.createGain(), lfo: ctx.createOscillator(), lg: ctx.createGain() };
    const h = this.hel;
    h.f.type = 'lowpass'; h.f.frequency.value = 280; h.lfo.type = 'square'; h.lfo.frequency.value = 13; h.lg.gain.value = 0.5; h.am.gain.value = 0.5;
    h.lfo.connect(h.lg); h.lg.connect(h.am.gain);
    h.n.connect(h.f); h.f.connect(h.am); h.am.connect(h.g); h.g.gain.value = 0; h.g.connect(this.sfx); h.n.start(); h.lfo.start();
  }

  heli(x, y, z) {
    if (!this.ok) return;
    if (x === null) { this.hel.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3); return; }
    const { g } = this.spatial(x, z, 300);
    this.hel.g.gain.setTargetAtTime(g * 1.4, this.ctx.currentTime, 0.1);
  }
  setRain(r) { if (this.ok) this.rainL.g.gain.setTargetAtTime(r * 0.18, this.ctx.currentTime, 0.5); }

  update(dt) {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    const pl = G.player;
    const v = pl && pl.inVehicle;
    const e = this.eng;
    if (v && !v.dead && !G.paused) {
      const sp = Math.abs(v.vF);
      const top = v.t.top;
      const gears = [0, 0.18, 0.34, 0.52, 0.72, 0.92, 1.3];
      let gear = 1; while (gear < 6 && sp / top > gears[gear]) gear++;
      const lo = gears[gear - 1], hi = gears[gear];
      let rpm = clamp((sp / top - lo) / (hi - lo), 0, 1);
      rpm = 0.22 + rpm * 0.78;
      if (Math.abs(v.input.throttle) > 0.1 && sp < 2) rpm = 0.45 + Math.random() * 0.05;
      if (!v.grounded) rpm = Math.min(1, rpm + 0.2);
      const base = v.typeKey === 'super' ? 70 : v.typeKey === 'muscle' ? 45 : v.typeKey === 'van' || v.typeKey === 'armored' ? 38 : 52;
      const f = base + rpm * base * 2.4;
      e.o1.frequency.setTargetAtTime(f, t, 0.05); e.o2.frequency.setTargetAtTime(f * 0.5, t, 0.05); e.o3.frequency.setTargetAtTime(f * 0.25, t, 0.05);
      e.f.frequency.setTargetAtTime(300 + rpm * 1800 * (0.5 + Math.abs(v.input.throttle)), t, 0.05);
      e.g.gain.setTargetAtTime(0.09 + Math.abs(v.input.throttle) * 0.08 + (v.nitroOn ? 0.05 : 0), t, 0.08);
      this.tire.g.gain.setTargetAtTime((pl.slip || 0) * 0.22, t, 0.05);
      this.wind.g.gain.setTargetAtTime(clamp(sp / 60, 0, 1) * 0.12, t, 0.2);
      this.radioBus.gain.setTargetAtTime(1, t, 0.3);
    } else {
      e.g.gain.setTargetAtTime(0, t, 0.1);
      this.tire.g.gain.setTargetAtTime(0, t, 0.05);
      this.wind.g.gain.setTargetAtTime(0, t, 0.2);
      this.radioBus.gain.setTargetAtTime(G.started && !G.paused ? 0 : 0.7, t, 0.4);
    }
    // nearest siren
    let best = null, bd = 1e9;
    for (const c of G.vehicles ? G.vehicles.list : []) {
      if (!c.siren || c.dead) continue;
      const d = (c.x - G.camera.position.x) ** 2 + (c.z - G.camera.position.z) ** 2;
      if (d < bd) { bd = d; best = c; }
    }
    if (best && !G.paused) {
      const { g, pan } = this.spatial(best.x, best.z, 220);
      this.sir.g.gain.setTargetAtTime(g * 0.09, t, 0.1); this.sir.p.pan.setTargetAtTime(pan, t, 0.1);
    } else this.sir.g.gain.setTargetAtTime(0, t, 0.2);
    // ambience: louder waves near beach
    this.amb.f.frequency.setTargetAtTime(pl && pl.x > 900 ? 600 : 300, t, 1);
    if (G.paused) this.hel.g.gain.setTargetAtTime(0, t, 0.1);
  }

  // ---------------- radio ----------------
  nextStation() {
    this.station = (this.station + 1) % this.stations.length;
    G.hud && G.hud.radio(this.stations[this.station]);
    this.ui('click');
  }

  schedule() {
    if (!this.ok || this.station === 0) return;
    const ctx = this.ctx;
    const bpm = [0, 104, 112, 82][this.station];
    const stepDur = 60 / bpm / 4;
    if (this.nextStep < ctx.currentTime - 0.2) this.nextStep = ctx.currentTime + 0.05;
    while (this.nextStep < ctx.currentTime + 0.15) {
      this.playStep(this.station, this.step, this.nextStep, stepDur);
      this.step++;
      // swing for lo-fi
      this.nextStep += stepDur * (this.station === 3 ? (this.step % 2 ? 1.16 : 0.84) : 1);
    }
  }

  tone(type, freq, t, dur, vol, dest, cutoff = 4000, detune = 0, attack = 0.01) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq; o.detune.value = detune;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f); f.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.05);
  }
  drum(kind, t, vol, dest) {
    const ctx = this.ctx;
    if (kind === 'kick') {
      const o = ctx.createOscillator(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
      const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      o.connect(g); g.connect(dest); o.start(t); o.stop(t + 0.4);
    } else if (kind === 'snare' || kind === 'hat' || kind === 'clap' || kind === 'shaker') {
      const n = this.noise(1); const f = ctx.createBiquadFilter();
      f.type = kind === 'snare' ? 'bandpass' : 'highpass';
      f.frequency.value = kind === 'snare' ? 1800 : kind === 'clap' ? 1200 : 7000;
      const g = ctx.createGain(); const dur = kind === 'snare' ? 0.18 : kind === 'clap' ? 0.12 : kind === 'shaker' ? 0.06 : 0.04;
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      n.connect(f); f.connect(g); g.connect(dest); n.start(t); n.stop(t + dur + 0.02);
      if (kind === 'snare') { const r = ctx.createGain(); r.gain.value = 0.4; g.connect(r); r.connect(this.reverb); }
    } else if (kind === 'conga' || kind === 'bongo') {
      const o = ctx.createOscillator(); const b = kind === 'conga' ? 220 : 380;
      o.frequency.setValueAtTime(b * 1.3, t); o.frequency.exponentialRampToValueAtTime(b, t + 0.05);
      const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      o.connect(g); g.connect(dest); o.start(t); o.stop(t + 0.25);
    } else if (kind === 'clave') {
      this.tone('sine', 2500, t, 0.05, vol, dest, 8000, 0, 0.001);
    }
  }

  playStep(st, step, t, sd) {
    const d = this.radioBus;
    const s16 = step % 16, bar = Math.floor(step / 16);
    if (st === 1) {
      // synthwave: Am - F - C - G  (original generative arrangement)
      const prog = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
      const roots = [45, 41, 48, 43];
      const ch = prog[bar % 4], root = roots[bar % 4];
      if (s16 % 4 === 0) this.drum('kick', t, 0.9, d);
      if (s16 === 4 || s16 === 12) this.drum('snare', t, 0.45, d);
      if (s16 % 2 === 1) this.drum('hat', t, 0.12, d);
      // bass 8ths with octave jump
      if (s16 % 2 === 0) this.tone('sawtooth', NOTE(root - 12 + (s16 % 4 === 2 ? 12 : 0)), t, sd * 1.8, 0.16, d, 700);
      // pad
      if (s16 === 0) for (const n of ch) { this.tone('sawtooth', NOTE(n), t, sd * 16, 0.035, d, 1600, -8, 0.4); this.tone('sawtooth', NOTE(n), t, sd * 16, 0.035, d, 1600, 8, 0.4); }
      // arpeggio lead (every other 4 bars)
      if (Math.floor(bar / 4) % 2 === 1) {
        const arp = [ch[0] + 12, ch[1] + 12, ch[2] + 12, ch[1] + 12];
        this.tone('square', NOTE(arp[s16 % 4]), t, sd * 0.9, 0.04, d, 3000);
      }
      if (bar % 8 === 7 && s16 >= 12) this.drum('snare', t, 0.3, d);
    } else if (st === 2) {
      // latin: Dm - G - C - A (montuno + tumbao + clave)
      const prog = [[62, 65, 69], [59, 62, 67], [60, 64, 67], [61, 64, 69]];
      const roots = [38, 43, 36, 45];
      const ch = prog[bar % 4], root = roots[bar % 4];
      const clave = [0, 3, 6, 10, 12];
      if (clave.includes(s16)) this.drum('clave', t, 0.12, d);
      if ([2, 6, 10, 14].includes(s16)) this.drum('conga', t, 0.35, d);
      if ([7, 15].includes(s16)) this.drum('bongo', t, 0.3, d);
      this.drum('shaker', t, 0.05 + (s16 % 2 ? 0 : 0.04), d);
      if (s16 === 0 || s16 === 8) this.drum('kick', t, 0.5, d);
      // tumbao bass: anticipated
      if (s16 === 3) this.tone('triangle', NOTE(root), t, sd * 3, 0.3, d, 900);
      if (s16 === 6) this.tone('triangle', NOTE(root + 7), t, sd * 2, 0.25, d, 900);
      if (s16 === 11) this.tone('triangle', NOTE(root + 12), t, sd * 3, 0.25, d, 900);
      // piano montuno stabs
      const mont = [0, 3, 5, 8, 10, 13];
      if (mont.includes(s16)) for (const n of ch) this.tone('triangle', NOTE(n + (s16 % 2 ? 12 : 0)), t, sd * 1.5, 0.05, d, 5000, 0, 0.003);
      // horn line occasionally
      if (bar % 4 === 2 && [0, 2, 4].includes(s16)) this.tone('sawtooth', NOTE(ch[2] + 12), t, sd * 1.8, 0.05, d, 2500);
    } else if (st === 3) {
      // lo-fi: Fmaj7 - Em7 - Dm7 - Cmaj7
      const prog = [[53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [48, 52, 55, 59]];
      const ch = prog[bar % 4];
      if (s16 === 0 || s16 === 10) this.drum('kick', t, 0.7, d);
      if (s16 === 4 || s16 === 12) this.drum('snare', t, 0.25, d);
      if (s16 % 2 === 0) this.drum('hat', t, 0.06, d);
      if (s16 === 0) for (const n of ch) { this.tone('sine', NOTE(n), t, sd * 14, 0.05, d, 1800, 0, 0.05); this.tone('triangle', NOTE(n + 12), t, sd * 6, 0.012, d, 2400, 5, 0.02); }
      if (s16 === 0 || s16 === 7) this.tone('sine', NOTE(ch[0] - 12), t, sd * 6, 0.25, d, 400);
      // melody fragments
      if (bar % 2 === 1 && [2, 5, 9].includes(s16)) this.tone('sine', NOTE(ch[(s16 + bar) % 4] + 12), t, sd * 3, 0.05, d, 3000, 0, 0.02);
      // vinyl crackle
      if (Math.random() < 0.3) this.drum('hat', t + Math.random() * sd, 0.015, d);
    }
  }
}
