// Weapons and combat resolution (hitscan, projectiles, explosions).
import * as THREE from 'three';
import { G } from './state.js';
import { raySphere, rayOBB3, rand } from './util.js';
import { groundHeight } from './layout.js';
import { weaponMesh } from './character.js';

export const WEAPONS = {
  fist: { name: '拳头', dmg: 14, rate: 0.42, melee: true, range: 1.7, icon: '👊' },
  bat: { name: '球棒', dmg: 22, rate: 0.5, melee: true, range: 2.2, price: 200, icon: '🏏' },
  pistol: { name: '手枪', dmg: 28, rate: 0.2, spread: 0.01, mag: 12, range: 140, price: 400, ammoPrice: 60, ammoPack: 36, icon: '🔫' },
  smg: { name: '冲锋枪', dmg: 15, rate: 0.075, spread: 0.028, mag: 30, auto: true, range: 110, price: 1500, ammoPrice: 120, ammoPack: 90, icon: '🔫' },
  shotgun: { name: '霰弹枪', dmg: 13, pellets: 9, rate: 0.85, spread: 0.075, mag: 6, range: 45, price: 2200, ammoPrice: 100, ammoPack: 24, icon: '💥' },
  rifle: { name: '突击步枪', dmg: 30, rate: 0.1, spread: 0.012, mag: 30, auto: true, range: 200, price: 4500, ammoPrice: 200, ammoPack: 90, icon: '🎯' },
  rocket: { name: '火箭筒', dmg: 0, rate: 1.4, mag: 1, projectile: 'rocket', range: 300, price: 12000, ammoPrice: 800, ammoPack: 4, icon: '🚀' },
  grenade: { name: '手雷', dmg: 0, rate: 0.9, mag: 1, projectile: 'grenade', price: 1200, ammoPrice: 300, ammoPack: 5, icon: '💣' },
  molotov: { name: '燃烧瓶', dmg: 0, rate: 1.0, mag: 1, projectile: 'molotov', price: 600, ammoPrice: 150, ammoPack: 5, icon: '🔥' },
  sniper: { name: '狙击枪', dmg: 120, rate: 1.5, spread: 0.002, mag: 5, range: 500, price: 8000, ammoPrice: 400, ammoPack: 15, icon: '🎯', scope: true },
  flamethrower: { name: '喷火器', dmg: 8, rate: 0.04, spread: 0.08, mag: 100, auto: true, range: 16, price: 8000, ammoPrice: 500, ammoPack: 100, icon: '🔥' },
};
export const WEAPON_ORDER = ['fist', 'bat', 'pistol', 'smg', 'shotgun', 'rifle', 'sniper', 'rocket', 'grenade', 'molotov', 'flamethrower'];

const _d = new THREE.Vector3();

export class Combat {
  constructor(scene) {
    this.scene = scene;
    this.projectiles = [];
    this.fireZones = [];
    G.events.on('explosion', (x, y, z, r) => this.explosionDamage(x, y, z, r));
  }

  actors() {
    const a = G.pedSys ? G.pedSys.list : [];
    return G.player ? [G.player, ...a] : a;
  }

