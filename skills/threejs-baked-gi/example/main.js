// Worked example: a room lit only by sky + sun through one window.
//   ?bake=64      path-trace the lighting now (spp), then show it   (&workers=N)
//   (no bake)     load ./gi.bin if present, else flat placeholder light
//   ?test=furnace energy check: a plane under sky 0.5 + overhead sun with E = 0.5 -> every sample should read 1.0
//   ?cam=room|window|corner   ?view=gi (show baked irradiance only)   ?ui=0
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { giPatch, giMeshes, applyBake, packBake, placeholderGi, captureEnv } from '../scripts/gi.js';
import { runBake } from '../scripts/baker.js';

const Q = new URLSearchParams(location.search);
const TEST = Q.get('test'), BAKE = Q.has('bake') ? +(Q.get('bake') || 64) : 0;
const ui = document.getElementById('ui'), stat = document.getElementById('stats');
const log = (s) => { console.log(s); stat.textContent += s + '\n'; };
if (Q.get('ui') === '0') ui.style.display = 'none';

// ---------------------------------------------------------------- tessellated geometry (light lives on vertices!)
/** Box with segments so no face edge is longer than maxEdge. */
const tbox = (w, h, d, me) => new THREE.BoxGeometry(w, h, d, Math.ceil(w / me), Math.ceil(h / me), Math.ceil(d / me));
/** Plane in XY (normal +Z) of w x h with a rectangular hole [hx0,hx1]x[hy0,hy1] (local coords from the lower-left corner).
 *  Hole edges fall exactly on grid lines so the opening is crisp. */
