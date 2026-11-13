// A corner after a day of living in it: a towel thrown over a chair back and another over a basket rim (both draped
// by drapeCloth against the real meshes), socks on the floor, a charger cable from the wall socket, a mug with tea
// marks and a steel bottle on a side table, crumpled paper, a pile of magazines.
// Uses the sibling skill threejs-procedural-textures for normal maps and covers (../../threejs-procedural-textures).
// ?cam=room|chair|basket|floor|table   ?collider=1 show collider points   ?steps=0 starting pose only   ?ui=0
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RNG, TAU, lerp, smoothstep, fbm2, merge, refine, thickCloth, surfacePoints, drapeCloth, overBar, overRim, sock, cable, mug, bottle, paperBall, ropeBasket, sampleGrid, skin } from '../scripts/props.js';
import { terryNormal, knitNormal, ribNormal, weaveNormal, ropeNormal, fabricMaterial } from '../../threejs-procedural-textures/scripts/textiles.js';
import { makeBook, bookAtlas, bookGeometry, pagesTexture } from '../../threejs-procedural-textures/scripts/print.js';
import { lacquerNormal, floorMaps, wallNormal, wallPatch } from '../../threejs-procedural-textures/scripts/surfaces.js';

const Q = new URLSearchParams(location.search), CAM = Q.get('cam') || 'room', STEPS = Q.has('steps') ? +Q.get('steps') : 220;
const T0 = performance.now(), stats = { drape: {}, ms: {} };
const lap = (k, t) => { stats.ms[k] = Math.round(performance.now() - t); return performance.now(); };

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio)); renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.8; renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x15161a);
const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.5;
const sun = new THREE.DirectionalLight(0xfff0dc, 2.6); sun.position.set(2.5, 3.5, 2.2); sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -2.5, right: 2.5, top: 2.5, bottom: -2.5, near: 0.5, far: 10 }); sun.shadow.bias = -0.0002; sun.shadow.normalBias = 0.01;
scene.add(sun, new THREE.HemisphereLight(0xdfe6f0, 0x5a4a3a, 0.6));
const add = (g, m) => { const o = new THREE.Mesh(g, m); o.castShadow = o.receiveShadow = true; scene.add(o); return o; };
const M = (c, r = 0.7, x = {}) => new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(...c, THREE.SRGBColorSpace), roughness: r, ...x });
const metres = (g, sx, sy) => { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * sx, uv.getY(i) * sy); return g; };
let t = performance.now();

// ---------------------------------------------------------------- room corner: oak floor, two painted walls (x = 0 and z = 0)
const fl = floorMaps();
add(metres(new THREE.PlaneGeometry(3, 3).rotateX(-Math.PI / 2).translate(1.5, 0, 1.5), 3, 3), new THREE.MeshStandardMaterial({ map: fl.map, normalMap: fl.normalMap, roughnessMap: fl.roughnessMap, roughness: 1 }));
const wallM = wallPatch(new THREE.MeshStandardMaterial({ color: 0xe9e7e1, roughness: 0.93, normalMap: wallNormal() }));
add(metres(new THREE.PlaneGeometry(3, 2.5).translate(1.5, 1.25, 0), 3, 2.5), wallM); add(metres(new THREE.PlaneGeometry(3, 2.5).rotateY(Math.PI / 2).translate(0, 1.25, 1.5), 3, 2.5), wallM);
t = lap('room', t);

// ---------------------------------------------------------------- a wooden chair (its meshes are the drape collider)
const CH = { x: 1.3, z: 0.75 }, wood = M([0.55, 0.38, 0.24], 0.55), chairParts = [];
const part = (g) => { const o = add(g, wood); chairParts.push(o); return o; };
part(new RoundedBoxGeometry(0.44, 0.03, 0.4, 2, 0.008).translate(CH.x, 0.45, CH.z - 0.01));
for (const [dx, dz, h] of [[-0.19, -0.18, 0.45], [0.19, -0.18, 0.45], [-0.19, 0.18, 0.88], [0.19, 0.18, 0.88]]) part(new THREE.BoxGeometry(0.03, h, 0.03).translate(CH.x + dx, h / 2, CH.z + dz));
part(new RoundedBoxGeometry(0.44, 0.07, 0.03, 2, 0.01).translate(CH.x, 0.86, CH.z + 0.18));          // top rail
part(new RoundedBoxGeometry(0.4, 0.04, 0.022, 2, 0.008).translate(CH.x, 0.66, CH.z + 0.18));
// towel thrown over the top rail: starts folded over it (overBar), the middle of the fold pinned, and settles
t = performance.now();
const D = 0.015, TW = 27, TH = 61, railY = 0.895;
const tw1 = drapeCloth({ W: TW, H: TH, D, steps: STEPS, collider: surfacePoints(chairParts, 0.007), floor: 0.004,
  ...overBar({ cx: CH.x + 0.02, top: railY, cz: CH.z + 0.18, W: TW, D, fold: 26, skew: +(Q.get('skew') ?? 0.12), gather: +(Q.get('gather') ?? 0.85) }) });