  // shooter: actor (player/ped). origin & dir: world vectors. returns hit info for first pellet
  fire(shooter, wid, ox, oy, oz, dx, dy, dz, muzzle) {
    const w = WEAPONS[wid];
    const isPlayer = shooter === G.player;
    G.audio && G.audio.gunshot(wid, ox, oz, isPlayer);
    G.events.emit('gunshot', ox, oz, shooter);
    if (wid === 'flamethrower') {
      const sp = w.spread * (shooter.spreadMul || 1);
      _d.set(dx + rand(-sp, sp), dy + rand(-sp, sp), dz + rand(-sp, sp)).normalize();
      for (const a of this.actors()) {
        if (a === shooter || !a.char || a.char.dead || a.inVehicle) continue;
        const ax = a.char.x - ox, az = a.char.z - oz, ad = Math.hypot(ax, az);
        if (ad < w.range && (ax * _d.x + az * _d.z) / (ad || 1) > 0.5) {
          a.hurt(w.dmg * (shooter.dmgMul || 1), shooter, _d.x, _d.z, 'body');
        }
      }
      for (const v of G.vehicles.list) {
        if (v.dead) continue;
        const vdx = v.x - ox, vdz = v.z - oz, vd = Math.hypot(vdx, vdz);
        if (vd < w.range && (vdx * _d.x + vdz * _d.z) / (vd || 1) > 0.3) {
          v.damage(w.dmg * 2, 'fire', isPlayer ? 'player' : shooter);
        }
      }
      const dist = w.range * (0.3 + Math.random() * 0.7);
      if (G.fx) {
        G.fx.fire(ox + _d.x * dist, oy + _d.y * dist - 0.3, oz + _d.z * dist);
        G.fx.fire(ox + _d.x * dist * 0.6, oy + _d.y * dist * 0.6, oz + _d.z * dist * 0.6);
      }
      return null;
    }
    if (w.projectile) { this.launch(shooter, w.projectile, muzzle || { x: ox, y: oy, z: oz }, dx, dy, dz); return null; }
    const pellets = w.pellets || 1;
    let first = null;
    const mz = muzzle || { x: ox, y: oy, z: oz };
    if (G.fx) G.fx.muzzle(mz.x, mz.y, mz.z, dx, dy, dz, wid === 'shotgun' || wid === 'rifle');
    for (let p = 0; p < pellets; p++) {
      const sp = (w.spread || 0) * (shooter.spreadMul || 1);
      _d.set(dx + rand(-sp, sp), dy + rand(-sp, sp), dz + rand(-sp, sp)).normalize();
      const hit = this.raycast(ox, oy, oz, _d.x, _d.y, _d.z, w.range, shooter);
      const ex = ox + _d.x * hit.t, ey = oy + _d.y * hit.t, ez = oz + _d.z * hit.t;
      if (G.fx && (p === 0 || Math.random() < 0.3)) G.fx.tracer(mz.x, mz.y, mz.z, ex, ey, ez);
      if (hit.actor) {
        const mul = hit.part === 'head' ? 2.5 : hit.part === 'legs' ? 0.7 : 1;
        hit.actor.hurt(w.dmg * mul * (shooter.dmgMul || 1), shooter, _d.x, _d.z, hit.part);
        G.fx && G.fx.blood(ex, ey, ez, _d.x, _d.z);
      } else if (hit.vehicle) {
        hit.vehicle.damage(w.dmg * 1.4, 'bullet', isPlayer ? 'player' : shooter);
        G.fx && G.fx.impact(ex, ey, ez, -_d.x, -_d.y, -_d.z);
        if (Math.random() < 0.3) G.audio && G.audio.ricochet(ex, ez);
      } else if (hit.t < w.range - 0.1) {
        G.fx && G.fx.impact(ex, ey, ez, -_d.x * 0.5, 0.5, -_d.z * 0.5);
      }
      if (!first) first = hit;
    }
    return first;
  }

  // find nearest hit along ray among statics, actors, vehicles
  raycast(ox, oy, oz, dx, dy, dz, maxT, ignore) {
    let best = { t: maxT };
    const s = G.world.statics.raycast(ox, oy, oz, dx, dy, dz, maxT);
    if (s) best = { t: s.t, static: s.item };
    for (const a of this.actors()) {
      if (a === ignore || a.inVehicle || !a.char) continue;
      const c = a.char;
      if ((c.x - ox) ** 2 + (c.z - oz) ** 2 > (best.t + 2) ** 2) continue;
      for (const sph of c.hitSpheres()) {
        const t = raySphere(ox, oy, oz, dx, dy, dz, sph.x, sph.y, sph.z, sph.r, best.t);
        if (t >= 0 && t < best.t) best = { t, actor: a, part: sph.part };
      }
    }
    const ignoreV = ignore && ignore.inVehicle;
    for (const v of G.vehicles.list) {
      if (v === ignoreV) continue;
      if ((v.x - ox) ** 2 + (v.z - oz) ** 2 > (best.t + 4) ** 2) continue;
      const t = rayOBB3(ox, oy, oz, dx, dy, dz, v.obb, v.y + 0.25, v.y + v.H, best.t);
      if (t >= 0 && t < best.t) best = { t, vehicle: v };
    }
    return best;
  }

