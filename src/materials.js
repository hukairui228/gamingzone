// Custom PBR materials built by injecting GLSL into MeshStandardMaterial.
import * as THREE from 'three';
import { P, W, NX, NZ, CZ, CAUSEWAY, ISLAND, ISLAND_END_X, SIDEWALK, blockDistrict, DISTRICT } from './layout.js';
import { tileTexture } from './textures.js';

export const shared = {
  uNight: { value: 0 },
  uWet: { value: 0 },
  uTime: { value: 0 },
};

const NOISE_GLSL = /* glsl */`
float h21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),u.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),u.x), u.y); }
float fbm(vec2 p){ float a=0.5, s=0.; for(int i=0;i<4;i++){ s+=a*vnoise(p); p*=2.03; a*=0.5;} return s; }
`;

// ---------- Building facade material ----------
// attribute aFacade = (floorHeight, windowSpacing, style, seed)
export function buildingMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.0, envMapIntensity: 1.0 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = shared.uNight;
    sh.uniforms.uWet = shared.uWet;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aFacade;\nvarying vec4 vFacade;\nvarying vec3 vWPos;\nvarying vec3 vWNorm;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFacade = aFacade;\nvWPos = (modelMatrix * vec4(transformed,1.0)).xyz;\nvWNorm = normal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;\nuniform float uWet;\nvarying vec4 vFacade;\nvarying vec3 vWPos;\nvarying vec3 vWNorm;\n' + NOISE_GLSL)
      .replace('#include <emissivemap_fragment>', /* glsl */`
#include <emissivemap_fragment>
{
  vec3 n = normalize(vWNorm);
  float floorH = vFacade.x, spacing = vFacade.y, style = vFacade.z, seed = vFacade.w;
  if (abs(n.y) < 0.5 && style < 5.5) {
    float u = abs(n.x) > 0.5 ? vWPos.z : vWPos.x;
    float v = vWPos.y;
    vec2 cell = vec2(u / spacing, v / floorH);
    vec2 id = floor(cell); vec2 f = fract(cell);
    float mx = 0.2, myb = 0.25, myt = 0.15;
    if (style < 0.5) { mx = 0.05; myb = 0.08; myt = 0.04; }          // glass curtain wall
    else if (style < 1.5) { mx = 0.22; myb = 0.28; myt = 0.12; }     // apartments / deco
    else if (style < 2.5) { mx = 0.3; myb = 0.3; myt = 0.2; }        // houses
    float win = step(mx, f.x) * step(f.x, 1.0 - mx) * step(myb, f.y) * step(f.y, 1.0 - myt);
    float lit = step(0.6 + 0.2 * h21(vec2(seed, 3.1)), h21(id + seed * 13.7));
    vec3 warm = mix(vec3(1.0, 0.72, 0.42), vec3(0.75, 0.88, 1.0), step(0.75, h21(id * 1.7 + seed)));
    if (style > 2.5 && style < 3.5) { // warehouse: corrugated metal
      float st = 0.82 + 0.18 * step(0.5, fract(u * 1.6));
      diffuseColor.rgb *= st; win = 0.0;
      roughnessFactor = 0.55; metalnessFactor = 0.4;
    } else if (style > 3.5 && style < 4.5) { // plain
      win = 0.0;
    } else if (style > 4.5) { // shipping container
      float st = 0.75 + 0.25 * step(0.5, fract(u * 3.0));
      diffuseColor.rgb *= st; win = 0.0; roughnessFactor = 0.6; metalnessFactor = 0.3;
    }
    // ground floor storefronts
    float ground = (style > 0.5 && style < 1.5 && v < floorH * 1.0) ? 1.0 : 0.0;
    if (ground > 0.5) {
      win = step(0.08, fract(u / (spacing * 2.0))) * step(fract(u / (spacing * 2.0)), 0.92) * step(0.08, v / floorH) * step(v / floorH, 0.8);
      lit = 1.0; warm = mix(vec3(1.0, 0.85, 0.6), vec3(0.6, 1.0, 0.95), step(0.5, h21(vec2(floor(u / (spacing * 2.0)), seed))));
    }
    vec3 glass = mix(vec3(0.03, 0.05, 0.07), vec3(0.10, 0.16, 0.22), h21(id + 0.5));
    if (style < 0.5) glass = mix(vec3(0.04, 0.09, 0.12), vec3(0.12, 0.22, 0.28), h21(vec2(seed)));
    diffuseColor.rgb = mix(diffuseColor.rgb, glass, win);
    roughnessFactor = mix(roughnessFactor, 0.06, win);
    metalnessFactor = mix(metalnessFactor, 0.85, win);
    float nightLit = lit * smoothstep(0.15, 0.8, uNight + (ground * 0.3));
    totalEmissiveRadiance += win * nightLit * warm * (ground > 0.5 ? 1.3 : 0.75);
    // subtle dirt / variation
    diffuseColor.rgb *= 0.9 + 0.1 * vnoise(vec2(u, v) * 0.3 + seed);
  } else if (n.y > 0.5) {
    diffuseColor.rgb *= 0.55 * (0.85 + 0.15 * vnoise(vWPos.xz * 0.5));
    roughnessFactor = 0.95;
  }
  roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.6, uWet);
}
`);
  };
  m.customProgramCacheKey = () => 'building-v1';
  return m;
}

