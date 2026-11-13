// Hanging cloth (curtains) for three.js — designed, not simulated.
// A panel is a sheet of flat width L hung from rings. Every horizontal section is built by integrating a
// heading angle along the cloth, so the sheet never stretches sideways; the angle field is then scaled until the
// section spans exactly the gathered width at that height (tight at the rings, flaring at the hem).
// Near the top the cloth is creased where a ring clips it and bellies out between rings; further down the
// creases relax into round folds and a second, broader set of folds takes over.
//
// Adapted from room-at-dawn (MIT, github.com/Leonxlnx/room-at-dawn) src/scene/parts/fixtures.js (curtainPanel,
// linenMaps, buildCurtains). Units: metres. The panel hangs in the XY plane; +Z is "into the room".
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RNG, pn, lerp, clamp, smoothstep, normalFromHeight } from './cloth.js';

const PI = Math.PI, D2R = PI / 180;
/** fbm 0..1 on top of cloth.js value noise. */
export const fbm = (x, y, oct, seed) => { let a = 0, s = 0, f = 1, w = 1; for (let o = 0; o < oct; o++) { a += w * pn(x * f, y * f, seed + o * 17); s += w; f *= 2; w *= 0.5; } return a / s; };
const softClamp = (z, lo, hi, w = 0.012) => (z > hi - w ? hi - w + w * Math.tanh((z - (hi - w)) / w) : z < lo + w ? lo + w - w * Math.tanh((lo + w - z) / w) : z);

/**
 * One curtain panel.
 *  x0t..x1t  gathered extent at the top (rings), x0h..x1h  extent at the hem (wider = flared, narrower = tied)
 *  zc        plane of the rod, yTop  top edge of the cloth, yHem  bottom edge
 *  loops     number of ring-to-ring loops; fullness = flat width / top width (2–3 for real curtains)
 *  mirror    build from the right edge (the other panel of a pair)
 *  tape / hem   heading tape and bottom hem depth (rows are densified around their edges)
 *  depth     [back, front] soft limit of the folds relative to zc. Too tight and the cloth SHRINKS (5–15 % at
 *            [-0.054, 0.07]); check auditPanel().stretch, and lower `fullness` instead if space is short
 * Returns { geo, rings:[{x,z}], L, H, stats }. geo carries position, normal, uv (metres on the flat cloth),
 * color (dye mottling), aHem = (distance to nearer side edge, to bottom edge, to top edge, s along cloth).
 */
