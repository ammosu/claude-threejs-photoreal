// Lived-in props for three.js: the small things that make a room look used — a towel or garment thrown over a chair
// or a basket rim (deterministic position-based-dynamics drape against any mesh), cloth with real thickness and
// rolled hems, socks, a cable left on the floor, a mug with tea tide marks, a steel bottle with a knurled cap,
// crumpled paper, a soft rope basket. All geometry is built from code, deterministically (same seed, same result).
// Adapted from room-at-dawn (MIT, github.com/Leonxlnx/room-at-dawn) src/scene/parts/clutter.js, decor.js, desk.js.
// Units: metres, y up.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const TAU = Math.PI * 2;
export const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// ------------------------------------------------------------------ randomness and noise (never Math.random)
export class RNG {
  constructor(seed = 1) { let a = seed | 0; this.f = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  next() { return this.f(); } range(a, b) { return a + (b - a) * this.f(); } int(a, b) { return Math.floor(this.range(a, b + 1)); } chance(p) { return this.f() < p; } pick(arr) { return arr[Math.floor(this.f() * arr.length)]; } sign() { return this.f() < 0.5 ? -1 : 1; } gauss() { let u = 0; while (u === 0) u = this.f(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * this.f()); }
}
function h3(x, y, z, s) { let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2246822519) + Math.imul(s, 1442695041)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
export function noise3(x, y, z, seed = 0) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = x - ix, fy = y - iy, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz), n = (a, b, c) => h3(ix + a, iy + b, iz + c, seed);
  return lerp(lerp(lerp(n(0, 0, 0), n(1, 0, 0), u), lerp(n(0, 1, 0), n(1, 1, 0), u), v), lerp(lerp(n(0, 0, 1), n(1, 0, 1), u), lerp(n(0, 1, 1), n(1, 1, 1), u), v), w);
}
export const fbm3 = (x, y, z, oct = 2, seed = 0) => { let a = 0.5, s = 0, n = 0, f = 1; for (let i = 0; i < oct; i++) { s += a * noise3(x * f, y * f, z * f, seed + i * 17); n += a; a *= 0.5; f *= 2; } return s / n; };
export const fbm2 = (x, y, oct = 2, seed = 0) => fbm3(x, y, 0.37, oct, seed);

// ------------------------------------------------------------------ geometry plumbing
export function geoFrom(pos, nor, uv, idx, col) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); if (col) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); return g;
}
/** Flip every triangle whose winding disagrees with its vertex normals (procedural sheets get both kinds). */
export function orient(g) {
  const p = g.attributes.position.array, n = g.attributes.normal.array, ix = g.index.array;
  for (let i = 0; i < ix.length; i += 3) {
    const a = ix[i] * 3, b = ix[i + 1] * 3, c = ix[i + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const d = (uy * vz - uz * vy) * (n[a] + n[b] + n[c]) + (uz * vx - ux * vz) * (n[a + 1] + n[b + 1] + n[c + 1]) + (ux * vy - uy * vx) * (n[a + 2] + n[b + 2] + n[c + 2]);
    if (d < 0) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
  }
  return g;
}
/** merge() that tolerates mixed attribute sets (keeps position/normal/uv, adds white vertex colour where missing). */
export function merge(geos, { color = false } = {}) {
  return mergeGeometries(geos.map((g) => {
    g = g.clone(); if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (color && !g.attributes.color) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
    if (!color && g.attributes.color) g.deleteAttribute('color');
    return g;
  }));
}
/** LatheGeometry with long profile segments split (maxSeg metres): tall walls need rows of vertices for vertex
 *  colours and baked light. profile: [[radius, y], ...] bottom to top. */
export function lath(profile, segs = 48, maxSeg = 0.012) {
  const out = [profile[0]];
  for (let i = 1; i < profile.length; i++) {
    const a = profile[i - 1], b = profile[i], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / maxSeg));
    for (let k = 1; k <= n; k++) out.push([lerp(a[0], b[0], k / n), lerp(a[1], b[1], k / n)]);
  }
  return orient(new THREE.LatheGeometry(out.map(([x, y]) => new THREE.Vector2(Math.max(x, 1e-5), y)), segs));
}
/** Sample fn(u, v, out:Vector3) on a (nu+1) x (nv+1) grid with smooth normals. o.closedU wraps u; o.from = point the
 *  normals should face away from, o.face = direction they should face (checked over rows o.rows). */
export function sampleGrid(fn, nu, nv, o = {}) {
  const W = nu + 1, H = nv + 1, P = new Float32Array(W * H * 3), N = new Float32Array(W * H * 3), p = V3(), bad = [];
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { fn(o.closedU && i === nu ? 0 : i / nu, j / nv, p); const k = (j * W + i) * 3; P[k] = p.x; P[k + 1] = p.y; P[k + 2] = p.z; }
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    let ia = i + 1, ib = i - 1;
    if (o.closedU) { if (ia > nu) ia = 1; if (ib < 0) ib = nu - 1; } else { ia = Math.min(ia, nu); ib = Math.max(ib, 0); }
    const a = (j * W + ia) * 3, b = (j * W + ib) * 3, c = (Math.min(nv, j + 1) * W + i) * 3, d = (Math.max(0, j - 1) * W + i) * 3, k = (j * W + i) * 3;
    const ux = P[a] - P[b], uy = P[a + 1] - P[b + 1], uz = P[a + 2] - P[b + 2], vx = P[c] - P[d], vy = P[c + 1] - P[d + 1], vz = P[c + 2] - P[d + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz);
    if (l > 1e-12) { N[k] = nx / l; N[k + 1] = ny / l; N[k + 2] = nz / l; } else bad.push(j * W + i);
  }
  for (const q of bad) {            // poles and pinched rows: mean normal of the next row in
    const j = Math.floor(q / W), jj = j === 0 ? 1 : j === nv ? nv - 1 : j + 1; let x = 0, y = 0, z = 0;
    for (let i = 0; i < W; i++) { const k = (jj * W + i) * 3; x += N[k]; y += N[k + 1]; z += N[k + 2]; }
    const l = Math.hypot(x, y, z) || 1; N[q * 3] = x / l; N[q * 3 + 1] = y / l; N[q * 3 + 2] = z / l;
  }
  if (o.from || o.face) {
    let s = 0; const [j0, j1] = o.rows || [0, nv];
    for (let j = j0; j <= j1; j++) for (let i = 0; i < W; i++) { const k = (j * W + i) * 3; s += o.face ? N[k] * o.face[0] + N[k + 1] * o.face[1] + N[k + 2] * o.face[2] : N[k] * (P[k] - o.from[0]) + N[k + 1] * (P[k + 1] - o.from[1]) + N[k + 2] * (P[k + 2] - o.from[2]); }
    if (s < 0) for (let k = 0; k < N.length; k++) N[k] = -N[k];
  }
  return { W, H, P, N };
}
/** One skin through a sampled grid; uS / vS = its size in metres (texture coordinates). */
export function skin(G, uS = 1, vS = 1) {
  const { W, H, P, N } = G, uv = [], idx = [];
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) uv.push((i / (W - 1)) * uS, (j / (H - 1)) * vS);
  for (let j = 0; j < H - 1; j++) for (let i = 0; i < W - 1; i++) { const a = j * W + i, b = a + 1, c = a + W + 1, d = a + W; idx.push(a, b, c, a, c, d); }
  return orient(geoFrom(P, N, uv, idx));
}