// ---------- Ground (roads / sidewalks / lots) ----------
// district lookup texture
function districtTexture() {
  const data = new Uint8Array(NX * NZ * 4);
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const d = blockDistrict(i, j);
    data[(j * NX + i) * 4] = d * 30;
    data[(j * NX + i) * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, NX, NZ);
  t.needsUpdate = true;
  return t;
}

export function groundMaterial() {
  const tiles = tileTexture();
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0.0 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uWet = shared.uWet;
    sh.uniforms.uNight = shared.uNight;
    sh.uniforms.uDistrict = { value: districtTexture() };
    sh.uniforms.uTiles = { value: tiles };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNorm;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed,1.0)).xyz;\nvWNorm = normal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uWet; uniform float uNight; uniform sampler2D uDistrict; uniform sampler2D uTiles;
varying vec3 vWPos; varying vec3 vWNorm;
${NOISE_GLSL}
const float P = ${P.toFixed(1)}; const float HW = ${(W / 2).toFixed(1)};
const float NX = ${NX.toFixed(1)}; const float NZ = ${NZ.toFixed(1)};
const float CZ = ${CZ.toFixed(1)}; const float SW = ${SIDEWALK.toFixed(1)};
const vec4 CAUSE = vec4(${CAUSEWAY.x0.toFixed(1)}, ${CAUSEWAY.x1.toFixed(1)}, ${CAUSEWAY.z0.toFixed(1)}, ${CAUSEWAY.z1.toFixed(1)});
const vec4 ISL = vec4(${ISLAND.x0.toFixed(1)}, ${ISLAND.x1.toFixed(1)}, ${ISLAND.z0.toFixed(1)}, ${ISLAND.z1.toFixed(1)});
const float IEND = ${ISLAND_END_X.toFixed(1)};
float rl(float v){ return v - floor(v / P + 0.5) * P; }
// markings for a road running along 'along' axis with lateral coordinate 'lat'
float roadMarks(float lat, float along, out float yellow){
  yellow = 0.0;
  float m = 0.0;
  float a = abs(lat);
  // double yellow center
  if (a > 0.12 && a < 0.32) { yellow = 1.0; m = 1.0; }
  // lane dashes
  if (abs(a - 4.5) < 0.12 && fract(along / 6.0) < 0.5) m = 1.0;
  // edge lines
  if (abs(a - (HW - 0.5)) < 0.1) m = 1.0;
  return m;
}
`)
      .replace('#include <map_fragment>', /* glsl */`