function holePlane(w, h, hole, me) {
  const axis = (len, a, b) => { const cuts = [0, a, b, len], out = []; for (let k = 0; k < 3; k++) { const n = Math.max(1, Math.ceil((cuts[k + 1] - cuts[k]) / me)); for (let i = 0; i < n; i++) out.push(cuts[k] + ((cuts[k + 1] - cuts[k]) * i) / n); } out.push(len); return out; };
  const xs = axis(w, hole[0], hole[1]), ys = axis(h, hole[2], hole[3]), pos = [], idx = [], nx = xs.length;
  for (const y of ys) for (const x of xs) pos.push(x, y, 0);
  for (let j = 0; j < ys.length - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const cx = (xs[i] + xs[i + 1]) / 2, cy = (ys[j] + ys[j + 1]) / 2;
    if (cx > hole[0] && cx < hole[1] && cy > hole[2] && cy < hole[3]) continue;
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1; idx.push(a, b, d, a, d, c);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
const tplane = (w, h, me) => new THREE.PlaneGeometry(w, h, Math.ceil(w / me), Math.ceil(h / me));
const mat = (hex, extra = {}) => giPatch(new THREE.MeshStandardMaterial({ color: hex, roughness: 0.85, ...extra }));

const scene = new THREE.Scene(), root = new THREE.Group(); scene.add(root);
const add = (geo, m, name, f) => { const o = new THREE.Mesh(geo, m); o.name = name; f && f(o); o.castShadow = o.receiveShadow = true; root.add(o); return o; };
let cfg, sunLight = null, camPresets;

if (TEST === 'furnace') {
  // ---------------------------------------------------------------- energy check
  add(tplane(4, 4, 0.1), mat(0x808080), 'plane', (o) => o.rotation.x = -Math.PI / 2);
  cfg = { sky: { zenith: [0.5, 0.5, 0.5], horizon: [0.5, 0.5, 0.5], glow: [0, 0, 0], glowDir: [0, 1, 0], ground: [0.5, 0.5, 0.5] },
    sun: { dir: [0, 1, 0], irr: [0.5 * Math.PI, 0.5 * Math.PI, 0.5 * Math.PI], radius: 0.001, bakeDirect: true } };
  camPresets = { room: [[0, 4, 5], [0, 0, 0]] };
} else {
  // ---------------------------------------------------------------- the room: W x H x D, window in the wall z = 0, outside is z < 0
  const W = 4, H = 2.6, D = 4.5, WIN = [1.2, 2.8, 0.8, 2.2], T = 0.25, ME = 0.08;
  const wallM = mat(0xd9d2c5), floorM = mat(0x8a6446, { roughness: 0.6 }), ceilM = mat(0xe6e2da);
  const O = 0;   // keep lit planes EXACT: vertices pushed past a wall sample the outside and glow along the seams
  add(tplane(W + O, D + O, ME), floorM, 'floor', (o) => { o.rotation.x = -Math.PI / 2; o.position.set(W / 2, 0, D / 2); });
  add(tplane(W + O, D + O, ME), ceilM, 'ceiling', (o) => { o.rotation.x = Math.PI / 2; o.position.set(W / 2, H, D / 2); });
  add(tplane(W + O, H + O, ME), wallM, 'back', (o) => { o.rotation.y = Math.PI; o.position.set(W / 2, H / 2, D); });
  add(tplane(D + O, H + O, ME), wallM, 'left', (o) => { o.rotation.y = Math.PI / 2; o.position.set(0, H / 2, D / 2); });
  add(tplane(D + O, H + O, ME), wallM, 'right', (o) => { o.rotation.y = -Math.PI / 2; o.position.set(W, H / 2, D / 2); });
  add(holePlane(W, H, WIN, ME), wallM, 'windowWall');                                                         // inner face, normal +z
  add(holePlane(W, H, WIN, 0.3), wallM, 'facade', (o) => { o.rotation.y = Math.PI; o.position.set(W, 0, -T); }); // outer face, normal -z
  // the reveal: four strips through the wall thickness (they are outside, z < 0: lit by the exterior sub-path)
  const rw = WIN[1] - WIN[0], rh = WIN[3] - WIN[2];
  add(tplane(rw, T, 0.05), wallM, 'sill', (o) => { o.rotation.x = -Math.PI / 2; o.position.set((WIN[0] + WIN[1]) / 2, WIN[2], -T / 2); });
  add(tplane(rw, T, 0.05), wallM, 'lintel', (o) => { o.rotation.x = Math.PI / 2; o.position.set((WIN[0] + WIN[1]) / 2, WIN[3], -T / 2); });
  add(tplane(T, rh, 0.05), wallM, 'jambL', (o) => { o.rotation.y = Math.PI / 2; o.position.set(WIN[0], (WIN[2] + WIN[3]) / 2, -T / 2); });
  add(tplane(T, rh, 0.05), wallM, 'jambR', (o) => { o.rotation.y = -Math.PI / 2; o.position.set(WIN[1], (WIN[2] + WIN[3]) / 2, -T / 2); });
  // light-tight shell behind the lit planes: hairline seams show black instead of sky, and the real-time sun can't leak
  // under thin walls. Not lit, not an occluder for the bake (the lit planes already close the room).
  const shellM = new THREE.MeshBasicMaterial({ color: 0x000000 });
  for (const [w, h, d, x, y, z] of [[W + 0.6, 0.2, D + 0.6, W / 2, -0.1 - 0.002, D / 2], [W + 0.6, 0.2, D + 0.6, W / 2, H + 0.1 + 0.002, D / 2],
    [0.2, H + 0.6, D + 0.6, -0.1 - 0.002, H / 2, D / 2], [0.2, H + 0.6, D + 0.6, W + 0.1 + 0.002, H / 2, D / 2], [W + 0.6, H + 0.6, 0.2, W / 2, H / 2, D + 0.1 + 0.002]]) {
    const o = add(new THREE.BoxGeometry(w, h, d), shellM, 'shell', (m) => m.position.set(x, y, z)); o.userData.gi = false; o.userData.bakeOccluder = false; o.receiveShadow = false;
  }
  // outside: lawn (also baked: it is part of the scene the light bounces off)
  add(tplane(30, 20, 0.5), mat(0x4f6b35), 'lawn', (o) => { o.rotation.x = -Math.PI / 2; o.position.set(W / 2, -0.001, -T - 10); });
  // furniture
  add(tbox(1.3, 0.05, 0.75, 0.04), mat(0xb08d62, { roughness: 0.5 }), 'tableTop', (o) => o.position.set(2.0, 0.75, 1.5));
  for (const [x, z] of [[1.42, 1.18], [2.58, 1.18], [1.42, 1.82], [2.58, 1.82]]) add(tbox(0.05, 0.725, 0.05, 0.04), mat(0x5a4632), 'leg', (o) => o.position.set(x, 0.3625, z));
  add(tbox(2.0, 0.8, 0.9, 0.06), mat(0xa8352c), 'sofa', (o) => o.position.set(2.0, 0.4, 3.95));
  add(new THREE.SphereGeometry(0.3, 48, 24), mat(0xf2f2f2), 'ball', (o) => o.position.set(0.8, 0.3, 2.7));
  add(tbox(0.6, 2.0, 0.45, 0.06), mat(0x2f5f8f), 'cabinet', (o) => o.position.set(3.65, 1.0, 2.9));

  const sunDir = new THREE.Vector3(-0.35, 0.55, -0.76).normalize(), irr = [3.4, 3.1, 2.7];
  cfg = {
    sky: { zenith: [0.32, 0.48, 0.95], horizon: [0.85, 0.95, 1.15], glow: [0, 0, 0], glowDir: [0, 1, 0], ground: [0.06, 0.07, 0.05] },
    portal: { x0: WIN[0], x1: WIN[1], y0: WIN[2], y1: WIN[3], z: 0, area: rw * rh },
    room: [0.0005, 0.0005, 0.0005, W - 0.0005, H - 0.0005, D - 0.0005],
    sun: { dir: sunDir.toArray(), irr, radius: 0.01, bakeDirect: false },
    maxDepth: 6,
  };
  // direct sun is real-time (sharp shadow map); everything else is baked. intensity == the bake's sun irradiance.
  sunLight = new THREE.DirectionalLight(new THREE.Color(irr[0], irr[1], irr[2]).multiplyScalar(1 / 3.4), 3.4);
  sunLight.position.copy(sunDir).multiplyScalar(8).add(new THREE.Vector3(2, 0, 1)); sunLight.target.position.set(2, 0, 1);
  sunLight.castShadow = true; sunLight.shadow.mapSize.set(4096, 4096);
  // normalBias > 0 lets the sun leak along every wall/floor seam (a bright hairline): keep it 0, use a tight frustum + small bias
  sunLight.shadow.bias = -0.0002; sunLight.shadow.normalBias = 0;
  Object.assign(sunLight.shadow.camera, { left: -3.5, right: 3.5, top: 3.5, bottom: -3.5, near: 4, far: 13 });
  scene.add(sunLight, sunLight.target);
  scene.background = new THREE.Color(0.85, 0.95, 1.15);
  camPresets = { room: [[0.55, 1.55, 4.25], [2.3, 0.9, 0.9]], window: [[2.0, 1.4, 3.3], [2.0, 1.2, 0]], corner: [[3.3, 2.3, 4.3], [1.2, 0.4, 1.0]] };
}

// ---------------------------------------------------------------- lighting: bake now / load / placeholder
const t0 = performance.now();
let bakeRes = null, info = {};
if (BAKE) {
  placeholderGi(root);
  const workers = +(Q.get('workers') || Math.max(2, (navigator.hardwareConcurrency || 8) - 2));
  bakeRes = await runBake(root, cfg, { spp: BAKE, workers, smooth: +(Q.get('smooth') ?? 2), log, onProgress: (l, p) => { document.title = `${l} ${(p * 100) | 0}%`; } });
  info = { secs: +bakeRes.secs.toFixed(1), samples: bakeRes.samples, tris: bakeRes.tris, spp: BAKE, workers };
} else {
  const r = await fetch('./' + (TEST ? 'furnace' : 'gi') + '.bin', { cache: 'no-store' }).catch(() => null);
  const res = r && r.ok ? applyBake(root, await r.arrayBuffer()) : { ok: false };
  if (!res.ok) { placeholderGi(root); log('no bake file — flat placeholder light. Run with ?bake=64'); } else log(`applied ${res.applied}, stale ${res.stale}`);
  info = res.meta || {};
}

// ---------------------------------------------------------------- stats
const meanE = (filter) => {   // mean baked value (irradiance / PI) over a mesh's vertices
  let s = 0, n = 0, mn = Infinity, mx = 0;
  root.traverse((o) => { if (!o.isMesh || !filter(o) || !o.geometry.attributes.gi) return; const a = o.geometry.attributes.gi.array; for (let i = 0; i < a.length; i += 3) { const l = (a[i] + a[i + 1] + a[i + 2]) / 3; s += l; n++; mn = Math.min(mn, l); mx = Math.max(mx, l); } });
  return n ? { mean: +(s / n).toFixed(3), min: +mn.toFixed(3), max: +mx.toFixed(3) } : null;
};
const stats = { ...info, ms: Math.round(performance.now() - t0) };
if (TEST === 'furnace') stats.plane = meanE((o) => o.name === 'plane');
else { stats.floor = meanE((o) => o.name === 'floor'); stats.ceiling = meanE((o) => o.name === 'ceiling'); stats.back = meanE((o) => o.name === 'back'); }

// ---------------------------------------------------------------- render
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = +(Q.get('exp') || (TEST ? 1 : 4.5));   // expose for the interior, like a camera: the window blows out
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
if (Q.get('view') === 'gi') root.traverse((o) => { if (o.isMesh && o.name !== 'shell') { o.material.map = null; o.material.color.set(0xffffff); o.material.needsUpdate = true; } });
if (!TEST) captureEnv(renderer, scene, new THREE.Vector3(2, 1.3, 2.2), new THREE.Vector3(0, 0, 0), new THREE.Vector3(4, 2.6, 4.5), 256);   // box-projected reflections of the lit room
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.02, 100);
const controls = new OrbitControls(camera, renderer.domElement);
const cp = camPresets[Q.get('cam')] || camPresets.room; camera.position.set(...cp[0]); controls.target.set(...cp[1]); controls.update();
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });

window.__gi = stats; window.__scene = scene;   // for debugging console.log('[gi]', JSON.stringify(stats)); stat.textContent += JSON.stringify(stats, null, 1);
document.getElementById('dl').onclick = () => {
  const buf = packBake(giMeshes(root), info);
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([buf])); a.download = TEST ? 'furnace.bin' : 'gi.bin'; a.click();
};
requestAnimationFrame(() => requestAnimationFrame(() => { document.body.dataset.ready = '1'; }));
