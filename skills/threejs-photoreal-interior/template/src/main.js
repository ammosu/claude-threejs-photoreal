// Boot: build -> light (bake now / load bake/gi.bin / flat placeholder) -> reflections -> post -> cameras.
//   ?bake=128        path-trace the lighting now (then press the button and save it as bake/gi.bin)
//   ?cam=room|desk|window   ?view=gi (lighting only)   ?only=furniture   ?ui=0   ?exp=4.5
// Page contract for headless tools (webgl-deterministic-recording): window.__ready, window.__stats
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { buildScene } from './scene.js';
import { ROOM, SUN, SKY, LOOK, CAMS, TABLE, CHAIR, SHELF, BLOCKERS } from './layout.js';
import { giMeshes, applyBake, packBake, placeholderGi, captureEnv } from './lib/gi/gi.js';
import { runBake } from './lib/gi/baker.js';
import { Post } from './lib/post/post.js';

const Q = new URLSearchParams(location.search), BAKE = Q.has('bake') ? +(Q.get('bake') || 128) : 0;
const logEl = document.getElementById('log'), log = (s) => { console.log(s); logEl.textContent += s + '\n'; };
if (Q.get('ui') === '0') document.getElementById('ui').style.display = 'none';
const T0 = performance.now();

const { scene, root, ctx } = await buildScene((l) => (document.title = 'building ' + l));
const stats = { ...ctx.stats, buildMs: Math.round(performance.now() - T0) };
let tris = 0; root.traverse((o) => { if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; }); stats.tris = tris;

// ---------------------------------------------------------------- light
const { W, D, H, win } = ROOM, sunDir = new THREE.Vector3(...SUN.dir).normalize();
const cfg = {
  sky: SKY, portal: { x0: win.x0, x1: win.x1, y0: win.y0, y1: win.y1, z: 0, area: (win.x1 - win.x0) * (win.y1 - win.y0) },
  room: [0.0005, 0.0005, 0.0005, W - 0.0005, H - 0.0005, D - 0.0005], sun: { dir: sunDir.toArray(), irr: SUN.irr, radius: 0.01, bakeDirect: false }, maxDepth: 6,
};
let info = {};
if (BAKE) {
  placeholderGi(root);
  const workers = +(Q.get('workers') || Math.max(2, (navigator.hardwareConcurrency || 8) - 2));
  const r = await runBake(root, cfg, { spp: BAKE, workers, smooth: 2, log, onProgress: (l, p) => { document.title = `${l} ${(p * 100) | 0}%`; } });
  info = { bakeSecs: +r.secs.toFixed(1), samples: r.samples, spp: BAKE, workers };
} else {
  const r = await fetch('./bake/gi.bin', { cache: 'no-store' }).catch(() => null);
  const res = r && r.ok ? applyBake(root, await r.arrayBuffer()) : { ok: false };
  if (!res.ok) { placeholderGi(root); log('no bake/gi.bin: flat placeholder light. Open ?bake=128, then save the file.'); }
  else { log(`bake applied ${res.applied}, stale ${res.stale}`); info = { applied: res.applied, stale: res.stale, ...(res.meta || {}) }; }
}
Object.assign(stats, info);
// direct sun: real time, same irradiance as the bake's sun; no ambient / hemisphere light (that is in the bake)
const sun = new THREE.DirectionalLight(new THREE.Color(...SUN.irr).multiplyScalar(1 / Math.max(...SUN.irr)), Math.max(...SUN.irr));
sun.position.copy(sunDir).multiplyScalar(30).add(new THREE.Vector3(W / 2, 0, 1)); sun.target.position.set(W / 2, 0, 1);   // far enough out that the tree crowns are inside the shadow camera
sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096); sun.shadow.bias = -0.0002; sun.shadow.normalBias = 0;   // normalBias > 0 leaks along every seam
Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 12, far: 40 });
scene.add(sun, sun.target);

