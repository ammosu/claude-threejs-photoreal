// Leaf atlas (4 x 4 tiles drawn with Canvas2D: colour + normal + per-leaflet parameters) and bark maps.
// Adapted from room-at-dawn (MIT) src/scene/parts/exterior.js.
// Tiles: row 0 robinia-like compound sprays, row 1 ash-like sprays + single compound leaves,
// row 2 simple ovate leaves on a twig (lime-like), row 3 dense leaf clusters (for mid / far trees).
// The stem of every tile enters at the bottom centre: a card's pivot is (0.5, 0) in tile space.
import { RNG, TAU, clamp, lerp, smoothstep, fbm2, makeCanvas, dataTex, normalData } from './util.js';

export const TILE_SCALE = [1, 1, 1.35, 1.3, 1, 1.35, 0.8, 0.8, 1, 1, 1, 1, 1, 1, 1, 1];
export function buildAtlas() {
  // colour atlas, normal atlas and a per-leaflet parameter atlas (r = thin translucent blade, g = gloss, b = random id)
  const G = 4, T = 512, N = G * T, TN = 512, NN = G * TN, TP = 256, NP = G * TP;
  const cc = makeCanvas(N, N), cn = makeCanvas(NN, NN), cp = makeCanvas(NP, NP);
  const g = cc.getContext('2d', { willReadFrequently: true }), gn = cn.getContext('2d', { willReadFrequently: true }), gp = cp.getContext('2d', { willReadFrequently: true });
  gn.fillStyle = 'rgb(128,128,255)'; gn.fillRect(0, 0, NN, NN);
  gp.fillStyle = 'rgb(70,50,128)'; gp.fillRect(0, 0, NP, NP);
  g.lineCap = g.lineJoin = gp.lineCap = gp.lineJoin = 'round';
  const rng = new RNG(90417);
  const hsl = (h, s, l, a = 1) => `hsla(${h.toFixed(1)},${clamp(s, 0, 100).toFixed(1)}%,${clamp(l, 0, 100).toFixed(1)}%,${a})`;
  // tangent-space normal colour for a facet tilted by slopes (along, across) on a leaf pointing at `ang`
  const nrmCol = (ang, tA, tC, a = 1) => {
    const ca = Math.cos(ang), sa = Math.sin(ang), sx = tA * ca - tC * sa, sy = tA * sa + tC * ca, il = 1 / Math.hypot(sx, sy, 1);
    return `rgba(${Math.round((-sx * il * 0.5 + 0.5) * 255)},${Math.round((sy * il * 0.5 + 0.5) * 255)},${Math.round((il * 0.5 + 0.5) * 255)},${a})`;
  };
  const SH = { rob: [0.04, 1.2, 0.98, 1.2], ash: [0.22, 1.25, 0.62, 0.72], lime: [-0.02, 1.55, 0.5, 0.95], gen: [0.12, 1.3, 0.7, 0.9] };
  const ROB = { sh: SH.rob, pairs: 7, ll: 0.19, wr: 0.25, ang: 1.15, h: 89, s: 47, l: 36, veins: 0 };
  const ASH = { sh: SH.ash, pairs: 5, ll: 0.3, wr: 0.15, ang: 0.95, h: 97, s: 43, l: 31, veins: 5 };
  const LIME = { sh: SH.lime, h: 95, s: 45, l: 32, veins: 6 };
  const GEN = { sh: SH.gen, h: 96, s: 43, l: 31, veins: 3 };
  const TWIG = 'hsl(42,22%,19%)', RACHIS = 'hsl(72,40%,43%)';

  function leaf(x, y, ang, L, W, sp, shade = 1) {
    // new growth is lighter, yellower, thin and matte; old leaves are darker, thick and often waxy
    const age = rng.next(), young = age < 0.08, old = age > 0.91;
    const h = sp.h + rng.range(-7, 6) - (young ? 5 : old ? -5 : 0), s = sp.s + rng.range(-7, 5) + (young ? 2 : old ? -6 : 0);
    const l = (sp.l + rng.range(-4, 4)) * shade * (young ? 1.1 : old ? 0.9 : 1);
    const fold = rng.range(0.12, 0.5), cup = rng.range(-0.6, 0.45), tip = rng.gauss() * 0.4 - 0.12, tA = rng.gauss() * 0.4, tC = rng.gauss() * 0.4, lit = rng.sign(), sh = sp.sh;
    const thin = clamp((young ? 0.75 : old ? 0.2 : 0.4) + rng.range(-0.15, 0.18)), gloss = young ? rng.range(0.1, 0.45) : rng.chance(0.4) ? rng.range(0.5, 0.9) : rng.range(0.08, 0.35);
    const path = (c, half) => {
      c.beginPath(); c.moveTo(0, 0); c.bezierCurveTo(L * sh[0], W * sh[1], L * sh[2], W * sh[3], L, 0);
      if (half) c.closePath(); else c.bezierCurveTo(L * sh[2], -W * sh[3], L * sh[0], -W * sh[1], 0, 0);
    };
    g.save(); g.translate(x, y); g.rotate(ang);
    g.globalCompositeOperation = 'source-atop';                    // contact shadow on whatever lies underneath
    path(g, 0); g.strokeStyle = 'rgba(6,18,5,0.2)'; g.lineWidth = W * 1.1; g.stroke(); g.lineWidth = W * 0.5; g.stroke();
    g.globalCompositeOperation = 'source-over';
    path(g, 0); g.fillStyle = hsl(h, s, l); g.fill();
    const gl = g.createLinearGradient(0, 0, L, 0);                 // paler towards the stalk, deeper at the tip
    gl.addColorStop(0, 'rgba(250,255,160,0.1)'); gl.addColorStop(0.45, 'rgba(250,255,160,0)'); gl.addColorStop(1, 'rgba(0,25,10,0.1)');
    g.fillStyle = gl; g.fill();
    // V fold: one half catches more sky, the other is shaded most in the crease along the midrib
    for (const [sg, c0, c1] of [[lit, 'rgba(255,255,190,0.02)', 'rgba(255,255,190,0.15)'], [-lit, 'rgba(0,12,0,0.26)', 'rgba(0,12,0,0.04)']]) {
      g.save(); g.scale(1, sg); path(g, 1);
      const gh = g.createLinearGradient(0, 0, 0, W * 0.85); gh.addColorStop(0, c0); gh.addColorStop(1, c1); g.fillStyle = gh; g.fill(); g.restore();
    }
    if (L > 0.04) {                                                // soft blotches: no leaf is one flat colour
      g.save(); path(g, 0); g.clip();
      for (let i = 0; i < 3; i++) {
        const bx = L * rng.range(0.15, 0.9), by = W * rng.range(-0.5, 0.5), br = L * rng.range(0.12, 0.28), gb = g.createRadialGradient(bx, by, 0, bx, by, br), dk = rng.chance(0.5);
        gb.addColorStop(0, dk ? 'rgba(0,20,8,0.14)' : 'rgba(230,255,150,0.1)'); gb.addColorStop(1, dk ? 'rgba(0,20,8,0)' : 'rgba(230,255,150,0)');
        g.fillStyle = gb; g.fillRect(0, -W * 1.3, L, W * 2.6);
      }
      g.restore();
    }
    gp.save(); gp.translate(x, y); gp.rotate(ang); path(gp, 0); gp.fillStyle = `rgb(${Math.round(thin * 255)},${Math.round(gloss * 255)},${rng.int(0, 255)})`; gp.fill(); gp.restore();
    if (sp.veins) {
      g.save(); path(g, 0); g.clip();
      g.strokeStyle = hsl(h - 12, s - 8, l + 12, 0.5); g.lineWidth = Math.max(L * 0.013, 0.002);
      for (let i = 1; i <= sp.veins; i++) {
        const t = (i / (sp.veins + 1)) * 0.9;
        for (const sg of [-1, 1]) { g.beginPath(); g.moveTo(L * t, 0); g.quadraticCurveTo(L * (t + 0.1), sg * W * 0.55, L * (t + 0.27), sg * W * 1.3); g.stroke(); }
      }
      g.restore();
    }
    g.strokeStyle = hsl(h - 14, s - 6, l + 16, 0.8); g.lineWidth = Math.max(L * 0.024, 0.0028);
    g.beginPath(); g.moveTo(0, 0); g.lineTo(L * 0.95, 0); g.stroke();
    g.restore();
    // relief: the leaflet's own tilt, a V fold along the midrib whose halves cup or roll towards the margin, a curling tip
    gn.save(); gn.translate(x, y); gn.rotate(ang);
    for (const sg of [1, -1]) {
      gn.save(); gn.scale(1, sg); path(gn, 1);
      const gr = gn.createLinearGradient(0, 0, 0, W * 0.9);
      gr.addColorStop(0, nrmCol(ang, tA, tC + sg * fold * 1.3)); gr.addColorStop(0.45, nrmCol(ang, tA, tC + sg * (fold + cup * 0.35))); gr.addColorStop(1, nrmCol(ang, tA, tC + sg * (fold + cup)));
      gn.fillStyle = gr; gn.fill(); gn.restore();
    }
    path(gn, 0);
    const gt = gn.createLinearGradient(L * 0.25, 0, L, 0); gt.addColorStop(0, nrmCol(ang, tA + tip, tC, 0)); gt.addColorStop(1, nrmCol(ang, tA + tip, tC, 0.8));
    gn.fillStyle = gt; gn.fill();
    gn.restore();
  }
  function stem(pts, w, col) {
    for (const c of [g, gp]) {
      c.strokeStyle = c === g ? col : 'rgb(0,30,128)'; c.lineWidth = w; c.beginPath();
      pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.stroke();
    }
  }
  // curved axis (twig or rachis) -> points [x, y, heading]
  function axis(x, y, ang, len, bend, m = 12) {
    const pts = [], ds = len / m;
    for (let i = 0; i <= m; i++) { pts.push([x, y, ang]); ang += bend / m; x += Math.cos(ang) * ds; y += Math.sin(ang) * ds; }
    return pts;
  }
  const on = (pts, t) => { const f = t * (pts.length - 1), k = Math.min(pts.length - 2, Math.floor(f)), r = f - k; return [lerp(pts[k][0], pts[k + 1][0], r), lerp(pts[k][1], pts[k + 1][1], r), pts[k][2]]; };
  // pinnately compound leaf: rachis with opposite leaflet pairs and a terminal leaflet
  function pinnate(x, y, ang, len, sp, shade) {
    const n = sp.pairs + rng.int(-1, 1), pts = axis(x, y, ang, len, rng.range(-0.4, 0.4));
    stem(pts, len * 0.013, RACHIS);
    const st = len * 0.016;                                         // each leaflet sits on a short stalk, clear of the rachis
    for (let i = 0; i < n; i++) {
      const t = 0.16 + (0.77 * i) / (n - 1), q = on(pts, t), ll = len * sp.ll * (0.7 + 0.5 * Math.sin(Math.PI * Math.min(1, t * 1.2)));
      for (const sg of [-1, 1]) {
        const L = ll * rng.range(0.85, 1.1), la = q[2] + sg * (sp.ang + rng.range(-0.2, 0.2)), bx = q[0] + Math.cos(la) * st, by = q[1] + Math.sin(la) * st;
        stem([[q[0], q[1]], [bx, by]], len * 0.007, RACHIS);
        leaf(bx, by, la, L, L * sp.wr, sp, shade * rng.range(0.9, 1.06));
      }
    }
    const e = pts[pts.length - 1], L = len * sp.ll * 0.9; leaf(e[0], e[1], e[2] + rng.range(-0.25, 0.25), L, L * sp.wr, sp, shade);
  }
  const pairTile = (sp) => {
    stem([[0, 0], [0.004, 0.1]], 0.016, TWIG);
    const a = rng.range(0.36, 0.5), first = rng.sign();
    pinnate(0, 0.07, Math.PI / 2 + first * a + rng.range(-0.06, 0.06), rng.range(0.68, 0.75), sp, 0.86);
    pinnate(0.004, 0.1, Math.PI / 2 - first * a + rng.range(-0.06, 0.06), rng.range(0.68, 0.75), sp, 1);
  };
  const sprayTile = (sp) => {
    const first = rng.sign();
    stem([[0, 0], [0.012 * first, 0.2], [-0.008 * first, 0.4]], 0.015, TWIG);
    pinnate(0.004 * first, 0.07, Math.PI / 2 + first * rng.range(0.75, 0.92), 0.47, sp, 0.84);
    pinnate(0.012 * first, 0.21, Math.PI / 2 - first * rng.range(0.7, 0.88), 0.48, sp, 0.93);
    pinnate(-0.008 * first, 0.39, Math.PI / 2 + rng.range(-0.15, 0.15), 0.46, sp, 1.02);
  };
  const fanTile = (sp) => {
    stem([[0, 0], [0, 0.06]], 0.016, TWIG);
    for (const k of [-2, 2, -1, 1, 0]) pinnate(0, 0.05, Math.PI / 2 + k * 0.5 + rng.range(-0.08, 0.08), Math.abs(k) === 2 ? 0.42 : Math.abs(k) === 1 ? 0.56 : 0.62, sp, 0.84 + 0.06 * (2 - Math.abs(k)) + (k === 0 ? 0.06 : 0));
  };
  const singleTile = (sp) => pinnate(0, 0.012, Math.PI / 2 + rng.range(-0.05, 0.05), 0.82, { ...sp, pairs: sp.pairs + 2 }, 1);
  // twig with alternate simple leaves on short petioles
  const simpleTile = (sp, n) => {
    const pts = axis(0, 0, Math.PI / 2 + rng.range(-0.1, 0.1), 0.72, rng.range(-0.35, 0.35), 10);
    stem(pts, 0.014, TWIG);
    const first = rng.sign();
    for (let i = 0; i < n; i++) {
      const t = 0.07 + (0.9 * i) / (n - 1), q = on(pts, t), sg = i % 2 ? first : -first;
      const la = q[2] + sg * rng.range(0.7, 1.15), L = lerp(0.27, 0.19, t) * rng.range(0.85, 1.1);
      const bx = q[0] + Math.cos(la) * 0.035, by = q[1] + Math.sin(la) * 0.035;
      stem([[q[0], q[1]], [bx, by]], 0.008, RACHIS);
      leaf(bx, by, la + rng.range(-0.3, 0.3), L, L * 0.33, sp, 0.82 + 0.2 * t);
    }
    const e = pts[10]; leaf(e[0], e[1], e[2] + rng.range(-0.2, 0.2), 0.2, 0.066, sp, 1.03);
  };
  // foliage mass: a few loose clumps of leaves on twiglets (so the outline is lobed, with sky holes), lower layers darker
  const clusterTile = (n, sp, lobes) => {
    const cs = [];
    for (let i = 0; i < lobes; i++) { const a = (i / lobes) * TAU + rng.range(-0.5, 0.5), r = rng.range(0.1, 0.3); cs.push([Math.cos(a) * r, 0.5 + Math.sin(a) * r, rng.range(0.06, 0.11)]); }
    const tw = cs.map((c) => [[rng.range(-0.03, 0.03), 0.5 + rng.range(-0.03, 0.03)], [c[0] * 0.6 + rng.range(-0.04, 0.04), 0.5 + (c[1] - 0.5) * 0.6 + rng.range(-0.04, 0.04)], [c[0], c[1]]]);
    for (const t of tw) stem(t, 0.011, TWIG);
    for (let i = 0; i < n; i++) {
      if (i === Math.floor(n * 0.55)) for (const t of tw) stem(t, 0.008, TWIG);     // twiglets show between the upper leaves
      const c = cs[rng.int(0, lobes - 1)]; let x, y, k = 0;
      do { x = c[0] + rng.gauss() * c[2]; y = c[1] + rng.gauss() * c[2]; } while (k++ < 20 && (Math.abs(x) > 0.4 || Math.abs(y - 0.5) > 0.4));
      const L = rng.range(0.1, 0.15), a = rng.range(0, TAU);
      leaf(x - Math.cos(a) * L * 0.5, y - Math.sin(a) * L * 0.5, a, L, L * 0.3, sp, 0.6 + 0.45 * (i / n));
    }
  };
  const tiles = [
    () => pairTile(ROB), () => pairTile(ROB), () => sprayTile(ROB), () => fanTile(ROB),
    () => pairTile(ASH), () => sprayTile(ASH), () => singleTile(ASH), () => singleTile(ROB),
    () => simpleTile(LIME, 7), () => simpleTile(LIME, 8), () => simpleTile(LIME, 6), () => simpleTile(LIME, 7),
    () => clusterTile(125, GEN, 6), () => clusterTile(115, GEN, 5), () => clusterTile(85, GEN, 4), () => clusterTile(55, GEN, 3),
  ];
  for (let i = 0; i < 16; i++) {
    const col = i & 3, row = i >> 2;
    for (const [c, s] of [[g, T], [gn, TN], [gp, TP]]) { c.save(); c.beginPath(); c.rect(col * s, row * s, s, s); c.clip(); c.translate((col + 0.5) * s, (row + 0.988) * s); c.scale(s, -s); }
    tiles[i]();
    g.restore(); gn.restore(); gp.restore();
  }

  // ---- colour: un-premultiplied RGBA with leaf colour bled into the empty texels, then a mip chain
  // that keeps each tile's alpha-test coverage (otherwise distant foliage thins out to nothing).
  const base = new Uint8Array(g.getImageData(0, 0, N, N).data.buffer);
  const cov = new Float32Array(16);
  for (let ti = 0; ti < 16; ti++) {
    const x0 = (ti & 3) * T, y0 = (ti >> 2) * T; let r = 0, gg = 0, b = 0, n = 0, c = 0;
    for (let y = y0; y < y0 + T; y++) for (let x = x0; x < x0 + T; x++) { const o = (y * N + x) * 4, a = base[o + 3]; if (a >= 128) c++; if (a > 200) { r += base[o]; gg += base[o + 1]; b += base[o + 2]; n++; } }
    r /= n || 1; gg /= n || 1; b /= n || 1; cov[ti] = c / (T * T);
    for (let y = y0; y < y0 + T; y++) for (let x = x0; x < x0 + T; x++) { const o = (y * N + x) * 4; if (base[o + 3] < 6) { base[o] = r; base[o + 1] = gg; base[o + 2] = b; } }
  }
  const mips = [{ data: base, width: N, height: N }];
  let src = base, n = N; const hist = new Uint32Array(256);
  while (n > 1) {
    const m = n >> 1, dst = new Uint8Array(m * m * 4);
    for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) {
      const o0 = (2 * y * n + 2 * x) * 4, o1 = o0 + 4, o2 = o0 + n * 4, o3 = o2 + 4, o = (y * m + x) * 4;
      const a0 = src[o0 + 3], a1 = src[o1 + 3], a2 = src[o2 + 3], a3 = src[o3 + 3], as = a0 + a1 + a2 + a3;
      if (as > 0) for (let k = 0; k < 3; k++) dst[o + k] = (src[o0 + k] * a0 + src[o1 + k] * a1 + src[o2 + k] * a2 + src[o3 + k] * a3) / as;
      else for (let k = 0; k < 3; k++) dst[o + k] = (src[o0 + k] + src[o1 + k] + src[o2 + k] + src[o3 + k]) >> 2;
      dst[o + 3] = as >> 2;
    }
    const out = new Uint8Array(dst), ts = m / G;
    if (ts >= 1) for (let ti = 0; ti < 16; ti++) {
      const x0 = (ti & 3) * ts, y0 = (ti >> 2) * ts; hist.fill(0);
      for (let y = y0; y < y0 + ts; y++) for (let x = x0; x < x0 + ts; x++) hist[dst[(y * m + x) * 4 + 3]]++;
      let want = cov[ti] * ts * ts, acc = 0, thr = 255;
      while (thr > 1 && acc + hist[thr] <= want) acc += hist[thr--];
      const k = 128 / Math.max(thr, 1);
      if (k > 1) for (let y = y0; y < y0 + ts; y++) for (let x = x0; x < x0 + ts; x++) { const o = (y * m + x) * 4 + 3; out[o] = Math.min(255, dst[o] * k); }
    }
    mips.push({ data: out, width: m, height: m });
    src = dst; n = m;
  }
  const map = dataTex(base, N, N, { srgb: true, wrap: false });
  map.mipmaps = mips; map.generateMipmaps = false; map.needsUpdate = true;
  const normalMap = dataTex(new Uint8Array(gn.getImageData(0, 0, NN, NN).data.buffer), NN, NN, { wrap: false });
  // mean opaque fraction of a card: the bake lets the rest of the rays pass straight through
  let cover = 0; for (let i = 0; i < 16; i++) cover += cov[i] / 16;
  const paramMap = dataTex(new Uint8Array(gp.getImageData(0, 0, NP, NP).data.buffer), NP, NP, { wrap: false });
  return { map, normalMap, paramMap, cover };
}


