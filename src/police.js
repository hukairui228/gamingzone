// Wanted level, police response, helicopter, busted/evade logic.
import * as THREE from 'three';
import { G } from './state.js';
import { Driver } from './traffic.js';
import { nodes, nearestNode, HALF, LANE_OFF, groundHeight } from './layout.js';
import { rand, pick, chance, clamp, damp, dampAngle } from './util.js';
import { copOutfit } from './character.js';
import { stdMat } from './materials.js';

const THRESH = [0, 1, 4, 10, 20, 34];
const CARS_FOR = [0, 1, 3, 4, 6, 7];

export class Police {
  constructor() {
    this.heat = 0; this.level = 0;
    this.lastSeen = -99; this.searching = false;
    this.cars = [];
    this.spawnT = 0;
    this.bustT = 0;
    this.heli = null;
    this.copsOnFoot = [];
    G.events.on('actorKilled', (p, attacker) => {
      if (attacker !== G.player) return;
      if (p.mission && p.mission.noWanted) return;
      if (p.team === 'cop') this.crime(3, 2, p.x, p.z, true);
      else if (p.team === 'civ') this.crime(1.3, 1, p.x, p.z);
      else if (p.team === 'gang') this.crime(0.4, 0, p.x, p.z);
    });
    G.events.on('actorHurt', (p, attacker) => {
      if (attacker !== G.player || (p.mission && p.mission.noWanted)) return;
      if (p.team === 'cop') this.crime(0.8, 1, p.x, p.z, true);
      else if (p.team === 'civ') this.crime(0.3, 0, p.x, p.z);
    });
    G.events.on('gunshot', (x, z, shooter, melee) => { if (shooter === G.player && !melee) this.crime(0.25, 0, x, z, false, true); });
    G.events.on('carjack', (v) => { this.crime(v.isPolice ? 2 : 0.6, v.isPolice ? 1 : 0, v.x, v.z); });
    G.events.on('vehicleExploded', (v) => { if (v.lastAttacker === 'player' || v.lastAttacker === G.player) this.crime(v.isPolice ? 3 : 1, v.isPolice ? 2 : 0, v.x, v.z, v.isPolice); });
    G.events.on('vehicleDamaged', (v, amt, cause, attacker) => { if ((attacker === 'player' || attacker === G.player) && v.isPolice && v.driver && amt > 20) this.crime(0.4, 1, v.x, v.z, true); });
  }

  // witnessed by cops? (or civ for bigger crimes)
  witnessed(x, z, radius = 55) {
    for (const v of G.vehicles.list) {
      if (!v.isPolice || !v.driver || v.dead) continue;
      if (Math.hypot(v.x - x, v.z - z) < radius && G.world.statics.lineOfSight(v.x, v.y + 1.4, v.z, x, 1.2, z)) return true;
    }
    for (const p of G.pedSys.list) {
      if (p.team !== 'cop' || p.char.dead) continue;
      if (Math.hypot(p.x - x, p.z - z) < radius && G.world.statics.lineOfSight(p.x, 1.6, p.z, x, 1.2, z)) return true;
    }
    return false;
  }

  crime(points, minLevel, x, z, direct = false, noisy = false) {
    if (G.missions && G.missions.noPolice) return;
    const seen = direct || this.level > 0 || this.witnessed(x, z, noisy ? 40 : 55);
    // civilians call it in for violent crimes even without cops nearby
    if (!seen && points < 1) return;
    this.heat = Math.min(THRESH[5] + 6, this.heat + points);
    let lvl = 0;
    for (let k = 5; k >= 0; k--) if (this.heat >= THRESH[k]) { lvl = k; break; }
    lvl = Math.max(lvl, minLevel, points >= 1 ? 1 : 0);
    if (lvl > this.level) this.setLevel(lvl);
    this.lastSeen = G.time;
  }

  setLevel(l) {
    l = clamp(l, 0, 5);
    if (l > this.level) { G.audio && G.audio.ui('wanted'); this.heat = Math.max(this.heat, THRESH[l]); }
    this.level = l;
    if (l > G.save.stats.maxWanted) G.save.stats.maxWanted = l;
    if (l === 0) { this.heat = 0; this.searching = false; this.clearPursuit(); }
    this.lastSeen = G.time;
    G.hud && G.hud.stars(l, false);
  }

  clearPursuit() {
    for (const v of this.cars) { if (v.ai) { v.ai.mode = 'cruise'; v.ai.lastEdge = null; v.ai.queue.length = 0; } v.siren = false; v.traffic = true; }
    this.cars = [];
    for (const p of this.copsOnFoot) { if (!p.char.dead) { p.state = 'walk'; p.ring = null; } }
    this.copsOnFoot = [];
    if (this.heli) this.heli.leaving = true;
  }

