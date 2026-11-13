// Printed matter painted with Canvas2D: invented words, book covers packed into one atlas (+ book geometry whose UVs
// point into it), page edges, a topographic poster, small photo prints, paper grain.
// Nothing is copied from real books or brands: titles and authors come from a syllable table, art is geometric.
// Adapted from room-at-dawn (MIT) src/scene/parts/desk.js (drawBook, paintBooks, bookGeos, packer, fitText,
// paperGrain, pagesTexture) and decor.js (paintPoster, paintPhotos).
import * as THREE from 'three';
import { RNG, TAU, clamp, lerp, smoothstep, hash2, pfbm, makeCanvas, canvasTex, avgColor } from './tex.js';

export const FONTS = ['Georgia, "Times New Roman", serif', '"Trebuchet MS", "Segoe UI", Arial, sans-serif', '"Palatino Linotype", "Book Antiqua", Georgia, serif', '"Courier New", Courier, monospace', 'Arial, Helvetica, sans-serif'];
const SYL = ['ma', 'ri', 'el', 'no', 'ta', 'vi', 'lu', 'sen', 'dor', 'al', 'ke', 'mi', 'ora', 'an', 'be', 'li', 'os', 'ne', 'ur', 'ha', 'ven', 'io', 'ca', 'su', 'rem', 'ty', 'ol', 'fa', 'ge', 'wyn', 'bri', 'est', 'und', 'ila', 'mor', 'pel'];
/** Invented, pronounceable word / phrase (no real titles, names or brands). */
export function word(r, n = r.int(2, 3)) { let s = ''; for (let i = 0; i < n; i++) s += r.pick(SYL); return s[0].toUpperCase() + s.slice(1); }
export function phrase(r, n) { const a = []; for (let i = 0; i < n; i++) a.push(word(r)); return a.join(' '); }
/** Cover palettes [ground, text, accent]: muted, printable colours. */
export const PAL = [
  ['#2f3d54', '#ece4d2', '#c9a24a'], ['#8b9a83', '#23302a', '#f0eadc'], ['#c8a19b', '#3b2a2a', '#f3ece2'], ['#e9e2d0', '#2c2c2e', '#b7694c'],
  ['#c7a04c', '#2b2418', '#f4eedd'], ['#b3664b', '#f5ead9', '#2e2a28'], ['#38383b', '#e8e2d4', '#c8a19b'], ['#a8bbc9', '#22303c', '#f1ede4'],
  ['#3e594a', '#e9e3d0', '#c9a24a'], ['#f1eee6', '#2a2a2c', '#4b7a7c'], ['#6c4a59', '#efe4dc', '#d4c2a0'], ['#d3c19f', '#3a2e22', '#8f4338'],
  ['#4a7778', '#eef0e6', '#e9d9a8'], ['#8d4439', '#f2e6d6', '#d9b98a'],
];

/** Shelf packer for atlases: returns slot(w, h) -> {x, y, w, h}, rows left to right, top to bottom. */
export function packer(W, pad) {
  let cx = 0, cy = 0, rowH = 0;
  return (w, h) => {
    if (cx + w + 2 * pad > W) { cx = 0; cy += rowH; rowH = 0; }
    const s = { x: cx + pad, y: cy + pad, w, h }; cx += w + 2 * pad; rowH = Math.max(rowH, h + 2 * pad); return s;
  };
}
/** Set c.font so `text` fits maxW (shrinks only). Returns the size used. */
export function fitText(c, text, maxW, size, font, weight = '') {
  let fs = size; c.font = `${weight} ${fs}px ${font}`;
  const m = c.measureText(text).width;
  if (m > maxW) { fs = Math.max(5, (fs * maxW) / m); c.font = `${weight} ${fs}px ${font}`; }
  return fs;
}
/** Multiply a fine paper grain over the whole canvas (kills the "flat CSS colour" look of printed areas). */
export function paperGrain(c, W, H, r, alpha) {
  const n = 128, cv = makeCanvas(n, n), q = cv.getContext('2d');
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const v = 226 + r.int(0, 29); q.fillStyle = `rgb(${v},${v},${v - 3})`; q.fillRect(x, y, 1, 1); }
  c.save(); c.globalAlpha = alpha; c.globalCompositeOperation = 'multiply'; c.fillStyle = c.createPattern(cv, 'repeat'); c.fillRect(0, 0, W, H); c.restore();
}

// ================================================================== books
/** A book description. w, h, t = cover width, height, thickness (m). full = paint front/back art (visible covers);
 *  otherwise only the spine is detailed (books standing in a row). */