export function curtainPanel(o) {
  const { x0t, x1t, x0h, x1h, zc = 0, yTop, yHem, loops = 7, seed = 4101, mirror = false, fullness = 2.7, tape = 0.07, hem = 0.09,
    depth = [-0.11, 0.16], step = 0.004 } = o;
  const rng = new RNG(seed);
  const H = yTop - yHem, Wt = x1t - x0t, Wh = x1h - x0h;
  const L = Wt * fullness, e0 = 0.022, e1 = 0.03;
  // rings clip the cloth at the back creases; between two rings it bellies into the room as one loop
  const raw = []; for (let k = 0; k < loops; k++) raw.push(rng.range(0.62, 1.5));
  const ks = (L - e0 - e1) / raw.reduce((a, b) => a + b, 0);
  const ringS = [e0]; for (const r of raw) ringS.push(ringS[ringS.length - 1] + r * ks);
  const nR = ringS.length;
  // phase: 2π per loop, crease (z minimum) at each ring; be > 0 hurries it through the crease (pinched back, round front)
  const warp = (t, be) => t + (be / (2 * PI)) * Math.sin(2 * PI * t);
  const phase = (s, be) => {
    if (s <= ringS[0]) return -PI / 2 + (2 * PI * (1 + be) * (s - ringS[0])) / (ringS[1] - ringS[0]);
    if (s >= ringS[nR - 1]) return 2 * PI * (nR - 1) - PI / 2 + (2 * PI * (1 + be) * (s - ringS[nR - 1])) / (ringS[nR - 1] - ringS[nR - 2]);
    let k = 0; while (s > ringS[k + 1]) k++;
    return 2 * PI * k - PI / 2 + 2 * PI * warp((s - ringS[k]) / (ringS[k + 1] - ringS[k]), be);
  };
  // second, broader fold system lower down (folds merging as the cloth relaxes)
  const m2 = Math.max(2, Math.round(loops * 0.55)), k2 = [0], psi = rng.range(0, 2 * PI);
  { const r2 = []; for (let k = 0; k < 2 * m2; k++) r2.push(rng.range(0.6, 1.5)); const s2 = r2.reduce((a, b) => a + b, 0); let acc = 0; for (const r of r2) { acc += (r / s2) * L; k2.push(acc); } }
  const phase2 = (s) => { let k = 0; while (k < k2.length - 2 && s > k2[k + 1]) k++; return (k + (s - k2[k]) / (k2[k + 1] - k2[k])) * PI + psi; };

  const nS = Math.ceil(L / step), SUB = 3, Mn = nS * SUB, ds = L / Mn, NW = nS + 1;
  // rows (distance below the top edge), dense around the tape and hem edges so their creases are crisp
  const dl = [];
  const range = (a, b, st) => { const n = Math.max(1, Math.round((b - a) / st)); for (let k = 0; k < n; k++) dl.push(a + ((b - a) * k) / n); };
  range(0, 0.012, 0.006); range(0.012, tape - 0.0015, 0.014); dl.push(tape - 0.0015, tape, tape + 0.0015);
  range(tape + 0.012, 0.42, 0.02); range(0.42, H - hem - 0.03, 0.023);
  range(H - hem - 0.03, H - hem - 0.0015, 0.014); dl.push(H - hem - 0.0015, H - hem, H - hem + 0.0015);
  range(H - hem + 0.012, H, 0.013); dl.push(H);
  const nv = dl.length - 1;

  const PX = new Float32Array(NW * (nv + 1)), PZ = new Float32Array(NW * (nv + 1));
  const th0 = new Float32Array(Mn), tcap = new Float32Array(Mn), xs = new Float32Array(NW), zs = new Float32Array(NW);
  // heading limits: short of square-on at a pinch (the two sides of a crease must not cross), a little past it in
  // the belly of a loop (gathered cloth bulges wider than its neck)
  const a0 = 76 * D2R, capPinch = 83 * D2R, capBelly = 99 * D2R, [zlo, zhi] = depth;
  const off = Array.from({ length: 10 }, () => rng.range(0, 60));
  const ringIdx = ringS.map((s) => Math.round((s / L) * nS));
  let c0 = 0, maxSolveErr = 0;
  for (let j = 0; j <= nv; j++) {
    const d = dl[j], v = d / H;
    const drift = 1.1 * smoothstep(0.06, 1.5, d) + 0.35 * smoothstep(1.4, H, d);   // folds wander more lower down
    const kS = lerp(1.5, 1.15, smoothstep(0.1, H, d));
    const wand = 0.22 * smoothstep(0.12, 1.3, d), amod = 0.34;
    const w2 = 0.34 * smoothstep(0.04, 1.1, d);
    const be = lerp(0.3, 0.1, smoothstep(0.05, 1.2, d)), pinch = 1 - smoothstep(0.04, 0.75, d);
    for (let m = 0; m < Mn; m++) {
      const s = (m + 0.5) * ds;
      const ph = phase(s, be) + drift * (fbm(s * 8 + off[0], d * 0.5 + off[1], 2, seed) - 0.5) * 2.8;
      const k = kS * (0.7 + 0.8 * pn(s * 14 + off[2], d * 0.6 + off[3], seed + 3));
      const Ss = Math.tanh(k * Math.cos(ph)) / Math.tanh(k);                         // relaxed fold: round front and back
      const tl = (ph + PI / 2) / (2 * PI), tf = tl - Math.floor(tl), u = PI * tf, su = Math.sin(u);
      const Sp = Math.cos(u) * (0.72 + 1.7 * su * su) * 0.9;                          // clipped fold: creased at the ring, bellied between
      const S = Ss + (Sp - Ss) * pinch;
      const S2 = Math.cos(phase2(s) + 0.6 * drift * (fbm(s * 3.1 + off[8], d * 0.45 + off[9], 2, seed + 13) - 0.5) * 2.8);
      const A = 1 + amod * (fbm(s * 10 + off[4], d * 0.5 + off[5], 2, seed + 5) - 0.5) * 2.6;
      th0[m] = A * a0 * (S + w2 * S2) + wand * (fbm(s * 3 + off[6], d * 0.6 + off[7], 2, seed + 9) - 0.5) * 2.6;
      tcap[m] = lerp(capPinch, capBelly, smoothstep(0.02, 0.15, Math.min(tf, 1 - tf)));
    }
    // solve the angle multiplier so the section spans the gathered width W (bisection, width is monotone in it)
    const f = Math.pow(v, 1.35), W = lerp(Wt, Wh, f);
    let lo = 0.2, hi = 14;
    for (let it = 0; it < 22; it++) {
      const mid = (lo + hi) / 2; let w = 0;
      for (let m = 0; m < Mn; m++) w += Math.cos(tcap[m] * Math.tanh((mid * th0[m]) / tcap[m]));
      if (w * ds > W) lo = mid; else hi = mid;
    }
    const mul = (lo + hi) / 2;
    let x = 0, z = 0; xs[0] = 0; zs[0] = 0;
    for (let m = 0; m < Mn; m++) {
      const t = tcap[m] * Math.tanh((mul * th0[m]) / tcap[m]);
      x += Math.cos(t) * ds; z += Math.sin(t) * ds;
      if ((m + 1) % SUB === 0) { const i = (m + 1) / SUB; xs[i] = x; zs[i] = z; }
    }
    maxSolveErr = Math.max(maxSolveErr, Math.abs(x - W));
    // remove the mean and tilt of the section so the panel hangs straight under the rod
    let sx = 0, sz = 0, sxx = 0, sxz = 0;
    for (let i = 0; i < NW; i++) { sx += xs[i]; sz += zs[i]; sxx += xs[i] * xs[i]; sxz += xs[i] * zs[i]; }
    const slope = (NW * sxz - sx * sz) / (NW * sxx - sx * sx), icpt = (sz - slope * sx) / NW;
    if (j === 0) { for (const i of ringIdx) c0 += zs[i] - (icpt + slope * xs[i]); c0 *= 0.5 / nR; }   // rings a little behind the rod
    const latN = 0.004 * (fbm(d * 1.2 + off[8], 7.7, 2, seed) - 0.5) * 2 * smoothstep(0.1, 0.8, d);
    const X0 = lerp(x0t, x0h, f) + latN, X1 = lerp(x1t, x1h, f) + latN;
    const bow = 0.004 * Math.sin(PI * Math.min(1, v * 1.1)), cr = 0.0013 * smoothstep(0.05, 0.3, d);
    for (let i = 0; i < NW; i++) {
      const crumple = cr * (fbm((i / nS) * L * 17 + off[1], d * 8 + off[4], 2, seed + 31) - 0.5) * 2;   // linen never hangs glass-smooth
      const zz = softClamp(zs[i] - (icpt + slope * xs[i]) - c0, zlo, zhi) + bow + crumple;
      PX[j * NW + i] = mirror ? X1 - xs[i] : X0 + xs[i];
      PZ[j * NW + i] = zc + zz;
    }
  }
  const yTopEdge = (s) => yTop - 0.004 * (0.5 + 0.5 * Math.sin(phase(s, 0.62)));     // top edge dips between rings
  const hemY = (s) => yHem + 0.005 * (fbm(s * 5 + off[9], 3.1, 2, seed) - 0.5) * 2 - 0.006 * (Math.exp(-s / 0.05) + Math.exp(-(L - s) / 0.05));
  const n = NW * (nv + 1), pos = new Float32Array(n * 3), uv = new Float32Array(n * 2), col = new Float32Array(n * 3), hemA = new Float32Array(n * 4);
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nS; i++) {
    const s = (i / nS) * L, d = dl[j], k = j * NW + i;
    pos[k * 3] = PX[k]; pos[k * 3 + 1] = lerp(yTopEdge(s), hemY(s), d / H); pos[k * 3 + 2] = PZ[k];
    uv[k * 2] = s; uv[k * 2 + 1] = H - d;                                            // metres on the flat cloth: weave never stretches
    // slow mottling plus warp-wise streaks: yarn lots never take the dye quite alike
    col[k * 3] = col[k * 3 + 1] = col[k * 3 + 2] = (1 - 0.075 * fbm(s * 3 + off[3], d * 1.6 + off[5], 3, seed + 21)) * (0.972 + 0.056 * pn(s * 55 + off[2], d * 0.35 + off[6], seed + 41));
    hemA[k * 4] = Math.min(s, L - s); hemA[k * 4 + 1] = H - d; hemA[k * 4 + 2] = d; hemA[k * 4 + 3] = s;
  }
  const idx = new Uint32Array(nS * nv * 6); let q = 0;
  for (let j = 0; j < nv; j++) for (let i = 0; i < nS; i++) {
    const a = j * NW + i, b = a + 1, c = a + NW + 1, dd = a + NW;
    if (!mirror) { idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = a; idx[q++] = dd; idx[q++] = c; }
    else { idx[q++] = a; idx[q++] = b; idx[q++] = c; idx[q++] = a; idx[q++] = c; idx[q++] = dd; }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.setAttribute('aHem', new THREE.BufferAttribute(hemA, 4));
  geo.setIndex(new THREE.BufferAttribute(idx, 1)); geo.computeVertexNormals();
  return { geo, rings: ringIdx.map((i) => ({ x: PX[i], z: PZ[i] })), L, H, grid: { nu: nS, nv, NW }, stats: { width: +L.toFixed(3), rows: nv + 1, cols: NW, tris: nS * nv * 2, maxSolveErrMm: +(maxSolveErr * 1000).toFixed(2) } };
}

