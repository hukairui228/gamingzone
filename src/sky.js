import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

/** Shared uniforms for every sky instance (the visible dome and the one rendered into the env map). */
export const skyUniforms = {
  uGain: { value: 0.42 },
  uNight: { value: 0 },
  uTime: { value: 0 },
  uCover: { value: 0.42 },
  uCloudLit: { value: new THREE.Color(1, 1, 1) },
  uCloudShade: { value: new THREE.Color(0.55, 0.6, 0.7) },
  uSunGlow: { value: new THREE.Color(1, 0.9, 0.7) },
  uCloudDetail: { value: 1 },
};

const NOISE = /* glsl */`
float h12(vec2 p){ vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h12(i), h12(i + vec2(1, 0)), u.x), mix(h12(i + vec2(0, 1)), h12(i + vec2(1, 1)), u.x), u.y); }
float fbm(vec2 p, int oct){ float a = 0.5, s = 0.0; mat2 r = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 6; i++) { if (i >= oct) break; s += a * vnoise(p); p = r * p; a *= 0.5; } return s; }
`;

/**
 * Physical (Preetham) sky from three.js plus a drifting cumulus layer with sun-lit edges,
 * a soft sun halo, and a star field at night.
 */
export function makeSky(scale) {
  const s = new Sky();
  s.scale.setScalar(scale);
  const u = s.material.uniforms;
  u.turbidity.value = 2; u.rayleigh.value = 2.2; u.mieCoefficient.value = 0.003; u.mieDirectionalG.value = 0.86;
  Object.assign(u, skyUniforms);
  s.material.fragmentShader = `uniform float uGain, uNight, uTime, uCover, uCloudDetail;
uniform vec3 uCloudLit, uCloudShade, uSunGlow;
${NOISE}
` + s.material.fragmentShader.replace('gl_FragColor = vec4( retColor, 1.0 );', /* glsl */`
  vec3 dir = normalize(vWorldPosition - cameraPosition);
  vec3 sunD = normalize(vSunDirection);
  vec3 col = retColor * uGain;
  float mu = max(dot(dir, sunD), 0.0);
  col += uSunGlow * (pow(mu, 600.0) * 6.0 + pow(mu, 24.0) * 0.18) * (1.0 - uNight);
  // night: deep blue gradient + twinkling stars
  vec3 nightSky = mix(vec3(0.03, 0.045, 0.085), vec3(0.003, 0.007, 0.022), clamp(dir.y * 2.0, 0.0, 1.0));
  vec3 cell = floor(dir * 420.0);
  float st = step(0.9972, fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453));
  nightSky += st * (0.4 + 0.4 * sin(uTime * 3.0 + cell.x)) * smoothstep(0.05, 0.3, dir.y);
  col = mix(col, nightSky, uNight);
  // cloud layer projected on a plane ~2 km up, drifting with the trade wind
  if (dir.y > 0.0) {
    vec2 p = dir.xz / (dir.y + 0.06) * 1.3 + vec2(uTime * 0.012, uTime * 0.004);
    int oct = uCloudDetail > 0.5 ? 6 : 3;
    float n = fbm(p, oct);
    float d = smoothstep(1.0 - uCover, 1.0 - uCover + 0.32, n);
    vec2 toSun = normalize(sunD.xz + 1e-4) * 0.12;
    float ns = fbm(p + toSun, oct);
    float lit = clamp(0.5 + (n - ns) * 4.0, 0.0, 1.0);
    vec3 c = mix(uCloudShade, uCloudLit, lit);
    c += uSunGlow * pow(mu, 6.0) * (1.0 - d) * 1.4 * (1.0 - uNight);  // silver lining
    float fade = smoothstep(0.0, 0.16, dir.y);
    col = mix(col, c, d * fade * 0.96);
  }
  gl_FragColor = vec4(col, 1.0);`);
  return s;
}

/** Set cloud/sky colours for the current sun state. */
export function updateSky(dt, sunDir, day, golden, night) {
  const u = skyUniforms;
  u.uTime.value += dt;
  u.uNight.value = THREE.MathUtils.smoothstep(night, 0.2, 0.9);
  u.uCloudLit.value.setRGB(1.0, 0.97 - golden * 0.25, 0.93 - golden * 0.45).multiplyScalar(0.5 + 0.5 * day).lerp(new THREE.Color(0.08, 0.1, 0.16), night);
  u.uCloudShade.value.setRGB(0.6, 0.66, 0.76).lerp(new THREE.Color(0.55, 0.42, 0.45), golden).multiplyScalar(0.45 + 0.4 * day).lerp(new THREE.Color(0.03, 0.04, 0.07), night);
  u.uSunGlow.value.setRGB(1.0, 0.92 - golden * 0.3, 0.75 - golden * 0.45);
}
