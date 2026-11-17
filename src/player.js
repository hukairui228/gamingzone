// The player: on-foot controller, driving, camera rigs, combat, drift/stunt scoring, focus time.
import * as THREE from 'three';
import { G } from './state.js';
import { Character, OUTFITS } from './character.js';
import { WEAPONS, WEAPON_ORDER } from './weapons.js';
import { clamp, lerp, damp, dampAngle, angleDiff, circleOBB } from './util.js';
import { groundHeight, isLand, WATER_Y, CITY, P, nearestLanePoint } from './layout.js';

const tmpV = new THREE.Vector3();

export class Player {
  constructor(scene) {
    this.char = new Character(OUTFITS.player);
    scene.add(this.char.mesh);
    this.team = 'player';
    this.inVehicle = null;
    this.camYaw = 0; this.camPitch = -0.12; this.camDist = 4;
    this.carCamYawOff = 0; this.carCamPitch = 0.22; this.lastMouse = 0;
    this.camMode = 0;
    this.camPos = new THREE.Vector3();
    this.vy = 0; this.grounded = true;
    this.weapon = 'fist';
    this.fireCd = 0; this.reload = 0;
    this.mag = {};
    this.focus = 1; this.focusOn = false;
    this.drift = { score: 0, mult: 1, t: 0, idle: 0, active: false };
    this.enterT = 0;
    this.lastShot = 0;
    this.headlight = new THREE.SpotLight(0xfff2dd, 0, 60, 0.55, 0.5, 1.4);
    this.headlight.castShadow = false;
    scene.add(this.headlight, this.headlight.target);
    this.invuln = 0;
    this.spreadMul = 1; this.dmgMul = 1;
    this.prevWheels = null;
    this.stunt = null;
    this.zoneTimer = 0;
    this.swimming = false;
    this.swimStamina = 1;
    this.waterY = 0;
  }

  get x() { return this.inVehicle ? this.inVehicle.x : this.char.x; }
  get z() { return this.inVehicle ? this.inVehicle.z : this.char.z; }
  get y() { return this.inVehicle ? this.inVehicle.y : this.char.y; }
  get hp() { return this.char.hp; }
  get dead() { return this.char.dead; }

  load(save) {
    this.char.hp = 100; this.char.armor = save.armor || 0;
    for (const w of WEAPON_ORDER) if (save.weapons[w]) this.mag[w] = Math.min(WEAPONS[w].mag || 0, save.ammo[w] || 0);
    this.selectWeapon('fist');
    this.swimming = false;
    this.swimStamina = 1;
  }

  place(x, z, h = 0) {
    this.char.place(x, z, h);
    this.char.y = Math.max(0, groundHeight(x, z));
    this.camYaw = h;
    this.char.sync();
    this.swimming = false;
    this.swimStamina = 1;
  }

  // ---------------- weapons ----------------
  hasWeapon(id) { return !!G.save.weapons[id] && (id === 'fist' || (G.save.ammo[id] || 0) > 0); }
  selectWeapon(id) {
    if (!this.hasWeapon(id)) return;
    this.weapon = id;
    this.char.setWeapon(id === 'fist' ? 'fist' : id);
    this.reload = 0;
    if (id !== 'fist' && this.mag[id] == null) this.mag[id] = Math.min(WEAPONS[id].mag, G.save.ammo[id] || 0);
    G.hud && G.hud.weapon();
  }
  cycleWeapon(dir = 1) {
    let i = WEAPON_ORDER.indexOf(this.weapon);
    for (let k = 0; k < WEAPON_ORDER.length; k++) {
      i = (i + dir + WEAPON_ORDER.length) % WEAPON_ORDER.length;
      if (this.hasWeapon(WEAPON_ORDER[i])) { this.selectWeapon(WEAPON_ORDER[i]); G.audio && G.audio.ui('switch'); return; }
    }
  }
  giveWeapon(id, ammo) {
    const first = !G.save.weapons[id];
    G.save.weapons[id] = 1;
    if (id !== 'fist') G.save.ammo[id] = (G.save.ammo[id] || 0) + ammo;
    if (this.mag[id] == null || this.mag[id] === 0) this.mag[id] = Math.min(WEAPONS[id].mag || 0, G.save.ammo[id]);
    if (first || this.weapon === 'fist') this.selectWeapon(id);
    G.hud && G.hud.weapon();
  }

