// Procedural "designed" cloth for three.js — no simulation.
// A cloth is a dense grid in flat sheet coordinates whose height above its support is DESIGNED:
// lobes (rolls) + directional pillowy folds -> peak erosion -> individually rasterised creases,
// then wrapped over the support (drape), tall folds lean, a corner can page-curl, and UVs are relaxed
// against the final 3D surface.
//
// Adapted from room-at-dawn (MIT, github.com/Leonxlnx/room-at-dawn) src/scene/parts/bed.js + src/core/rng.js.
// Units: metres. Sheet coords (x, z) are horizontal; elevation e is height above the support.
import * as THREE from 'three';

export const TAU = Math.PI * 2, HP = Math.PI / 2;

// ------------------------------------------------------------------ deterministic randomness
// Never Math.random(): same seed -> same cloth (needed for baked lighting, screenshots, regressions).
function mulberry32(a) {
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
/** Value noise 0..1 (quintic fade). px/py > 0 make it tile every px/py lattice cells. */
export function pn(x, y, seed, px = 0, py = 0) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  let x0 = ix, x1 = ix + 1, y0 = iy, y1 = iy + 1;
  if (px) { x0 = mod(x0, px); x1 = mod(x1, px); }
  if (py) { y0 = mod(y0, py); y1 = mod(y1, py); }
  const a = hash2(x0, y0, seed), b = hash2(x1, y0, seed), c = hash2(x0, y1, seed), d = hash2(x1, y1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
/** "Billow": round tops, sharp valleys — the basic shape of filled cloth. */
export const bill = (n) => { const b = Math.abs(2 * n - 1); return 1 - (1 - b) * (1 - b); };
export const ridge = (n) => 1 - Math.abs(2 * n - 1);
/** Smooth max (k = blend width). Joins lobes without a kink. */
export const smax = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + h * h * k * 0.25; };
/** Rounded edge profile: 0 at the hem, 1 from `w` inwards, vertical tangent at the hem. */
export const prof = (d, w) => { if (d <= 0) return 0; if (d >= w) return 1; const t = 1 - d / w; return Math.pow(1 - t * t, 0.6); };
/** Soft ceiling: values above `cap` approach cap + k. Keeps the tallest bunch believable. */
export const softCap = (H, cap, k) => (H > cap ? cap + k * Math.tanh((H - cap) / k) : H);

// ------------------------------------------------------------------ float fields
/** Bilinear sample of a w x h field at texel coordinates (clamped). */
export function bil(F, w, h, fx, fy) {
  fx = fx < 0 ? 0 : fx > w - 1.001 ? w - 1.001 : fx; fy = fy < 0 ? 0 : fy > h - 1.001 ? h - 1.001 : fy;
  const ix = fx | 0, iy = fy | 0, tx = fx - ix, ty = fy - iy, k = iy * w + ix, a = F[k] + (F[k + 1] - F[k]) * tx, b = F[k + w] + (F[k + w + 1] - F[k + w]) * tx;
  return a + (b - a) * ty;
}
/** Catmull-Rom sample (continuous slope — use it for the coarse shape, or the mesh shows grid facets). */
export function cubicAt(F, w, h, fx, fy) {
  fx = fx < 1 ? 1 : fx > w - 2.001 ? w - 2.001 : fx; fy = fy < 1 ? 1 : fy > h - 2.001 ? h - 2.001 : fy;
  const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
  const a0 = ((-0.5 * tx + 1) * tx - 0.5) * tx, a1 = (1.5 * tx - 2.5) * tx * tx + 1, a2 = ((-1.5 * tx + 2) * tx + 0.5) * tx, a3 = (0.5 * tx - 0.5) * tx * tx;
  const b0 = ((-0.5 * ty + 1) * ty - 0.5) * ty, b1 = (1.5 * ty - 2.5) * ty * ty + 1, b2 = ((-1.5 * ty + 2) * ty + 0.5) * ty, b3 = (0.5 * ty - 0.5) * ty * ty;
  const row = (k) => F[k - 1] * a0 + F[k] * a1 + F[k + 1] * a2 + F[k + 2] * a3, k = iy * w + ix;
  return row(k - w) * b0 + row(k) * b1 + row(k + w) * b2 + row(k + 2 * w) * b3;
}
export function boxBlurClamp(src, w, h, r) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h), n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const o = y * w; let s = 0;
    for (let k = -r; k <= r; k++) s += src[o + (k < 0 ? 0 : k >= w ? w - 1 : k)];
    for (let x = 0; x < w; x++) { tmp[o + x] = s / n; const a = x + r + 1, b = x - r; s += src[o + (a >= w ? w - 1 : a)] - src[o + (b < 0 ? 0 : b)]; }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += tmp[(k < 0 ? 0 : k >= h ? h - 1 : k) * w + x];
    for (let y = 0; y < h; y++) { out[y * w + x] = s / n; const a = y + r + 1, b = y - r; s += tmp[(a >= h ? h - 1 : a) * w + x] - tmp[(b < 0 ? 0 : b) * w + x]; }
  }
  return out;
}
export function boxBlurWrap(src, w, h, rx, ry) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const o = y * w; let s = 0;
    for (let k = -rx; k <= rx; k++) s += src[o + ((k + w) % w)];
    for (let x = 0; x < w; x++) { tmp[o + x] = s / (2 * rx + 1); s += src[o + ((x + rx + 1) % w)] - src[o + ((x - rx + w) % w)]; }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let k = -ry; k <= ry; k++) s += tmp[((k + h) % h) * w + x];
    for (let y = 0; y < h; y++) { out[y * w + x] = s / (2 * ry + 1); s += tmp[((y + ry + 1) % h) * w + x] - tmp[((y - ry + h) % h) * w + x]; }
  }
  return out;
}