/** Audit a panel. Each row is a polyline seen from above:
 *  stretch   its length on the 3D surface vs. the flat width (cloth must not stretch or shrink sideways); p95 and max
 *  crossings segments of the same row that intersect (the two sides of a fold passing through each other) — must be 0
 *  contacts  points of the same row, far apart along the cloth, closer than gapMm (folds touching; normal near rings and in tied curtains) */
export function auditPanel(panel, { gapMm = 2, minAlongM = 0.04 } = {}) {
  const P = panel.geo.attributes.position.array, { nu, nv, NW } = panel.grid;
  const st = [], cell = Math.max(gapMm / 1000, 0.004), minK = Math.ceil((minAlongM / panel.L) * nu);
  let contacts = 0, crossings = 0, rowsTouching = 0;
  const X = (j, i) => P[(j * NW + i) * 3], Z = (j, i) => P[(j * NW + i) * 3 + 2];
  const seg = (ax, az, bx, bz, cx, cz, dx, dz) => {
    const d1 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax), d2 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax);
    const d3 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx), d4 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx);
    return d1 * d2 < 0 && d3 * d4 < 0;
  };
  for (let j = 0; j <= nv; j++) {
    let len = 0; const grid = new Map(); let touch = 0;
    for (let i = 0; i < nu; i++) {
      len += Math.hypot(X(j, i + 1) - X(j, i), Z(j, i + 1) - Z(j, i));
      const key = Math.floor(X(j, i) / cell) + ',' + Math.floor(Z(j, i) / cell);
      (grid.get(key) || grid.set(key, []).get(key)).push(i);
    }
    st.push(Math.abs(len / panel.L - 1));
    for (let i = 0; i < nu; i++) {
      const gx = Math.floor(X(j, i) / cell), gz = Math.floor(Z(j, i) / cell);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const k of grid.get(gx + a + ',' + (gz + b)) || []) {
        if (k <= i + 1) continue;
        if (seg(X(j, i), Z(j, i), X(j, i + 1), Z(j, i + 1), X(j, k), Z(j, k), X(j, k + 1), Z(j, k + 1))) crossings++;
        if (k - i >= minK && Math.hypot(X(j, i) - X(j, k), Z(j, i) - Z(j, k)) < gapMm / 1000) { contacts++; touch = 1; }
      }
    }
    rowsTouching += touch;
  }
  st.sort((a, b) => a - b);
  return { stretchP95Pct: +(st[Math.floor(st.length * 0.95)] * 100).toFixed(2), stretchMaxPct: +(st[st.length - 1] * 100).toFixed(2), crossings, contacts, rowsTouching };
}