// ------------------------------------------------------------------ cloth with thickness
/** Smooth normals of a W x H point grid P (Float32/64Array xyz). */
export function gridNormals(P, W, H) {
  const N = new Float32Array(W * H * 3);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const a = (j * W + Math.min(W - 1, i + 1)) * 3, b = (j * W + Math.max(0, i - 1)) * 3, c = (Math.min(H - 1, j + 1) * W + i) * 3, d = (Math.max(0, j - 1) * W + i) * 3;
    const ux = P[a] - P[b], uy = P[a + 1] - P[b + 1], uz = P[a + 2] - P[b + 2], vx = P[c] - P[d], vy = P[c + 1] - P[d + 1], vz = P[c + 2] - P[d + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz), k = (j * W + i) * 3;
    if (l > 1e-14) { N[k] = nx / l; N[k + 1] = ny / l; N[k + 2] = nz / l; } else if (j > 0) { const q = ((j - 1) * W + i) * 3; N[k] = N[q]; N[k + 1] = N[q + 1]; N[k + 2] = N[q + 2]; } else N[k + 1] = 1;
  }
  return N;
}
/** One level of uniform cubic B-spline refinement of a W x H grid with nc components (borders kept): a coarse
 *  simulated cloth becomes a smooth 2W-1 x 2H-1 surface without re-simulating. */
export function refine(src, W, H, nc = 3) {
  const W2 = 2 * W - 1, H2 = 2 * H - 1, tmp = new Float64Array(W2 * H * nc), dst = new Float64Array(W2 * H2 * nc);
  const ev = (g, n, f) => { const G = (k) => (k < 0 ? 2 * g(0) - g(1) : k >= n ? 2 * g(n - 1) - g(n - 2) : g(k)), k = f >> 1; return f & 1 ? (G(k - 1) + 23 * G(k) + 23 * G(k + 1) + G(k + 2)) / 48 : (G(k - 1) + 4 * G(k) + G(k + 1)) / 6; };
  for (let j = 0; j < H; j++) for (let c = 0; c < nc; c++) { const g = (k) => src[(j * W + k) * nc + c]; for (let f = 0; f < W2; f++) tmp[(j * W2 + f) * nc + c] = ev(g, W, f); }
  for (let i = 0; i < W2; i++) for (let c = 0; c < nc; c++) { const g = (k) => tmp[(k * W2 + i) * nc + c]; for (let f = 0; f < H2; f++) dst[(f * W2 + i) * nc + c] = ev(g, H, f); }
  return { P: dst, W: W2, H: H2 };
}
/**
 * A sheet of cloth with real thickness: the mid-surface grid P (W x H) pushed out both ways by th(i, j) / 2... th,
 * joined by a rolled edge (half-cylinder) on the sides listed in `hem` ({u0, u1, v0, v1}). Edges without a hem stay
 * open (use for seams into another piece). uv(i, j) -> [u, v] in metres; shade(i, j) -> vertex grey (dye mottling).
 */
