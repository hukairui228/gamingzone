import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { Water } from 'three/addons/objects/Water.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { setAnisotropy, texture } from './assets.js';
import { nightUniform } from './city.js';

const QUALITY = {
  low: { pr: 0.75, shadow: 0, bloom: false, water: false, msaa: 0 },
  medium: { pr: 1, shadow: 2048, bloom: true, water: true, msaa: 4 },
  high: { pr: 1.5, shadow: 4096, bloom: true, water: true, msaa: 4 },
  ultra: { pr: 2, shadow: 4096, bloom: true, water: true, msaa: 8 },
};

export class Gfx {
  constructor(canvas) {
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    setAnisotropy(Math.min(16, r.capabilities.getMaxAnisotropy()));

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.25, 4000);
    this.scene.fog = new THREE.Fog(0xa9cbe8, 450, 2600);

    // physical sky
    this.sky = new Sky();
    this.sky.scale.setScalar(3500);
    const su = this.sky.material.uniforms;
    su.turbidity.value = 2; su.rayleigh.value = 2.2; su.mieCoefficient.value = 0.003; su.mieDirectionalG.value = 0.86;
    this.skyGain = { value: 0.42 };
    this.scene.add(this.sky);
    this.skyScene = new THREE.Scene();
    this.envSky = new Sky(); this.envSky.scale.setScalar(100);
    this.skyScene.add(this.envSky);
    for (const s of [this.sky, this.envSky]) {
      s.material.uniforms.uGain = this.skyGain;
      s.material.fragmentShader = 'uniform float uGain;\n' + s.material.fragmentShader
        .replace('gl_FragColor = vec4( retColor, 1.0 );', 'gl_FragColor = vec4( retColor * uGain, 1.0 );');
    }
    this.pmrem = new THREE.PMREMGenerator(r);

