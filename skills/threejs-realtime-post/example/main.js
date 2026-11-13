// A room with a window into a sunny garden: the case real-time post has to get right — bright outside, dim inside,
// contact shadows in corners and under furniture, a lamp and the window glowing a little, foliage green.
// ?post=three  plain three.js (ACES on the canvas) for comparison    ?ao=0  ?bloom=0  ?ext=1 (outside not balanced)  ?grade=0
// ?cam=room|corner|window   ?res=adaptive  hold 60 fps by scaling the internal resolution   ?ui=0
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Post, AdaptiveRes, LOOKS } from '../scripts/post.js';

const Q = new URLSearchParams(location.search), MODE = Q.get('post') || 'ours', CAM = Q.get('cam') || 'room';
const renderer = new THREE.WebGLRenderer({ antialias: MODE === 'three', preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(innerWidth, innerHeight, false);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(3.2, 3.6, 4.4);            // scene-linear sky: ~4x brighter than a white wall in the sun

// ---------------------------------------------------------------- room 4 x 3 x 2.6 m, window in the back wall (z = -1.5)
const M = (c, r = 0.85, extra = {}) => new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(...c, THREE.SRGBColorSpace), roughness: r, ...extra });
const add = (g, m, x, y, z) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; scene.add(o); return o; };
const wall = M([0.86, 0.85, 0.82], 0.92), floor = M([0.55, 0.42, 0.3], 0.55);
add(new THREE.BoxGeometry(4, 0.1, 3), floor, 0, -0.05, 0);
add(new THREE.BoxGeometry(4, 0.1, 3), wall, 0, 2.65, 0);
add(new THREE.BoxGeometry(0.1, 2.6, 3), wall, -2.05, 1.3, 0); add(new THREE.BoxGeometry(0.1, 2.6, 3), wall, 2.05, 1.3, 0);
add(new THREE.BoxGeometry(4.2, 2.6, 0.1), wall, 0, 1.3, 1.55);
// back wall with a 1.6 x 1.3 m opening, sill at 0.9 m
for (const [w, h, x, y] of [[4.2, 0.9, 0, 0.45], [4.2, 0.4, 0, 2.4], [1.3, 1.3, -1.45, 1.55], [1.3, 1.3, 1.45, 1.55]]) add(new THREE.BoxGeometry(w, h, 0.2), wall, x, y, -1.6);
add(new THREE.BoxGeometry(1.7, 0.04, 0.3), M([0.92, 0.92, 0.9], 0.4), 0, 0.92, -1.5);
// furniture: sofa, low table, bookcase, floor lamp, a plant
const fabric = M([0.42, 0.47, 0.52], 0.95);
add(new RoundedBoxGeometry(1.8, 0.42, 0.85, 3, 0.06), fabric, -0.6, 0.21, 0.9);
add(new RoundedBoxGeometry(1.8, 0.5, 0.22, 3, 0.06), fabric, -0.6, 0.6, 1.26);
for (const x of [-1.42, 0.22]) add(new RoundedBoxGeometry(0.2, 0.3, 0.85, 3, 0.06), fabric, x, 0.55, 0.9);
for (let i = 0; i < 3; i++) add(new RoundedBoxGeometry(0.45, 0.4, 0.14, 3, 0.05), M([[0.78, 0.62, 0.42], [0.88, 0.86, 0.8], [0.62, 0.32, 0.26]][i], 0.97), -1.15 + i * 0.5, 0.62, 1.08).rotation.x = -0.25;
const oak = M([0.62, 0.45, 0.3], 0.5);
add(new RoundedBoxGeometry(1.0, 0.04, 0.55, 2, 0.01), oak, -0.5, 0.4, 0.05);
for (const [x, z] of [[-0.95, -0.17], [-0.05, -0.17], [-0.95, 0.27], [-0.05, 0.27]]) add(new THREE.CylinderGeometry(0.018, 0.014, 0.38, 12), oak, x, 0.19, z);
add(new THREE.CylinderGeometry(0.05, 0.04, 0.1, 24), M([0.85, 0.82, 0.76], 0.25), -0.7, 0.47, 0.1);
const shelf = M([0.9, 0.9, 0.88], 0.6);
for (let k = 0; k < 5; k++) add(new THREE.BoxGeometry(0.9, 0.025, 0.32), shelf, 1.5, 0.02 + k * 0.45, 0.2);
for (const x of [1.06, 1.94]) add(new THREE.BoxGeometry(0.025, 1.84, 0.32), shelf, x, 0.92, 0.2);
const rng = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
for (let k = 0; k < 4; k++) { let x = 1.1; while (x < 1.85) { const t = 0.02 + rng() * 0.03, h = 0.18 + rng() * 0.1; add(new THREE.BoxGeometry(t, h, 0.2), M([0.2 + rng() * 0.6, 0.2 + rng() * 0.5, 0.2 + rng() * 0.5], 0.7), x + t / 2, 0.035 + k * 0.45 + h / 2, 0.24); x += t + 0.004; if (rng() < 0.12) x += 0.08; } }
// floor lamp: emissive shade far above SDR white -> it blooms
add(new THREE.CylinderGeometry(0.012, 0.012, 1.5, 12), M([0.1, 0.1, 0.1], 0.4, { metalness: 0.8 }), -1.45, 0.75, 0.2);
const shade = add(new THREE.CylinderGeometry(0.16, 0.22, 0.28, 32, 1, true), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: new THREE.Color(1, 0.75, 0.45), emissiveIntensity: 3, side: THREE.DoubleSide }), -1.45, 1.55, 0.2);
shade.castShadow = false;
const bulb = new THREE.PointLight(0xffc890, 1.2, 6, 2); bulb.position.set(-1.45, 1.5, 0.2); scene.add(bulb);
// plant in the corner (greens: the vibrance control lifts these)
add(new THREE.CylinderGeometry(0.16, 0.12, 0.34, 24), M([0.75, 0.42, 0.3], 0.8), -1.65, 0.17, -1.05);
for (let i = 0; i < 26; i++) { const a = i * 2.4, rr = 0.08 + (i % 5) * 0.035; add(new THREE.SphereGeometry(0.09 + (i % 3) * 0.02, 12, 8).scale(1, 0.45, 1), M([0.24, 0.42 + (i % 4) * 0.05, 0.18], 0.6), -1.65 + Math.cos(a) * rr, 0.42 + (i / 26) * 0.75, -1.05 + Math.sin(a) * rr); }

