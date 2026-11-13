// What a window looks out on, built only where the room can see it: a visibility test from the room's eye
// positions through the window, aerial perspective (haze) for any material, a lawn grid that coarsens with distance,
// a winding gravel path, a clipped hedge, neighbour houses (walls, clay pantile roofs, windows with net curtains,
// chimneys, roof lights), and a far wall of crowns closing the horizon. Trees in between: threejs-procedural-vegetation
// (pass windowLod() as its lodAt / keep). Units: metres; the window is in the plane z = 0, outside is z < 0.
// Adapted from room-at-dawn (MIT, github.com/Leonxlnx/room-at-dawn) src/scene/parts/exterior.js.
import * as THREE from 'three';

const TAU = Math.PI * 2;
export class RNG {
  constructor(seed = 1) { let a = seed | 0; this.f = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  next() { return this.f(); } range(a, b) { return a + (b - a) * this.f(); } int(a, b) { return Math.floor(this.range(a, b + 1)); } chance(p) { return this.f() < p; }
}
const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x), lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
function h2(ix, iy, s) { let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(s, 1442695041)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vn(x, y, s) { const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy); return lerp(lerp(h2(ix, iy, s), h2(ix + 1, iy, s), u), lerp(h2(ix, iy + 1, s), h2(ix + 1, iy + 1, s), u), v); }
export const fbm2 = (x, y, oct = 3, seed = 0) => { let a = 0.5, s = 0, n = 0, f = 1; for (let i = 0; i < oct; i++) { s += a * vn(x * f, y * f, seed + i * 17); n += a; a *= 0.5; f *= 2; } return s / n; };
function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function canvasTex(c, { srgb = true, wrap = true } = {}) { const t = new THREE.CanvasTexture(c); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.wrapS = t.wrapT = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping; t.anisotropy = 8; return t; }

// ------------------------------------------------------------------ what can the room see?
/**
 * win = { x0, x1, y0, y1 } window opening in the plane z = 0, wallT = wall thickness (the opening is a TUNNEL: a point
 * must be visible through both its faces), eyes = where people stand: x range, y range (eye heights) and z values
 * inside the room. Returns { seen(x, y, z), lod(x, y, z) -> 0 never / 1 only at steep angles (thin out) / 2 normal }.
 * In room-at-dawn this decides which leaves, hedge clumps and shrubs exist at all.
 */
export function windowVisibility({ win, wallT = 0.3, eyeX = [0.2, 4.6], eyeY = [0.45, 1.9], eyeZ = [0.25, 3.95], nz = 16, margin = 0.1 }) {
  const EZ = Array.from({ length: nz }, (_, i) => eyeZ[0] + ((eyeZ[1] - eyeZ[0]) * i) / (nz - 1)), m = margin;
  const seen = (px, py, pz) => {
    if (pz > -wallT - 0.05) return false;
    for (const ez of EZ) {
      const k0 = (ez - pz) / -pz, k1 = (ez - pz) / (-wallT - pz);   // project the opening's inner and outer face onto the eye plane
      const xa = Math.max(px + (win.x0 - m - px) * k0, px + (win.x0 - m - px) * k1, eyeX[0]), xb = Math.min(px + (win.x1 + m - px) * k0, px + (win.x1 + m - px) * k1, eyeX[1]);
      if (xa > xb) continue;
      const ya = Math.max(py + (win.y0 - m - py) * k0, py + (win.y0 - m - py) * k1, eyeY[0]), yb = Math.min(py + (win.y1 + m - py) * k0, py + (win.y1 + m - py) * k1, eyeY[1]);
      if (ya <= yb) return true;
    }
    return false;
  };
  const lod = (x, y, z) => { if (!seen(x, y, z)) return 0; const d = -z, lat = Math.max(win.x0 - x, x - win.x1, 0) / d, el = (y - win.y1) / d; return lat > 1.35 || el > 1.2 ? 1 : 2; };
  return { seen, lod };
}

