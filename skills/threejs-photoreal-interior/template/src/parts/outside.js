// The view out of the window: the sky dome, a lawn, a gravel path, a hedge, neighbour houses, trees and a far wall of
// crowns (threejs-sky-backdrop + threejs-procedural-vegetation). Only what the room can see is built in full
// (windowVisibility -> tree LOD). Outside is NOT part of the light bake (gi = false, not an occluder): it is lit by the
// real-time sun plus an outdoor sky ambient patched into its own materials — a HemisphereLight would also add light
// to the baked room (the GI patch adds its light on top of the scene's lights).
import * as THREE from 'three';
import { ROOM, OUTSIDE, SKY_PRESET as S, SEED } from '../layout.js';
import { skyDome, skyRadiance, SKY_U } from '../lib/sky/sky.js';
import { RNG, windowVisibility, hazePatch, grassTexture, roofTexture, windowTexture, crownTexture, houses, lawn, gravelPath, hedge, crownWall } from '../lib/sky/backdrop.js';
import { buildAtlas, barkMaps } from '../lib/vegetation/atlas.js';
import { Bark, Leaves, makeTree } from '../lib/vegetation/tree.js';
import { U, barkMaterial, leafMaterial } from '../lib/vegetation/materials.js';

export const order = 50;            // after the baked parts: adding it does not shift their slots in gi.bin
export const label = 'outside';