/** A regular grid over sheet coordinates. h = cell size (m). */
export class Field {
  constructor(x0, z0, x1, z1, h) {
    this.x0 = x0; this.z0 = z0; this.h = h;
    this.nx = Math.ceil((x1 - x0) / h) + 1; this.nz = Math.ceil((z1 - z0) / h) + 1;
    this.data = new Float32Array(this.nx * this.nz);
  }
  fill(fn) { const { nx, nz, x0, z0, h, data } = this; for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) data[j * nx + i] = fn(x0 + i * h, z0 + j * h); return this; }
  /** Multiply every non-zero cell by fn(x, z). */
  scale(fn) { const { nx, nz, x0, z0, h, data } = this; for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const k = j * nx + i; if (data[k] !== 0) data[k] *= fn(x0 + i * h, z0 + j * h); } return this; }
  cubic(x, z) { return cubicAt(this.data, this.nx, this.nz, (x - this.x0) / this.h, (z - this.z0) / this.h); }
  bil(x, z) { return bil(this.data, this.nx, this.nz, (x - this.x0) / this.h, (z - this.z0) / this.h); }
  /** Filled cloth has no peaks: nothing may stand more than ~cap above its blurred surroundings. Valleys stay sharp. */
  erodePeaks(radiusCells = 5, cap = 0.012) {
    let bl = boxBlurClamp(this.data, this.nx, this.nz, radiusCells); bl = boxBlurClamp(bl, this.nx, this.nz, radiusCells);
    for (let k = 0; k < this.data.length; k++) this.data[k] = -smax(-this.data[k], -(bl[k] + cap), cap);
    return this;
  }
}

// ------------------------------------------------------------------ shape: lobes and folds
/**
 * Lobes = the big masses of a slept-in duvet: rolls, bunches, shoulders. Each is an ellipse
 * [cx, cz, semiAxisA, semiAxisB, angleDeg, height]. Profile: broad rounded top, steep sides (a roll, not a cone).
 * Place them by hand and name them in comments ("the big roll across the bed", "pushed against the wall").
 */
export function makeLobes(list, scale = 1) {
  return list.map(([cx, cz, a, b, deg, h]) => ({ cx, cz, ia: 1 / a, ib: 1 / b, c: Math.cos((deg * Math.PI) / 180), s: Math.sin((deg * Math.PI) / 180), h: h * scale, a, b, deg }));
}
/** Height of the lobe field at (x, z). Tall lobes (> grooveAbove) get grooves along their length: a bunch is a few rolls pressed together. */
export function lobesAt(lobes, x, z, { blend = 0.009, grooveAbove = 0.09, seed = 160 } = {}) {
  let M = 0;
  for (let i = 0; i < lobes.length; i++) {
    const L = lobes[i], dx = x - L.cx, dz = z - L.cz, u = (dx * L.c + dz * L.s) * L.ia, v = (-dx * L.s + dz * L.c) * L.ib, r2 = u * u + v * v;
    if (r2 >= 1) continue;
    const sub = L.h > grooveAbove ? 0.8 + 0.3 * bill(pn(u * 0.9 + i * 7.1, v * 1.7 + i * 3.7, seed + i)) : 1;
    M = smax(M, L.h * (1 - r2 * Math.sqrt(r2)) * Math.pow(1 - r2, 0.35) * sub, blend);
  }
  return M;
}
/**
 * A family of long pillowy folds running along `angleDeg`. along = how long a fold runs (m),
 * across = spacing between folds (m). Returns ~0..1.4 (billowy main folds + a finer secondary set).
 */
