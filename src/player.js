import * as THREE from 'three';
import { createCharacter } from './character.js';
import { buildModel } from './models.js';

// Original arsenal (models + sounds from the IPA).
export const WEAPONS = {
  fist: { name: '拳头', melee: true, dmg: 18, range: 1.7, rate: 0.45 },
  bat: { name: '棒球棍', melee: true, dmg: 40, range: 2.1, rate: 0.6, model: 'gun_baseball_bat', snd: 'sfx_baseballbat_woosh' },
  beretta: { name: '贝雷塔手枪', dmg: 26, rate: 0.28, clip: 12, ammo: 60, model: 'gun_beretta', snd: 'sfx_berreta', reload: 'sfx_berreta_reload', aim: 'handgun', spread: 0.012 },
  uzi: { name: '乌兹冲锋枪', dmg: 15, rate: 0.075, clip: 30, ammo: 150, model: 'gun_uzi', snd: 'sfx_uzi_shoot', reload: 'sfx_uzi_reload', aim: 'handgun', spread: 0.035, auto: true },
  ak47: { name: 'AK-47', dmg: 32, rate: 0.11, clip: 30, ammo: 120, model: 'gun_ak47', snd: 'sfx_ak47_shoot', reload: 'sfx_ak47_reload', aim: 'rifle', spread: 0.02, auto: true },
  sniper: { name: '狙击步枪', dmg: 150, rate: 1.1, clip: 5, ammo: 20, model: 'gun_sniper', snd: 'sfx_sniper_shoot', reload: 'sfx_sniper_reload', aim: 'rifle', spread: 0, scope: true },
  rpg: { name: '火箭筒', dmg: 300, rate: 1.5, clip: 1, ammo: 6, model: 'gun_rpg', snd: 'sfx_rpg_shoot', reload: 'sfx_rpg_reload', aim: 'rifle', explosive: true },
};
/** original seated animation for each vehicle family */
export function seatClip(v) {
  if (v.type === 'bike') return v.model.includes('harley') ? 'bo__player__bike_harley_idle' : v.model.includes('dirt') ? 'bo__player__bike_dirt_idle' : 'bo__player__bike_idle';
  if (v.type === 'boat') return 'fl__player__boat_seated_idle';
  return v.height > 1.9 ? 'fl__player__car_seated_idle_hi' : 'fl__player__car_seated_idle_low';
}

export const WEAPON_ORDER = ['fist', 'bat', 'beretta', 'uzi', 'ak47', 'sniper', 'rpg'];

const _v = new THREE.Vector3(), _d = new THREE.Vector3(), _o = new THREE.Vector3();
const _col = { hit: false, nx: 0, nz: 0, depth: 0 };

export class Player {
  constructor(game) {
    this.g = game;
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.vy = 0;
    this.grounded = true;
    this.health = 100; this.armor = 0;
    this.vehicle = null;
    this.weapons = { fist: { clip: 0, ammo: 0 } };
    this.weapon = 'fist';
    this.cool = 0;
    this.reloading = 0;
    this.action = 0; // locks movement during one-shot clips
    this.dead = false;
    this.gunModels = {};
  }

  async load() {
    this.c = await createCharacter('char_main_character');
    this.root = this.c.root;
    this.root.position.copy(this.pos);
    this.pos = this.root.position;
    this.g.scene.add(this.root);
    this.hand = this.c.getNode('r_h_weapon');
    this.c.play('sl__player__idle');
    for (const k of WEAPON_ORDER) {
      const w = WEAPONS[k];
      if (!w.model) continue;
      buildModel(w.model).then((m) => {
        const inner = m.children[0];
        m.remove(inner);
        inner.rotation.set(0, 0, 0); inner.scale.setScalar(1);
        inner.visible = false;
        this.hand.add(inner);
        this.gunModels[k] = inner;
        this.showWeapon();
      });
    }
    return this;
  }

  give(k, ammo) {
    const w = WEAPONS[k];
    const cur = this.weapons[k] || { clip: 0, ammo: 0 };
    cur.ammo += ammo ?? w.ammo ?? 0;
    if (!this.weapons[k]) { cur.clip = Math.min(w.clip || 0, cur.ammo); cur.ammo -= cur.clip; }
    this.weapons[k] = cur;
    this.weapon = k;
    this.showWeapon();
  }

  showWeapon() {
    for (const [k, m] of Object.entries(this.gunModels)) m.visible = k === this.weapon && !this.vehicle && !this.swimming;
  }

