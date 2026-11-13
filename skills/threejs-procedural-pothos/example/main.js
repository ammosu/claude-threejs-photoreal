// Worked example: a room corner (back wall z = 0, left wall x = 0) with three golden pothos:
//   1. a big one on a high shelf on the left wall: vines hang off the shelf and arc out towards the light
//   2. a small bushy one on a table, spilling over the front edge
//   3. one on a wall shelf on the back wall
//   ?cam=room|shelf|table|wall   ?t=  freeze time   ?ui=0
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { U, Env, buildPothos, potMaterials, soilDisc, lathe } from '../scripts/pothos.js';
import { lerp } from '../scripts/util.js';

const Q = new URLSearchParams(location.search);
if (Q.get('ui') === '0') document.getElementById('ui').style.display = 'none';
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const scene = new THREE.Scene(), PM = potMaterials();
const add = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; scene.add(m); return m; };
const boxAt = (x0, y0, z0, x1, y1, z1, mat) => add(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
const LIGHT = V(1.6, 1.7, 2.5);          // where the light comes from (a window behind the camera): leaves and vine tips turn towards it

// ---------------------------------------------------------------- room
const wallM = new THREE.MeshStandardMaterial({ color: 0xe8e2d6, roughness: 0.9 }), woodM = new THREE.MeshStandardMaterial({ color: 0xb08a5e, roughness: 0.55 }), whiteM = new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.5 });
add(new THREE.PlaneGeometry(4, 2.6), wallM, 2, 1.3, 0);                                   // back wall
add(new THREE.PlaneGeometry(4, 2.6).rotateY(Math.PI / 2), wallM, 0, 1.3, 2);              // left wall
add(new THREE.PlaneGeometry(4, 4).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x7a5a3e, roughness: 0.7 }), 2, 0, 2);