export function thickCloth(P, W, H, { th = () => 0.003, uv = (i, j) => [i * 0.01, j * 0.01], shade = () => 1, hem = { u0: true, u1: true, v0: true, v1: true }, RS = 4 } = {}) {
  const N = gridNormals(P, W, H), pos = [], nor = [], uvs = [], cols = [], idx = [];
  const T = new Float32Array(W * H), C = new Float32Array(W * H), U = new Float32Array(W * H * 2);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const k = j * W + i; T[k] = th(i, j) / 2; C[k] = shade(i, j); const q = uv(i, j); U[k * 2] = q[0]; U[k * 2 + 1] = q[1]; }
  for (const side of [1, -1]) {
    const base = pos.length / 3;
    for (let k = 0; k < W * H; k++) { const k3 = k * 3, h = T[k] * side; pos.push(P[k3] + N[k3] * h, P[k3 + 1] + N[k3 + 1] * h, P[k3 + 2] + N[k3 + 2] * h); nor.push(N[k3] * side, N[k3 + 1] * side, N[k3 + 2] * side); uvs.push(U[k * 2], U[k * 2 + 1]); cols.push(C[k], C[k], C[k]); }
    for (let j = 0; j < H - 1; j++) for (let i = 0; i < W - 1; i++) { const a = base + j * W + i, b = a + 1, c = a + W + 1, d = a + W; idx.push(a, b, c, a, c, d); }
  }
  const loop = [];
  for (let i = 0; i < W - 1; i++) loop.push([i, 0, 'v0']);
  for (let j = 0; j < H - 1; j++) loop.push([W - 1, j, 'u1']);
  for (let i = W - 1; i > 0; i--) loop.push([i, H - 1, 'v1']);
  for (let j = H - 1; j > 0; j--) loop.push([0, j, 'u0']);
  const L = loop.length, base = pos.length / 3, R = RS + 1;
  for (const [i, j] of loop) {
    const k = j * W + i, k3 = k * 3, q = (clamp(j, 1, H - 2) * W + clamp(i, 1, W - 2)) * 3;
    let tx = P[k3] - P[q], ty = P[k3 + 1] - P[q + 1], tz = P[k3 + 2] - P[q + 2];        // outward, in the sheet
    const dn = tx * N[k3] + ty * N[k3 + 1] + tz * N[k3 + 2]; tx -= dn * N[k3]; ty -= dn * N[k3 + 1]; tz -= dn * N[k3 + 2];
    const l = Math.hypot(tx, ty, tz) || 1; tx /= l; ty /= l; tz /= l;
    for (let r = 0; r <= RS; r++) {
      const a = (r / RS) * Math.PI, cs = Math.cos(a), sn = Math.sin(a), nx = N[k3] * cs + tx * sn, ny = N[k3 + 1] * cs + ty * sn, nz = N[k3 + 2] * cs + tz * sn;
      pos.push(P[k3] + nx * T[k], P[k3 + 1] + ny * T[k], P[k3 + 2] + nz * T[k]); nor.push(nx, ny, nz); uvs.push(U[k * 2], U[k * 2 + 1]); cols.push(C[k], C[k], C[k]);
    }
  }
  for (let m = 0; m < L; m++) {
    if (!hem[loop[m][2]]) continue;
    const m2 = (m + 1) % L;
    for (let r = 0; r < RS; r++) { const a = base + m * R + r, b = base + m2 * R + r; idx.push(a, b, b + 1, a, b + 1, a + 1); }
  }
  return orient(geoFrom(pos, nor, uvs, idx, cols));
}

// ------------------------------------------------------------------ drape: position based dynamics against any mesh
/** Points spread over the surfaces of meshes (world space), about `spacing` apart: the collider for drapeCloth.
 *  The returned Float32Array also carries `.normals` (the face normal at each point): the solver then knows which
 *  side is outside and puts back a particle that slipped through a thin or one-sided surface (a heap of laundry, a
 *  seat cushion skin). Meshes must have outward-facing triangles (orient() / closed solids). */
export function surfacePoints(meshes, spacing = 0.008, seed = 7) {
  const r = new RNG(seed), out = [], nrm = [], a = V3(), b = V3(), c = V3(), e1 = V3(), e2 = V3(), fn = V3();
  for (const m of meshes) {
    m.updateMatrixWorld(true);
    const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry, p = g.attributes.position;
    for (let t = 0; t < p.count; t += 3) {
      a.fromBufferAttribute(p, t).applyMatrix4(m.matrixWorld); b.fromBufferAttribute(p, t + 1).applyMatrix4(m.matrixWorld); c.fromBufferAttribute(p, t + 2).applyMatrix4(m.matrixWorld);
      fn.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a)); const area = fn.length() / 2; if (area < 1e-12) continue; fn.normalize();
      const n = area / (spacing * spacing), cnt = Math.floor(n) + (r.next() < n % 1 ? 1 : 0);
      for (let k = 0; k < cnt; k++) { let u = r.next(), v = r.next(); if (u + v > 1) { u = 1 - u; v = 1 - v; } out.push(a.x + (b.x - a.x) * u + (c.x - a.x) * v, a.y + (b.y - a.y) * u + (c.y - a.y) * v, a.z + (b.z - a.z) * u + (c.z - a.z) * v); nrm.push(fn.x, fn.y, fn.z); }
      out.push((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3, (a.z + b.z + c.z) / 3); nrm.push(fn.x, fn.y, fn.z);      // every triangle gets at least one
    }
  }
  const pts = new Float32Array(out); pts.normals = new Float32Array(nrm);
  return pts;
}
function hashPoints(sp, CS) {
  let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
  for (let k = 0; k < sp.length; k += 3) { x0 = Math.min(x0, sp[k]); y0 = Math.min(y0, sp[k + 1]); z0 = Math.min(z0, sp[k + 2]); x1 = Math.max(x1, sp[k]); y1 = Math.max(y1, sp[k + 1]); z1 = Math.max(z1, sp[k + 2]); }
  const gx = Math.floor((x1 - x0) / CS) + 1, gy = Math.floor((y1 - y0) / CS) + 1, gz = Math.floor((z1 - z0) / CS) + 1, n = sp.length / 3;
  const start = new Int32Array(gx * gy * gz + 1), ord = new Int32Array(n), cell = new Int32Array(n);
  for (let k = 0; k < n; k++) { cell[k] = (Math.floor((sp[k * 3 + 2] - z0) / CS) * gy + Math.floor((sp[k * 3 + 1] - y0) / CS)) * gx + Math.floor((sp[k * 3] - x0) / CS); start[cell[k] + 1]++; }
  for (let c = 0; c < gx * gy * gz; c++) start[c + 1] += start[c];
  const fill = start.slice(0, gx * gy * gz); for (let k = 0; k < n; k++) ord[fill[cell[k]]++] = k;
  return { CS, x0, y0, z0, gx, gy, gz, start, ord, sp, nr: sp.normals || null };
}
/** Nearest collider point within rs of (x, y, z): index*3 or -1, distance² in out[0]. */
function nearest(G, x, y, z, rs, out) {
  const { CS, x0, y0, z0, gx, gy, gz, start, ord, sp } = G;
  const ix0 = Math.floor((x - rs - x0) / CS), ix1 = Math.floor((x + rs - x0) / CS), iy0 = Math.floor((y - rs - y0) / CS), iy1 = Math.floor((y + rs - y0) / CS), iz0 = Math.floor((z - rs - z0) / CS), iz1 = Math.floor((z + rs - z0) / CS);
  if (ix1 < 0 || iy1 < 0 || iz1 < 0 || ix0 >= gx || iy0 >= gy || iz0 >= gz) return -1;
  let best = rs * rs, bj = -1;
  for (let cz = Math.max(0, iz0); cz <= Math.min(gz - 1, iz1); cz++) for (let cy = Math.max(0, iy0); cy <= Math.min(gy - 1, iy1); cy++) for (let cx = Math.max(0, ix0); cx <= Math.min(gx - 1, ix1); cx++) {
    const c = (cz * gy + cy) * gx + cx;
    for (let q = start[c]; q < start[c + 1]; q++) { const j = ord[q] * 3, ex = x - sp[j], ey = y - sp[j + 1], ez = z - sp[j + 2], d2 = ex * ex + ey * ey + ez * ez; if (d2 < best) { best = d2; bj = j; } }
  }
  out[0] = best; return bj;
}
/**
 * Drape a rectangular cloth (W x H particles, D metres apart) over colliders. Deterministic: no randomness, fixed
 * step count, fixed constraint order, so the same input always settles to the same shape (bakes stay valid).
 *  place(i, j) -> [x, y, z]   starting pose (e.g. flat above the object, or folded over a rim); it falls into place
 *  collider                   Float32Array of points from surfacePoints(); the cloth keeps rs away from every point
 *  pins [[i, j], ...]         particles held at their starting position (a peg, a hand, the fold over a bar)
 *  floor                      height of the floor (particles stop there)
 * Returns { P: Float64Array, W, H, stats: { ms, maxStretch, p99Stretch, p1Compress, meanStrain, inside, contacts } }.
 * Stretch (links longer than rest) is the error to watch; compression is fine, it means the cloth buckled into folds.
 */
