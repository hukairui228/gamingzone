// Procedurally generated textures (no external assets needed).
import * as THREE from 'three';

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

// tileable value noise
function makeNoise(size, seed = 1) {
  const g = new Float32Array(size * size);
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const grid = 16, cells = new Float32Array((grid + 1) * (grid + 1));
  for (let i = 0; i < cells.length; i++) cells[i] = r();
  for (let y = 0; y <= grid; y++) cells[y * (grid + 1) + grid] = cells[y * (grid + 1)];
  for (let x = 0; x <= grid; x++) cells[grid * (grid + 1) + x] = cells[x];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const fx = x / size * grid, fy = y / size * grid;
    const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = cells[iy * (grid + 1) + ix], b = cells[iy * (grid + 1) + ix + 1];
    const c = cells[(iy + 1) * (grid + 1) + ix], d = cells[(iy + 1) * (grid + 1) + ix + 1];
    g[y * size + x] = (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
  }
  return g;
}

export function waterNormals() {
  const size = 256, c = canvas(size, size), ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const h = new Float32Array(size * size);
  const waves = [];
  for (let k = 0; k < 24; k++) {
    const ang = Math.random() * Math.PI * 2;
    const f = [1, 2, 3, 4, 5, 6, 8][k % 7];
    waves.push({ kx: Math.round(Math.cos(ang) * f), ky: Math.round(Math.sin(ang) * f), ph: Math.random() * 6.28, a: 1 / (f + 0.5) });
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let v = 0;
    for (const w of waves) v += Math.sin((w.kx * x + w.ky * y) / size * Math.PI * 2 + w.ph) * w.a;
    h[y * size + x] = v;
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const l = h[y * size + ((x - 1 + size) % size)], r = h[y * size + (x + 1) % size];
    const u = h[((y - 1 + size) % size) * size + x], d = h[((y + 1) % size) * size + x];
    let nx = (l - r) * 1.2, ny = (u - d) * 1.2, nz = 1;
    const L = Math.hypot(nx, ny, nz); nx /= L; ny /= L; nz /= L;
    const i = (y * size + x) * 4;
    img.data[i] = (nx * 0.5 + 0.5) * 255; img.data[i + 1] = (ny * 0.5 + 0.5) * 255; img.data[i + 2] = (nz * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function sandTexture() {
  const size = 512, c = canvas(size, size), ctx = c.getContext('2d');
  const n1 = makeNoise(size, 7), n2 = makeNoise(size, 99);
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = 0.82 + n1[i] * 0.12 + n2[i] * 0.06 + (Math.random() - 0.5) * 0.12;
    img.data[i * 4] = 236 * v; img.data[i * 4 + 1] = 214 * v; img.data[i * 4 + 2] = 170 * v; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function glowTexture() {
  const s = 128, c = canvas(s, s), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(c);
}

export function smokeTexture() {
  const s = 128, c = canvas(s, s), ctx = c.getContext('2d');
  for (let k = 0; k < 18; k++) {
    const x = s / 2 + (Math.random() - 0.5) * 40, y = s / 2 + (Math.random() - 0.5) * 40, r = 20 + Math.random() * 30;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.22)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  }
  return new THREE.CanvasTexture(c);
}

// neon sign: text drawn with glow; used as emissive map
export function neonSignTexture(text, color, vertical = false, sub = '') {
  const w = vertical ? 128 : 512, h = vertical ? 512 : 160;
  const c = canvas(w, h), ctx = c.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = color; ctx.lineJoin = 'round';
  const font = '900 ' + (vertical ? 92 : 100) + 'px "Arial Black", Impact, sans-serif';
  ctx.font = font;
  const draw = (pass) => {
    ctx.shadowBlur = pass === 0 ? 30 : 8;
    ctx.strokeStyle = color; ctx.lineWidth = pass === 0 ? 10 : 5;
    ctx.fillStyle = pass === 0 ? color : '#fff';
    if (vertical) {
      const chars = [...text];
      const step = (h - 40) / chars.length;
      chars.forEach((ch, i) => { const y = 20 + step * (i + 0.5); ctx.strokeText(ch, w / 2, y); if (pass) ctx.fillText(ch, w / 2, y); });
    } else {
      ctx.strokeText(text, w / 2, h / 2 - (sub ? 14 : 0));
      if (pass) ctx.fillText(text, w / 2, h / 2 - (sub ? 14 : 0));
      if (sub && pass) { ctx.font = '700 34px Arial, sans-serif'; ctx.fillStyle = color; ctx.shadowBlur = 12; ctx.fillText(sub, w / 2, h - 24); ctx.font = font; }
    }
  };
  draw(0); draw(1);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function palmFrondTexture() {
  const w = 128, h = 512, c = canvas(w, h), ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  // central rib
  ctx.strokeStyle = '#4c6b2a'; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(w / 2, h); ctx.lineTo(w / 2, 0); ctx.stroke();
  for (let y = 10; y < h - 10; y += 7) {
    const t = y / h, len = Math.sin(t * Math.PI) * w * 0.48 + 6;
    const g = 90 + Math.random() * 50;
    ctx.strokeStyle = `rgb(${40 + Math.random() * 30},${g},${30 + Math.random() * 20})`;
    ctx.lineWidth = 3.2;
    ctx.beginPath(); ctx.moveTo(w / 2, y); ctx.lineTo(w / 2 - len, y + 26 + t * 10); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(w / 2, y); ctx.lineTo(w / 2 + len, y + 26 + t * 10); ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function tileTexture() {
  const s = 256, c = canvas(s, s), ctx = c.getContext('2d');
  const n = makeNoise(s, 3);
  const img = ctx.createImageData(s, s);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const i = y * s + x;
    const grout = (x % 64 < 2 || y % 64 < 2) ? 0.7 : 1;
    const v = (0.78 + n[i] * 0.15 + (Math.random() - 0.5) * 0.06) * grout;
    img.data[i * 4] = 205 * v; img.data[i * 4 + 1] = 196 * v; img.data[i * 4 + 2] = 184 * v; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

export function starsTexture() { return glowTexture(); }
