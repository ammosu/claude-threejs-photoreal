// The ONE place for dimensions (metres) and look. X along the window wall, Z into the room (window wall at z = 0,
// outside is z < 0), Y up. Every part reads its footprint from here, so moving furniture is a one-line change.
export const ROOM = { W: 4.2, D: 4.0, H: 2.6, wallT: 0.25, win: { x0: 1.1, x1: 2.9, y0: 0.85, y1: 2.25 } };
export const TABLE = { x: 2.1, z: 1.2, w: 1.2, d: 0.7, top: 0.74 };
export const CHAIR = { x: 2.1, z: 1.75 };                                  // seat centre; the back rail is on the +z side (faces the table)
export const SHELF = { x0: 3.9, x1: 4.18, z0: 2.3, z1: 3.2, y: [0.4, 0.8, 1.2, 1.6] };   // bookcase against the right wall (x = W)
// Footprints [x0, z0, x1, z1] the walker cannot enter, besides TABLE / CHAIR / SHELF (add yours here).
export const BLOCKERS = [];
// Light: sky + sun through the window. The sun's direct light is real time (sharp shadows); everything else is baked.
// ONE sky description (threejs-sky-backdrop): the bake, the visible dome and the outdoor light all come from it.
// Change the preset (dawn | day | overcast | golden) -> re-bake (?bake=128) and save bake/gi.bin.
import { SKIES } from './lib/sky/sky.js';
export const SKY_PRESET = SKIES.day;
export const SKY = { zenith: SKY_PRESET.zenith, horizon: SKY_PRESET.horizon, glow: SKY_PRESET.glow, glowDir: SKY_PRESET.glowDir, ground: SKY_PRESET.ground };
export const SUN = { dir: SKY_PRESET.glowDir, irr: SKY_PRESET.sun ? SKY_PRESET.sun.irr : [0, 0, 0] };
// Grade (threejs-realtime-post). Interior is ~1/20 of outside: expose for the room, pull the window down with ext.
export const LOOK = { exposure: 4.5, ext: 0.3, bloom: 0.04, vignette: 0.15, grain: 0.01, sat: 1.05, contrast: 1.02 };
export const CAMS = {
  room: { pos: [0.5, 1.5, 3.7], target: [2.3, 0.9, 0.9], fov: 55 },
  desk: { pos: [3.0, 1.15, 2.35], target: [2.1, 0.75, 1.3], fov: 45 },
  window: { pos: [2.0, 1.4, 3.2], target: [2.0, 1.3, 0], fov: 55 },
  corner: { pos: [3.5, 1.55, 0.7], target: [1.0, 0.45, 3.0], fov: 60 },     // from the window side, looking back into the room
  view: { pos: [2.0, 1.45, 0.9], target: [1.93, 1.55, 0.05], fov: 60 },    // at the window, looking out and up (targets stay inside the room)
};
// Outside (threejs-sky-backdrop + threejs-procedural-vegetation). Ground floor: the garden is at y = 0.
export const OUTSIDE = {
  heroTrees: [   // a lime whose crown sits between the sun and the window (its shadow dapples the sill and floor), a robinia
    { seed: 404, lod: 0, sp: 'lime', x: -2.6, z: -8.5, H: 11.5, R: 3.8, trunk: 0.45, first: 0.4, limbs: 8, az0: 2.1, lean: [0.03, 0.02], d2: 3.0, d3: 6, sparse: 1 },
    { seed: 101, lod: 0, sp: 'rob', x: 7.5, z: -13, H: 14, R: 4.3, trunk: 0.5, first: 0.36, limbs: 9, az0: 0.9, lean: [-0.02, 0], d2: 2.8, d3: 6, sparse: 1 },
  ],
  pathZ: (x) => -16 + 1.2 * Math.sin(x * 0.07 + 0.6),
  houses: [{ x: 4, z: -32, w: 11, d: 9, eave: 6.2, ridge: 9.4 }, { x: -22, z: -42, w: 9.5, d: 8, eave: 5.4, ridge: 8.4 }, { x: 22, z: -44, w: 12, d: 9, eave: 6.0, ridge: 9.2 }],
};
export const SEED = 20261113;