// ------------------------------------------------------------------ aerial perspective
/** Fade a material towards the haze colour with distance (beyond `start` metres): far things go pale and blue like
 *  in a photograph. Chains any earlier onBeforeCompile. color = linear RGB (use the sky's horizon × ~0.8 × display). */
export function hazePatch(m, { color = [0.62, 0.74, 0.95], start = 10, density = 0.006 } = {}) {
  const prev = Object.prototype.hasOwnProperty.call(m, 'onBeforeCompile') ? m.onBeforeCompile : null;
  const f = (x) => x.toFixed(4);
  m.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `{
      float hz = 1.0 - exp( -max( length( vViewPosition ) - ${f(start)}, 0.0 ) * ${f(density)} );
      outgoingLight = mix( outgoingLight, vec3( ${f(color[0])}, ${f(color[1])}, ${f(color[2])} ), hz );
    }
    #include <opaque_fragment>`);
  };
  const pk = Object.prototype.hasOwnProperty.call(m, 'customProgramCacheKey') ? m.customProgramCacheKey() : '';
  m.customProgramCacheKey = () => `haze|${color}|${start}|${density}|${pk}`;
  return m;
}

// ------------------------------------------------------------------ textures (Canvas2D, all tile)
/** Lawn: 9000 grass strokes, tiles; repeat ~1 per 2.5 m. */
export function grassTexture(seed = 551) {
  const N = 512, c = makeCanvas(N, N), g = c.getContext('2d'), r = new RNG(seed);
  g.fillStyle = 'hsl(84,40%,29%)'; g.fillRect(0, 0, N, N); g.lineCap = 'round';
  for (let i = 0; i < 9000; i++) {
    const x = r.range(0, N), y = r.range(0, N), a = r.range(-0.6, 0.6) - Math.PI / 2, l = r.range(5, 14), dx = Math.cos(a) * l, dy = Math.sin(a) * l;
    g.strokeStyle = `hsl(${r.range(64, 104).toFixed(0)},${r.range(30, 52).toFixed(0)}%,${r.range(20, 42).toFixed(0)}%)`; g.lineWidth = r.range(1, 2.3);
    for (const ox of [0, N, -N]) for (const oy of [0, N, -N]) { if (x + ox < -16 || x + ox > N + 16 || y + oy < -16 || y + oy > N + 16) continue; g.beginPath(); g.moveTo(x + ox, y + oy); g.lineTo(x + ox + dx, y + oy + dy); g.stroke(); }
  }
  return canvasTex(c);
}
/** Clay pantiles: 8 x 8 tiles per repeat = 2.4 m across x 2.72 m up the slope. Barrel shading, course shadows, lichen. */
export function roofTexture(seed = 733) {
  const N = 512, S = 64, c = makeCanvas(N, N), g = c.getContext('2d'), r = new RNG(seed);
  g.fillStyle = '#3a1c14'; g.fillRect(0, 0, N, N);
  for (let row = -1; row < 9; row++) for (let q = -1; q < 9; q++) {
    const x = q * S + (row & 1) * S * 0.5, y = row * S, k = r.next(), h = r.range(9, 21), s = k < 0.15 ? r.range(26, 38) : r.range(46, 62), l = k < 0.15 ? r.range(24, 31) : r.range(33, 45);
    for (const ox of [0, N, -N]) for (const oy of [0, N]) {
      const X = x + ox, Y = y + oy; if (X > N || X + S < 0 || Y > N || Y + S < 0) continue;
      g.fillStyle = `hsl(${h.toFixed(0)},${s.toFixed(0)}%,${l.toFixed(0)}%)`; g.fillRect(X + 1, Y, S - 2, S);
      let gr = g.createLinearGradient(X, 0, X + S, 0); gr.addColorStop(0, 'rgba(0,0,0,0.3)'); gr.addColorStop(0.42, 'rgba(255,235,215,0.1)'); gr.addColorStop(0.8, 'rgba(0,0,0,0.08)'); gr.addColorStop(1, 'rgba(0,0,0,0.36)');
      g.fillStyle = gr; g.fillRect(X + 1, Y, S - 2, S);
      gr = g.createLinearGradient(0, Y, 0, Y + S); gr.addColorStop(0, 'rgba(0,0,0,0.6)'); gr.addColorStop(0.2, 'rgba(0,0,0,0.12)'); gr.addColorStop(0.85, 'rgba(0,0,0,0)'); gr.addColorStop(0.95, 'rgba(255,225,200,0.16)'); gr.addColorStop(1, 'rgba(0,0,0,0.25)');
      g.fillStyle = gr; g.fillRect(X + 1, Y, S - 2, S);
    }
  }
  for (let i = 0; i < 2600; i++) { const x = r.range(0, N), y = r.range(0, N), rr = r.range(1, 4), dark = r.chance(0.65); g.fillStyle = dark ? `rgba(30,22,16,${r.range(0.1, 0.3).toFixed(2)})` : `rgba(170,160,120,${r.range(0.06, 0.2).toFixed(2)})`; g.beginPath(); g.ellipse(x, y, rr, rr * r.range(1, 3), 0, 0, TAU); g.fill(); }
  return canvasTex(c);
}
/** One house window: two panes with a sky gradient, reveal shadow, a net curtain. Maps 0..1 onto a 1.16 x 1.5 m quad. */
export function windowTexture() {
  const W = 192, Hh = 256, c = makeCanvas(W, Hh), g = c.getContext('2d');
  g.fillStyle = '#e6e5e0'; g.fillRect(0, 0, W, Hh);
  const pane = (x, y, w, h) => {
    const gr = g.createLinearGradient(x, y, x + w * 0.4, y + h); gr.addColorStop(0, '#7f93a6'); gr.addColorStop(0.5, '#4a5866'); gr.addColorStop(1, '#2b333c'); g.fillStyle = gr; g.fillRect(x, y, w, h);
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x, y, w, 7); g.fillRect(x, y, 5, h); g.fillStyle = 'rgba(235,232,222,0.5)'; g.fillRect(x + w * 0.62, y + 7, w * 0.38, h * 0.82);
  };
  pane(16, 16, 72, 224); pane(104, 16, 72, 224); g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, Hh - 8, W, 8);
  return canvasTex(c, { wrap: false });
}
/** Distant wall of crowns: three layers of tree silhouettes, each a dark mass plus 330 leafy daubs lighter on top;
 *  alpha cut-out above the crowns. Tiles sideways: one repeat = 64 m wide, 20 m tall. */