stats.drape.chairTowel = tw1.stats; t = lap('drape chair', t);
const terry = terryNormal();
const towelMat = (c) => fabricMaterial(c, { normal: terry, tileM: 0.05, nscale: 1.0, sheen: 0.6, rough: 1 });
const towelGeo = (res, Dm, seed) => { const R = refine(res.P, res.W, res.H); return thickCloth(R.P, R.W, R.H, { th: () => 0.005, uv: (i, j) => [i * Dm / 2, j * Dm / 2], shade: (i, j) => 0.95 + 0.08 * fbm2(i * 0.05 + seed, j * 0.05, 2, seed) }); };
const towelM1 = towelMat(0xb5806b); towelM1.vertexColors = true; add(towelGeo(tw1, D, 3), towelM1);

// ---------------------------------------------------------------- rope basket with laundry, a towel half over its rim
const B = { x: 0.45, z: 0.45 }, bk = ropeBasket();
const ropeM = fabricMaterial(0xd4caa8, { normal: ropeNormal(), tileM: 0.014, nscale: 1.2, sheen: 0.25 }); ropeM.normalMap.repeat.set(4, 1 / 0.014);
const basket = add(bk.wall.translate(B.x, 0, B.z), ropeM);
const heap = add(skin(sampleGrid((u, v, o) => { const a = u * TAU, r = 0.172 * v, x = r * Math.cos(a), z = r * Math.sin(a); return o.set(B.x + x + bk.lean, bk.H - 0.075 + 0.075 * fbm2(x * 8 + 2, z * 8 + 5, 3, 37) - 0.045 * v * v, B.z + z); }, 44, 16, { closedU: true, face: [0, 1, 0] }), 1.1, 0.18),
  fabricMaterial(0xd8d6d0, { normal: weaveNormal({ slub: 0.4 }), tileM: 0.1, sheen: 0.3 }));
t = performance.now();
const BW = 21, BHh = 33;
const tw2 = drapeCloth({ W: BW, H: BHh, D, steps: STEPS, collider: surfacePoints([basket, heap], 0.007), floor: 0.004,
  ...overRim({ center: [B.x + bk.lean, B.z], rimR: bk.rimR, top: bk.H, a0: Math.PI * 0.3, W: BW, D, fold: 13, skew: 0.15, gather: 0.85 }) });
stats.drape.basketTowel = tw2.stats; t = lap('drape basket', t);
const towelM2 = towelMat(0x7f97a6); towelM2.vertexColors = true; add(towelGeo(tw2, D, 7), towelM2);

// ---------------------------------------------------------------- floor things: socks, crumpled paper, the charger cable
const knit = knitNormal(), rib = ribNormal({ ribs: 16 });
const sockM = fabricMaterial(0x4d5a6b, { normal: knit, tileM: 0.06, sheen: 0.5 }), sockRibM = fabricMaterial(0x4d5a6b, { normal: rib, tileM: 0.03, sheen: 0.5 });
for (const [x, z, ry, seed, bend] of [[1.0, 1.35, -0.5, 5, 0.85], [1.35, 1.5, 2.9, 11, 0.6]]) {
  const s = sock(new THREE.Matrix4().makeRotationY(ry).setPosition(x, 0, z), { seed, bend });
  add(s.foot, sockM); add(s.cuff, sockRibM);
}
const paper = M([0.93, 0.92, 0.88], 0.8, { flatShading: true }), r = new RNG(9);
for (let i = 0; i < 3; i++) add(paperBall(0.028 + 0.008 * r.next(), i + 2).rotateY(r.next() * 6).translate(1.85 + r.range(-0.15, 0.15), 0, 0.35 + r.range(-0.1, 0.15)), paper);
// socket on the left wall (x = 0), cable hangs to the floor, wanders off in a loose loop
add(new RoundedBoxGeometry(0.08, 0.08, 0.012, 2, 0.006).rotateY(Math.PI / 2).translate(0.006, 0.3, 1.6), M([0.93, 0.93, 0.92], 0.4));
add(new RoundedBoxGeometry(0.023, 0.039, 0.039, 3, 0.0055).translate(0.024, 0.3, 1.6), M([0.95, 0.95, 0.94], 0.35));
const yf = 0.0016, pts = [[0.03, 0.254, 1.6], [0.032, 0.2, 1.601], [0.036, 0.1, 1.604], [0.042, 0.03, 1.61], [0.07, 0.004, 1.635], [0.115, yf, 1.685], [0.2, yf, 1.745], [0.31, yf, 1.74], [0.382, yf, 1.665], [0.37, yf, 1.58], [0.305, yf, 1.535], [0.235, yf, 1.55], [0.2, yf, 1.59], [0.21, yf, 1.635]].map((p) => new THREE.Vector3(...p));
add(cable(pts, 0.0015), M([0.94, 0.94, 0.93], 0.45));