  melee(attacker, x, z, h, wid = 'fist') {
    const fx = Math.sin(h), fz = Math.cos(h);
    let hitAny = false;
    const w = WEAPONS[wid] || WEAPONS.fist;
    const range = w.range || 1.8;
    const dmg = w.dmg || WEAPONS.fist.dmg;
    for (const a of this.actors()) {
      if (a === attacker || a.inVehicle || !a.char || a.char.dead) continue;
      const dx = a.char.x - x, dz = a.char.z - z;
      const d = Math.hypot(dx, dz);
      if (d < range && (dx * fx + dz * fz) / (d || 1) > 0.4) {
        a.hurt(dmg * (attacker.dmgMul || 1), attacker, fx, fz, 'body', true);
        hitAny = true;
      }
    }
    if (wid === 'bat') {
      for (const v of G.vehicles.list) {
        if (v.dead) continue;
        const dx = v.x - x, dz = v.z - z, d = Math.hypot(dx, dz);
        if (d < range + 1 && (dx * fx + dz * fz) / (d || 1) > 0.3) {
          v.damage(dmg * 2, 'melee', attacker === G.player ? 'player' : attacker);
          hitAny = true;
        }
      }
    }
    G.audio && G.audio.punch(hitAny);
    if (hitAny) G.events.emit('gunshot', x, z, attacker, true);
    return hitAny;
  }

  launch(shooter, kind, m, dx, dy, dz) {
    let mesh;
    if (kind === 'rocket') {
      mesh = weaponMesh('rocket'); mesh.scale.setScalar(0.5);
    } else if (kind === 'molotov') {
      mesh = weaponMesh('grenade'); mesh.scale.setScalar(1.2);
      mesh.material = new THREE.MeshStandardMaterial({ color: 0x884400, emissive: 0xff4400, emissiveIntensity: 0.5 });
    } else {
      mesh = weaponMesh('grenade'); mesh.scale.setScalar(1.6);
    }
    this.scene.add(mesh);
    const sp = kind === 'rocket' ? 55 : kind === 'molotov' ? 14 : 16;
    const p = {
      kind, mesh, shooter, x: m.x, y: m.y, z: m.z,
      vx: dx * sp, vy: dy * sp + (kind === 'grenade' || kind === 'molotov' ? 5 : 0), vz: dz * sp,
      life: kind === 'rocket' ? 5 : kind === 'molotov' ? 2.5 : 2.2,
    };
    this.projectiles.push(p);
  }