export function makeBook(r, w, h, t, pal, o = {}) {
  return { w, h, t, pal, hard: false, full: false, style: r.int(0, 4), cover: r.int(0, 2), font: r.int(0, 3), bold: r.chance(0.4), mark: r.int(0, 1),
    title: phrase(r, r.chance(0.35) ? 1 : 2), author: word(r, 2) + ' ' + word(r, 2), ...o };
}
function drawBook(c, b, r) {
  const { x, y, wp, sp, hp } = b.slot, [bg, fg, ac] = PAL[b.pal % PAL.length], font = FONTS[b.font];
  const sx = x + wp, fx = sx + sp, X0 = x - 5, WW = wp * 2 + sp + 10;
  c.fillStyle = bg; c.fillRect(X0, y - 5, WW, hp + 10);
  if (b.style === 1) { c.fillStyle = ac; c.fillRect(X0, y + hp * 0.055, WW, hp * 0.02); c.fillRect(X0, y + hp * 0.9, WW, hp * 0.02); }
  if (b.style === 2) { c.fillStyle = ac; c.fillRect(X0, y + hp * 0.72, WW, hp * 0.28 + 5); }
  if (b.style === 4) { c.fillStyle = ac; c.fillRect(X0, y - 5, WW, hp * 0.15 + 5); }
  let ink = fg;
  if (b.style === 3) { c.fillStyle = '#efe9da'; c.fillRect(sx + sp * 0.12, y + hp * 0.13, sp * 0.76, hp * 0.52); ink = '#2a2826'; }
  c.save(); c.translate(sx + sp / 2, y + hp * 0.4); c.rotate(Math.PI / 2);            // spine lettering reads top to bottom
  c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = ink;
  fitText(c, b.title, hp * (b.style === 3 ? 0.46 : 0.5), clamp(sp * 0.5, 9, hp * 0.085), font, b.bold ? 'bold' : '');
  c.fillText(b.title, 0, 0); c.restore();
  const low = b.style === 2 ? bg : fg;
  c.save(); c.translate(sx + sp / 2, y + hp * 0.8); c.rotate(Math.PI / 2);
  c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = low; c.globalAlpha = 0.85;
  fitText(c, b.author.toUpperCase(), hp * 0.2, clamp(sp * 0.28, 7, hp * 0.04), FONTS[4]);
  c.fillText(b.author.toUpperCase(), 0, 0); c.restore();
  const mx = sx + sp / 2, my = y + hp * 0.955, mr = Math.min(sp * 0.2, hp * 0.018);
  c.fillStyle = low; c.strokeStyle = low; c.lineWidth = Math.max(1, sp * 0.05); c.beginPath();
  if (b.mark === 0) { c.arc(mx, my, mr, 0, TAU); c.stroke(); } else { c.moveTo(mx, my - mr); c.lineTo(mx + mr, my); c.lineTo(mx, my + mr); c.lineTo(mx - mr, my); c.closePath(); c.fill(); }
  c.fillStyle = 'rgba(250,244,232,0.14)'; c.fillRect(sx - 1.5, y, 3, hp); c.fillRect(fx - 1.5, y, 3, hp);       // rubbed hinge edges
  c.fillStyle = 'rgba(250,244,232,0.2)'; c.fillRect(sx, y, sp, 2.5); c.fillRect(sx, y + hp - 2.5, sp, 2.5);       // head and tail of the spine
  if (!b.full) return;
  const m = wp * 0.1, words = b.title.split(' '), wt = b.bold ? 'bold' : '';
  c.save(); c.beginPath(); c.rect(fx, y, wp, hp); c.clip(); c.textBaseline = 'alphabetic';
  if (b.cover === 0) {
    c.fillStyle = ac; c.beginPath(); c.arc(fx + wp * 0.7, y + hp * 0.66, wp * 0.4, 0, TAU); c.fill();
    c.fillStyle = bg; c.beginPath(); c.arc(fx + wp * 0.56, y + hp * 0.6, wp * 0.3, 0, TAU); c.fill();
    c.fillStyle = fg; c.textAlign = 'left'; let ty = y + hp * 0.17; const fs = wp * 0.16;
    for (const wd of words) { fitText(c, wd, wp - 2 * m, fs, font, wt); c.fillText(wd, fx + m, ty); ty += fs * 1.08; }
    c.fillRect(fx + m, ty - fs * 0.62, wp * 0.18, Math.max(2, hp * 0.004));
    c.font = `${wp * 0.05}px ${FONTS[4]}`; c.fillText(b.author.toUpperCase(), fx + m, y + hp * 0.93);
  } else if (b.cover === 1) {
    c.strokeStyle = fg; c.lineWidth = Math.max(1.5, wp * 0.006); c.strokeRect(fx + m * 0.6, y + m * 0.6, wp - m * 1.2, hp - m * 1.2);
    c.fillStyle = fg; c.textAlign = 'center'; let ty = y + hp * 0.3; const fs = wp * 0.13;
    for (const wd of words) { fitText(c, wd, wp - 2.6 * m, fs, font, wt); c.fillText(wd, fx + wp / 2, ty); ty += fs * 1.15; }
    c.fillStyle = ac; c.beginPath(); c.moveTo(fx + wp / 2, ty); c.lineTo(fx + wp / 2 + m * 0.3, ty + m * 0.3); c.lineTo(fx + wp / 2, ty + m * 0.6); c.lineTo(fx + wp / 2 - m * 0.3, ty + m * 0.3); c.closePath(); c.fill();
    c.fillRect(fx + wp * 0.2, ty + m * 0.28, wp * 0.22, Math.max(1.5, hp * 0.003)); c.fillRect(fx + wp * 0.58, ty + m * 0.28, wp * 0.22, Math.max(1.5, hp * 0.003));
    c.fillStyle = fg; c.font = `${wp * 0.052}px ${FONTS[4]}`; c.fillText(b.author.toUpperCase(), fx + wp / 2, y + hp * 0.84);
  } else {
    c.fillStyle = ac; for (let i = 0; i < 7; i++) c.fillRect(fx, y + hp * (0.07 + i * 0.062), wp, hp * 0.03);
    c.fillStyle = fg; c.textAlign = 'left'; let ty = y + hp * 0.66; const fs = wp * 0.145;
    for (const wd of words) { fitText(c, wd, wp - 2 * m, fs, font, wt); c.fillText(wd, fx + m, ty); ty += fs * 1.1; }
    c.font = `${wp * 0.05}px ${FONTS[4]}`; c.fillText(b.author.toUpperCase(), fx + m, y + hp * 0.93);
  }
  c.restore();
  c.save(); c.fillStyle = fg; c.globalAlpha = 0.5;                                                   // back: blurb lines + barcode label
  for (let i = 0; i < 14; i++) c.fillRect(x + wp * 0.14, y + hp * (0.14 + i * 0.027), wp * (i % 5 === 4 ? r.range(0.25, 0.5) : r.range(0.66, 0.72)), Math.max(1.5, hp * 0.007));
  c.globalAlpha = 1; c.fillStyle = '#f4f1ea'; c.fillRect(x + wp * 0.14, y + hp * 0.82, wp * 0.3, hp * 0.09);
  c.fillStyle = '#26262a'; for (let i = 0; i < 17; i++) if (r.chance(0.62)) c.fillRect(x + wp * 0.158 + i * wp * 0.0155, y + hp * 0.832, wp * 0.008, hp * 0.064);
  c.restore();
}
/** Paint every book of `list` into one atlas (back | spine | front side by side per book). ppm = pixels per metre
 *  (2000 ≈ 0.5 mm/px, sharp at reading distance). Sets b.slot. Returns { tex, W, H, avg }. */