  bust() {
    if (this.level === 0 || G.player.dead || this.bustedNow) return;
    this.bustedNow = true;
    G.events.emit('busted');
  }

  spawnCar() {
    const pl = G.player;
    // find node ~ 140m away
    for (let tries = 0; tries < 8; tries++) {
      const a = Math.random() * Math.PI * 2, r = rand(110, 170);
      const n = nearestNode(pl.x + Math.cos(a) * r, pl.z + Math.sin(a) * r);
      if (n.island && !(pl.x > n.x - 400)) continue;
      const d = Math.hypot(n.x - pl.x, n.z - pl.z);
      if (d < 80) continue;
      const m = pick(n.links);
      const A = nodes[n.id], B = nodes[m];
      let dx = B.x - A.x, dz = B.z - A.z; const L = Math.hypot(dx, dz); dx /= L; dz /= L;
      const x = A.x + dx * (HALF + 8) - dz * LANE_OFF[0], z = A.z + dz * (HALF + 8) + dx * LANE_OFF[0];
      let blocked = false;
      for (const v of G.vehicles.list) if (Math.abs(v.x - x) < 7 && Math.abs(v.z - z) < 7) blocked = true;
      if (blocked) continue;
      const type = this.level >= 5 && chance(0.3) ? 'armored' : 'police';
      const v = G.vehicles.spawn(type, x, z, Math.atan2(dx, dz), type === 'armored' ? 0x222830 : undefined, { powerMul: 1 + this.level * 0.04 });
      v.isPolice = true; v.siren = true;
      v.driver = { team: 'cop', outfit: copOutfit(), weapon: this.level >= 4 ? 'smg' : 'pistol' };
      v.passengers = this.level >= 2 ? 1 : 0;
      v.ai = new Driver(v, { mode: 'pursue', aggressive: this.level >= 3 });
      v.ai.target = G.player;
      v.copCar = true;
      this.cars.push(v);
      return v;
    }
    return null;
  }

  canSee() {
    const pl = G.player;
    const py = pl.y + 1.2;
    for (const v of this.cars) {
      if (v.dead || !v.driver) continue;
      const d = Math.hypot(v.x - pl.x, v.z - pl.z);
      if (d < 75 && G.world.statics.lineOfSight(v.x, v.y + 1.4, v.z, pl.x, py, pl.z)) return true;
      if (d < 18) return true;
    }
    for (const p of G.pedSys.list) {
      if (p.team !== 'cop' || p.char.dead) continue;
      const d = Math.hypot(p.x - pl.x, p.z - pl.z);
      if (d < 50 && G.world.statics.lineOfSight(p.x, 1.6, p.z, pl.x, py, pl.z)) return true;
    }
    if (this.heli && !this.heli.dead && !this.heli.leaving) {
      const d = Math.hypot(this.heli.x - pl.x, this.heli.z - pl.z);
      if (d < 110 && G.world.statics.lineOfSight(this.heli.x, this.heli.y, this.heli.z, pl.x, py, pl.z)) return true;
    }
    return false;
  }

  update(dt) {
    const pl = G.player;
    this.cars = this.cars.filter((v) => !v.removed);
    this.copsOnFoot = this.copsOnFoot.filter((p) => !p.removed);
    if (this.level > 0 && !pl.dead) {
      // visibility
      this.seeT = (this.seeT || 0) - dt;
      if (this.seeT <= 0) {
        this.seeT = 0.4;
        if (this.canSee()) this.lastSeen = G.time;
      }
      const evade = 7 + this.level * 2.5;
      const since = G.time - this.lastSeen;
      this.searching = since > 2.5;
      G.hud && G.hud.stars(this.level, this.searching);
      if (since > evade) {
        G.hud && G.hud.notify('你甩掉了警察！');
        G.audio && G.audio.ui('evade');
        this.setLevel(0);
        G.events.emit('wantedCleared');
        return;
      }
      // spawn cars
      this.spawnT -= dt;
      const alive = this.cars.filter((v) => !v.dead && v.driver).length;
      if (this.spawnT <= 0 && alive < CARS_FOR[this.level]) { this.spawnT = 2.5; this.spawnCar(); }
      // cop car behaviour
      for (const v of this.cars) {
        if (v.dead || !v.driver || v.driver === 'player') continue;
        v.siren = true;
        if (v.ai) { v.ai.target = pl; v.ai.mode = 'pursue'; v.ai.aggressive = this.level >= 3; }
        const d = Math.hypot(v.x - pl.x, v.z - pl.z);
        // exit and chase on foot
        if (!pl.inVehicle && d < 26 && v.speed < 5) this.deployCops(v);
      }
      // bust while in a stopped car boxed in by cops
      if (pl.inVehicle) {
        const pv = pl.inVehicle;
        let near = false;
        for (const v of this.cars) if (!v.dead && Math.hypot(v.x - pv.x, v.z - pv.z) < 7.5) near = true;
        for (const p of this.copsOnFoot) if (!p.char.dead && Math.hypot(p.x - pv.x, p.z - pv.z) < 3.5) near = true;
        if (near && pv.speed < 1.2 && this.level <= 3) { this.bustT += dt; if (this.bustT > 3) this.bust(); }
        else this.bustT = Math.max(0, this.bustT - dt);
      }
      // helicopter
      if (this.level >= 4 && !this.heli) this.heli = new Helicopter();
    }
    if (this.heli) {
      this.heli.update(dt);
      if (this.heli.gone) { this.heli.dispose(); this.heli = null; }
    }
    // cleanup pursuit cars when calm
    if (this.level === 0) {
      for (const v of G.vehicles.list) { if (v.copCar && !v.dead) v.siren = false; }
    }
  }

