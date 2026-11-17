// Renderer + post-processing chain (HDR, MSAA, GTAO, bloom, warm grading).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.35 },
    uBlur: { value: 0 },
    uSat: { value: 1.08 },
    uFocus: { value: 0 },
    uDamage: { value: 0 },
    uFilter: { value: 0 },
    uGrain: { value: 0.012 },
    uNight: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */`
uniform sampler2D tDiffuse; uniform float uTime, uVignette, uBlur, uSat, uFocus, uDamage, uFilter, uGrain, uNight;
varying vec2 vUv;
float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
void main(){
  vec2 uv = vUv;
  vec4 c = texture2D(tDiffuse, uv);
  // radial speed blur (driving fast)
  if (uBlur > 0.001) {
    vec2 d = (uv - 0.5) * uBlur * 0.05;
    vec3 acc = c.rgb;
    for (int i = 1; i < 6; i++) acc += texture2D(tDiffuse, uv - d * float(i)).rgb;
    float m = smoothstep(0.15, 0.5, length(uv - 0.5));
    c.rgb = mix(c.rgb, acc / 6.0, m);
  }
  // chromatic aberration: only on damage
  float ca = uDamage * 0.005;
  if (ca > 0.0005) {
    c.r = texture2D(tDiffuse, uv + (uv - 0.5) * ca).r;
    c.b = texture2D(tDiffuse, uv - (uv - 0.5) * ca).b;
  }
  // color grading: warm sunlit feel — warm shadows, slightly golden highlights
  float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  c.rgb = mix(vec3(l), c.rgb, uSat);
  // warm tint: orange-ish shadows, golden highlights (like Gangstar original)
  float dayGrade = 1.0 - uNight;
  c.rgb += vec3(0.015, 0.005, -0.01) * (1.0 - l) * dayGrade; // warm shadows
  c.rgb += vec3(0.01, 0.005, -0.008) * l * dayGrade;          // golden highlights
  // night: cooler tint
  c.rgb += vec3(-0.005, 0.0, 0.015) * (1.0 - l) * uNight;
  // focus mode: desaturate + slight blue
  c.rgb = mix(c.rgb, vec3(l) * vec3(0.9, 0.88, 1.05), uFocus * 0.45);
  // photo filters
  if (uFilter > 0.5 && uFilter < 1.5) { c.rgb = vec3(l) * vec3(1.07, 0.98, 0.82); }
  else if (uFilter > 1.5 && uFilter < 2.5) { c.rgb = vec3(smoothstep(0.05, 0.95, l)); }
  else if (uFilter > 2.5 && uFilter < 3.5) { c.rgb = pow(c.rgb, vec3(0.9, 1.0, 1.15)) * vec3(1.1, 0.95, 1.1); }
  else if (uFilter > 3.5) { c.rgb = floor(c.rgb * 6.0) / 6.0; }
  // subtle vignette
  vec2 q = uv - 0.5;
  float v = 1.0 - dot(q, q) * uVignette;
  c.rgb *= v;
  // damage flash
  c.rgb = mix(c.rgb, c.rgb * vec3(1.4, 0.4, 0.4), uDamage * smoothstep(0.2, 0.7, length(q)));
  // very subtle grain
  c.rgb += (rnd(uv * 800.0 + uTime) - 0.5) * uGrain;
  gl_FragColor = c;
}`,
};

export class Gfx {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    const r = this.renderer;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 6000);
    this.quality = 'high';
    this.setup();
    addEventListener('resize', () => this.resize());
  }

  setup() {
    const r = this.renderer;
    const pr = this.pixelRatio();
    r.setPixelRatio(pr);
    r.setSize(innerWidth, innerHeight, false);
    const samples = { low: 0, medium: 4, high: 4, ultra: 8 }[this.quality] ?? 4;
    const rt = new THREE.WebGLRenderTarget(innerWidth * pr, innerHeight * pr, { type: THREE.HalfFloatType, samples });
    if (this.composer) this.composer.dispose();
    this.composer = new EffectComposer(r, rt);
    this.renderPass = new RenderPass(null, this.camera);
    this.composer.addPass(this.renderPass);

    // GTAO — subtle ambient occlusion
    this.gtao = new GTAOPass(this.scene || new THREE.Scene(), this.camera, innerWidth * pr, innerHeight * pr);
    this.gtao.output = GTAOPass.OUTPUT.Default;
    this.gtao.enabled = this.quality !== 'low';
    this.gtao.radius = 0.25;
    this.gtao.thickness = 1.0;
    this.composer.addPass(this.gtao);

    // bloom: very subtle — original game had clean look
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.15, 0.4, 1.5);
    this.bloom.enabled = this.quality !== 'low';
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    if (this.scene) {
      this.renderPass.scene = this.scene;
      this.gtao.scene = this.scene;
    }
  }

  pixelRatio() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    return { low: Math.min(dpr, 0.75), medium: Math.min(dpr, 1), high: Math.min(dpr, 1.5), ultra: dpr }[this.quality] ?? 1;
  }

  setQuality(q) { this.quality = q; this.setup(); }

  setScene(scene) {
    this.scene = scene;
    this.renderPass.scene = scene;
    if (this.gtao) this.gtao.scene = scene;
  }

  resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    const pr = this.pixelRatio();
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(innerWidth, innerHeight);
  }

  render(dt, night) {
    this.grade.uniforms.uTime.value += dt;
    this.grade.uniforms.uNight.value = night;
    // bloom: subtle during day, slightly more at night for lights
    this.bloom.strength = 0.12 + night * 0.25;
    this.bloom.threshold = 1.8 - night * 0.5;
    this.bloom.radius = 0.35 + night * 0.15;
    this.composer.render(dt);
  }
}