  // ---------------- damage ----------------
  hurt(dmg, attacker, dx = 0, dz = 0, part = 'body', melee = false, force = 0) {
    if (this.char.dead || this.invuln > 0) return;
    if (G.cheatGod) return;
    if (this.inVehicle) { this.inVehicle.damage(dmg * 0.5, 'bullet', attacker); dmg *= 0.25; }
    let d = dmg;
    if (this.char.armor > 0) { const a = Math.min(this.char.armor, d * 0.7); this.char.armor -= a; d -= a; }
    this.char.hp -= d;
    this.char.hitFlash = 1;
    G.hud && G.hud.damage(Math.min(1, dmg / 40));
    G.audio && G.audio.hurt(true);
    if (this.char.hp <= 0) {
      this.char.hp = 0;
      if (this.inVehicle) this.exitVehicle(true);
      this.char.die(dx, dz, force);
      this.char.groundY = this.char.y;
      G.events.emit('playerDied', attacker);
    }
  }

  // ---------------- vehicles ----------------
  tryEnter() {
    const v = G.vehicles.nearest(this.char.x, this.char.z, 4.2, (v) => !v.dead && v.sinking <= 0 && !v.noEnter);
    if (!v) return false;
    if (v.driver && v.driver !== 'player') {
      // carjack
      const ped = v.driver;
      G.pedSys && G.pedSys.ejectDriver(v, ped);
      G.events.emit('carjack', v);
      G.save.stats.carsStolen++;
    }
    this.enterVehicle(v);
    return true;
  }
  enterVehicle(v) {
    this.inVehicle = v;
    v.driver = 'player';
    v.ai = null;
    v.input.throttle = 0; v.input.steer = 0;
    this.char.mesh.visible = false;
    this.carCamYawOff = angleDiff(v.h, this.camYaw);
    this.char.aim = false;
    G.audio && G.audio.door();
    G.events.emit('enterVehicle', v);
    G.hud && G.hud.vehicle(v);
  }
  exitVehicle(force = false) {
    const v = this.inVehicle;
    if (!v) return;
    const spd = v.speed;
    const d = v.doorPos(1);
    let px = d.x, pz = d.z;
    // if door blocked, use other side
    const tmp = {};
    if (G.world.statics.collideCircle(px, pz, 0.4, v.y, tmp)) { const d2 = v.doorPos(-1); px = d2.x; pz = d2.z; }
    v.driver = null;
    v.input.throttle = 0; v.input.steer = 0; v.input.handbrake = spd < 9; v.input.nitro = false;
    this.inVehicle = null;
    this.char.mesh.visible = true;
    this.char.x = px; this.char.z = pz; this.char.y = Math.max(groundHeight(px, pz), v.y);
    this.char.h = v.h;
    // If exiting into water, start swimming
    const exitGh = groundHeight(px, pz);
    if (exitGh < -5) {
      this.char.y = WATER_Y - 0.3;
      this.camYaw = v.h + this.carCamYawOff;
      this.headlight.intensity = 0;
      G.audio && G.audio.door();
      G.events.emit('exitVehicle', v);
      G.hud && G.hud.vehicle(null);
      this.enterWater();
      return;
    }
    this.camYaw = v.h + this.carCamYawOff;
    this.headlight.intensity = 0;
    G.audio && G.audio.door();
    if (spd > 9 && !force) {
      this.hurt(spd * 1.2, null);
      this.char.vx = v.vx * 0.5; this.char.vz = v.vz * 0.5;
    }
    G.events.emit('exitVehicle', v);
    G.hud && G.hud.vehicle(null);
  }