  update(dt) {
    for (let k = this.projectiles.length - 1; k >= 0; k--) {
      const p = this.projectiles[k];
      p.life -= dt;
      if (p.kind === 'grenade' || p.kind === 'molotov') p.vy -= 18 * dt;
      const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt, nz = p.z + p.vz * dt;
      const L = Math.hypot(nx - p.x, ny - p.y, nz - p.z) || 1e-6;
      const hit = this.raycast(p.x, p.y, p.z, (nx - p.x) / L, (ny - p.y) / L, (nz - p.z) / L, L, p.shooter);
      let boom = p.life <= 0 && p.kind === 'rocket';
      if (hit.t < L) {
        if (p.kind === 'rocket') { boom = true; p.x += (nx - p.x) * hit.t / L; p.y += (ny - p.y) * hit.t / L; p.z += (nz - p.z) * hit.t / L; }
        else {
          // bounce grenade
          if (hit.actor || hit.vehicle) { p.vx *= -0.3; p.vz *= -0.3; } else { p.vx *= -0.4; p.vz *= -0.4; }
        }
      } else { p.x = nx; p.y = ny; p.z = nz; }
      const gh = Math.max(groundHeight(p.x, p.z), -0.8);
      if (p.y < gh + 0.08) {
        if (p.kind === 'rocket') boom = true;
        else { p.y = gh + 0.08; p.vy = Math.abs(p.vy) * 0.35; p.vx *= 0.6; p.vz *= 0.6; }
      }
      if (p.kind === 'grenade' && p.life <= 0) boom = true;
      if (p.kind === 'molotov' && (p.life <= 0 || p.y < gh + 0.15)) {
        this.fireZones.push({ x: p.x, y: Math.max(gh, 0) + 0.1, z: p.z, life: 6, radius: 4, shooter: p.shooter });
        G.fx && G.fx.explosion(p.x, p.y, p.z, 0.4);
        p.mesh.removeFromParent();
        this.projectiles.splice(k, 1);
        continue;
      }
      p.mesh.position.set(p.x, p.y, p.z);
      p.mesh.lookAt(p.x + p.vx, p.y + p.vy, p.z + p.vz);
      if (p.kind === 'rocket' && G.fx) { G.fx.smoke(p.x, p.y, p.z, 0.8, 1, 0.4); G.fx.fire(p.x, p.y, p.z); }
      if (boom) {
        G.fx.explosion(p.x, p.y, p.z, p.kind === 'rocket' ? 1.1 : 0.9);
        this.lastExplosionBy = p.shooter;
        p.mesh.removeFromParent();
        this.projectiles.splice(k, 1);
      }
    }
    // Fire zones (Molotov)
    for (let k = this.fireZones.length - 1; k >= 0; k--) {
      const f = this.fireZones[k];
      f.life -= dt;
      if (f.life <= 0) { this.fireZones.splice(k, 1); continue; }
      if (G.fx && Math.random() < 0.4) {
        const ox = f.x + (Math.random() - 0.5) * f.radius, oz = f.z + (Math.random() - 0.5) * f.radius;
        G.fx.fire(ox, f.y + Math.random() * 0.5, oz);
        if (Math.random() < 0.15) G.fx.smoke(ox, f.y + 1, oz, 0.3, 1, 0.6);
      }
      for (const a of this.actors()) {
        if (!a.char || a.char.dead || a.inVehicle) continue;
        const dx = a.char.x - f.x, dz = a.char.z - f.z, d = Math.hypot(dx, dz);
        if (d < f.radius) a.hurt(18 * dt, f.shooter || 'fire', dx / (d || 1), dz / (d || 1), 'body');
      }
      for (const v of G.vehicles.list) {
        if (v.dead) continue;
        const dx = v.x - f.x, dz = v.z - f.z, d = Math.hypot(dx, dz);
        if (d < f.radius + 1) v.damage(25 * dt, 'fire', f.shooter === G.player ? 'player' : f.shooter);
      }
    }
  }

  explosionDamage(x, y, z, r) {
    const by = this.lastExplosionBy; this.lastExplosionBy = null;
    for (const a of this.actors()) {
      if (!a.char || a.char.dead || a.inVehicle) continue;
      const dx = a.char.x - x, dz = a.char.z - z, d = Math.hypot(dx, dz, a.char.y - y);
      if (d < r) {
        const f = 1 - d / r;
        a.hurt(170 * f, by || 'explosion', dx / (d || 1), dz / (d || 1), 'body', false, 12 * f + 4);
      }
    }
    for (const v of G.vehicles.list) {
      if (v.dead) continue;
      const dx = v.x - x, dz = v.z - z, d = Math.hypot(dx, dz);
      if (d < r * 1.2) {
        const f = 1 - d / (r * 1.2);
        v.damage(v.maxHp * 1.3 * f + 200 * f, 'explosion', by === G.player ? 'player' : by);
        v.vx += dx / (d || 1) * 10 * f; v.vz += dz / (d || 1) * 10 * f; v.vy += 6 * f; v.grounded = false;
        if (f > 0.55 && v.hp <= 0) v.burning = Math.min(v.burning || 1, 0.25 + Math.random() * 0.4);
      }
    }
  }
}
