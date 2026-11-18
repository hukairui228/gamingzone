import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water.js';
import { Lensflare, LensflareElement } from 'three/addons/objects/Lensflare.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { N8AOPass } from 'n8ao';
import { setAnisotropy, texture } from './assets.js';
import { nightUniform, windUniform, glowMaterials, applyCityQuality } from './city.js';
import { makeSky, updateSky, skyUniforms } from './sky.js';
import { NightLights } from './nightlights.js';

// Final grade: filmic contrast curve, gentle saturation, warm highlights / cool shadows, soft vignette.
const Grade = {
  uniforms: {
    tDiffuse: { value: null }, uSat: { value: 1.1 }, uContrast: { value: 1.06 }, uVignette: { value: 0.28 },
    uWarm: { value: 0.03 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uSat, uContrast, uVignette, uWarm; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv); float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb = mix(vec3(l), c.rgb, uSat);
      c.rgb = (c.rgb - 0.5) * uContrast + 0.5;
      c.rgb += vec3(uWarm, uWarm * 0.4, -uWarm) * (l - 0.45);
      vec2 q = vUv - 0.5; c.rgb *= 1.0 - dot(q, q) * uVignette;
      gl_FragColor = vec4(clamp(c.rgb, 0.0, 1.0), c.a); }`,
};

// pr: pixel ratio cap · shadow: map size · ext: shadow half-extent (m) · msaa samples · ao: N8AO mode
const QUALITY = {
  low: { pr: 0.75, shadow: 0, ext: 0, bloom: false, water: false, msaa: 0, ao: null, smaa: false, lamps: 0, clouds: 0 },
  medium: { pr: 1, shadow: 2048, ext: 90, bloom: true, water: true, msaa: 4, ao: null, smaa: false, lamps: 4, clouds: 1 },
  high: { pr: 1.25, shadow: 4096, ext: 130, bloom: true, water: true, msaa: 0, ao: 'half', smaa: true, lamps: 6, clouds: 1 },
  ultra: { pr: 2, shadow: 4096, ext: 170, bloom: true, water: true, msaa: 0, ao: 'full', smaa: true, lamps: 8, clouds: 1 },
};

export class Gfx {
  constructor(canvas) {
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    setAnisotropy(Math.min(16, r.capabilities.getMaxAnisotropy()));

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.25, 4000);
    this.scene.fog = new THREE.Fog(0xa9cbe8, 380, 2500);

    // sky with drifting clouds; a small copy renders the reflection environment
    this.sky = makeSky(3500);
    this.scene.add(this.sky);
    this.skyScene = new THREE.Scene();
    this.envSky = makeSky(100);
    this.skyScene.add(this.envSky);
    this.pmrem = new THREE.PMREMGenerator(r);

    // sun + sky bounce
    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.00025;
    this.sun.shadow.normalBias = 0.05;
    this.sun.shadow.radius = 2;
    this.scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbcd8f5, 0x9c8a6a, 0.9);
    this.scene.add(this.hemi);
    this.sunDir = new THREE.Vector3();

    // lens flare from the original game's sun / glow sprites
    this.flare = new Lensflare();
    const sunTex = texture('add-sun.webp', { repeat: false }), glowTex = texture('add-glow.webp', { repeat: false });
    this.flare.addElement(new LensflareElement(sunTex, 420, 0, new THREE.Color(1, 0.95, 0.85)));
    this.flare.addElement(new LensflareElement(glowTex, 90, 0.45, new THREE.Color(1, 0.8, 0.5)));
    this.flare.addElement(new LensflareElement(glowTex, 60, 0.62, new THREE.Color(0.6, 0.9, 1)));
    this.flare.addElement(new LensflareElement(glowTex, 150, 0.85, new THREE.Color(1, 0.7, 0.9)));
    this.flare.addElement(new LensflareElement(glowTex, 80, 1.0, new THREE.Color(0.7, 1, 0.8)));
    this.scene.add(this.flare);

    // ocean around Miami, tinted to the original's turquoise
    this.water = new Water(new THREE.PlaneGeometry(6000, 6000), {
      textureWidth: 1024, textureHeight: 1024, waterNormals: this.waterNormals(),
      sunDirection: new THREE.Vector3(0, 1, 0), sunColor: 0xffffff, waterColor: 0x0b6f80,
      distortionScale: 2.2, fog: true, alpha: 1,
    });
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.y = 0.05;
    this.water.material.uniforms.size.value = 4;
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
    // phones default to high too: modern phone GPUs handle it, and dynamic resolution keeps the frame rate up
    this.touch = matchMedia('(pointer: coarse)').matches;
    // out of GPU memory: step quality down once and reload instead of failing repeatedly
    r.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      const order = ['low', 'medium', 'high', 'ultra'];
      const i = Math.max(0, order.indexOf(this.quality) - 1);
      try { localStorage.setItem('gm_quality2', order[i]); } catch { /* ignore */ }
      const m = document.querySelector('#loading .msg');
      document.getElementById('loading')?.classList.remove('hidden');
      if (m) m.textContent = '显存不足，正在以较低画质重新载入…';
      setTimeout(() => location.reload(), 800);
    });
    this.dyn = 1; this.frameT = 0; this.frames = 0; this.dynT = 0;
    this.setQuality(localStorage.getItem('gm_quality2') || 'high');
    addEventListener('resize', () => this.resize());
  }

  /** Optional: the game object, so vehicle lights can follow cars (falls back to window.__game). */
  attach(game) { this.game = game; }

  waterNormals() {
    // tileable procedural ripple normals (several directional wave trains) — no external download
    const s = 512, data = new Uint8Array(s * s * 4);
    const waves = [[1, 0, 9, 0.5], [0.6, 0.8, 14, 0.35], [-0.7, 0.7, 23, 0.25], [0.2, -1, 31, 0.18], [-0.9, -0.4, 47, 0.12]];
    const T = Math.PI * 2 / s;
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      let dx = 0, dy = 0;
      for (const [wx, wy, f, a] of waves) {
        const k = Math.round(f * wx), l = Math.round(f * wy);
        const c = Math.cos((x * k + y * l) * T) * a;
        dx += c * k * 0.06; dy += c * l * 0.06;
      }
      const n = new THREE.Vector3(-dx, -dy, 1).normalize();
      const i = (y * s + x) * 4;
      data[i] = (n.x * 0.5 + 0.5) * 255; data[i + 1] = (n.y * 0.5 + 0.5) * 255; data[i + 2] = (n.z * 0.5 + 0.5) * 255; data[i + 3] = 255;
    }
    const t = new THREE.DataTexture(data, s, s);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  }

  setQuality(q) {
    if (!QUALITY[q]) q = 'high';
    this.quality = q;
    try { localStorage.setItem('gm_quality2', q); } catch { /* private mode */ }
    const Q = this.Q = QUALITY[q];
    const r = this.renderer;
    r.setPixelRatio(this.targetPR());
    r.setSize(innerWidth, innerHeight, false);
    this.sun.castShadow = Q.shadow > 0;
    if (Q.shadow) {
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
      const sm = this.touch ? Math.min(Q.shadow, 2048) : Q.shadow;
      this.sun.shadow.mapSize.set(sm, sm);
      const c = this.sun.shadow.camera;
      c.left = -Q.ext; c.right = Q.ext; c.top = Q.ext; c.bottom = -Q.ext; c.near = 1; c.far = 1400;
      c.updateProjectionMatrix();
    }
    this.water.visible = Q.water;
    this.waterLow.visible = !Q.water;
    this.flare.visible = q !== 'low';
    skyUniforms.uCloudDetail.value = Q.clouds;
    applyCityQuality(Q.msaa > 0);

    if (this.lights) this.lights.dispose();
    this.lights = new NightLights(this.scene, Q.lamps);

    const pr = r.getPixelRatio();
    const w = Math.round(innerWidth * pr), h = Math.round(innerHeight * pr);
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: Q.msaa });
    if (this.composer) this.composer.dispose();
    this.composer = new EffectComposer(r, rt);
    this.ao = null;
    if (Q.ao) {
      // N8AO works from the depth buffer, so alpha-tested palms and fences occlude correctly
      const ao = this.ao = new N8AOPass(this.scene, this.camera, w, h);
      ao.configuration.aoRadius = 2.5;
      ao.configuration.distanceFalloff = 1.2;
      ao.configuration.intensity = 2.2;
      ao.configuration.gammaCorrection = false;
      ao.configuration.halfRes = Q.ao === 'half';
      ao.configuration.depthAwareUpsampling = true;
      ao.setQualityMode(Q.ao === 'half' ? 'Medium' : 'High');
      this.composer.addPass(ao);
    } else this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = null;
    if (Q.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.22, 0.5, 0.9);
      this.composer.addPass(this.bloom);
    }
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(Grade);
    this.composer.addPass(this.grade);
    if (Q.smaa) this.composer.addPass(new SMAAPass(w, h));
  }

  /** pixel ratio: phones render near native sharpness (their screens are 3x), scaled by the dynamic-resolution factor */
  targetPR() {
    const cap = this.touch ? { low: 1, medium: 1.5, high: 2, ultra: 2.5 }[this.quality] : this.Q.pr;
    return Math.max(0.75, Math.min(devicePixelRatio || 1, cap) * this.dyn);
  }

  applyResolution() {
    const pr = this.targetPR();
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(innerWidth, innerHeight);
  }

  /** dynamic resolution: hold ~55-60 fps by trading render resolution */
  adapt(dt) {
    this.frameT += dt; this.frames++;
    if (this.frameT < 1.5) return;
    const avg = this.frameT / this.frames;
    this.frameT = 0; this.frames = 0;
    const before = this.dyn;
    if (avg > 1 / 45) this.dyn = Math.max(0.55, this.dyn - 0.1);
    else if (avg < 1 / 57) this.dyn = Math.min(1, this.dyn + 0.05);
    if (Math.abs(this.dyn - before) > 0.001) this.applyResolution();
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
    windUniform.value += dt;
    this.night = night;

    for (const s of [this.sky, this.envSky]) {
      s.material.uniforms.sunPosition.value.copy(this.sunDir);
      s.material.uniforms.rayleigh.value = 2.2 + golden * 1.2;
      s.material.uniforms.turbidity.value = 2 + golden * 3;
    }
    updateSky(dt, this.sunDir, day, golden, night);
    this.sky.position.copy(this.camera.position);

    // sun follows focus; snap to shadow texels to avoid shimmering
    const sc = this.sun.shadow.camera;
    const texel = (sc.right - sc.left) / (this.sun.shadow.mapSize.x || 2048);
    const fx = Math.round(focus.x / texel) * texel, fz = Math.round(focus.z / texel) * texel;
    const lightDir = this.sunDir.y > 0 ? this.sunDir : new THREE.Vector3(-this.sunDir.x, -this.sunDir.y, -this.sunDir.z);
    this.sun.target.position.set(fx, 0, fz);
    this.sun.position.set(fx, 0, fz).addScaledVector(lightDir, 600);
    this.sun.target.updateMatrixWorld();
    this.sun.color.setRGB(1, 0.94 - golden * 0.38, 0.86 - golden * 0.62).lerp(new THREE.Color(0x8fa6ff), night);
    this.sun.intensity = 2.5 * day + 0.2 * night;
    this.hemi.intensity = 0.75 * day + 0.09 * night;
    this.hemi.color.setRGB(0.74, 0.85, 0.96).lerp(new THREE.Color(0xf2b48c), golden * 0.5).lerp(new THREE.Color(0x3a5590), night);
    this.hemi.groundColor.setRGB(0.61, 0.54, 0.42).lerp(new THREE.Color(0x101418), night);

    const fogDay = new THREE.Color(0xa9cbe8).lerp(new THREE.Color(0xf0b88a), golden);
    this.scene.fog.color.copy(fogDay).lerp(new THREE.Color(0x0a0f1c), night);
    this.renderer.toneMappingExposure = 0.88 + night * 0.08;

    // lens flare sits on the sun, far away along its direction
    this.flare.position.copy(this.camera.position).addScaledVector(this.sunDir, 3500);
    this.flare.visible = this.quality !== 'low' && this.sunDir.y > 0.02;

    const wu = this.water.material.uniforms;
    wu.time.value += dt * 0.6;
    wu.sunDirection.value.copy(this.sunDir);
    wu.sunColor.value.copy(this.sun.color).multiplyScalar(day * 1.2);
    wu.waterColor.value.setRGB(0.03, 0.36, 0.44).lerp(new THREE.Color(0.08, 0.2, 0.3), golden * 0.5).multiplyScalar(day * 0.9 + 0.1);

    this.envTimer -= dt;
    if (this.envTimer <= 0) {
      this.envTimer = 4;
      if (this.envRT) this.envRT.dispose();
      this.envRT = this.pmrem.fromScene(this.skyScene);
      this.scene.environment = this.envRT.texture;
      this.scene.environmentIntensity = 0.38 * day + 0.05;
    }
    if (this.bloom) { this.bloom.strength = 0.18 + night * 0.45; this.bloom.threshold = 0.92 - night * 0.25; }
    this.grade.uniforms.uWarm.value = 0.02 + golden * 0.05;
    for (const m of glowMaterials) m.opacity = 0.12 + night * 0.88;
    this.lights.update(dt, night, this.camera, this.game || window.__game);
  }

  render() {
    this.composer.render();
  }
}
