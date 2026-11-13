// The ONE place for dimensions (metres) and look. X along the window wall, Z into the room (window wall at z = 0,
// outside is z < 0), Y up. Every part reads its footprint from here, so moving furniture is a one-line change.
export const ROOM = { W: 4.2, D: 4.0, H: 2.6, wallT: 0.25, win: { x0: 1.1, x1: 2.9, y0: 0.85, y1: 2.25 } };
export const TABLE = { x: 2.1, z: 1.2, w: 1.2, d: 0.7, top: 0.74 };
export const CHAIR = { x: 2.1, z: 1.75 };                                  // seat centre; the back rail is on the +z side (faces the table)
export const SHELF = { x0: 3.9, x1: 4.18, z0: 2.3, z1: 3.2, y: [0.4, 0.8, 1.2, 1.6] };   // bookcase against the right wall (x = W)
// Light: sky + sun through the window. The sun's direct light is real time (sharp shadows); everything else is baked.
export const SUN = { dir: [-0.35, 0.55, -0.76], irr: [3.4, 3.1, 2.7] };
export const SKY = { zenith: [0.32, 0.48, 0.95], horizon: [0.85, 0.95, 1.15], glow: [0, 0, 0], glowDir: [0, 1, 0], ground: [0.06, 0.07, 0.05] };
// Grade (threejs-realtime-post). Interior is ~1/20 of outside: expose for the room, pull the window down with ext.
export const LOOK = { exposure: 4.5, ext: 0.3, bloom: 0.04, vignette: 0.15, grain: 0.01, sat: 1.05, contrast: 1.02 };
export const CAMS = {
  room: { pos: [0.5, 1.5, 3.7], target: [2.3, 0.9, 0.9], fov: 55 },
  desk: { pos: [3.0, 1.15, 2.35], target: [2.1, 0.75, 1.3], fov: 45 },
  window: { pos: [2.0, 1.4, 3.2], target: [2.0, 1.3, 0], fov: 55 },
};
export const SEED = 20261113;
