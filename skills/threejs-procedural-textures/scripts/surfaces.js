// Hard surfaces: painted woodchip wall (+ large-scale plaster/paint drift shader), orange-peel lacquer, smudged
// roughness, settled-dust roughness, oak plank floor, generic wood, book-matched oak veneer.
// Every map tiles; sizes are physical (metres per tile, height in mm) so `repeat = 1 / tileMetres` on UVs in metres.
// Adapted from room-at-dawn (MIT) src/scene/materials.js and src/scene/parts/fixtures.js (oakVeneer).
import * as THREE from 'three';
import { RNG, clamp, sm01, lin, pnoise, pfbm, vn, field, normalBytes, normalTex, dataTex, packTex, once } from './tex.js';

// table value noise with separate periods (<= 256) — fast enough for 1024² inner loops
const LAT = new Float32Array(65536);
{ const r = new RNG(60931); for (let i = 0; i < 65536; i++) LAT[i] = r.next(); }
function tn(x, y, px = 256, py = 256) {
  const ix = Math.floor(x), iy = Math.floor(y); let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  let x0 = ix % px; if (x0 < 0) x0 += px; let y0 = iy % py; if (y0 < 0) y0 += py;
  const x1 = x0 + 1 === px ? 0 : x0 + 1, y1 = y0 + 1 === py ? 0 : y0 + 1;
  const a = LAT[(y0 << 8) | x0], b = LAT[(y0 << 8) | x1], c = LAT[(y1 << 8) | x0], d = LAT[(y1 << 8) | x1];
  return a + (b - a) * fx + (c - a + (a - b - c + d) * fx) * fy;
}

// ================================================================== walls
/** Woodchip wallpaper (Raufaser) under roller paint: 13 000 flakes at random angles, the paint film bridging their
 *  edges (3x3 blur), then a fine roller stipple. 1024², one tile = 0.9 m. Normal map only (paint is a colour). */
export function wallNormal({ tileM = 0.9, flakes = 13000, seed = 4711 } = {}) {
  return once(`wallN|${tileM}|${flakes}|${seed}`, () => {
    const N = 1024, px = (tileM * 1000) / N;
    const A = new Float32Array(N * N), rng = new RNG(seed);
    for (let i = 0; i < flakes; i++) {
      const cx = rng.range(0, N), cy = rng.range(0, N), ang = rng.range(0, Math.PI), size = rng.next(), big = size > 0.93;
      const a = (big ? rng.range(3.4, 5.4) : 1.2 + size * 2.5) / px, b = (big ? rng.range(1.3, 2.1) : rng.range(0.75, 1.5)) / px;
      const hgt = (big ? 0.5 : 0.25 + size * 0.16) * rng.range(0.7, 1.3), ca = Math.cos(ang), sa = Math.sin(ang), rad = Math.ceil(a) + 1;
      const x0 = Math.floor(cx), y0 = Math.floor(cy);
      for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
        const ox = x0 + dx + 0.5 - cx, oy = y0 + dy + 0.5 - cy;
        const lu = (ox * ca + oy * sa) / a, lv = (oy * ca - ox * sa) / b, q = 1 - lu * lu - lv * lv;
        if (q <= 0) continue;
        const hv = hgt * sm01(q / 0.6), k = (((y0 + dy) & 1023) << 10) | ((x0 + dx) & 1023);
        if (hv > A[k]) A[k] = hv;
      }
    }
    const H = new Float32Array(N * N);
    for (let y = 0; y < N; y++) {
      const ym = ((y + N - 1) & 1023) << 10, yo = y << 10, yp = ((y + 1) & 1023) << 10, v = y / N;
      for (let x = 0; x < N; x++) {
        const xm = (x + N - 1) & 1023, xp = (x + 1) & 1023, u = x / N;
        const s = (A[yo | x] * 4 + (A[yo | xm] + A[yo | xp] + A[ym | x] + A[yp | x]) * 2 + A[ym | xm] + A[ym | xp] + A[yp | xm] + A[yp | xp]) / 16;
        H[yo | x] = s + (vn(u * 256, v * 256) - 0.5) * 0.075 + (vn(u * 512 + 31.7, v * 512 + 11.3) - 0.5) * 0.04;
      }
    }
    return dataTex(normalBytes(H, N, N, px, px), N, N, { repeat: [1 / tileM, 1 / tileM] });
  });
}

