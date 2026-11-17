// Visual effects: GPU point particles, tracers, skid marks, flashes.
import * as THREE from 'three';
import { G } from './state.js';
import { glowTexture, smokeTexture } from './textures.js';
import { rand } from './util.js';

const VS = /* glsl */`
attribute float aSize; attribute vec4 aColor; attribute float aRot;
varying vec4 vColor; varying float vRot;
void main(){
  vColor = aColor; vRot = aRot;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * (900.0 / -mv.z);
}`;
const FS = /* glsl */`
uniform sampler2D map; varying vec4 vColor; varying float vRot;
void main(){
  vec2 p = gl_PointCoord - 0.5;
  float c = cos(vRot), s = sin(vRot);
  p = vec2(c * p.x - s * p.y, s * p.x + c * p.y) + 0.5;
  vec4 t = texture2D(map, p);
  gl_FragColor = vec4(vColor.rgb, vColor.a * t.a);
  if (gl_FragColor.a < 0.003) discard;
}`;

class ParticlePool {
  constructor(scene, max, tex, blending) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.rot = new Float32Array(max);
    this.p = []; // particle state objects
    for (let i = 0; i < max; i++) this.p.push({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s0: 1, s1: 1, r: 1, g: 1, b: 1, a: 1, drag: 0, grav: 0, rot: 0, vr: 0, fade: 1, r1: null });
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aRot', new THREE.BufferAttribute(this.rot, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({ uniforms: { map: { value: tex } }, vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, blending });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.cursor = 0;
  }
  emit(o) {
    const p = this.p[this.cursor];
    this.cursor = (this.cursor + 1) % this.max;
    Object.assign(p, { drag: 0, grav: 0, rot: Math.random() * 6, vr: 0, fade: 1, r1: null }, o);
    p.life = p.max;
    return p;
  }
  update(dt) {
    for (let i = 0; i < this.max; i++) {
      const p = this.p[i];
      if (p.life <= 0) { this.col[i * 4 + 3] = 0; this.size[i] = 0; continue; }
      p.life -= dt;
      p.vy -= p.grav * dt;
      const d = 1 - Math.min(1, p.drag * dt);
      p.vx *= d; p.vy *= d; p.vz *= d;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.02 && p.grav > 0) { p.y = 0.02; p.vy *= -0.3; p.vx *= 0.6; p.vz *= 0.6; }
      p.rot += p.vr * dt;
      const t = 1 - p.life / p.max;
      this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
      const r = p.r1 ? p.r + (p.r1[0] - p.r) * t : p.r, g = p.r1 ? p.g + (p.r1[1] - p.g) * t : p.g, b = p.r1 ? p.b + (p.r1[2] - p.b) * t : p.b;
      this.col[i * 4] = r; this.col[i * 4 + 1] = g; this.col[i * 4 + 2] = b;
      this.col[i * 4 + 3] = p.a * (p.fade ? Math.min(1, (1 - t) * 1.5) * Math.min(1, t * 8 + 0.3) : 1);
      this.size[i] = p.s0 + (p.s1 - p.s0) * t;
      this.rot[i] = p.rot;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aRot.needsUpdate = true;
  }
}

