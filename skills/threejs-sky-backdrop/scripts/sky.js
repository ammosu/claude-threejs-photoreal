// Procedural sky for three.js. ONE description drives three things that must agree:
//   1. skyRadiance(dir)   the analytic gradient a light baker integrates (same formula as threejs-baked-gi worker.js)
//   2. skyDome(preset)    what you see: the gradient broken up by a cloud deck, a high veil, a low haze band and
//                         (optionally) the sun disk — tuned so its MEAN radiance stays close to the analytic gradient:
//                         clear gaps deeper than the mean, cloud edges brighter, cores about equal (see measureDome)
//   3. skyLights(preset)  a sun DirectionalLight + hemisphere fill for scenes that are NOT baked
// Adapted from room-at-dawn (MIT, github.com/Leonxlnx/room-at-dawn) src/scene/sky.js.
import * as THREE from 'three';

/**
 * Presets. Radiance values are linear RGB, the units threejs-baked-gi expects (horizon ~1 on a bright day).
 *  glow / glowDir   warm brightening around the sun (or where it will rise); sun: dir + irradiance for a real-time light
 *  clouds           cover 0..1 (fraction of the sky under the deck), thick 0..1, edge / core = radiance of thin cloud
 *                   edges and thick cores (linear RGB, same units as the sky), clear = tint of the clear air between
 *                   clouds (multiplies the gradient), veil = high thin cirrus 0..1. Tune them with measureDome().
 *  display          the dome is SHOWN this much darker than it lights (keeps colour instead of clipping to white
 *                   behind a window exposed for the room); 1 for outdoor scenes exposed for the sky
 */
export const SKIES = {
  // room-at-dawn: 6:51, before sunrise, broken stratocumulus under a thin veil, warm glow low in the north-east
  dawn: { zenith: [0.30, 0.47, 0.92], horizon: [0.80, 0.97, 1.30], glow: [0.30, 0.24, 0.16], glowDir: [0.45, 0.22, -0.87], ground: [0.035, 0.045, 0.035],
    sun: null, clouds: { cover: 0.5, thick: 0.5, edge: [1.0, 1.12, 1.34], core: [0.39, 0.49, 0.72], clear: [0.38, 0.52, 0.79], veil: 0.5, speed: 1 }, haze: 0.6, display: 0.3 },
  // clear-ish late morning: fair-weather cumulus, white edges, grey-blue undersides
  day: { zenith: [0.32, 0.48, 0.95], horizon: [0.85, 0.95, 1.15], glow: [0.5, 0.45, 0.35], glowDir: [-0.35, 0.55, -0.76], ground: [0.06, 0.07, 0.05],
    sun: { irr: [3.4, 3.1, 2.7] }, clouds: { cover: 0.32, thick: 0.45, edge: [1.2, 1.2, 1.22], core: [0.62, 0.67, 0.78], clear: [0.62, 0.74, 0.95], veil: 0.25, speed: 1.2 }, haze: 0.5, display: 0.3 },
  // overcast: a closed deck, almost uniform, no sun
  overcast: { zenith: [0.62, 0.66, 0.72], horizon: [0.8, 0.82, 0.86], glow: [0.1, 0.1, 0.1], glowDir: [-0.3, 0.6, -0.74], ground: [0.05, 0.055, 0.05],
    sun: null, clouds: { cover: 0.92, thick: 0.6, edge: [0.98, 0.98, 1.0], core: [0.74, 0.76, 0.8], clear: [0.9, 0.92, 0.96], veil: 0.0, speed: 0.6 }, haze: 0.8, display: 0.3 },
  // golden hour: low sun, orange glow, lit cloud edges
  golden: { zenith: [0.22, 0.32, 0.62], horizon: [1.1, 0.82, 0.62], glow: [1.4, 0.75, 0.3], glowDir: [0.8, 0.12, -0.59], ground: [0.05, 0.04, 0.03],
    sun: { irr: [2.6, 1.5, 0.75] }, clouds: { cover: 0.38, thick: 0.5, edge: [1.3, 0.9, 0.66], core: [0.44, 0.4, 0.5], clear: [0.6, 0.66, 0.85], veil: 0.4, speed: 0.8 }, haze: 0.7, display: 0.3 },
};
const n3 = (a) => new THREE.Vector3(...a).normalize();

/** Analytic sky radiance in direction d (unit): exactly the baker's model. Returns [r, g, b]. */
export function skyRadiance(S, d) {
  if (d[1] < 0) return [...S.ground];
  const t = Math.sqrt(d[1]), gd = n3(S.glowDir);
  let g = d[0] * gd.x + d[1] * gd.y + d[2] * gd.z; g = g > 0 ? g * g : 0;
  return [0, 1, 2].map((k) => S.horizon[k] + (S.zenith[k] - S.horizon[k]) * t + S.glow[k] * g);
}
/** The `sky` block of a threejs-baked-gi cfg (and `sun` when the preset has one; direct sun stays real time). */
export function bakeCfg(S) {
  const sky = { zenith: S.zenith, horizon: S.horizon, glow: S.glow, glowDir: n3(S.glowDir).toArray(), ground: S.ground };
  return S.sun ? { sky, sun: { dir: n3(S.glowDir).toArray(), irr: S.sun.irr, radius: 0.01, bakeDirect: false } } : { sky };
}