/** Large-scale wall character, tile 3.2 m, 256²: RG = slope of the plaster (never truly flat), B = paint coverage
 *  (roller laps, clouding), A = sheen drift. Used by wallPatch. */
export function wallLowTex() {
  return once('wallLow', () => {
    const N = 256, px = 3200 / N, S = 0.03, h = new Float32Array(N * N), out = new Uint8Array(N * N * 4);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) h[y * N + x] = (pfbm((x / N) * 5, (y / N) * 5, 3, 61, 5, 5) - 0.5) * 7.0;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const u = x / N, v = y / N, i = (y * N + x) * 4;
      const sx = (h[y * N + (x + 1) % N] - h[y * N + (x + N - 1) % N]) / (2 * px), sy = (h[((y + 1) % N) * N + x] - h[((y + N - 1) % N) * N + x]) / (2 * px);
      const paint = 0.5 + (pfbm(u * 3, v * 3, 3, 71, 3, 3) - 0.5) * 1.1 + (pnoise(u * 11, v * 2, 73, 11, 2) - 0.5) * 0.45;
      const sheen = 0.5 + (pfbm(u * 4, v * 4, 3, 83, 4, 4) - 0.5) * 1.1 + (pnoise(u * 13, v * 2, 89, 13, 2) - 0.5) * 0.6;
      out[i] = (0.5 + clamp(sx / S, -1, 1) * 0.5) * 255 + 0.5; out[i + 1] = (0.5 + clamp(sy / S, -1, 1) * 0.5) * 255 + 0.5;
      out[i + 2] = clamp(paint) * 255 + 0.5; out[i + 3] = clamp(sheen) * 255 + 0.5;
    }
    return dataTex(out, N, N, { aniso: 2 });
  });
}
/** Patch a MeshStandardMaterial that has a wall normalMap: bend the normal with the 3.2 m plaster slope, let paint
 *  coverage and sheen drift. Breaks the "perfect CG wall" look across a whole room at almost no cost.
 *  low = (normal-map tile metres / 3.2), off = uv offset so ceiling and walls do not share the pattern. */
export function wallPatch(m, { low = 0.9 / 3.2, off = [0, 0], slope = 1, paint = 0.045, sheen = 0.07 } = {}) {
  const uni = { tWallLow: { value: wallLowTex() }, uWallLow: { value: new THREE.Vector4(low, low, off[0], off[1]) }, uWallAmp: { value: new THREE.Vector3(slope * 0.06, paint, sheen) } };
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    Object.assign(sh.uniforms, uni);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tWallLow; uniform vec4 uWallLow; uniform vec3 uWallAmp;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
#ifdef USE_NORMALMAP_TANGENTSPACE
{
  vec4 wl = texture2D( tWallLow, vNormalMapUv * uWallLow.xy + uWallLow.zw );
  normal = normalize( normal - ( tbn[0] * ( wl.x - 0.5 ) + tbn[1] * ( wl.y - 0.5 ) ) * uWallAmp.x );
  diffuseColor.rgb *= 1.0 + ( wl.z - 0.5 ) * uWallAmp.y;
  roughnessFactor = clamp( roughnessFactor + ( wl.w - 0.5 ) * uWallAmp.z, 0.05, 1.0 );
}
#endif`);
  };
  m.customProgramCacheKey = () => 'wallPatch';
  return m;
}

// ================================================================== lacquer, plastic, wear
/** Very fine orange peel for lacquered / powder-coated / enamelled surfaces. 512², use repeat 10–60 per metre
 *  with normalScale 0.08–0.36 (barely visible, but it is what makes highlights look like paint). */
export function lacquerNormal() {
  return once('lacN', () => { const N = 512; return normalTex(field(N, N, (u, v) => pfbm(u * 64, v * 64, 3, 21, 64)), N, N, 1.4); });
}
/** Smudge / wear roughness drift (G channel): two scales of fbm around `base`. For roughnessMap. */
export function smudgeRough(base = 0.4, amp = 0.12) {
  return once(`smudge${base}|${amp}`, () => {
    const N = 512;
    const R = field(N, N, (u, v) => clamp(base + (pfbm(u * 6, v * 6, 5, 33, 6) - 0.5) * 2 * amp + (pfbm(u * 90, v * 90, 2, 35, 90) - 0.5) * amp * 0.5));
    return packTex(N, N, null, R, null);
  });
}
/** Satin surface with a thin film of settled dust that thickens away from the edge people touch (window sill, top
 *  of a cupboard). Tile = lenM along u x depthM across v (v = 0 at the clean front edge). Roughness in G. */
