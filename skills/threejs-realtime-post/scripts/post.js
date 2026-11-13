// Real-time photographic post for three.js (WebGL2), one small class, no EffectComposer:
//   HDR scene (half float, MSAA, depth texture)
//   -> contact AO at half resolution (14 cosine-weighted hemisphere samples, interleaved-gradient noise, depth-aware blur)
//   -> composite: colour × AO (AO fades out on bright pixels), "outside" pixels scaled separately (window balance)
//   -> bloom (6-level down/up chain, no threshold by default: everything glows a little, like a real lens)
//   -> grade: exposure, white balance, vignette in light, shadow/mid/highlight tints, saturation + foliage vibrance,
//      contrast around mid grey, Uchimura filmic curve (luma/per-channel blend, saturated highlights roll to white),
//      sRGB, grain + 1/255 dither.
// One LOOK object drives it, so stills, the live view and a film can share the same grade.
// Adapted from room-at-dawn (MIT, github.com/Leonxlnx/room-at-dawn) src/render/pipeline.js, look.js, game/game.js.
import * as THREE from 'three';

const tri = new THREE.BufferGeometry();
tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
const VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
class Pass {
  constructor(frag, uniforms, opts = {}) {
    this.mat = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false, ...opts });
    this.mesh = new THREE.Mesh(tri, this.mat); this.mesh.frustumCulled = false; this.cam = new THREE.Camera();
  }
  get u() { return this.mat.uniforms; }
  render(r, target) { r.setRenderTarget(target); r.render(this.mesh, this.cam); }
}

