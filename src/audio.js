// Original game audio: sfx, voice barks, engine rpm bands, 5 radio stations with jingles and ads.
import { fetchAsset, assetURL } from './assets.js';

const A = (name) => 'audio/' + name + '.m4a';

export const STATIONS = [
  { name: 'Vice 80s', id: '80s', songs: ['04', '05', '06', '07'] },
  { name: 'Electro FM', id: 'electro', songs: ['05', '06', '07', '08', 'stompbox'] },
  { name: 'Hip Hop 305', id: 'hiphop', songs: ['05', '06', 'boombapcats', 'bump', 'jerkit', 'volcano'] },
  { name: 'Radio Latino', id: 'latino', songs: ['06', '07', '08', '09'] },
  { name: 'Rock Miami', id: 'rock', songs: ['05', '06', '07', '08', 'bigbadwolf', 'notime', 'policesign'] },
];
const ADS = ['abraham', 'cheap_cuts', 'cheap_n_quick', 'dales_deals', 'davis', 'fix-o-matic', 'hellish_campgrounds',
  'schnellzahn', 'subprime_bank', 'the_bounce_ball', 'tighties', 'western_hospital'];
const SIMPLE_BANKS = {
  npc_harley: ['sfx_npc_harley_idle_loop', 'sfx_npc_harley_ride_loop'], npc_bike: ['sfx_npc_bike_idle_loop', 'sfx_npc_bike_ride_loop'],
  motocross: ['sfx_motocross_idle', 'sfx_motocross_ride'], boat: ['sfx_boat_idle_loop', 'sfx_boat_ride_loop'],
  airboat: ['sfx_airboat_loop_idle', 'sfx_airboat_loop_high'], helicopter: ['sfx_helicopter_loop', 'sfx_helicopter_loop'],
};