export function bookAtlas(list, { W = 2048, H = 1536, ppm = 2000, seed = 1 } = {}) {
  const r = new RNG(seed), cv = makeCanvas(W, H), c = cv.getContext('2d', { willReadFrequently: true }), pack = packer(W, 5);
  c.fillStyle = '#777'; c.fillRect(0, 0, W, H);
  for (const b of list) {
    const hp = Math.round(b.h * ppm), sp = Math.max(14, Math.round(b.t * ppm)), wp = b.full ? Math.round(b.w * ppm) : 10;
    const s = pack(wp * 2 + sp, hp);
    if (s.y + hp > H) throw new Error('bookAtlas: atlas too small, raise H or lower ppm');
    b.slot = { x: s.x, y: s.y, wp, sp, hp };
    drawBook(c, b, r);
  }
  paperGrain(c, W, H, r, 0.55);
  return { tex: canvasTex(cv, { srgb: true, wrap: false }), W, H, avg: avgColor(c.getImageData(0, 0, W, H).data), canvas: cv };
}
/** Page edges: single sheets, now and then a thicker one or the dark gap between two signatures. UVs in metres. */
export function pagesTexture(seed = 77123) {
  const cv = makeCanvas(16, 2048), c = cv.getContext('2d'), r = new RNG(seed); let y = 0;
  while (y < 2048) {   // one texel = 0.05 mm
    const t = r.chance(0.07) ? r.int(3, 5) : r.int(1, 3), gap = r.chance(0.035), v = gap ? 150 + r.int(-20, 20) : 226 + r.int(-22, 14);
    c.fillStyle = `rgb(${v + 9},${v + 5},${v - 8})`; c.fillRect(0, y, 16, t); y += t;
  }
  return canvasTex(cv, { srgb: true, repeat: [1, 10] });
}
/** Geometry of one book lying flat (spine along -X side at x = 0, cover in +X, thickness in +Y, height along Z),
 *  UVs into the atlas slot. Returns { covers, pages } BufferGeometries: covers -> atlas material, pages -> pagesTexture.
 *  Hardbacks get boards that overhang the block by 3 mm and a 1.5 mm hinge gap. */