  nextWeapon() {
    const owned = WEAPON_ORDER.filter((k) => this.weapons[k]);
    this.weapon = owned[(owned.indexOf(this.weapon) + 1) % owned.length];
    this.showWeapon();
    this.c.overlay(null);
    this.g.audio.play('sfx_pickup_weapons', { vol: 0.3 });
  }

  hurt(dmg, from) {
    if (this.dead || this.g.cheatGod) return;
    if (this.armor > 0) { const a = Math.min(this.armor, dmg * 0.7); this.armor -= a; dmg -= a; }
    this.health -= dmg;
    this.g.hud.damageFlash(Math.min(1, dmg / 30), from);
    if (Math.random() < 0.3) this.g.audio.bark('vfx_johnny_hit', 3, { vol: 0.8 });
    if (this.health <= 0) this.g.die('wasted');
  }

  // ---------------------------------------------------------------- vehicles
  nearestCar() {
    let best = null, bd = 4.5;
    for (const v of this.g.vehicles()) {
      if (v.health <= 0) continue;
      const d = Math.hypot(v.pos.x - this.pos.x, v.pos.z - this.pos.z) - v.width * 0.4;
      if (d < bd && Math.abs(v.pos.y - this.pos.y) < 2.5) { bd = d; best = v; }
    }
    return best;
  }

  enter(v) {
    const g = this.g;
    if (v.ai) {
      const wasDriven = v.driver === 'npc' || v.driver === 'cop';
      g.traffic.detach(v);
      if (wasDriven) {
        g.ejectDriver(v);
        g.crime(v.driver === 'cop' ? 'copcar' : 'jack', v.pos);
        g.audio.bark('vfx_johnny_stealing', 3);
      }
    }
    v.driver = 'player';
    v.ai = null;
    this.vehicle = v;
    g.audio.play('sfx_car_door_open', { vol: 0.7 });
    setTimeout(() => g.audio.play('sfx_car_door_close', { vol: 0.7 }), 450);
    this.c.overlay(null);
    this.c.play(seatClip(v), { fade: 0 });
    this.c.update(0);
    this.seat(v);
    this.showWeapon();
    if (!/npc_|boat|heli/.test(v.def.engine)) g.audio.play(`sfx_${v.def.engine}_startup`, { vol: 0.6 });
    else if (v.type === 'heli') g.audio.play('sfx_helicopter_start', { vol: 0.6 });
    g.audio.setRadioInside(true);
    if (g.audio.station < 0 && g.settings.autoRadio) g.audio.setStation(Math.floor(Math.random() * 5));
    g.hud.notify(v.def.name, 1.5);
  }

  /** Put the character on the vehicle's original seat node, pelvis aligned to the seat. */
  seat(v) {
    const seat = v.mesh.getObjectByName('player_sitting_position_00');
    v.root.add(this.root);
    this.root.rotation.set(0, 0, 0);
    this.root.position.set(0, 0, 0);
    this.pos = this.root.position;
    if (!seat) { this.root.position.set(0.35, 0.05, -0.1); return; }
    v.root.updateMatrixWorld(true);
    seat.getWorldPosition(_v);
    v.root.worldToLocal(_v);
    const pelvis = this.c.getNode('Bip01_Pelvis') || this.c.getNode('Bip01');
    this.root.updateMatrixWorld(true);
    pelvis.getWorldPosition(_o);
    this.root.worldToLocal(_o);
    this.root.position.set(_v.x - _o.x, _v.y - _o.y + 0.08, _v.z - _o.z);
  }

  exit(force = false) {
    const g = this.g, v = this.vehicle;
    if (!v) return;
    if (v.speed > 6 && !force) return;
    v.root.updateMatrixWorld(true);
    this.root.getWorldPosition(_v);
    const left = _d.set(Math.cos(v.yaw), 0, -Math.sin(v.yaw)); // car's +X side (driver door)
    g.scene.add(this.root);
    this.root.position.set(_v.x + left.x * 1.3, v.pos.y, _v.z + left.z * 1.3);
    this.pos = this.root.position;
    this.root.rotation.set(0, v.yaw, 0);
    this.yaw = v.yaw;
    g.world.collide(this.pos, 0.35, 1.7);
    v.driver = null;
    v.ai = null;
    this.vehicle = null;
    g.parked.add(v);
    g.audio.play('sfx_car_door_open', { vol: 0.6 });
    g.audio.engine(null, 0, 0, false);
    g.audio.setRadioInside(false);
    this.c.play('sl__player__idle');
    this.showWeapon();
  }