  // ---------------- update ----------------
  update(dt, rdt, input) {
    const fireLike = input.held('fire');
    this.invuln = Math.max(0, this.invuln - dt);
    // focus (bullet time)
    if (input.pressed('focus') && !this.char.dead) {
      if (this.focusOn) this.focusOn = false;
      else if (this.focus > 0.15) { this.focusOn = true; G.audio && G.audio.focus(true); }
    }
    if (this.focusOn) {
      this.focus -= rdt * 0.16;
      if (this.focus <= 0) { this.focus = 0; this.focusOn = false; G.audio && G.audio.focus(false); }
    } else this.focus = Math.min(1, this.focus + rdt * 0.012);

    // camera look
    const sens = 0.0022 * G.settings.sensitivity;
    const inv = G.settings.invertY ? -1 : 1;
    if (this.char.dead) { this.updateDeadCam(rdt); return; }

    if (this.swimming) {
      if (input.pressed('enter')) {
        const v = G.vehicles.nearest(this.char.x, this.char.z, 5, (v) => !v.dead && v.t.boat);
        if (v) { this.swimming = false; this.enterVehicle(v); }
      }
      this.updateSwimming(dt, rdt, input);
      this.updateCameraFov(rdt);
      return;
    }

    if (input.wheel) this.cycleWeapon(input.wheel);
    if (input.pressed('weapon')) this.cycleWeapon(1);
    for (let k = 1; k <= 7; k++) if (input.pressed('w' + k)) this.selectWeapon(WEAPON_ORDER[k - 1]);
    if (input.pressed('grenade') && this.hasWeapon('grenade')) this.selectWeapon('grenade');

    if (this.inVehicle) {
      if (input.look.x || input.look.y) { this.carCamYawOff -= input.look.x * sens; this.carCamPitch = clamp(this.carCamPitch + input.look.y * sens * inv, -0.2, 1.1); this.lastMouse = G.time; }
      this.updateDriving(dt, rdt, input);
    } else {
      this.camYaw -= input.look.x * sens;
      this.camPitch = clamp(this.camPitch - input.look.y * sens * inv, -1.2, 0.9);
      this.updateOnFoot(dt, rdt, input);
    }
    if (input.pressed('enter')) {
      if (this.inVehicle) this.exitVehicle();
      else this.tryEnter();
    }
    // shooting
    this.fireCd -= dt;
    if (this.reload > 0) {
      this.reload -= dt;
      if (this.reload <= 0) {
        const w = WEAPONS[this.weapon];
        this.mag[this.weapon] = Math.min(w.mag, G.save.ammo[this.weapon] || 0);
        G.hud && G.hud.weapon();
      }
    }
    const canShoot = !this.inVehicle || (['pistol', 'smg'].includes(this.weapon));
    const w = WEAPONS[this.weapon];
    if (fireLike && canShoot && this.fireCd <= 0 && this.reload <= 0) {
      if (w.auto || input.pressed('fire') || (this.gpFireHeld(input))) this.shoot();
    }
    this.char.aim = !this.inVehicle && (input.held('aim') || G.time - this.lastShot < 0.6) && !WEAPONS[this.weapon].melee;
    this.updateCameraFov(rdt);
  }
  gpFireHeld(input) { return input.gpActive && input.held('fire') && this.fireCd < -0.15; }

  aimRay() {
    const cam = G.camera;
    cam.getWorldDirection(tmpV);
    return { ox: cam.position.x, oy: cam.position.y, oz: cam.position.z, dx: tmpV.x, dy: tmpV.y, dz: tmpV.z };
  }

  autoAim(range = 45, cone = 0.45) {
    // nearest hostile/any character within cone of camera forward
    const r = this.aimRay();
    let best = null, bs = cone;
    const px = this.x, pz = this.z;
    for (const a of G.combat.actors()) {
      if (a === this || !a.char || a.char.dead || a.inVehicle) continue;
      const dx = a.char.x - px, dz = a.char.z - pz, d = Math.hypot(dx, dz);
      if (d > range || d < 0.5) continue;
      const fl = Math.hypot(r.dx, r.dz) || 1;
      const dot = (dx * r.dx + dz * r.dz) / (d * fl);
      const ang = Math.acos(clamp(dot, -1, 1));
      const pri = ang - (a.hostile ? 0.2 : 0) + d * 0.002;
      if (ang < cone && pri < bs) { bs = pri; best = a; }
    }
    return best;
  }

