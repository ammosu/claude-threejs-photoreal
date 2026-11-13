// A table with a few things on it, a chair with a towel thrown over its back, a bookcase. Shows how the skills meet:
// textures (threejs-procedural-textures), drape + props (threejs-lived-in-props), all lit by the bake.
import * as THREE from 'three';
import { TABLE, CHAIR, SHELF, SEED } from '../layout.js';
import { lit, solid, tbox, metres } from '../materials.js';
import { oakVeneer, rep } from '../lib/textures/index.js';
import { terryNormal, fabricMaterial, makeBook, bookAtlas, bookGeometry, pagesTexture } from '../lib/textures/index.js';
import { RNG, merge, surfacePoints, drapeCloth, overBar, refine, thickCloth, mug, bottle, fbm2 } from '../lib/props/props.js';

export const order = 20;
export const label = 'furniture';

export function build(ctx) {
  const g = new THREE.Group(); g.name = 'furniture';
  const add = (geo, m, name) => { const o = new THREE.Mesh(geo, m); o.name = name; o.castShadow = o.receiveShadow = true; g.add(o); return o; };
  const oak = oakVeneer();
  const wood = (ox, oy) => lit(new THREE.MeshStandardMaterial({ map: rep(oak.map, oak.map.repeat.x, oak.map.repeat.y, ox, oy), normalMap: rep(oak.normalMap, oak.normalMap.repeat.x, oak.normalMap.repeat.y, ox, oy), roughnessMap: rep(oak.roughnessMap, oak.roughnessMap.repeat.x, oak.roughnessMap.repeat.y, ox, oy), roughness: 1 }), { albedo: oak.avg, key: 'oak' + ox });
  // ---- table: top tessellated to 2 cm (things stand on it: contact shadows live on its vertices)
  const T = TABLE;
  add(metres(tbox(T.w, 0.03, T.d, 0.02), T.w, T.d).translate(T.x, T.top - 0.015, T.z), wood(0.11, 0.07), 'tableTop');
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) add(tbox(0.045, T.top - 0.03, 0.045, 0.05).translate(T.x + sx * (T.w / 2 - 0.06), (T.top - 0.03) / 2, T.z + sz * (T.d / 2 - 0.06)), wood(0.4, 0.3), 'tableLeg');
  // ---- chair (its meshes are also the collider for the towel)
  const C = CHAIR, chairWood = solid([0.42, 0.28, 0.17], 0.55), parts = [];   // the back rail is on the +z side
  const part = (geo, name) => { const o = add(geo, chairWood, name); parts.push(o); return o; };
  part(tbox(0.44, 0.03, 0.4, 0.03).translate(C.x, 0.45, C.z - 0.01), 'chairSeat');
  for (const [dx, dz, h] of [[-0.19, -0.18, 0.45], [0.19, -0.18, 0.45], [-0.19, 0.18, 0.88], [0.19, 0.18, 0.88]]) part(tbox(0.03, h, 0.03, 0.04).translate(C.x + dx, h / 2, C.z + dz), 'chairLeg');
  part(tbox(0.44, 0.07, 0.03, 0.03).translate(C.x, 0.86, C.z + 0.18), 'chairRail');
  part(tbox(0.4, 0.04, 0.022, 0.03).translate(C.x, 0.66, C.z + 0.18), 'chairSlat');
  const D = 0.015, TW = 27, TH = 61;
  const res = drapeCloth({ W: TW, H: TH, D, collider: surfacePoints(parts, 0.007), floor: 0.004, ...overBar({ cx: C.x + 0.02, top: 0.895, cz: C.z + 0.18, W: TW, D, fold: 26, skew: 0.12, gather: 0.85 }) });
  ctx.stats.towel = res.stats;
  const R = refine(res.P, TW, TH);
  const towelM = lit(fabricMaterial(0xb5806b, { normal: terryNormal(), tileM: 0.05, nscale: 1.0, sheen: 0.6, rough: 1 }), { key: 'towel' }); towelM.vertexColors = true;
  add(thickCloth(R.P, R.W, R.H, { th: () => 0.005, uv: (i, j) => [(i * D) / 2, (j * D) / 2], shade: (i, j) => 0.95 + 0.08 * fbm2(i * 0.05, j * 0.05, 2, 3) }), towelM, 'towel');
  // ---- on the table: mug with tea marks, steel bottle, two books
  const m4 = new THREE.Matrix4().makeRotationY(-0.9).setPosition(T.x + 0.25, T.top, T.z + 0.1), mg = mug();
  add(mg.body.applyMatrix4(m4), solid([1, 1, 1], 0.13, { vertexColors: true }), 'mug'); add(mg.tea.applyMatrix4(m4), solid([0.32, 0.18, 0.08], 0.05), 'tea');
  const b4 = new THREE.Matrix4().makeRotationY(0.7).setPosition(T.x + 0.42, T.top, T.z - 0.15), bt = bottle();
  add(bt.coat.applyMatrix4(b4), solid([0.33, 0.42, 0.46], 0.55), 'bottle'); add(bt.steel.applyMatrix4(b4), solid([0.8, 0.8, 0.8], 0.25, { metalness: 1 }), 'bottleSteel'); add(bt.loop.applyMatrix4(b4), solid([0.12, 0.12, 0.13], 0.7), 'bottleLoop');
  // ---- books: one atlas for every cover in the room
  const r = new RNG(SEED + 7);
  const lying = [makeBook(r, 0.165, 0.235, 0.032, 0, { hard: true, full: true, style: 1, cover: 0 }), makeBook(r, 0.14, 0.208, 0.027, 8, { hard: true, full: true, cover: 1 })];
  const shelfRows = SHELF.y.map(() => Array.from({ length: 8 + r.int(0, 5) }, (_, i) => makeBook(r, r.range(0.12, 0.155), r.range(0.18, 0.236), r.range(0.016, 0.034), r.int(0, 13), { hard: i % 3 === 1 })));
  const atlas = bookAtlas([...lying, ...shelfRows.flat()], { seed: SEED, H: 2048 });
  const coverM = lit(new THREE.MeshStandardMaterial({ map: atlas.tex, roughness: 0.6 }), { albedo: atlas.avg, key: 'covers' });
  const pagesM = lit(new THREE.MeshStandardMaterial({ map: pagesTexture(), roughness: 0.9 }), { albedo: [0.72, 0.69, 0.6], key: 'pages' });
  const covers = [], pages = [];
  const place = (b, mm) => { const q = bookGeometry(b, atlas); covers.push(merge(q.covers).applyMatrix4(mm)); pages.push(q.pages.applyMatrix4(mm)); };
  let y = T.top;
  lying.forEach((b, i) => { place(b, new THREE.Matrix4().makeRotationY(Math.PI / 2 + (i ? 0.08 : -0.05)).setPosition(T.x - 0.35, y, T.z + 0.05)); y += b.t; });
  // ---- bookcase against the right wall (x = W), books standing spines out (towards -x)
  const S = SHELF, sh = solid([0.9, 0.9, 0.88], 0.55), len = S.z1 - S.z0;
  for (const yy of [0.02, ...S.y]) add(tbox(S.x1 - S.x0, 0.022, len, 0.03).translate((S.x0 + S.x1) / 2, yy, (S.z0 + S.z1) / 2), sh, 'shelf');
  for (const zz of [S.z0, S.z1]) add(tbox(S.x1 - S.x0, S.y[S.y.length - 1] + 0.3, 0.02, 0.05).translate((S.x0 + S.x1) / 2, (S.y[S.y.length - 1] + 0.3) / 2, zz), sh, 'shelfSide');
  S.y.forEach((yy, k) => {
    let zc = S.z0 + 0.02;
    for (const b of shelfRows[k]) {
      if (zc + b.t > S.z1 - 0.02) break;
      // book local frame: spine at x = 0 facing -x, height along z, thickness +y. Rx(-90°): height -> +y, thickness -> -z
      const mm = new THREE.Matrix4().makeRotationX(-Math.PI / 2).setPosition(S.x0 + 0.015, yy + 0.011 + b.h / 2, zc + b.t);
      place(b, mm); zc += b.t + 0.002;
    }
  });
  add(merge(covers), coverM, 'bookCovers'); add(merge(pages), pagesM, 'bookPages');
  return g;
}