// ---------------------------------------------------------------- outside: lawn, hedge, trees in full sun (everything z < -1.75)
add(new THREE.PlaneGeometry(40, 30).rotateX(-Math.PI / 2), M([0.33, 0.5, 0.22], 0.95), 0, -0.3, -16);
for (let i = 0; i < 9; i++) add(new THREE.SphereGeometry(1.2 + (i % 3) * 0.5, 16, 12), M([0.2, 0.4 + (i % 3) * 0.05, 0.16], 0.9), -8 + i * 2.1, 1.2 + (i % 2), -9 - (i % 3) * 2);
add(new THREE.BoxGeometry(14, 1.1, 0.8), M([0.18, 0.34, 0.14], 0.95), 0, 0.25, -5);
const sun = new THREE.DirectionalLight(0xfff0d8, 9); sun.position.set(-2.5, 5, -7); sun.target.position.set(0.3, 0, 0.4);
sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096); Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 30 }); sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target, new THREE.HemisphereLight(0xbcd0ff, 0x6a5038, 0.7));
const sky = new THREE.HemisphereLight(0xd6e4ff, 0x000000, 0.0); scene.add(sky);

// ---------------------------------------------------------------- camera + output
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.05, 80);
const CAMS = { room: [[1.75, 1.5, 1.35], [-0.5, 0.8, -0.5]], corner: [[-0.6, 0.75, 0.0], [-1.7, 0.55, -1.2]], window: [[0.3, 1.3, 0.8], [0, 1.4, -1.5]] };
const [cp, ct] = CAMS[CAM] || CAMS.room; camera.position.set(...cp);
const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(...ct); controls.update();

let post = null;
const look = { ...(LOOKS[Q.get('look')] || {}), exposure: 1.3 };
if (Q.get('ao') === '0') look.ao = 0;
if (Q.get('bloom') === '0') look.bloom = 0;
look.ext = Q.get('ext') === '1' ? 1 : 0.35;               // pull the garden down like a phone's HDR merge
if (Q.get('grade') === '0') Object.assign(look, LOOKS.flat);
if (MODE === 'three') { renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = look.exposure; renderer.outputColorSpace = THREE.SRGBColorSpace; }
else post = new Post(renderer, { ext: 'wp.z < -1.75' }).setLook(look);
const resize = (w, h) => { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); if (post) post.setSize(w, h, { msaa: 4 }); };
const adaptive = Q.get('res') === 'adaptive' ? new AdaptiveRes(resize, Q.has('slow') ? { slowMs: +Q.get('slow') } : {}) : null;   // ?slow=0 forces it to scale down (test)
if (!adaptive) { resize(innerWidth, innerHeight); addEventListener('resize', () => resize(innerWidth, innerHeight)); }

// ---------------------------------------------------------------- loop + timing (CPU-side frame time incl. gl.finish every 30th frame)
const times = []; let last = performance.now(), n = 0;
const draw = () => { controls.update(); if (post) post.render(scene, camera); else renderer.render(scene, camera); };
renderer.setAnimationLoop(() => {
  const now = performance.now(), dt = (now - last) / 1000; last = now;
  const t0 = performance.now(); draw(); let work = null;
  if (++n % 30 === 0) { renderer.getContext().finish(); work = performance.now() - t0; times.push(work); }
  if (adaptive) adaptive.tick(dt, work);
  if (n === (adaptive ? 600 : 240)) {
    times.sort((a, b) => a - b);
    window.__post = { mode: MODE, size: [renderer.domElement.width, renderer.domElement.height], frameMsMedian: +times[times.length >> 1].toFixed(2), scale: adaptive ? +adaptive.scale.toFixed(2) : 1 };
    document.getElementById('stats').textContent = JSON.stringify(window.__post);
    document.body.dataset.ready = '1';
  }
});
if (Q.get('ui') === '0') document.getElementById('ui').style.display = 'none';