  shoot() {
    const w = WEAPONS[this.weapon];
    if (w.melee) {
      this.fireCd = w.rate;
      this.char.punchT = 0.35;
      this.char.h = this.camYaw;
      G.combat.melee(this, this.char.x, this.char.z, this.char.h, this.weapon);
      return;
    }
    if ((this.mag[this.weapon] || 0) <= 0) {
      if ((G.save.ammo[this.weapon] || 0) > 0) { this.reload = 1.1; G.audio && G.audio.ui('reload'); }
      else { G.audio && G.audio.ui('empty'); this.fireCd = 0.3; if (this.weapon !== 'fist') this.cycleWeapon(-1); }
      return;
    }
    this.fireCd = w.rate;
    this.mag[this.weapon]--;
    G.save.ammo[this.weapon]--;
    this.lastShot = G.time;
    // origin: muzzle approx (right hand) ; aim at crosshair target
    let ox, oy, oz;
    if (this.inVehicle) { const v = this.inVehicle; ox = v.x; oy = v.y + 1.3; oz = v.z; }
    else {
      const c = this.char, h = this.camYaw;
      ox = c.x - Math.cos(h) * 0.25 + Math.sin(h) * 0.5; oy = c.y + 1.45; oz = c.z + Math.sin(h) * 0.25 + Math.cos(h) * 0.5;
    }
    let tx, ty, tz;
    const useAuto = G.input.touchMode || G.input.gpActive;
    const target = useAuto ? this.autoAim() : null;
    if (target) {
      tx = target.char.x; ty = target.char.y + 1.2; tz = target.char.z;
      if (!this.inVehicle) this.camYaw = dampAngle(this.camYaw, Math.atan2(tx - this.x, tz - this.z), 20, 0.05);
    } else {
      const r = this.aimRay();
      const start = this.inVehicle ? 6 : this.camDist + 0.5;
      const hit = G.combat.raycast(r.ox + r.dx * start, r.oy + r.dy * start, r.oz + r.dz * start, r.dx, r.dy, r.dz, w.range || 150, this);
      tx = r.ox + r.dx * (start + hit.t); ty = r.oy + r.dy * (start + hit.t); tz = r.oz + r.dz * (start + hit.t);
    }
    let dx = tx - ox, dy = ty - oy, dz = tz - oz;
    const L = Math.hypot(dx, dy, dz) || 1; dx /= L; dy /= L; dz /= L;
    this.spreadMul = (this.char.aim ? 0.6 : 1.2) * (this.focusOn ? 0.4 : 1) * (this.inVehicle ? 1.6 : 1);
    if (!this.inVehicle) this.char.h = this.camYaw;
    const wm = this.char.weapon;
    let muzzle = { x: ox + dx * 0.4, y: oy + dy * 0.4, z: oz + dz * 0.4 };
    if (wm && !this.inVehicle) { wm.getWorldPosition(tmpV); muzzle = { x: tmpV.x + dx * 0.45, y: tmpV.y + dy * 0.45, z: tmpV.z + dz * 0.45 }; }
    const res = G.combat.fire(this, this.weapon, ox, oy, oz, dx, dy, dz, muzzle);
    if (res && (res.actor || res.vehicle)) G.hud && G.hud.hit();
    this.char.recoil = 1;
    const kick = { pistol: 0.012, smg: 0.006, shotgun: 0.04, rifle: 0.01, rocket: 0.05, grenade: 0 }[this.weapon] || 0;
    this.recoilPitch = (this.recoilPitch || 0) + kick; G.fx.shake = Math.max(G.fx.shake, kick * 6);
    if (this.mag[this.weapon] <= 0 && (G.save.ammo[this.weapon] || 0) > 0) { this.reload = this.weapon === 'grenade' || this.weapon === 'rocket' ? 0.8 : 1.2; }
    G.hud && G.hud.weapon();
  }