export function barkMaps() {
  const N = 512, H = new Float32Array(N * N), col = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N;
    const w = fbm2(u * 4, v * 4, { oct: 3, seed: 61, period: 4 }), w2 = fbm2(u * 24, v * 24, { oct: 2, seed: 67, period: 24 });
    const ridge = Math.pow(Math.abs(Math.sin(Math.PI * (7 * u + 2.2 * w + 0.3 * w2 + 0.25 * Math.sin(TAU * (2 * v + w))))), 0.6);   // meandering vertical furrows
    const crack = (1 - smoothstep(0, 0.14, Math.abs(Math.sin(Math.PI * (5 * v + 3 * w2 + 2 * w))))) * smoothstep(0.45, 0.6, w);
    const h = ridge * 0.85 + (w2 - 0.5) * 0.4 - crack * 0.35, i = y * N + x, k = 0.42 + 0.72 * clamp(h), moss = smoothstep(0.56, 0.34, w) * 0.5;
    H[i] = h;
    col[i * 4] = clamp(lerp(0.37, 0.3, moss) * k) * 255; col[i * 4 + 1] = clamp(lerp(0.33, 0.35, moss) * k) * 255; col[i * 4 + 2] = clamp(lerp(0.28, 0.24, moss) * k) * 255; col[i * 4 + 3] = 255;
  }
  return { map: dataTex(col, N, N, { srgb: true }), normalMap: dataTex(normalData(H, N, N, 3.2), N, N, {}) };
}
