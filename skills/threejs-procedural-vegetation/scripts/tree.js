// Procedural deciduous trees: branching skeleton -> bark tubes (parallel-transport frames) + instanced leaf cards.
// Every vertex / card carries its wind hierarchy (aW1 limb pivot+length, aW2 branch pivot+length, aW3 trunk x, z,
// tree height, ground y) so the vertex shader can sway trunk -> limb -> branch -> leaf as a pure function of time.
// Adapted from room-at-dawn (MIT) src/scene/parts/exterior.js. Generalised: any ground height per tree, LOD and
// "keep" callbacks instead of the original window-visibility tests, per-card openness (crown AO) for real-time lighting.
import * as THREE from 'three';
import { RNG, TAU, UP, Z4, clamp, lerp, smoothstep, sub, madd, nrm, cross, lerp3, mix3 } from './util.js';
import { TILE_SCALE } from './atlas.js';

// ------------------------------------------------------------------ geometry accumulators
export class Bark {
  constructor() { this.p = []; this.n = []; this.uv = []; this.w1 = []; this.w2 = []; this.w3 = []; this.ix = []; this.count = 0; }
  /** tapered tube along pts (parallel-transport frames), winding outwards */
  tube(pts, rad, radial, w1, w2, w3) {
    const m = pts.length, base = this.count, uRep = Math.max(1, Math.round(TAU * rad[0] * 1.6)), W = radial + 1;
    let T = nrm(sub(pts[1], pts[0])), Nn = nrm(cross(T, Math.abs(T[1]) < 0.9 ? UP : [1, 0, 0])), vl = 0;
    for (let i = 0; i < m; i++) {
      T = nrm(sub(pts[Math.min(m - 1, i + 1)], pts[Math.max(0, i - 1)]));
      const d = Nn[0] * T[0] + Nn[1] * T[1] + Nn[2] * T[2]; Nn = nrm([Nn[0] - T[0] * d, Nn[1] - T[1] * d, Nn[2] - T[2] * d]);
      const B = cross(T, Nn), P = pts[i], r = rad[i];
      if (i) vl += Math.hypot(P[0] - pts[i - 1][0], P[1] - pts[i - 1][1], P[2] - pts[i - 1][2]);
      for (let j = 0; j <= radial; j++) {
        const a = (j / radial) * TAU, cs = Math.cos(a), sn = Math.sin(a), nx = cs * Nn[0] + sn * B[0], ny = cs * Nn[1] + sn * B[1], nz = cs * Nn[2] + sn * B[2];
        this.p.push(P[0] + nx * r, P[1] + ny * r, P[2] + nz * r); this.n.push(nx, ny, nz); this.uv.push((j / radial) * uRep, vl * 1.6);
        this.w1.push(w1[0], w1[1], w1[2], w1[3]); this.w2.push(w2[0], w2[1], w2[2], w2[3]); this.w3.push(w3[0], w3[1], w3[2], w3[3] || 0);
      }
    }
    for (let i = 0; i < m - 1; i++) for (let j = 0; j < radial; j++) { const a = base + i * W + j, b = a + W; this.ix.push(a, a + 1, b, b, a + 1, b + 1); }
    this.count += m * W;
  }
  geo() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aW1', new THREE.Float32BufferAttribute(this.w1, 4)); g.setAttribute('aW2', new THREE.Float32BufferAttribute(this.w2, 4)); g.setAttribute('aW3', new THREE.Float32BufferAttribute(this.w3, 4));
    g.setIndex(this.ix); return g;
  }
}