  // ---------------------------------------------------------------- update
  update(dt, ctl, cam) {
    const g = this.g;
    if (this.dead) { this.c.update(dt); return; }
    this.cool -= dt;
    if (ctl.weaponNext && !this.vehicle) this.nextWeapon();
    if (this.vehicle) return this.drive(dt, ctl);

    if (ctl.enter) {
      const v = this.nearestCar();
      if (v) { this.enter(v); return; }
    }
    const w = WEAPONS[this.weapon];
    const aiming = !this.swimming && !w.melee && (ctl.aim || ctl.fire || g.input.isTouch && ctl.fire);
    // movement relative to camera
    const cy = cam.yaw;
    const fx = Math.sin(cy), fz = Math.cos(cy);
    let mx = fx * ctl.y - fz * ctl.x, mz = fz * ctl.y + fx * ctl.x;
    const ml = Math.hypot(mx, mz);
    if (ml > 1) { mx /= ml; mz /= ml; }
    const moving = ml > 0.1 && this.action <= 0;
    const sprint = ctl.sprint && !aiming;
    // continuous speed from stick tilt: light tilt walks, full tilt runs (no sudden jump between gaits)
    const tilt = Math.min(1, ml);
    const speed = !moving ? 0 : this.swimming ? 0.8 + 1.8 * tilt : aiming ? 2.2 * tilt : sprint ? 7.2 : 1.3 + 3.3 * THREE.MathUtils.smoothstep(tilt, 0.3, 0.9);
    if (moving) {
      this.pos.x += mx * speed * dt; this.pos.z += mz * speed * dt;
      if (!aiming) {
        const yaw = Math.atan2(mx, mz);
        let d = yaw - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
        this.yaw += d * Math.min(1, dt * 12);
      }
    }
    if (aiming) this.yaw = cy;
    this.root.rotation.y = this.yaw;
    g.world.collide(this.pos, 0.35, 1.75, _col);
    // car bodies block the player
    for (const v of g.vehicles()) {
      const dx = this.pos.x - v.pos.x, dz = this.pos.z - v.pos.z;
      const lx = dx * Math.cos(v.yaw) - dz * Math.sin(v.yaw), lz = dx * Math.sin(v.yaw) + dz * Math.cos(v.yaw);
      const hx = v.width / 2 + 0.3, hz = v.length / 2 + 0.3;
      if (Math.abs(lx) < hx && Math.abs(lz - v.offsetZ) < hz && Math.abs(this.pos.y - v.pos.y) < 1.8) {
        const px = hx - Math.abs(lx), pz = hz - Math.abs(lz - v.offsetZ);
        if (px < pz) { const s = Math.sign(lx) * px; this.pos.x += Math.cos(v.yaw) * s; this.pos.z -= Math.sin(v.yaw) * s; }
        else { const s = Math.sign(lz - v.offsetZ) * pz; this.pos.x += Math.sin(v.yaw) * s; this.pos.z += Math.cos(v.yaw) * s; }
        if (v.speed > 4 && !this.knocked) this.runOver(v);
      }
    }
    // gravity / ground
    let gh = g.world.height(this.pos.x, this.pos.z, this.pos.y + 0.5, 0.6);
    // ground rose sharply right here (raised plaza edge without a wall): step up rather than fall through the city
    if (gh === -Infinity) gh = g.world.height(this.pos.x, this.pos.z, this.pos.y + 0.5, 1.6);
    // a hole in the land mesh (not sea): walk over it
    if (gh === -Infinity && this.grounded && !g.world.isWater(this.pos.x, this.pos.z)) gh = this.pos.y;
    if (this.swimming) { this.swim(dt, moving, mx, mz); this.c.update(dt); return; }
    if (ctl.jump && this.grounded && this.action <= 0) {
      this.vy = 5.2; this.grounded = false;
      this.c.play(speed > 3 ? 'fo__player__jump_run' : 'fo__player__jump_walk', { loop: false, fade: 0.1 });
      g.audio.play('sfx_jump', { vol: 0.5 });
    }
    this.vy -= 18 * dt;
    this.pos.y += this.vy * dt;
    if (gh === -Infinity) {
      if (this.pos.y < -0.6) { this.swimming = true; this.showWeapon(); this.c.overlay(null); g.audio.play('sfx_jump', { vol: 0.3 }); }
    } else if (this.pos.y <= gh) {
      if (!this.grounded && this.vy < -11) { this.hurt((-this.vy - 11) * 6); this.c.play('fo__player__jumpdown_land_roll', { loop: false, fade: 0.05 }); this.action = 0.6; }
      this.pos.y = gh; this.vy = 0; this.grounded = true;
    } else if (this.pos.y - gh > 0.35) this.grounded = false;
    else if (this.grounded) this.pos.y = gh;

    // animation
    this.action -= dt;
    if (this.action <= 0) {
      const armed = w.aim === 'rifle' ? '_armed2handed' : '';
      let clip;
      if (!this.grounded && this.vy < -4) clip = 'fl__player__jumpdown_idle';
      else if (!this.grounded) clip = null;
      else if (!moving) clip = 'sl__player__idle' + armed;
      else if (aiming) {
        const back = mx * fx + mz * fz < -0.3;
        clip = (back ? 'sl__player__backwalk' : 'sl__player__walk') + armed;
      } else clip = speed > 6 ? 'fl__player__sprint' + armed : speed > 3 ? 'sl__player__run' + armed : 'sl__player__walk' + armed;
      // keep the feet planted: playback speed follows ground speed within each gait
      const ts = speed > 6 ? 1.1 : speed > 3 ? speed / 4.4 : moving ? Math.max(0.6, speed / 1.7) : 1;
      if (clip) { const act = this.c.play(clip); if (act) act.timeScale = ts; }
    }
    if (aiming && this.reloading <= 0) this.c.overlay(`wo__player__${w.aim}9pts_${cam.pitch > 0.25 ? 'down' : cam.pitch < -0.25 ? 'up' : 'front'}`);
    else if (this.reloading <= 0) this.c.overlay(null);

    // combat
    this.reloading -= dt;
    if (ctl.fire && this.cool <= 0 && this.reloading <= 0) {
      if (w.melee) this.melee(w);
      else if (w.auto || !this.firedLast) this.shoot(w, cam);
    }
    this.firedLast = ctl.fire;
    this.c.update(dt);
  }

