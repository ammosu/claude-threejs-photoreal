// Worked example: three hero trees (robinia, lime, ash), a ring of mid-distance trees and a far tree line on a lawn.
//   ?t=12.5   freeze time (deterministic screenshots)   ?wind=0..2   ?cam=ground|under|wide|leaf   ?only=hero   ?ui=0
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RNG, TAU, fbm2 } from '../scripts/util.js';
import { buildAtlas, barkMaps } from '../scripts/atlas.js';
import { Bark, Leaves, makeTree } from '../scripts/tree.js';
import { U, barkMaterial, leafMaterial } from '../scripts/materials.js';

const Q = new URLSearchParams(location.search);
if (Q.get('ui') === '0') document.getElementById('ui').style.display = 'none';
const times = {}; let t = performance.now();
const lap = (k) => { const n = performance.now(); times[k] = Math.round(n - t); t = n; };

// ---------------------------------------------------------------- trees
const CAMS = { ground: [[2, 1.6, 17], [1.5, 6, 0]], under: [[-4.2, 1.5, 2.5], [-5, 9, -1]], wide: [[22, 9, 30], [2, 5, 0]], leaf: [[-2.6, 4.4, 3.6], [-3.6, 5.6, 1.4]] };
const cam = CAMS[Q.get('cam')] || CAMS.ground;
const HERO = [
  // seed, species, position, height H, crown radius R, trunk fraction, first limb height (fraction), limbs, azimuth, lean, branch / twig densities
  { seed: 101, lod: 0, sp: 'rob', x: -5, z: 0, H: 14, R: 4.3, trunk: 0.5, first: 0.36, limbs: 9, az0: 0.9, lean: [0.03, -0.01], d2: 2.8, d3: 6, sparse: 1 },
  { seed: 202, lod: 0, sp: 'lime', x: 5, z: -5, H: 11.2, R: 3.6, trunk: 0.45, first: 0.4, limbs: 8, az0: 2.1, lean: [-0.02, 0.02], d2: 3.0, d3: 6, sparse: 1 },
  { seed: 303, lod: 0, sp: 'ash', x: 11, z: 3, H: 10.4, R: 3.5, trunk: 0.45, first: 0.4, limbs: 8, az0: 4.0, lean: [0.04, 0], d2: 3.0, d3: 6, sparse: 1 },
];
const bark = new Bark(), LV = new Leaves();
// twig-level LOD: 2 = full sprays, 1 = sparser bigger cards (far side of a crown), 0 = one cheap clump card
const eye = cam[0], lodAt = (x, y, z) => { const d = Math.hypot(x - eye[0], y - eye[1], z - eye[2]); return d < 30 ? 2 : d < 60 ? 1 : 0; };
for (const S of HERO) makeTree(S, bark, LV, { lodAt });
const nHero = LV.n; lap('hero');
if (Q.get('only') !== 'hero') {
  const r = new RNG(8807);
  for (let i = 0; i < 12; i++) {     // mid ring: limbs + branches, foliage clumps (atlas row 3)
    const a = (i / 12) * TAU + r.range(-0.2, 0.2), d = r.range(24, 36);
    makeTree({ seed: 500 + i * 13, lod: 1, x: Math.cos(a) * d, z: Math.sin(a) * d - 8, H: r.range(10, 14), R: r.range(3, 4.2), trunk: 0.5, first: 0.4, limbs: 7, az0: r.range(0, TAU), lean: [r.range(-0.05, 0.05), r.range(-0.05, 0.05)], d2: 1.7, dens: 13, size: 0.72 }, bark, LV, { lodAt });
  }
  for (let i = 0; i < 30; i++) {     // far tree line: limbs only, big clumps
    const a = (i / 30) * TAU + r.range(-0.08, 0.08), d = r.range(60, 75), H = r.range(13, 19);
    makeTree({ seed: 900 + i * 7, lod: 2, x: Math.cos(a) * d, z: Math.sin(a) * d - 8, H, R: H * r.range(0.27, 0.33), trunk: 0.48, first: 0.35, limbs: 8, az0: r.range(0, TAU), lean: [r.range(-0.04, 0.04), r.range(-0.04, 0.04)], dens: 11 }, bark, LV, { lodAt });
  }
}
lap('mid+far');

