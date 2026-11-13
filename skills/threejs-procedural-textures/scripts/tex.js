// Procedural texture plumbing for three.js: deterministic noise that TILES, height fields in millimetres ->
// normal maps, packing, Canvas2D -> texture, the mean albedo (for light bakes), and a seam check.
// Adapted from room-at-dawn (MIT, github.com/Leonxlnx/room-at-dawn) src/core/tex.js, src/core/rng.js and
// src/scene/materials.js.
import * as THREE from 'three';

// ------------------------------------------------------------------ randomness (never Math.random)
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export class RNG {
  constructor(seed = 1) { this.f = mulberry32(seed); }
  next() { return this.f(); }
  range(a, b) { return a + (b - a) * this.f(); }
  int(a, b) { return Math.floor(this.range(a, b + 1)); }
  pick(arr) { return arr[Math.floor(this.f() * arr.length)]; }
  chance(p) { return this.f() < p; }
  sign() { return this.f() < 0.5 ? -1 : 1; }
  gauss() { let u = 0; while (u === 0) u = this.f(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.f()); }
}
export const TAU = Math.PI * 2;
export const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const sm01 = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
export const lin = (c) => Math.pow(c, 2.2);
export function hash2(ix, iy, seed = 0) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const mod = (a, n) => ((a % n) + n) % n;

// ------------------------------------------------------------------ noise that tiles
/** Value noise 0..1 (quintic fade). px / py > 0: tiles every px / py lattice cells (separately per axis). */
export function pnoise(x, y, seed = 0, px = 0, py = px) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  let x0 = ix, x1 = ix + 1, y0 = iy, y1 = iy + 1;
  if (px) { x0 = mod(x0, px); x1 = mod(x1, px); }
  if (py) { y0 = mod(y0, py); y1 = mod(y1, py); }
  const a = hash2(x0, y0, seed), b = hash2(x1, y0, seed), c = hash2(x0, y1, seed), d = hash2(x1, y1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
/** fbm 0..1 of pnoise; the period doubles with every octave, so it tiles if px / py are whole numbers. */
export function pfbm(x, y, oct = 4, seed = 0, px = 0, py = px) {
  let a = 0.5, s = 0, n = 0, f = 1;
  for (let i = 0; i < oct; i++) { s += a * pnoise(x * f, y * f, seed + i * 17, px * f, py * f); n += a; a *= 0.5; f *= 2; }
  return s / n;
}
/** Cellular noise: [f1, f2, cellId]; tiles with period. */
export function worley(x, y, seed = 0, period = 0) {
  const ix = Math.floor(x), iy = Math.floor(y); let f1 = 9, f2 = 9, id = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = ix + i, cy = iy + j, hx = period ? mod(cx, period) : cx, hy = period ? mod(cy, period) : cy;
    const d = Math.hypot(cx + hash2(hx, hy, seed) - x, cy + hash2(hx, hy, seed + 101) - y);
    if (d < f1) { f2 = f1; f1 = d; id = hash2(hx, hy, seed + 202); } else if (d < f2) f2 = d;
  }
  return [f1, f2, id];
}
/** Very fast table value noise 0..1 (smoothstep fade), period 256 on both axes. For inner loops of 2048² maps. */
const LAT = new Float32Array(65536);
{ const r = new RNG(90210); for (let i = 0; i < 65536; i++) LAT[i] = r.next(); }
export function vn(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y); let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const x0 = ix & 255, x1 = (ix + 1) & 255, r0 = (iy & 255) << 8, r1 = ((iy + 1) & 255) << 8;
  const a = LAT[r0 | x0], b = LAT[r0 | x1], c = LAT[r1 | x0], d = LAT[r1 | x1];
  return a + (b - a) * fx + (c - a + (a - b - c + d) * fx) * fy;
}

// ------------------------------------------------------------------ fields and textures
/** Float32 field from fn(u, v, x, y), u/v in 0..1. */
export function field(w, h, fn) {
  const H = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) H[y * w + x] = fn(x / w, y / h, x, y);
  return H;
}
/** Height field -> RGBA8 tangent-space normals. Give H in mm and the texel size in mm (pxMm, pyMm): then the
 *  slopes are physical and the same code works at any resolution. Wraps. */
