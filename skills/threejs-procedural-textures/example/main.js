// Material board: a corner of a room where every surface is one of the library's textures.
// ?cam=room|desk|glint|fabric|floor|wall|books   ?flat=1 the same scene with plain colours (what the maps add)   ?ui=0
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RNG, rep, seamScore, texData, canvasTex } from '../scripts/tex.js';
import { wallNormal, wallPatch, lacquerNormal, smudgeRough, dustRough, floorMaps, woodMaps, oakVeneer } from '../scripts/surfaces.js';
import { weaveNormal, waffleNormal, terryNormal, ribNormal, knitNormal, feltNormal, ropeNormal, fabricMaterial } from '../scripts/textiles.js';
import { wornMaps, speckleTexture, scuffTexture } from '../scripts/wear.js';
import { makeBook, bookAtlas, bookGeometry, pagesTexture, topoPoster, photoPrints } from '../scripts/print.js';

const Q = new URLSearchParams(location.search), FLAT = Q.get('flat') === '1', CAM = Q.get('cam') || 'room';
const times = {}, seams = {};
const timed = (k, fn) => { const t = performance.now(); const v = fn(); times[k] = Math.round(performance.now() - t); return v; };
const seam = (k, t) => { const { data, w, h } = texData(t); seams[k] = seamScore(data, w, h); };

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio)); renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.72; renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x101114);
const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.45;
const sun = new THREE.DirectionalLight(0xfff0dc, 3.0); sun.position.set(2.2, 3.2, 2.6); sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 0.5, far: 12 }); sun.shadow.bias = -0.0002; sun.shadow.normalBias = 0.01;
scene.add(sun, new THREE.HemisphereLight(0xdfe6f0, 0x5a4a3a, 0.55));
// a window in the left wall: a big soft light whose reflection runs across the desk (wear shows up in highlights)
RectAreaLightUniformsLib.init();
const win = new THREE.RectAreaLight(0xf4f6ff, 7, 0.9, 1.1); win.position.set(-1.98, 1.45, -0.85); win.lookAt(0, 1.45, -0.85); scene.add(win);
{ const p = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.1).rotateY(Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.45, 2.6) })); p.position.set(-1.985, 1.45, -0.85); scene.add(p); }
const T0 = performance.now();
const flat = (m, color) => (FLAT ? new THREE.MeshStandardMaterial({ color: color ?? m.color, roughness: 0.6, side: m.side }) : m);
const add = (geo, mat, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; scene.add(o); return o; };
/** Plane / box UVs in metres: scale the 0..1 face UVs by the face size. */
const metres = (g, sx, sy) => { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * sx, uv.getY(i) * sy); return g; };

// ---------------------------------------------------------------- floor (oak planks), walls (woodchip + plaster drift)
const fl = timed('floorMaps', () => floorMaps()); seam('floor.map', fl.map);
add(metres(new THREE.PlaneGeometry(4, 3).rotateX(-Math.PI / 2), 4, 3), flat(new THREE.MeshStandardMaterial({ map: fl.map, normalMap: fl.normalMap, roughnessMap: fl.roughnessMap, roughness: 1 }), 0xb89a78), 0, 0, 0);
const wn = timed('wallNormal', () => wallNormal()); seam('wall.normal', wn);
const wallMat = flat(wallPatch(new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.925, 0.925, 0.915, THREE.SRGBColorSpace), roughness: 0.93, normalMap: wn })), 0xe8e6e0);
add(metres(new THREE.PlaneGeometry(4, 2.6), 4, 2.6), wallMat, 0, 1.3, -1.5);
add(metres(new THREE.PlaneGeometry(3, 2.6).rotateY(Math.PI / 2), 3, 2.6), wallMat, -2, 1.3, 0);
// skirting: lacquered (orange peel) with smudged roughness
const lac = timed('lacquerNormal', () => lacquerNormal()); const smu = timed('smudgeRough', () => smudgeRough(0.42, 0.12));
const skirt = flat(new THREE.MeshStandardMaterial({ color: 0xeeeee8, roughness: 1, roughnessMap: rep(smu, 1.3), normalMap: rep(lac, 14), normalScale: new THREE.Vector2(0.15, 0.15) }));
add(new THREE.BoxGeometry(4, 0.08, 0.015), skirt, 0, 0.04, -1.49);

