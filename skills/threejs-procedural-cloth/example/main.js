// Worked example: an unmade duvet on a bed, built stage by stage (?stage=1..5).
// Every number here is a design decision — change it, reload, look. See ../SKILL.md for the reasoning.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import {
  pn, bill, smoothstep, clamp, lerp, prof, softCap, Field, makeLobes, lobesAt, foldFamily, CreaseSet,
  quadEdge, boxSupport, curl, zonedAxis, gridGeo, relaxUV, uvStretch, wrinkleTexture, sprigPrintTexture, cottonMaterial, exportableMesh,
} from '../scripts/cloth.js';

const Q = new URLSearchParams(location.search);
const STAGE = +(Q.get('stage') || 5), RELAX = Q.get('relax') !== '0', TEX = Q.get('tex') || 'print';
const S = { folds: STAGE >= 2, erode: STAGE >= 3, creases: STAGE >= 4, curl: STAGE >= 5, lean: STAGE >= 5 };
const T0 = performance.now(), times = {};
const lap = (k, t) => { times[k] = Math.round(performance.now() - t); return performance.now(); };

// ---------------------------------------------------------------- the support: a mattress, cloth may hang over both long sides
const BED = { x0: 0, x1: 1.5, z0: 0, z1: 2.0, top: 0.5 };
const SUP = boxSupport({ ...BED, r: 0.07, sides: ['x-', 'x+'], sag: 0.007 });

// ---------------------------------------------------------------- the duvet in flat sheet coordinates
const DV_T = 0.05;                                       // filled thickness when lying flat
const DC = { c00: [-0.3, 0.04], c10: [1.84, 0.03], c01: [-0.28, 1.52], c11: [1.78, 1.55] };   // foot-left, foot-right, head-left, head-right
const edge = quadEdge(DC, 0.07);
const LOBE_SCALE = 0.42;                                 // 1 = piled into tall rolls, ~0.3 = an ordinary slept-in duvet
const LOBES = makeLobes([
  [0.7, 0.75, 0.38, 0.17, 12, 0.185],     // the big roll lying across the bed...
  [0.62, 1.08, 0.32, 0.13, 20, 0.14],     // ...a lower one pushed up against it (deep crease between them)
  [0.4, 0.62, 0.3, 0.16, -25, 0.12],      // ...and its shoulder
  [0.55, 0.3, 0.45, 0.22, 8, 0.07],       // foot
  [0.35, 1.32, 0.34, 0.2, -18, 0.08],     // head, left
  [0.95, 1.3, 0.33, 0.19, 24, 0.06],      // head, middle
  [1.15, 0.55, 0.3, 0.2, -30, 0.05],      // right side
], LOBE_SCALE);
// the turned-back corner: everything past this line is folded back over the duvet
const FL0 = [1.34, 1.29], FN = [0.6, 0.8], FT = [-0.8, 0.6];
// how deep the flap is (its farthest corner past the fold line): the calm zone under it must cover all of it
const QMAX = Math.max(...Object.values(DC).map(([x, z]) => (x - FL0[0]) * FN[0] + (z - FL0[1]) * FN[1]));
const foldQ = (x, z) => { if (!S.curl) return -1; const dx = x - FL0[0], dz = z - FL0[1], tau = dx * FT[0] + dz * FT[1]; return dx * FN[0] + dz * FN[1] + 0.02 * Math.sin(tau * 5.2 + 0.8) + 0.008 * Math.sin(tau * 13 + 2); };
/** Calm zones (cloth held flat): under the turned-back flap. Returns a multiplier for folds/creases. */
function calmAt(x, z) {
  if (!S.curl) return { calm: 1, fm: 0 };
  const q = foldQ(x, z), tau = (x - FL0[0]) * FT[0] + (z - FL0[1]) * FT[1];
  const fm = smoothstep(-QMAX - 0.04, -QMAX + 0.08, q) * (1 - smoothstep(0.0, 0.05, q)) * smoothstep(-0.6, -0.48, tau) * (1 - smoothstep(0.48, 0.58, tau));
  return { calm: 1 - 0.7 * fm, fm };
}
const famA = foldFamily({ angleDeg: -40, along: 0.6, across: 0.118, seed: 111 });   // runs with the big roll
const famB = foldFamily({ angleDeg: 90, along: 0.62, across: 0.125, seed: 113 });   // along the bed near its sides
const famC = foldFamily({ angleDeg: 0, along: 0.58, across: 0.12, seed: 115 });     // across the bed near the foot