  /** Swimming (original fl__player__swim clips): float at the surface, climb out where the bank is low enough. */
  swim(dt, moving, mx, mz) {
    const g = this.g;
    this.pos.y += (-1.15 - this.pos.y) * Math.min(1, dt * 6); this.vy = 0; this.grounded = false;
    if (this.action > 0) return;
    this.c.play(moving ? 'fl__player__swim' : 'fl__player__swim_idle', { fade: 0.25 });
    // reached shallow ground or a bank: climb out (fo__player__climb_from_water)
    const fx = moving ? mx : Math.sin(this.yaw), fz = moving ? mz : Math.cos(this.yaw);
    for (const d of [0, 0.7]) {
      const x = this.pos.x + fx * d, z = this.pos.z + fz * d;
      const h = g.world.height(x, z, 1.4, 0);
      if (h > -0.9 && h < 1.4 && (d === 0 || moving)) {
        this.swimming = false;
        this.pos.set(x, h, z); this.vy = 0; this.grounded = true;
        this.c.play('fo__player__climb_from_water', { loop: false, fade: 0.1 });
        this.action = 0.8;
        this.showWeapon();
        return;
      }
    }
  }

  /** the car sank: get out and swim instead of going down with it */
  bail(v) {
    this.exit(true);
    v.exploded = true; // no fireball under water
    this.pos.y = -1.15;
    this.swimming = true;
    this.g.audio.play('sfx_jump', { vol: 0.4 });
  }

  runOver(v) {
    const dmg = v.speed * 3.5;
    this.hurt(dmg);
    this.knocked = true;
    this.c.play('fo__civilian_all__car_hit_front', { loop: false, fade: 0.05 });
    this.action = 1.2;
    setTimeout(() => { this.knocked = false; }, 1200);
  }