export function crownTexture(seed = 1207, { hue = [92, 122] } = {}) {
  const W = 2048, Hh = 512, c = makeCanvas(W, Hh), g = c.getContext('2d'), r = new RNG(seed);
  g.fillStyle = 'hsl(112,30%,13%)'; g.fillRect(0, Hh * 0.52, W, Hh * 0.48);
  for (let layer = 0; layer < 3; layer++) for (let i = 0; i < 13; i++) {
    const cx = ((i + r.range(0.1, 0.9)) / 13) * W, rx = r.range(105, 175), ry = rx * r.range(0.85, 1.25), cy = Hh * (0.62 - 0.05 * layer) - ry * r.range(0.35, 0.95) + 60 * layer;
    const hu = r.range(hue[0], hue[1]), lb = 13 + layer * 3.5;
    for (const ox of [0, W, -W]) { if (cx + ox + rx < -20 || cx + ox - rx > W + 20) continue; g.fillStyle = `hsl(${hu.toFixed(0)},30%,${(lb - 1).toFixed(0)}%)`; g.beginPath(); g.ellipse(cx + ox, cy, rx * 0.86, ry * 0.86, 0, 0, TAU); g.fill(); }
    for (let k = 0; k < 330; k++) {
      const a = r.range(0, TAU), rr = Math.sqrt(r.next()), dx = Math.cos(a) * rr * rx, dy = Math.sin(a) * rr * ry, up = 0.5 - dy / (2 * ry);
      const col = `hsl(${(hu + r.range(-10, 10)).toFixed(0)},${r.range(24, 40).toFixed(0)}%,${(lb + up * 13 + r.range(-3, 4)).toFixed(0)}%)`, sz = r.range(4, 9), ra = r.range(0, 3.1);
      for (const ox of [0, W, -W]) { const X = cx + dx + ox; if (X < -12 || X > W + 12) continue; g.fillStyle = col; g.beginPath(); g.ellipse(X, cy + dy, sz, sz * 0.55, ra, 0, TAU); g.fill(); }
    }
  }
  return canvasTex(c);
}