// ---------------------------------------------------------------- desk: generic wood frame, worn white melamine top
const DESK = { x: -0.9, z: -1.15, w: 1.2, d: 0.6, top: 0.74 };
const wd = timed('woodMaps', () => woodMaps([0.62, 0.46, 0.32], { seed: 9 }));
const deskWood = flat(new THREE.MeshStandardMaterial({ map: wd.map, normalMap: wd.normalMap, roughnessMap: wd.roughnessMap, roughness: 1 }));
for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) add(metres(new THREE.BoxGeometry(0.04, DESK.top - 0.02, 0.04), 0.04, 0.7), deskWood, DESK.x + lx * (DESK.w / 2 - 0.04), (DESK.top - 0.02) / 2, DESK.z + lz * (DESK.d / 2 - 0.04));
const worn = timed('wornMaps(desk)', () => wornMaps({ sizeM: [DESK.w, DESK.d], ppm: 3400, seed: 12, base: '64,68,74', roughBase: 70, dustCol: '170,166,158', specks: 2500, hands: [[0.55, 0.52], [0.75, 0.53]], rings: [[0.92, 0.38, 0.0322, 0.6], [0.3, 0.2, 0.0322, 0.22]], prints: 6 }));
add(new RoundedBoxGeometry(DESK.w, 0.02, DESK.d, 2, 0.003), flat(new THREE.MeshStandardMaterial({ color: 0x40444a, roughness: 0.35 })), DESK.x, DESK.top - 0.01, DESK.z);
add(new THREE.PlaneGeometry(DESK.w - 0.006, DESK.d - 0.006).rotateX(-Math.PI / 2), flat(new THREE.MeshStandardMaterial({ map: worn.map, roughnessMap: worn.roughnessMap, roughness: 1 }), 0x40444a), DESK.x, DESK.top + 0.0002, DESK.z);
// mug with speckled glaze, powder-coated bottle
const spk = timed('speckle', () => speckleTexture());
const mugPts = [[0, 0.0012], [0.027, 0.0012], [0.0285, 0], [0.032, 0], [0.0365, 0.0026], [0.0396, 0.009], [0.0405, 0.02], [0.0405, 0.086], [0.0399, 0.0891], [0.0386, 0.09], [0.0373, 0.0891], [0.0367, 0.086], [0.0367, 0.013], [0.034, 0.0072], [0, 0.0066]].map(([x, y]) => new THREE.Vector2(x, y));
add(new THREE.LatheGeometry(mugPts, 64), flat(new THREE.MeshStandardMaterial({ map: spk, color: new THREE.Color().setRGB(0.86, 0.72, 0.66, THREE.SRGBColorSpace), roughness: 0.18 })), DESK.x + 0.32, DESK.top, DESK.z + 0.08);
const scuff = timed('scuff', () => scuffTexture());
add(new THREE.CylinderGeometry(0.036, 0.036, 0.24, 48), flat(new THREE.MeshStandardMaterial({ map: scuff.map, roughness: 0.55, metalness: 0.3 })), DESK.x + 0.46, DESK.top + 0.12, DESK.z - 0.12);

// ---------------------------------------------------------------- books: one atlas for all covers
const r = new RNG(5);
const stack = [makeBook(r, 0.165, 0.235, 0.032, 0, { hard: true, full: true, style: 1, cover: 0 }), makeBook(r, 0.152, 0.215, 0.022, 3, { full: true, style: 0, cover: 2 }), makeBook(r, 0.14, 0.208, 0.027, 8, { hard: true, full: true, style: 0, cover: 1 })];
const row = [5, 9, 6, 1, 4, 7, 10, 12, 11].map((p, i) => makeBook(r, r.range(0.12, 0.155), r.range(0.18, 0.236), r.range(0.016, 0.034), p, { hard: i % 3 === 1 }));
const atlas = timed('bookAtlas', () => bookAtlas([...stack, ...row], { seed: 3 }));
const coverMat = flat(new THREE.MeshStandardMaterial({ map: atlas.tex, roughness: 0.62 }), 0x8a6a50), pagesMat = flat(new THREE.MeshStandardMaterial({ map: pagesTexture(), roughness: 0.9 }), 0xe8e0d0);
const placeBook = (b, m4) => { const g = bookGeometry(b, atlas); add(mergeGeometries(g.covers).applyMatrix4(m4), coverMat); add(g.pages.applyMatrix4(m4), pagesMat); };
let sy = DESK.top;
stack.forEach((b, i) => { placeBook(b, new THREE.Matrix4().makeRotationY(Math.PI / 2 + (i - 1) * 0.06).setPosition(DESK.x - 0.36 + 0.0 * i, sy, DESK.z + 0.04)); sy += b.t; });
// wall shelf of oak veneer, books standing on it, spines out
const oak = timed('oakVeneer', () => oakVeneer());
const SH = { x: 0.75, y: 1.25, z: -1.36, w: 1.1, d: 0.26 };
add(metres(new THREE.BoxGeometry(SH.w, 0.022, SH.d), SH.w, SH.d), flat(new THREE.MeshStandardMaterial({ map: oak.map, normalMap: oak.normalMap, roughnessMap: oak.roughnessMap, roughness: 1 })), SH.x, SH.y - 0.011, SH.z);
let bx = SH.x - SH.w / 2 + 0.04;
for (const b of row) { const m4 = new THREE.Matrix4().makeRotationY(Math.PI / 2).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2)); m4.setPosition(bx + b.t, SH.y + b.h / 2, SH.z + SH.d / 2 - 0.015 + r.range(-0.008, 0.004)); placeBook(b, m4); bx += b.t + 0.002; }
// sill-like dusty roughness on the shelf's twin below
add(metres(new THREE.BoxGeometry(SH.w, 0.022, SH.d), SH.w, SH.d), flat(new THREE.MeshStandardMaterial({ color: 0xe6e6e2, roughness: 1, roughnessMap: timed('dustRough', () => dustRough({ lenM: 1, depthM: 0.26 })) })), SH.x, SH.y - 0.4, SH.z);