export function dustRough({ lenM = 1, depthM = 0.25, base = 0.25, seed = 91 } = {}) {
  return once(`dust|${lenM}|${depthM}|${base}|${seed}`, () => {
    const W = 1024, Hh = 256, R = new Float32Array(W * Hh);
    for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
      const u = x / W, v = y / Hh, depth = v * depthM;
      const back = sm01((depth - 0.14 * depthM) / (0.52 * depthM)) * (1 - sm01((depth - 0.82 * depthM) / (0.16 * depthM)));
      const cloud = pfbm(u * 6, v * 2, 4, seed, 6, 2), wipe = pnoise(u * 5, v * 9, seed + 2, 5, 9);
      const g = vn(u * 512, v * 128), speck = g > 0.9 ? (g - 0.9) * 10 : 0;
      R[y * W + x] = clamp(base + back * (0.03 + 0.085 * sm01((cloud - 0.38) / 0.3)) + (cloud - 0.5) * 0.04 + (wipe - 0.5) * 0.03 + speck * (0.06 + 0.14 * back));
    }
    return packTex(W, Hh, null, R, null, { repeat: [1 / lenM, 1 / depthM] });
  });
}

// ================================================================== wood
/** Oak laminate floor: single-strip planks (default 1.29 x 0.19 m) with a 4-sided micro-bevel; end joints staggered
 *  (>= ~35 cm from the neighbours', no stair steps); every plank its own print — cathedral or straight grain from a
 *  log running askew, growth rings with porous earlywood, knots with grain flowing round them, own tone and sheen.
 *  2048², one tile = rows plank widths (u) x len plank lengths (v). Returns map, normalMap, roughnessMap, avg. ~0.3 s (RTX 4090 / Chrome). */