export class Audio {
  constructor() {
    this.ctx = null;
    this.buffers = new Map();
    this.loops = new Map();
    this.station = -1;
    this.volume = { sfx: 0.8, music: 0.55 };
  }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain(); this.master.connect(this.ctx.destination);
    this.sfxBus = this.ctx.createGain(); this.sfxBus.gain.value = this.volume.sfx; this.sfxBus.connect(this.master);
    this.musicBus = this.ctx.createGain(); this.musicBus.gain.value = this.volume.music; this.musicBus.connect(this.master);
    this.radioEl = new window.Audio();
    this.radioEl.crossOrigin = 'anonymous';
    this.radioSrc = this.ctx.createMediaElementSource(this.radioEl);
    this.radioFilter = this.ctx.createBiquadFilter();
    this.radioFilter.type = 'lowpass'; this.radioFilter.frequency.value = 22000;
    this.radioSrc.connect(this.radioFilter).connect(this.musicBus);
    this.radioEl.addEventListener('ended', () => this.nextTrack());
  }

  load(name) {
    let p = this.buffers.get(name);
    if (!p) {
      p = fetchAsset(A(name)).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(name)))
        .then((b) => this.ctx.decodeAudioData(b)).catch(() => null);
      this.buffers.set(name, p);
    }
    return p;
  }

  /** opts: vol, rate, pan (-1..1) */
  async play(name, { vol = 1, rate = 1, pan = 0 } = {}) {
    if (!this.ctx) return;
    const buf = await this.load(name);
    if (!buf) return;
    const s = this.ctx.createBufferSource();
    s.buffer = buf; s.playbackRate.value = rate;
    const g = this.ctx.createGain(); g.gain.value = vol;
    const p = this.ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan));
    s.connect(g).connect(p).connect(this.sfxBus);
    s.start();
    return s;
  }

  /** random numbered variant, e.g. bark('vfx_cop_chase') -> vfx_cop_chase_1..3 */
  bark(prefix, n = 3, opts) {
    if (this.lastBark && performance.now() - this.lastBark < 1800) return;
    this.lastBark = performance.now();
    return this.play(`${prefix}_${1 + Math.floor(Math.random() * n)}`, opts);
  }

  /** Persistent loop with live volume/rate control. */
  loop(key, name) {
    let l = this.loops.get(key);
    if (l && l.name === name) return l;
    if (l) this.stopLoop(key);
    if (!this.ctx) return null;
    const g = this.ctx.createGain(); g.gain.value = 0; g.connect(this.sfxBus);
    l = { name, gain: g, src: null, rate: 1 };
    this.loops.set(key, l);
    this.load(name).then((buf) => {
      if (!buf || this.loops.get(key) !== l) return;
      const s = this.ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.connect(g); s.start();
      s.playbackRate.value = l.rate;
      l.src = s;
    });
    return l;
  }

  setLoop(key, vol, rate = 1) {
    const l = this.loops.get(key);
    if (!l) return;
    l.gain.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.05);
    l.rate = rate;
    if (l.src) l.src.playbackRate.setTargetAtTime(rate, this.ctx.currentTime, 0.05);
  }

  stopLoop(key) {
    const l = this.loops.get(key);
    if (!l) return;
    l.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    setTimeout(() => { try { l.src && l.src.stop(); } catch { /* already stopped */ } l.gain.disconnect(); }, 300);
    this.loops.delete(key);
  }

  /** Engine sound from the original rpm bank: idle + low/mid/high throttle layers. */
  engine(bank, rpm, throttle, on) {
    if (!this.ctx) return;
    const layers = ['idle', 'onlow', 'onmid', 'onhigh'];
    if (!on) { for (const k of layers) this.stopLoop('eng_' + k); this.engineBank = null; return; }
    const simple = SIMPLE_BANKS[bank];
    if (simple) {
      if (this.engineBank !== bank) {
        for (const k of layers) this.stopLoop('eng_' + k);
        this.engineBank = bank;
        this.loop('eng_idle', simple[0]); this.loop('eng_onlow', simple[1]);
      }
      this.setLoop('eng_idle', 0.6 * (1 - rpm), 1 + rpm * 0.2);
      this.setLoop('eng_onlow', 0.75 * Math.min(1, rpm * 2), 0.8 + rpm * 0.5);
      return;
    }
    if (this.engineBank !== bank) {
      for (const k of layers) this.stopLoop('eng_' + k);
      this.engineBank = bank;
      const idle = bank === 'f450' ? 'idle' : 'idle';
      this.loop('eng_idle', `sfx_${bank}_${idle}`);
      for (const k of layers.slice(1)) this.loop('eng_' + k, `sfx_${bank}_${k}`);
    }
    const centers = [0, 0.3, 0.6, 0.95];
    const load = 0.55 + 0.45 * Math.abs(throttle);
    layers.forEach((k, i) => {
      const w = Math.max(0, 1 - Math.abs(rpm - centers[i]) / 0.33);
      const base = i === 0 ? 1 : 0.85 + (rpm - centers[i]) * 0.9;
      this.setLoop('eng_' + k, w * (i === 0 ? 0.55 : 0.75 * load), Math.max(0.5, base));
    });
  }

  // ---------- radio ----------
  setStation(i) {
    if (!this.ctx) return;
    this.station = i;
    if (i < 0) { this.radioEl.pause(); return; }
    this.play('sfx_car_radio_tune', { vol: 0.5 });
    this.queue = [];
    this.nextTrack(true);
  }

  cycleStation() {
    const n = this.station + 1 >= STATIONS.length ? -1 : this.station + 1;
    this.setStation(n);
    return n < 0 ? '电台关闭' : STATIONS[n].name;
  }

  nextTrack(first) {
    if (this.station < 0) return;
    const st = STATIONS[this.station];
    if (!this.queue || !this.queue.length) {
      const songs = [...st.songs].sort(() => Math.random() - 0.5);
      this.queue = [];
      for (const s of songs) {
        this.queue.push(`m_radio_${st.id}_jingle${Math.random() < 0.5 ? '' : '_' + (2 + Math.floor(Math.random() * 3))}`);
        this.queue.push(`m_radio_${st.id}_${s}`);
        if (Math.random() < 0.35) this.queue.push(`m_pub_${ADS[Math.floor(Math.random() * ADS.length)]}`);
      }
    }
    const t = this.queue.shift();
    const el = this.radioEl;
    assetURL(A(t)).then((u) => { if (this.station < 0) return; el.src = u; el.play().catch(() => {}); });
    if (first) this.radioEl.addEventListener('loadedmetadata', () => {
      if (/m_radio_.*_\d\d|bump|volcano|jerkit|stompbox|boombapcats|notime|bigbadwolf|policesign/.test(t))
        this.radioEl.currentTime = Math.random() * this.radioEl.duration * 0.6;
    }, { once: true });
  }

  /** Muffle the radio when outside a car. */
  setRadioInside(inside) {
    if (!this.ctx) return;
    this.radioFilter.frequency.setTargetAtTime(inside ? 22000 : 900, this.ctx.currentTime, 0.2);
    this.musicBus.gain.setTargetAtTime(inside ? this.volume.music : this.volume.music * 0.35, this.ctx.currentTime, 0.2);
  }

  music(name) {
    if (!this.ctx) return;
    if (this.bgm) { this.bgm.pause(); }
    if (!name) { this.bgm = null; return; }
    const bgm = this.bgm = new window.Audio();
    bgm.loop = true; bgm.volume = this.volume.music;
    assetURL(A(name)).then((u) => { if (this.bgm !== bgm) return; bgm.src = u; bgm.play().catch(() => {}); });
  }
}
