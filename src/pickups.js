// World markers (light beams) and pickups (money, weapons, health, armor, hidden badges).
import * as THREE from 'three';
import { G } from './state.js';
import { groundHeight, P, NX, NZ } from './layout.js';
import { weaponMesh } from './character.js';
import { WEAPONS } from './weapons.js';
import { rand, fmtMoney } from './util.js';

function beamTexture() {
  const c = document.createElement('canvas'); c.width = 4; c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.7, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0.9)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 4, 128);
  return new THREE.CanvasTexture(c);
}
const BEAM_TEX = beamTexture();
const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true); beamGeo.translate(0, 0.5, 0);
const ringGeo = new THREE.RingGeometry(0.85, 1, 40); ringGeo.rotateX(-Math.PI / 2);

export class Marker {
  constructor(x, z, color = 0xffd166, radius = 2.2, height = 30) {
    this.x = x; this.z = z; this.r = radius;
    this.group = new THREE.Group();
    const col = new THREE.Color(color);
    this.beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ map: BEAM_TEX, color: col.clone().multiplyScalar(1.6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    this.beam.scale.set(radius * 0.9, height, radius * 0.9);
    this.ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(3), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.ring.scale.setScalar(radius);
    this.ring.position.y = 0.08;
    this.group.add(this.beam, this.ring);
    this.group.position.set(x, Math.max(0, groundHeight(x, z)), z);
    G.scene.add(this.group);
    this.t = Math.random() * 6;
  }
  update(dt) {
    this.t += dt;
    this.ring.scale.setScalar(this.r * (1 + Math.sin(this.t * 3) * 0.08));
    // fade the beam when the camera is close / inside it so it never veils the screen
    const cp = G.camera.position;
    const cd = Math.hypot(cp.x - this.x, cp.z - this.z);
    const fade = Math.min(1, Math.max(0, (cd - this.r - 0.5) / 6));
    this.beam.material.opacity = (0.75 + Math.sin(this.t * 2) * 0.2) * fade;
    this.beam.visible = fade > 0.01;
  }
  inside(x, z, pad = 0) { return Math.hypot(x - this.x, z - this.z) < this.r + pad; }
  setVisible(v) { this.group.visible = v; }
  dispose() { this.group.removeFromParent(); this.beam.material.dispose(); this.ring.material.dispose(); }
}

const badgeGeo = new THREE.OctahedronGeometry(0.45, 0);
const badgeMat = new THREE.MeshStandardMaterial({ color: 0x220011, emissive: 0xff3fa4, emissiveIntensity: 3, metalness: 0.6, roughness: 0.2 });
const healthMat = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2244, emissiveIntensity: 2.4 });
const armorMat = new THREE.MeshStandardMaterial({ color: 0x000a22, emissive: 0x2e7dff, emissiveIntensity: 2.4 });
const cashMat = new THREE.MeshStandardMaterial({ color: 0x0a2a10, emissive: 0x3dff7a, emissiveIntensity: 1.8 });
const surfMat = new THREE.MeshStandardMaterial({ color: 0x002233, emissive: 0x2ef2ff, emissiveIntensity: 2.5, metalness: 0.3, roughness: 0.5 });
const wheelMat = new THREE.MeshStandardMaterial({ color: 0x1a0a2a, emissive: 0xb44dff, emissiveIntensity: 2.5, metalness: 0.7, roughness: 0.3 });

