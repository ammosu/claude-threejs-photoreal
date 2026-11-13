// Demo scene for the film renderer: things that need each sub-frame effect.
//   AA: a fine checker floor and thin wires   DOF: spheres at many depths + a focus pull   motion blur: a spinning fan
//   HDR: an emissive bar far above SDR white
// Live preview: open the page (?t=2 freezes time). Film: render-film.mjs drives window.__film / __still.
import * as THREE from 'three';
import { Accumulator, shotList, applyShotCamera, ffStart, ffFrame, ffEnd, ffArgs } from '../accum.js';

const Q = new URLSearchParams(location.search);
// ---------------------------------------------------------------- scene (every moving thing is a pure function of t)
const scene = new THREE.Scene(); scene.background = new THREE.Color(0.02, 0.022, 0.03);
const floorTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d'); for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { g.fillStyle = (x + y) & 1 ? '#d8d4cc' : '#2a2a2e'; g.fillRect(x * 32, y * 32, 32, 32); } const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(10, 10); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; })();
const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.6 })); floor.receiveShadow = true; scene.add(floor);
const cols = [0xc8463c, 0xe0b040, 0x3c8c5a, 0x3c6ec8, 0x9a4cc0, 0xe8e8e8];
for (let i = 0; i < 12; i++) {
  const s = new THREE.Mesh(new THREE.SphereGeometry(0.35, 48, 24), new THREE.MeshStandardMaterial({ color: cols[i % 6], roughness: 0.25, metalness: i % 3 === 0 ? 0.8 : 0 }));
  s.position.set(-1.2 + (i % 2) * 2.4, 0.35, 2 - i * 1.3); s.castShadow = true; scene.add(s);
}
for (let i = 0; i < 24; i++) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 3, 6), new THREE.MeshStandardMaterial({ color: 0x111111 })); w.position.set(-3 + i * 0.25, 1.5, -3); scene.add(w); }   // thin wires
const fan = new THREE.Group(); fan.position.set(0.2, 0.9, -1.5); scene.add(fan);
for (let i = 0; i < 4; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.7, 0.02), new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.4 })); b.position.y = 0.35; const piv = new THREE.Group(); piv.rotation.z = (i * Math.PI) / 2; piv.add(b); fan.add(piv); b.castShadow = true; }
const bar = new THREE.Mesh(new THREE.BoxGeometry(3, 0.05, 0.05), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 5.2, 4) })); bar.position.set(0, 2.2, -4); scene.add(bar);   // 6x SDR white
const sun = new THREE.DirectionalLight(0xfff0e0, 2.5); sun.position.set(-3, 6, 4); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8 }); scene.add(sun, new THREE.HemisphereLight(0x9fb4d8, 0x2a2420, 0.6));
const setWorld = (t) => { fan.rotation.z = -t * 9; };            // 9 rad/s: the blades smear in a 1/60 s shutter

// ---------------------------------------------------------------- shots: camera keys, lens (ap = radius in mm), sub-frames
const FILM = shotList([
  { name: 'dolly', dur: 3, samples: 32, keys: [
    { pos: [3.2, 1.2, 3.6], target: [0, 0.6, -1.5], fov: 40, focus: [0.2, 0.9, -1.5], ap: 14 },
    { pos: [2.2, 1.0, 2.6], target: [0, 0.7, -1.5], fov: 40, focus: [0.2, 0.9, -1.5], ap: 14 } ] },
  { name: 'pull', dur: 3, samples: 64, exp: 1.2, keys: [
    { pos: [-0.2, 0.5, 3.4], target: [0, 0.4, -6], fov: 32, focus: [-1.2, 0.35, 2.0], ap: 35 },
    { pos: [-0.1, 0.5, 3.3], target: [0, 0.4, -6], fov: 32, focus: [1.2, 0.35, -6.4], ap: 35 } ] },
], { fadeIn: 0.6, fadeOut: 0.8 });