/** Outdoor ambient: irradiance from the sky (zenith above, ground below) added to a material outside the room. */
function skyAmbient(m, up, down) {
  const prev = Object.prototype.hasOwnProperty.call(m, 'onBeforeCompile') ? m.onBeforeCompile : null;
  const v = (c) => `vec3(${c.map((x) => x.toFixed(4)).join(',')})`;
  m.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
      { vec3 wn = inverseTransformDirection( normal, viewMatrix ); irradiance += mix( ${v(down)}, ${v(up)}, 0.5 + 0.5 * wn.y ) * PI; }`);
  };
  const pk = Object.prototype.hasOwnProperty.call(m, 'customProgramCacheKey') ? m.customProgramCacheKey() : '';
  m.customProgramCacheKey = () => 'skyAmb|' + pk;
  return m;
}

export function build(ctx) {
  const g = new THREE.Group(); g.name = 'outside';
  const { win, wallT, W, D } = ROOM;
  const mark = (o) => { o.userData.gi = false; o.userData.bakeOccluder = false; return o; };
  const add = (geo, m, name) => { const o = mark(new THREE.Mesh(geo, m)); o.name = name; o.castShadow = o.receiveShadow = true; g.add(o); return o; };
  // sky: shown at its true brightness — the post's `ext` pulls the whole view out of the window down together
  g.add(skyDome(S, { display: 1 }));
  // outdoor light from the same preset: cos-weighted sky average above, ground below (scaled like an overcast fill)
  const up = [0, 1, 2].map((k) => (skyRadiance(S, [0, 1, 0])[k] + skyRadiance(S, [0.7, 0.3, 0])[k] * 2) / 3 * 0.85);
  const down = S.ground.map((c, k) => c + 0.12 * [0.3, 0.42, 0.2][k]);
  const hz = skyRadiance(S, [0, 0.02, -1]).map((c) => c * 0.8);
  const ext = (params) => hazePatch(skyAmbient(new THREE.MeshStandardMaterial({ roughness: 1, ...params }), up, down), { color: hz, start: 12, density: 0.006 });
  const sc = (r, gg, b) => new THREE.Color().setRGB(r, gg, b, THREE.SRGBColorSpace);

  // ground, path, hedge, houses, far crowns
  const grass = grassTexture(); grass.repeat.set(1, 1);
  add(lawn({ ground: -0.002, z1: -wallT - 0.01, seed: 3 }), ext({ map: grass, vertexColors: true }), 'lawn');
  add(gravelPath(OUTSIDE.pathZ, { ground: -0.002 }), ext({ color: sc(0.45, 0.43, 0.39), vertexColors: true }), 'path');
  add(hedge((x) => OUTSIDE.pathZ(x) - 2.1, { ground: 0 }), ext({ color: sc(0.22, 0.32, 0.14) }), 'hedge');
  const H = houses(OUTSIDE.houses, { ground: 0, seed: SEED % 97 });
  add(H.wall, ext({ color: sc(0.87, 0.86, 0.83), roughness: 0.95 }), 'houseWalls'); add(H.roof, ext({ map: roofTexture(), roughness: 0.9 }), 'houseRoofs');
  add(H.trim, ext({ color: sc(0.82, 0.82, 0.8) }), 'houseTrim'); add(H.win, ext({ map: windowTexture(), roughness: 0.6 }), 'houseWindows');
  add(H.glass, ext({ color: sc(0.42, 0.5, 0.58), roughness: 0.3 }), 'roofLights'); add(H.dark, ext({ color: sc(0.2, 0.2, 0.21), roughness: 0.7 }), 'houseDark'); add(H.brick, ext({ color: sc(0.52, 0.32, 0.25), roughness: 0.95 }), 'chimneys');
  const cw = add(crownWall({ R: 100, center: [W / 2, 0], ground: 0, height: 20 }), ext({ map: crownTexture(), alphaTest: 0.5, side: THREE.DoubleSide }), 'crownWall'); cw.castShadow = false;

  // trees: full detail only where the window shows them
  const vis = windowVisibility({ win, wallT, eyeX: [0.2, W - 0.2], eyeY: [0.45, 1.9], eyeZ: [0.25, D - 0.25] });
  const bark = new Bark(), LV = new Leaves(), r = new RNG(SEED + 11), t0 = performance.now();
  for (const T of OUTSIDE.heroTrees) makeTree(T, bark, LV, { lodAt: vis.lod });
  for (let i = 0; i < 8; i++) makeTree({ seed: 500 + i * 13, lod: 1, x: -16 + i * 5.5 + r.range(-1.5, 1.5), z: -22 - r.range(0, 8), H: r.range(10, 14), R: r.range(3, 4.2), trunk: 0.5, first: 0.4, limbs: 7, az0: r.range(0, 6.28), lean: [r.range(-0.05, 0.05), r.range(-0.05, 0.05)], d2: 1.7, dens: 13, size: 0.72 }, bark, LV, { lodAt: vis.lod });
  for (let i = 0; i < 24; i++) { const row = i & 1, Ht = r.range(13, 19); makeTree({ seed: 900 + i * 7, lod: 2, x: -55 + i * 5.1 + r.range(-1.8, 1.8), z: (row ? -58 : -50) + r.range(-3, 3), H: Ht, R: Ht * r.range(0.27, 0.33), trunk: 0.48, first: 0.35, limbs: 8, az0: r.range(0, 6.28), lean: [0, 0], dens: 11 }, bark, LV, { lodAt: vis.lod }); }
  const atlas = buildAtlas(), bm = barkMaterial(barkMaps()), lm = leafMaterial(atlas);
  skyAmbient(bm.material, up, down); hazePatch(bm.material, { color: hz, start: 12, density: 0.006 });
  skyAmbient(lm.material, up.map((c) => c * 0.8), down); hazePatch(lm.material, { color: hz, start: 12, density: 0.006 });
  const barkMesh = mark(new THREE.Mesh(bark.geo(), bm.material)); barkMesh.customDepthMaterial = bm.depth; barkMesh.frustumCulled = false; barkMesh.castShadow = barkMesh.receiveShadow = true; barkMesh.name = 'bark'; g.add(barkMesh);
  const leaves = mark(LV.build(lm.material, [W / 2, 1.5, D / 2])); leaves.customDepthMaterial = lm.depth; leaves.castShadow = leaves.receiveShadow = true; leaves.name = 'leaves'; g.add(leaves);
  ctx.stats.trees = { ms: Math.round(performance.now() - t0), leafCards: LV.n };

  // shared shader uniforms (wind, sun, sky) follow the preset and the clock
  U.uSkyZen.value.setRGB(...S.zenith); U.uSkyHor.value.setRGB(...S.horizon);
  if (S.sun) { U.uSunDir.value.set(...S.glowDir).normalize(); U.uSunCol.value.setRGB(...S.sun.irr); } else U.uSunCol.value.setRGB(0, 0, 0);
  ctx.animated.push((t) => { SKY_U.uTime.value = t; U.uTime.value = t; });
  return g;
}
