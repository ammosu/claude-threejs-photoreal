// The view from an upper-floor window (floor 5.5 m above the garden): sky dome, lawn, path, hedge, three houses,
// trees (threejs-procedural-vegetation) and a far wall of crowns, everything built only where the room can see it.
// ?sky=dawn|day|overcast|golden   ?cam=window|wide|up|out   ?cull=0 build everything   ?t=seconds (freeze)   ?ui=0
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SKIES, SKY_U, skyDome, skyLights, skyEnvironment, measureDome, skyRadiance } from '../scripts/sky.js';
import { RNG, windowVisibility, hazePatch, grassTexture, roofTexture, windowTexture, crownTexture, houses, lawn, gravelPath, hedge, crownWall } from '../scripts/backdrop.js';
import { buildAtlas, barkMaps } from '../../threejs-procedural-vegetation/scripts/atlas.js';
import { Bark, Leaves, makeTree } from '../../threejs-procedural-vegetation/scripts/tree.js';
import { U, barkMaterial, leafMaterial } from '../../threejs-procedural-vegetation/scripts/materials.js';

const Q = new URLSearchParams(location.search), S = SKIES[Q.get('sky')] || SKIES.day, CULL = Q.get('cull') !== '0', CAM = Q.get('cam') || 'window';
const times = {}; let t0 = performance.now(); const lap = (k) => { const n = performance.now(); times[k] = Math.round(n - t0); t0 = n; };
const GROUND = -5.5, WIN = { x0: 1.1, x1: 2.9, y0: 0.85, y1: 2.25 }, WT = 0.3;
const vis = windowVisibility({ win: WIN, wallT: WT, eyeX: [0.2, 4.0], eyeY: [0.45, 1.9], eyeZ: [0.25, 3.8] });
const lodAt = CULL ? vis.lod : () => 2;

const scene = new THREE.Scene();
scene.add(skyDome(S, { display: 1 }));
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const hor = skyRadiance(S, [0, 0.02, -1]), hazeCol = hor.map((c) => c * 0.8);
const ext = (params, haze = true) => { const m = new THREE.MeshStandardMaterial({ roughness: 1, ...params }); return haze ? hazePatch(m, { color: hazeCol, start: 10, density: 0.006 }) : m; };

// ---------------------------------------------------------------- the room: a dark interior and the window wall (z = 0)
// (unbaked here: the outdoor hemisphere light also reaches the room, so its colours are darkened ~4x to read like a
//  room exposed for the view; with threejs-baked-gi the room gets its true ~1/20 of outside instead)
{
  const wall = new THREE.MeshStandardMaterial({ color: 0x3a3833, roughness: 0.9 }), g = [];
  for (const [w, h, x, y] of [[6, 2.0, 2, WIN.y0 - 1.0], [6, 1.0, 2, WIN.y1 + 0.5], [2.0, WIN.y1 - WIN.y0, WIN.x0 - 1.0, (WIN.y0 + WIN.y1) / 2], [2.0, WIN.y1 - WIN.y0, WIN.x1 + 1.0, (WIN.y0 + WIN.y1) / 2]])
    g.push(new THREE.BoxGeometry(w, h, WT).translate(x, y, -WT / 2));
  for (const gg of g) { const m = new THREE.Mesh(gg, wall); m.castShadow = m.receiveShadow = true; scene.add(m); }
  const plane = (w, h, x, y, z, rx, ry, c) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ color: new THREE.Color(c).multiplyScalar(0.25), roughness: 0.9 })); m.position.set(x, y, z); m.rotation.set(rx, ry, 0); m.receiveShadow = true; scene.add(m); };
  plane(4.2, 4.0, 2.0, 0, 2.0, -Math.PI / 2, 0, 0x8a6a4c); plane(4.2, 4.0, 2.0, 2.6, 2.0, Math.PI / 2, 0, 0xe0ddd6);     // floor, ceiling
  plane(4.0, 2.6, -0.1, 1.3, 2.0, 0, Math.PI / 2, 0xd8d4cc); plane(4.0, 2.6, 4.1, 1.3, 2.0, 0, -Math.PI / 2, 0xd8d4cc); plane(4.2, 2.6, 2.0, 1.3, 4.0, 0, Math.PI, 0xd8d4cc);
  const sill = new THREE.Mesh(new THREE.BoxGeometry(WIN.x1 - WIN.x0 + 0.1, 0.03, WT + 0.06), new THREE.MeshStandardMaterial({ color: 0xeeeeea, roughness: 0.4 })); sill.position.set(2, WIN.y0 - 0.015, -WT / 2 + 0.03); sill.receiveShadow = true; scene.add(sill);
}
lap('room');