  updateOnFoot(dt, rdt, input) {
    const c = this.char;
    const mv = input.move;
    const sprint = input.held('sprint') && !c.aim;
    const speed = c.aim ? 3.0 : sprint ? 7.2 : 4.4;
    const fx = Math.sin(this.camYaw), fz = Math.cos(this.camYaw);
    const rx = -fz, rz = fx;
    let wx = fx * mv.y + rx * mv.x, wz = fz * mv.y + rz * mv.x;
    const ml = Math.hypot(wx, wz);
    if (ml > 1) { wx /= ml; wz /= ml; }
    const tvx = wx * speed, tvz = wz * speed;
    const accel = this.grounded ? 12 : 2;
    c.vx = damp(c.vx || 0, tvx, accel, dt);
    c.vz = damp(c.vz || 0, tvz, accel, dt);
    c.x += c.vx * dt; c.z += c.vz * dt;
    const footSpeed = Math.hypot(c.vx, c.vz);
    if (footSpeed > 0.5) G.save.stats.distanceFoot = (G.save.stats.distanceFoot || 0) + footSpeed * dt;
    // facing
    if (c.aim || (G.time - this.lastShot < 0.6)) c.h = dampAngle(c.h, this.camYaw, 18, dt);
    else if (ml > 0.1) c.h = dampAngle(c.h, Math.atan2(wx, wz), 10, dt);
    // collisions with statics
    const push = G.world.statics.collideCircle(c.x, c.z, 0.38, c.y, this._push || (this._push = {}));
    if (push) { c.x += push.x; c.z += push.z; }
    // vehicles
    for (const v of G.vehicles.list) {
      const dx = v.x - c.x, dz = v.z - c.z;
      if (dx * dx + dz * dz > 30) continue;
      if (c.y > v.y + v.H - 0.2) continue;
      const col = circleOBB(c.x, c.z, 0.38, v.obb);
      if (col) {
        const vs = v.speed;
        if (vs > 7 && this.invuln <= 0) {
          // run over!
          this.hurt(vs * 2.8, v.driver === 'player' ? null : v, v.vx / vs, v.vz / vs, 'body', false, vs * 0.6);
          this.invuln = 0.6;
          c.vx = v.vx * 0.7; c.vz = v.vz * 0.7; this.vy = 4; this.grounded = false;
        }
        c.x += col.nx * col.depth; c.z += col.nz * col.depth;
        // stand on car roof
      }
    }
    // vertical
    const gh = groundHeight(c.x, c.z);
    if (input.pressed('jump') && this.grounded) { this.vy = 5.6; this.grounded = false; G.audio && G.audio.ui('jump'); }
    if (!this.grounded) {
      this.vy -= 18 * dt; c.y += this.vy * dt;
      if (c.y <= gh) { c.y = gh; this.grounded = true; this.vy = 0; }
    } else {
      if (gh > c.y - 0.6 && gh < c.y + 0.5) c.y = damp(c.y, gh, 25, dt);
      else if (gh < c.y - 0.6) this.grounded = false;
    }
    // stand on car roof
    // water - enter swimming
    if (gh < -10 && c.y < WATER_Y + 0.2) {
      this.enterWater();
      return;
    }
    c.animate(dt, Math.hypot(c.vx, c.vz), { air: !this.grounded });
    c.aimPitch = this.camPitch + 0.12;
    c.sync();
    // prompts
    this.promptT = (this.promptT || 0) - rdt;
    if (this.promptT <= 0) {
      this.promptT = 0.2;
      const v = G.vehicles.nearest(c.x, c.z, 4.2, (v) => !v.dead && !v.noEnter);
      this.nearCar = v;
    }
    this.updateFootCam(dt, rdt);
  }

  rescueFromWater() {
    const c = this.char;
    let x = c.x, z = c.z;
    const cx = (CITY.x0 + CITY.x1) / 2, cz = (CITY.z0 + CITY.z1) / 2;
    for (let k = 0; k < 400 && !isLand(x, z); k++) { const dx = cx - x, dz = cz - z, L = Math.hypot(dx, dz); x += dx / L * 4; z += dz / L * 4; }
    x += (cx - x) * 0.01; z += (cz - z) * 0.01;
    c.x = x; c.z = z; c.y = Math.max(0, groundHeight(x, z)); c.vx = c.vz = 0;
    this.swimming = false;
    this.grounded = true;
    this.swimStamina = 1;
    this.hurt(15, null);
    G.hud && G.hud.notify('你精疲力竭，被冲回了岸边…');
  }

  enterWater() {
    if (this.swimming) return;
    this.swimming = true;
    this.waterY = WATER_Y;
    this.grounded = false;
    this.vy = 0;
    this.char.vx *= 0.3;
    this.char.vz *= 0.3;
    G.hud && G.hud.notify('按住方向键游泳');
    G.audio && G.audio.splash && G.audio.splash();
  }

  updateSwimming(dt, rdt, input) {
    const c = this.char;
    const mv = input.move;
    const sprint = input.held('sprint');
    const swimSpeed = sprint ? 4.5 : 2.8;
    const fx = Math.sin(this.camYaw), fz = Math.cos(this.camYaw);
    const rx = -fz, rz = fx;
    let wx = fx * mv.y + rx * mv.x, wz = fz * mv.y + rz * mv.x;
    const ml = Math.hypot(wx, wz);
    if (ml > 1) { wx /= ml; wz /= ml; }
    c.vx = damp(c.vx || 0, wx * swimSpeed, 4, dt);
    c.vz = damp(c.vz || 0, wz * swimSpeed, 4, dt);
    c.x += c.vx * dt;
    c.z += c.vz * dt;
    const bobY = this.waterY + Math.sin(G.time * 2 + c.x * 0.5) * 0.08 - 0.4;
    c.y = damp(c.y, bobY, 6, dt);
    if (sprint && ml > 0.1) this.swimStamina -= dt * 0.12;
    else if (ml > 0.1) this.swimStamina -= dt * 0.03;
    else this.swimStamina -= dt * 0.015;
    this.swimStamina = clamp(this.swimStamina, 0, 1);
    if (this.swimStamina <= 0) {
      c.y -= dt * 0.5;
      if (c.y < this.waterY - 2) { this.rescueFromWater(); return; }
    }
    const gh = groundHeight(c.x, c.z);
    if (gh > -2 && isLand(c.x, c.z)) {
      c.y = Math.max(0, gh);
      this.swimming = false;
      this.grounded = true;
      this.vy = 0;
      G.hud && G.hud.notify('');
      return;
    }
    if (ml > 0.1) c.h = dampAngle(c.h, Math.atan2(wx, wz), 6, dt);
    c.animate(dt, Math.hypot(c.vx, c.vz) * 0.5, { air: false });
    c.sync();
    const push = G.world.statics.collideCircle(c.x, c.z, 0.38, c.y, this._push || (this._push = {}));
    if (push) { c.x += push.x; c.z += push.z; }
    this.updateFootCam(dt, rdt);
  }