export class Leaves {
  constructor() { this.m = []; this.c = []; this.w1 = []; this.w2 = []; this.w3 = []; this.lf = []; this.op = []; this.n = 0; this.open = 1; }
  /** card with its stem at p, growing along unit Y, face normal as close to Zp as possible */
  card(px, py, pz, Y, Zp, len, wid, tile, tint, w1, w2, w3, ph, fl) {
    const d = Zp[0] * Y[0] + Zp[1] * Y[1] + Zp[2] * Y[2];
    let zx = Zp[0] - Y[0] * d, zy = Zp[1] - Y[1] * d, zz = Zp[2] - Y[2] * d, l = Math.hypot(zx, zy, zz);
    if (l < 1e-3) { const c = cross(Y, Math.abs(Y[1]) < 0.9 ? UP : [1, 0, 0]); zx = c[0]; zy = c[1]; zz = c[2]; l = Math.hypot(zx, zy, zz); }
    zx /= l; zy /= l; zz /= l;
    const xx = Y[1] * zz - Y[2] * zy, xy = Y[2] * zx - Y[0] * zz, xz = Y[0] * zy - Y[1] * zx;
    this.m.push(xx * wid, xy * wid, xz * wid, 0, Y[0] * len, Y[1] * len, Y[2] * len, 0, zx * wid, zy * wid, zz * wid, 0, px, py, pz, 1);
    this.c.push(tint[0], tint[1], tint[2]);
    this.w1.push(w1[0], w1[1], w1[2], w1[3]); this.w2.push(w2[0], w2[1], w2[2], w2[3]); this.w3.push(w3[0], w3[1], w3[2], w3[3] || 0);
    this.lf.push((tile & 3) / 4, (tile >> 2) / 4, ph, fl);
    this.op.push(this.open);   // set by the caller before card(): 0 deep inside the crown .. 1 on its sunlit outside
    this.n++;
  }
  /** foliage clump card centred on (x, y, z) with normal N */
  blob(x, y, z, N, size, tile, tint, w1, w2, w3, rng, fl) {
    let Y; do { Y = [rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)]; const d = Y[0] * N[0] + Y[1] * N[1] + Y[2] * N[2]; Y = [Y[0] - N[0] * d, Y[1] - N[1] * d, Y[2] - N[2] * d]; } while (Math.hypot(Y[0], Y[1], Y[2]) < 0.2);
    Y = nrm(Y);
    this.card(x - Y[0] * size * 0.5, y - Y[1] * size * 0.5, z - Y[2] * size * 0.5, Y, N, size, size, tile, tint, w1, w2, w3, rng.next(), fl);
  }
  /** eye: [x,y,z] the cards are sorted front-to-back from (early-z rejects what they hide). */
  build(mat, eye = [0, 1.6, 0]) {
    const n = this.n, ord = new Uint32Array(n), key = new Float32Array(n);
    for (let i = 0; i < n; i++) { ord[i] = i; const o = i * 16 + 12; key[i] = (this.m[o] - eye[0]) ** 2 + (this.m[o + 1] - eye[1]) ** 2 + (this.m[o + 2] - eye[2]) ** 2; }
    ord.sort((a, b) => key[a] - key[b]);                           // near cards first: early-z rejects what they hide
    const pick = (srcArr, k) => { const out = new Float32Array(n * k); for (let i = 0; i < n; i++) { const s = ord[i] * k; for (let j = 0; j < k; j++) out[i * k + j] = srcArr[s + j]; } return out; };
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute([-0.3, 0.14, 0.94, 0.3, 0.14, 0.94, 0.3, -0.14, 0.94, -0.3, -0.14, 0.94], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    geo.setAttribute('aW1', new THREE.InstancedBufferAttribute(pick(this.w1, 4), 4)); geo.setAttribute('aW2', new THREE.InstancedBufferAttribute(pick(this.w2, 4), 4));
    geo.setAttribute('aW3', new THREE.InstancedBufferAttribute(pick(this.w3, 4), 4)); geo.setAttribute('aLeaf', new THREE.InstancedBufferAttribute(pick(this.lf, 4), 4));
    geo.setAttribute('aOpen', new THREE.InstancedBufferAttribute(pick(this.op, 1), 1));
    const im = new THREE.InstancedMesh(geo, mat, n);
    im.instanceMatrix.array.set(pick(this.m, 16)); im.instanceMatrix.needsUpdate = true;
    im.instanceColor = new THREE.InstancedBufferAttribute(pick(this.c, 3), 3);
    im.name = 'leaves'; im.frustumCulled = false;
    im.userData.giInstanced = true; im.userData.giNormal = new THREE.Vector3(0, 0, 1); im.userData.giAnchor = new THREE.Vector3(0, 0.5, 0);
    return im;
  }
}