// ---------------------------------------------------------------- wall art
const poster = timed('topoPoster', () => topoPoster());
add(new THREE.PlaneGeometry(0.4, 0.56), flat(new THREE.MeshStandardMaterial({ map: canvasTex(poster.canvas, { srgb: true, wrap: false }), roughness: 0.8 }), 0xd8d0c0), -0.9, 1.55, -1.495);
const ph = photoPrints();
add(new THREE.PlaneGeometry(0.096 * 5 * 1.4, 0.118 * 1.4).rotateY(Math.PI / 2), flat(new THREE.MeshStandardMaterial({ map: canvasTex(ph.canvas, { srgb: true, wrap: false }), roughness: 0.5 }), 0xc0b8a8), -1.995, 1.45, 0.4);

// ---------------------------------------------------------------- fabric swatches: cushions / folded cloths on a low bench
const bench = add(metres(new THREE.BoxGeometry(1.5, 0.4, 0.42), 1.5, 0.42), flat(new THREE.MeshStandardMaterial({ map: oak.map, normalMap: oak.normalMap, roughnessMap: oak.roughnessMap, roughness: 1, color: 0xc8a888 })), 0.75, 0.2, -0.2);
const swatches = [
  ['plain weave', () => weaveNormal({ slub: 0.6, threads: 96 }), 0.06, 0x8c97a8], ['waffle', waffleNormal, 0.09, 0xd9d3c8], ['terry', terryNormal, 0.05, 0xb5806b],
  ['rib', ribNormal, 0.07, 0xbf8f3a], ['knit', knitNormal, 0.1, 0x6f7f6a], ['felt', feltNormal, 0.1, 0x5b4c5d], ['rope', ropeNormal, 0.014, 0xd4caa8],
];
swatches.forEach(([name, mk, tileM, col], i) => {
  const n = timed('fabric:' + name, mk), S = 0.17, m = flat(fabricMaterial(col, { normal: n, tileM: tileM / S, nscale: 1.0, sheen: 0.4 }));
  seam('fabric:' + name, n);
  add(new RoundedBoxGeometry(S, 0.05, S, 4, 0.02), m, 0.12 + i * 0.21, 0.425, -0.2 + (i % 2 ? 0.05 : -0.05)).rotation.y = (i - 3) * 0.08;
});
times.total = Math.round(performance.now() - T0);

// ---------------------------------------------------------------- cameras
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.01, 50);
const CAMS = {
  room: [[1.6, 1.5, 2.2], [-0.2, 0.8, -0.9]], desk: [[-0.75, 1.2, -0.62], [-0.85, 0.74, -1.18]], glint: [[0.05, 0.98, -1.05], [-1.3, 0.62, -1.0]],
  fabric: [[0.62, 0.72, 0.18], [0.62, 0.43, -0.2]], floor: [[0.4, 0.35, 1.3], [-0.6, 0.0, -0.6]], wall: [[-1.85, 1.3, 1.2], [-1.98, 1.3, -1.0]], books: [[0.75, 1.42, -0.55], [0.75, 1.32, -1.3]],
};
const [cp, ct] = CAMS[CAM] || CAMS.room; camera.position.set(...cp);
const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(...ct); controls.update();
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
const stats = { times, seams, bakeAlbedo: { floor: fl.avg.map((v) => +v.toFixed(3)), desk: worn.avg.map((v) => +v.toFixed(3)), books: atlas.avg.map((v) => +v.toFixed(3)) } };
document.getElementById('stats').textContent = JSON.stringify(stats, null, 1);
if (Q.get('ui') === '0') document.getElementById('ui').style.display = 'none';
window.__tex = stats; document.body.dataset.ready = '1';