export function foldFamily({ angleDeg, along = 0.6, across = 0.12, seed = 111 }) {
  const a = (angleDeg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return (x, z) => {
    const u = x * c + z * s, v = -x * s + z * c;
    const b = Math.abs(2 * pn(u / along + 1.3, v / across + 0.4, seed) - 1);
    return 1 - (1 - b) * (1 - b) + 0.4 * bill(pn(u / (along * 0.4) + v * 1.1, v / (across * 0.48) + 7.7, seed + 1));
  };
}

// ------------------------------------------------------------------ creases (not noise!)
// One crease = a soft tent along a slightly bent line: rounded crest, concave flanks, dies away at both ends.
const PROF_N = 256, CR_PROF = new Float32Array(PROF_N + 2), CR_ENV = new Float32Array(PROF_N + 2);
for (let i = 0; i <= PROF_N + 1; i++) {
  const t = Math.min(1, i / PROF_N), r = 0.22;
  CR_PROF[i] = Math.exp(-(Math.sqrt(t * t + r * r) - r) * 4.2) * (1 - t * t) * (1 - t * t);
  CR_ENV[i] = Math.pow(Math.max(0, Math.sin(Math.PI * Math.pow(t, 0.8))), 0.75);
}
/** Add a crease to field F (w x h, texel units) from (x0,y0) along `ang` for length L. R = half footprint width,
 *  A = height (negative = a groove), bend = sideways bow as a fraction of L/4. wrap needs power-of-two w, h. */
export function crease(F, w, h, wrap, x0, y0, ang, L, R, A, bend = 0) {
  const cx = Math.cos(ang), cy = Math.sin(ang), x1 = x0 + cx * L, y1 = y0 + cy * L, m = R + Math.abs(bend) * L * 0.25 + 1;
  const ya = Math.floor(Math.min(y0, y1) - m), yb = Math.ceil(Math.max(y0, y1) + m), xa = Math.floor(Math.min(x0, x1) - m), xb = Math.ceil(Math.max(x0, x1) + m);
  const iL = 1 / L, iR = PROF_N / R, bl = bend * L;
  for (let y = ya; y <= yb; y++) {
    if (!wrap && (y < 0 || y >= h)) continue;
    const dy = y - y0, row = (wrap ? y & (h - 1) : y) * w;
    let lo = xa, hi = xb;
    if (cy > 1e-3 || cy < -1e-3) { const p = x0 + (dy * cx - m) / cy, q = x0 + (dy * cx + m) / cy; lo = Math.max(lo, Math.floor(Math.min(p, q))); hi = Math.min(hi, Math.ceil(Math.max(p, q))); }
    if (!wrap) { if (lo < 0) lo = 0; if (hi > w - 1) hi = w - 1; }
    for (let x = lo; x <= hi; x++) {
      const dx = x - x0, s = (dx * cx + dy * cy) * iL;
      if (s <= 0 || s >= 1) continue;
      let d = dy * cx - dx * cy - bl * s * (1 - s);
      if (d < 0) d = -d;
      const fs = s * PROF_N, is = fs | 0, env = CR_ENV[is] + (CR_ENV[is + 1] - CR_ENV[is]) * (fs - is);
      const fp = (d * iR) / (0.4 + 0.6 * env);
      if (fp >= PROF_N) continue;
      const ip = fp | 0;
      F[row + (wrap ? x & (w - 1) : x)] += A * env * (CR_PROF[ip] + (CR_PROF[ip + 1] - CR_PROF[ip]) * (fp - ip));
    }
  }
}
/** Geometry-scale creases written into a Field (metres). */
export class CreaseSet {
  constructor(field, seed = 5521, { R = [0.024, 0.04], amp = [0.16, 0.3] } = {}) { this.f = field; this.rng = new RNG(seed); this.R = R; this.amp = amp; }
  one(x, z, ang, L, sign = 1) {
    const { f, rng } = this, T = 1 / f.h, R = rng.range(this.R[0], this.R[1]);
    crease(f.data, f.nx, f.nz, false, (x - f.x0) * T, (z - f.z0) * T, ang, L * T, R * T, R * rng.range(this.amp[0], this.amp[1]) * sign, rng.range(-0.3, 0.3));
  }
  /** Tension fanning out of a pinch point (ends of rolls, pulled over an edge, corners, around a turned-back flap). */
  fan(x, z, dir, spread, n, lmin, lmax) { const r = this.rng; for (let i = 0; i < n; i++) this.one(x + r.range(-0.02, 0.02), z + r.range(-0.02, 0.02), dir + r.range(-spread, spread), r.range(lmin, lmax)); }
  /** Singles and parallel bundles everywhere else, roughly following a pull direction field dirAt(x,z) (radians). */
  scatter(n, [xa, xb, za, zb], dirAt) {
    const r = this.rng;
    for (let k = 0; k < n; k++) {
      const x = r.range(xa, xb), z = r.range(za, zb), base = dirAt(x, z) + (r.chance(0.25) ? HP : 0), cnt = r.int(1, 3), sp = r.range(0.025, 0.055), sign = r.chance(0.3) ? -0.8 : 1;
      for (let i = 0; i < cnt; i++) { const off = (i - (cnt - 1) / 2) * sp; this.one(x - Math.sin(base) * off + r.range(-0.03, 0.03), z + Math.cos(base) * off + r.range(-0.03, 0.03), base + r.range(-0.15, 0.15), r.range(0.06, 0.24), sign); }
    }
  }
  /** Fans at both ends of every tall lobe's long axis, pointing outwards. */
  fansFromLobes(lobes, minH = 0.03, n = 6) {
    for (const L of lobes) {
      if (L.h < minH) continue;
      const ax = L.a >= L.b ? 0 : HP, ang = (L.deg * Math.PI) / 180 + ax, len = Math.max(L.a, L.b) * 0.85;
      for (const s of [1, -1]) this.fan(L.cx + Math.cos(ang) * len * s, L.cz + Math.sin(ang) * len * s, ang + (s < 0 ? Math.PI : 0), 0.85, n, 0.1, 0.28);
    }
  }
}

// ------------------------------------------------------------------ outline, support, page curl
/** Distance from the hem of a convex quad outline (positive inside), rounded corners of radius R.
 *  corners: { c00, c10, c01, c11 } as [x, z] (u along c00->c10, v along c00->c01). */
export function quadEdge({ c00, c10, c01, c11 }, R = 0.07) {
  const cen = [(c00[0] + c10[0] + c01[0] + c11[0]) / 4, (c00[1] + c10[1] + c01[1] + c11[1]) / 4];
  const mk = (a, b) => { let nx = -(b[1] - a[1]), nz = b[0] - a[0]; const l = Math.hypot(nx, nz); nx /= l; nz /= l; let c = -(nx * a[0] + nz * a[1]); if (nx * cen[0] + nz * cen[1] + c < 0) { nx = -nx; nz = -nz; c = -c; } return [nx, nz, c]; };
  const E = [mk(c00, c01), mk(c10, c11), mk(c00, c10), mk(c01, c11)];
  const fn = (x, z) => {
    const a = Math.min(E[0][0] * x + E[0][1] * z + E[0][2], E[1][0] * x + E[1][1] * z + E[1][2]), b = Math.min(E[2][0] * x + E[2][1] * z + E[2][2], E[3][0] * x + E[3][1] * z + E[3][2]);
    return a < R && b < R ? R - Math.hypot(R - a, R - b) : Math.min(a, b);
  };
  fn.edges = E;
  return fn;
}
/**
 * A box-shaped support (mattress, table) whose top is at `top`, spanning x0..x1 / z0..z1, with rounded vertical
 * edges of radius r on the x sides. Sheet coordinate p past the flat part wraps round the edge and hangs straight down.
 * sides: which x sides the cloth may hang over ('x-', 'x+'). sag: dip in the middle (soft mattress).
 * Corners where two hanging sides meet are NOT handled (that needs cones/godets) — keep hanging sides opposite.
 */
export function boxSupport({ top, x0, x1, z0, z1, r = 0.07, sides = ['x+'], sag = 0.007 }) {
  const P0 = sides.includes('x-') ? x0 + r : -Infinity, P1 = sides.includes('x+') ? x1 - r : Infinity;
  const sagAt = (x, z) => { const a = clamp((x - x0) / (x1 - x0)) * 2 - 1, b = clamp((z - z0) / (z1 - z0)) * 2 - 1, a2 = a * a, b2 = b * b; return sag * (1 - a2 * a2) * (1 - b2 * b2 * b2); };
  return {
    top, P0, P1, r,
    /** How far past the flat part (m); > 0 = going round the edge / hanging. */
    overhang: (p) => Math.max(P0 - p, p - P1),
    /** Flat sheet coordinate (p, z) + elevation e -> world (o.x, o.y, o.z). */
    drape(p, z, e, o) {
      o.z = z;
      if (p >= P0 && p <= P1) { o.x = p; o.y = top - sagAt(p, z) + e; return; }
      const right = p > P1, d = right ? p - P1 : P0 - p, s = right ? 1 : -1, E0 = right ? P1 : P0, a = d / r;
      if (a < HP) { o.x = E0 + s * (r + e) * Math.sin(a); o.y = top - r + (r + e) * Math.cos(a); }
      else { o.x = E0 + s * (r + e); o.y = top - r - (d - r * HP); }
    },
    sagAt,
  };
}
/**
 * Page curl: a corner turned back over the cloth. q = signed distance past the fold line (> 0 = folded part),
 * eUnder = elevation of the cloth at the fold line, thick = thickness of the flap.
 * Returns w (signed distance from the fold line along its normal, negative = lying back on top) and
 * e (elevation; null once the flap lies flat again -> caller uses eAt(new position) + thick).
 */
export function curl(q, eUnder, thick) {
  const R = Math.max(0.003, 0.5 * (eUnder + thick)), qr = 2.4 * R;
  if (q < qr) { const th = (Math.PI * q) / qr; return { w: R * Math.sin(th), e: R * (1 - Math.cos(th)) }; }
  return { w: -(q - qr), e: null };
}

// ------------------------------------------------------------------ grids and UVs
/** n+1 coordinates 0..1 over `len` metres: cells ~fine between d0 and d1, coarse elsewhere, and shrinking towards
 *  both hems so a rounded hem is real geometry. */
export function zonedAxis(n, len, d0, d1, fine, coarse) {
  const K = 4096, cum = new Float64Array(K + 1);
  for (let k = 0; k < K; k++) {
    const t = ((k + 0.5) / K) * len, zone = smoothstep(d0 - 0.06, d0, t) * (1 - smoothstep(d1, d1 + 0.06, t));
    cum[k + 1] = cum[k] + 1 / Math.min(lerp(coarse, fine, zone), 0.0015 + 0.075 * Math.min(t, len - t));
  }
  const out = new Float32Array(n + 1); let k = 0;
  for (let i = 1; i < n; i++) { const target = (cum[K] * i) / n; while (cum[k + 1] < target) k++; out[i] = (k + (target - cum[k]) / (cum[k + 1] - cum[k])) / K; }
  out[n] = 1; return out;
}
/** Triangles for a (nu x nv)-cell vertex grid P (xyz) / UV. mask(i,j) selects cells, flip reverses facing,
 *  stride > 1 builds a coarser copy (undersides nobody looks at closely). Alternating diagonals avoid a grain. */
export function gridGeo(P, UV, nu, nv, { mask = null, flip = false, stride = 1 } = {}) {
  const W1 = nu + 1, remap = new Int32Array(W1 * (nv + 1)).fill(-1);
  const pos = new Float32Array(W1 * (nv + 1) * 3), uv = new Float32Array(W1 * (nv + 1) * 2), idx = new Uint32Array(Math.ceil(nu / stride) * Math.ceil(nv / stride) * 6);
  let nvx = 0, ni = 0;
  const vid = (i, j) => {
    const k = j * W1 + i; let r = remap[k];
    if (r < 0) { r = remap[k] = nvx++; pos[r * 3] = P[k * 3]; pos[r * 3 + 1] = P[k * 3 + 1]; pos[r * 3 + 2] = P[k * 3 + 2]; uv[r * 2] = UV[k * 2]; uv[r * 2 + 1] = UV[k * 2 + 1]; }
    return r;
  };
  for (let j = 0; j + stride <= nv; j += stride) for (let i = 0; i + stride <= nu; i += stride) {
    if (mask && !mask(i, j)) continue;
    const a = vid(i, j), b = vid(i + stride, j), c = vid(i + stride, j + stride), d = vid(i, j + stride);
    const alt = ((i / stride + j / stride) & 1) === 1;
    if (!flip) { if (alt) idx.set([a, d, b, b, d, c], ni); else idx.set([a, d, c, a, c, b], ni); }
    else if (alt) idx.set([a, b, d, b, c, d], ni); else idx.set([a, c, d, a, b, c], ni);
    ni += 6;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos.slice(0, nvx * 3), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv.slice(0, nvx * 2), 2));
  g.setIndex(new THREE.BufferAttribute(idx.slice(0, ni), 1));
  g.computeVertexNormals();
  g.userData.remap = remap;
  return g;
}
/** Flatten a draped grid: find UVs (metres) whose edge lengths match the 3D surface P, coarse-to-fine
 *  (strides 8,4,2,1). Prints/knits keep true scale on steep folds. nu, nv must be divisible by 8. */