export function drapeCloth({ W, H, D, place, collider, rs = 0.0105, pins = [], floor = 0, steps = 220, late = 60, gravity = 0.0005, vmax = 0.006, mu = 1.5,
  stiff = [1, 0.5, 0.12], lateStiff = [1, 0.5, 0.06], iters = [20, 60], self = true, sd = null } = {}) {
  const t0 = performance.now(), n = W * H, n3 = n * 3, X = new Float64Array(n3), Pp = new Float64Array(n3);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const q = place(i, j), k = (j * W + i) * 3; X[k] = q[0]; X[k + 1] = q[1]; X[k + 2] = q[2]; }
  Pp.set(X);
  // constraints: 0 stretch (neighbours), 1 shear (diagonals), 2 bend (two apart); rest lengths from the flat pattern
  const ca = [], cb = [], cr = [], ck = [];
  const link = (a, b, kind, r) => { ca.push(a * 3); cb.push(b * 3); cr.push(r); ck.push(kind); };
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i;
    if (i + 1 < W) link(k, k + 1, 0, D); if (j + 1 < H) link(k, k + W, 0, D);
    if (i + 1 < W && j + 1 < H) { link(k, k + W + 1, 1, D * Math.SQRT2); link(k + 1, k + W, 1, D * Math.SQRT2); }
    if (i + 2 < W) link(k, k + 2, 2, 2 * D); if (j + 2 < H) link(k, k + 2 * W, 2, 2 * D);
  }
  const nc = ca.length, CA = Int32Array.from(ca), CB = Int32Array.from(cb), CR = Float64Array.from(cr), CFE = new Float64Array(nc), CFL = new Float64Array(nc);
  for (let c = 0; c < nc; c++) { CFE[c] = 0.5 * stiff[ck[c]]; CFL[c] = 0.5 * lateStiff[ck[c]]; }
  const pin = pins.map(([i, j]) => { const k = (j * W + i) * 3; return [k, X[k], X[k + 1], X[k + 2]]; });
  const doPins = () => { for (const [k, x, y, z] of pin) { X[k] = x; X[k + 1] = y; X[k + 2] = z; } };
  const G = hashPoints(collider, Math.max(0.012, rs * 2.2)), out = [0];
  const SD = sd ?? D * 0.77, SD2 = SD * SD, head = new Int32Array(1 << 20), nxt = new Int32Array(n);
  let contacts = 0;
  for (let step = 0; step < steps; step++) {
    const isLate = step >= steps - late, CF = isLate ? CFL : CFE, it = isLate ? iters[1] : iters[0], r = isLate ? rs * 0.93 : rs * 1.1;
    // integrate (Verlet with damping and a speed cap: the cloth settles, it does not bounce)
    const damp = step >= steps - 10 ? 0.5 : 0.965, v2max = vmax * vmax;
    for (let k = 0; k < n3; k += 3) {
      let vx = (X[k] - Pp[k]) * damp, vy = (X[k + 1] - Pp[k + 1]) * damp - gravity, vz = (X[k + 2] - Pp[k + 2]) * damp;
      const v2 = vx * vx + vy * vy + vz * vz; if (v2 > v2max) { const f = vmax / Math.sqrt(v2); vx *= f; vy *= f; vz *= f; }
      Pp[k] = X[k]; Pp[k + 1] = X[k + 1]; Pp[k + 2] = X[k + 2]; X[k] += vx; X[k + 1] += vy; X[k + 2] += vz;
    }
    doPins();
    for (let s = 0; s < it; s++) {               // Gauss-Seidel sweeps, alternating direction (no drift to one side)
      const fwd = (s & 1) === 0;
      for (let q = 0; q < nc; q++) {
        const c = fwd ? q : nc - 1 - q, a = CA[c], b = CB[c], dx = X[b] - X[a], dy = X[b + 1] - X[a + 1], dz = X[b + 2] - X[a + 2], d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < 1e-9) continue;
        const f = ((d - CR[c]) / d) * CF[c]; X[a] += dx * f; X[a + 1] += dy * f; X[a + 2] += dz * f; X[b] -= dx * f; X[b + 1] -= dy * f; X[b + 2] -= dz * f;
      }
      doPins();
    }
    // collide: push out of the collider points; stick where the cloth rests on top, slip with friction elsewhere
    contacts = 0;
    for (let k = 0; k < n3; k += 3) {
      if (X[k + 1] < floor) { X[k] = Pp[k]; X[k + 1] = floor; X[k + 2] = Pp[k + 2]; continue; }
      const bj = nearest(G, X[k], X[k + 1], X[k + 2], r, out); if (bj < 0) continue;
      contacts++;
      const sp = G.sp, d = Math.sqrt(out[0]) || 1e-6, pen = r - d;
      let nx = (X[k] - sp[bj]) / d, ny = (X[k + 1] - sp[bj + 1]) / d, nz = (X[k + 2] - sp[bj + 2]) / d;
      if (G.nr) {          // behind the surface (slipped through): go back out along the face normal
        const fx = G.nr[bj], fy = G.nr[bj + 1], fz = G.nr[bj + 2];
        if (nx * fx + ny * fy + nz * fz < 0) { nx = fx; ny = fy; nz = fz; }
      }
      const x = sp[bj] + nx * r, y = sp[bj + 1] + ny * r, z = sp[bj + 2] + nz * r;
      let tx = x - Pp[k], ty = y - Pp[k + 1], tz = z - Pp[k + 2]; const dn = tx * nx + ty * ny + tz * nz; tx -= dn * nx; ty -= dn * ny; tz -= dn * nz;
      const tl = Math.sqrt(tx * tx + ty * ty + tz * tz), fr = tl < 1e-9 ? 0 : ny > 0.35 ? 1 : Math.min(1, (mu * pen) / tl);
      X[k] = x - tx * fr; X[k + 1] = y - ty * fr; X[k + 2] = z - tz * fr;
    }
    // self collision every other step: particle spheres of diameter SD, grid neighbours (<= 2 apart) skipped
    if (self && step & 1) {
      let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
      for (let k = 0; k < n3; k += 3) { x0 = Math.min(x0, X[k]); x1 = Math.max(x1, X[k]); y0 = Math.min(y0, X[k + 1]); y1 = Math.max(y1, X[k + 1]); z0 = Math.min(z0, X[k + 2]); z1 = Math.max(z1, X[k + 2]); }
      const gx = Math.floor((x1 - x0) / SD) + 1, gy = Math.floor((y1 - y0) / SD) + 1, gz = Math.floor((z1 - z0) / SD) + 1;
      if (gx * gy * gz <= head.length) {
        head.fill(-1, 0, gx * gy * gz);
        for (let i = 0, k = 0; i < n; i++, k += 3) { const c = (Math.floor((X[k + 2] - z0) / SD) * gy + Math.floor((X[k + 1] - y0) / SD)) * gx + Math.floor((X[k] - x0) / SD); nxt[i] = head[c]; head[c] = i; }
        for (let i = 0, k = 0; i < n; i++, k += 3) {
          const ix = Math.floor((X[k] - x0) / SD), iy = Math.floor((X[k + 1] - y0) / SD), iz = Math.floor((X[k + 2] - z0) / SD), ui = i % W, vi = (i / W) | 0;
          for (let cz = Math.max(0, iz - 1); cz <= Math.min(gz - 1, iz + 1); cz++) for (let cy = Math.max(0, iy - 1); cy <= Math.min(gy - 1, iy + 1); cy++) for (let cx = Math.max(0, ix - 1); cx <= Math.min(gx - 1, ix + 1); cx++) {
            for (let j = head[(cz * gy + cy) * gx + cx]; j >= 0; j = nxt[j]) {
              if (j <= i || (Math.abs(ui - (j % W)) <= 2 && Math.abs(vi - ((j / W) | 0)) <= 2)) continue;
              const k2 = j * 3, ex = X[k2] - X[k], ey = X[k2 + 1] - X[k + 1], ez = X[k2 + 2] - X[k + 2], d2 = ex * ex + ey * ey + ez * ez;
              if (d2 >= SD2 || d2 < 1e-12) continue;
              const d = Math.sqrt(d2), f = ((SD - d) / d) * 0.5; X[k] -= ex * f; X[k + 1] -= ey * f; X[k + 2] -= ez * f; X[k2] += ex * f; X[k2 + 1] += ey * f; X[k2 + 2] += ez * f;
            }
          }
        }
      }
    }
    doPins();
  }
  // stats: stretch of the neighbour links, particles that ended inside the collider (closer than 0.8 rs)
  let mx = 0, sum = 0, cnt = 0, inside = 0; const es = [];
  for (let c = 0; c < nc; c++) if (ck[c] === 0) { const a = CA[c], b = CB[c], e = Math.hypot(X[b] - X[a], X[b + 1] - X[a + 1], X[b + 2] - X[a + 2]) / CR[c] - 1; mx = Math.max(mx, e); sum += e; cnt++; es.push(e); }
  es.sort((a, b) => a - b);
  for (let k = 0; k < n3; k += 3) if (nearest(G, X[k], X[k + 1], X[k + 2], rs * 0.8, out) >= 0) inside++;
  return { P: X, W, H, stats: { ms: Math.round(performance.now() - t0), particles: n, constraints: nc, maxStretch: +mx.toFixed(3), p99Stretch: +es[Math.floor(es.length * 0.99)].toFixed(3), p1Compress: +es[Math.floor(es.length * 0.01)].toFixed(3), meanStrain: +(sum / cnt).toFixed(4), inside, contacts } };
}