const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });   // AA comes from the jitter
renderer.setPixelRatio(1); renderer.setSize(innerWidth, innerHeight); renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.05, 100);
const acc = new Accumulator(renderer, scene, camera);
let focus = 3, aperture = 0, exp = 1, fade = 1;
const onTime = (t) => { setWorld(t); const st = FILM.at(Math.min(t, FILM.total - 1e-4)); focus = applyShotCamera(camera, st); aperture = st.ap / 1000; exp = st.exp; fade = st.fade; };

// ---------------------------------------------------------------- page contract for render-film.mjs
window.__filmRanges = (fps) => FILM.ranges(fps);
window.__still = async (t, { w = 1280, h = 720, samples = 16 } = {}) => {
  renderer.setSize(w, h, false); camera.aspect = w / h; acc.setSize(w, h);
  onTime(t); acc.accumulate({ t, n: samples, onTime, shutter: 0.5 / 30, aperture, focus });
  acc.present('screen', { exposure: exp, fade }); renderer.getContext().finish();
};
window.__film = async ({ w, h, fps = 30, samples = 16, shot, from, to, out = 'out/film', hdr = true, sdr = true }) => {
  camera.aspect = w / h; acc.setSize(w, h);
  const r = FILM.ranges(fps)[shot], a = Math.max(r.from, from ?? r.from), b = Math.min(r.to, to ?? r.to);
  const tag = String(shot + 1).padStart(2, '0') + '_' + r.name + '_' + String(a).padStart(5, '0');
  const n = Math.max(4, Math.round(((FILM.shots[shot].samples || 16) * samples) / 16));   // per-shot weight: shallow focus needs more
  if (hdr) await ffStart('hdr', ffArgs('hdr', { w, h, fps, file: `${out}_${tag}_hdr.mp4` }));
  if (sdr) await ffStart('sdr', ffArgs('sdr', { w, h, fps, file: `${out}_${tag}_sdr.mp4` }));
  const T = { render: 0, read: 0, send: 0 }, t0 = performance.now(); let tm;
  const tick = (k) => { const now = performance.now(); T[k] += now - tm; tm = now; };
  let hb = null, sb = null;
  for (let f = a; f < b; f++) {
    const t = f / fps + 1e-4; tm = performance.now();
    onTime(t); acc.accumulate({ t, n, onTime, shutter: 0.5 / fps, aperture, focus });   // 180° shutter
    tick('render');
    if (hdr) { acc.present('hdr', { exposure: exp, fade }); hb = acc.read('hdr', hb); }
    if (sdr) { acc.present('sdr', { exposure: exp, fade }); sb = acc.read('sdr', sb); }
    tick('read');
    await Promise.all([hdr ? ffFrame('hdr', f, hb) : 0, sdr ? ffFrame('sdr', f, sb) : 0]);
    if (window.gc) window.gc();
    tick('send');
    window.__filmProgress = { frame: f, at: Date.now() };
    if ((f - a) % 15 === 0) console.log(`[film] ${tag} frame ${f - a + 1}/${b - a}  ${((performance.now() - t0) / 1000 / (f - a + 1)).toFixed(2)} s/frame`);
  }
  const res = { tag, frames: b - a, samples: n };
  if (hdr) res.hdr = (await ffEnd('hdr')).code;
  if (sdr) res.sdr = (await ffEnd('sdr')).code;
  for (const k in T) T[k] = +(T[k] / Math.max(1, b - a) / 1000).toFixed(3);
  res.stages = T;
  return res;
};

// ---------------------------------------------------------------- live preview (not used by the film)
if (!navigator.webdriver || Q.has('preview')) {
  const fix = Q.has('t') ? +Q.get('t') : null, T0 = performance.now();
  acc.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight;
  renderer.setAnimationLoop(() => { const t = fix ?? ((performance.now() - T0) / 1000) % FILM.total; onTime(t); acc.accumulate({ t, n: 1, onTime }); acc.present('screen', { exposure: exp, fade }); });
}
window.__ready = true;