// ---------------------------------------------------------------- ground, path, hedge, houses, far crowns
const grass = grassTexture(); grass.repeat.set(1, 1);
const add = (g, m, name) => { const o = new THREE.Mesh(g, m); o.name = name; o.castShadow = o.receiveShadow = true; scene.add(o); return o; };
add(lawn({ ground: GROUND }), ext({ map: grass, vertexColors: true }), 'lawn');
const pathZ = (x) => -17 + 1.3 * Math.sin(x * 0.07 + 0.6);
add(gravelPath(pathZ, { ground: GROUND }), ext({ color: new THREE.Color().setRGB(0.45, 0.43, 0.39, THREE.SRGBColorSpace), vertexColors: true }), 'path');
add(hedge((x) => pathZ(x) - 2.1, { ground: GROUND }), ext({ color: new THREE.Color().setRGB(0.22, 0.32, 0.14, THREE.SRGBColorSpace) }), 'hedge');
const H = houses([{ x: 4.5, z: -34, w: 11, d: 9, eave: 8.5, ridge: 11.8 }, { x: -24, z: -44, w: 9.5, d: 8, eave: 7.7, ridge: 10.7 }, { x: 23, z: -46, w: 12, d: 9, eave: 8.2, ridge: 11.6 }], { ground: GROUND });
const roofTex = roofTexture(); const sc = (r, g, b) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
add(H.wall, ext({ color: sc(0.87, 0.86, 0.83), roughness: 0.95 }), 'houseWalls'); add(H.roof, ext({ map: roofTex, roughness: 0.9 }), 'houseRoofs'); add(H.trim, ext({ color: sc(0.82, 0.82, 0.8) }), 'houseTrim');
add(H.win, ext({ map: windowTexture(), roughness: 0.6 }), 'houseWindows'); add(H.glass, ext({ color: sc(0.42, 0.5, 0.58), roughness: 0.3 }), 'roofLights');
add(H.dark, ext({ color: sc(0.2, 0.2, 0.21), roughness: 0.7 }), 'houseDark'); add(H.brick, ext({ color: sc(0.52, 0.32, 0.25), roughness: 0.95 }), 'chimneys');
const crowns = crownTexture(); const cw = add(crownWall({ R: 100, center: [1.5, 0], ground: GROUND, height: 20 }), ext({ map: crowns, alphaTest: 0.5, side: THREE.DoubleSide }), 'crownWall'); cw.castShadow = false;
lap('ground+houses');