/** Starting pose + pins for a cloth hung over a horizontal bar running along x (chair rail, towel rail, basket rim,
 *  drying rack): row `fold` lies over a half cylinder of radius rho on top of the bar (top = y of the bar's top
 *  surface), rows before it hang on the -z side, rows after it on the +z side. Pins hold the middle of the fold row
 *  (|x - cx| < pinHalf) so the cloth cannot slide off while it settles. Keep the cloth narrower than the bar, and rho
 *  >= half the bar thickness + 2 cm, or the hanging sides start inside whatever is just below the bar.
 *  skew: the fold line runs diagonally (one corner hangs lower: never perfectly square); gather < 1 starts the cloth
 *  narrower than it is, so it settles into soft vertical waves instead of hanging like a board. */
export function overBar({ cx, top, cz, W, D, fold, rho = 0.035, pinHalf = null, skew = 0, gather = 1 }) {
  const yc = top - 0.01;                                   // arc centre just under the bar's top: apex clears it by rho - 1 cm
  const place = (i, j) => {
    const u = (i - (W - 1) / 2) * D, s = (j - fold) * D - skew * u, x = cx + u * gather, th = s / rho;
    if (Math.abs(th) < Math.PI / 2) return [x, yc + rho * Math.cos(th), cz + rho * Math.sin(th)];
    return [x, yc - (Math.abs(s) - (rho * Math.PI) / 2), cz + Math.sign(s) * rho];
  };
  const ph = pinHalf ?? Math.max(D, ((W - 1) * D) / 2 - 0.03), pins = [];
  for (let i = 0; i < W; i++) { const u = (i - (W - 1) / 2) * D; if (Math.abs(u) < ph) pins.push([i, Math.round(fold + (skew * u) / D)]); }
  return { place, pins };
}

