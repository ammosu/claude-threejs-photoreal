// Deterministic randomness, noise, small vector helpers. Adapted from room-at-dawn (MIT) src/core/rng.js.
import * as THREE from 'three';
export const TAU = Math.PI * 2, UP = [0, 1, 0], Z4 = [0, 0, 0, 0];
function mulberry32(a) {
  return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export class RNG {
  constructor(seed = 1) { this.f = mulberry32(seed); }
  next() { return this.f(); }
  range(a, b) { return a + (b - a) * this.f(); }
  int(a, b) { return Math.floor(this.range(a, b + 1)); }
  chance(p) { return this.f() < p; }
  sign() { return this.f() < 0.5 ? -1 : 1; }
  gauss() { let u = 0; while (u === 0) u = this.f(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * this.f()); }
}
export const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export function hash2(ix, iy, seed) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const mod = (a, n) => ((a % n) + n) % n;
export function vnoise2(x, y, seed = 0, period = 0) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  let x0 = ix, x1 = ix + 1, y0 = iy, y1 = iy + 1;
  if (period) { x0 = mod(x0, period); x1 = mod(x1, period); y0 = mod(y0, period); y1 = mod(y1, period); }
  const a = hash2(x0, y0, seed), b = hash2(x1, y0, seed), c = hash2(x0, y1, seed), d = hash2(x1, y1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
/** fBm of value noise, 0..1. period > 0 tiles every `period` base cells (doubles per octave). */
export function fbm2(x, y, { oct = 4, seed = 0, period = 0 } = {}) {
  let a = 0.5, s = 0, n = 0, f = 1;
  for (let i = 0; i < oct; i++) { s += a * vnoise2(x * f, y * f, seed + i * 17, period ? period * f : 0); n += a; a *= 0.5; f *= 2; }
  return s / n;
}
// vectors as [x, y, z] arrays (fast, no allocations of THREE objects in the growth loops)
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const madd = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
export const nrm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const mix3 = (a, b, t, k = 1) => [(a[0] + (b[0] - a[0]) * t) * k, (a[1] + (b[1] - a[1]) * t) * k, (a[2] + (b[2] - a[2]) * t) * k];

export function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
/** RGBA8 DataTexture. srgb: colour data; wrap: repeat (else clamp). */
export function dataTex(data, w, h, { srgb = false, wrap = true } = {}) {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 8; t.needsUpdate = true;
  return t;
}
/** Height field (wrapping) -> RGBA8 tangent-space normal bytes. k = slope gain. */
export function normalData(H, w, h, k) {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (H[y * w + ((x + 1) % w)] - H[y * w + ((x + w - 1) % w)]) * 0.5 * k, dy = (H[((y + 1) % h) * w + x] - H[((y + h - 1) % h) * w + x]) * 0.5 * k;
    const il = 1 / Math.hypot(dx, dy, 1), i = (y * w + x) * 4;
    out[i] = (-dx * il * 0.5 + 0.5) * 255; out[i + 1] = (-dy * il * 0.5 + 0.5) * 255; out[i + 2] = (il * 0.5 + 0.5) * 255; out[i + 3] = 255;
  }
  return out;
}
