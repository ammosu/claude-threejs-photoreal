// Worked example: a pair of linen curtains on a rod in front of a bright window (?cam=front|angle|top|hem|above).
// ?fullness=2.7 flat width / gathered width   ?loops=7   ?tied=1 hem pulled together   ?tex=checker UV check   ?t=seconds
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RNG } from '../scripts/cloth.js';
import { curtainPanel, auditPanel, linenTextures, curtainMaterial, curtainRing, CU } from '../scripts/curtain.js';

const Q = new URLSearchParams(location.search);
const FULL = +(Q.get('fullness') || 2.7), LOOPS = +(Q.get('loops') || 0), TIED = Q.get('tied') === '1', CAM = Q.get('cam') || 'angle';
const T0 = performance.now();

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio)); renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0; renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x16181c);
const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.35;

// ---------------------------------------------------------------- wall with a window opening (window spans x 0.5..2.5, y 0.85..2.15), wall at z = 0
const WALL = new THREE.MeshStandardMaterial({ color: 0xd9d4ca, roughness: 0.9 });
const wallGeo = [
  new THREE.BoxGeometry(8, 0.85, 0.2).translate(1.5, 0.425, -0.1), new THREE.BoxGeometry(8, 0.65, 0.2).translate(1.5, 2.475, -0.1),
  new THREE.BoxGeometry(3, 1.3, 0.2).translate(-1, 1.5, -0.1), new THREE.BoxGeometry(3, 1.3, 0.2).translate(4, 1.5, -0.1),
];
const wall = new THREE.Mesh(mergeGeometries(wallGeo), WALL); wall.receiveShadow = true; wall.castShadow = true; scene.add(wall);
const sky = new THREE.Mesh(new THREE.PlaneGeometry(6, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.3, 2.5) })); sky.position.set(1.5, 1.5, -1.5); scene.add(sky);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(6, 5).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x8a7560, roughness: 0.7 })); floor.position.set(1.5, 0, 2.3); floor.receiveShadow = true; scene.add(floor);
// low sun from outside, so the cloth is back-lit and throws fold shadows on the floor
const sun = new THREE.DirectionalLight(0xffe8cc, 3.2); sun.position.set(2.6, 3.4, -3.5); sun.target.position.set(1.5, 0.6, 0.6);
sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096); Object.assign(sun.shadow.camera, { left: -2.5, right: 2.5, top: 2.5, bottom: -2.5, near: 0.5, far: 10 }); sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.01;
scene.add(sun, sun.target, new THREE.HemisphereLight(0xcdd8e8, 0x3a3028, 0.5));
const fill = new THREE.DirectionalLight(0xfff4e8, 1.1); fill.position.set(-2.5, 2.2, 2.2); scene.add(fill);   // grazing from the side: shows the fold relief

// ---------------------------------------------------------------- curtains
const rodY = 2.32, zc = 0.12, rodR = 0.01, yTop = rodY - 0.03, yHem = 0.02;
const tex = Q.get('tex') === 'checker' ? (() => {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { g.fillStyle = (x + y) & 1 ? '#e8e2d6' : '#7a6e60'; g.fillRect(x * 32, y * 32, 32, 32); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / 0.2, 1 / 0.2); t.colorSpace = THREE.SRGBColorSpace; return { map: t, normalMap: null };
})() : linenTextures();
const linen = curtainMaterial({ map: tex.map, normalMap: tex.normalMap, color: new THREE.Color().setRGB(0.92, 0.9, 0.86), yTop });
// tied: the hem is pulled toward the outer side of the window (narrower than the top), otherwise it flares a little
const PANELS = [
  { x0t: 0.27, x1t: 0.95, x0h: TIED ? 0.27 : 0.25, x1h: TIED ? 0.72 : 0.97, loops: LOOPS || 7, seed: 4101, mirror: false },
  { x0t: 2.06, x1t: 2.73, x0h: TIED ? 2.2 : 2.04, x1h: TIED ? 2.73 : 2.75, loops: LOOPS || 6, seed: 7323, mirror: true },
];
const stats = { panels: [] }, rng = new RNG(991), rings = [];
for (const p of PANELS) {
  const t = performance.now();
  const panel = curtainPanel({ ...p, zc, yTop, yHem, fullness: FULL });
  const ms = Math.round(performance.now() - t);
  const mesh = new THREE.Mesh(panel.geo, linen); mesh.castShadow = mesh.receiveShadow = true;
  mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }); scene.add(mesh);
  for (const r of panel.rings) rings.push(curtainRing(rng, rodR, r.z - zc).translate(r.x, rodY, zc));
  stats.panels.push({ ...panel.stats, ms, ...auditPanel(panel) });
}
const METAL = new THREE.MeshStandardMaterial({ color: 0x8c8780, metalness: 1, roughness: 0.32 });
const ringMesh = new THREE.Mesh(mergeGeometries(rings), METAL); ringMesh.castShadow = true; scene.add(ringMesh);
const fin = () => new THREE.LatheGeometry([[0, 0], [0.0102, 0], [0.0119, 0.0012], [0.0119, 0.0046], [0.0106, 0.006], [0.0106, 0.0076], [0.0128, 0.0096], [0.0143, 0.0136], [0.0147, 0.018], [0.0139, 0.0226], [0.0113, 0.0263], [0.007, 0.0286], [0.0028, 0.0297], [0, 0.0299]].map(([x, y]) => new THREE.Vector2(x, y)), 28);
const rod = mergeGeometries([
  new THREE.CylinderGeometry(rodR, rodR, 2.5, 20).rotateZ(Math.PI / 2).translate(1.5, rodY, zc),
  fin().rotateZ(Math.PI / 2).translate(0.2525, rodY, zc), fin().rotateZ(-Math.PI / 2).translate(2.7475, rodY, zc),
  ...[0.292, 1.5, 2.708].flatMap((x) => [new THREE.CylinderGeometry(0.0058, 0.0058, zc, 12).rotateX(Math.PI / 2).translate(x, rodY, zc / 2), new THREE.CylinderGeometry(0.022, 0.022, 0.006, 28).rotateX(Math.PI / 2).translate(x, rodY, 0.003)]),
].map((g) => { g = g.index ? g.toNonIndexed() : g; g.deleteAttribute('uv'); return g; }));
const rodMesh = new THREE.Mesh(rod, METAL); rodMesh.castShadow = true; scene.add(rodMesh);
stats.buildMs = Math.round(performance.now() - T0);

// ---------------------------------------------------------------- cameras
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.01, 50);
const CAMS = {
  front: [[1.5, 1.25, 4.4], [1.5, 1.2, 0]], angle: [[3.4, 1.4, 3.0], [1.2, 1.15, 0]], top: [[0.95, 2.15, 0.75], [0.6, 2.25, 0.05]],
  hem: [[1.0, 0.35, 0.95], [0.6, 0.1, 0.1]], stitch: [[0.45, 0.2, 0.42], [0.29, 0.08, 0.12]], above: [[0.62, 2.75, 0.5], [0.62, 2.0, 0.12]],
};
const [cp, ct] = CAMS[CAM] || CAMS.angle; camera.position.set(...cp);
const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(...ct); controls.update();
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
const fixT = Q.has('t') ? +Q.get('t') : null;
renderer.setAnimationLoop((ms) => { CU.uTime.value = fixT ?? ms / 1000; controls.update(); renderer.render(scene, camera); });
document.getElementById('stats').textContent = JSON.stringify(stats, null, 1);
if (Q.get('ui') === '0') document.getElementById('ui').style.display = 'none';
window.__curtain = stats; document.body.dataset.ready = '1';