// ------------------------------------------------------------------ geometry
/** Accumulates tessellated quads / triangles (light baked per vertex needs vertices on big faces). */
export class Soup {
  constructor() { this.p = []; this.n = []; this.uv = []; this.ix = []; }
  /** parallelogram p0 + eu*a + ev*b facing eu x ev; uvs = [u per metre, v per metre] or null for 0..1 */
  quad(p0, eu, ev, maxEdge = 1, uvs = null) {
    const lu = Math.hypot(...eu), lv = Math.hypot(...ev), nu = Math.max(1, Math.ceil(lu / maxEdge)), nv = Math.max(1, Math.ceil(lv / maxEdge));
    const nn = new THREE.Vector3().crossVectors(new THREE.Vector3(...eu), new THREE.Vector3(...ev)).normalize(), base = this.p.length / 3;
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const a = i / nu, b = j / nv; this.p.push(p0[0] + eu[0] * a + ev[0] * b, p0[1] + eu[1] * a + ev[1] * b, p0[2] + eu[2] * a + ev[2] * b); this.n.push(nn.x, nn.y, nn.z);
      if (uvs) this.uv.push(a * lu * uvs[0], b * lv * uvs[1]); else this.uv.push(a, b);
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const q = base + j * (nu + 1) + i; this.ix.push(q, q + 1, q + nu + 2, q, q + nu + 2, q + nu + 1); }
  }
  tri(a, b, c) {
    const nn = new THREE.Vector3().crossVectors(new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2])).normalize(), base = this.p.length / 3;
    for (const q of [a, b, c]) { this.p.push(...q); this.n.push(nn.x, nn.y, nn.z); this.uv.push(0, 0); }
    this.ix.push(base, base + 1, base + 2);
  }
  box(x, y, z, w, h, d) {          // axis-aligned box from its min corner (5 faces, no bottom)
    this.quad([x, y, z + d], [w, 0, 0], [0, h, 0], 1); this.quad([x + w, y, z], [-w, 0, 0], [0, h, 0], 1);
    this.quad([x, y, z], [0, 0, d], [0, h, 0], 1); this.quad([x + w, y, z + d], [0, 0, -d], [0, h, 0], 1); this.quad([x, y + h, z + d], [w, 0, 0], [0, 0, -d], 1);
  }
  geo() { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2)); g.setIndex(this.ix); return g; }
}

/**
 * Gabled houses facing the window (+z). list: [{ x, z (front face), w, d, eave, ridge }] with heights above `ground`.
 * Each gets walls, a pantile roof with a 45 cm overhang, white verge boards and fascia, gutter, ridge tiles, a brick
 * chimney with a cap, rows of windows on the front and one in the gable, two roof lights.
 * Returns { wall, roof, trim, win, glass, dark, brick } geometries (one material each).
 */