export function floorMaps({ rows = 12, len = 3, plankW = 0.19, plankL = 1.29, base = [0.784, 0.679, 0.543], seed = 77, N = 2048 } = {}) {
  return once(`floor|${rows}|${len}|${plankW}|${plankL}|${base}|${seed}|${N}`, () => {
    const ROWS = rows, LEN = len, PW = plankW, PL = plankL, TW = ROWS * PW, TL = LEN * PL, pxu = (TW / N) * 1000, pxv = (TL / N) * 1000;
    const H = new Float32Array(N * N), R = new Float32Array(N * N), col = new Uint8Array(N * N * 4), rng = new RNG(seed);
    const cd = (a, b) => { const d = Math.abs(a - b) % 1; return Math.min(d, 1 - d); };
    const off = [];
    for (let r = 0; r < ROWS; r++) {
      let o = 0;
      for (let k = 0; k < 300; k++) {
        o = rng.next();
        if (r > 0 && cd(o, off[r - 1]) < 0.27) continue;
        if (r > 1 && cd(o, off[r - 2]) < 0.09) continue;
        if (r === ROWS - 1 && cd(o, off[0]) < 0.27) continue;
        if (r >= ROWS - 2 && cd(o, off[(r + 2) % ROWS]) < 0.09) continue;
        break;
      }
      off.push(o);
    }
    const planks = [];
    for (let i = 0; i < ROWS * LEN; i++) {
      const cath = rng.chance(0.62), knot = rng.chance(0.14);
      planks.push({
        ox: rng.range(0, 256), oy: rng.range(0, 256), lum: clamp(rng.gauss() * 0.04, -0.085, 0.085), warm: rng.range(-1, 1),
        c0: cath ? rng.range(0.03, 0.16) : (rng.chance(0.5) ? rng.range(-0.5, -0.12) : rng.range(0.31, 0.7)),
        h0: cath ? rng.range(0.012, 0.05) : rng.range(0.0, 0.2), k: (cath ? rng.range(0.03, 0.085) : rng.range(0.0, 0.05)) * rng.sign(),
        rw: rng.range(0.0048, 0.0085), ring: rng.range(0.07, 0.13), gloss: rng.range(-0.03, 0.03),
        ks: rng.range(0.15, PL - 0.15), kt: rng.range(0.045, PW - 0.045), kr: knot ? rng.range(0.0045, 0.008) : 0.0,
      });
    }
    const WN = 256, wear = new Float32Array(WN * WN);
    for (let y = 0; y < WN; y++) for (let x = 0; x < WN; x++) wear[y * WN + x] = pfbm((x / WN) * 4, (y / WN) * 6, 4, 23, 4, 6);
    const tOf = new Float32Array(N), xStart = new Int32Array(ROWS + 1).fill(N);
    for (let x = N - 1; x >= 0; x--) { const a = (x / N) * ROWS, r = Math.floor(a); tOf[x] = (a - r) * PW; xStart[r] = x; }
    const [B0, B1, B2] = base, acc = new Float64Array(4), ws = N / WN;
    for (let y = 0; y < N; y++) {           // one texture row at a time: a small hot loop the JIT likes
      const v = y / N, wy0 = Math.floor(y / ws), wfy = (y % ws) / ws, wr0 = (wy0 % WN) * WN, wr1 = ((wy0 + 1) % WN) * WN, sample = (y & 7) === 0;
      for (let rI = 0; rI < ROWS; rI++) {
        const vv = v * LEN + off[rI], fl = Math.floor(vv), s = (vv - fl) * PL, P = planks[rI * LEN + (fl % LEN)];
        const b0 = P.h0 + P.k * (s - PL / 2), b2 = b0 * b0, n1 = s * 2.6 + P.ox, n2 = s * 7 + P.ox, n3 = s * 23 + P.oy;
        const es = s < PL - s ? s : PL - s, gEnd = es < 0.0026 ? sm01((0.0026 - es) / 0.0019) : 0.0;
        const ds = s - P.ks, kr = P.kr, knot = kr > 0 && ds > -0.1 && ds < 0.1;
        const c0 = P.c0, oy = P.oy, ox = P.ox, irw = 1 / P.rw, ring = P.ring, lum = 1 + P.lum, warm = P.warm, gloss = 0.30 + P.gloss;
        for (let x = xStart[rI], xb = xStart[rI + 1]; x < xb; x++) {
          const t = tOf[x], a0 = t - c0;
          const w1 = vn(n1, t * 22 + oy), fa = vn(n2, t * 260 + oy), fb = vn(n3, t * 700 + ox);
          let r = Math.sqrt(a0 * a0 + b2) + (w1 - 0.5) * 0.016 + (fa - 0.5) * 0.002;   // distance from the pith of an askew log
          let kn = 0.0, kd = 0.0;
          if (knot) {
            const dt = t - P.kt;
            r += 2.4 * P.rw * Math.exp(-(ds * ds * 0.16 + dt * dt) / (kr * kr * 6));
            kd = Math.sqrt(ds * ds * 0.6 + dt * dt) / kr; if (kd < 1.3) kn = 1 - sm01((kd - 0.5) / 0.75);
          }
          const p0 = r * irw, p = p0 + 0.85 * vn(p0 * 0.31 + ox, oy + 7.3), f = p - Math.floor(p);
          const dr = (f < 0.14 ? f / 0.14 : 1) * (1 - sm01((f - 0.18) / 0.6)), pore = dr * (0.45 + fa);
          const g = (fa - 0.5) * 0.11 + (fb - 0.5) * 0.08 + (w1 - 0.5) * 0.09 - pore * ring;
          const et = t < PW - t ? t : PW - t; let gr = gEnd;
          if (et < 0.0017) { const g2 = sm01((0.0017 - et) / 0.0013); if (g2 > gr) gr = g2; }
          const L = lum * (1 + g) * (1 - kn * (0.34 + 0.07 * Math.sin(kd * 10))) * (1 - 0.42 * gr), dk = g < 0 ? -g : 0.0;
          const cr = Math.min(1, B0 * L * (1 + 0.012 * warm)), cg = Math.min(1, B1 * L * (1 - 0.1 * dk - 0.04 * kn)), cb = Math.min(1, B2 * L * (1 - 0.28 * dk - 0.12 * kn - 0.03 * warm));
          const i = y * N + x, wx0 = Math.floor(x / ws), wfx = (x % ws) / ws, wx1 = (wx0 + 1) % WN;
          const wa = wear[wr0 + wx0], wb = wear[wr1 + wx0], wt = wa + (wear[wr0 + wx1] - wa) * wfx, w = wt + (wb + (wear[wr1 + wx1] - wb) * wfx - wt) * wfy;
          H[i] = -0.32 * gr - 0.05 * pore - 0.03 * (1 - fb) - 0.03 * kn;
          const rr = gloss + pore * 0.045 + (0.5 - fb) * 0.05 + (w - 0.5) * 0.16 + gr * 0.35 + kn * 0.06;
          R[i] = rr < 0.12 ? 0.12 : rr > 1 ? 1 : rr;
          const j = i * 4; col[j] = cr * 255 + 0.5; col[j + 1] = cg * 255 + 0.5; col[j + 2] = cb * 255 + 0.5; col[j + 3] = 255;
          if (sample && (x & 7) === 0) { acc[0] += lin(cr); acc[1] += lin(cg); acc[2] += lin(cb); acc[3]++; }
        }
      }
    }
    const repeat = [1 / TW, 1 / TL];
    return {
      map: dataTex(col, N, N, { srgb: true, repeat, aniso: 16 }), normalMap: dataTex(normalBytes(H, N, N, pxu, pxv), N, N, { repeat, aniso: 16 }),
      roughnessMap: packTex(N, N, null, R, null, { repeat, aniso: 16 }), avg: [acc[0] / acc[3], acc[1] / acc[3], acc[2] / acc[3]], tile: [TW, TL],
    };
  });
}