/** Same as overBar for a round rim (basket, bucket, bowl, lampshade): the cloth's width follows the circle, so its
 *  edges do not start inside the rim. center = [x, z] of the rim circle, rimR(angle) its radius (may wobble), a0 =
 *  angle where the middle of the cloth hangs; rows before `fold` hang inside, rows after it outside. */
export function overRim({ center, rimR, top, a0, W, D, fold, rho = 0.03, pinHalf = null, skew = 0, gather = 1 }) {
  const yc = top - 0.01, R0 = rimR(a0);
  const place = (i, j) => {
    const u = (i - (W - 1) / 2) * D, s = (j - fold) * D - skew * u, a = a0 + (u * gather) / R0, th = s / rho, R = rimR(a);
    let y, dr;
    if (Math.abs(th) < Math.PI / 2) { y = yc + rho * Math.cos(th); dr = rho * Math.sin(th); } else { y = yc - (Math.abs(s) - (rho * Math.PI) / 2); dr = Math.sign(s) * rho; }
    return [center[0] + (R + dr) * Math.cos(a), y, center[1] + (R + dr) * Math.sin(a)];
  };
  const ph = pinHalf ?? Math.max(D, ((W - 1) * D) / 2 - 0.03), pins = [];
  for (let i = 0; i < W; i++) { const u = (i - (W - 1) / 2) * D; if (Math.abs(u) < ph) pins.push([i, Math.round(fold + (skew * u) / D)]); }
  return { place, pins };
}

// ------------------------------------------------------------------ swept shapes
/** Flat band along samples [{ p: Vector3, w: width direction, hw: half width, ht: half thickness }], stadium
 *  cross-section, closed ends. Socks, straps, shoelaces, ribbons, a folded belt. uv = (across, along) in metres. */
export function ribbon(samples) {
  const n = samples.length, ring = [], SEG = 3;
  for (let k = 0; k <= SEG; k++) { const a = -Math.PI / 2 + (k / SEG) * Math.PI; ring.push([1, Math.cos(a), Math.sin(a)]); }
  for (let k = 0; k <= SEG; k++) { const a = Math.PI / 2 + (k / SEG) * Math.PI; ring.push([-1, Math.cos(a), Math.sin(a)]); }
  const R = ring.length, pos = [], nor = [], uv = [], idx = [], T = V3(), Wd = V3(), Nn = V3();
  let len = 0;
  for (let i = 0; i < n; i++) {
    const s = samples[i]; if (i) len += s.p.distanceTo(samples[i - 1].p);
    T.subVectors(samples[Math.min(n - 1, i + 1)].p, samples[Math.max(0, i - 1)].p).normalize();
    Wd.copy(s.w).addScaledVector(T, -s.w.dot(T)).normalize(); Nn.crossVectors(Wd, T);
    for (const [sg, c, sn] of ring) {
      const lx = sg * (s.hw - s.ht) + s.ht * c, ly = s.ht * sn;
      pos.push(s.p.x + Wd.x * lx + Nn.x * ly, s.p.y + Wd.y * lx + Nn.y * ly, s.p.z + Wd.z * lx + Nn.z * ly);
      nor.push(Wd.x * c + Nn.x * sn, Wd.y * c + Nn.y * sn, Wd.z * c + Nn.z * sn); uv.push(lx + s.hw, len);
    }
  }
  for (let i = 0; i < n - 1; i++) for (let r = 0; r < R; r++) { const a = i * R + r, b = i * R + ((r + 1) % R), c = b + R, d = a + R; idx.push(a, b, c, a, c, d); }
  for (const e of [0, n - 1]) {
    const s = samples[e], o = samples[e === 0 ? 1 : n - 2], base = pos.length / 3; T.subVectors(s.p, o.p).normalize();
    pos.push(s.p.x, s.p.y, s.p.z); nor.push(T.x, T.y, T.z); uv.push(s.hw, len * (e ? 1 : 0));
    for (let r = 0; r < R; r++) { const k = (e * R + r) * 3; pos.push(pos[k], pos[k + 1], pos[k + 2]); nor.push(T.x, T.y, T.z); uv.push(s.hw, 0); }
    for (let r = 0; r < R; r++) idx.push(base, base + 1 + r, base + 1 + ((r + 1) % R));
  }
  return orient(geoFrom(pos, nor, uv, idx));
}
/** Cable / wire / cord through points: sampled densely, then thinned adaptively (a vertex ring where it bends or
 *  every maxLen), parallel-transport frames (no twisting), radius r. */