/**
 * Linen plain weave: per-thread width/tone jitter, slubs (thick runs) along warp and weft, over/under crossings.
 * One tile = tileM metres; returns { map (sRGB), normalMap, avg (linear rgb) } as DataTextures with repeat set
 * for UVs in metres. N = texels per tile (2048 ≈ 4 texels per thread at 512 threads).
 */
export function linenTextures({ N = 2048, threads = 512, tileM = 0.32, seed = 8123, base = [0.9, 0.858, 0.78] } = {}) {
  const NT = threads, CO = N >> 3, R = N / NT;
  const rng = new RNG(seed);
  const wW = new Float32Array(NT), fW = new Float32Array(NT), wT = new Float32Array(NT), fT = new Float32Array(NT);
  let bw = 0, bf = 0;
  for (let k = 0; k < NT; k++) {
    if (k % 6 === 0) bw = rng.gauss() * 0.018;
    if (k % 4 === 0) bf = rng.gauss() * 0.026;
    wW[k] = 0.66 + 0.22 * rng.next(); fW[k] = 0.62 + 0.3 * rng.next();
    wT[k] = 1 + bw + rng.gauss() * 0.02; fT[k] = 1 + bf + rng.gauss() * 0.028;
  }
  const sW = new Float32Array(NT * CO), sF = new Float32Array(NT * CO);
  const slubs = (S, n, amp) => {
    for (let q = 0; q < n; q++) {
      const k = rng.int(0, NT - 1), c = rng.int(0, CO - 1), len = rng.range(2.5, 13), a = amp * rng.range(0.3, 1), r = Math.ceil(len * 2.2);
      for (let d = -r; d <= r; d++) S[k * CO + ((((c + d) % CO) + CO) % CO)] += a * Math.exp(-(d * d) / (len * len));
    }
  };
  slubs(sF, Math.round(430 * (NT / 512)), 0.85); slubs(sW, Math.round(160 * (NT / 512)), 0.55);
  const Hf = new Float32Array(N * N), col = new Uint8Array(N * N * 4);
  const SIN = [], OFF = [];
  for (let q = 0; q < R; q++) { const f = (q + 0.5) / R; SIN.push(0.6 + 0.4 * Math.sin(PI * f)); OFF.push(Math.abs(f - 0.5) * 2); }
  const lin = (c) => Math.pow(c, 2.2), acc = [0, 0, 0, 0];
  for (let y = 0; y < N; y++) {
    const iy = Math.floor(y / R), qy = y % R, cy = y >> 3, wf = fW[iy], tf = fT[iy], sy = SIN[qy], oy = OFF[qy];
    for (let x = 0; x < N; x++) {
      const ix = Math.floor(x / R), qx = x % R, sw = sW[ix * CO + cy], sf = sF[iy * CO + (x >> 3)];
      const tx = 1 - OFF[qx] / (wW[ix] * (1 + sw)), ty = 1 - oy / (wf * (1 + sf)), over = (ix + iy) & 1;
      const warp = tx > 0 ? Math.sqrt(tx) * (over ? 1 : 0.55) * sy * (1 + 0.3 * sw) : 0;
      const weft = ty > 0 ? Math.sqrt(ty) * (over ? 0.55 : 1) * SIN[qx] * (1 + 0.3 * sf) : 0;
      const top = warp > weft, h = top ? warp : weft, i = y * N + x, j = i * 4;
      Hf[i] = h;
      const k = (top ? wT[ix] * (1 + 0.06 * sw) : tf * (1 + 0.08 * sf)) * (0.72 + 0.28 * (h > 0.8 ? 1 : h * 1.25));
      const r = Math.min(1, base[0] * k), g = Math.min(1, base[1] * k), b = Math.min(1, base[2] * k);
      col[j] = r * 255; col[j + 1] = g * 255; col[j + 2] = b * 255; col[j + 3] = 255;
      if ((x * 7 + y * 13) % 61 === 0) { acc[0] += lin(r); acc[1] += lin(g); acc[2] += lin(b); acc[3]++; }
    }
  }
  const tex = (data, srgb) => {
    const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / tileM, 1 / tileM);
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 8;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.needsUpdate = true; return t;
  };
  return { map: tex(col, true), normalMap: tex(normalFromHeight(Hf, N, N, 1.15, 1.15), false), avg: [acc[0] / acc[3], acc[1] / acc[3], acc[2] / acc[3]] };
}