/** Designed height above the support: lobes + long pillowy folds + flutes where it hangs. */
function dvBase(x, z) {
  const w1 = pn(x * 2.6 + 3.1, z * 2.6 + 1.7, 101) - 0.5, w2 = pn(x * 2.6 + 9.4, z * 2.6 + 5.2, 102) - 0.5;
  const wx = x + w1 * 0.1, wz = z + w2 * 0.1;                                     // domain warp: nothing ruler-straight
  const ov = SUP.overhang(x), hang = smoothstep(-0.05, 0.09, ov), { calm, fm } = calmAt(x, z);
  const M = lobesAt(LOBES, wx, wz);
  let folds = 0;
  if (S.folds) {
    const wB = Math.max(smoothstep(0.35, 0.1, x), smoothstep(1.15, 1.35, x)), wC = smoothstep(0.55, 0.25, z) * (1 - wB * 0.6), wA = clamp(1 - 0.75 * wB - 0.75 * wC);
    folds = wA * 0.042 * famA(wx, wz) + wB * 0.03 * famB(wx, wz) + wC * 0.032 * famC(wx, wz);
  }
  let fl = 0;                                                                    // hanging: broad vertical flutes opening towards the hem
  if (ov > 0 && S.folds) fl = 0.05 * smoothstep(0.04, 0.3, ov) * bill(pn(z / 0.2 + 0.35 * Math.sin(z * 9 + ov * 3), ov * 1.4 + 0.3, 121));
  const am = (0.6 + 0.75 * pn(x * 1.7 + 11.3, z * 1.7 + 0.9, 117)) * (1 + 1.3 * M);   // bunched-up cloth is also the most folded
  const H = DV_T * (0.92 + 0.3 * pn(x * 3.1 + 2.7, z * 3.1 + 8.1, 118) * (1 - fm)) + M * (1 - 0.9 * hang) * (1 - 0.8 * fm) + folds * am * (1 - hang) * calm + fl;
  return softCap(H, 0.23, 0.035);
}

// ---------------------------------------------------------------- height fields: coarse shape B (5 mm) + creases C (2.5 mm)
let t = performance.now();
const BX = [-0.35, 0.05, 1.9, 1.6];
const B = new Field(BX[0], BX[1], BX[2], BX[3], 0.005).fill(dvBase);
t = lap('shape', t);
if (S.erode) B.erodePeaks(5, 0.012);
t = lap('erode', t);
const C = new Field(BX[0], BX[1], BX[2], BX[3], 0.0025);
if (S.creases) {
  const cs = new CreaseSet(C, 5521);
  cs.fansFromLobes(LOBES, 0.025, 6);                                              // tension out of the ends of each roll
  cs.fan(1.36, 0.95, Math.PI, 0.7, 6, 0.1, 0.28); cs.fan(0.14, 0.7, 0, 0.7, 5, 0.1, 0.26);   // pulled over the edges
  cs.fan(0.0, 0.2, 0.9, 0.6, 5, 0.1, 0.26); cs.fan(1.45, 0.18, 2.2, 0.6, 4, 0.1, 0.24);     // foot corners
  if (S.curl) for (const s of [-0.3, 0, 0.3]) cs.fan(FL0[0] + FT[0] * s - FN[0] * 0.07, FL0[1] + FT[1] * s - FN[1] * 0.07, Math.atan2(-FN[1], -FN[0]), 0.6, 3, 0.08, 0.2);
  cs.scatter(200, [0.0, 1.5, 0.15, 1.5], (x, z) => 7.5 * pn(x * 1.3 + 5.3, z * 1.3 + 2.9, 171));
  // no creases where the cloth is held calm, hangs, or near the hem; vary their strength
  C.scale((x, z) => calmAt(x, z).calm * (1 - smoothstep(-0.05, 0.09, SUP.overhang(x))) * (0.35 + 0.65 * smoothstep(0.02, 0.09, edge(x, z))) * (0.7 + 0.6 * pn(x * 2.3 + 1.1, z * 2.3 + 7.7, 172)));
}
t = lap('creases', t);
const dvH = (x, z) => B.cubic(x, z) + C.bil(x, z);
// the hem: two layers sewn flat for BAND metres; only inside the stitching does the filling lift the cloth
const HEM = 0.0036, BAND = 0.016, hemProf = (ed) => Math.pow(prof(ed - BAND, 0.07), 1.25);
function hemElev(H, ed, x, z) {
  if (ed > BAND + 0.07) return H;
  const pr = hemProf(ed), u = (ed - BAND) / 0.0024;
  const lip = HEM + 0.0035 * pn(x * 31 + 2.2, z * 31 + 7.9, 157) * smoothstep(-0.002, 0.012, ed);
  const puck = 0.0022 * (pn(x * 55 + 1.3, z * 55 + 4.1, 158) - 0.5) * Math.exp(-Math.abs(ed - BAND) / 0.014) * smoothstep(0, BAND, ed);
  return Math.max(0.0024, H * pr + lip * (1 - pr) + puck - 0.0011 * Math.exp(-u * u));
}
const dvElev = (x, z) => hemElev(dvH(x, z), edge(x, z), x, z);
const flapT = (x, z) => 0.05 + 0.02 * bill(pn(x / 0.17 + 3.3, z / 0.17 + 9.1, 151)) + 0.009 * bill(pn(x / 0.07 + 1.3, z / 0.07 + 4.4, 152));