  updateFootCam(dt, rdt) {
    const c = this.char;
    const aiming = c.aim;
    const tDist = aiming ? 1.9 : [3.8, 5.2, 2.6][this.camMode] || 3.8;
    this.camDist = damp(this.camDist, tDist, 10, rdt);
    const shoulder = aiming ? 0.62 : 0.45;
    const fx = Math.sin(this.camYaw), fz = Math.cos(this.camYaw);
    const rx = -fz, rz = fx;
    this.recoilPitch = (this.recoilPitch || 0) * Math.exp(-rdt * 7);
    const pitch = clamp(this.camPitch + this.recoilPitch, -1.2, 0.95);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const dirx = fx * cp, diry = sp, dirz = fz * cp;
    const pivot = tmpV.set(c.x + rx * shoulder, c.y + 1.62, c.z + rz * shoulder);
    let dist = this.camDist;
    const hit = G.world.statics.raycast(pivot.x, pivot.y, pivot.z, -dirx, -diry, -dirz, dist + 0.3);
    if (hit) dist = Math.max(0.4, hit.t - 0.3);
    const cam = G.camera;
    const tx = pivot.x - dirx * dist, ty = Math.max(pivot.y - diry * dist, groundHeight(pivot.x - dirx * dist, pivot.z - dirz * dist) + 0.3), tz = pivot.z - dirz * dist;
    cam.position.set(tx, ty, tz);
    cam.lookAt(pivot.x + dirx * 10, pivot.y + diry * 10, pivot.z + dirz * 10);
    this.applyShake(rdt);
  }

  updateDeadCam(rdt) {
    const c = this.char;
    const cam = G.camera;
    this.camYaw += rdt * 0.25;
    const d = 7;
    cam.position.set(c.x - Math.sin(this.camYaw) * d, c.y + 4.5, c.z - Math.cos(this.camYaw) * d);
    cam.lookAt(c.x, c.y + 0.5, c.z);
    c.animate(rdt, 0);
  }

  applyShake(rdt) {
    const s = G.fx ? G.fx.shake : 0;
    if (s > 0) {
      const cam = G.camera;
      cam.position.x += (Math.random() - 0.5) * s * 0.4;
      cam.position.y += (Math.random() - 0.5) * s * 0.4;
      cam.rotation.z += (Math.random() - 0.5) * s * 0.02;
    }
  }

  updateCameraFov(rdt) {
    let fov = G.settings.fov;
    const v = this.inVehicle;
    if (v) fov += clamp(v.speed / v.t.top, 0, 1.2) * 12 + (v.nitroOn ? 8 : 0);
    if (this.char.aim) fov -= 15;
    const isSniper = this.char.aim && WEAPONS[this.weapon] && WEAPONS[this.weapon].scope;
    if (isSniper) fov -= 25;
    if (G.hud && G.hud.scopeOverlay) G.hud.scopeOverlay(isSniper);
    const cam = G.camera;
    const nf = damp(cam.fov, fov, 5, rdt);
    if (Math.abs(nf - cam.fov) > 0.01) { cam.fov = nf; cam.updateProjectionMatrix(); }
  }