export function cable(points, r = 0.0015, { radial = 6, maxAng = 0.2, maxLen = 0.03 } = {}) {
  const c = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const raw = c.getSpacedPoints(Math.max(40, Math.ceil(c.getLength() / 0.0015)));
  const keep = [raw[0]]; let last = 0; const dPrev = V3().subVectors(raw[1], raw[0]).normalize(), d = V3();
  for (let i = 1; i < raw.length - 1; i++) { d.subVectors(raw[i + 1], raw[i]).normalize(); if (d.angleTo(dPrev) > maxAng || raw[i].distanceTo(raw[last]) > maxLen) { keep.push(raw[i]); last = i; dPrev.copy(d); } }
  keep.push(raw[raw.length - 1]);
  const n = keep.length, pos = [], nor = [], uv = [], idx = [], T = V3(), B = V3(), N = V3(0, 1, 0);
  let len = 0;
  for (let i = 0; i < n; i++) {
    if (i) len += keep[i].distanceTo(keep[i - 1]);
    T.subVectors(keep[Math.min(n - 1, i + 1)], keep[Math.max(0, i - 1)]).normalize();
    if (i === 0 && Math.abs(T.y) > 0.9) N.set(1, 0, 0);
    N.addScaledVector(T, -N.dot(T)).normalize(); B.crossVectors(T, N);
    for (let j = 0; j <= radial; j++) { const a = (j / radial) * TAU, cs = Math.cos(a), sn = Math.sin(a), x = cs * N.x + sn * B.x, y = cs * N.y + sn * B.y, z = cs * N.z + sn * B.z; pos.push(keep[i].x + x * r, keep[i].y + y * r, keep[i].z + z * r); nor.push(x, y, z); uv.push(j / radial, len); }
  }
  const Wr = radial + 1;
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < radial; j++) { const a = i * Wr + j, b = a + Wr; idx.push(a, a + 1, b, b, a + 1, b + 1); }
  return orient(geoFrom(pos, nor, uv, idx));
}

// ------------------------------------------------------------------ props
/** A sock taken off and dropped: a flattened ribbon (stadium section) with a heel bulge, a bend at the ankle,
 *  a tapering toe and a little crumple. Returns { cuff, foot } geometries (rib cuff vs. plain knit) in world space. */
export function sock(m4, { seed = 5, bend = 0.8, leg = 0.15, length = 0.345, width = 0.043, cuff = 0.05 } = {}) {
  const n = 46, ds = length / n, S = []; let x = 0, z = 0;
  for (let k = 0; k <= n; k++) {
    const s = k * ds, ang = bend * smoothstep(leg - 0.04, leg + 0.04, s) + 0.12 * Math.sin(s * 19 + seed);
    if (k) { x += Math.cos(ang) * ds; z += Math.sin(ang) * ds; }
    const toe = Math.max(0, (s - (length - 0.04)) / 0.04), heel = Math.exp(-(((s - leg) / 0.03) ** 2));
    const hw = Math.max(0.006, (lerp(width, width * 0.9, smoothstep(0, 0.1, s)) + 0.006 * heel) * Math.sqrt(Math.max(0.02, 1 - toe * toe)));
    const ht = Math.min(hw * 0.6, (0.0044 + 0.002 * fbm2(s * 40 + seed, 3.1, 2, seed) + 0.0022 * heel) * (k === 0 ? 0.35 : 1) * (1 - 0.5 * toe * toe));
    const lift = 0.0018 * Math.max(0, Math.sin(s * 31 + seed * 1.7)) * smoothstep(0.02, 0.06, s) * (1 - toe);
    S.push({ p: V3(x, ht + 0.0004 + lift, z).applyMatrix4(m4), w: V3(-Math.sin(ang), 0, Math.cos(ang)).transformDirection(m4), hw, ht });
  }
  const cut = Math.round(cuff / ds);
  return { cuff: ribbon(S.slice(0, cut + 1)), foot: ribbon(S.slice(cut)) };
}
/** Mug: lathe body (glaze breaks thin over the rim, unglazed foot ring), half a cup of tea left: tide marks inside
 *  painted into vertex colours (rgb) — multiply with a glaze material (vertexColors: true). Handle as a tube. */
export function mug({ glaze = [0.79, 0.61, 0.57], tea = 0.055, old = 0.0778 } = {}) {
  const body = lath([[0, 0.0012], [0.027, 0.0012], [0.0285, 0], [0.032, 0], [0.0365, 0.0026], [0.0396, 0.009], [0.0405, 0.02], [0.0405, 0.086], [0.0399, 0.0891], [0.0386, 0.09], [0.0373, 0.0891], [0.0367, 0.086], [0.0367, 0.013], [0.034, 0.0072], [0, 0.0066]], 72, 0.0025);
  const p = body.attributes.position, col = new Float32Array(p.count * 3), mix = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), zz = p.getZ(i), rad = Math.hypot(x, zz), a = Math.atan2(zz, x);
    let c = glaze;
    if (y > 0.0875) c = mix(glaze, [0.6, 0.42, 0.34], 0.5 * smoothstep(0.0875, 0.0895, y));
    else if (y < 0.0028 && rad > 0.026) c = [0.78, 0.7, 0.6];
    else if (rad < 0.0368 && y > tea - 0.001 && y < 0.081) {
      const nn = 0.5 + 0.5 * Math.sin(a * 3 + 1) * Math.sin(a * 7 + 2.2), line = Math.exp(-(((y - tea - 0.0006 - 0.0012 * Math.sin(a * 2)) / 0.0011) ** 2));
      const oldL = Math.exp(-(((y - old - 0.0007 * Math.sin(a * 3 + 1)) / 0.0009) ** 2)), film = smoothstep(tea + 0.011, tea, y) * 0.28 + smoothstep(0.081, 0.07, y) * 0.07;
      c = mix(glaze, [0.42, 0.26, 0.14], clamp(line * (0.45 + 0.4 * nn) + oldL * (0.26 + 0.3 * nn) + film * (0.4 + 0.6 * nn), 0, 0.85));
    }
    col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
  }
  body.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const hp = [[0.039, 0.071], [0.052, 0.0738], [0.0645, 0.0645], [0.068, 0.048], [0.0625, 0.031], [0.05, 0.0222], [0.039, 0.022]].map((q) => V3(q[0], q[1], 0));
  const handle = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(hp), 40, 0.0047, 18).applyMatrix4(new THREE.Matrix4().makeScale(1, 1, 1.55));
  handle.setAttribute('color', new THREE.BufferAttribute(new Float32Array(handle.attributes.position.count * 3).map((_, i) => glaze[i % 3]), 3));
  const surf = new THREE.CircleGeometry(0.0366, 48).rotateX(-Math.PI / 2).translate(0, tea, 0);   // the tea
  return { body: merge([body, handle], { color: true }), tea: surf };
}
/** Steel bottle: lathe body with a shoulder, the cap screwed on only so far (two turns of thread show), knurled grip
 *  on the cap (radius modulated 60x round), a carry loop. Returns { coat, steel, loop }. */
