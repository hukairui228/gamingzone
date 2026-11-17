// Atmosphere: physical sky, sun/moon light, day-night cycle, environment map, stars, rain.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { clamp, lerp } from './util.js';
import { shared } from './materials.js';
import { glowTexture } from './textures.js';

const _moonDir = new THREE.Vector3();
const _dayFog = new THREE.Color();
const _duskFog = new THREE.Color();
const _nightFog = new THREE.Color();
const _rainFog = new THREE.Color();

export class Atmosphere {
  constructor(scene, renderer) {
    this.scene = scene; this.renderer = renderer;
    this.sky = new Sky();
    this.sky.scale.setScalar(9000);
    this.skyScale = { value: 0.55 };
    const patchSky = (sky) => {
      sky.material.uniforms.uSkyScale = this.skyScale;
      sky.material.fragmentShader = 'uniform float uSkyScale;\n' + sky.material.fragmentShader.replace('gl_FragColor = vec4( retColor, 1.0 );', 'gl_FragColor = vec4( retColor * uSkyScale, 1.0 );');
    };
    patchSky(this.sky);
    scene.add(this.sky);
    const u = this.sky.material.uniforms;
    // clear tropical sky: low turbidity, moderate rayleigh for deep blue
    u.turbidity.value = 3; u.rayleigh.value = 1.5; u.mieCoefficient.value = 0.003; u.mieDirectionalG.value = 0.8;

    // separate sky for env map generation
    this.envSky = new Sky(); this.envSky.scale.setScalar(900);
    patchSky(this.envSky);
    this.envScene = new THREE.Scene(); this.envScene.add(this.envSky);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = null;
    this.envTimer = 0;

    // bright warm sunlight
    this.sun = new THREE.DirectionalLight(0xfff8e8, 3.5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    const sc = this.sun.shadow.camera;
    sc.left = -120; sc.right = 120; sc.top = 120; sc.bottom = -120; sc.near = 1; sc.far = 900;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.05;
    scene.add(this.sun, this.sun.target);

    // bright warm ambient
    this.hemi = new THREE.HemisphereLight(0x87ceeb, 0x8b7355, 0.75);
    scene.add(this.hemi);

    // light blue haze — Miami clear visibility
    scene.fog = new THREE.FogExp2(0xc8e0f0, 0.0006);

    // night dome with stars
    this.nightU = { uNight: { value: 0 }, uTime: { value: 0 }, uRain: { value: 0 } };
    this.stars = new THREE.Mesh(new THREE.SphereGeometry(4200, 48, 24), new THREE.ShaderMaterial({
      uniforms: this.nightU, side: THREE.BackSide, transparent: true, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform float uNight, uTime, uRain; varying vec3 vDir;
        float h3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        void main(){
          vec3 d = normalize(vDir);
          float h = clamp(d.y, -0.3, 1.0);
          vec3 top = vec3(0.005, 0.01, 0.04), mid = vec3(0.02, 0.025, 0.08), hor = vec3(0.08, 0.04, 0.12);
          vec3 col = mix(hor, mid, smoothstep(-0.02, 0.2, h));
          col = mix(col, top, smoothstep(0.2, 0.8, h));
          vec3 p = d * 260.0; vec3 c = floor(p); float r = h3(c);
          float s = step(0.992, r) * smoothstep(0.38, 0.0, length(fract(p) - 0.5)) * smoothstep(0.03, 0.25, h);
          col += s * (0.55 + 0.45 * sin(uTime * (2.0 + r * 3.0) + r * 60.0)) * (1.0 - uRain) * 2.0;
          col = mix(col, vec3(0.06, 0.06, 0.08), uRain * 0.7);
          gl_FragColor = vec4(col, uNight);
        }`,
    }));
    this.stars.renderOrder = 1;
    this.stars.frustumCulled = false;
    scene.add(this.stars);
    // moon
    this.moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xdde8ff, fog: false, depthWrite: false }));
    this.moon.scale.setScalar(260);
    scene.add(this.moon);

    this.sunDir = new THREE.Vector3();
    this.sunColor = new THREE.Color();
    this.night = 0;

    // weather — less frequent rain for sunny Miami
    this.rain = 0; this.rainTarget = 0; this.weatherTimer = 180;
    const RN = 5000, rp = new Float32Array(RN * 6);
    for (let k = 0; k < RN; k++) {
      const x = (Math.random() - 0.5) * 80, y = Math.random() * 40, z = (Math.random() - 0.5) * 80;
      rp.set([x, y, z, x + 0.05, y - 0.9, z], k * 6);
    }
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(rp, 3));
    this.rainMesh = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xaabbcc, transparent: true, opacity: 0.0, depthWrite: false }));
    this.rainMesh.frustumCulled = false;
    scene.add(this.rainMesh);
    this.lightning = 0;
  }

  setShadowQuality(q) {
    const size = { low: 1024, medium: 2048, high: 4096, ultra: 4096 }[q] || 2048;
    this.sun.castShadow = q !== 'low';
    if (this.sun.shadow.map && this.sun.shadow.mapSize.x !== size) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    this.sun.shadow.mapSize.set(size, size);
    const ext = q === 'ultra' ? 150 : 110;
    const sc = this.sun.shadow.camera; sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.updateProjectionMatrix();
  }

  update(dt, hour, focus, camPos, audio) {
    const dayT = (hour - 6.0) / 13.0;
    const elev = Math.sin(clamp(dayT, -0.5, 1.5) * Math.PI) * 1.05 - 0.03;
    const az = lerp(-1.9, 1.9, clamp(dayT, -0.2, 1.2));
    const el = clamp(elev, -0.6, 1.2);
    this.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el) * 0.6 + 0.4).normalize();

    const sunUp = clamp(this.sunDir.y * 4 + 0.2, 0, 1);
    this.night = clamp(1 - (this.sunDir.y + 0.08) * 6, 0, 1);
    shared.uNight.value = this.night;

    const low = clamp(1 - this.sunDir.y * 2.2, 0, 1);

    const u = this.sky.material.uniforms;
    u.sunPosition.value.copy(this.sunDir);
    // clear sky during day, slightly hazier at sunset
    u.rayleigh.value = lerp(1.2, 2.5, 1 - sunUp) * (1 - this.rain * 0.4);
    u.turbidity.value = lerp(2, 6, low * (1 - this.night)) + this.rain * 10;
    u.mieCoefficient.value = lerp(0.002, 0.008, low * (1 - this.night));
    const ue = this.envSky.material.uniforms;
    ue.sunPosition.value.copy(this.sunDir); ue.rayleigh.value = u.rayleigh.value; ue.turbidity.value = u.turbidity.value;
    ue.mieCoefficient.value = u.mieCoefficient.value; ue.mieDirectionalG.value = u.mieDirectionalG.value;

    // sun light — warm white during day, golden at sunset
    this.sunColor.setRGB(1, lerp(0.97, 0.6, low), lerp(0.93, 0.35, low));
    if (this.sunDir.y > -0.05) {
      this.sun.position.copy(camPos).addScaledVector(this.sunDir, 400);
      this.sun.color.copy(this.sunColor);
      this.sun.intensity = clamp(this.sunDir.y * 8, 0, 1) * 3.8 * (1 - this.rain * 0.6);
    } else {
      _moonDir.set(-this.sunDir.x, Math.abs(this.sunDir.y) + 0.3, -this.sunDir.z).normalize();
      this.sun.position.copy(camPos).addScaledVector(_moonDir, 400);
      this.sun.color.setRGB(0.55, 0.65, 1.0);
      this.sun.intensity = 0.4 * (1 - this.rain * 0.7);
    }
    this.sun.target.position.copy(camPos);
    this.sun.target.updateMatrixWorld();

    // hemisphere: bright blue sky + warm ground bounce
    this.hemi.intensity = lerp(0.75, 0.25, this.night) * (1 - this.rain * 0.3);
    this.hemi.color.setRGB(lerp(0.55, 0.2, this.night), lerp(0.75, 0.3, this.night), lerp(0.95, 0.5, this.night));
    this.hemi.groundColor.setRGB(lerp(0.55, 0.12, this.night), lerp(0.45, 0.1, this.night), lerp(0.35, 0.16, this.night));

    // fog: light blue haze during day, warm at sunset, dark at night
    const fc = this.scene.fog.color;
    _dayFog.setRGB(0.78, 0.88, 0.96);
    _duskFog.setRGB(0.95, 0.65, 0.45);
    _nightFog.setRGB(0.06, 0.05, 0.12);
    fc.copy(_dayFog).lerp(_duskFog, low * (1 - this.night)).lerp(_nightFog, this.night);
    _rainFog.setRGB(0.5, 0.52, 0.55);
    fc.lerp(_rainFog, this.rain * 0.6 * (1 - this.night * 0.7));
    // Miami: clear visibility, light haze
    this.scene.fog.density = 0.00035 + this.rain * 0.003 + this.night * 0.0003;
    // brighter exposure overall
    this.renderer.toneMappingExposure = lerp(1.25, 1.5, this.night) * (1 - this.rain * 0.12) * (1 + this.lightning * 2);

    this.nightU.uNight.value = Math.min(1, this.night * 1.15);
    this.nightU.uTime.value += dt;
    this.nightU.uRain.value = this.rain;
    this.stars.position.copy(camPos);
    _moonDir.set(-this.sunDir.x, -this.sunDir.y, -this.sunDir.z);
    this.moon.position.copy(camPos).addScaledVector(_moonDir, 3800);
    this.moon.material.opacity = this.night * (1 - this.rain);
    this.moon.visible = _moonDir.y > 0;
    this.sky.position.copy(camPos);

    // env map refresh
    this.envTimer -= dt;
    if (this.envTimer <= 0) {
      this.envTimer = 3;
      if (this.envRT) this.envRT.dispose();
      this.envRT = this.pmrem.fromScene(this.envScene, 0, 1, 2000);
      this.scene.environment = this.envRT.texture;
      this.scene.environmentIntensity = lerp(0.85, 0.4, this.night) * (1 - this.rain * 0.3);
      this.skyScale.value = lerp(0.72, 0.95, this.night);
    }

    // weather — Miami: mostly sunny, occasional tropical rain
    this.weatherTimer -= dt;
    if (this.weatherTimer <= 0) {
      this.weatherTimer = 120 + Math.random() * 200;
      this.rainTarget = this.rainTarget > 0 ? 0 : (Math.random() < 0.25 ? 0.5 + Math.random() * 0.5 : 0);
    }
    this.rain = lerp(this.rain, this.rainTarget, 1 - Math.exp(-dt * 0.15));
    shared.uWet.value = clamp(this.rain * 1.6, 0, 1);
    this.rainMesh.material.opacity = this.rain * 0.5;
    this.rainMesh.visible = this.rain > 0.02;
    if (this.rainMesh.visible) {
      this.rainMesh.position.set(camPos.x, 0, camPos.z);
      this.rainMesh.position.y = camPos.y - 10 - ((performance.now() * 0.035) % 30);
      if (this.rain > 0.7 && Math.random() < dt * 0.06) {
        this.lightning = 1;
        setTimeout(() => audio && audio.thunder(), 400 + Math.random() * 1200);
      }
    }
    this.lightning = Math.max(0, this.lightning - dt * 4);
    if (audio) audio.setRain(this.rain);
  }

  setWeather(rain) { this.rainTarget = rain; this.weatherTimer = 200; }
}