  updateDriving(dt, rdt, input) {
    const v = this.inVehicle;
    const mv = input.move;
    let throttle = mv.y;
    if (input.throttleAxis !== null && input.throttleAxis !== undefined) throttle = input.throttleAxis;
    v.input.throttle = throttle;
    v.input.steer = mv.x;
    v.input.handbrake = input.held('jump');
    v.input.nitro = input.held('sprint');
    if (input.pressed('horn')) { G.audio && G.audio.horn(); G.events.emit('horn', v); }
    if (input.pressed('radio')) G.audio && G.audio.nextStation();
    if (input.pressed('cam')) this.camMode = (this.camMode + 1) % 3;
    // nitro FX
    if (v.nitroOn) {
      const fx = Math.sin(v.h), fz = Math.cos(v.h);
      for (const s of [-0.4, 0.4]) G.fx.nitroFlame(v.x - fx * v.t.L * 0.5 - Math.cos(v.h) * s, v.y + 0.35, v.z - fz * v.t.L * 0.5 + Math.sin(v.h) * s, fx, fz);
    }
    // keep char with car (hidden) for systems that read position
    this.char.x = v.x; this.char.z = v.z; this.char.y = v.y;
    // skid marks + tire smoke
    this.tireEffects(v, dt);
    this.updateDrift(v, dt, rdt);
    this.updateStunt(v, dt, rdt);
    // headlight
    const night = G.sky ? G.sky.night : 0;
    const hl = this.headlight;
    hl.intensity = v.dead ? 0 : night * 110 + (G.sky && G.sky.rain > 0.3 ? 30 : 0);
    const fx = Math.sin(v.h), fz = Math.cos(v.h);
    hl.position.set(v.x + fx * v.t.L * 0.5, v.y + 0.8, v.z + fz * v.t.L * 0.5);
    hl.target.position.set(v.x + fx * 25, v.y - 1, v.z + fz * 25);
    hl.target.updateMatrixWorld();
    this.updateCarCam(v, dt, rdt, input);
    if (v.dead && v.burning <= 0 && v.hp <= 0 && !this.char.dead) {
      // exploded with us inside
      if (v.sinking > 0) { this.exitVehicle(true); this.rescueFromWater(); }
      else { this.exitVehicle(true); this.hurt(999, v.lastAttacker || null); }
    }
    if (v.sinking > 1.2 && this.inVehicle) { this.exitVehicle(true); this.rescueFromWater(); }
    G.save.stats.distance += v.speed * dt;
    if (v.t.boat) G.save.stats.distanceWater = (G.save.stats.distanceWater || 0) + v.speed * dt;
    else G.save.stats.distanceCar = (G.save.stats.distanceCar || 0) + v.speed * dt;
    if (!G.save.stats.vehiclesDriven) G.save.stats.vehiclesDriven = {};
    G.save.stats.vehiclesDriven[v.typeKey] = true;
  }

  tireEffects(v, dt) {
    const fx = Math.sin(v.h), fz = Math.cos(v.h), rx = -Math.cos(v.h), rz = Math.sin(v.h);
    const wheels = [];
    const hw = v.t.Wd / 2 - 0.15, rz0 = (v.t.wb - 0.5) * v.t.L;
    for (const s of [-1, 1]) wheels.push({ x: v.x + rx * s * hw + fx * rz0, z: v.z + rz * s * hw + fz * rz0 });
    const slipping = v.grounded && (v.drifting || (v.input.handbrake && v.speed > 5) || (Math.abs(v.input.throttle) > 0.8 && Math.abs(v.vF) < 6 && v.input.throttle * v.vF >= 0));
    if (slipping && this.prevWheels) {
      for (let k = 0; k < 2; k++) G.fx.skidMark(this.prevWheels[k].x, this.prevWheels[k].z, wheels[k].x, wheels[k].z, v.y);
      if (Math.random() < 0.6) G.fx.tireSmoke(wheels[Math.random() < 0.5 ? 0 : 1].x, v.y + 0.2, wheels[0].z * 0.5 + wheels[1].z * 0.5);
    }
    this.prevWheels = wheels;
    this.slip = slipping ? Math.min(1, Math.abs(v.vR) / 8 + 0.3) : 0;
  }

  updateDrift(v, dt, rdt) {
    const D = this.drift;
    if (v.drifting && v.grounded && v.speed > 9) {
      D.active = true; D.idle = 0;
      D.t += dt;
      D.score += dt * v.speed * Math.abs(v.vR) * 0.9 * D.mult;
      if (D.t > 2.2 * D.mult && D.mult < 8) { D.mult++; G.audio && G.audio.ui('combo'); }
    } else if (D.active) {
      D.idle += dt;
      if (D.idle > 1.0) this.bankDrift();
    }
  }
  bankDrift(failed = false) {
    const D = this.drift;
    if (!D.active) return;
    const pts = Math.floor(D.score);
    if (!failed && pts > 150) {
      const cash = Math.floor(pts / 25);
      G.addMoney(cash);
      this.inVehicle && (this.inVehicle.nitro = Math.min(this.inVehicle.nitroMax || 0, (this.inVehicle.nitro || 0) + pts / 6000));
      this.focus = Math.min(1, this.focus + pts / 8000);
      if (pts > G.save.stats.bestDrift) G.save.stats.bestDrift = pts;
      G.hud && G.hud.driftBank(pts, cash);
      G.events.emit('driftBanked', pts);
    } else if (failed && pts > 150) G.hud && G.hud.driftFail();
    D.active = false; D.score = 0; D.mult = 1; D.t = 0; D.idle = 0;
  }