const AO_FS = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tDepth; uniform mat4 uProj; uniform mat4 uProjInv; uniform vec2 uRes; uniform float uRadius; uniform float uFrame;
vec3 viewPos(vec2 uv){ float d = texture2D(tDepth, uv).x; vec4 c = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); return c.xyz / c.w; }
float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
void main(){
  float d0 = texture2D(tDepth, vUv).x;
  if (d0 >= 0.99999) { gl_FragColor = vec4(1.0, 1e4, 0.0, 1.0); return; }
  vec3 P = viewPos(vUv);
  vec2 px = 1.0 / uRes;
  // normal from depth: take the smaller of the two one-sided differences, so silhouettes do not smear
  vec3 dxa = viewPos(vUv + vec2(px.x, 0.0)) - P, dxb = P - viewPos(vUv - vec2(px.x, 0.0));
  vec3 dya = viewPos(vUv + vec2(0.0, px.y)) - P, dyb = P - viewPos(vUv - vec2(0.0, px.y));
  vec3 dx = abs(dxa.z) < abs(dxb.z) ? dxa : dxb, dy = abs(dya.z) < abs(dyb.z) ? dya : dyb;
  vec3 N = normalize(cross(dx, dy));
  float n1 = ign(gl_FragCoord.xy + uFrame * 5.588238), n2 = ign(gl_FragCoord.yx * 1.37 + 31.7 + uFrame * 3.17);
  vec3 rv = normalize(vec3(cos(n1 * 6.2831853), sin(n1 * 6.2831853), 0.0));
  vec3 T = normalize(rv - N * dot(rv, N)), B = cross(N, T);
  float occ = 0.0, wsum = 0.0;
  const int NS = 14;
  for (int i = 0; i < NS; i++) {
    float fi = (float(i) + n2) / float(NS);
    float a = float(i) * 2.399963 + n1 * 6.2831853;                        // golden-angle spiral
    float cz = sqrt(1.0 - fi * 0.92), sr = sqrt(1.0 - cz * cz);
    vec3 dir = T * (cos(a) * sr) + B * (sin(a) * sr) + N * cz;
    float rad = uRadius * mix(0.12, 1.0, fract(fi * 7.31 + n1) * fract(fi * 7.31 + n1));   // more samples close in
    vec3 S = P + dir * rad + N * 0.004;
    vec4 c = uProj * vec4(S, 1.0); vec2 suv = c.xy / c.w * 0.5 + 0.5;
    if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) continue;
    float sz = viewPos(suv).z, diff = sz - S.z;                                // > 0: geometry in front of the sample
    float range = smoothstep(0.0, 1.0, uRadius / max(1e-4, abs(P.z - sz)));   // ignore occluders far in front
    occ += step(0.0025, diff) * range * cz; wsum += cz;
  }
  gl_FragColor = vec4(1.0 - occ / max(wsum, 1e-4), -P.z, 0.0, 1.0);
}`;
const AOBLUR_FS = /* glsl */`
precision highp float;
varying vec2 vUv; uniform sampler2D tAO; uniform vec2 uDir;
void main(){
  vec4 c = texture2D(tAO, vUv); float z = c.y; float s = c.x, w = 1.0;
  for (int i = -3; i <= 3; i++) { if (i == 0) continue;
    vec4 t = texture2D(tAO, vUv + uDir * float(i) * 1.3);
    float k = exp(-abs(t.y - z) / (0.02 * z + 0.002)) * (1.0 - abs(float(i)) * 0.18);   // depth-aware: no AO bleeding across edges
    s += t.x * k; w += k; }
  gl_FragColor = vec4(s / w, z, 0.0, 1.0);
}`;
const COMP_FS = (extGlsl) => /* glsl */`
precision highp float;
varying vec2 vUv; uniform sampler2D tColor; uniform sampler2D tAO; uniform sampler2D tDepth; uniform mat4 uInvPV;
uniform float uAO; uniform float uExt;
void main(){
  vec3 c = texture2D(tColor, vUv).rgb; float ao = texture2D(tAO, vUv).x, d = texture2D(tDepth, vUv).x;
  vec4 wp4 = uInvPV * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); vec3 wp = wp4.xyz / wp4.w;
  float isExt = (d >= 0.99999 || (${extGlsl})) ? 1.0 : 0.0;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float k = mix(1.0, ao, uAO * (1.0 - smoothstep(0.6, 2.5, l)) * (1.0 - 0.5 * isExt));   // lit surfaces and the view outside keep less AO
  gl_FragColor = vec4(min(c, vec3(60.0)) * k * mix(1.0, uExt, isExt), 1.0);            // clamp: one firefly must not flood the bloom
}`;
const DOWN_FS = /* glsl */`
precision highp float;
varying vec2 vUv; uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThresh;
void main(){
  vec3 a = texture2D(tSrc, vUv).rgb * 4.0;
  a += texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb
     + texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  a /= 8.0;
  if (uThresh > 0.0) { float l = max(a.r, max(a.g, a.b)); a *= smoothstep(uThresh * 0.5, uThresh * 2.0, l); }
  gl_FragColor = vec4(a, 1.0);
}`;
const UP_FS = /* glsl */`
precision highp float;
varying vec2 vUv; uniform sampler2D tSrc; uniform vec2 uTexel;
void main(){
  vec3 s = texture2D(tSrc, vUv + uTexel * vec2(-1.0, 0.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, 0.0)).rgb
         + texture2D(tSrc, vUv + uTexel * vec2(0.0, -1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(0.0, 1.0)).rgb;
  s = s * 2.0 + texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb
    + texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  gl_FragColor = vec4(s / 12.0, 1.0);
}`;
const FINAL_FS = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tColor; uniform sampler2D tBloom;
uniform float uExposure, uBloom, uVignette, uGrain, uSeed, uSat, uContrast, uFade, uVib;
uniform vec3 uShadowTint, uMidTint, uHighTint, uWB;
uniform vec2 uRes;
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
// Uchimura filmic curve (Gran Turismo): toe, long linear section, soft shoulder to peak P
float uchi(float x, float P){
  const float a = 1.0, m = 0.22, l = 0.4, c = 1.33, b = 0.0;
  float l0 = ((P - m) * l) / a, S0 = m + l0, S1 = m + a * l0, C2 = (a * P) / (P - S1), CP = -C2 / P;
  float w0 = 1.0 - smoothstep(0.0, m, x), w2 = step(m + l0, x), w1 = 1.0 - w0 - w2;
  float T = m * pow(x / m, c) + b, Lc = m + a * (x - m), Sc = P - (P - S1) * exp(CP * (x - S0));
  return T * w0 + Lc * w1 + Sc * w2;
}
vec3 tonemap(vec3 c, float P){
  float l = max(luma(c), 1e-5);
  vec3 o = mix(c * (uchi(l, P) / l), vec3(uchi(c.r, P), uchi(c.g, P), uchi(c.b, P)), 0.55);   // by luminance keeps hue, per channel desaturates
  float over = smoothstep(0.75 * P, 1.05 * P, max(o.r, max(o.g, o.b)));
  return mix(o, vec3(min(luma(o), P)), over * 0.6);                    // saturated highlights roll towards white, never clip to a primary
}
vec3 srgb(vec3 c){ return mix(c * 12.92, 1.055 * pow(max(c, 0.0), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main(){
  vec3 c = texture2D(tColor, vUv).rgb;
  c += texture2D(tBloom, vUv).rgb * uBloom;
  c *= uExposure * uWB;
  vec2 q = vUv - 0.5; q.x *= uRes.x / uRes.y * 0.82;
  c *= mix(1.0, smoothstep(1.05, 0.25, length(q)), uVignette);           // vignette in light, before the curve
  float l = luma(c);
  float sh = 1.0 - smoothstep(0.0, 0.25, l), hi = smoothstep(0.35, 1.6, l);
  c *= mix(mix(uMidTint, uShadowTint, sh), uHighTint, hi);
  l = luma(c);
  float gm = clamp((c.g - max(c.r, c.b)) / max(l, 1e-4), 0.0, 1.0);     // how 'foliage green' this pixel is
  c = mix(vec3(l), c, uSat * (1.0 + uVib * gm));
  c.r += gm * uVib * 0.10 * l;                                          // and push it a little towards yellow-green
  c = pow(max(c, 0.0) / 0.18, vec3(uContrast)) * 0.18;                  // contrast pivots on mid grey
  c *= uFade;
  c = srgb(clamp(tonemap(c, 1.0), 0.0, 1.0));
  c += (hash(gl_FragCoord.xy + uSeed * 91.7) - 0.5) * (uGrain * (1.0 - 0.6 * luma(c)) + 1.0 / 255.0);   // grain, more in the shadows; dither kills banding
  gl_FragColor = vec4(c, 1.0);
}`;

/** Neutral default grade. Set exposure for your own light levels (scene-linear, no GI: ~1–1.5; baked GI rooms: much higher). */
export const LOOK = {
  exposure: 1, ext: 1, vib: 0.3, bloom: 0.04, bloomThresh: 0, vignette: 0.15, grain: 0.012, sat: 1.05, contrast: 1.02, fade: 1,
  ao: 1.0, aoRadius: 0.16,
  shadowTint: [1, 1, 1], midTint: [1, 1, 1], highTint: [1, 1, 1], wb: [1, 1, 1],
};
/** Presets on top of LOOK. dawn = room-at-dawn's grade (cool morning light: blue shadows, cool white balance). */
export const LOOKS = {
  neutral: {},
  dawn: { sat: 1.1, shadowTint: [0.9, 0.98, 1.12], midTint: [0.97, 1.0, 1.04], wb: [0.9, 0.985, 1.14] },
  warm: { sat: 1.08, shadowTint: [0.96, 0.97, 1.04], midTint: [1.03, 1.0, 0.95], wb: [1.08, 1.0, 0.88], vignette: 0.2 },
  flat: { vignette: 0, grain: 0, sat: 1, vib: 0, contrast: 1, bloom: 0.04 },
};

export class Post {
  /** opts.ext: GLSL boolean expression on `wp` (world position) marking "outside" pixels, e.g. 'wp.z < -0.33'
   *  for everything beyond a window in the z = -0.33 plane. Sky (no depth) always counts as outside. */
  constructor(renderer, { ext = 'false' } = {}) {
    this.r = renderer; this.look = { ...LOOK }; this.frame = 0; this.w = 0; this.h = 0;
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping;   // the grade does both
    const v2 = () => ({ value: new THREE.Vector2() }), m4 = () => ({ value: new THREE.Matrix4() }), c3 = () => ({ value: new THREE.Color() });
    this.ao = new Pass(AO_FS, { tDepth: { value: null }, uProj: m4(), uProjInv: m4(), uRes: v2(), uRadius: { value: 0.16 }, uFrame: { value: 0 } });
    this.aoBlur = new Pass(AOBLUR_FS, { tAO: { value: null }, uDir: v2() });
    this.comp = new Pass(COMP_FS(ext), { tColor: { value: null }, tAO: { value: null }, tDepth: { value: null }, uInvPV: m4(), uAO: { value: 1 }, uExt: { value: 1 } });
    this.down = new Pass(DOWN_FS, { tSrc: { value: null }, uTexel: v2(), uThresh: { value: 0 } });
    this.up = new Pass(UP_FS, { tSrc: { value: null }, uTexel: v2() }, { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor });
    this.final = new Pass(FINAL_FS, { tColor: { value: null }, tBloom: { value: null }, uExposure: { value: 1 }, uBloom: { value: 0 }, uVignette: { value: 0 }, uGrain: { value: 0 }, uSeed: { value: 0 },
      uSat: { value: 1 }, uVib: { value: 0 }, uContrast: { value: 1 }, uFade: { value: 1 }, uShadowTint: c3(), uMidTint: c3(), uHighTint: c3(), uWB: c3(), uRes: v2() });
  }
  /** Apply a partial look (arrays become colours). */
  setLook(over) { Object.assign(this.look, over); return this; }
  setSize(w, h, { msaa = 4 } = {}) {
    if (w === this.w && h === this.h && msaa === this.msaa) return;
    this.dispose(); this.w = w; this.h = h; this.msaa = msaa;
    const opt = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
    this.rtMain = new THREE.WebGLRenderTarget(w, h, { ...opt, depthBuffer: true, samples: msaa });
    this.rtMain.depthTexture = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
    this.rtMain.depthTexture.minFilter = this.rtMain.depthTexture.magFilter = THREE.NearestFilter;
    const aw = Math.ceil(w / 2), ah = Math.ceil(h / 2);
    this.rtAO = new THREE.WebGLRenderTarget(aw, ah, opt); this.rtAO2 = new THREE.WebGLRenderTarget(aw, ah, opt);
    this.rtComp = new THREE.WebGLRenderTarget(w, h, opt);
    this.mips = []; let mw = w, mh = h;
    for (let i = 0; i < 6; i++) { mw = Math.max(2, Math.ceil(mw / 2)); mh = Math.max(2, Math.ceil(mh / 2)); this.mips.push(new THREE.WebGLRenderTarget(mw, mh, opt)); }
  }
  dispose() { for (const k of ['rtMain', 'rtAO', 'rtAO2', 'rtComp']) if (this[k]) { this[k].dispose(); this[k] = null; } (this.mips || []).forEach((m) => m.dispose()); this.mips = []; this.w = 0; }

  /** One frame to `target` (null = canvas). */
  render(scene, camera, target = null) {
    const r = this.r, L = this.look;
    r.setRenderTarget(this.rtMain); r.clear(); r.render(scene, camera);
    // AO
    const aw = this.rtAO.width, ah = this.rtAO.height, u = this.ao.u;
    if (L.ao > 0) {
      u.tDepth.value = this.rtMain.depthTexture; u.uProj.value.copy(camera.projectionMatrix); u.uProjInv.value.copy(camera.projectionMatrixInverse);
      u.uRes.value.set(aw, ah); u.uRadius.value = L.aoRadius; u.uFrame.value = this.frame % 64;
      this.ao.render(r, this.rtAO);
      this.aoBlur.u.tAO.value = this.rtAO.texture; this.aoBlur.u.uDir.value.set(1 / aw, 0); this.aoBlur.render(r, this.rtAO2);
      this.aoBlur.u.tAO.value = this.rtAO2.texture; this.aoBlur.u.uDir.value.set(0, 1 / ah); this.aoBlur.render(r, this.rtAO);
    }
    const c = this.comp.u;
    c.tColor.value = this.rtMain.texture; c.tAO.value = this.rtAO.texture; c.uAO.value = L.ao; c.tDepth.value = this.rtMain.depthTexture;
    c.uInvPV.value.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse); c.uExt.value = L.ext;
    this.comp.render(r, this.rtComp);
    // bloom: progressive downsample, then upsample with additive blending back up the chain
    let prev = this.rtComp;
    for (let i = 0; i < this.mips.length; i++) {
      const m = this.mips[i]; this.down.u.tSrc.value = prev.texture; this.down.u.uTexel.value.set(1 / prev.width, 1 / prev.height); this.down.u.uThresh.value = i === 0 ? L.bloomThresh : 0;
      this.down.render(r, m); prev = m;
    }
    const ac = r.autoClear; r.autoClear = false;
    for (let i = this.mips.length - 1; i > 0; i--) { const s = this.mips[i]; this.up.u.tSrc.value = s.texture; this.up.u.uTexel.value.set(1 / s.width, 1 / s.height); this.up.render(r, this.mips[i - 1]); }
    r.autoClear = ac;
    // grade
    const f = this.final.u, col = (k) => (Array.isArray(L[k]) ? new THREE.Color(...L[k]) : L[k]);
    f.tColor.value = this.rtComp.texture; f.tBloom.value = this.mips[0].texture; f.uExposure.value = L.exposure; f.uBloom.value = (L.bloom / this.mips.length) * 6.0;
    f.uVignette.value = L.vignette; f.uGrain.value = L.grain; f.uSeed.value = (this.frame * 0.37) % 17; f.uSat.value = L.sat; f.uVib.value = L.vib; f.uContrast.value = L.contrast; f.uFade.value = L.fade;
    f.uShadowTint.value.copy(col('shadowTint')); f.uMidTint.value.copy(col('midTint')); f.uHighTint.value.copy(col('highTint')); f.uWB.value.copy(col('wb')); f.uRes.value.set(this.w, this.h);
    this.final.render(r, target);
    this.frame++;
  }
}

