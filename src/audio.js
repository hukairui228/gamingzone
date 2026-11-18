// Original game audio: sfx, voice barks, engine rpm bands, 5 radio stations with jingles and ads.
import { fetchAsset, assetURL, MODE, localBytes } from './assets.js';

// ---- original IMA-ADPCM .wav files (standalone app imports them as-is) ----
const IMA_STEP = [7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107,
  118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166,
  1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630,
  9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767];
const IMA_INDEX = [-1, -1, -1, -1, 2, 4, 6, 8];

/** decode a RIFF WAVE (IMA ADPCM 0x11 or PCM16) -> { rate, channels: Float32Array[] } */
export function decodeWav(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 12, fmt = null, data = null;
  while (o + 8 <= v.byteLength) {
    const id = String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
    const len = v.getUint32(o + 4, true);
    if (id === 'fmt ') fmt = { tag: v.getUint16(o + 8, true), ch: v.getUint16(o + 10, true), rate: v.getUint32(o + 12, true),
      align: v.getUint16(o + 20, true), bits: v.getUint16(o + 22, true), spb: len >= 22 ? v.getUint16(o + 26, true) : 0 };
    if (id === 'data') data = [o + 8, Math.min(len, v.byteLength - o - 8)];
    o += 8 + len + (len & 1);
  }
  if (!fmt || !data) throw new Error('bad wav');
  const [start, size] = data, nch = fmt.ch;
  if (fmt.tag === 1) {
    const n = Math.floor(size / 2 / nch);
    const out = Array.from({ length: nch }, () => new Float32Array(n));
    for (let i = 0; i < n; i++) for (let c = 0; c < nch; c++) out[c][i] = v.getInt16(start + (i * nch + c) * 2, true) / 32768;
    return { rate: fmt.rate, channels: out };
  }
  if (fmt.tag !== 0x11) throw new Error('unsupported wav format ' + fmt.tag);
  const align = fmt.align, spb = fmt.spb || ((align - 4 * nch) * 8) / (4 * nch) + 1;
  const blocks = Math.ceil(size / align);
  const out = Array.from({ length: nch }, () => new Float32Array(blocks * spb));
  for (let b = 0; b < blocks; b++) {
    const bo = start + b * align, bend = Math.min(start + size, bo + align);
    const pred = [], idx = [];
    for (let c = 0; c < nch; c++) {
      pred[c] = v.getInt16(bo + c * 4, true); idx[c] = Math.min(88, bytes[bo + c * 4 + 2]);
      out[c][b * spb] = pred[c] / 32768;
    }
    let p = bo + 4 * nch, k = 1;
    while (p + 4 * nch <= bend && k < spb) {
      for (let c = 0; c < nch; c++) {
        for (let j = 0; j < 8; j++) {
          const byte = bytes[p + c * 4 + (j >> 1)];
          const nib = j & 1 ? byte >> 4 : byte & 15;
          const step = IMA_STEP[idx[c]];
          let diff = step >> 3;
          if (nib & 4) diff += step; if (nib & 2) diff += step >> 1; if (nib & 1) diff += step >> 2;
          pred[c] = Math.max(-32768, Math.min(32767, pred[c] + (nib & 8 ? -diff : diff)));
          idx[c] = Math.max(0, Math.min(88, idx[c] + IMA_INDEX[nib & 7]));
          if (k + j < spb) out[c][b * spb + k + j] = pred[c] / 32768;
        }
      }
      p += 4 * nch; k += 8;
    }
  }
  return { rate: fmt.rate, channels: out };
}

/** PCM16 WAV blob for the streaming <audio> element (radio / menu music) */
function wavBlob({ rate, channels }) {
  const nch = channels.length, n = channels[0].length;
  const buf = new ArrayBuffer(44 + n * nch * 2), v = new DataView(buf);
  const str = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * nch * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nch, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * nch * 2, true); v.setUint16(32, nch * 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * nch * 2, true);
  const pcm = new Int16Array(buf, 44);
  for (let i = 0; i < n; i++) for (let c = 0; c < nch; c++) pcm[i * nch + c] = Math.max(-32768, Math.min(32767, channels[c][i] * 32767));
  return new Blob([buf], { type: 'audio/wav' });
}

/** URL for a streamed track; local mode decodes the original ADPCM into a temporary PCM blob */
async function trackURL(name) {
  if (MODE !== 'local') return assetURL(A(name));
  const b = await localBytes('audio/' + name + '.wav');
  return b ? URL.createObjectURL(wavBlob(decodeWav(b))) : '';
}


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
      p = MODE === 'local'
        ? localBytes('audio/' + name + '.wav').then((b) => {
          if (!b) return null;
          const d = decodeWav(b);
          const ab = this.ctx.createBuffer(d.channels.length, d.channels[0].length, d.rate);
          d.channels.forEach((ch, i) => ab.copyToChannel(ch, i));
          return ab;
        }).catch(() => null)
        : fetchAsset(A(name)).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(name)))
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
    if (i < 0) {
      this.radioEl.pause();
      if (this.radioURL && this.radioURL.startsWith('blob:')) { URL.revokeObjectURL(this.radioURL); this.radioURL = null; }
      return;
    }
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
    trackURL(t).then((u) => {
      if (this.station < 0 || !u) return;
      if (this.radioURL && this.radioURL.startsWith('blob:')) URL.revokeObjectURL(this.radioURL);
      this.radioURL = u; el.src = u; el.play().catch(() => {});
    });
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
    if (this.bgm) { this.bgm.pause(); if (this.bgm.src.startsWith('blob:')) URL.revokeObjectURL(this.bgm.src); }
    if (!name) { this.bgm = null; return; }
    const bgm = this.bgm = new window.Audio();
    bgm.loop = true; bgm.volume = this.volume.music;
    trackURL(name).then((u) => { if (this.bgm !== bgm || !u) return; bgm.src = u; bgm.play().catch(() => {}); });
  }
}