export function bookGeometry(b, atlas) {
  const { w, h, t, hard } = b, ct = hard ? 0.0024 : 0.0007, ov = hard ? 0.003 : 0, { x, y, wp, sp, hp } = b.slot, AW = atlas.W, AH = atlas.H;
  const v0 = 1 - (y + hp) / AH, v1 = 1 - y / AH, bu0 = x / AW, bu1 = (x + wp) / AW, su1 = (x + wp + sp) / AW, fu1 = (x + 2 * wp + sp) / AW;
  const box = (x0, y0, z0, sx, sy, sz) => new THREE.BoxGeometry(sx, sy, sz).translate(x0 + sx / 2, y0 + sy / 2, z0 + sz / 2);
  const remap = (g, fn) => { const p = g.attributes.position, uv = g.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, fn(p.getX(i), p.getY(i)), lerp(v1, v0, clamp((p.getZ(i) + h / 2) / h, 0, 1))); return g; };
  const front = remap(box(0, t - ct, -h / 2, w, ct, h), (px) => lerp(su1, fu1, clamp(px / w, 0, 1)));
  const back = remap(box(0, 0, -h / 2, w, ct, h), (px) => lerp(bu1, bu0, clamp(px / w, 0, 1)));
  const spine = remap(box(0, ct, -h / 2, ct, t - 2 * ct, h), (px, py) => lerp(bu1, su1, clamp(py / t, 0, 1)));
  const gap = hard ? 0.0015 : 0;
  const pages = box(ct + gap, ct, -h / 2 + ov, w - ct - ov - gap, t - 2 * ct, h - 2 * ov);
  { const p = pages.attributes.position, uv = pages.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) + p.getZ(i), p.getY(i)); }   // metres: page lines run along the edges
  return { covers: [front, back, spine], pages };
}

// ================================================================== wall art
/** A sheet of an invented topographic survey: contour lines of a noise landscape (every 5th bold), hill tint, a
 *  title block. Returns { canvas, avg }; 400 x 560 px (A-series proportions). */