/** Generic wood (desk tops, shelves, frames): rings + streaks + pores, whole numbers of each per tile so it wraps.
 *  tone = sRGB base [r,g,b] 0..1. 1024², one tile = 1 m along the grain (u). Fast (~0.3 s), less detailed than floorMaps. */
export function woodMaps(tone = [0.8, 0.66, 0.5], { scale = 1, contrast = 1, seed = 5 } = {}) {
  return once(`wood|${tone}|${scale}|${contrast}|${seed}`, () => {
    const N = 1024, H = new Float32Array(N * N), R = new Float32Array(N * N), col = new Uint8Array(N * N * 4);
    const fr = Math.max(1, Math.round(22 * scale)), fs = Math.max(1, Math.round(140 * scale)), fp = Math.max(1, Math.round(700 * scale));
    for (let y = 0; y < N; y++) {
      const v = y / N;
      for (let x = 0; x < N; x++) {
        const u = x / N;
        const warp = pfbm(u * 3, v * 5, 3, seed, 3, 5), rings = Math.sin((v * fr + warp * 5) * Math.PI * 2);
        const streak = pfbm(u * 4, v * fs, 3, seed + 3, 4, fs), pores = pnoise(u * 90, v * fp, seed + 7, 90, fp);
        const g = clamp(0.5 + (0.22 * rings * warp + (streak - 0.5) * 0.6) * contrast), dark = pores > 0.82 ? (pores - 0.82) * 2 : 0;
        const k = 0.8 + g * 0.3 - dark * 0.45, i = y * N + x;
        H[i] = (g - 0.5) * 0.2 - dark * 0.4; R[i] = clamp(0.5 + (0.5 - g) * 0.14 + dark * 0.3);
        col[i * 4] = clamp(tone[0] * k) * 255; col[i * 4 + 1] = clamp(tone[1] * k) * 255; col[i * 4 + 2] = clamp(tone[2] * k) * 255; col[i * 4 + 3] = 255;
      }
    }
    return { map: dataTex(col, N, N, { srgb: true }), normalMap: normalTex(H, N, N, 1.6), roughnessMap: packTex(N, N, null, R, null), avg: tone.map((c) => lin(c) * 0.9) };
  });
}

/** Oak veneer for furniture panels: two book-matched leaves per tile, flat-sawn "cathedral" rings with porous
 *  earlywood, ray flecks and pores. 1024², one tile = 1.6 m along the grain (u) x 0.5 m across (v, wraps at a
 *  veneer joint). Use different texture offsets per panel so no two doors look alike. */