/** Uniforms shared by every curtain material (drive uTime from your clock, or a fixed time for renders). */
export const CU = { uTime: { value: 0 } };

/**
 * Curtain material: MeshPhysicalMaterial (sheen, a little transmission-like back light via `trans`) whose shader
 * draws, from aHem: doubled hems (darker where the cloth is two layers), rows of stitches (faded out when a stitch
 * is smaller than a pixel), and faint horizontal storage creases from lying folded in the packet.
 * `breathe` (metres) is a barely visible sway, pinned at the top. yTop is the rod line (sway weight 0 there).
 */
export function curtainMaterial({ map, normalMap, color = 0xffffff, yTop = 2.3, sideHem = 0.02, bottomHem = 0.09, tape = 0.07, normalScale = 0.9,
  sheen = 0.25, roughness = 0.85, trans = 0.12, breathe = 0.003, creases = true } = {}) {
  const m = new THREE.MeshPhysicalMaterial({ map, normalMap, color, vertexColors: true, roughness, sheen, sheenRoughness: 0.6, sheenColor: new THREE.Color(1, 1, 1),
    side: THREE.DoubleSide, normalScale: new THREE.Vector2(normalScale, normalScale) });
  const f = (x) => x.toFixed(4);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = CU.uTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute vec4 aHem;\nvarying vec4 vHem;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      vHem = aHem;
      { float cw = clamp( ( ${f(yTop)} - position.y ) / 2.3, 0.0, 1.0 ); cw *= cw;
        transformed.z += cw * ${f(breathe)} * sin( uTime * 0.6 + position.x * 2.1 );
        transformed.x += cw * ${f(breathe / 3)} * sin( uTime * 0.43 + position.x * 3.3 + 1.7 ); }`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec4 vHem;')
      .replace('#include <map_fragment>', `#include <map_fragment>
      {
        float hs = vHem.x, hb = vHem.y, ht = vHem.z, sa = vHem.w;
        float hpx = fwidth( hb ) + fwidth( hs );
        float dbl = max( 1.0 - smoothstep( ${f(sideHem - 0.0003)}, ${f(sideHem + 0.0003)}, hs ), max( 1.0 - smoothstep( ${f(bottomHem - 0.0003)}, ${f(bottomHem + 0.0003)}, hb ), 1.0 - smoothstep( ${f(tape - 0.0003)}, ${f(tape + 0.0003)}, ht ) ) );
        diffuseColor.rgb *= 1.0 - 0.085 * dbl;
        float st = ( 1.0 - smoothstep( 0.00024, 0.00048, abs( hs - ${f(sideHem - 0.0032)} ) ) ) * step( 0.3, fract( hb / 0.0034 ) );
        st = max( st, ( 1.0 - smoothstep( 0.00024, 0.00048, abs( hb - ${f(bottomHem - 0.0038)} ) ) ) * step( 0.3, fract( sa / 0.0034 ) ) );
        st = max( st, ( 1.0 - smoothstep( 0.00024, 0.00048, abs( ht - ${f(tape - 0.0038)} ) ) ) * step( 0.3, fract( sa / 0.0034 + 0.4 ) ) );
        st = max( st, ( 1.0 - smoothstep( 0.00024, 0.00048, abs( ht - 0.0045 ) ) ) * step( 0.3, fract( sa / 0.0034 + 0.7 ) ) );
        diffuseColor.rgb *= 1.0 - 0.3 * st * ( 1.0 - smoothstep( 0.0005, 0.0016, hpx ) );
      }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      #if defined( USE_NORMALMAP_TANGENTSPACE ) && ${creases ? 1 : 0}
      {
        float cy = vHem.y / 0.345 + 0.31, cid = floor( cy ), ce = ( fract( cy ) - 0.5 ) / 0.014;
        float camp = ( 0.5 + 0.5 * sin( cid * 2.4 + 1.0 ) ) * ( 0.65 + 0.35 * sin( vHem.w * 21.0 + cid * 1.7 ) ) * ( mod( cid, 2.0 ) < 0.5 ? 1.0 : -1.0 );
        normal = normalize( normal + tbn[1] * ( ce * exp( -0.5 * ce * ce ) * 0.3 * camp ) );
      }
      #endif`)
      // thin linen glows when back-lit: add a share of the light arriving on the far side
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
      #if NUM_DIR_LIGHTS > 0
      for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
        float back = max( dot( -normal, directionalLights[ i ].direction ), 0.0 );
        reflectedLight.directDiffuse += ${f(trans)} * back * directionalLights[ i ].color * diffuseColor.rgb;
      }
      #endif`);
  };
  m.customProgramCacheKey = () => `curtain|${yTop}|${sideHem}|${bottomHem}|${tape}|${breathe}|${trans}|${creases}`;
  return m;
}

/** Ring with a sprung clip that grips the cloth, centred on the rod axis (rod along X). dz = cloth offset from the rod. */
export function curtainRing(rng, rodR, dz) {
  const R = 0.0155, tb = 0.0017, cy = rodR - (R - tb);
  const parts = [
    new THREE.TorusGeometry(R, tb, 8, 28).rotateY(PI / 2).translate(0, cy, 0),
    new THREE.TorusGeometry(0.0032, 0.0008, 5, 10).translate(0, cy - R - 0.0026, 0),
    new THREE.BoxGeometry(0.0075, 0.012, 0.0034).translate(0, -0.03, 0),
    new THREE.CylinderGeometry(0.0011, 0.0011, 0.0084, 8).rotateZ(PI / 2).translate(0, -0.0255, 0),
  ].map((g) => { g = g.toNonIndexed(); g.deleteAttribute('uv'); return g; });
  const gm = mergeGeometries(parts);
  gm.rotateY(rng.range(-0.22, 0.22)).rotateZ(rng.range(-0.09, 0.09));
  gm.rotateX(-Math.asin(clamp(dz / 0.03, -0.6, 0.6)));
  return gm;
}