export class Pickups {
  constructor() {
    this.items = [];
    this.respawn = [];
  }
  init() {
    for (const s of G.world.badgeSpots) if (!G.save.badges.includes(s.id)) this.add('badge', s.x, s.z, { id: s.id, y: s.y });
    for (const s of G.world.pickupSpots) this.add(s.type, s.x, s.z, { respawn: 60, spot: s });
    this.spawnCollectibles();
  }
  spawnCollectibles() {
    const collected = (list, id) => (list || []).includes(id);
    const surfSpots = [
      { x: 0.5*P, z: 2*P }, { x: 3*P, z: 0.5*P }, { x: 7*P, z: 1*P },
      { x: 9*P, z: 3*P }, { x: 1*P, z: 5*P }, { x: 5*P, z: 6*P },
      { x: 8*P, z: 7*P }, { x: 2*P, z: 9*P }, { x: 6*P, z: 10*P },
      { x: 4*P, z: 11*P }, { x: NX*P+40, z: 2*P }, { x: NX*P+50, z: 5*P },
      { x: NX*P+40, z: 8*P }, { x: 0*P-20, z: 4*P }, { x: 0*P-20, z: 9*P },
    ];
    const wheelSpots = [
      { x: 1*P, z: 1*P }, { x: 4*P, z: 2*P }, { x: 8*P, z: 0.5*P },
      { x: 2*P, z: 4*P }, { x: 6*P, z: 3*P }, { x: 9*P, z: 5*P },
      { x: 0.5*P, z: 7*P }, { x: 3*P, z: 8*P }, { x: 7*P, z: 9*P },
      { x: 5*P, z: 10*P }, { x: 1*P, z: 11*P }, { x: 8*P, z: 11*P },
      { x: 4*P, z: 4*P }, { x: 6*P, z: 7*P }, { x: 2*P, z: 1.5*P },
    ];
    for (let i = 0; i < surfSpots.length; i++) {
      const s = surfSpots[i], id = `surf_${i}`;
      if (!collected(G.save.surfboards, id)) this.add('surfboard', s.x, s.z, { id });
    }
    for (let i = 0; i < wheelSpots.length; i++) {
      const s = wheelSpots[i], id = `wheel_${i}`;
      if (!collected(G.save.wheels, id)) this.add('wheel', s.x, s.z, { id });
    }
  }
  add(type, x, z, o = {}) {
    let mesh;
    if (type === 'badge') mesh = new THREE.Mesh(badgeGeo, badgeMat);
    else if (type === 'health') { mesh = new THREE.Group(); const a = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.18, 0.18), healthMat); const b = a.clone(); b.rotation.z = Math.PI / 2; mesh.add(a, b); }
    else if (type === 'armor') mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.25, 0.45, 8), armorMat);
    else if (type === 'surfboard') { mesh = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.6, 2), surfMat); mesh.rotation.x = 0.3; }
    else if (type === 'wheel') mesh = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.12, 8, 16), wheelMat);
    else if (type === 'cash') mesh = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.12, 0.2), cashMat);
    else if (type === 'briefcase') mesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.12), new THREE.MeshStandardMaterial({ color: 0x3a2a1a, emissive: 0xffaa33, emissiveIntensity: 0.6 }));
    else { mesh = weaponMesh(type) || new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), cashMat); mesh.scale.setScalar(1.5); }
    const y = o.y ?? Math.max(0, groundHeight(x, z)) + 0.8;
    mesh.position.set(x, y, z);
    G.scene.add(mesh);
    const glow = new THREE.PointLight(type === 'badge' ? 0xff3fa4 : 0xffffff, 0, 4);
    const it = { type, x, z, y, mesh, t: Math.random() * 6, ...o };
    this.items.push(it);
    return it;
  }
  remove(it) {
    const i = this.items.indexOf(it); if (i >= 0) this.items.splice(i, 1);
    it.mesh.removeFromParent();
  }
  dropFromPed(p) {
    const x = p.x + rand(-0.5, 0.5), z = p.z + rand(-0.5, 0.5);
    if (p.team === 'civ') this.add('cash', x, z, { amount: Math.floor(rand(5, 45)), life: 30 });
    else if (p.team === 'gang') {
      this.add('cash', x, z, { amount: Math.floor(rand(40, 160)), life: 30 });
      if (p.weapon && Math.random() < 0.6) this.add(p.weapon, x + 0.6, z, { ammo: WEAPONS[p.weapon].mag || 1, life: 30 });
    } else if (p.team === 'cop') {
      this.add(p.weapon || 'pistol', x, z, { ammo: 12, life: 30 });
    }
  }
  update(dt) {
    const pl = G.player;
    for (let k = this.items.length - 1; k >= 0; k--) {
      const it = this.items[k];
      it.t += dt;
      it.mesh.rotation.y += dt * 2;
      it.mesh.position.y = it.y + Math.sin(it.t * 2.5) * 0.15;
      if (it.life !== undefined) { it.life -= dt; if (it.life <= 0) { this.remove(it); continue; } }
      if (it.type === 'badge' && Math.random() < dt * 8) G.fx.pickupSparkle(it.x, it.y, it.z, [3, 0.5, 2]);
      const d = Math.hypot(it.x - pl.x, it.z - pl.z);
      const reach = pl.inVehicle ? 2.6 : 1.3;
      if (d < reach && !pl.dead && Math.abs(pl.y + 0.8 - it.y) < 2.5) {
        if (this.collect(it)) {
          this.remove(it);
          if (it.respawn) this.respawn.push({ t: it.respawn, spot: it.spot });
        }
      }
    }
    for (let k = this.respawn.length - 1; k >= 0; k--) {
      const r = this.respawn[k]; r.t -= dt;
      if (r.t <= 0) { this.respawn.splice(k, 1); this.add(r.spot.type, r.spot.x, r.spot.z, { respawn: 60, spot: r.spot }); }
    }
  }
  collect(it) {
    const pl = G.player;
    switch (it.type) {
      case 'cash': G.addMoney(it.amount, true); return true;
      case 'health': if (pl.char.hp >= 100) return false; pl.char.hp = 100; G.hud.notify('❤️ 生命值已恢复'); break;
      case 'armor': if (pl.char.armor >= 100) return false; pl.char.armor = 100; G.hud.notify('🛡️ 获得防弹衣'); break;
      case 'badge':
        G.save.badges.push(it.id);
        G.audio.ui('badge');
        G.addMoney(250);
        G.hud.notify(`💎 秘密道具 ${G.save.badges.length} / 25`);
        if (G.save.badges.length === 25) { G.hud.big('全部秘密道具收集完成！', 'gold', '奖励：防弹衣无限补给 + $25,000', 5); G.addMoney(25000); }
        else if (G.save.badges.length % 5 === 0) { G.hud.notify('🎁 每收集 5 个秘密道具，武器店打折 10%'); }
        G.persist();
        return true;
      case 'surfboard':
        if (!G.save.surfboards) G.save.surfboards = [];
        G.save.surfboards.push(it.id);
        G.audio.ui('badge');
        G.addMoney(500);
        G.hud.notify(`🏄 冲浪板 ${G.save.surfboards.length} / 15`);
        if (G.save.surfboards.length === 15) { G.hud.big('冲浪板全部收集！', 'gold', '解锁高速快艇 Sea-Ride', 5); G.addMoney(15000); }
        G.persist();
        return true;
      case 'wheel':
        if (!G.save.wheels) G.save.wheels = [];
        G.save.wheels.push(it.id);
        G.audio.ui('badge');
        G.addMoney(500);
        G.hud.notify(`🛞 特殊轮毂 ${G.save.wheels.length} / 15`);
        if (G.save.wheels.length === 15) { G.hud.big('轮毂全部收集！', 'gold', '解锁特殊车辆 W4C-H', 5); G.addMoney(15000); }
        G.persist();
        return true;
      case 'briefcase': G.events.emit('briefcase'); break;
      default: {
        if (!WEAPONS[it.type]) return false;
        const amt = it.ammo ?? (WEAPONS[it.type].mag || 1) * 2;
        pl.giveWeapon(it.type, amt);
        G.hud.notify(`${WEAPONS[it.type].icon} 拾取 ${WEAPONS[it.type].name} +${amt}`);
      }
    }
    G.audio.ui('pickup');
    return true;
  }
}

export { fmtMoney };
