// Offline "film quality" frames for three.js: average N jittered sub-frames per frame.
//   - anti-aliasing: sub-pixel jitter of the projection (Halton 2,3)
//   - depth of field: thin lens — the eye moves over the aperture disc (Halton 5,7) and the projection is sheared so
//     the focus plane stays put
//   - motion blur: each sub-frame samples its own time inside the shutter (180° = half a frame)
// The sum is kept in a float target (scene-linear HDR), then graded once: SDR (ACES + sRGB, 8-bit) and/or
// HDR10 (BT.2020 primaries, PQ, 16-bit readback for a 10-bit encode).
// Adapted from room-at-dawn (MIT, github.com/Leonxlnx/room-at-dawn) src/main.js makePrep, src/render/pipeline.js
// renderAccum/present and src/render/film.js.
import * as THREE from 'three';

export const halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };

const QUAD_VS = /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const GRADE_FS = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tAcc; uniform float uExposure, uFade, uPeak; uniform int uMode;   // 0 SDR sRGB, 1 HDR10 PQ
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
vec3 srgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
vec3 pq(vec3 nits) { vec3 y = pow(clamp(nits / 10000.0, 0.0, 1.0), vec3(0.1593017578125)); return pow((0.8359375 + 18.8515625 * y) / (1.0 + 18.6875 * y), vec3(78.84375)); }
void main() {
  vec3 c = texture2D(tAcc, vUv).rgb;
  c = (c == c) ? max(c, 0.0) : vec3(0.0);                 // NaN guard: one bad sub-frame must not poison the frame
  c *= uExposure * uFade;
  if (uMode == 0) { gl_FragColor = vec4(srgb(aces(c)), 1.0); return; }
  // HDR10: scene-linear 1.0 = SDR reference white (203 nits); soft roll-off towards the display peak
  c = mat3(0.6274, 0.0691, 0.0164, 0.3293, 0.9195, 0.0880, 0.0433, 0.0114, 0.8956) * c;   // BT.709 -> BT.2020
  vec3 n = c * 203.0, k = vec3(uPeak * 0.6);
  n = mix(n, k + (uPeak - k) * (1.0 - exp(-(n - k) / (uPeak - k))), step(k, n));
  gl_FragColor = vec4(pq(n), 1.0);
}`;
const ADD_FS = /* glsl */`precision highp float; varying vec2 vUv; uniform sampler2D tSrc; uniform float uW;
void main() { vec3 c = texture2D(tSrc, vUv).rgb; gl_FragColor = vec4((c == c) ? c * uW : vec3(0.0), 1.0); }`;

export class Accumulator {
  /** renderer must have antialias off for offline use (the jitter does the AA). */
  constructor(renderer, scene, camera) {
    this.r = renderer; this.scene = scene; this.camera = camera;
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.addMat = new THREE.ShaderMaterial({ vertexShader: QUAD_VS, fragmentShader: ADD_FS, uniforms: { tSrc: { value: null }, uW: { value: 1 } },
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation, depthTest: false, depthWrite: false, transparent: true });
    this.gradeMat = new THREE.ShaderMaterial({ vertexShader: QUAD_VS, fragmentShader: GRADE_FS, depthTest: false, depthWrite: false,
      uniforms: { tAcc: { value: null }, uExposure: { value: 1 }, uFade: { value: 1 }, uPeak: { value: 1000 }, uMode: { value: 0 } } });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.addMat); this.quad.frustumCulled = false;
    this.quadScene = new THREE.Scene(); this.quadScene.add(this.quad);
    this.w = 0; this.h = 0;
  }
  setSize(w, h) {
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    for (const k of ['rtMain', 'rtAcc', 'rtSdr', 'rtHdr']) this[k]?.dispose();
    this.rtMain = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: true, samples: 0 });
    this.rtAcc = new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType, depthBuffer: false });
    this.rtSdr = new THREE.WebGLRenderTarget(w, h, { type: THREE.UnsignedByteType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.rtHdr = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  }
  /**
   * Accumulate one frame.
   * o.t        frame time (s)       o.onTime(t)  sets the whole world (and the camera pose, for camera motion blur) to time t
   * o.n        sub-frames           o.shutter    shutter open time in seconds (180° at 30 fps = 1/60)
   * o.aperture lens radius (m)      o.focus      focus distance along the view axis (m)
   */
  accumulate({ t, n = 16, onTime, shutter = 0, aperture = 0, focus = 3 }) {
    const r = this.r, cam = this.camera, right = new THREE.Vector3(), up = new THREE.Vector3();
    const prevRT = r.getRenderTarget(), ac = r.autoClear;
    r.setRenderTarget(this.rtAcc); r.setClearColor(0x000000, 1); r.clear();
    for (let i = 0; i < n; i++) {
      const ts = t + shutter * (n > 1 ? (i + 0.5) / n - 0.5 : 0);
      onTime(ts);                                                   // world + camera at this instant
      cam.updateMatrixWorld(true);
      let lx = 0, ly = 0;
      if (aperture > 0) {                                            // thin lens: move the eye over the aperture disc
        const a = halton(i + 1, 5) * Math.PI * 2, rr = Math.sqrt(halton(i + 1, 7)) * aperture;
        lx = Math.cos(a) * rr; ly = Math.sin(a) * rr;
        right.setFromMatrixColumn(cam.matrixWorld, 0); up.setFromMatrixColumn(cam.matrixWorld, 1);
        cam.position.addScaledVector(right, lx).addScaledVector(up, ly); cam.updateMatrixWorld(true);
      }
      cam.updateProjectionMatrix();
      const m = cam.projectionMatrix.elements, jx = halton(i + 1, 2) - 0.5, jy = halton(i + 1, 3) - 0.5;
      m[8] += (2 * jx) / this.w - (m[0] * lx) / focus;              // sub-pixel AA + shear that keeps the focus plane sharp
      m[9] += (2 * jy) / this.h - (m[5] * ly) / focus;
      cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
      r.autoClear = true; r.setRenderTarget(this.rtMain); r.render(this.scene, cam);
      this.quad.material = this.addMat; this.addMat.uniforms.tSrc.value = this.rtMain.texture; this.addMat.uniforms.uW.value = 1 / n;
      r.autoClear = false; r.setRenderTarget(this.rtAcc); r.render(this.quadScene, this.quadCam);
    }
    onTime(t); cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);   // leave the camera clean
    r.autoClear = ac; r.setRenderTarget(prevRT);
  }
  /** Grade the accumulated frame. mode 'screen' | 'sdr' (8-bit target) | 'hdr' (PQ in a half-float target). */
  present(mode = 'screen', { exposure = 1, fade = 1, peak = 1000 } = {}) {
    const u = this.gradeMat.uniforms; u.tAcc.value = this.rtAcc.texture; u.uExposure.value = exposure; u.uFade.value = fade; u.uPeak.value = peak;
    u.uMode.value = mode === 'hdr' ? 1 : 0;
    const prev = this.r.getRenderTarget(), tm = this.r.toneMapping;
    this.r.toneMapping = THREE.NoToneMapping;                        // the grade does it
    this.quad.material = this.gradeMat;
    const target = mode === 'screen' ? null : mode === 'hdr' ? this.rtHdr : this.rtSdr;
    this.r.setRenderTarget(target); this.r.render(this.quadScene, this.quadCam);
    this.r.setRenderTarget(prev); this.r.toneMapping = tm;
    return target;
  }
  /** Read back: 'sdr' -> Uint8Array RGBA, 'hdr' -> Uint16Array RGBA 0..65535 (PQ code values). Rows are bottom-up (ffmpeg: -vf vflip). */
  read(mode, out) {
    const rt = mode === 'hdr' ? this.rtHdr : this.rtSdr;
    out = out || (mode === 'hdr' ? new Uint16Array(this.w * this.h * 4) : new Uint8Array(this.w * this.h * 4));
    this.r.readRenderTargetPixels(rt, 0, 0, this.w, this.h, out);
    if (mode === 'hdr') { const L = halfLut(); for (let i = 0; i < out.length; i++) out[i] = L[out[i]]; }
    return out;
  }
}
let LUT = null;
/** half-float bits -> 16-bit unsigned (0..1 -> 0..65535), NaN/Inf -> 0. */
export function halfLut() {
  if (LUT) return LUT;
  LUT = new Uint16Array(65536);
  for (let i = 0; i < 65536; i++) { const v = THREE.DataUtils.fromHalfFloat(i); LUT[i] = Number.isFinite(v) ? Math.round(Math.min(1, Math.max(0, v)) * 65535) : 0; }
  return LUT;
}

// ---------------------------------------------------------------- shot list
const catmull = (p0, p1, p2, p3, t) => { const t2 = t * t, t3 = t2 * t; return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3); };
/**
 * shots: [{ name, dur, samples, exp, keys: [{ pos, target, focus, fov, ap /* lens radius in mm *\/ }] }]
 * Returns film-time -> camera state, plus frame ranges. Fades in over the first `fadeIn`, out over the last `fadeOut` seconds.
 */
export function shotList(shots, { fadeIn = 1.6, fadeOut = 1.8 } = {}) {
  const total = shots.reduce((s, x) => s + x.dur, 0);
  const sample = (keys, u) => {
    const n = keys.length - 1, x = Math.min(n - 1e-6, Math.max(0, u * n)), i = Math.floor(x), t = x - i, k = (j) => keys[Math.min(n, Math.max(0, j))];
    const arr = (nm) => [0, 1, 2].map((c) => catmull(k(i - 1)[nm][c], k(i)[nm][c], k(i + 1)[nm][c], k(i + 2)[nm][c], t));
    const num = (nm) => k(i)[nm] + (k(i + 1)[nm] - k(i)[nm]) * t;
    return { pos: arr('pos'), target: arr('target'), focus: arr('focus'), fov: num('fov'), ap: num('ap') };
  };
  return {
    shots, total,
    /** camera state at film time t */
    at(t) {
      let acc = 0;
      for (let s = 0; s < shots.length; s++) {
        const sh = shots[s];
        if (t < acc + sh.dur || s === shots.length - 1) {
          const u = Math.min(1, Math.max(0, (t - acc) / sh.dur));
          let fade = 1;
          if (s === 0 && fadeIn > 0) fade = Math.min(1, t / fadeIn);
          if (s === shots.length - 1 && fadeOut > 0) fade = Math.min(fade, Math.max(0, (total - t) / fadeOut));
          fade = fade * fade * (3 - 2 * fade);
          return { shot: s, name: sh.name, local: t - acc, ...sample(sh.keys, u), fade, exp: sh.exp || 1, samples: sh.samples };
        }
        acc += sh.dur;
      }
    },
    ranges(fps) { let a = 0; return shots.map((s, i) => { const r = { shot: i, name: s.name, from: Math.round(a * fps), to: Math.round((a + s.dur) * fps) }; a += s.dur; return r; }); },
  };
}
/** Point the camera for a shot state; returns the focus distance along the view axis. */
export function applyShotCamera(camera, st) {
  camera.position.fromArray(st.pos); camera.fov = st.fov; camera.up.set(0, 1, 0);
  camera.lookAt(new THREE.Vector3().fromArray(st.target)); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd);
  return Math.max(0.15, new THREE.Vector3().fromArray(st.focus).sub(camera.position).dot(fwd));
}

// ---------------------------------------------------------------- frame upload to film-server.mjs (-> ffmpeg)
async function post(path, body, timeout = 120000) {
  const ac = new AbortController(), to = setTimeout(() => ac.abort(), timeout);
  try { const r = await fetch(path, { method: 'POST', body, signal: ac.signal }); if (!r.ok) throw new Error(path + ' -> ' + (await r.text())); return r; }
  finally { clearTimeout(to); }
}
/** Start an ffmpeg process on the server. args = ffmpeg argv (input is raw frames on stdin). */
export const ffStart = (id, args) => post(`/api/ff/start?id=${id}`, JSON.stringify(args));
/** Send one frame. Blob bodies go to Chrome's network process by reference (~9x faster than a typed array for 66 MB). */
export async function ffFrame(id, seq, arr) {
  const url = `/api/ff/frame?id=${id}&seq=${seq}`;
  try { return await post(url, new Blob([arr])); } catch (e) { /* blob store full or socket hiccup */ }
  for (let attempt = 0; ; attempt++) {
    if (window.gc) window.gc();
    await new Promise((r) => setTimeout(r, 300));
    try { return await post(url, arr); } catch (e) { if (attempt >= 3) throw e; }
  }
}
export const ffEnd = async (id) => (await (await post(`/api/ff/end?id=${id}`, '', 600000)).json());

/** ffmpeg argv for the fast intermediates (re-encoded slowly at the end by render-film.mjs). */
export function ffArgs(kind, { w, h, fps, file, threads = 8 }) {
  const input = ['-y', '-f', 'rawvideo', '-pix_fmt', kind === 'hdr' ? 'rgba64le' : 'rgba', '-s', `${w}x${h}`, '-r', String(fps), '-i', '-'];
  if (kind === 'hdr') return [...input, '-vf', 'vflip,zscale=matrix=2020_ncl:range=limited,format=yuv420p10le', '-c:v', 'libx265', '-preset', 'ultrafast', '-crf', '8', '-pix_fmt', 'yuv420p10le',
    '-color_primaries', 'bt2020', '-color_trc', 'smpte2084', '-colorspace', 'bt2020nc', '-color_range', 'tv',
    '-x265-params', `pools=${threads}:repeat-headers=1:colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc:range=limited:log-level=error`, '-tag:v', 'hvc1', file];
  // scale=out_color_matrix=bt709: swscale's default RGB->YUV matrix is BT.601, which would not match the BT.709 tags
  return [...input, '-vf', 'vflip,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '8', '-threads', String(threads), '-pix_fmt', 'yuv420p', '-x264-params', 'colorprim=bt709:transfer=bt709:colormatrix=bt709',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', file];
}
