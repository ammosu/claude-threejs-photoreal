// Lived-in wear painted with Canvas2D: dust films, grease, finger prints, specks, lint, hairs, cup rings,
// hairline scratches, wipe marks — painted TWICE, once into colour and once into roughness, at the same coordinates.
// The roughness pass matters more than the colour pass: most wear is invisible until a highlight runs across it.
// Adapted from room-at-dawn (MIT) src/scene/parts/desk.js (deskMaps, lidMaps, speckleTexture) and clutter.js (scuffTex).
import { RNG, TAU, clamp, makeCanvas, canvasTex, avgColor } from './tex.js';

// ------------------------------------------------------------------ primitives (work on any 2D context)
/** Tile of random grey (lo..hi) used as a multiply / overlay grain. */
export function noiseTile(r, lo, hi, n = 256) {
  const cv = makeCanvas(n, n), q = cv.getContext('2d'), im = q.createImageData(n, n), d = im.data;
  for (let i = 0; i < n * n; i++) { const v = lo + r.next() * (hi - lo); d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
  q.putImageData(im, 0, 0); return cv;
}
export function overlay(c, W, H, tile, alpha, op) {
  c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = alpha; c.globalCompositeOperation = op; c.fillStyle = c.createPattern(tile, 'repeat'); c.fillRect(0, 0, W, H); c.restore();
}
/** Soft round blob, rgb = 'r,g,b'. */
export function softBlob(c, x, y, rad, rgb, a) {
  const g = c.createRadialGradient(x, y, 0, x, y, rad);
  g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(0.55, `rgba(${rgb},${a * 0.45})`); g.addColorStop(1, `rgba(${rgb},0)`);
  c.fillStyle = g; c.fillRect(x - rad, y - rad, rad * 2, rad * 2);
}
/** A wandering hairline (lint, hair, scratch: bend 0.9 / 0.5 / 0.05). Uses its own RNG so colour and roughness agree. */
export function strand(c, x, y, len, ang, bend, r) {
  const n = 6, st = len / n; let a = ang;
  c.beginPath(); c.moveTo(x, y);
  for (let i = 0; i < n; i++) {
    const mx = x + Math.cos(a) * st * 0.5, my = y + Math.sin(a) * st * 0.5; a += r.range(-bend, bend);
    x = mx + Math.cos(a) * st * 0.5; y = my + Math.sin(a) * st * 0.5; c.quadraticCurveTo(mx, my, x, y);
  }
  c.stroke();
}
/** Finger print: a soft greasy blob with concentric ridge arcs clipped to an ellipse. */
export function fingerprint(c, x, y, rx, ry, rot, col, a, r) {
  c.save(); c.translate(x, y); c.rotate(rot);
  softBlob(c, 0, 0, Math.max(rx, ry) * 1.3, col, a * 0.45);
  c.beginPath(); c.ellipse(0, 0, rx, ry, 0, 0, TAU); c.clip();
  c.strokeStyle = `rgba(${col},${a})`; c.lineWidth = 1.5;
  const ox = r.range(-0.2, 0.2) * rx, oy = r.range(0, 0.3) * ry, k = r.range(0.75, 0.95);
  for (let q = 2.2; q < ry * 2.3; q += 3.4) { c.beginPath(); c.ellipse(ox, oy + q * 0.35, q * k, q, 0, Math.PI * 0.92, Math.PI * 2.08); c.stroke(); }
  c.restore();
}

// ------------------------------------------------------------------ a whole worn surface
/**
 * Colour + roughness maps for a flat surface that has been used: desk tops, laptop lids, shelves, table tops,
 * appliance fronts. Canvas coordinates: x = 0..sizeM[0] metres, y = 0..sizeM[1] metres; y = 0 is the "back"
 * (wall side) where dust settles. ppm = pixels per metre (2000 ≈ 0.5 mm per px).
 *  base / roughBase: colour 'r,g,b' and roughness grey 0..255 (three.js reads roughness from G: a grey canvas works)
 *  hands: [[x, y], ...] in metres — where wrists/palms rest (greasier, glossier)
 *  rings: [[x, y, radius, strength]] — dried cup rings;  prints: number of finger prints;  dust: band width in metres
 * Every count can be set to 0. Returns { map, roughnessMap, avg, canvas, rough }.
 */
export function wornMaps({
  sizeM = [1.2, 0.6], ppm = 2000, base = '238,238,236', roughBase = 88, seed = 7, dust = 0.115, dustCol = '198,191,178',
  clouds = 70, wipes = 16, hands = [], rings = [], prints = 0, specks = 9000, lint = 70, hairs = 9, scratches = 80, grain = true, maxPx = 4096,
} = {}) {
  const r = new RNG(seed);
  let W = Math.round(sizeM[0] * ppm), H = Math.round(sizeM[1] * ppm);
  const k = Math.min(1, maxPx / Math.max(W, H)); W = Math.round(W * k); H = Math.round(H * k);
  const S = W / sizeM[0], mm = S / 1000;
  const cv = makeCanvas(W, H), c = cv.getContext('2d', { willReadFrequently: true });
  const rv = makeCanvas(W >> 1, H >> 1), q = rv.getContext('2d'); q.scale(0.5, 0.5);         // roughness at half resolution, same coordinates
  const both = (fn) => { fn(c, true); fn(q, false); };
  c.fillStyle = `rgb(${base})`; c.fillRect(0, 0, W, H); q.fillStyle = `rgb(${roughBase},${roughBase},${roughBase})`; q.fillRect(0, 0, W, H);
  c.lineCap = q.lineCap = 'round';
  // sheen is never even: slow clouds, arcs left by a wiping cloth, grease where the hands rest
  for (let i = 0; i < clouds; i++) softBlob(q, r.range(0, W), r.range(0, H), r.range(0.03, 0.15) * Math.max(W, H), r.chance(0.5) ? '150,150,150' : '40,40,40', r.range(0.05, 0.13));
  for (let i = 0; i < wipes; i++) {
    const cx = r.range(0.1, 0.9) * W, cy = H * r.range(0.9, 1.6), rad = r.range(0.35, 0.9) * H, a0 = -Math.PI / 2 + r.range(-0.9, 0.9), da = r.range(0.25, 0.7);
    for (let j = 0; j < 7; j++) { q.strokeStyle = `rgba(${r.chance(0.6) ? '52,52,52' : '128,128,128'},${r.range(0.03, 0.08)})`; q.lineWidth = r.range(6, 60); q.beginPath(); q.arc(cx, cy, rad + r.range(-70, 70), a0, a0 + da); q.stroke(); }
  }
  for (const [hx, hy] of hands) for (let j = 0; j < 5; j++) softBlob(q, (hx + r.range(-0.05, 0.05)) * S, (hy + r.range(-0.03, 0.02)) * S, r.range(50, 110) * mm, '36,36,36', r.range(0.06, 0.14));
  // dust: a band along the back edge plus patches
  if (dust > 0) {
    for (const [kx, col, a] of [[c, dustCol, 0.2], [q, '182,182,182', 0.6]]) {
      const g = kx.createLinearGradient(0, 0, 0, dust * S); g.addColorStop(0, `rgba(${col},${a})`); g.addColorStop(0.36, `rgba(${col},${a * 0.42})`); g.addColorStop(1, `rgba(${col},0)`);
      kx.fillStyle = g; kx.fillRect(0, 0, W, dust * S);
    }
    for (let i = 0; i < 26; i++) { const x = r.range(0, W), y = Math.abs(r.gauss()) * 0.03 * S, rad = r.range(0.02, 0.06) * S, a = r.range(0.04, 0.1); softBlob(c, x, y, rad, dustCol, a); softBlob(q, x, y, rad, '178,178,178', Math.min(1, a * 3.2)); }
  }
  // finger prints (show almost only in the roughness)
  for (let i = 0; i < prints; i++) {
    const x = r.range(0.06, 0.94) * W, y = r.range(0.08, 0.92) * H, rx = r.range(6.5, 8.5) * mm, ry = rx * r.range(1.15, 1.45), rot = r.range(-0.7, 0.7), a = r.range(0.35, 0.8);
    fingerprint(q, x, y, rx, ry, rot, '30,30,30', a * 0.8, new RNG(500 + i)); fingerprint(c, x, y, rx, ry, rot, '158,155,154', a * 0.16, new RNG(500 + i));
  }
  // specks: dark grit and pale crumbs, more of them near the back
  for (let i = 0; i < specks; i++) {
    const x = r.range(0, W), y = r.chance(0.3) ? Math.abs(r.gauss()) * 0.05 * S : r.range(0, H), s = r.range(0.6, 2.1) * (r.chance(0.06) ? 1.8 : 1) * (mm / 2);
    c.fillStyle = r.chance(0.6) ? `rgba(${r.int(70, 120)},${r.int(64, 108)},${r.int(56, 96)},${r.range(0.1, 0.42)})` : `rgba(252,251,248,${r.range(0.3, 0.7)})`;
    c.fillRect(x, y, s, s * r.range(0.6, 1.4));
    q.fillStyle = `rgba(215,215,215,${r.range(0.25, 0.7)})`; q.fillRect(x - 0.5, y - 0.5, s + 1, s + 1);
  }
  for (let i = 0; i < lint; i++) {
    const x = r.range(0, W), y = r.chance(0.35) ? Math.abs(r.gauss()) * 0.06 * S : r.range(0, H), len = r.range(3, 14) * mm, a = r.range(0, TAU), col = r.pick(['120,118,128', '236,236,240', '96,88,80', '150,140,160']);
    both((kx, isC) => { kx.strokeStyle = isC ? `rgba(${col},0.45)` : 'rgba(205,205,205,0.5)'; kx.lineWidth = isC ? 0.9 : 1.6; strand(kx, x, y, len, a, 0.9, new RNG(i * 31 + 7)); });
  }
  for (let i = 0; i < hairs; i++) {
    const x = r.range(0.05, 0.95) * W, y = r.range(0.08, 0.95) * H, len = r.range(25, 80) * mm, a = r.range(0, TAU), col = i % 3 === 2 ? '170,140,100' : '58,40,30';
    both((kx, isC) => { kx.strokeStyle = isC ? `rgba(${col},0.55)` : 'rgba(200,200,200,0.4)'; kx.lineWidth = isC ? 0.75 : 1.4; strand(kx, x, y, len, a, 0.5, new RNG(900 + i)); });
  }
  // dried cup rings: a faint stain and an uneven dark rim (coffee-ring effect)
  for (const [x, y, rad, a] of rings) both((kx, isC) => {
    const rr = new RNG(Math.round(x * 1000 + y * 77)), cx = x * S, cy = y * S, R = rad * S;
    if (isC) softBlob(kx, cx, cy, R, '176,140,96', a * 0.08);
    for (let t = 0; t < 90; t++) {
      const a0 = (t / 90) * TAU, al = a * clamp(0.45 + 0.8 * Math.sin(a0 * 1.3 + 1.1) * Math.sin(a0 * 2.9 + 0.4) + rr.range(-0.12, 0.12), 0, 1);
      kx.strokeStyle = isC ? `rgba(150,108,64,${al})` : `rgba(190,190,190,${Math.min(1, al * 1.5)})`; kx.lineWidth = (isC ? 0.9 : 1.2) * mm * rr.range(0.7, 1.3);
      kx.beginPath(); kx.arc(cx, cy, R * (1 + 0.004 * Math.sin(a0 * 5)), a0, a0 + TAU / 90 + 0.01); kx.stroke();
    }
  });
  for (let i = 0; i < scratches; i++) {
    const x = r.range(0, W), y = r.range(0, H), len = r.range(8, 110) * mm * (r.chance(0.15) ? 2 : 1), a = r.range(0, TAU), deep = r.chance(0.2);
    both((kx, isC) => { kx.strokeStyle = isC ? `rgba(196,196,194,${deep ? 0.5 : 0.22})` : `rgba(190,190,190,${deep ? 0.75 : 0.4})`; kx.lineWidth = isC ? 0.7 : 1.3; strand(kx, x, y, len, a, 0.06, new RNG(3000 + i)); });
  }
  if (grain) { overlay(c, W, H, noiseTile(r, 245, 255), 1, 'multiply'); overlay(q, W / 2, H / 2, noiseTile(r, 108, 148), 0.5, 'overlay'); }
  return {
    map: canvasTex(cv, { srgb: true, wrap: false }), roughnessMap: canvasTex(rv, { wrap: false }),
    avg: avgColor(c.getImageData(0, 0, W, H).data), canvas: cv, rough: rv, size: [W, H],
  };
}

/** Speckled stoneware glaze (iron specks + faint blush), white-based: multiply it over a tinted material or vertex colours. */
export function speckleTexture({ seed = 5521, N = 512, specks = 520 } = {}) {
  const cv = makeCanvas(N, N), c = cv.getContext('2d'), r = new RNG(seed);
  c.fillStyle = '#fff'; c.fillRect(0, 0, N, N);
  for (let i = 0; i < 22; i++) softBlob(c, r.range(0.26, 0.74) * N, r.range(0.26, 0.74) * N, r.range(40, 130) * (N / 512), '212,198,190', r.range(0.05, 0.14));
  for (let i = 0; i < specks; i++) {
    const s = r.range(0.5, 1.7) * (r.chance(0.08) ? 1.8 : 1) * (N / 512);
    c.fillStyle = `rgba(${r.int(70, 120)},${r.int(48, 80)},${r.int(34, 60)},${r.range(0.25, 0.75)})`; c.beginPath(); c.arc(r.range(3, N - 3), r.range(3, N - 3), s, 0, TAU); c.fill();
  }
  return canvasTex(cv, { srgb: true });
}
/** Powder-coated metal after use: hairline scuffs (more towards the bottom) and pale chips along the base edge. */
export function scuffTexture({ color = '#546b75', seed = 7719, N = 512 } = {}) {
  const cv = makeCanvas(N, N), c = cv.getContext('2d', { willReadFrequently: true }), r = new RNG(seed);
  c.fillStyle = color; c.fillRect(0, 0, N, N); c.lineCap = 'round';
  for (let i = 0; i < 90; i++) {
    const y = N * (1 - Math.pow(r.next(), 1.8) * 0.9), x = r.range(0, N), l = r.range(4, 46), a = r.gauss() * 0.25;
    c.strokeStyle = `rgba(190,205,210,${r.range(0.1, 0.4).toFixed(2)})`; c.lineWidth = r.range(0.5, 1.2);
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke();
  }
  for (let i = 0; i < 14; i++) { c.fillStyle = 'rgba(205,208,210,0.85)'; c.beginPath(); c.ellipse(r.range(0, N), N - r.range(2, 16), r.range(1, 3.2), r.range(0.7, 1.6), r.range(0, 3), 0, TAU); c.fill(); }
  return { map: canvasTex(cv, { srgb: true }), avg: avgColor(c.getImageData(0, 0, N, N).data) };
}