export class FX {
  constructor(scene) {
    this.scene = scene;
    this.add = new ParticlePool(scene, 1500, glowTexture(), THREE.AdditiveBlending);
    this.smk = new ParticlePool(scene, 900, smokeTexture(), THREE.NormalBlending);
    // tracers
    this.maxTr = 64;
    this.trPos = new Float32Array(this.maxTr * 6);
    this.trLife = new Float32Array(this.maxTr);
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(this.trPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.tracers = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ color: new THREE.Color(4, 3, 1.5), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.tracers.frustumCulled = false;
    scene.add(this.tracers);
    this.trCursor = 0;
    // flash lights pool
    this.lights = [];
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xffaa55, 0, 20, 2);
      scene.add(l);
      this.lights.push({ l, life: 0, max: 1, I: 0 });
    }
    // skid marks
    this.maxSkid = 1600;
    const sg = new THREE.PlaneGeometry(1, 1); sg.rotateX(-Math.PI / 2);
    this.skid = new THREE.InstancedMesh(sg, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), this.maxSkid);
    this.skid.count = 0;
    this.skid.frustumCulled = false;
    scene.add(this.skid);
    this.skidCursor = 0;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._v = new THREE.Vector3(); this._s = new THREE.Vector3();
    this.shake = 0;
    // shockwave rings
    this.rings = [];
  }

  flash(x, y, z, color, intensity, life, range = 25) {
    let best = this.lights[0];
    for (const L of this.lights) if (L.life < best.life) best = L;
    best.l.position.set(x, y, z); best.l.color.set(color); best.l.distance = range;
    best.life = best.max = life; best.I = intensity;
    best.l.intensity = intensity;
  }

  sparks(x, y, z, n = 10) {
    for (let i = 0; i < n; i++) {
      this.add.emit({ x, y, z, vx: rand(-6, 6), vy: rand(1, 7), vz: rand(-6, 6), grav: 18, drag: 1, max: rand(0.25, 0.6), s0: 0.18, s1: 0.04, r: 3, g: 2, b: 0.8, a: 1 });
    }
  }
  smoke(x, y, z, shade = 0.5, n = 1, big = 1) {
    for (let i = 0; i < n; i++) {
      this.smk.emit({ x: x + rand(-0.3, 0.3), y, z: z + rand(-0.3, 0.3), vx: rand(-0.6, 0.6), vy: rand(1.5, 3), vz: rand(-0.6, 0.6), drag: 0.6, max: rand(1.6, 2.8), s0: 0.8 * big, s1: 3.5 * big, r: shade, g: shade, b: shade, a: 0.55, vr: rand(-1, 1) });
    }
  }
  fire(x, y, z) {
    this.add.emit({ x: x + rand(-0.3, 0.3), y, z: z + rand(-0.3, 0.3), vx: rand(-0.4, 0.4), vy: rand(2, 4), vz: rand(-0.4, 0.4), drag: 1, max: rand(0.4, 0.8), s0: 1.4, s1: 0.4, r: 4, g: 1.6, b: 0.3, a: 0.9, r1: [2, 0.3, 0.05] });
  }
  dust(x, y, z, n = 2, col = [0.75, 0.7, 0.62]) {
    for (let i = 0; i < n; i++) this.smk.emit({ x, y, z, vx: rand(-1, 1), vy: rand(0.3, 1.2), vz: rand(-1, 1), drag: 1.5, max: rand(0.8, 1.4), s0: 0.6, s1: 2.4, r: col[0], g: col[1], b: col[2], a: 0.35 });
  }
  tireSmoke(x, y, z) { this.smk.emit({ x, y, z, vx: rand(-0.8, 0.8), vy: rand(0.5, 1.4), vz: rand(-0.8, 0.8), drag: 1.2, max: rand(1, 1.8), s0: 0.7, s1: 3.2, r: 0.85, g: 0.85, b: 0.88, a: 0.4, vr: rand(-1, 1) }); }
  blood(x, y, z, dx = 0, dz = 0) {
    for (let i = 0; i < 8; i++) this.smk.emit({ x, y, z, vx: dx * 2 + rand(-1.5, 1.5), vy: rand(0, 3), vz: dz * 2 + rand(-1.5, 1.5), grav: 12, drag: 0.5, max: rand(0.3, 0.6), s0: 0.25, s1: 0.1, r: 0.45, g: 0.02, b: 0.02, a: 0.9, fade: 1 });
  }
  impact(x, y, z, nx = 0, ny = 1, nz = 0) {
    for (let i = 0; i < 5; i++) this.add.emit({ x, y, z, vx: nx * 3 + rand(-2, 2), vy: ny * 3 + rand(0, 2), vz: nz * 3 + rand(-2, 2), grav: 15, drag: 1, max: rand(0.1, 0.3), s0: 0.12, s1: 0.03, r: 3, g: 2.4, b: 1.2, a: 1 });
    this.smk.emit({ x, y, z, vx: nx, vy: 0.5, vz: nz, drag: 2, max: 0.6, s0: 0.3, s1: 1.2, r: 0.6, g: 0.58, b: 0.55, a: 0.5 });
  }
  muzzle(x, y, z, dx, dy, dz, big = false) {
    this.add.emit({ x: x + dx * 0.1, y: y + dy * 0.1, z: z + dz * 0.1, vx: dx * 2, vy: dy * 2, vz: dz * 2, max: 0.06, s0: big ? 1.0 : 0.6, s1: 0.2, r: 4, g: 2.6, b: 1, a: 1, fade: 0 });
    this.flash(x, y, z, 0xffbb66, big ? 30 : 15, 0.06, 12);
  }
  tracer(x0, y0, z0, x1, y1, z1) {
    const i = this.trCursor; this.trCursor = (this.trCursor + 1) % this.maxTr;
    this.trPos.set([x0, y0, z0, x1, y1, z1], i * 6);
    this.trLife[i] = 0.06;
  }
  explosion(x, y, z, scale = 1) {
    for (let i = 0; i < 50 * scale; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * 1.2, sp = rand(4, 16) * scale;
      this.add.emit({ x, y, z, vx: Math.cos(a) * Math.cos(e) * sp, vy: Math.sin(e) * sp + 2, vz: Math.sin(a) * Math.cos(e) * sp, drag: 2.2, grav: 2, max: rand(0.5, 1.1), s0: rand(2.5, 4.5) * scale, s1: 0.8, r: 5, g: 2.2, b: 0.5, a: 1, r1: [1.5, 0.2, 0.02] });
    }
    for (let i = 0; i < 30 * scale; i++) {
      this.smk.emit({ x: x + rand(-1, 1), y: y + rand(0, 1.5), z: z + rand(-1, 1), vx: rand(-4, 4), vy: rand(2, 8), vz: rand(-4, 4), drag: 1.4, max: rand(2.5, 4.5), s0: 2.5 * scale, s1: 8 * scale, r: 0.12, g: 0.11, b: 0.1, a: 0.7, vr: rand(-1, 1) });
    }
    this.sparks(x, y, z, 40);
    this.flash(x, y + 2, z, 0xff8833, 600 * scale, 0.5, 50);
    this.ring(x, y, z, 10 * scale);
    const p = G.camera.position;
    const d = Math.hypot(p.x - x, p.y - y, p.z - z);
    this.shake = Math.max(this.shake, Math.max(0, 1.2 - d / 60));
    G.audio && G.audio.explosion(x, z);
    G.events.emit('explosion', x, y, z, 8 * scale);
  }
  ring(x, y, z, r) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.8, 0.8), transparent: true, opacity: 0.8, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, y + 0.2, z);
    this.scene.add(m);
    this.rings.push({ m, life: 0.5, r });
  }
  splash(x, y, z) {
    for (let i = 0; i < 40; i++) this.add.emit({ x, y, z, vx: rand(-4, 4), vy: rand(4, 10), vz: rand(-4, 4), grav: 18, max: rand(0.6, 1.2), s0: 0.5, s1: 0.2, r: 0.9, g: 1.1, b: 1.3, a: 0.8 });
    this.smk.emit({ x, y, z, vx: 0, vy: 1, vz: 0, max: 1.5, s0: 3, s1: 8, r: 0.9, g: 0.95, b: 1, a: 0.6 });
  }
  nitroFlame(x, y, z, dx, dz) {
    this.add.emit({ x, y, z, vx: -dx * 8 + rand(-0.5, 0.5), vy: rand(-0.2, 0.4), vz: -dz * 8 + rand(-0.5, 0.5), drag: 3, max: 0.18, s0: 0.7, s1: 0.2, r: 0.6, g: 1.4, b: 4.5, a: 1, r1: [3, 0.6, 2] });
  }
  pickupSparkle(x, y, z, col) {
    this.add.emit({ x: x + rand(-0.4, 0.4), y: y + rand(-0.3, 0.3), z: z + rand(-0.4, 0.4), vx: 0, vy: 1, vz: 0, max: 0.6, s0: 0.25, s1: 0.0, r: col[0], g: col[1], b: col[2], a: 1 });
  }

  skidMark(x0, z0, x1, z1, y = 0.03, w = 0.28) {
    const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz);
    if (L < 0.05 || L > 3) return;
    this._q.setFromAxisAngle(this._v.set(0, 1, 0), Math.atan2(dx, dz));
    this._m.compose(this._v.set((x0 + x1) / 2, y + 0.03, (z0 + z1) / 2), this._q, this._s.set(w, 1, L));
    this.skid.setMatrixAt(this.skidCursor, this._m);
    this.skidCursor = (this.skidCursor + 1) % this.maxSkid;
    this.skid.count = Math.max(this.skid.count, this.skidCursor === 0 ? this.maxSkid : this.skidCursor);
    this.skid.instanceMatrix.needsUpdate = true;
  }

  update(dt) {
    this.add.update(dt); this.smk.update(dt);
    for (let i = 0; i < this.maxTr; i++) {
      if (this.trLife[i] > 0) { this.trLife[i] -= dt; if (this.trLife[i] <= 0) this.trPos.fill(0, i * 6, i * 6 + 6); }
    }
    this.tracers.geometry.attributes.position.needsUpdate = true;
    for (const L of this.lights) {
      if (L.life > 0) { L.life -= dt; L.l.intensity = Math.max(0, L.I * (L.life / L.max)); } else L.l.intensity = 0;
    }
    for (let k = this.rings.length - 1; k >= 0; k--) {
      const r = this.rings[k];
      r.life -= dt;
      const t = 1 - r.life / 0.5;
      r.m.scale.setScalar(1 + t * r.r);
      r.m.material.opacity = 0.8 * (1 - t);
      if (r.life <= 0) { r.m.removeFromParent(); r.m.geometry.dispose(); r.m.material.dispose(); this.rings.splice(k, 1); }
    }
    this.shake = Math.max(0, this.shake - dt * 2.5);
  }
}
