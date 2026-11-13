// Boot: build -> light (bake now / load bake/gi.bin / flat placeholder) -> reflections -> post -> cameras.
//   ?bake=128        path-trace the lighting now (then press the button and save it as bake/gi.bin)
//   ?cam=room|desk|window   ?view=gi (lighting only)   ?only=furniture   ?ui=0   ?exp=4.5
// Page contract for headless tools (webgl-deterministic-recording): window.__ready, window.__stats
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildScene } from './scene.js';
import { ROOM, SUN, SKY, LOOK, CAMS } from './layout.js';
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
sun.position.copy(sunDir).multiplyScalar(8).add(new THREE.Vector3(W / 2, 0, 1)); sun.target.position.set(W / 2, 0, 1);
sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096); sun.shadow.bias = -0.0002; sun.shadow.normalBias = 0;   // normalBias > 0 leaks along every seam
Object.assign(sun.shadow.camera, { left: -3.5, right: 3.5, top: 3.5, bottom: -3.5, near: 4, far: 13 });
scene.add(sun, sun.target);
scene.background = new THREE.Color(...SKY.horizon);

// ---------------------------------------------------------------- render
const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(1); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);
if (Q.get('view') === 'gi') root.traverse((o) => { if (o.isMesh && o.name !== 'shell') { o.material.map = null; o.material.color?.set(0xffffff); o.material.needsUpdate = true; } });
captureEnv(renderer, scene, new THREE.Vector3(W / 2, 1.3, D / 2), new THREE.Vector3(0, 0, 0), new THREE.Vector3(W, H, D), 256);   // after the bake: reflections of the lit room
const post = new Post(renderer, { ext: 'wp.z < -0.02' }).setLook({ ...LOOK, exposure: +(Q.get('exp') || LOOK.exposure) });
const camera = new THREE.PerspectiveCamera(55, 1, 0.02, 100);
const cam = CAMS[Q.get('cam')] || CAMS.room; camera.position.set(...cam.pos); camera.fov = cam.fov;
const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(...cam.target); controls.update();
const resize = () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); post.setSize(innerWidth, innerHeight, { msaa: 4 }); };
addEventListener('resize', resize); resize();
renderer.setAnimationLoop(() => { controls.update(); post.render(scene, camera); });

stats.totalMs = Math.round(performance.now() - T0);
log(JSON.stringify(stats));
window.__stats = stats; window.__scene = scene;
document.getElementById('dl').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([packBake(giMeshes(root), info)])); a.download = 'gi.bin'; a.click(); };
requestAnimationFrame(() => requestAnimationFrame(() => { window.__ready = true; document.body.dataset.ready = '1'; }));
