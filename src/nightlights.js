import * as THREE from 'three';
import { texture } from './assets.js';
import { lampPositions } from './city.js';

const _v = new THREE.Vector3();

/**
 * Night lighting: a fixed pool of point lights that hops between the street lamps nearest the camera,
 * glow cards on every vehicle's original head/tail-light dummies, and a real headlight for the player's car.
 */
export class NightLights {
  constructor(scene, count) {
    this.scene = scene;
    this.pool = [];
    for (let i = 0; i < count; i++) {
      const l = new THREE.PointLight(0xffc98a, 0, 22, 1.6);
      scene.add(l);
      this.pool.push(l);
    }
    const tex = texture('add-glow.webp', { repeat: false });
    this.head = new THREE.SpriteMaterial({ map: tex, color: 0xfff4dd, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    this.tail = new THREE.SpriteMaterial({ map: tex, color: 0xff2a1a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    this.spot = new THREE.SpotLight(0xfff2dc, 0, 55, 0.55, 0.45, 1.3);
    this.spot.castShadow = false;
    scene.add(this.spot, this.spot.target);
    this.timer = 0;
  }

  dispose() {
    for (const l of this.pool) this.scene.remove(l);
    this.scene.remove(this.spot, this.spot.target);
  }

  rig(v) {
    if (v.lightRig !== undefined || !v.nodes) return;
    v.lightRig = [];
    const add = (name, mat, size) => {
      const n = v.nodes[name];
      if (!n) return;
      const s = new THREE.Sprite(mat);
      s.scale.setScalar(size);
      s.renderOrder = 11;
      n.add(s);
      v.lightRig.push(s);
    };
    add('dummy_headlight_01', this.head, 140); add('dummy_headlight_02', this.head, 140);
    add('dummy_light_01', this.tail, 70); add('dummy_light_02', this.tail, 70);
  }

  update(dt, night, camera, game) {
    const on = night > 0.35;
    this.head.opacity = Math.min(1, night * 1.3) * 0.9;
    this.tail.opacity = Math.min(1, night * 1.3) * 0.8;
    if (game) {
      for (const v of game.vehicles()) {
        this.rig(v);
        if (v.lightRig) for (const s of v.lightRig) s.visible = on && v.health > 0;
      }
      const pv = game.player && game.player.vehicle;
      if (pv && on && pv.health > 0) {
        const f = _v.set(Math.sin(pv.yaw), 0, Math.cos(pv.yaw));
        this.spot.position.set(pv.pos.x + f.x * (pv.length * 0.5), pv.pos.y + 0.9, pv.pos.z + f.z * (pv.length * 0.5));
        this.spot.target.position.set(pv.pos.x + f.x * 20, pv.pos.y - 0.5, pv.pos.z + f.z * 20);
        this.spot.target.updateMatrixWorld();
        this.spot.intensity = 260 * night;
      } else this.spot.intensity = 0;
    }
    // re-pick the nearest lamps a few times per second
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.4;
    if (!on || !this.pool.length) { for (const l of this.pool) l.intensity = 0; return; }
    const c = camera.position;
    const near = lampPositions
      .map((p) => [p, (p[0] - c.x) ** 2 + (p[2] - c.z) ** 2])
      .filter(([, d]) => d < 120 * 120)
      .sort((a, b) => a[1] - b[1])
      .slice(0, this.pool.length);
    this.pool.forEach((l, i) => {
      const p = near[i];
      if (!p) { l.intensity = 0; return; }
      l.position.set(p[0][0], p[0][1] - 0.4, p[0][2]);
      l.intensity = 38 * night;
    });
  }
}