// ---------------------------------------------------------------- trees (vegetation skill), LOD from what the window shows
const bark = new Bark(), LV = new Leaves(), tr = new RNG(8807);
const TREES = [
  { seed: 101, lod: 0, sp: 'rob', x: -4.5, z: -10, H: 14, R: 4.3, trunk: 0.5, first: 0.36, limbs: 9, az0: 0.9, lean: [0.03, -0.01], d2: 2.8, d3: 6, sparse: 1 },
  { seed: 303, lod: 0, sp: 'ash', x: 9.5, z: -14, H: 12.4, R: 3.8, trunk: 0.45, first: 0.4, limbs: 8, az0: 4.0, lean: [0.04, 0], d2: 3.0, d3: 6, sparse: 1 },
  // two trees close to the facade, left and right of the window: mostly out of sight from inside -> culled / thinned
  { seed: 404, lod: 0, sp: 'lime', x: -7.5, z: -4.5, H: 12, R: 3.8, trunk: 0.45, first: 0.4, limbs: 8, az0: 2.1, lean: [0, 0], d2: 3.0, d3: 6, sparse: 1 },
  { seed: 505, lod: 0, sp: 'rob', x: 12, z: -5, H: 13, R: 4.0, trunk: 0.5, first: 0.36, limbs: 9, az0: 1.3, lean: [0, 0], d2: 2.8, d3: 6, sparse: 1 },
];
for (const T of TREES) makeTree({ ...T, y: GROUND }, bark, LV, { lodAt });
const nHero = LV.n;
for (let i = 0; i < 8; i++) makeTree({ seed: 500 + i * 13, lod: 1, y: GROUND, x: -18 + i * 6 + tr.range(-1.5, 1.5), z: -24 - tr.range(0, 8), H: tr.range(10, 14), R: tr.range(3, 4.2), trunk: 0.5, first: 0.4, limbs: 7, az0: tr.range(0, Math.PI * 2), lean: [tr.range(-0.05, 0.05), tr.range(-0.05, 0.05)], d2: 1.7, dens: 13, size: 0.72 }, bark, LV, { lodAt });
const nMid = LV.n - nHero;
for (let i = 0; i < 26; i++) { const row = i & 1, x = -60 + i * 5.1 + tr.range(-1.8, 1.8), z = (row ? -57 : -49) + tr.range(-3, 3), Ht = tr.range(13, 19); makeTree({ seed: 900 + i * 7, lod: 2, y: GROUND, x, z, H: Ht, R: Ht * tr.range(0.27, 0.33), trunk: 0.48, first: 0.35, limbs: 8, az0: tr.range(0, Math.PI * 2), lean: [0, 0], dens: 11 }, bark, LV, { lodAt }); }
lap('trees');
const atlas = buildAtlas(), bm = barkMaterial(barkMaps()), lm = leafMaterial(atlas);
const barkMesh = new THREE.Mesh(bark.geo(), bm.material); barkMesh.customDepthMaterial = bm.depth; barkMesh.frustumCulled = false; barkMesh.castShadow = barkMesh.receiveShadow = true; scene.add(barkMesh);
const eye = [2, 1.5, 2.5], leafMesh = LV.build(lm.material, eye); leafMesh.customDepthMaterial = lm.depth; leafMesh.castShadow = leafMesh.receiveShadow = true; scene.add(leafMesh);
lap('tree meshes');

// ---------------------------------------------------------------- light from the sky preset (unbaked scene)
const { sun, hemi } = skyLights(S, { target: [2, GROUND, -20], shadowExtent: 45 });
scene.add(hemi); if (sun) { scene.add(sun, sun.target); U.uSunDir.value.copy(sun.position).sub(sun.target.position).normalize(); U.uSunCol.value.copy(sun.color).multiplyScalar(sun.intensity); } else U.uSunCol.value.setRGB(0, 0, 0);
U.uSkyZen.value.setRGB(...S.zenith); U.uSkyHor.value.setRGB(...S.horizon);

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = +(Q.get('exp') || (CAM === 'window' ? 0.9 : 0.75)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);
scene.environment = skyEnvironment(renderer, S); scene.environmentIntensity = 0.5;
const domeCheck = measureDome(renderer, S), pureCheck = measureDome(renderer, S, 64, { pure: true });
lap('lights+env+check');

// ---------------------------------------------------------------- cameras
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.05, 1000);
const CAMS = { window: [[2.0, 1.45, 3.4], [2.0, 1.45, -2]], wide: [[2.0, 1.55, 0.55], [1.5, 0.5, -15]], up: [[2.0, 1.4, 0.3], [2.6, 3.4, -3]], out: [[40, 45, 40], [2, -5, -25]] };
const [cp, ct] = CAMS[CAM] || CAMS.window; camera.position.set(...cp);
const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(...ct); controls.update();
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
const FIX = Q.has('t') ? +Q.get('t') : null, T0 = performance.now();
renderer.setAnimationLoop(() => { const tt = FIX ?? (performance.now() - T0) / 1000; SKY_U.uTime.value = tt; U.uTime.value = tt; controls.update(); renderer.render(scene, camera); });

let tris = 0; scene.traverse((o) => { if (o.isMesh) tris += ((o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3) * (o.isInstancedMesh ? o.count : 1); });
const stats = { sky: Q.get('sky') || 'day', cull: CULL, times, tris, leafCards: LV.n, hero: nHero, mid: nMid, far: LV.n - nHero - nMid, barkTris: bark.ix ? bark.ix.length / 3 : null, domeVsAnalytic: domeCheck, measurementCheck: pureCheck };
document.getElementById('stats').textContent = JSON.stringify(stats, null, 1);
if (Q.get('ui') === '0') document.getElementById('ui').style.display = 'none';
window.__sky = stats; document.body.dataset.ready = '1';
void lum;