export class Soup {
  constructor() { this.p = []; this.n = []; this.uv = []; this.ix = []; }
  /** tessellated parallelogram p0 + eu*a + ev*b, facing eu x ev. uvs = metres->uv scale, or null for 0..1 */
  quad(p0, eu, ev, maxEdge = 1, uvs = null) {
    const lu = Math.hypot(eu[0], eu[1], eu[2]), lv = Math.hypot(ev[0], ev[1], ev[2]), nu = Math.max(1, Math.ceil(lu / maxEdge)), nv = Math.max(1, Math.ceil(lv / maxEdge));
    const nn = nrm(cross(eu, ev)), base = this.p.length / 3;
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const a = i / nu, b = j / nv;
      this.p.push(p0[0] + eu[0] * a + ev[0] * b, p0[1] + eu[1] * a + ev[1] * b, p0[2] + eu[2] * a + ev[2] * b); this.n.push(nn[0], nn[1], nn[2]);
      if (uvs) this.uv.push(a * lu * uvs[0], b * lv * uvs[1]); else this.uv.push(a, b);
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const q = base + j * (nu + 1) + i; this.ix.push(q, q + 1, q + nu + 2, q, q + nu + 2, q + nu + 1); }
  }
  tri(a, b, c) {
    const nn = nrm(cross(sub(b, a), sub(c, a))), base = this.p.length / 3;
    for (const q of [a, b, c]) { this.p.push(q[0], q[1], q[2]); this.n.push(nn[0], nn[1], nn[2]); this.uv.push(0, 0); }
    this.ix.push(base, base + 1, base + 2);
  }
  geo() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2)); g.setIndex(this.ix); return g;
  }
}

// ------------------------------------------------------------------ trees
export const SPECIES = {
  // tiles: atlas tiles to pick from, card: spray length (m), droop: how far sprays hang, twig: twig length (m),
  // twigUp: [start, end] vertical pull along a twig, light / deep: per-instance tint range (linear multipliers)
  rob: { tiles: [0, 1, 0, 1, 2, 3, 7], card: 0.36, droop: [0.15, 0.95], twig: 0.95, twigUp: [-0.1, -0.9], droop2: -0.12, sp: 0.042, light: [1.2, 1.08, 0.6], deep: [0.64, 0.8, 0.52] },
  ash: { tiles: [4, 5, 4, 5, 6], card: 0.42, droop: [0.1, 0.75], twig: 0.9, twigUp: [0.1, -0.6], droop2: -0.08, sp: 0.05, light: [1.25, 1.12, 0.58], deep: [0.74, 0.86, 0.5] },
  lime: { tiles: [8, 9, 10, 11], card: 0.31, droop: [0.0, 0.6], twig: 0.85, twigUp: [0.15, -0.45], droop2: -0.05, sp: 0.04, light: [1.02, 1.02, 0.62], deep: [0.56, 0.76, 0.5] },
};

function grow(rng, p0, d0, len, n, up0 = 0, up1 = 0, wig = 0.1) {
  const pts = [p0], tan = [d0], ds = len / n, w = wig * Math.sqrt(ds);
  let p = p0, d = d0;
  for (let i = 1; i <= n; i++) {
    d = nrm([d[0] + rng.gauss() * w, d[1] + lerp(up0, up1, i / n) * ds + rng.gauss() * w * 0.7, d[2] + rng.gauss() * w]);
    p = madd(p, d, ds); pts.push(p); tan.push(d);
  }
  return { pts, tan, len, n };
}
function at(b, t) {
  const f = clamp(t, 0, 1) * b.n, i = Math.min(b.n - 1, Math.floor(f)), k = f - i;
  return [lerp3(b.pts[i], b.pts[i + 1], k), nrm(lerp3(b.tan[i], b.tan[i + 1], k))];
}
/** direction at angle a from tg; phi = 0 is the horizontal side, pi/2 is "up" */
function dirAround(tg, a, phi) {
  let e1 = cross(tg, UP); const l = Math.hypot(e1[0], e1[1], e1[2]);
  e1 = l < 0.2 ? nrm(cross(tg, [1, 0, 0])) : [e1[0] / l, e1[1] / l, e1[2] / l];
  const e2 = cross(e1, tg), ca = Math.cos(a), sa = Math.sin(a), cp = Math.cos(phi) * sa, sp = Math.sin(phi) * sa;
  return nrm([tg[0] * ca + e1[0] * cp + e2[0] * sp, tg[1] * ca + e1[1] * cp + e2[1] * sp, tg[2] * ca + e1[2] * cp + e2[2] * sp]);
}