export function topoPoster({ seed = 41, title = 'Tarnholt', subtitle = 'the northern ridge and its two lakes', ink = [44, 66, 82], accent = '#c0613f' } = {}) {
  const W = 400, H = 560, cv = makeCanvas(W, H), c = cv.getContext('2d', { willReadFrequently: true });
  const img = c.createImageData(W, H), d = img.data, hg = new Float32Array(W * H);
  const mx0 = 34, mx1 = W - 34, my0 = 38, my1 = 410;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) hg[y * W + x] = (pfbm(x / 150 + 3.1, y / 150 + 1.7, 4, seed) + 0.36 * Math.exp(-(((x - 250) / 120) ** 2 + ((y - 190) / 130) ** 2))) * 15;
  const paper = [236, 230, 216], high = [203, 212, 196];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, j = i * 4, n = (hash2(x, y, 7) - 0.5) * 5; let k = 0, tint = 0;
    if (x > mx0 && x < mx1 && y > my0 && y < my1) {
      const h = hg[i], g = Math.max(1e-4, Math.hypot(hg[i + 1] - hg[i - 1], hg[i + W] - hg[i - W]) * 0.5);
      const f = h - Math.floor(h), dist = Math.min(f, 1 - f) / g, major = Math.round(h) % 5 === 0;     // distance to the nearest contour in px
      k = clamp((major ? 1.3 : 0.75) - dist) * (major ? 0.95 : 0.6); tint = smoothstep(6.5, 11.5, h) * 0.85;
    }
    for (let q = 0; q < 3; q++) d[j + q] = lerp(lerp(paper[q], high[q], tint), ink[q], k) + n;
    d[j + 3] = 255;
  }
  c.putImageData(img, 0, 0);
  const inkS = `rgb(${ink})`, SERIF = FONTS[0], SANS = FONTS[1];
  c.strokeStyle = inkS; c.lineWidth = 1.2; c.strokeRect(mx0 + 0.5, my0 + 0.5, mx1 - mx0 - 1, my1 - my0 - 1);
  c.fillStyle = accent; c.beginPath(); c.arc(250, 188, 5, 0, TAU); c.fill();
  c.fillStyle = inkS; c.textAlign = 'left';
  c.font = `600 36px ${SERIF}`; c.fillText(title, mx0, 466);
  c.font = `italic 15px ${SERIF}`; c.fillText(subtitle, mx0, 490);
  c.font = `10px ${SANS}`; c.fillText('SHEET 14   ·   1 : 25 000   ·   CONTOUR INTERVAL 20 M', mx0, 524);
  c.textAlign = 'right'; c.fillStyle = accent; c.font = `600 36px ${SERIF}`; c.fillText('14', mx1, 466);
  return { canvas: cv, avg: avgColor(c.getImageData(0, 0, W, H).data) };
}
/** n small photo prints with a white border, side by side (dusk sea, pine trunks, hazy ridges, bokeh, lone tree). */
export function photoPrints({ n = 5, seed = 8841 } = {}) {
  const CW = 96, CH = 118, cv = makeCanvas(CW * n, CH), c = cv.getContext('2d', { willReadFrequently: true }), r = new RNG(seed);
  for (let k = 0; k < n; k++) {
    const x0 = k * CW, ix = x0 + 7, iy = 7, iw = CW - 14, ih = CH - 30, kind = k % 5;
    c.fillStyle = '#efece4'; c.fillRect(x0, 0, CW, CH);
    c.save(); c.beginPath(); c.rect(ix, iy, iw, ih); c.clip();
    const grad = (a, b) => { const g = c.createLinearGradient(0, iy, 0, iy + ih); g.addColorStop(0, a); g.addColorStop(1, b); return g; };
    if (kind === 0) {
      c.fillStyle = grad('#66799b', '#e9b48c'); c.fillRect(ix, iy, iw, ih);
      c.fillStyle = '#f6dcb4'; c.beginPath(); c.arc(ix + iw * 0.62, iy + ih * 0.6, 7, 0, TAU); c.fill();
      c.fillStyle = '#465d73'; c.fillRect(ix, iy + ih * 0.62, iw, ih);
    } else if (kind === 1) {
      c.fillStyle = grad('#bcc8b2', '#6c8770'); c.fillRect(ix, iy, iw, ih);
      for (let q = 0; q < 8; q++) { c.fillStyle = q % 2 ? '#2d3a32' : '#42544a'; c.fillRect(ix + r.range(0, iw), iy, r.range(2, 7), ih); }
    } else if (kind === 2) {
      c.fillStyle = grad('#d3dde3', '#b9c8d2'); c.fillRect(ix, iy, iw, ih);
      ['#93a6b5', '#667c90', '#41556a'].forEach((col, q) => {
        c.fillStyle = col; c.beginPath(); c.moveTo(ix, iy + ih);
        for (let p = 0; p <= 8; p++) c.lineTo(ix + (iw * p) / 8, iy + ih * (0.38 + q * 0.17) + r.range(-9, 9));
        c.lineTo(ix + iw, iy + ih); c.fill();
      });
    } else if (kind === 3) {
      c.fillStyle = '#1c2130'; c.fillRect(ix, iy, iw, ih);
      for (let q = 0; q < 16; q++) { c.fillStyle = r.pick(['rgba(244,196,120,0.55)', 'rgba(232,120,90,0.5)', 'rgba(150,190,220,0.45)']); c.beginPath(); c.arc(ix + r.range(0, iw), iy + r.range(ih * 0.2, ih), r.range(3, 8), 0, TAU); c.fill(); }
    } else {
      c.fillStyle = grad('#dadfd2', '#c9d2c0'); c.fillRect(ix, iy, iw, ih);
      c.fillStyle = '#98a56c'; c.fillRect(ix, iy + ih * 0.66, iw, ih);
      c.fillStyle = '#4a5839'; c.fillRect(ix + iw * 0.44, iy + ih * 0.46, 3, ih * 0.22); c.beginPath(); c.arc(ix + iw * 0.46, iy + ih * 0.4, 13, 0, TAU); c.fill();
    }
    c.fillStyle = 'rgba(244,228,204,0.1)'; c.fillRect(ix, iy, iw, ih);                // prints are never quite black / white
    c.restore();
  }
  return { canvas: cv, n, cell: [CW, CH], avg: avgColor(c.getImageData(0, 0, CW * n, CH).data) };
}