export function bottle() {
  const sh = []; for (let k = 0; k <= 8; k++) { const a = (k / 8) * (Math.PI / 2); sh.push([0.0245 + 0.011 * Math.cos(a), 0.166 + 0.03 * Math.sin(a)]); }
  const coat = lath([[0.0342, 0.012], [0.0355, 0.0145], [0.0355, 0.166], ...sh.slice(1), [0.0245, 0.203]], 56);
  const yc = 0.2086, CP = [[0.0258, 0, 0], [0.0268, 0.0012, 0.2], [0.027, 0.0032, 1], [0.027, 0.0296, 1], [0.0268, 0.0318, 0.2], [0.026, 0.035, 0], [0.0236, 0.0365, 0], [0.0002, 0.0365, 0]];
  const cap = skin(sampleGrid((u, v, p) => { const q = CP[Math.round(v * (CP.length - 1))], a = -u * TAU, r = q[0] - q[2] * 0.00028 * (0.5 + 0.5 * Math.cos(a * 60)); p.set(r * Math.cos(a), yc + q[1], r * Math.sin(a)); }, 240, CP.length - 1, { closedU: true, from: [0, yc + 0.015, 0] }));
  const steel = merge([
    lath([[0, 0.0005], [0.0305, 0.0005], [0.033, 0.0014], [0.0342, 0.004], [0.0342, 0.012]], 56),
    lath([[0.0245, 0.2022], [0.0238, 0.2032], [0.0226, 0.2036], [0.0226, 0.2092]], 56, 0.008),
    new THREE.TorusGeometry(0.0229, 0.00055, 6, 56).rotateX(Math.PI / 2 + 0.022).translate(0, 0.2049, 0),
    new THREE.TorusGeometry(0.0229, 0.00055, 6, 56).rotateX(Math.PI / 2 + 0.022).translate(0, 0.2069, 0), cap,
  ]);
  const loop = merge([new THREE.TorusGeometry(0.0135, 0.0031, 10, 28, Math.PI).translate(0, yc + 0.0359, 0), new THREE.TorusGeometry(0.0246, 0.0007, 6, 56).rotateX(Math.PI / 2).translate(0, yc - 0.0002, 0)]);
  return { coat, steel, loop };
}
/** A ball of crumpled paper: an icosphere pushed out by |2·fbm − 1| (ridged: sharp creases, flat facets), flat-shaded. */
export function paperBall(r = 0.03, seed = 3) {
  const g = new THREE.IcosahedronGeometry(r, 2), p = g.attributes.position, v = V3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const n = fbm3((v.x / r) * 1.6 + seed, (v.y / r) * 1.6, (v.z / r) * 1.6, 2, seed); v.multiplyScalar(0.76 + 0.5 * Math.abs(n * 2 - 1)); p.setXYZ(i, v.x, v.y * 0.9, v.z); }
  g.computeVertexNormals();
  const bb = new THREE.Box3().setFromBufferAttribute(p); g.translate(0, -bb.min.y, 0);   // resting on y = 0
  return g;
}
/** Soft coiled-rope basket: a lathe profile (base, flaring wall, rolled rim, inner wall) that sags oval and leans,
 *  never perfectly round. Returns { wall, rimY, rimR(a) } — rimR(angle) gives the rim radius for draping. */
export function ropeBasket({ H = 0.42, R0 = 0.158, R1 = 0.19, TH = 0.013, seed = 31 } = {}) {
  const YR = H - 0.006, prof = [[R0 - 0.02, 0.001], [R0 - 0.004, 0.003], [R0, 0.012]];
  for (let k = 1; k <= 10; k++) prof.push([lerp(R0, R1, k / 10), lerp(0.012, YR, k / 10)]);
  for (let k = 1; k <= 5; k++) { const a = (k / 5) * Math.PI; prof.push([R1 - TH / 2 + (TH / 2) * Math.cos(a), YR + (TH / 2) * Math.sin(a)]); }
  for (let k = 1; k <= 8; k++) prof.push([lerp(R1 - TH, R0 - TH, k / 8), lerp(YR, 0.02, k / 8)]);
  prof.push([R0 - TH - 0.02, 0.016], [0.002, 0.016]);
  const L = [0]; for (let i = 1; i < prof.length; i++) L.push(L[i - 1] + Math.hypot(prof[i][0] - prof[i - 1][0], prof[i][1] - prof[i - 1][1]));
  const tot = L[L.length - 1], at = (t) => { const s = clamp(t) * tot; let i = 1; while (i < prof.length - 1 && L[i] < s) i++; const k = (s - L[i - 1]) / Math.max(1e-9, L[i] - L[i - 1]); return [lerp(prof[i - 1][0], prof[i][0], k), lerp(prof[i - 1][1], prof[i][1], k)]; };
  const wob = (a, y) => 1 + (y / H) * (0.03 * Math.cos(2 * a + 0.7) + 0.018 * Math.cos(3 * a + 2.1)) + 0.012 * (fbm2(Math.cos(a) * 1.3 + 4, Math.sin(a) * 1.3 + y * 9, 2, seed) - 0.5);
  const lean = (y) => 0.012 * (y / H) ** 2;
  const wall = skin(sampleGrid((u, v, o) => { const a = u * TAU, [r, y] = at(v), k = wob(a, y); return o.set(r * k * Math.cos(a) + lean(y), y, r * k * Math.sin(a)); }, 60, 78, { closedU: true, from: [0, H / 2, 0], rows: [4, 24] }), 1.2, tot);
  return { wall, H, YR, rimR: (a) => (R1 - TH / 2) * wob(a, H), lean: lean(H) };
}