export function makeTree(S, bark, LV, opts = {}) {
  const rng = new RNG(S.seed), hero = S.lod === 0;
  const sp = hero ? SPECIES[S.sp] : { light: mix3([1.2, 1.1, 0.6], [0.95, 1.0, 0.62], rng.next()), deep: mix3([0.58, 0.78, 0.52], [0.8, 0.88, 0.5], rng.next()), droop2: -0.06 };
  const G = S.y ?? 0, H = S.H, top = G + H, w3 = [S.x, S.z, H, G];
  const T = { S, sp, rng, bark, LV, w3, hero, G, lodAt: opts.lodAt || (() => 2), keep: opts.keep || (() => true) };
  const trunk = grow(rng, [S.x, G - 0.3, S.z], nrm([S.lean[0], 1, S.lean[1]]), H * S.trunk + 0.3, 8, 0, 0, 0.035);
  const r0 = H * 0.019, tr = (t) => r0 * (1 - 0.5 * t) * (1 + 1.1 * Math.exp(-t * 18));
  bark.tube(trunk.pts, trunk.pts.map((_, i) => tr(i / 8)), hero ? 10 : 6, Z4, Z4, w3);
  const limbs = [];
  for (let i = 0; i < S.limbs; i++) {
    const f = i / (S.limbs - 1), ta = lerp(S.first, 1, Math.pow(f, 0.8)), pa = at(trunk, ta)[0];
    const az = S.az0 + i * 2.39996 + rng.range(-0.3, 0.3), inc = lerp(1.2, 0.12, Math.pow(f, 1.25)) + rng.range(-0.1, 0.1);
    let len = (S.R / Math.max(Math.sin(inc), 0.45)) * rng.range(0.8, 1.05);
    len = Math.min(len, ((top - pa[1]) / Math.max(0.35, Math.cos(inc))) * rng.range(0.92, 1));
    limbs.push({ p: pa, d: [Math.sin(inc) * Math.cos(az), Math.cos(inc), Math.sin(inc) * Math.sin(az)], len, up0: 0.2, up1: -0.07, r: tr(ta) });
  }
  for (const e of S.extra || []) {      // art-directed limbs (e.g. one reaching towards the window)
    const pa = at(trunk, e.t)[0], v = sub(e.to, pa), len = Math.hypot(v[0], v[1], v[2]);
    limbs.push({ p: pa, d: nrm([v[0], v[1] + len * 0.1, v[2]]), len, up0: 0, up1: -0.05, r: tr(e.t) });
  }
  for (const Lb of limbs) limb(T, Lb);
}