export function houses(list, { ground = 0, seed = 31 } = {}) {
  const P = { wall: new Soup(), roof: new Soup(), trim: new Soup(), win: new Soup(), glass: new Soup(), dark: new Soup(), brick: new Soup() }, r = new RNG(seed);
  for (const H of list) {
    const { x: x0, z: zf, w, d } = H, eave = ground + H.eave, ridge = ground + H.ridge, ov = 0.45, zr = zf - d / 2, rise = ridge - eave, run = d / 2, ye = eave - (ov * rise) / run, wh = eave - ground;
    P.wall.quad([x0, ground, zf], [w, 0, 0], [0, wh, 0], 0.9); P.wall.quad([x0, ground, zf - d], [0, 0, d], [0, wh, 0], 1.2); P.wall.tri([x0, eave, zf - d], [x0, eave, zf], [x0, ridge, zr]);
    P.wall.quad([x0 + w, ground, zf], [0, 0, -d], [0, wh, 0], 2.5); P.wall.tri([x0 + w, eave, zf], [x0 + w, eave, zf - d], [x0 + w, ridge, zr]);
    P.roof.quad([x0 - ov, ye, zf + ov], [w + 2 * ov, 0, 0], [0, ridge - ye, zr - zf - ov], 1.0, [1 / 2.4, 1 / 2.72]);
    P.roof.quad([x0 + w + ov, ye, zf - d - ov], [-(w + 2 * ov), 0, 0], [0, ridge - ye, zr - (zf - d - ov)], 2.5, [1 / 2.4, 1 / 2.72]);
    P.trim.quad([x0 - ov, ye - 0.02, zf + ov], [0, ridge - ye, zr - zf - ov], [0, -0.17, 0], 1.5); P.trim.quad([x0 - ov, ridge - 0.02, zr], [0, ye - ridge, zf - d - ov - zr], [0, -0.17, 0], 1.5);
    P.trim.quad([x0 - ov, ye - 0.2, zf + ov], [w + 2 * ov, 0, 0], [0, 0.18, 0], 2);
    P.dark.box(x0 - ov, ye - 0.1, zf + ov, w + 2 * ov, 0.1, 0.12); P.dark.box(x0 - ov, ridge - 0.06, zr - 0.12, w + 2 * ov, 0.16, 0.24);
    const cx = x0 + w * r.range(0.62, 0.8); P.brick.box(cx, ridge - 0.9, zr - 0.2, 0.62, 1.75, 0.5); P.dark.box(cx - 0.05, ridge + 0.85, zr - 0.25, 0.72, 0.09, 0.6);
    const cols = Math.max(2, Math.round(w / 2.8));
    for (let row = 0; row < 3; row++) for (let c = 0; c < cols; c++) { const wx = x0 + (w * (c + 0.5)) / cols - 0.58, wy = eave - 2.25 - row * 2.85; if (wy < ground + 0.6) continue; P.win.quad([wx, wy, zf + 0.03], [1.16, 0, 0], [0, 1.5, 0], 2); }
    P.win.quad([x0 - 0.03, eave - 2.25, zr - 0.5], [0, 0, 1.0], [0, 1.35, 0], 2);
    const sl = Math.hypot(ridge - ye, zr - zf - ov), su = [0, (ridge - ye) / sl, (zr - zf - ov) / sl], sn = [0, su[2], -su[1]].map((v) => -v);
    for (const fx of [0.22, 0.5]) { const o = [x0 + w * fx, ye + su[1] * sl * 0.42 + sn[1] * 0.05, zf + ov + su[2] * sl * 0.42 + sn[2] * 0.05]; P.glass.quad(o, [0.8, 0, 0], [0, su[1] * 1.2, su[2] * 1.2], 2); }
  }
  return Object.fromEntries(Object.entries(P).map(([k, s]) => [k, s.geo()]));
}

/** Lawn on a grid that is 1.6 m fine inside [x0,x1] x [z0,z1] and grows 1.6x per line beyond (out to `extent`), with
 *  mottled vertex colour (darker / yellower patches). Big near-flat ground, few vertices, still enough for baked light. */