const plants = [];
// ---- 1. high shelf on the left wall
{
  const sh = { x0: 0, x1: 0.25, y: 1.6, z0: 0.3, z1: 0.95 }, T = 0.02;
  boxAt(sh.x0, sh.y - T, sh.z0, sh.x1, sh.y, sh.z1, whiteM);
  const cx = 0.105, cz = 0.555, y0 = sh.y + 0.0004, H = 0.14, soil = 0.121;
  const prof = [[0, 0], [0.054, 0], [0.061, 0.0015], [0.0645, 0.006]];
  for (let k = 1; k <= 7; k++) { const y = 0.006 + (0.128 * k) / 7; prof.push([lerp(0.0645, 0.078, Math.pow((y - 0.006) / 0.128, 0.85)), y]); }
  prof.push([0.0786, 0.1365], [0.0782, 0.1392], [0.076, 0.1404], [0.0736, 0.1394], [0.0724, 0.136], [0.0716, 0.122], [0.0705, 0.105]);
  add(lathe(prof, 44), PM.stone, cx, y0, cz); add(soilDisc(0.0715, 3), PM.soil, cx, y0 + soil, cz);
  const env = new Env({ minX: 0, minZ: 0, maxY: 2.6 - 0.008, boxes: [{ b: [0, sh.y - T - 0.002, sh.z0 - 0.001, sh.x1 + 0.0015, sh.y, sh.z1 + 0.001] }],
    pots: [{ x: cx, z: cz, rOut: 0.079, rIn: 0.0715, y0, yRim: y0 + H, ySoil: y0 + soil }] });
  const hang = { b0: 0.22, b1: 0.1, ramp: 0.3, hook: 0.38 }, arch = { hook: 0.42, hookLen: 0.18 };
  plants.push({
    seed: 4041, cx, cz, rIn: 0.0715, rimY: y0 + H, soilY: y0 + soil, env, light: LIGHT, bias: V(0.6, 0, 0.8).normalize(),
    size: [0.078, 0.118], stemR: [0.0027, 0.0015], inter: [0.032, 0.054], bare: 0.07, seg: 0.014,
    vines: [   // th = heading (deg, 0 = +x out of the left wall, 90 = +z into the room), el = start elevation, len (m)
      { th: -90, el: 38, len: 1.2, ...hang }, { th: -60, el: 35, len: 0.82, ...hang }, { th: -24, el: 30, len: 0.9, ...hang },
      { th: -6, el: 42, len: 1.4, ...hang }, { th: 12, el: 33, len: 1.05, ...hang }, { th: 30, el: 36, len: 1.3, ...hang },
      { th: 64, el: 38, len: 1.1, ...hang }, { th: 92, el: 35, len: 1.3, ...hang }, { th: 86, el: 50, len: 0.9, ...hang },
      // reaching for the light: long arcs out into the room
      { th: 20, el: 34, len: 1.6, b0: 0.012, b1: 0.085, ramp: 0.7, ...arch }, { th: 40, el: 36, len: 1.8, b0: 0.011, b1: 0.08, ramp: 0.75, ...arch },
      { th: 55, el: 32, len: 1.4, b0: 0.014, b1: 0.085, ramp: 0.6, ...arch },
    ],
    shoots: { n: 22, th: [-105, 105], len: [0.06, 0.2] },
  });
}
// ---- 2. small bushy one on a table, spilling over the front edge (+z)
{
  const tb = [0.9, 0, 0.1, 1.9, 0.75, 0.75];
  boxAt(tb[0], tb[4] - 0.03, tb[2], tb[3], tb[4], tb[5], woodM);
  for (const [x, z] of [[0.93, 0.13], [1.87, 0.13], [0.93, 0.72], [1.87, 0.72]]) boxAt(x - 0.025, 0, z - 0.025, x + 0.025, tb[4] - 0.03, z + 0.025, woodM);
  const cx = 1.45, cz = 0.62, y0 = tb[4] + 0.0003, py = y0 + 0.0055, H = 0.1062, soil = 0.092;
  const sau = [[0, 0.004], [0.05, 0.004], [0.056, 0], [0.062, 0], [0.066, 0.004], [0.0685, 0.011], [0.0677, 0.0126], [0.0655, 0.0116], [0.063, 0.0062], [0.05, 0.0055], [0, 0.0055]];
  const prof = [[0, 0.003], [0.036, 0.003], [0.04, 0], [0.0445, 0], [0.048, 0.004], [0.0505, 0.012], [0.053, 0.03], [0.0555, 0.05], [0.0575, 0.07], [0.059, 0.088], [0.06, 0.098], [0.0612, 0.102], [0.0606, 0.1054], [0.058, 0.1062], [0.0556, 0.1046], [0.0548, 0.1], [0.054, 0.085], [0.0535, 0.07]];
  add(lathe(sau, 40), PM.sage, cx, y0, cz); add(lathe(prof, 40), PM.sage, cx, py, cz); add(soilDisc(0.0542, 11), PM.soil, cx, py + soil, cz);
  const env = new Env({ minZ: 0, maxY: 2.6, boxes: [{ b: [tb[0], -1, tb[2], tb[3], tb[4], tb[5]], faces: '-x+x+y+z' }],
    pots: [{ x: cx, z: cz, rOut: 0.0688, rIn: 0.054, y0, yRim: py + H, ySoil: py + soil }] });
  const sp = { b0: 0.15, b1: 0.1, ramp: 0.3, hook: 0.4, hookLen: 0.12 }, short = { b0: 0.05, b1: 0.15, ramp: 0.12, hook: 0.5, hookLen: 0.1 };
  plants.push({
    seed: 5077, cx, cz, rIn: 0.054, rimY: py + H, soilY: py + soil, env, light: LIGHT, bias: V(0, 0, 1),
    size: [0.056, 0.09], stemR: [0.0021, 0.0012], inter: [0.03, 0.05], bare: 0.04, seg: 0.01,
    vines: [{ th: 95, el: 40, len: 0.62, ...sp }, { th: 68, el: 35, len: 0.5, ...sp }, { th: 118, el: 45, len: 0.72, ...sp }, { th: 172, el: 35, len: 0.24, ...short }, { th: 12, el: 30, len: 0.2, ...short }, { th: 150, el: 50, len: 0.2, ...short }],
    shoots: { n: 21, th: [-30, 210], len: [0.05, 0.16] },
  });
}
// ---- 3. wall shelf on the back wall
{
  const sh = { x0: 2.3, x1: 3.2, y: 1.3, d: 0.22 };
  boxAt(sh.x0, sh.y - 0.02, 0, sh.x1, sh.y, sh.d, whiteM);
  const cx = 2.62, cz = 0.11, y0 = sh.y + 0.0004, py = y0 + 0.0055, H = 0.1105, soil = 0.094;
  const sau = [[0, 0.004], [0.05, 0.004], [0.056, 0], [0.061, 0], [0.065, 0.004], [0.0675, 0.012], [0.0665, 0.0135], [0.0643, 0.0125], [0.062, 0.0062], [0.05, 0.0055], [0, 0.0055]];
  const prof = [[0, 0], [0.04, 0], [0.043, 0.002], [0.0445, 0.008]];
  for (let k = 1; k <= 5; k++) prof.push([lerp(0.0445, 0.058, k / 5), lerp(0.008, 0.086, k / 5)]);
  prof.push([0.0588, 0.0878], [0.0626, 0.089], [0.0637, 0.092], [0.0646, 0.1075], [0.0636, 0.11], [0.06, 0.1105], [0.0576, 0.109], [0.057, 0.095], [0.056, 0.08]);
  add(lathe(sau, 40), PM.terra, cx, y0, cz); add(lathe(prof, 40), PM.terra, cx, py, cz); add(soilDisc(0.0572, 23), PM.soil, cx, py + soil, cz);
  const env = new Env({ minZ: 0, maxY: 2.6, boxes: [{ b: [sh.x0 - 0.01, sh.y - 0.06, 0, sh.x1 + 0.01, y0, sh.d + 0.004], faces: '-x+x+y+z' }],
    pots: [{ x: cx, z: cz, rOut: 0.0678, rIn: 0.057, y0, yRim: py + H, ySoil: py + soil }] });
  const sp = { b0: 0.22, b1: 0.1, ramp: 0.3, hook: 0.38, hookLen: 0.13 };
  plants.push({
    seed: 6113, cx, cz, rIn: 0.057, rimY: py + H, soilY: py + soil, env, light: LIGHT, bias: V(-0.2, 0, 0.98).normalize(),
    size: [0.062, 0.1], stemR: [0.0024, 0.0013], inter: [0.032, 0.054], bare: 0.05, seg: 0.012,
    vines: [{ th: 85, el: 38, len: 0.8, ...sp }, { th: 110, el: 42, len: 0.62, ...sp }, { th: 62, el: 35, len: 0.88, ...sp }, { th: 128, el: 40, len: 0.5, ...sp }, { th: 98, el: 50, len: 0.38, ...sp }, { th: 40, el: 46, len: 0.56, ...sp }, { th: 140, el: 44, len: 0.7, ...sp }],
    shoots: { n: 19, th: [5, 175], len: [0.05, 0.16] },
  });
}