  melee(w) {
    const g = this.g;
    this.cool = w.rate;
    this.action = 0.35;
    const n = 1 + Math.floor(Math.random() * 3);
    this.c.play(this.weapon === 'bat' ? `fo__player__bat_hit_0${n}` : `fo__player__melee_hit_0${n}`, { loop: false, fade: 0.05, timeScale: 1.4 });
    g.audio.play(w.snd || 'sfx_combat_punch_woosh', { vol: 0.5 });
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    for (const p of g.peds.list) {
      if (p.dead) continue;
      const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d < w.range && (dx * fx + dz * fz) / (d || 1) > 0.4) {
        g.audio.play(this.weapon === 'bat' ? 'sfx_baseballbat_hit' : 'sfx_combat_punch', { vol: 0.8 });
        g.peds.damage(p, w.dmg, this.pos, 'melee');
        p.pos.x += fx * 0.4; p.pos.z += fz * 0.4;
        g.crime(p.kind === 'cop' ? 'hitcop' : 'assault', p.pos);
        if (p.onHit) p.onHit('melee');
        break;
      }
    }
  }

  /** Over-the-shoulder hitscan from the camera crosshair. */
  shoot(w, cam) {
    const g = this.g;
    const slot = this.weapons[this.weapon];
    if (slot.clip <= 0) {
      if (slot.ammo > 0) return this.reload(w, slot);
      g.audio.play('sfx_weapon_dry', { vol: 0.6 });
      this.cool = 0.4;
      return;
    }
    slot.clip--;
    this.cool = w.rate;
    g.audio.play(w.snd, { vol: 0.85, rate: 0.95 + Math.random() * 0.1 });
    g.camera.shake(w.explosive ? 0.6 : w.dmg > 60 ? 0.35 : 0.12);
    // muzzle position
    const gun = this.gunModels[this.weapon];
    (gun || this.hand).getWorldPosition(_o);
    _o.y += 0.05;
    // direction from camera through crosshair (+ spread)
    const camObj = g.camera.cam;
    camObj.getWorldDirection(_d);
    _d.x += (Math.random() - 0.5) * w.spread * 2; _d.y += (Math.random() - 0.5) * w.spread * 2; _d.z += (Math.random() - 0.5) * w.spread * 2;
    _d.normalize();
    // touch: soft auto-aim to nearest target in a cone
    const tgt = g.input.isTouch ? g.autoAim(camObj.position, _d, 0.93) : null;
    if (tgt) _d.copy(tgt).sub(camObj.position).normalize();
    const hit = g.hitscan(camObj.position, _d, 400, this);
    const end = hit ? hit.point : _v.copy(camObj.position).addScaledVector(_d, 400);
    g.fx.muzzle(_o, _d);
    if (w.explosive) {
      g.rocket(_o, end);
    } else {
      g.fx.tracer(_o, end);
      if (hit) g.applyHit(hit, w.dmg, this.pos, 'bullet');
    }
    g.peds.panic(this.pos.x, this.pos.z, 45);
    g.crime('gunfire', this.pos);
    if (slot.clip <= 0 && slot.ammo > 0) setTimeout(() => this.reload(w, slot), 250);
  }

  reload(w, slot) {
    if (this.reloading > 0 || slot.ammo <= 0) return;
    this.reloading = w.aim === 'rifle' ? 1.6 : 1.1;
    this.g.audio.play(w.reload, { vol: 0.7 });
    this.c.overlay(w.aim === 'rifle' ? (this.weapon === 'rpg' ? 'so__player__gun_bazooka_reload' : 'so__player__gun_rifle_reload') : 'so__player__gun_1handed_reload', { loop: false });
    const n = Math.min(w.clip - slot.clip, slot.ammo);
    setTimeout(() => { slot.clip += n; slot.ammo -= n; }, this.reloading * 900);
  }

  drive(dt, ctl) {
    const g = this.g, v = this.vehicle;
    if (ctl.enter && v.speed < 6) { this.exit(); return; }
    const c = { throttle: ctl.y, steer: ctl.x, handbrake: ctl.handbrake, up: ctl.handbrake, down: ctl.sprint };
    v.update(dt, c, g.world);
    if (v.impact > 3) {
      g.audio.play(v.impact > 12 ? 'sfx_car_impact_hard' : v.impact > 6 ? 'sfx_car_impact_medium' : 'sfx_car_impact_small', { vol: Math.min(1, v.impact / 12) });
      g.camera.shake(Math.min(0.6, v.impact / 25));
    }
    if (ctl.horn) { if (!this.honking) { this.honking = true; g.audio.loop('horn', 'sfx_npc_horn'); g.audio.setLoop('horn', 0.7); g.peds.panic(v.pos.x, v.pos.z, 12); } }
    else if (this.honking) { this.honking = false; g.audio.stopLoop('horn'); }
    if (ctl.radio) g.hud.notify(g.audio.cycleStation(), 2);
    g.audio.engine(v.def.engine, v.rpm, ctl.y, v.health > 0);
    // skids
    const skid = ctl.handbrake && v.speed > 8 || Math.abs(v.vs) > 4;
    if (skid && !this.skidding) { this.skidding = true; g.audio.loop('skid', 'sfx_skid_long'); }
    if (this.skidding) g.audio.setLoop('skid', skid ? Math.min(0.8, v.speed / 25) : 0);
    if (!skid) this.skidding = false;
    if (v.health <= 300) g.fx.smokeFrom(v.pos.x, v.pos.y + 1.2, v.pos.z + 0, v.health < 120);
    if (v.sunk) { this.bail(v); return; }
    if (v.health <= 0 && !v.exploded) g.explodeVehicle(v);
    this.c.update(dt);
  }
}