export function lawn({ x0 = -36, x1 = 44, z0 = -62, z1 = 1.2, step = 1.6, extent = 260, ground = 0, seed = 3 } = {}) {
  const lines = (a, b, lim) => { const o = []; for (let v = a; v <= b + 1e-6; v += step) o.push(v); let st = step; while (o[o.length - 1] < lim) { st *= 1.6; o.push(o[o.length - 1] + st); } st = step; while (o[0] > -lim) { st *= 1.6; o.unshift(o[0] - st); } return o; };
  const xs = lines(x0, x1, extent), zs = lines(z0, z1, 0).filter((z) => z <= z1 + 0.1); while (zs[0] > -extent) zs.unshift(zs[0] - (zs[1] - zs[0]) * 1.6);
  const p = [], nn = [], uv = [], col = [], ix = [], W = xs.length;
  for (const z of zs) for (const x of xs) {
    const a = fbm2(x * 0.11 + 40, z * 0.11 + 40, 3, seed), b = fbm2(x * 0.035 + 9, z * 0.035 + 9, 2, seed + 1);
    p.push(x, ground, z); nn.push(0, 1, 0); uv.push(x / 2.5, z / 2.5); col.push(0.6 + 0.56 * a + 0.4 * (b - 0.5), 0.62 + 0.38 * a + 0.1 * (b - 0.5), 0.5 + 0.26 * a - 0.3 * (b - 0.5));
  }
  for (let j = 0; j < zs.length - 1; j++) for (let i = 0; i < W - 1; i++) { const q = j * W + i; ix.push(q, q + W, q + 1, q + 1, q + W, q + W + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nn, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(ix); return g;
}
/** Gravel path along z = pathZ(x), 1.7 m wide, lighter in the middle (worn), mottled. */
export function gravelPath(pathZ, { x0 = -75, x1 = 90, ground = 0, seed = 6 } = {}) {
  const p = [], nn = [], uv = [], col = [], ix = [], n = Math.ceil((x1 - x0) / 1.5);
  for (let i = 0; i <= n; i++) {
    const x = x0 + i * 1.5, zc = pathZ(x);
    for (let k = 0; k < 3; k++) { const z = zc + (k - 1) * 0.85; p.push(x, ground + 0.02, z); nn.push(0, 1, 0); uv.push(x, z); const c = 0.85 + 0.3 * fbm2(x * 0.5, z * 0.5, 2, seed) - (k === 1 ? 0 : 0.12); col.push(c, c, c); }
    if (i < n) { const q = i * 3; ix.push(q, q + 1, q + 3, q + 1, q + 4, q + 3, q + 1, q + 2, q + 4, q + 2, q + 5, q + 4); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nn, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(ix); return g;
}
/** Clipped hedge: a rounded section swept along z = hz(x), height wobbling 0.9–1.1 m. (room-at-dawn covers it with
 *  leaf clumps where windowVisibility says it can be seen: threejs-procedural-vegetation Leaves.blob.) */
export function hedge(hz, { x0 = -62, x1 = 72, ground = 0, seed = 12 } = {}) {
  const sec = [[-0.5, 0], [-0.56, 0.85], [-0.42, 1.42], [0, 1.6], [0.42, 1.42], [0.56, 0.85], [0.5, 0]], p = [], ix = [], n = Math.ceil(x1 - x0);
  for (let i = 0; i <= n; i++) { const x = x0 + i, z = hz(x), k = 0.9 + 0.2 * fbm2(x * 0.3, 2, 2, seed); for (const s of sec) p.push(x, ground + s[1] * k, z + s[0]); }
  for (let i = 0; i < n; i++) for (let k = 0; k < 6; k++) { const q = i * 7 + k; ix.push(q, q + 1, q + 7, q + 1, q + 8, q + 7); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setIndex(ix); g.computeVertexNormals();
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((p.length / 3) * 2), 2)); return g;
}
/** Far wall of crowns: a cylindrical band (radius R round `center`, from ground up `height`) facing inwards, uv in
 *  metres / 64 so crownTexture tiles every 64 m. Use alphaTest 0.5 and haze. Closes the horizon behind the real trees. */
export function crownWall({ R = 100, center = [1.5, 0], ground = 0, height = 20, arc = 1.52, segs = 56 } = {}) {
  const nv = 4, p = [], nn = [], uv = [], ix = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= segs; i++) { const th = lerp(-arc, arc, i / segs); p.push(center[0] + R * Math.sin(th), ground + (height * j) / nv, center[1] - R * Math.cos(th)); nn.push(-Math.sin(th), 0, Math.cos(th)); uv.push((th * R) / 64, j / nv); }
  for (let j = 0; j < nv; j++) for (let i = 0; i < segs; i++) { const q = j * (segs + 1) + i; ix.push(q, q + 1, q + segs + 2, q, q + segs + 2, q + segs + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nn, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(ix); return g;
}
export { smoothstep };