// ---------------------------------------------------------------- materials + meshes
const atlas = buildAtlas(); lap('atlas');
const bm = barkMaterial(barkMaps()), lm = leafMaterial(atlas); lap('barkMaps');
const scene = new THREE.Scene();
const barkMesh = new THREE.Mesh(bark.geo(), bm.material); barkMesh.customDepthMaterial = bm.depth; barkMesh.frustumCulled = false;
const leafMesh = LV.build(lm.material, eye); leafMesh.customDepthMaterial = lm.depth;
for (const m of [barkMesh, leafMesh]) { m.castShadow = m.receiveShadow = true; scene.add(m); }
lap('meshes');

// lawn with a little colour variation
{
  const g = new THREE.PlaneGeometry(400, 400, 200, 200).rotateX(-Math.PI / 2), p = g.attributes.position, col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i), a = fbm2(x * 0.11 + 40, z * 0.11 + 40, { oct: 3, seed: 3 }), b = fbm2(x * 0.035, z * 0.035, { oct: 2, seed: 4 }); col[i * 3] = 0.6 + 0.56 * a + 0.4 * (b - 0.5); col[i * 3 + 1] = 0.62 + 0.38 * a; col[i * 3 + 2] = 0.5 + 0.26 * a - 0.3 * (b - 0.5); }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const lawn = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x4a6b2a, vertexColors: true, roughness: 1 })); lawn.receiveShadow = true; scene.add(lawn);
}

// ---------------------------------------------------------------- light: sun + sky (keep U.uSunDir / uSunCol in sync with the light)
const sunDir = new THREE.Vector3(-0.45, 0.62, 0.64).normalize();
U.uSunDir.value.copy(sunDir); U.uSunCol.value.setRGB(1, 0.93, 0.8).multiplyScalar(2.6);
U.uWind.value = +(Q.get('wind') ?? 1);
const sun = new THREE.DirectionalLight(0xffeedd, 2.6); sun.position.copy(sunDir).multiplyScalar(60).add(new THREE.Vector3(3, 0, 0)); sun.target.position.set(3, 0, 0);
sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096); sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.03;
Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 20, far: 110 });
scene.add(sun, sun.target, new THREE.HemisphereLight(0xbcd4ff, 0x4a5a30, 1.1));
scene.background = new THREE.Color(0.62, 0.76, 0.95); scene.fog = new THREE.Fog(0xb8cbe3, 40, 160);

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
const camera = new THREE.PerspectiveCamera(Q.get('cam') === 'leaf' ? 40 : 55, innerWidth / innerHeight, 0.05, 500);
const controls = new OrbitControls(camera, renderer.domElement);
camera.position.set(...cam[0]); controls.target.set(...cam[1]); controls.update();
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

const FIX = Q.has('t') ? +Q.get('t') : null, T0 = performance.now();
let frames = 0, fps = 0, f0 = performance.now();
renderer.setAnimationLoop(() => {
  U.uTime.value = FIX ?? (performance.now() - T0) / 1000;
  controls.update(); renderer.render(scene, camera);
  if (++frames === 60) { fps = Math.round((60 * 1000) / (performance.now() - f0)); document.getElementById('fps').textContent = fps + ' fps'; window.__veg.fps = fps; }
});

const stats = { times, leafCards: LV.n, heroCards: nHero, barkTris: bark.ix.length / 3, atlasCover: +atlas.cover.toFixed(2) };
window.__veg = stats; console.log('[veg]', JSON.stringify(stats));
document.getElementById('stats').textContent = JSON.stringify(stats, null, 1);
requestAnimationFrame(() => requestAnimationFrame(() => { document.body.dataset.ready = '1'; }));
