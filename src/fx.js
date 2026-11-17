import * as THREE from 'three';
import { texture } from './assets.js';

// Pooled sprite particles using the original effect textures.
export class Fx {
  constructor(scene) {
    this.scene = scene;
    this.parts = [];
    const mk = (tex, blending = THREE.AdditiveBlending, color = 0xffffff) => new THREE.SpriteMaterial({
      map: texture(tex, { repeat: false }), blending, depthWrite: false, transparent: true, color, fog: true,
    });
    this.mats = {
      spark: mk('sparks.webp'),
      fire: mk('fire.webp'),
      smoke: mk('smoke.webp', THREE.NormalBlending, 0x999999),
      blood: mk('blood.webp', THREE.NormalBlending, 0xaa1010),
      dust: mk('dust_00.webp', THREE.NormalBlending, 0xd8cfb8),
      splash: mk('splash.webp', THREE.NormalBlending, 0xffffff),
      money: mk('money.webp', THREE.NormalBlending),
    };
    this.flash = new THREE.PointLight(0xffc070, 0, 12, 2);
    scene.add(this.flash);
    this.flashT = 0;
    this.tracerGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    this.tracerMat = new THREE.LineBasicMaterial({ color: 0xffe6a0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending });
    this.tracers = [];
  }

  emit(kind, x, y, z, { n = 1, size = 1, life = 0.6, vel = 1, up = 0, grow = 1, opacity = 1, gravity = 0 } = {}) {
    for (let i = 0; i < n; i++) {
      let p = this.parts.find((q) => !q.alive && q.kind === kind);
      if (!p) {
        p = { s: new THREE.Sprite(this.mats[kind].clone()), kind, v: new THREE.Vector3() };
        this.scene.add(p.s);
        this.parts.push(p);
      }
      p.alive = true; p.t = 0; p.life = life * (0.7 + Math.random() * 0.6);
      p.size = size * (0.7 + Math.random() * 0.6); p.grow = grow; p.opacity = opacity; p.gravity = gravity;
      p.s.visible = true;
      p.s.position.set(x, y, z);
      p.s.material.rotation = Math.random() * 6.28;
      p.v.set((Math.random() - 0.5) * vel, (Math.random() - 0.3) * vel + up, (Math.random() - 0.5) * vel);
    }
  }

  muzzle(pos, dir) {
    this.emit('fire', pos.x + dir.x * 0.2, pos.y + dir.y * 0.2, pos.z + dir.z * 0.2, { size: 0.45, life: 0.06, vel: 0.2 });
    this.flash.position.copy(pos);
    this.flash.intensity = 30;
    this.flashT = 0.05;
  }

  tracer(a, b) {
    const l = new THREE.Line(this.tracerGeo.clone(), this.tracerMat.clone());
    const p = l.geometry.attributes.position.array;
    p[0] = a.x; p[1] = a.y; p[2] = a.z; p[3] = b.x; p[4] = b.y; p[5] = b.z;
    this.scene.add(l);
    this.tracers.push({ l, t: 0.06 });
  }

  impact(x, y, z) { this.emit('spark', x, y, z, { n: 4, size: 0.25, life: 0.25, vel: 4, up: 1, gravity: 9 }); this.emit('dust', x, y, z, { size: 0.5, life: 0.6, grow: 2.5, opacity: 0.6 }); }
  blood(x, y, z) { this.emit('blood', x, y, z, { n: 5, size: 0.35, life: 0.5, vel: 2, gravity: 8 }); }
  splash(x, y, z) { this.emit('splash', x, y, z, { n: 6, size: 1.2, life: 0.8, vel: 3, up: 3, gravity: 9 }); }

  explosion(x, y, z) {
    this.emit('fire', x, y + 1, z, { n: 14, size: 3.5, life: 0.9, vel: 7, up: 2, grow: 2 });
    this.emit('smoke', x, y + 2, z, { n: 12, size: 4, life: 3, vel: 3, up: 3, grow: 3, opacity: 0.8 });
    this.emit('spark', x, y + 1, z, { n: 16, size: 0.4, life: 0.8, vel: 16, up: 6, gravity: 12 });
    this.flash.position.set(x, y + 2, z); this.flash.intensity = 400; this.flash.distance = 60; this.flashT = 0.35;
  }

  smokeFrom(x, y, z, heavy) {
    this.emit(heavy ? 'fire' : 'smoke', x, y, z, { size: heavy ? 0.9 : 1.2, life: heavy ? 0.5 : 1.6, vel: 0.6, up: 2.5, grow: 2.5, opacity: 0.55 });
  }

  update(dt) {
    for (const p of this.parts) {
      if (!p.alive) continue;
      p.t += dt;
      if (p.t >= p.life) { p.alive = false; p.s.visible = false; continue; }
      const k = p.t / p.life;
      p.v.y -= p.gravity * dt;
      p.s.position.addScaledVector(p.v, dt);
      p.s.scale.setScalar(p.size * (1 + (p.grow - 1) * k));
      p.s.material.opacity = p.opacity * (1 - k);
    }
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.t -= dt;
      if (t.t <= 0) { this.scene.remove(t.l); t.l.geometry.dispose(); this.tracers.splice(i, 1); }
    }
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) { this.flash.intensity = 0; this.flash.distance = 12; } }
  }
}