#include <map_fragment>
vec3 gcol = vec3(0.1);
float rough = 0.9;
{
  vec3 n = normalize(vWNorm);
  vec2 p = vWPos.xz;
  float nz = fbm(p * 0.15);
  float fine = vnoise(p * 3.0);
  vec3 asphalt = vec3(0.075, 0.075, 0.08) * (0.8 + 0.35 * nz + 0.15 * fine);
  float isRoad = 0.0, mark = 0.0, yellow = 0.0;
  bool inCity = p.x > -HW && p.x < NX * P + HW && p.y > -HW && p.y < NZ * P + HW;
  bool inCause = p.x >= CAUSE.x && p.x <= CAUSE.y && p.y >= CAUSE.z && p.y <= CAUSE.w;
  bool inIsl = p.x >= ISL.x && p.x <= ISL.y && p.y >= ISL.z && p.y <= ISL.w;
  if (abs(n.y) < 0.5) {
    // curb faces
    gcol = vec3(0.55, 0.54, 0.52) * (0.85 + 0.15 * fine); rough = 0.8;
  } else if (inCause || (inIsl && p.x < IEND + 14.0 && abs(p.y - CZ) < HW)) {
    float lat = p.y - CZ;
    if (abs(lat) < HW) { isRoad = 1.0; mark = roadMarks(lat, p.x, yellow); }
    else { gcol = vec3(0.5, 0.5, 0.48) * (0.8 + 0.2 * fine); rough = 0.85; }
  } else if (inIsl) {
    // island lawn and paving
    float paver = step(abs(p.y - CZ), 26.0) * step(p.x, IEND + 40.0);
    vec3 grass = mix(vec3(0.12, 0.28, 0.06), vec3(0.2, 0.36, 0.1), nz) * (0.85 + 0.25 * fine);
    vec3 pav = texture2D(uTiles, p * 0.25).rgb * vec3(0.95, 0.92, 0.86);
    gcol = mix(grass, pav, paver); rough = mix(0.95, 0.7, paver);
  } else if (inCity) {
    float lx = rl(p.x), lz = rl(p.y);
    bool vroad = abs(lx) < HW, hroad = abs(lz) < HW;
    if (vroad || hroad) {
      isRoad = 1.0;
      if (vroad && hroad) {
        // intersection: no marks
      } else if (vroad) {
        mark = roadMarks(lx, p.y, yellow);
        float az = abs(lz) - HW;
        if (az > 0.8 && az < 4.0 && fract(lx / 1.4) < 0.55) { mark = 1.0; yellow = 0.0; }        // crosswalk
        if (az > 4.6 && az < 5.1 && lx * sign(lz) > 0.0) { mark = 1.0; yellow = 0.0; }   // stop line (approaching lane)
        if (az < 0.8 || (az >= 4.0 && az < 4.6)) { mark = 0.0; }
      } else {
        mark = roadMarks(lz, p.x, yellow);
        float ax = abs(lx) - HW;
        if (ax > 0.8 && ax < 4.0 && fract(lz / 1.4) < 0.55) { mark = 1.0; yellow = 0.0; }
        if (ax > 4.6 && ax < 5.1 && -lz * sign(lx) > 0.0) { mark = 1.0; yellow = 0.0; }
        if (ax < 0.8 || (ax >= 4.0 && ax < 4.6)) { mark = 0.0; }
      }
    } else {
      // block: sidewalk ring and lot
      float ex = HW + SW;
      bool side = abs(lx) < ex || abs(lz) < ex;
      vec2 bij = floor(p / P);
      float d = texture2D(uDistrict, (bij + 0.5) / vec2(NX, NZ)).r * 255.0 / 30.0;
      vec3 tile = texture2D(uTiles, p * 0.25).rgb;
      if (side) {
        gcol = tile * vec3(0.92, 0.9, 0.88); rough = 0.75;
        // curb edge strip
        float ce = min(abs(lx), abs(lz));
        if (ce < HW + 0.35) gcol = vec3(0.72, 0.7, 0.66);
      } else if (d > 4.5 && d < 5.5) { // park
        gcol = mix(vec3(0.12, 0.3, 0.07), vec3(0.22, 0.4, 0.1), nz) * (0.85 + 0.3 * fine); rough = 0.95;
        // paths
        vec2 c = fract(p / P) - 0.5;
        float path = min(abs(c.x), abs(c.y));
        if (path < 0.03 || abs(length(c) - 0.22) < 0.02) { gcol = vec3(0.75, 0.68, 0.55) * (0.9 + 0.1 * fine); rough = 0.85; }
      } else if (d > 2.5 && d < 3.5) { // residential lawns
        gcol = mix(vec3(0.14, 0.32, 0.08), vec3(0.24, 0.42, 0.12), nz) * (0.85 + 0.3 * fine); rough = 0.95;
      } else if (d < 0.5) { // port concrete
        gcol = vec3(0.42, 0.42, 0.4) * (0.75 + 0.35 * nz); rough = 0.85;
        if (fract(p.x / 12.0) < 0.012 || fract(p.y / 12.0) < 0.012) gcol *= 0.6;
      } else {
        gcol = tile * vec3(0.8, 0.78, 0.75); rough = 0.8;
      }
    }
  } else {
    // outer pads (docks / edges)
    gcol = vec3(0.4, 0.4, 0.39) * (0.75 + 0.35 * nz); rough = 0.85;
    if (fract(p.x / 12.0) < 0.012 || fract(p.y / 12.0) < 0.012) gcol *= 0.6;
    if (p.x < -HW - 40.0) { gcol = mix(gcol, vec3(0.9, 0.75, 0.1), step(0.5, fract((p.x + p.y) * 0.5))); }
  }
  if (isRoad > 0.5) {
    gcol = asphalt;
    // tire wear in lanes
    rough = 0.85;
    vec3 mc = mix(vec3(0.85), vec3(0.95, 0.7, 0.1), yellow) * (0.75 + 0.25 * fine);
    gcol = mix(gcol, mc, mark * 0.92);
    rough = mix(rough, 0.6, mark);
    // patches & cracks
    gcol *= 0.9 + 0.12 * step(0.72, vnoise(p * 0.08));
  }
  // wetness: darker + glossy, puddles
  float puddle = smoothstep(0.55, 0.7, fbm(p * 0.07 + 3.0));
  float wet = uWet * (0.6 + 0.4 * puddle);
  gcol *= mix(1.0, 0.55, wet);
  rough = mix(rough, 0.05 + 0.15 * (1.0 - puddle), wet);
  diffuseColor.rgb = gcol;
}
`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = rough;');
  };
  m.customProgramCacheKey = () => 'ground-v1';
  return m;
}

// ---------- Paint cache for cars ----------
const paintCache = new Map();
export function paintMaterial(hex) {
  let m = paintCache.get(hex);
  if (!m) {
    m = new THREE.MeshPhysicalMaterial({ color: hex, metalness: 0.55, roughness: 0.32, clearcoat: 1.0, clearcoatRoughness: 0.06, envMapIntensity: 1.2 });
    paintCache.set(hex, m);
  }
  return m;
}

const basicCache = new Map();
export function stdMat(hex, rough = 0.7, metal = 0, extra = {}) {
  const k = hex + '_' + rough + '_' + metal + JSON.stringify(extra);
  let m = basicCache.get(k);
  if (!m) { m = new THREE.MeshStandardMaterial({ color: hex, roughness: rough, metalness: metal, ...extra }); basicCache.set(k, m); }
  return m;
}
export function emissiveMat(hex, intensity = 3) {
  const k = 'e' + hex + '_' + intensity;
  let m = basicCache.get(k);
  if (!m) { m = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: hex, emissiveIntensity: intensity, roughness: 0.4 }); basicCache.set(k, m); }
  return m;
}