export function relaxUV(P, nu, nv, uv, iters = [260, 70, 30, 12]) {
  const W1 = nu + 1, N = W1 * (nv + 1);
  const dst = (a, b) => { const x = P[a * 3] - P[b * 3], y = P[a * 3 + 1] - P[b * 3 + 1], z = P[a * 3 + 2] - P[b * 3 + 2]; return Math.sqrt(x * x + y * y + z * z); };
  const rowS = new Float32Array(N), colS = new Float32Array(N);
  for (let j = 0; j <= nv; j++) for (let i = 1; i <= nu; i++) rowS[j * W1 + i] = rowS[j * W1 + i - 1] + dst(j * W1 + i - 1, j * W1 + i);
  for (let j = 1; j <= nv; j++) for (let i = 0; i <= nu; i++) colS[j * W1 + i] = colS[(j - 1) * W1 + i] + dst((j - 1) * W1 + i, j * W1 + i);
  let mu = 0, mv = 0; for (let k = 0; k < N; k++) { mu += uv[k * 2]; mv += uv[k * 2 + 1]; }
  const solve = (a, b, rest, st) => {
    const dx = uv[b * 2] - uv[a * 2], dy = uv[b * 2 + 1] - uv[a * 2 + 1], l = Math.sqrt(dx * dx + dy * dy) || 1e-9, f = (st * 0.5 * (l - rest)) / l;
    uv[a * 2] += dx * f; uv[a * 2 + 1] += dy * f; uv[b * 2] -= dx * f; uv[b * 2 + 1] -= dy * f;
  };
  const strides = [8, 4, 2, 1];
  for (let L = 0; L < strides.length; L++) {
    const k = strides[L], ni = nu / k, nj = nv / k, id = (I, J) => J * k * W1 + I * k;
    if (L > 0) {
      for (let J = 0; J <= nj; J += 2) for (let I = 1; I < ni; I += 2) { const a = id(I - 1, J), b = id(I + 1, J), c = id(I, J), t = (rowS[c] - rowS[a]) / Math.max(1e-9, rowS[b] - rowS[a]); uv[c * 2] = lerp(uv[a * 2], uv[b * 2], t); uv[c * 2 + 1] = lerp(uv[a * 2 + 1], uv[b * 2 + 1], t); }
      for (let J = 1; J < nj; J += 2) for (let I = 0; I <= ni; I += 2) { const a = id(I, J - 1), b = id(I, J + 1), c = id(I, J), t = (colS[c] - colS[a]) / Math.max(1e-9, colS[b] - colS[a]); uv[c * 2] = lerp(uv[a * 2], uv[b * 2], t); uv[c * 2 + 1] = lerp(uv[a * 2 + 1], uv[b * 2 + 1], t); }
      for (let J = 1; J < nj; J += 2) for (let I = 1; I < ni; I += 2) { const c = id(I, J), a = id(I - 1, J), b = id(I + 1, J), d = id(I, J - 1), e = id(I, J + 1); uv[c * 2] = 0.25 * (uv[a * 2] + uv[b * 2] + uv[d * 2] + uv[e * 2]); uv[c * 2 + 1] = 0.25 * (uv[a * 2 + 1] + uv[b * 2 + 1] + uv[d * 2 + 1] + uv[e * 2 + 1]); }
    }
    const rH = new Float32Array(ni * (nj + 1)), rV = new Float32Array((ni + 1) * nj), rD = new Float32Array(ni * nj), rE = new Float32Array(ni * nj);
    for (let J = 0; J <= nj; J++) for (let I = 0; I < ni; I++) rH[J * ni + I] = rowS[id(I + 1, J)] - rowS[id(I, J)];
    for (let J = 0; J < nj; J++) for (let I = 0; I <= ni; I++) rV[J * (ni + 1) + I] = colS[id(I, J + 1)] - colS[id(I, J)];
    for (let J = 0; J < nj; J++) for (let I = 0; I < ni; I++) {
      let d1 = 0, d2 = 0; const i0 = I * k, j0 = J * k;
      for (let t = 0; t < k; t++) { d1 += dst((j0 + t) * W1 + i0 + t, (j0 + t + 1) * W1 + i0 + t + 1); d2 += dst((j0 + t) * W1 + i0 + k - t, (j0 + t + 1) * W1 + i0 + k - t - 1); }
      rD[J * ni + I] = d1; rE[J * ni + I] = d2;
    }
    for (let it = 0; it < iters[L]; it++) {
      const fwd = (it & 1) === 0;
      for (let jj = 0; jj <= nj; jj++) {
        const J = fwd ? jj : nj - jj;
        for (let ii = 0; ii <= ni; ii++) {
          const I = fwd ? ii : ni - ii, a = id(I, J);
          if (I < ni) solve(a, id(I + 1, J), rH[J * ni + I], 1);
          if (J < nj) solve(a, id(I, J + 1), rV[J * (ni + 1) + I], 1);
          if (I < ni && J < nj) { solve(a, id(I + 1, J + 1), rD[J * ni + I], 0.5); solve(id(I + 1, J), id(I, J + 1), rE[J * ni + I], 0.5); }
        }
      }
    }
  }
  let nu2 = 0, nv2 = 0; for (let k = 0; k < N; k++) { nu2 += uv[k * 2]; nv2 += uv[k * 2 + 1]; }
  const du = (mu - nu2) / N, dv = (mv - nv2) / N;
  for (let k = 0; k < N; k++) { uv[k * 2] += du; uv[k * 2 + 1] += dv; }
}
/** UV stretch statistics over grid edges: ratio |uv edge| / |3D edge| (1 = no stretch). */
export function uvStretch(P, uv, nu, nv) {
  const W1 = nu + 1, r = [];
  const add = (a, b) => { const l3 = Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]); if (l3 > 1e-6) r.push(Math.hypot(uv[a * 2] - uv[b * 2], uv[a * 2 + 1] - uv[b * 2 + 1]) / l3); };
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) { const k = j * W1 + i; if (i < nu) add(k, k + 1); if (j < nv) add(k, k + W1); }
  r.sort((a, b) => a - b);
  const p = (q) => +r[Math.floor(q * (r.length - 1))].toFixed(3);
  return { p5: p(0.05), p50: p(0.5), p95: p(0.95) };
}