// ---------------------------------------------------------------- side table: mug with tea marks, steel bottle, magazines underneath
const TB = { x: 2.2, z: 0.35, h: 0.5 };
add(new RoundedBoxGeometry(0.45, 0.025, 0.4, 2, 0.006).translate(TB.x, TB.h - 0.0125, TB.z), M([0.9, 0.9, 0.88], 0.45, { normalMap: lacquerNormal(), normalScale: new THREE.Vector2(0.15, 0.15) }));
for (const [dx, dz] of [[-0.2, -0.17], [0.2, -0.17], [-0.2, 0.17], [0.2, 0.17]]) add(new THREE.CylinderGeometry(0.012, 0.012, TB.h - 0.025, 12).translate(TB.x + dx, (TB.h - 0.025) / 2, TB.z + dz), M([0.1, 0.1, 0.11], 0.4, { metalness: 0.7 }));
const mg = mug(); const m4 = new THREE.Matrix4().makeRotationY(-0.9).setPosition(TB.x - 0.08, TB.h, TB.z + 0.06);
add(mg.body.applyMatrix4(m4), M([1, 1, 1], 0.13, { vertexColors: true })); add(mg.tea.applyMatrix4(m4), M([0.32, 0.18, 0.08], 0.05));
const bt = bottle(), b4 = new THREE.Matrix4().makeRotationY(0.7).setPosition(TB.x + 0.11, TB.h, TB.z - 0.06);
add(bt.coat.applyMatrix4(b4), M([0.33, 0.42, 0.46], 0.55)); add(bt.steel.applyMatrix4(b4), M([0.8, 0.8, 0.8], 0.25, { metalness: 1 })); add(bt.loop.applyMatrix4(b4), M([0.12, 0.12, 0.13], 0.7));
const rb = new RNG(4), mags = [makeBook(rb, 0.225, 0.297, 0.0062, 12, { full: true, cover: 2, style: 4 }), makeBook(rb, 0.21, 0.275, 0.0048, 9, { full: true, cover: 0 }), makeBook(rb, 0.132, 0.2, 0.019, 4, { full: true, cover: 1, hard: false })];
const atlas = bookAtlas(mags, { seed: 6 }), coverM = M([1, 1, 1], 0.5, { map: atlas.tex }), pagesM = new THREE.MeshStandardMaterial({ map: pagesTexture(), roughness: 0.9 });
let py = 0.0004;
mags.forEach((b, i) => { const g = bookGeometry(b, atlas), q = new THREE.Matrix4().makeRotationY([0.22, -0.14, 0.55][i] + Math.PI).setPosition(TB.x + [0, 0.012, -0.02][i] + 0.1, py, TB.z + 0.05 + [0, -0.008, 0.02][i]); add(merge(g.covers).applyMatrix4(q), coverM); add(g.pages.applyMatrix4(q), pagesM); py += b.t + 0.0002; });
t = lap('props', t);
stats.ms.total = Math.round(performance.now() - T0);
let tris = 0; scene.traverse((o) => { if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; }); stats.tris = tris;

if (Q.get('collider') === '1') {
  const pts = surfacePoints([...chairParts, basket, heap], 0.007), g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pts, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xff3366, size: 0.004 }))); stats.colliderPoints = pts.length / 3;
}
// ---------------------------------------------------------------- cameras
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.01, 50);
const CAMS = { room: [[2.6, 1.5, 2.6], [0.9, 0.4, 0.7]], chair: [[1.75, 1.15, 1.75], [1.28, 0.72, 0.85]], basket: [[1.05, 0.85, 1.15], [0.45, 0.32, 0.45]], floor: [[1.1, 0.6, 2.3], [0.8, 0.0, 1.45]], table: [[2.25, 0.95, 1.05], [2.2, 0.5, 0.3]], basketClose: [[0.75, 0.6, 0.85], [0.5, 0.3, 0.55]] };
const [cp, ct] = CAMS[CAM] || CAMS.room; camera.position.set(...cp);
const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(...ct); controls.update();
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
document.getElementById('stats').textContent = JSON.stringify(stats, null, 1);
if (Q.get('ui') === '0') document.getElementById('ui').style.display = 'none';
window.__props = stats; document.body.dataset.ready = '1';