    // sun + bounce light
    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbcd8f5, 0x9c8a6a, 0.9);
    this.scene.add(this.hemi);
    this.sunDir = new THREE.Vector3();

    // ocean around Miami, tinted to the original's turquoise
    this.water = new Water(new THREE.PlaneGeometry(6000, 6000), {
      textureWidth: 1024, textureHeight: 1024, waterNormals: this.waterNormals(),
      sunDirection: new THREE.Vector3(0, 1, 0), sunColor: 0xffffff, waterColor: 0x0b6f80,
      distortionScale: 1.6, fog: true,
    });
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.y = 0.05;
    this.water.material.uniforms.size.value = 6;
    this.scene.add(this.water);
    this.waterLow = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshStandardMaterial({
      map: texture('water.webp'), color: 0x9fe3ec, roughness: 0.15, metalness: 0.1,
    }));
    this.waterLow.material.map.repeat.set(600, 600);
    this.waterLow.rotation.x = -Math.PI / 2;
    this.waterLow.position.y = 0.05;
    this.scene.add(this.waterLow);

    this.hour = 11;
    this.envTimer = 0;
    this.setQuality(localStorage.getItem('gm_quality') || 'high');
    addEventListener('resize', () => this.resize());
  }

  waterNormals() {
    // procedural normal map so no external download is needed
    const s = 256, data = new Uint8Array(s * s * 4);
    const h = (x, y) => Math.sin(x * 0.19 + Math.sin(y * 0.07) * 2) * 0.5 + Math.sin(y * 0.23 + x * 0.05) * 0.35 +
      Math.sin((x + y) * 0.41) * 0.15;
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const dx = h(x + 1, y) - h(x - 1, y), dy = h(x, y + 1) - h(x, y - 1);
      const n = new THREE.Vector3(-dx, -dy, 1.2).normalize();
      const i = (y * s + x) * 4;
      data[i] = (n.x * 0.5 + 0.5) * 255; data[i + 1] = (n.y * 0.5 + 0.5) * 255; data[i + 2] = (n.z * 0.5 + 0.5) * 255; data[i + 3] = 255;
    }
    const t = new THREE.DataTexture(data, s, s);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.needsUpdate = true;
    return t;
  }

  setQuality(q) {
    if (!QUALITY[q]) q = 'high';
    this.quality = q;
    localStorage.setItem('gm_quality', q);
    const Q = this.Q = QUALITY[q];
    const r = this.renderer;
    r.setPixelRatio(Math.min(devicePixelRatio || 1, Q.pr));
    r.setSize(innerWidth, innerHeight, false);
    this.sun.castShadow = Q.shadow > 0;
    if (Q.shadow) {
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
      this.sun.shadow.mapSize.set(Q.shadow, Q.shadow);
      const c = this.sun.shadow.camera;
      const e = Q.shadow >= 4096 ? 110 : 80;
      c.left = -e; c.right = e; c.top = e; c.bottom = -e; c.near = 1; c.far = 1200;
      c.updateProjectionMatrix();
    }
    this.water.visible = Q.water;
    this.waterLow.visible = !Q.water;

    const pr = r.getPixelRatio();
    const rt = new THREE.WebGLRenderTarget(innerWidth * pr, innerHeight * pr, { type: THREE.HalfFloatType, samples: Q.msaa });
    if (this.composer) this.composer.dispose();
    this.composer = new EffectComposer(r, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = null;
    if (Q.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.18, 0.45, 0.92);
      this.composer.addPass(this.bloom);
    }
    this.composer.addPass(new OutputPass());
  }

  resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.setQuality(this.quality);
  }

  /** hour: 0..24; focus: world point the shadow map follows */
  update(dt, focus) {
    const t = (this.hour - 6) / 12; // 0 sunrise, 1 sunset
    const elev = Math.sin(Math.max(-0.25, Math.min(1.25, t)) * Math.PI);
    const az = -0.6 + t * 1.6;
    this.sunDir.set(Math.cos(az) * 0.6, Math.max(-0.3, elev), Math.sin(az) * 0.6 + 0.35).normalize();
    const day = THREE.MathUtils.smoothstep(this.sunDir.y, -0.05, 0.18);
    const night = 1 - day;
    const golden = THREE.MathUtils.smoothstep(1 - this.sunDir.y, 0.6, 0.95) * day;
    nightUniform.value = night;
    this.night = night;

    for (const s of [this.sky, this.envSky]) {
      s.material.uniforms.sunPosition.value.copy(this.sunDir);
      s.material.uniforms.rayleigh.value = 2.2 + golden * 1.2;
      s.material.uniforms.turbidity.value = 2 + golden * 3;
    }
    this.sky.position.copy(this.camera.position);

    // sun follows focus; snap to shadow texels to avoid shimmering
    const sc = this.sun.shadow.camera;
    const texel = (sc.right - sc.left) / (this.sun.shadow.mapSize.x || 2048);
    const fx = Math.round(focus.x / texel) * texel, fz = Math.round(focus.z / texel) * texel;
    const lightDir = this.sunDir.y > 0 ? this.sunDir : new THREE.Vector3(-this.sunDir.x, -this.sunDir.y, -this.sunDir.z);
    this.sun.target.position.set(fx, 0, fz);
    this.sun.position.set(fx, 0, fz).addScaledVector(lightDir, 500);
    this.sun.target.updateMatrixWorld();
    this.sun.color.setRGB(1, 0.94 - golden * 0.3, 0.86 - golden * 0.5).lerp(new THREE.Color(0x8fa6ff), night);
    this.sun.intensity = 2.6 * day + 0.3 * night;
    this.hemi.intensity = 0.9 * day + 0.22 * night;
    this.hemi.color.setRGB(0.74, 0.85, 0.96).lerp(new THREE.Color(0x203050), night);
    this.hemi.groundColor.setRGB(0.61, 0.54, 0.42).lerp(new THREE.Color(0x101418), night);

    const fogDay = new THREE.Color(0xa9cbe8).lerp(new THREE.Color(0xf0b88a), golden);
    this.scene.fog.color.copy(fogDay).lerp(new THREE.Color(0x0a0f1c), night);
    this.renderer.toneMappingExposure = 0.9 + night * 0.3;

    const wu = this.water.material.uniforms;
    wu.time.value += dt * 0.5;
    wu.sunDirection.value.copy(this.sunDir);
    wu.sunColor.value.copy(this.sun.color).multiplyScalar(day);
    wu.waterColor.value.setRGB(0.04, 0.42, 0.5).multiplyScalar(day * 0.9 + 0.1);

    this.envTimer -= dt;
    if (this.envTimer <= 0) {
      this.envTimer = 4;
      if (this.envRT) this.envRT.dispose();
      this.envRT = this.pmrem.fromScene(this.skyScene);
      this.scene.environment = this.envRT.texture;
      this.scene.environmentIntensity = 0.35 * day + 0.06;
    }
    if (this.bloom) this.bloom.strength = 0.15 + night * 0.5;
  }

  render() {
    this.composer.render();
  }
}