  updateStunt(v, dt, rdt) {
    if (!v.grounded && !this.stunt && v.airTime > 0.05 && v.y > 0.6) {
      // launched
      const ramp = G.world.rampList.find((r) => Math.hypot(r.x - v.x, r.z - v.z) < 14);
      this.stunt = { t: 0, ramp, maxY: v.y, startX: v.x, startZ: v.z };
      if (ramp && v.speed > 15) G.timeScaleTarget = 0.35;
    }
    if (this.stunt) {
      const s = this.stunt;
      s.t += dt; s.maxY = Math.max(s.maxY, v.y);
      if (v.grounded) {
        G.timeScaleTarget = 1;
        const dist = Math.hypot(v.x - s.startX, v.z - s.startZ);
        if (s.t > 0.8 && !v.dead) {
          const cash = Math.floor(dist * 4 + s.maxY * 20 + s.t * 50);
          G.addMoney(cash);
          let title = '特技飞跃';
          if (s.ramp && !G.save.stunts.includes(s.ramp.id) && s.t > 1.0) {
            G.save.stunts.push(s.ramp.id);
            title = '独特特技：' + s.ramp.name;
            G.addMoney(1000);
          }
          G.hud && G.hud.stunt(title, dist, s.maxY, s.t, cash);
          this.focus = Math.min(1, this.focus + 0.1);
        }
        this.stunt = null;
      }
    }
  }

  updateCarCam(v, dt, rdt, input) {
    const cam = G.camera;
    const back = input.held('lookback');
    if (G.time - this.lastMouse > 1.6) {
      this.carCamYawOff = damp(this.carCamYawOff, 0, 2.5, rdt);
      this.carCamPitch = damp(this.carCamPitch, 0.2, 2, rdt);
    }
    // follow direction of velocity for drift feel
    let baseYaw = v.h;
    if (v.speed > 4 && v.vF > 0) baseYaw = dampAngle(v.h, Math.atan2(v.vx, v.vz), 1, 0.35);
    this.carYawSmooth = this.carYawSmooth == null ? baseYaw : dampAngle(this.carYawSmooth, baseYaw, 5, rdt);
    const yaw = this.carYawSmooth + this.carCamYawOff + (back ? Math.PI : 0);
    const dists = [1.65, 2.3, 1.15];
    const dist = v.t.L * dists[this.camMode] + 1.5 + clamp(v.speed / 50, 0, 1) * 1.5;
    const h = v.H * 0.75 + 1.0 + this.carCamPitch * dist * 0.6;
    const tx = v.x - Math.sin(yaw) * dist, tz = v.z - Math.cos(yaw) * dist;
    let ty = v.y + h;
    // collide
    const pv = tmpV.set(v.x, v.y + 1.6, v.z);
    const dx = tx - pv.x, dy = ty - pv.y, dz = tz - pv.z, L = Math.hypot(dx, dy, dz);
    const hit = G.world.statics.raycast(pv.x, pv.y, pv.z, dx / L, dy / L, dz / L, L);
    let fxp = tx, fyp = ty, fzp = tz;
    if (hit && !hit.ground) { const t = Math.max(1, hit.t - 0.4); fxp = pv.x + dx / L * t; fyp = pv.y + dy / L * t; fzp = pv.z + dz / L * t; }
    const k = 1 - Math.exp(-rdt * 12);
    if (!this.carCamInit) { cam.position.set(fxp, fyp, fzp); this.carCamInit = true; }
    cam.position.x += (fxp - cam.position.x) * k;
    cam.position.y += (Math.max(fyp, v.y + 0.8) - cam.position.y) * k;
    cam.position.z += (fzp - cam.position.z) * k;
    cam.lookAt(v.x + Math.sin(yaw) * 3, v.y + 1.1, v.z + Math.cos(yaw) * 3);
    this.camYaw = yaw;
    this.applyShake(rdt);
  }
}