// ---------------------------------------------------------------- placement: warp in plan, tall folds lean, drape over the support
const WARP = 0.022, LEAN = 0.42;
const warpX = (x, z) => WARP * (pn(x * 1.9 + 0.3, z * 1.9 + 4.1, 131) * 2 - 1), warpZ = (x, z) => WARP * (pn(x * 1.9 + 6.7, z * 1.9 + 2.9, 132) * 2 - 1);
function place(mx, mz, e, eRef, o) {
  let X = mx + warpX(mx, mz), Z = mz + warpZ(mx, mz);
  if (S.lean) {
    const amt = LEAN * Math.max(0, eRef - 0.055) * (1 - smoothstep(-0.16, -0.03, SUP.overhang(X)));
    if (amt > 0) { const a = 3.7 + 2.6 * (pn(mx * 0.9 + 4.2, mz * 0.9 + 1.3, 133) - 0.5); X += Math.cos(a) * amt; Z += Math.sin(a) * amt; }
  }
  SUP.drape(X, Z, e, o);
}

// ---------------------------------------------------------------- the mesh
const NS = 288, NT = 192, W1 = NS + 1, N = W1 * (NT + 1);         // divisible by 8 (relaxUV)
const sA = zonedAxis(NS, 2.12, 0, 2.12, 0.007, 0.007), tA = zonedAxis(NT, 1.45, 0, 1.45, 0.0065, 0.0065);
const A = new Float32Array(N * 3), Bp = new Float32Array(N * 3), U = new Float32Array(N * 3), uv = new Float32Array(N * 2), Qf = new Float32Array(N), OV = new Float32Array(N);
const o = { x: 0, y: 0, z: 0 }, { c00, c10, c01, c11 } = DC;
const set = (arr, k) => { arr[k * 3] = o.x; arr[k * 3 + 1] = o.y; arr[k * 3 + 2] = o.z; };
let pen = 0, maxE = 0;
for (let j = 0; j <= NT; j++) for (let i = 0; i <= NS; i++) {
  const a = sA[i], b = tA[j], k = j * W1 + i;
  const mx = lerp(lerp(c00[0], c10[0], a), lerp(c01[0], c11[0], a), b), mz = lerp(lerp(c00[1], c10[1], a), lerp(c01[1], c11[1], a), b);
  const ed = edge(mx, mz), pr = hemProf(ed), E = hemElev(dvH(mx, mz), ed, mx, mz), q = foldQ(mx, mz);
  uv[k * 2] = mx; uv[k * 2 + 1] = mz; Qf[k] = q; OV[k] = SUP.overhang(mx + warpX(mx, mz)); maxE = Math.max(maxE, E);
  place(mx, mz, E, E, o); set(U, k);                       // unfolded shape: only used to measure the cloth for its UVs
  if (q <= 0) {
    set(A, k);
    if (OV[k] < -0.01 && o.y < BED.top - SUP.sagAt(o.x, o.z) - 0.0005) pen++;   // guard: cloth below the mattress top
    place(mx, mz, Math.max(0.0012, (E - DV_T * pr - HEM) * smoothstep(0, -0.05, q)), E, o); set(Bp, k);   // underside
  } else {
    // page curl: round a roll at the fold line, then lie back on top
    const lx = mx - FN[0] * q, lz = mz - FN[1] * q, eL = Math.max(0, dvElev(lx, lz)), tf = Math.max(0.004, flapT(mx, mz) * prof(ed, 0.03));
    const c = curl(q, eL, tf);
    let e = c.e, eRef = eL;
    if (e === null) { eRef = Math.max(0, dvElev(lx + FN[0] * c.w, lz + FN[1] * c.w)); e = eRef + tf; }
    place(lx + FN[0] * c.w, lz + FN[1] * c.w, e, eRef, o); set(Bp, k);
    const tq = Math.min(q, 0.03) * 0.6, ax = lx - FN[0] * tq, az = lz - FN[1] * tq, eA = Math.max(0, dvElev(ax, az));   // upper side tucks into the crease
    place(ax, az, eA - 0.001, eA, o); set(A, k);
  }
}
t = lap('mesh', t);
const stretchBefore = uvStretch(U, uv, NS, NT);
if (RELAX) relaxUV(U, NS, NT, uv, [220, 80, 40, 18]);
const stretch = uvStretch(U, uv, NS, NT);
t = lap('relaxUV', t);
const cq = (i, j, f) => f(Qf[j * W1 + i], Qf[j * W1 + i + 1], Qf[(j + 1) * W1 + i], Qf[(j + 1) * W1 + i + 1]);
const parts = [gridGeo(A, uv, NS, NT, { mask: (i, j) => cq(i, j, Math.min) < 0.012 })];
if (S.curl) parts.push(gridGeo(Bp, uv, NS, NT, { flip: true, mask: (i, j) => cq(i, j, Math.max) > -0.012 }));
parts.push(gridGeo(Bp, uv, NS, NT, { flip: true, stride: 2, mask: (i, j) => cq(i, j, Math.max) < -0.012 && Math.max(OV[j * W1 + i], OV[j * W1 + i + 2] ?? -1) > -0.02 }));   // hanging underside
// the turned seam round the hem (follows whichever side is showing)
const rim = [], pushRim = (k) => { const s = Qf[k] <= 0 ? A : Bp; rim.push(new THREE.Vector3(s[k * 3], s[k * 3 + 1], s[k * 3 + 2])); };
for (let i = 0; i < NS; i += 3) pushRim(i);
for (let j = 0; j < NT; j += 3) pushRim(j * W1 + NS);
for (let i = NS; i > 0; i -= 3) pushRim(NT * W1 + i);
for (let j = NT; j > 0; j -= 3) pushRim(j * W1);
const seamCurve = new THREE.CatmullRomCurve3(rim, true, 'centripetal'); seamCurve.arcLengthDivisions = 1400;
const seam = new THREE.TubeGeometry(seamCurve, 900, 0.0017, 5, true);
const geo = mergeGeometries([...parts, seam]);
t = lap('geometry', t);

