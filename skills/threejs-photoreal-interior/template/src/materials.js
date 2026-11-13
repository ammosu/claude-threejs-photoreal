// Materials that take part in the bake. Two rules from threejs-baked-gi:
//  1. every lit material goes through lit(): giPatch makes it read the baked per-vertex light instead of lights;
//     it CHAINS any shader patch the material already had (wallPatch, fabric back-light, wind...) — giPatch alone
//     would replace onBeforeCompile and silently drop them.
//  2. textured materials tell the baker their mean (linear) albedo, or bounce light gets the wrong colour.
import * as THREE from 'three';
import { giPatch } from './lib/gi/gi.js';

export function lit(mat, { albedo = null, key = '', ...gi } = {}) {
  const prev = Object.prototype.hasOwnProperty.call(mat, 'onBeforeCompile') ? mat.onBeforeCompile : null;   // set by an earlier patch
  const prevKey = Object.prototype.hasOwnProperty.call(mat, 'customProgramCacheKey') ? mat.customProgramCacheKey() : '';
  giPatch(mat, { ...gi, key: key + '|' + prevKey, onCompile: prev ? (sh) => prev(sh) : undefined });
  if (albedo) mat.userData.bake = { ...(mat.userData.bake || {}), albedo };
  return mat;
}
/** Plain colour material (sRGB colour), lit by the bake. */
export const solid = (rgb, rough = 0.8, extra = {}) => lit(new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(...rgb, THREE.SRGBColorSpace), roughness: rough, ...extra }));
/** Box with segments so no edge is longer than maxEdge (light lives on vertices: 1.5–2 cm where things stand on it). */
export const tbox = (w, h, d, me = 0.05) => new THREE.BoxGeometry(w, h, d, Math.ceil(w / me), Math.ceil(h / me), Math.ceil(d / me));
export const tplane = (w, h, me = 0.08) => new THREE.PlaneGeometry(w, h, Math.ceil(w / me), Math.ceil(h / me));
/** Plane UVs in metres (textures from threejs-procedural-textures expect it). */
export function metres(g, sx, sy) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * sx, uv.getY(i) * sy); return g; }