function limb(T, Lb) {
  const { S, rng, bark, w3, hero } = T, len = Lb.len, n = Math.max(5, Math.round(len / (hero ? 0.45 : 0.9)));
  const b = grow(rng, Lb.p, Lb.d, len, n, Lb.up0, Lb.up1, 0.09);
  const rB = Math.min(Lb.r * 0.8, 0.028 + len * 0.016), w1 = [Lb.p[0], Lb.p[1], Lb.p[2], len], rad = (i) => rB * Math.pow(1 - i / n, 0.75) + 0.011;
  bark.tube(b.pts, b.pts.map((_, i) => rad(i)), hero ? 6 : S.lod === 1 ? 5 : 4, w1, Z4, w3);   // <= 6 around: thin tips stay splittable for the bake's BVH
  if (S.lod === 2) { const p = at(b, 0.6)[0]; foliage(T, b, 0.28, Math.round(len * S.dens), 1.25, 1.5, w1, [p[0], p[1], p[2], len * 0.5], [12, 13, 14]); return; }
  const n2 = Math.max(2, Math.round(len * S.d2));
  for (let j = 0; j < n2; j++) {
    const t = lerp(0.16, 0.99, (j + rng.range(0.15, 0.85)) / n2), [p, tg] = at(b, t);
    const l2 = clamp(len * lerp(0.5, 0.2, t) * rng.range(0.7, 1.15), 0.6, 3.2);
    const d = dirAround(tg, rng.range(0.7, 1.15), j * 2.4 + rng.range(-0.5, 0.5));
    if (d[1] < -0.25) d[1] *= 0.3;
    branch(T, p, nrm(d), l2, Math.min(rad(t * n) * 0.6, 0.012 + l2 * 0.011), w1);
  }
  branch(T, b.pts[n], b.tan[n], clamp(len * 0.18, 0.6, 1.6), 0.013, w1);   // the limb's tip carries on
}

function branch(T, p0, d0, len, r, w1) {
  const { S, sp, rng, bark, w3, hero } = T, n = Math.max(3, Math.round(len / (hero ? 0.4 : 0.7)));
  const b = grow(rng, p0, d0, len, n, 0.14, sp.droop2, 0.17), w2 = [p0[0], p0[1], p0[2], len];
  bark.tube(b.pts, b.pts.map((_, i) => r * Math.pow(1 - i / n, 0.8) + 0.0045), hero ? 4 : 3, w1, w2, w3);
  if (!hero) { foliage(T, b, 0.15, Math.round(len * S.dens), 0.42, S.size, w1, w2, [12, 13, 12, 14]); return; }
  const tw = rng.next(), n3 = Math.round(len * S.d3);
  for (let k = 0; k < n3; k++) {
    const t = lerp(0.1, 0.97, (k + rng.range(0.2, 0.8)) / n3), [p, tg] = at(b, t);
    const d = dirAround(tg, rng.range(0.65, 1.1), (k & 1 ? 0 : Math.PI) + rng.gauss() * 0.65);
    d[1] += 0.08;
    twig(T, p, nrm(d), sp.twig * lerp(1, 0.5, t) * rng.range(0.65, 1.2), w1, w2, tw);
  }
  twig(T, b.pts[n], b.tan[n], sp.twig * 0.7, w1, w2, tw);
}

