// Textile normal maps (tiling) + a fabric material. The structure of the cloth lives in the normal map; the colour
// is a flat tint (or a print map). Each function notes its natural tile size: set repeat = 1 / tileMetres on UVs in metres.
// Adapted from room-at-dawn (MIT) src/scene/materials.js (weaveNormal, fabric) and src/scene/parts/decor.js,
// clutter.js (waffle, terry, rib, rope, knit, felt). For a full linen weave with colour see the
// threejs-procedural-cloth skill (scripts/curtain.js linenTextures).
import * as THREE from 'three';
import { TAU, hash2, pnoise, pfbm, field, normalTex, once } from './tex.js';

/** Plain weave (warp/weft over-under). threads per tile; slub 0..1 = linen-like irregularity. 512². Tile ≈ threads × 0.5–1 mm. */
export function weaveNormal({ slub = 0.3, strength = 2.0, threads = 96 } = {}) {
  return once(`weave|${slub}|${strength}|${threads}`, () => {
    const N = 512, T = threads;
    const H = field(N, N, (u, v) => {
      const x = u * T, y = v * T, ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, over = (ix + iy) & 1;
      const wx = 0.75 + slub * (hash2(ix, 7, 1) - 0.5) * 1.6, wy = 0.75 + slub * (hash2(3, iy, 2) - 0.5) * 1.6;
      const tx = Math.max(0, 1 - (Math.abs(fx - 0.5) * 2) / wx), ty = Math.max(0, 1 - (Math.abs(fy - 0.5) * 2) / wy);
      const warp = Math.sqrt(tx) * (over ? 1 : 0.55) * (0.6 + 0.4 * Math.sin(fy * Math.PI));
      const weft = Math.sqrt(ty) * (over ? 0.55 : 1) * (0.6 + 0.4 * Math.sin(fx * Math.PI));
      return Math.max(warp, weft) + (pnoise(u * 40, v * 40, 4, 40) - 0.5) * 0.25 * slub;
    });
    return normalTex(H, N, N, strength);
  });
}
/** Waffle piqué (bathrobe, kitchen towel): square cells between raised ribs, 16 cells per tile. Tile ≈ 9 cm. */
export function waffleNormal() {
  return once('waffle', () => {
    const N = 256, C = 16;
    const H = field(N, N, (u, v) => { const x = u * C, y = v * C, fx = x - Math.floor(x), fy = y - Math.floor(y); return Math.max(Math.pow(Math.abs(fx - 0.5) * 2, 2.2), Math.pow(Math.abs(fy - 0.5) * 2, 2.2)) + (pnoise(u * 90, v * 90, 5, 90) - 0.5) * 0.25; });
    return normalTex(H, N, N, 3.2);
  });
}
/** Terry towelling: a dense pile of little loops. Tile ≈ 5 cm. */
export function terryNormal() {
  return once('terry', () => { const N = 256; return normalTex(field(N, N, (u, v) => pfbm(u * 72, v * 72, 2, 15, 72) + 0.5 * pnoise(u * 128, v * 128, 19, 128)), N, N, 3.0); });
}
/** Knitted rib (cuffs, scarves, beanies): ridges along v. ribs per tile. Tile ≈ 4 cm (fine 1x1) to 7 cm (chunky). */
export function ribNormal({ ribs = 12, rows = 48 } = {}) {
  return once(`rib|${ribs}|${rows}`, () => {
    const N = 256;
    const H = field(N, N, (u, v) => { const x = u * ribs, ix = Math.floor(x), r = Math.pow(0.5 - 0.5 * Math.cos((x - ix) * TAU), 0.6); return r * (0.8 + 0.2 * Math.sin(v * rows * TAU + ix * 2.1)) + (pnoise(u * 100, v * 100, 3, 100) - 0.5) * 0.15; });
    return normalTex(H, N, N, 2.8);
  });
}
/** Stockinette (jersey) knit: rows of V-shaped stitches, 32 wales x 40 courses per tile. Tile ≈ 10 cm for a sweater. */
export function knitNormal() {
  return once('knit', () => {
    const N = 512, WALES = 32, ROWS = 40;
    const H = field(N, N, (u, v) => {
      const x = u * WALES, y = v * ROWS, ix = Math.floor(x), iy = Math.floor(y), fy = y - iy, d = Math.abs(x - ix - 0.5);
      const q = (d - 0.05 - 0.36 * fy) / 0.2;
      return Math.max(0, 1 - q * q) * (0.7 + 0.3 * Math.sin(Math.PI * fy)) * (0.8 + 0.4 * hash2(ix, iy, 91)) + (pnoise(u * 180, v * 180, 7, 180) - 0.5) * 0.2;
    });
    return normalTex(H, N, N, 3.0);
  });
}
/** Pressed wool felt: matted fibres, no structure. Tile ≈ 10 cm. */
export function feltNormal() {
  return once('felt', () => { const N = 256; return normalTex(field(N, N, (u, v) => pfbm(u * 56, v * 56, 3, 5, 56) + 0.6 * pfbm(u * 12, v * 96, 2, 9, 12, 96) + 0.6 * pfbm(u * 96, v * 12, 2, 13, 96, 12)), N, N, 2.4); });
}
/** Coiled rope (baskets): one coil per tile in v, strands laid on the diagonal. repeat v = 1 / coil pitch (~1.4 cm). */
export function ropeNormal() {
  return once('rope', () => { const N = 128; return normalTex(field(N, N, (u, v) => Math.sqrt(Math.max(0, 1 - (2 * v - 1) ** 2)) * (0.76 + 0.24 * Math.cos(TAU * (3 * u + v)))), N, N, 8.0); });
}

/**
 * Fabric: MeshPhysicalMaterial with sheen (the soft rim cloth has at grazing angles) and an optional share of the
 * light arriving from behind (`trans`, thin cloth glowing when back-lit). `normal` is one of the maps above;
 * tileM = metres per tile of that map (UVs in metres).
 */
export function fabricMaterial(color, { normal = null, tileM = 0.1, nscale = 0.8, sheen = 0.35, rough = 0.95, trans = 0, side = THREE.FrontSide, map = null } = {}) {
  const c = color instanceof THREE.Color ? color : new THREE.Color(color);
  const m = new THREE.MeshPhysicalMaterial({ color: c, map, roughness: rough, sheen, sheenRoughness: 0.6, sheenColor: c.clone().lerp(new THREE.Color(1, 1, 1), 0.5), side, normalScale: new THREE.Vector2(nscale, nscale) });
  if (normal) { m.normalMap = normal.clone(); m.normalMap.repeat.set(1 / tileM, 1 / tileM); m.normalMap.needsUpdate = true; }
  if (trans > 0) {
    m.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
      #if NUM_DIR_LIGHTS > 0
      for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) reflectedLight.directDiffuse += ${trans.toFixed(3)} * max( dot( -normal, directionalLights[ i ].direction ), 0.0 ) * directionalLights[ i ].color * diffuseColor.rgb;
      #endif`);
    };
    m.customProgramCacheKey = () => 'fabricTrans' + trans;
  }
  m.userData.bake = { albedo: [c.r, c.g, c.b], trans };
  return m;
}