// ------------------------------------------------------------------ textures
/** Height field -> tangent-space normal map (RGBA8). sx/sy = slope scale per texel. Wraps. */
export function normalFromHeight(H, w, h, sx, sy) {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const ym = ((y + h - 1) % h) * w, yp = ((y + 1) % h) * w, o = y * w;
    for (let x = 0; x < w; x++) {
      const dx = (H[o + ((x + 1) % w)] - H[o + ((x + w - 1) % w)]) * 0.5 * sx, dy = (H[yp + x] - H[ym + x]) * 0.5 * sy;
      const il = 1 / Math.sqrt(dx * dx + dy * dy + 1), i = (o + x) * 4;
      out[i] = (-dx * il * 0.5 + 0.5) * 255; out[i + 1] = (-dy * il * 0.5 + 0.5) * 255; out[i + 2] = (il * 0.5 + 0.5) * 255; out[i + 3] = 255;
    }
  }
  return out;
}
/** Normal map with a cavity value in alpha (0.5 = level, darker in the folds). H in mm, s = texels per mm. */
export function normalCavity(H, w, h, s) {
  const out = normalFromHeight(H, w, h, s, s), lw = w >> 2, lh = h >> 2;
  let low = new Float32Array(lw * lh);
  for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) {
    let a = 0;
    for (let j = 0; j < 4; j++) { const o = (y * 4 + j) * w + x * 4; a += H[o] + H[o + 1] + H[o + 2] + H[o + 3]; }
    low[y * lw + x] = a / 16;
  }
  low = boxBlurWrap(boxBlurWrap(low, lw, lh, 2, 2), lw, lh, 2, 2);
  const ix = (v, n) => ((v % n) + n) % n;
  for (let y = 0; y < h; y++) {
    const fy = (y + 0.5) / 4 - 0.5, y0 = Math.floor(fy), ty = fy - y0, r0 = ix(y0, lh) * lw, r1 = ix(y0 + 1, lh) * lw, o = y * w;
    for (let x = 0; x < w; x++) {
      const fx = (x + 0.5) / 4 - 0.5, x0 = Math.floor(fx), tx = fx - x0, xa = ix(x0, lw), xb = ix(x0 + 1, lw);
      const a = low[r0 + xa] + (low[r0 + xb] - low[r0 + xa]) * tx, b = low[r1 + xa] + (low[r1 + xb] - low[r1 + xa]) * tx, c = 0.5 + (H[o + x] - (a + (b - a) * ty)) * 0.6;
      out[(o + x) * 4 + 3] = c <= 0 ? 0 : c >= 1 ? 255 : c * 255;
    }
  }
  return out;
}
/**
 * Tiling fine-wrinkle normal map for slept-in cotton (one tile = tileM metres): bundles and fans of tension
 * creases with small buckles, patches of short crumple marks, soft undulation. Returns a THREE.DataTexture
 * (RGB normal, A cavity) with repeat set for UVs in metres.
 */