export const SKY_U = { uTime: { value: 0 }, uDisplay: { value: 1 } };   // shared: drive uTime from your clock (or fixed for renders)

/** The visible sky: a back-faced unit sphere drawn at infinity (xyww), behind everything, not lit, not a bake occluder. */
export function skyDome(S, { sunDisk = !!S.sun, display = S.display, pure = false } = {}) {
  const C = S.clouds, v = (a) => new THREE.Vector3(...a);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false,
    uniforms: {
      uTime: SKY_U.uTime, uDisplay: { value: display }, uZenith: { value: v(S.zenith) }, uHorizon: { value: v(S.horizon) }, uGlow: { value: v(S.glow) },
      uGlowDir: { value: n3(S.glowDir) }, uGround: { value: v(S.ground) }, uEdge: { value: v(C.edge) }, uCore: { value: v(C.core) }, uClear: { value: v(C.clear) },
      uCloud: { value: new THREE.Vector4(C.cover, C.thick, C.veil, C.speed) }, uHaze: { value: S.haze }, uSun: { value: sunDisk ? 1 : 0 }, uPure: { value: pure ? 1 : 0 },
    },
    vertexShader: 'varying vec3 vD; void main(){ vD = position; vec4 p = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0); gl_Position = p.xyww; }',
    fragmentShader: /* glsl */`
      precision highp float;
      varying vec3 vD; uniform float uTime, uDisplay, uHaze, uSun, uPure; uniform vec3 uZenith, uHorizon, uGlow, uGlowDir, uGround, uEdge, uCore, uClear; uniform vec4 uCloud;
      float h(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
      const mat2 ROT = mat2(0.8, 0.6, -0.6, 0.8);
      float fbm3(vec2 p){ float a = .5, s = 0.; for (int i = 0; i < 3; i++) { s += a * n2(p); p = ROT * p * 2.03 + 7.1; a *= .5; } return s / 0.875; }
      float fbm5(vec2 p){ float a = .5, s = 0.; for (int i = 0; i < 5; i++) { s += a * n2(p); p = ROT * p * 2.03 + 7.1; a *= .46; } return s / 0.88; }
      void main(){
        vec3 d = normalize(vD);
        if (d.y < 0.0) { gl_FragColor = vec4(mix(uHorizon * 0.6, uGround, smoothstep(0.0, -0.12, d.y)) * uDisplay, 1.0); return; }
        float t = sqrt(d.y), g = max(dot(d, uGlowDir), 0.0), g2 = g * g;
        vec3 base = mix(uHorizon, uZenith, t) + uGlow * g2;                         // == the analytic model
        if (uPure > 0.5) { gl_FragColor = vec4(base * uDisplay, 1.0); return; }    // test mode: exactly what the baker sees
        vec3 sky = base * mix(uClear, vec3(0.8, 0.88, 0.96), exp(-d.y * 7.0));      // clear air: deeper than the mean, paler low down
        vec2 drift = vec2(uTime * 0.009, uTime * 0.0035) * uCloud.w;
        // high thin veil: long pale streaks, barely moving
        vec2 q = d.xz / (d.y + 0.3) * 1.3 + drift * 0.3;
        float veil = smoothstep(0.36, 0.8, fbm3(vec2(q.x * 0.9 + q.y * 0.55, q.y * 2.6 - q.x * 0.35) + 3.7));
        sky = mix(sky, base * vec3(0.9, 0.95, 1.0), veil * uCloud.z);
        // cloud deck projected on a plane overhead, domain-warped; cover shifts the threshold, thick the core
        vec2 p = d.xz / (d.y + 0.11) * 1.9 + drift;
        vec2 w = vec2(fbm3(p * 0.55 + 1.7), fbm3(p * 0.55 + vec2(8.3, 2.8))) - 0.5;
        float dn = fbm5(p * 1.2 + w * 1.5) + (n2(p * 0.21 + 4.0) - 0.5) * 0.24;
        float th0 = mix(0.66, 0.28, uCloud.x);
        float cov = smoothstep(th0, th0 + 0.2, dn), thick = smoothstep(th0 + 0.08, th0 + 0.08 + 0.26 * (1.4 - uCloud.y), dn);
        vec3 edge = uEdge * (1.0 + 0.35 * g2) + uGlow * (1.4 * g2);                  // thin edges catch the light
        vec3 core = uCore + uGlow * (0.7 * g2);
        vec3 cloud = mix(edge, core, thick) * mix(0.88, 1.0, exp(-d.y * 2.0));          // absolute radiance, as in room-at-dawn
        sky = mix(sky, cloud, cov * 0.92 * smoothstep(0.0, 0.12, d.y));
        // low haze band, warmer towards the sun
        sky = mix(sky, uHorizon * vec3(0.94, 0.95, 0.96), exp(-d.y * 16.0) * uHaze);
        sky += uGlow * 1.4 * g2 * g2 * exp(-d.y * 4.5);
        if (uSun > 0.5) { float c = dot(d, uGlowDir); sky += vec3(40.0, 36.0, 30.0) * smoothstep(0.99985, 0.99993, c) * (1.0 - 0.7 * cov) + uGlow * 2.0 * pow(max(c, 0.0), 300.0); }
        gl_FragColor = vec4(sky * uDisplay, 1.0);
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
  m.name = 'sky'; m.frustumCulled = false; m.renderOrder = -10;
  m.userData.gi = false; m.userData.bakeOccluder = false; mat.userData.bake = { ignore: true };
  return m;
}

/** For scenes that are NOT baked: a sun light matching the preset (direction = glowDir, intensity = irradiance) and a
 *  hemisphere fill from the analytic zenith / ground. Returns { sun | null, hemi }. */
export function skyLights(S, { shadowSize = 4096, shadowExtent = 30, target = [0, 0, 0] } = {}) {
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const up = skyRadiance(S, [0, 1, 0]), hor = skyRadiance(S, [1, 0.05, 0]);
  const hemi = new THREE.HemisphereLight(new THREE.Color(...up.map((c, k) => (c + hor[k]) / 2)).multiplyScalar(1 / Math.max(1e-3, lum(up))), new THREE.Color(...S.ground).multiplyScalar(1 / Math.max(1e-3, lum(up))), Math.PI * lum(up));
  let sun = null;
  if (S.sun) {
    const I = Math.max(...S.sun.irr), dir = n3(S.glowDir);
    sun = new THREE.DirectionalLight(new THREE.Color(...S.sun.irr.map((c) => c / I)), I);
    sun.position.copy(dir).multiplyScalar(shadowExtent * 1.5).add(new THREE.Vector3(...target)); sun.target.position.set(...target);
    sun.castShadow = true; sun.shadow.mapSize.set(shadowSize, shadowSize);
    Object.assign(sun.shadow.camera, { left: -shadowExtent, right: shadowExtent, top: shadowExtent, bottom: -shadowExtent, near: 1, far: shadowExtent * 4 });
    sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.02;
  }
  return { sun, hemi };
}

/** Image-based light for unbaked scenes: PMREM of the dome (display 1, no sun disk so nothing explodes). */
export function skyEnvironment(renderer, S) {
  const sc = new THREE.Scene(); sc.add(skyDome(S, { sunDisk: false, display: 1 }));
  const pm = new THREE.PMREMGenerator(renderer), env = pm.fromScene(sc, 0, 0.1, 100).texture; pm.dispose();
  return env;
}

/**
 * Check that what you SEE matches what LIGHTS: render the dome (display 1, no sun disk) into a float cube map and
 * compare the cosine-weighted mean over the upper hemisphere (= irradiance / PI on a horizontal surface) with the
 * analytic gradient's. Returns { dome, analytic, ratio } (ratio ~0.85–1.15 is fine). pure: dome without clouds etc. —
 * must give ratio 1.000 (checks the measurement itself).
 */
export function measureDome(renderer, S, size = 64, { pure = false } = {}) {
  const sc = new THREE.Scene(); sc.add(skyDome(S, { sunDisk: false, display: 1, pure }));
  const rt = new THREE.WebGLCubeRenderTarget(size, { type: THREE.FloatType }), cam = new THREE.CubeCamera(0.1, 10, rt);
  cam.update(renderer, sc);
  const buf = new Float32Array(size * size * 4), dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  let dw = 0, aw = 0, W = 0;
  for (let f = 0; f < 6; f++) {
    renderer.readRenderTargetPixels(rt, 0, 0, size, size, buf, f);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const u = ((x + 0.5) / size) * 2 - 1, v = ((y + 0.5) / size) * 2 - 1;
      // cube face -> direction (three.js CubeCamera conventions are mirrored; only y matters for the weight, and
      // the analytic side uses the same direction, so a consistent mapping is all that is needed)
      const F = dirs[f]; let d;
      if (f === 0) d = [1, -v, -u]; else if (f === 1) d = [-1, -v, u]; else if (f === 2) d = [u, 1, v]; else if (f === 3) d = [u, -1, -v]; else if (f === 4) d = [u, -v, 1]; else d = [-u, -v, -1];
      void F;
      const l = Math.hypot(...d); d = d.map((c) => c / l);
      if (d[1] <= 0) continue;
      const solid = 1 / (l * l * l), wgt = d[1] * solid, i = (y * size + x) * 4, a = skyRadiance(S, d);
      dw += (0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2]) * wgt; aw += (0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]) * wgt; W += wgt;
    }
  }
  rt.dispose();
  return { dome: +(dw / W).toFixed(3), analytic: +(aw / W).toFixed(3), ratio: +(dw / aw).toFixed(3) };
}