// ---------------------------------------------------------------- render
const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(1); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);
if (Q.get('view') === 'gi') root.traverse((o) => { if (o.isMesh && o.name !== 'shell') { o.material.map = null; o.material.color?.set(0xffffff); o.material.needsUpdate = true; } });
captureEnv(renderer, scene, new THREE.Vector3(W / 2, 1.3, D / 2), new THREE.Vector3(0, 0, 0), new THREE.Vector3(W, H, D), 256);   // after the bake: reflections of the lit room
const post = new Post(renderer, { ext: 'wp.z < -0.02' }).setLook({ ...LOOK, exposure: +(Q.get('exp') || LOOK.exposure) });
const camera = new THREE.PerspectiveCamera(55, 1, 0.02, 400);   // far > crown wall (R 100) and the lawn (260 m): a shorter far plane clips them and the hazy horizon shows through
const cam = CAMS[Q.get('cam')] || CAMS.room; camera.position.set(...cam.pos); camera.fov = cam.fov;
const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(...cam.target);
// keep the camera inside the room: orbit / zoom / pan stop at the walls (the view through the window stays a view)
controls.maxDistance = 3.5; controls.minDistance = 0.05;
const M = 0.12, roomBox = new THREE.Box3(new THREE.Vector3(M, 0.1, M), new THREE.Vector3(W - M, H - 0.08, D - M));
const targetBox = new THREE.Box3(new THREE.Vector3(0.02, 0.02, 0.02), new THREE.Vector3(W - 0.02, H - 0.02, D - 0.02));
const clampView = () => { controls.target.clamp(targetBox.min, targetBox.max); camera.position.clamp(roomBox.min, roomBox.max); };
controls.addEventListener('change', clampView); clampView(); controls.update();
const resize = () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); post.setSize(innerWidth, innerHeight, { msaa: 4 }); };
addEventListener('resize', resize); resize();
// ---------------------------------------------------------------- walk: WASD / arrows move (Shift = slow) in both modes; drag to look,
// or click for mouse-look (pointer lock, Esc to leave). Orbit mode keeps the camera height; mouse-look puts it at eye height.
const walk = new PointerLockControls(camera, renderer.domElement), keys = new Set(), EYE = 1.6, R = 0.25;
const boxes = [   // furniture footprints [x0, z0, x1, z1] the walker cannot enter (grown by R)
  [TABLE.x - TABLE.w / 2, TABLE.z - TABLE.d / 2, TABLE.x + TABLE.w / 2, TABLE.z + TABLE.d / 2],
  [CHAIR.x - 0.24, CHAIR.z - 0.23, CHAIR.x + 0.24, CHAIR.z + 0.22], [SHELF.x0, SHELF.z0, SHELF.x1, SHELF.z1], ...BLOCKERS,
];
const blocked = (x, z) => x < R || x > W - R || z < R || z > D - R || boxes.some(([a, b, c, d]) => x > a - R && x < c + R && z > b - R && z < d + R);
renderer.domElement.addEventListener('click', () => { if (!walk.isLocked) walk.lock(); });
walk.addEventListener('lock', () => {
  controls.enabled = false; let { x, z } = camera.position;
  if (blocked(x, z)) { x = W / 2; z = D - 0.6; }                     // start somewhere free if the orbit camera was inside something
  camera.position.set(x, EYE, z);
});
walk.addEventListener('unlock', () => { controls.enabled = true; const f = new THREE.Vector3(); camera.getWorldDirection(f); controls.target.copy(camera.position).addScaledVector(f, 1.5); controls.update(); });
addEventListener('keydown', (e) => keys.add(e.code)); addEventListener('keyup', (e) => keys.delete(e.code));
const fwd = new THREE.Vector3(), side = new THREE.Vector3();
function step(dt) {
  const k = (a, b) => (keys.has(a) || keys.has(b) ? 1 : 0), f = k('KeyW', 'ArrowUp') - k('KeyS', 'ArrowDown'), s = k('KeyD', 'ArrowRight') - k('KeyA', 'ArrowLeft');
  if (!f && !s) return;
  camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize(); side.crossVectors(fwd, camera.up);
  const v = (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 0.6 : 1.4) * dt, dx = (fwd.x * f + side.x * s) * v, dz = (fwd.z * f + side.z * s) * v;
  const p = camera.position, x0 = p.x, z0 = p.z;
  if (!blocked(p.x + dx, p.z)) p.x += dx;                             // slide along walls and furniture
  if (!blocked(p.x, p.z + dz)) p.z += dz;
  if (!walk.isLocked) { controls.target.x += p.x - x0; controls.target.z += p.z - z0; }   // orbit mode: WASD walks too, drag to look
}
const fixT = Q.has('t') ? +Q.get('t') : null, clock0 = performance.now(); let last = performance.now();
renderer.setAnimationLoop(() => {
  const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
  const t = fixT ?? (now - clock0) / 1000; for (const fn of ctx.animated) fn(t);
  step(dt); if (controls.enabled) { controls.update(); clampView(); } post.render(scene, camera);
});

stats.totalMs = Math.round(performance.now() - T0);
log(JSON.stringify(stats));
window.__stats = stats; window.__scene = scene; window.__camera = camera;
document.getElementById('dl').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([packBake(giMeshes(root), info)])); a.download = 'gi.bin'; a.click(); };
requestAnimationFrame(() => requestAnimationFrame(() => { window.__ready = true; document.body.dataset.ready = '1'; }));