export function oakVeneer({ seed = 1907, base = [0.85, 0.722, 0.54] } = {}) {
  return once(`oak|${seed}|${base}`, () => {
    const N = 1024, TU = 1.6, TV = 0.5, LEAVES = 2, LW = TV / LEAVES, PI = Math.PI;
    const col = new Uint8Array(N * N * 4), Hh = new Float32Array(N * N), R = new Float32Array(N * N), rng = new RNG(seed), leaf = [];
    for (let k = 0; k < LEAVES; k++) {
      const P = { c0: rng.range(0.07, 0.15), h0: rng.range(0.024, 0.04), a1: rng.range(0.012, 0.022), a2: rng.range(0.005, 0.011), p1: rng.range(0, 6.28), p2: rng.range(0, 6.28),
        rw: rng.range(0.0044, 0.0058), lum: rng.range(-0.02, 0.02), oy: rng.int(0, 180), b: new Float32Array(N), an: new Float32Array(N) };
      for (let x = 0; x < N; x++) { const u = x / N; P.b[x] = P.h0 + P.a1 * Math.sin(2 * PI * u + P.p1) + P.a2 * Math.sin(4 * PI * u + P.p2); P.an[x] = (tn(u * 4, 3.3 + P.oy, 4) - 0.5) * 0.03; }
      leaf.push(P);
    }
    const [B0, B1, B2] = base, acc = [0, 0, 0];
    for (let y = 0; y < N; y++) {
      const v = y / N, lk = Math.min(LEAVES - 1, Math.floor(v * LEAVES)), P = leaf[lk];
      const t = v * TV - lk * LW, joint = Math.min(t, LW - t) < 0.0005 ? 1 : 0, lum = 1 + P.lum, irw = 1 / P.rw, oy = P.oy;
      const yw = t * 24 + oy, ya = t * 300 + oy, yb = t * 900 + oy, yr = t * 620 + oy + 50;
      for (let x = 0; x < N; x++) {
        const u = x / N, b = P.b[x];
        const w1 = tn(u * 8, yw, 8), fa = tn(u * 32, ya, 32), fb = tn(u * 128, yb, 128), ry = tn(u * 256, yr);
        const a0 = t - P.c0 + P.an[x];
        const r = Math.sqrt(a0 * a0 + b * b) + (w1 - 0.5) * 0.012 + (fa - 0.5) * 0.0018;
        const p0 = r * irw, p = p0 + 0.8 * tn(p0 * 0.31 + oy, 7.3), f = p - Math.floor(p);
        const dr = (f < 0.14 ? f / 0.14 : 1) * (1 - sm01((f - 0.18) / 0.6));
        const pore = dr * (0.4 + fa) * (fb > 0.3 ? 1 : 0.35), fleck = ry > 0.8 ? (ry - 0.8) * 5 : 0;
        const g = (fa - 0.5) * 0.09 + (fb - 0.5) * 0.06 + (w1 - 0.5) * 0.09 - pore * 0.15 - fleck * 0.07;
        const L = lum * (1 + g) * (1 - 0.05 * joint), dk = g < 0 ? -g : 0;
        const cr = Math.min(1, B0 * L), cg = Math.min(1, B1 * L * (1 - 0.1 * dk)), cb = Math.min(1, B2 * L * (1 - 0.3 * dk));
        const i = y * N + x, j = i * 4;
        col[j] = cr * 255 + 0.5; col[j + 1] = cg * 255 + 0.5; col[j + 2] = cb * 255 + 0.5; col[j + 3] = 255;
        Hh[i] = -0.06 * pore - 0.03 * (1 - fb) - 0.03 * fleck - 0.05 * joint;
        R[i] = clamp(0.47 + pore * 0.16 + (0.5 - fb) * 0.07 + fleck * 0.08);
        if ((x & 7) === 0 && (y & 7) === 0) { acc[0] += lin(cr); acc[1] += lin(cg); acc[2] += lin(cb); }
      }
    }
    const k = 64 / (N * N), repeat = [1 / TU, 1 / TV];
    return {
      map: dataTex(col, N, N, { srgb: true, repeat }), normalMap: dataTex(normalBytes(Hh, N, N, (TU * 1000) / N, (TV * 1000) / N), N, N, { repeat }),
      roughnessMap: packTex(N, N, null, R, null, { repeat }), avg: [acc[0] * k, acc[1] * k, acc[2] * k], tile: [TU, TV],
    };
  });
}