export function normalBytes(H, w, h, pxMm, pyMm = pxMm) {
  const out = new Uint8Array(w * h * 4), kx = 0.5 / pxMm, ky = 0.5 / pyMm;
  for (let y = 0; y < h; y++) {
    const ym = (y === 0 ? h - 1 : y - 1) * w, yp = (y === h - 1 ? 0 : y + 1) * w, yo = y * w;
    for (let x = 0; x < w; x++) {
      const dx = (H[yo + (x === w - 1 ? 0 : x + 1)] - H[yo + (x === 0 ? w - 1 : x - 1)]) * kx, dy = (H[yp + x] - H[ym + x]) * ky;
      const il = 1 / Math.sqrt(dx * dx + dy * dy + 1), i = (yo + x) * 4;
      out[i] = (-dx * il * 0.5 + 0.5) * 255 + 0.5; out[i + 1] = (-dy * il * 0.5 + 0.5) * 255 + 0.5; out[i + 2] = (il * 0.5 + 0.5) * 255 + 0.5; out[i + 3] = 255;
    }
  }
  return out;
}
/** Same, with a unitless strength (height units per texel). For stylised maps where H is 0..1. */
export const normalData = (H, w, h, strength = 1) => normalBytes(H, w, h, 1 / strength, 1 / strength);

export let MAX_ANISO = 8;
export function setMaxAniso(n) { MAX_ANISO = n; }
function finish(t, { srgb = false, repeat = null, aniso = MAX_ANISO, wrap = true, flipY = false, mip = true } = {}) {
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.generateMipmaps = mip; t.minFilter = mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter; t.magFilter = THREE.LinearFilter;
  t.anisotropy = aniso; t.flipY = flipY;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  t.needsUpdate = true; return t;
}
export const dataTex = (data, w, h, opts) => finish(new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType), opts);
export const canvasTex = (canvas, opts = {}) => finish(new THREE.CanvasTexture(canvas), { flipY: true, ...opts });
export const normalTex = (H, w, h, strength, opts = {}) => dataTex(normalData(H, w, h, strength), w, h, opts);
/** Up to three 0..1 fields into one RGBA8 texture (three.js reads roughness from G, metalness from B, AO from R). */
export function packTex(w, h, r, g, b, opts) {
  const out = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { out[i * 4] = r ? r[i] * 255 : 255; out[i * 4 + 1] = g ? g[i] * 255 : 255; out[i * 4 + 2] = b ? b[i] * 255 : 255; out[i * 4 + 3] = 255; }
  return dataTex(out, w, h, opts);
}
/** sRGB colour texture from fn(u, v, x, y) -> [r, g, b(, a)] in 0..1. */
export function colorTex(w, h, fn, opts = {}) {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = fn(x / w, y / h, x, y), i = (y * w + x) * 4;
    out[i] = c[0] * 255; out[i + 1] = c[1] * 255; out[i + 2] = c[2] * 255; out[i + 3] = c.length > 3 ? c[3] * 255 : 255;
  }
  return dataTex(out, w, h, { srgb: true, ...opts });
}
export function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
/** Mean LINEAR colour of RGBA8 sRGB data (every 4th texel): the albedo a light baker should bounce. */
export function avgColor(data) {
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < data.length; i += 16) { r += lin(data[i] / 255); g += lin(data[i + 1] / 255); b += lin(data[i + 2] / 255); n++; }
  return [r / n, g / n, b / n];
}
/** Build a texture once per key (several materials share one map; clone() + repeat for different scales). */
const cache = new Map();
export function once(key, fn) { if (!cache.has(key)) cache.set(key, fn()); return cache.get(key); }
/** A clone with its own repeat / offset (shares the image, no re-upload). */
export function rep(t, rx, ry = rx, ox = 0, oy = 0) { const c = t.clone(); c.repeat.set(rx, ry); c.offset.set(ox, oy); c.needsUpdate = true; return c; }

// ------------------------------------------------------------------ checks
/** Seam score of RGBA8 data that is meant to tile: mean |difference| across the wrap edge divided by the mean
 *  |difference| between two neighbouring interior columns/rows, both in 0..255 levels with +1 added so that maps that are
 *  almost flat in one direction (wood along the grain) do not produce huge ratios from sub-level noise.
 *  ~1 = seamless; > 2 means look at the map tiled 2 x 2. */
export function seamScore(data, w, h, ch = 0) {
  const at = (x, y) => data[(y * w + x) * 4 + ch];
  let ex = 0, ix = 0, ey = 0, iy = 0;
  for (let y = 0; y < h; y++) { ex += Math.abs(at(w - 1, y) - at(0, y)); ix += Math.abs(at(w >> 1, y) - at((w >> 1) - 1, y)); }
  for (let x = 0; x < w; x++) { ey += Math.abs(at(x, h - 1) - at(x, 0)); iy += Math.abs(at(x, h >> 1) - at(x, (h >> 1) - 1)); }
  return { x: +((ex / h + 1) / (ix / h + 1)).toFixed(2), y: +((ey / w + 1) / (iy / w + 1)).toFixed(2) };
}
/** RGBA8 data of any texture made here (DataTexture or CanvasTexture). */
export function texData(t) {
  const im = t.image;
  if (im.data) return { data: im.data, w: im.width, h: im.height };
  const c = im.getContext ? im : (() => { const k = makeCanvas(im.width, im.height); k.getContext('2d').drawImage(im, 0, 0); return k; })();
  return { data: c.getContext('2d').getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height };
}