/** Hold a frame-time budget by scaling the render resolution (checked once a second, changed at most every 1.5 s).
 *  resize(w, h) is called with the new internal size; draw the canvas at CSS size (setSize(w, h, false) + style 100%).
 *  tick(dt) alone measures the rAF interval: that is capped at the display refresh (16.7 ms at 60 Hz), so it can only
 *  ever scale DOWN on a 60 Hz screen. Pass a measured render time as the second argument (GPU timer query, or
 *  performance.now() around render + gl.finish on a sample of frames) to let it scale back up as well. */
export class AdaptiveRes {
  constructor(resize, { min = 0.5, max = 1, slowMs = 24, fastMs = 12.5, maxWidth = 1600 } = {}) {
    Object.assign(this, { resize, min, max, slowMs, fastMs }); this.scale = Math.min(max, maxWidth / innerWidth); this.acc = 0; this.frames = 0; this.work = 0; this.workN = 0; this.last = 0; this.fit();
    addEventListener('resize', () => this.fit());
  }
  fit() { this.resize(Math.max(320, Math.round(innerWidth * this.scale)), Math.max(180, Math.round(innerHeight * this.scale))); }
  /** Call every frame: dt in seconds; renderMs (optional) = measured cost of this frame's rendering. */
  tick(dt, renderMs = null) {
    this.acc += dt; this.frames++;
    if (renderMs != null) { this.work += renderMs; this.workN++; }
    if (this.acc < 1) return;
    const ms = this.workN ? this.work / this.workN : (this.acc / this.frames) * 1000, now = performance.now();
    this.acc = 0; this.frames = 0; this.work = 0; this.workN = 0; this.ms = ms;
    if (now - this.last < 1500) return;
    if (ms > this.slowMs && this.scale > this.min) { this.scale = Math.max(this.min, this.scale * 0.88); this.last = now; this.fit(); }
    else if (ms < this.fastMs && this.scale < this.max) { this.scale = Math.min(this.max, this.scale * 1.08); this.last = now; this.fit(); }
  }
}