function twig(T, p0, d0, len, w1, w2, tw) {
  const { S, sp, rng, bark, LV, w3 } = T;
  const b = grow(rng, p0, d0, len, 3, sp.twigUp[0], sp.twigUp[1], 0.28), e = b.pts[3];
  const mx = (p0[0] + e[0]) / 2, my = (p0[1] + e[1]) / 2, mz = (p0[2] + e[2]) / 2;
  if (!T.keep(mx, my, mz, rng)) return;                               // e.g. keep a sight line free, or nothing too close to a window
  const lod = T.lodAt(mx, my, mz), out = nrm([mx - S.x, 0, mz - S.z]);
  LV.open = openness(T, mx, my, mz);
  if (lod === 0) {                                                  // never seen: a big cheap card keeps its shade in the bake
    if (rng.chance(0.55)) LV.blob(mx, my, mz, nrm([rng.gauss() * 0.5, 1, rng.gauss() * 0.5]), sp.card * 2.4, sp.tiles[rng.int(0, sp.tiles.length - 1)], mix3(sp.deep, sp.light, 0.4), w1, w2, w3, rng, 0.6);
    return;
  }
  const r0 = 0.0035 + len * 0.006;
  bark.tube(b.pts, [r0, r0 * 0.75, r0 * 0.5, 0.0024], 3, w1, w2, w3);
  const step = sp.sp * S.sparse * (lod === 1 ? 2.3 : 1), big = lod === 1 ? 1.45 : 1;
  let k = rng.int(0, 1);
  const put = (p, tg, a, tip) => {
    let s = cross(tg, UP); const sl = Math.hypot(s[0], s[1], s[2]); s = sl < 0.15 ? [1, 0, 0] : [s[0] / sl, s[1] / sl, s[2] / sl];
    const u2 = cross(s, tg), sg = k++ & 1 ? 1 : -1, roll = rng.gauss() * 0.75 + 0.25, cr = Math.cos(roll) * sg, sr = Math.sin(roll);
    const ca = Math.cos(a), sa = Math.sin(a);
    const Y = nrm([tg[0] * ca + (s[0] * cr + u2[0] * sr) * sa, tg[1] * ca + (s[1] * cr + u2[1] * sr) * sa - rng.range(sp.droop[0], sp.droop[1]), tg[2] * ca + (s[2] * cr + u2[2] * sr) * sa]);
    const Zp = [out[0] * 0.55 + rng.gauss() * 0.6, 0.7 + rng.gauss() * 0.45, out[2] * 0.55 + rng.gauss() * 0.6];
    const tile = sp.tiles[rng.int(0, sp.tiles.length - 1)], size = sp.card * TILE_SCALE[tile] * rng.range(0.8, 1.2) * big;
    const v = clamp(tw * 0.55 + rng.next() * 0.45 + tip * 0.25 - 0.1);
    const tint = rng.chance(0.025) ? [rng.range(1.2, 1.45), rng.range(1.06, 1.2), 0.5] : mix3(sp.deep, sp.light, v, rng.range(0.8, 1.14));   // the odd yellowing spray
    LV.card(p[0], p[1], p[2], Y, Zp, size, size, tile, tint, w1, w2, w3, rng.next(), 1);
  };
  for (let s = len * 0.1 + rng.range(0, step); s < len; s += step * rng.range(0.75, 1.3)) { const [p, tg] = at(b, s / len); put(p, tg, rng.range(0.55, 1.2), s / len); }
  put(e, b.tan[3], rng.range(0, 0.3), 1);
}

/** clumps of foliage cards scattered around a branch (mid / far trees) */
function foliage(T, b, t0, n, rad, size, w1, w2, tiles) {
  const { S, sp, rng, LV, w3 } = T;
  for (let i = 0; i < n; i++) {
    const p = at(b, lerp(t0, 1, Math.sqrt(rng.next())))[0];
    let ox, oy, oz; do { ox = rng.range(-1, 1); oy = rng.range(-1, 1); oz = rng.range(-1, 1); } while (ox * ox + oy * oy + oz * oz > 1);
    const x = p[0] + ox * rad, y = p[1] + oy * rad * 0.75 + rad * 0.1, z = p[2] + oz * rad;
    if (!T.keep(x, y, z, rng)) continue;
    const lod = T.lodAt(x, y, z); if (lod === 0 && rng.next() > 0.3) continue;
    LV.open = openness(T, x, y, z);
    const out = nrm([x - S.x, 0, z - S.z]);
    const N = nrm([out[0] * 0.5 + rng.gauss() * 0.7, 0.55 + rng.gauss() * 0.6, out[2] * 0.5 + rng.gauss() * 0.7]);
    LV.blob(x, y, z, N, size * rng.range(0.75, 1.25), tiles[rng.int(0, tiles.length - 1)], mix3(sp.deep, sp.light, rng.next(), rng.range(0.8, 1.12)), w1, w2, w3, rng, 0.45);
  }
}


/** How exposed a point of the crown is (0 deep inside .. 1 on the outside / top): stands in for the baked sky
 *  visibility the original read from its light bake. Crown modelled as an ellipsoid around the upper trunk. */
function openness(T, x, y, z) {
  const { S, G } = T, cy = G + S.H * (S.first ?? 0.4) + (S.H * (1 - (S.first ?? 0.4))) * 0.5, ry = S.H * (1 - (S.first ?? 0.4)) * 0.55;
  const dx = (x - S.x) / S.R, dy = (y - cy) / ry, dz = (z - S.z) / S.R, r = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return clamp(smoothstep(0.35, 1.0, r) * 0.8 + smoothstep(-0.2, 0.9, dy) * 0.35);
}