// ---------------------------------------------------------------- grow
const res = buildPothos(plants); scene.add(res.group);
// collision audit: vine centre-line points inside a wall / box / solid pot wall (should be 0)
let inside = 0, total = 0;
for (const { pts } of res.paths) for (const p of pts) {
  total++;
  if (p.x < -1e-4 || p.z < -1e-4) { inside++; continue; }
  for (const c of plants) for (const bx of c.env.boxes) { const b = bx.b; if (p.x > b[0] + 1e-3 && p.x < b[3] - 1e-3 && p.y > b[1] + 1e-3 && p.y < b[4] - 1e-3 && p.z > b[2] + 1e-3 && p.z < b[5] - 1e-3) inside++; }
}

// ---------------------------------------------------------------- light + render
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
scene.background = new THREE.Color(0x2b2a28);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.45;
const sun = new THREE.DirectionalLight(0xfff2e0, 2.2); sun.position.copy(LIGHT).add(V(1.2, 1.2, 1.5)); sun.target.position.set(1.0, 1.0, 0.3);
sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096); sun.shadow.bias = -0.0002; sun.shadow.normalBias = 0.002;
Object.assign(sun.shadow.camera, { left: -2.2, right: 2.2, top: 2.2, bottom: -2.2, near: 0.5, far: 8 });
scene.add(sun, sun.target, new THREE.HemisphereLight(0xdfe8ff, 0x6b5a48, 0.6));

const CAMS = { room: [[2.4, 1.45, 3.1], [1.25, 1.05, 0.4]], shelf: [[0.95, 1.55, 1.45], [0.2, 1.35, 0.6]], table: [[1.75, 1.05, 1.45], [1.4, 0.68, 0.62]], wall: [[2.95, 1.35, 1.0], [2.6, 1.15, 0.12]] };
const cam = CAMS[Q.get('cam')] || CAMS.room;
const camera = new THREE.PerspectiveCamera(Q.get('cam') && Q.get('cam') !== 'room' ? 40 : 50, innerWidth / innerHeight, 0.01, 30);
const controls = new OrbitControls(camera, renderer.domElement); camera.position.set(...cam[0]); controls.target.set(...cam[1]); controls.update();
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
const FIX = Q.has('t') ? +Q.get('t') : null, T0 = performance.now();
renderer.setAnimationLoop(() => { U.uTime.value = FIX ?? (performance.now() - T0) / 1000; controls.update(); renderer.render(scene, camera); });

const stats = { ...res.stats, vinePoints: total, vinePointsInside: inside };
window.__pothos = stats; console.log('[pothos]', JSON.stringify(stats));
document.getElementById('stats').textContent = JSON.stringify(stats, null, 1);
requestAnimationFrame(() => requestAnimationFrame(() => { document.body.dataset.ready = '1'; }));