export function wrinkleTexture({ N = 1024, tileM = 0.64, seed = 7719, bundles = 60, crumples = 1700 } = {}) {
  const px = N / (tileM * 1000), H = new Float32Array(N * N), rng = new RNG(seed), period = (k) => [k, k];
  const dirAt = (x, y) => 3.4 * pn((x / N) * 3 + 0.37, (y / N) * 3 + 0.71, seed + 1, ...period(3));
  const busy = (x, y) => smoothstep(0.28, 0.62, pn((x / N) * 5 + 0.2, (y / N) * 5 + 0.6, seed + 2, ...period(5)));
  for (let k = 0; k < bundles; k++) {
    const ox = rng.range(0, N), oy = rng.range(0, N), base = dirAt(ox, oy) + (rng.chance(0.12) ? HP : 0), fan = rng.chance(0.5), n = rng.int(2, 5), sp = rng.range(9, 17) * px;
    const cb = Math.cos(base), sb = Math.sin(base);
    for (let i = 0; i < n; i++) {
      const L = rng.range(40, 140) * px, a = base + (fan ? rng.range(-0.36, 0.36) : rng.range(-0.09, 0.09));
      const off = fan ? rng.range(-2, 2) * px : (i - (n - 1) / 2) * sp + rng.range(-2, 2) * px, st = fan ? rng.range(0, 5) * px : rng.range(-30, 30) * px;
      const x0 = ox - sb * off + cb * st, y0 = oy + cb * off + sb * st, Rmm = rng.range(9, 18), A = Rmm * rng.range(0.09, 0.17) * (rng.chance(0.18) ? -0.6 : 1);
      crease(H, N, N, true, x0, y0, a, L, Rmm * px, A, rng.range(-0.45, 0.45));
      for (let b = rng.int(0, 2); b > 0; b--) {
        const t = rng.range(0.2, 0.8);
        crease(H, N, N, true, x0 + Math.cos(a) * L * t, y0 + Math.sin(a) * L * t, a + rng.sign() * rng.range(0.6, 1.3), L * rng.range(0.12, 0.3), Rmm * px * 0.6, A * rng.range(0.3, 0.55), 0);
      }
    }
  }
  for (let k = 0; k < crumples; k++) {
    const x0 = rng.range(0, N), y0 = rng.range(0, N), keep = rng.next() < 0.2 + 0.8 * busy(x0, y0);
    const a = dirAt(x0, y0) + rng.gauss() * 0.6, Rmm = rng.range(4, 9), L = rng.range(12, 46) * px, A = Rmm * rng.range(0.055, 0.12) * (rng.chance(0.4) ? -0.8 : 1), bend = rng.range(-0.4, 0.4);
    if (keep) crease(H, N, N, true, x0, y0, a, L, Rmm * px, A, bend);
  }
  const cyc = Math.max(1, Math.round(tileM / 0.03));      // soft undulation, ~3 cm, tiling
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) H[y * N + x] += pn((x / N) * cyc, (y / N) * cyc, seed + 3, cyc, cyc) - 0.5;
  const tex = new THREE.DataTexture(normalCavity(H, N, N, px), N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(1 / tileM, 1 / tileM);
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true; tex.anisotropy = 8;
  tex.colorSpace = THREE.NoColorSpace; tex.needsUpdate = true;
  return tex;
}
/** Cream cotton with a scattered sprig print (Canvas2D), one tile = tileM metres. Returns a CanvasTexture. */
export function sprigPrintTexture({ S = 1024, tileM = 0.74, seed = 4411, ground = 'rgb(233,228,217)', ink = 'rgb(92,112,134)', grid = 15 } = {}) {
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const c = cv.getContext('2d'), rng = new RNG(seed), cell = S / grid, U = S / (tileM * 1000);
  c.fillStyle = ground; c.fillRect(0, 0, S, S); c.lineCap = 'round';
  const leaf = (x, y, ang, len) => {
    const wid = len * rng.range(0.2, 0.27);
    c.save(); c.translate(x, y); c.rotate(ang); c.beginPath(); c.moveTo(0, 0);
    c.quadraticCurveTo(len * 0.42, -wid * 1.9, len, 0); c.quadraticCurveTo(len * 0.5, wid * 1.9, 0, 0); c.fill(); c.restore();
  };
  const sprig = (x, y, a) => {
    c.strokeStyle = ink; c.fillStyle = ink; c.lineWidth = 0.9 * U;
    const L = rng.range(22, 30) * U, n = rng.int(3, 5);
    c.beginPath(); c.moveTo(x, y); const ex = x + Math.cos(a) * L, ey = y + Math.sin(a) * L; c.quadraticCurveTo(x + Math.cos(a + 0.3) * L * 0.5, y + Math.sin(a + 0.3) * L * 0.5, ex, ey); c.stroke();
    for (let i = 0; i < n; i++) { const t = (i + 1) / (n + 1), s = i % 2 ? 1 : -1; leaf(x + Math.cos(a) * L * t, y + Math.sin(a) * L * t, a + s * rng.range(0.6, 1.0), rng.range(6, 9) * U); }
    leaf(ex, ey, a, rng.range(7, 10) * U);
  };
  for (let j = 0; j < grid; j++) for (let i = 0; i < grid; i++) {
    const x = (i + 0.5 + rng.range(-0.34, 0.34)) * cell, y = (j + 0.5 + rng.range(-0.34, 0.34)) * cell, a = rng.range(0, TAU);
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) { const st = rng.f; rng.f = mulberry32(i * 977 + j * 131 + seed); sprig(x + ox, y + oy, a); rng.f = st; }   // drawn 9x so it tiles
  }
  c.globalAlpha = 0.12; c.fillStyle = ground; c.fillRect(0, 0, S, S);      // a little washed out
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(1 / tileM, 1 / tileM); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  return tex;
}
/** Cotton: MeshPhysicalMaterial with sheen; the normal map's alpha (cavity) darkens the folds. */
export function cottonMaterial({ map = null, color = 0xffffff, normalMap = null, normalScale = 1.1, cavity = 0.32, sheen = 0.35, roughness = 0.9, side = THREE.FrontSide } = {}) {
  const m = new THREE.MeshPhysicalMaterial({ map, color, normalMap, normalScale: new THREE.Vector2(normalScale, normalScale), roughness, sheen, sheenRoughness: 0.5, sheenColor: new THREE.Color(1, 1, 1), side });
  if (normalMap && cavity > 0) {
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uCav = { value: cavity };
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uCav;')
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
#ifdef USE_NORMALMAP_TANGENTSPACE
  diffuseColor.rgb *= 1.0 + uCav * min( texture2D( normalMap, vNormalMapUv ).a * 2.0 - 1.0, 0.0 );
#endif`);
    };
    m.customProgramCacheKey = () => 'cotton-cav';
  }
  return m;
}

/** A copy of `mesh` that GLTFExporter can write: DataTextures become canvas textures (alpha forced opaque —
 *  the cavity channel is dropped; rebuild it in the target engine), the onBeforeCompile patch is removed. */
export function exportableMesh(mesh) {
  const toCanvas = (t) => {
    if (!t || !t.isDataTexture) return t;
    const { data, width, height } = t.image, cv = document.createElement('canvas'); cv.width = width; cv.height = height;
    const img = new ImageData(width, height); img.data.set(data); for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
    cv.getContext('2d').putImageData(img, 0, 0);
    const c = new THREE.CanvasTexture(cv);
    for (const k of ['wrapS', 'wrapT', 'colorSpace', 'rotation', 'flipY']) c[k] = t[k];
    c.repeat.copy(t.repeat); c.offset.copy(t.offset);
    return c;
  };
  const m = mesh.material.clone();
  m.onBeforeCompile = () => {}; m.normalMap = toCanvas(m.normalMap); m.map = toCanvas(m.map);
  const out = new THREE.Mesh(mesh.geometry, m); out.name = mesh.name;
  return out;
}
