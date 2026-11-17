import * as THREE from 'three';

const _t = new THREE.Vector3(), _p = new THREE.Vector3(), _d = new THREE.Vector3();

/** Third-person orbit camera on foot, chase camera in vehicles; avoids clipping into walls. */
export class GameCamera {
  constructor(cam, game) {
    this.cam = cam;
    this.g = game;
    this.yaw = 0; this.pitch = 0.18;
    this.dist = 4.6;
    this.shakeT = 0;
    this.carMode = 0;
    this.lastInput = 0;
    this.pos = new THREE.Vector3();
    this.target = new THREE.Vector3();
  }

  shake(a) { this.shakeT = Math.max(this.shakeT, a); }

  update(dt, ctl, player) {
    const sens = this.g.settings.sensitivity * 0.0025;
    if (ctl.lookX || ctl.lookY) this.lastInput = 0;
    this.lastInput += dt;
    this.yaw -= ctl.lookX * sens;
    this.pitch = THREE.MathUtils.clamp(this.pitch + ctl.lookY * sens, -0.7, 1.1);
    const v = player.vehicle;
    let dist, height, side = 0, fov = 62;
    if (v) {
      // chase: swing behind the car when the player is not steering the camera
      const behind = v.yaw + (v.vf < -2 ? Math.PI : 0);
      if (this.lastInput > 1.2) {
        let d = behind - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
        this.yaw += d * Math.min(1, dt * 2.5);
        this.pitch += (0.2 - this.pitch) * Math.min(1, dt * 2);
      }
      const big = Math.max(v.length, 4.5);
      dist = big * 1.12 + v.speed * 0.045;
      height = v.height * 0.75;
      fov = 62 + Math.min(10, v.speed * 0.2);
      _t.set(v.pos.x, v.pos.y + v.height * 0.7, v.pos.z);
    } else {
      const aiming = ctl.aim || (ctl.fire && !this.g.weaponDef().melee);
      const scope = aiming && this.g.weaponDef().scope;
      dist = aiming ? 2.4 : this.dist;
      side = aiming ? 0.55 : 0.3;
      height = 0.35;
      fov = scope ? 22 : aiming ? 52 : 62;
      _t.set(player.pos.x, player.pos.y + 1.55, player.pos.z);
    }
    this.cam.fov += (fov - this.cam.fov) * Math.min(1, dt * 6);
    this.cam.updateProjectionMatrix();
    this.target.lerp(_t, v ? Math.min(1, dt * 14) : 1);
    if (this.target.distanceTo(_t) > 10) this.target.copy(_t);
    // orbit offset
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    _d.set(-Math.sin(this.yaw) * cp, sp, -Math.cos(this.yaw) * cp);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    const pivot = _p.copy(this.target).add({ x: -rx * side, y: height, z: -rz * side });
    // wall collision
    const free = this.g.world.raycast(pivot.x, pivot.y, pivot.z, _d.x, _d.y, _d.z, dist + 0.3);
    const d = Math.max(0.6, Math.min(dist, free - 0.3));
    this.pos.copy(pivot).addScaledVector(_d, d);
    const gh = this.g.world.height(this.pos.x, this.pos.z, this.pos.y, 0);
    if (gh > -Infinity && this.pos.y < gh + 0.4) this.pos.y = gh + 0.4;
    if (this.pos.y < 0.5) this.pos.y = 0.5;
    this.cam.position.copy(this.pos);
    this.cam.lookAt(pivot.x - _d.x * 4, pivot.y - _d.y * 4 + (v ? 0 : -0.15), pivot.z - _d.z * 4);
    if (this.shakeT > 0) {
      this.shakeT = Math.max(0, this.shakeT - dt * 2);
      const s = this.shakeT * 0.05;
      this.cam.rotation.x += (Math.random() - 0.5) * s; this.cam.rotation.y += (Math.random() - 0.5) * s;
    }
  }
}
