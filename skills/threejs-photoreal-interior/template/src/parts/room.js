// The shell: floor, ceiling, four walls, the window opening with its reveal, a sill, a light-tight black shell behind
// everything, and a lawn outside. Rules (threejs-baked-gi/references/scene-rules.md): lit planes meet EXACTLY (no
// overlap: vertices outside the room sample the sky and glow along seams), tessellated, outside is z < 0.
import * as THREE from 'three';
import { ROOM } from '../layout.js';
import { lit, solid, tplane, metres } from '../materials.js';
import { floorMaps, wallNormal, wallPatch } from '../lib/textures/surfaces.js';

export const order = 0;
export const label = 'room';

/** Plane in XY (normal +Z), w x h, with a rectangular hole; hole edges fall on grid lines so the opening is crisp. */
function holePlane(w, h, hole, me) {
  const axis = (len, a, b) => { const cuts = [0, a, b, len], out = []; for (let k = 0; k < 3; k++) { const n = Math.max(1, Math.ceil((cuts[k + 1] - cuts[k]) / me)); for (let i = 0; i < n; i++) out.push(cuts[k] + ((cuts[k + 1] - cuts[k]) * i) / n); } out.push(len); return out; };
  const xs = axis(w, hole[0], hole[1]), ys = axis(h, hole[2], hole[3]), pos = [], uv = [], idx = [], nx = xs.length;
  for (const y of ys) for (const x of xs) { pos.push(x, y, 0); uv.push(x, y); }
  for (let j = 0; j < ys.length - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const cx = (xs[i] + xs[i + 1]) / 2, cy = (ys[j] + ys[j + 1]) / 2;
    if (cx > hole[0] && cx < hole[1] && cy > hole[2] && cy < hole[3]) continue;
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1; idx.push(a, b, d, a, d, c);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); return g;
}

export function build(ctx) {
  const { W, D, H, wallT: T, win } = ROOM, g = new THREE.Group(); g.name = 'room';
  const add = (geo, m, name, f) => { const o = new THREE.Mesh(geo, m); o.name = name; f && f(o); o.castShadow = o.receiveShadow = true; g.add(o); return o; };
  const fl = floorMaps();
  const floorM = lit(new THREE.MeshStandardMaterial({ map: fl.map, normalMap: fl.normalMap, roughnessMap: fl.roughnessMap, roughness: 1 }), { albedo: fl.avg });
  const paint = [0.86, 0.85, 0.82].map((c) => c ** 2.2);
  const wallM = lit(wallPatch(new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.86, 0.85, 0.82, THREE.SRGBColorSpace), roughness: 0.93, normalMap: wallNormal() })), { albedo: paint });
  const ceilM = lit(wallPatch(new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.92, 0.92, 0.91, THREE.SRGBColorSpace), roughness: 0.95, normalMap: wallNormal() }), { off: [0.37, 0.61] }));
  const ME = 0.08;
  add(metres(tplane(W, D, ME), W, D), floorM, 'floor', (o) => { o.rotation.x = -Math.PI / 2; o.position.set(W / 2, 0, D / 2); });
  add(metres(tplane(W, D, ME), W, D), ceilM, 'ceiling', (o) => { o.rotation.x = Math.PI / 2; o.position.set(W / 2, H, D / 2); });
  add(metres(tplane(W, H, ME), W, H), wallM, 'back', (o) => { o.rotation.y = Math.PI; o.position.set(W / 2, H / 2, D); });
  add(metres(tplane(D, H, ME), D, H), wallM, 'left', (o) => { o.rotation.y = Math.PI / 2; o.position.set(0, H / 2, D / 2); });
  add(metres(tplane(D, H, ME), D, H), wallM, 'right', (o) => { o.rotation.y = -Math.PI / 2; o.position.set(W, H / 2, D / 2); });
  const WIN = [win.x0, win.x1, win.y0, win.y1];
  add(holePlane(W, H, WIN, ME), wallM, 'windowWall');
  add(holePlane(W, H, WIN, 0.3), wallM, 'facade', (o) => { o.rotation.y = Math.PI; o.position.set(W, 0, -T); });
  const rw = win.x1 - win.x0, rh = win.y1 - win.y0, sillM = solid([0.9, 0.9, 0.88], 0.4);
  add(tplane(rw, T, 0.04), sillM, 'sill', (o) => { o.rotation.x = -Math.PI / 2; o.position.set((win.x0 + win.x1) / 2, win.y0, -T / 2); });
  add(tplane(rw, T, 0.05), wallM, 'lintel', (o) => { o.rotation.x = Math.PI / 2; o.position.set((win.x0 + win.x1) / 2, win.y1, -T / 2); });
  add(tplane(T, rh, 0.05), wallM, 'jambL', (o) => { o.rotation.y = Math.PI / 2; o.position.set(win.x0, (win.y0 + win.y1) / 2, -T / 2); });
  add(tplane(T, rh, 0.05), wallM, 'jambR', (o) => { o.rotation.y = -Math.PI / 2; o.position.set(win.x1, (win.y0 + win.y1) / 2, -T / 2); });
  // light-tight shell: hairline seams show black instead of sky; not lit, not a bake occluder
  // shadowSide FrontSide: three draws only BACK faces into the shadow map by default, i.e. the face 2 mm from the floor
  // -> the shadow bias swallows that gap and the sun leaks a dotted line along every seam. Front faces are 25 cm away.
  const shellM = new THREE.MeshBasicMaterial({ color: 0x000000 }); shellM.shadowSide = THREE.FrontSide;
  for (const [w, h, d, x, y, z] of [[W + 0.6, 0.2, D + 0.6, W / 2, -0.102, D / 2], [W + 0.6, 0.2, D + 0.6, W / 2, H + 0.102, D / 2], [0.2, H + 0.6, D + 0.6, -0.102, H / 2, D / 2], [0.2, H + 0.6, D + 0.6, W + 0.102, H / 2, D / 2], [W + 0.6, H + 0.6, 0.2, W / 2, H / 2, D + 0.102]]) {
    const o = add(new THREE.BoxGeometry(w, h, d), shellM, 'shell', (m) => m.position.set(x, y, z)); o.userData.gi = false; o.userData.bakeOccluder = false; o.receiveShadow = false;
  }
  // solid core of the window wall (between its inner and outer face, around the opening): the real-time sun's shadow
  // map sees two paper-thin planes otherwise and leaks a dotted line of light along the floor and corner seams
  const e = 0.004;   // kept clear of the reveal planes (coplanar faces z-fight)
  for (const [x0, x1, y0, y1] of [[-0.2, W + 0.2, -0.2, win.y0 - e], [-0.2, W + 0.2, win.y1 + e, H + 0.2], [-0.2, win.x0 - e, win.y0 - e, win.y1 + e], [win.x1 + e, W + 0.2, win.y0 - e, win.y1 + e]]) {
    const o = add(new THREE.BoxGeometry(x1 - x0, y1 - y0, T - 0.004), shellM, 'wallCore', (m) => m.position.set((x0 + x1) / 2, (y0 + y1) / 2, -T / 2));
    o.userData.gi = false; o.userData.bakeOccluder = false; o.receiveShadow = false;
  }
  add(tplane(30, 20, 0.5), solid([0.3, 0.42, 0.2], 0.95), 'lawn', (o) => { o.rotation.x = -Math.PI / 2; o.position.set(W / 2, -0.001, -T - 10); });
  ctx.colliders.push({ min: [0, 0, 0], max: [W, H, D], inside: true });
  return g;
}