// ---------------------------------------------------------------- materials
let map;
if (TEX === 'checker') {
  const cv = document.createElement('canvas'); cv.width = cv.height = 256; const c = cv.getContext('2d');
  for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) { c.fillStyle = (x + y) & 1 ? '#c8463c' : '#efe9dc'; c.fillRect(x * 128, y * 128, 128, 128); }
  map = new THREE.CanvasTexture(cv); map.wrapS = map.wrapT = THREE.RepeatWrapping; map.repeat.set(5, 5); map.colorSpace = THREE.SRGBColorSpace;   // 10 cm squares
} else map = sprigPrintTexture({ S: 1024, tileM: 0.74 });
const wr = wrinkleTexture({ N: 1024, tileM: 0.64 }); wr.rotation = 0.4;
const duvetMat = cottonMaterial({ map, normalMap: wr, normalScale: 1.1, cavity: 0.32, side: THREE.DoubleSide });
t = lap('textures', t);

// ---------------------------------------------------------------- scene
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.95;
renderer.shadowMap.enabled = true; 
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x2a2826);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.55;
const sun = new THREE.DirectionalLight(0xfff1dd, 2.4); sun.position.set(-2.2, 3.0, 1.6); sun.target.position.set(0.75, 0.5, 0.9);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.01;
Object.assign(sun.shadow.camera, { left: -1.5, right: 1.5, top: 1.5, bottom: -1.5, near: 0.5, far: 8 });
scene.add(sun, sun.target);
const duvet = new THREE.Mesh(geo, duvetMat); duvet.castShadow = duvet.receiveShadow = true; duvet.name = 'duvet'; scene.add(duvet);
const box = (w, h, d, x, y, z, color) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: 0.85 })); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; scene.add(m); return m; };
box(1.5, 0.2 - 0.01, 2.0, 0.75, 0.4 - 0.005, 1.0, 0xe9e7e2);   // mattress (a hair below the cloth's support)
box(1.36, 0.3, 2.06, 0.75, 0.15, 1.0, 0x7a5a3c);                // frame: narrower than the mattress so the cloth hangs free
const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshStandardMaterial({ color: 0x6b5a48, roughness: 0.9 })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
for (const x of [0.42, 1.08]) { const p = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 24), new THREE.MeshStandardMaterial({ color: 0xf1ede6, roughness: 0.95 })); p.scale.set(0.32, 0.08, 0.2); p.position.set(x, 0.56, 1.76); p.castShadow = p.receiveShadow = true; scene.add(p); }
const camera = new THREE.PerspectiveCamera(Q.get('cam') === 'close' ? 35 : 40, innerWidth / innerHeight, 0.02, 30);
const controls = new OrbitControls(camera, renderer.domElement);
const CAMS = {   // [position, target]
  wide: [[2.5, 1.75, -1.0], [0.72, 0.5, 0.85]],
  close: [[1.45, 0.95, 0.25], [0.85, 0.55, 0.9]],
  top: [[0.75, 3.4, 0.86], [0.75, 0.5, 0.85]],
  side: [[3.2, 0.75, 0.85], [0.75, 0.45, 0.85]],      // looking at the x+ side: the hanging part
  left: [[-1.7, 0.75, 0.85], [0.75, 0.45, 0.85]],
  foot: [[0.75, 1.1, -1.9], [0.75, 0.45, 0.8]],
};
const cam = CAMS[Q.get('cam')] || CAMS.wide;
camera.position.set(...cam[0]); controls.target.set(...cam[1]);
if (Q.get('cam') === 'top') camera.up.set(0, 0, 1);
controls.update();
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });

// ---------------------------------------------------------------- stats for verification + export
const stats = {
  stage: STAGE, ms: Math.round(performance.now() - T0), times, tris: geo.index.count / 3, verts: geo.attributes.position.count,
  maxElevation: +maxE.toFixed(3), penetrations: pen, uvStretchBefore: stretchBefore, uvStretch: stretch,
};
window.__cloth = stats;
if (Q.get('ui') === '0') document.getElementById('ui').style.display = 'none';
document.getElementById('stats').textContent = JSON.stringify(stats, null, 1);
console.log('[cloth]', JSON.stringify(stats));
document.getElementById('glb').onclick = () => new GLTFExporter().parse(exportableMesh(duvet), (bin) => {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bin], { type: 'model/gltf-binary' })); a.download = 'duvet.glb'; a.click();
}, (e) => console.error(e), { binary: true });
requestAnimationFrame(() => requestAnimationFrame(() => { document.body.dataset.ready = '1'; }));