  deployCops(v) {
    if (v.deployed) return;
    v.deployed = true;
    const n = 1 + (v.passengers || 0);
    for (let k = 0; k < n; k++) {
      const d = v.doorPos(k === 0 ? 1 : -1);
      const p = G.pedSys.spawn('cop', d.x, d.z, v.h, v.driver && v.driver.outfit);
      if (this.level >= 2) { p.setWeapon(this.level >= 4 ? 'smg' : 'pistol'); p.state = 'attack'; }
      else { p.state = 'arrest'; p.setWeapon('pistol'); p.char.aim = false; }
      this.copsOnFoot.push(p);
    }
    v.driver = null; v.ai = null;
    v.input.throttle = 0; v.input.handbrake = true;
    v.siren = true;
  }
}

// ---------------- helicopter ----------------
class Helicopter {
  constructor() {
    const pl = G.player;
    this.mesh = new THREE.Group();
    const bodyMat = stdMat(0x1d2b53, 0.4, 0.4), whiteMat = stdMat(0xf4f4f4, 0.4, 0.2);
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.2, 2.4, 6, 12), bodyMat); body.rotation.x = Math.PI / 2; body.scale.set(1, 1, 0.9);
    const stripe = new THREE.Mesh(new THREE.CapsuleGeometry(1.22, 1.2, 6, 12), whiteMat); stripe.rotation.x = Math.PI / 2; stripe.position.z = -0.3;
    const glass = new THREE.Mesh(new THREE.SphereGeometry(1.05, 12, 10, 0, Math.PI * 2, 0, Math.PI / 2), stdMat(0x10202a, 0.05, 0.6));
    glass.rotation.x = Math.PI / 2; glass.position.set(0, 0.1, 1.6);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.4, 5), bodyMat); tail.position.set(0, 0.3, -3.8);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.4, 0.8), bodyMat); fin.position.set(0, 0.9, -6.1);
    const skidG = new THREE.BoxGeometry(0.1, 0.1, 3.4);
    const s1 = new THREE.Mesh(skidG, whiteMat); s1.position.set(0.9, -1.4, 0);
    const s2 = new THREE.Mesh(skidG, whiteMat); s2.position.set(-0.9, -1.4, 0);
    this.rotor = new THREE.Mesh(new THREE.BoxGeometry(11, 0.06, 0.35), stdMat(0x222222, 0.6));
    this.rotor2 = this.rotor.clone(); this.rotor2.rotation.y = Math.PI / 2;
    const hub = new THREE.Group(); hub.add(this.rotor, this.rotor2); hub.position.y = 1.4; this.hub = hub;
    this.tailRotor = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.6, 0.18), stdMat(0x222222, 0.6)); this.tailRotor.position.set(0.25, 0.9, -6.1);
    this.mesh.add(body, stripe, glass, tail, fin, s1, s2, hub, this.tailRotor);
    this.mesh.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    // searchlight
    this.light = new THREE.SpotLight(0xe8f0ff, 0, 140, 0.18, 0.4, 1);
    this.light.position.set(0, -1, 1.5);
    this.mesh.add(this.light); G.scene.add(this.light.target);
    const coneG = new THREE.ConeGeometry(5, 40, 24, 1, true); coneG.translate(0, -20, 0);
    this.cone = new THREE.Mesh(coneG, new THREE.MeshBasicMaterial({ color: 0xcfe0ff, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.mesh.add(this.cone);
    const a = Math.random() * Math.PI * 2;
    this.x = pl.x + Math.cos(a) * 250; this.z = pl.z + Math.sin(a) * 250; this.y = 60;
    this.h = 0; this.orbit = a; this.hp = 1600; this.dead = false; this.vy = 0;
    this.shootCd = 3;
    G.scene.add(this.mesh);
    this.obb = { x: this.x, z: this.z, hw: 1.3, hd: 3, a: 0 };
    // register as damageable "vehicle"-like for bullets
    this.fake = { x: 0, z: 0, y: 0, H: 2.4, obb: this.obb, dead: false, damage: (amt) => this.damage(amt), maxHp: 1600, speed: 0, vx: 0, vz: 0, t: { L: 6 }, isHeli: true };
    G.vehicles.list.push(this.fake);
    this.fake.update = () => {}; this.fake.syncMesh = () => {}; this.fake.mass = 1e9; this.fake.dispose = () => {};
    this.fake.yawRate = 0; this.fake.noEnter = true; this.fake.sinking = 0;
  }
  damage(amt) {
    if (this.dead) return;
    this.hp -= amt;
    if (this.hp <= 0) { this.dead = true; this.vy = 0; G.hud && G.hud.notify('警用直升机被击落！'); G.events.emit('heliDown'); }
  }
  update(dt) {
    const pl = G.player;
    this.hub.rotation.y += dt * 25; this.tailRotor.rotation.x += dt * 40;
    if (this.dead) {
      this.vy -= 12 * dt; this.y += this.vy * dt; this.h += dt * 4;
      G.fx && G.fx.smoke(this.x, this.y, this.z, 0.15, 1); G.fx && G.fx.fire(this.x, this.y, this.z);
      if (this.y <= Math.max(0, groundHeight(this.x, this.z)) + 1) { G.fx.explosion(this.x, this.y, this.z, 1.6); this.gone = true; }
    } else if (this.leaving) {
      this.y += dt * 8; this.x += Math.cos(this.orbit) * dt * 30; this.z += Math.sin(this.orbit) * dt * 30;
      if (this.y > 140) this.gone = true;
    } else {
      this.orbit += dt * 0.25;
      const r = 38;
      const tx = pl.x + Math.cos(this.orbit) * r, tz = pl.z + Math.sin(this.orbit) * r;
      this.x = damp(this.x, tx, 0.6, dt); this.z = damp(this.z, tz, 0.6, dt);
      this.y = damp(this.y, 34 + Math.sin(G.time * 0.5) * 3, 0.8, dt);
      this.h = dampAngle(this.h, Math.atan2(pl.x - this.x, pl.z - this.z), 2, dt);
      // shooting
      this.shootCd -= dt;
      const d = Math.hypot(pl.x - this.x, pl.z - this.z);
      if (this.shootCd <= 0 && d < 90) {
        this.burst = 6; this.shootCd = rand(3, 5);
      }
      if (this.burst > 0) {
        this.burstT = (this.burstT || 0) - dt;
        if (this.burstT <= 0) {
          this.burstT = 0.12; this.burst--;
          const ox = this.x, oy = this.y - 1.4, oz = this.z;
          const ty = pl.y + 1;
          let dx = pl.x - ox + rand(-2.5, 2.5), dy = ty - oy, dz = pl.z - oz + rand(-2.5, 2.5);
          const L = Math.hypot(dx, dy, dz); dx /= L; dy /= L; dz /= L;
          G.combat.fire({ dmgMul: 0.5, spreadMul: 1, inVehicle: this.fake }, 'rifle', ox, oy, oz, dx, dy, dz);
        }
      }
    }
    this.mesh.position.set(this.x, this.y, this.z);
    this.mesh.rotation.set(this.dead ? 0.3 : 0.12, this.h, 0);
    const night = G.sky ? G.sky.night : 0;
    this.light.intensity = night * 2500;
    this.cone.visible = night > 0.3 && !this.dead;
    this.cone.lookAt(pl.x, pl.y, pl.z); this.cone.rotateX(-Math.PI / 2);
    this.light.target.position.set(pl.x, pl.y, pl.z);
    this.fake.x = this.x; this.fake.z = this.z; this.fake.y = this.y - 1.2;
    this.obb.x = this.x; this.obb.z = this.z; this.obb.a = this.h;
    this.fake.dead = this.dead;
    G.audio && G.audio.heli(this.x, this.y, this.z);
  }
  dispose() {
    this.mesh.removeFromParent(); this.light.target.removeFromParent();
    const i = G.vehicles.list.indexOf(this.fake); if (i >= 0) G.vehicles.list.splice(i, 1);
    G.audio && G.audio.heli(null);
  }
}
