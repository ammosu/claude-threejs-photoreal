// Builds every part in a fixed order. Order, names and vertex counts must never depend on anything random or on
// timing: the baked light file is matched back to meshes by their position in this traversal.
import * as THREE from 'three';
import { RNG } from './lib/props/props.js';
import { SEED } from './layout.js';
import * as room from './parts/room.js';
import * as furniture from './parts/furniture.js';
import * as outside from './parts/outside.js';

const PARTS = [room, furniture, outside];          // add new parts here; each exports order, label, build(ctx)

export async function buildScene(onProgress = () => {}) {
  const scene = new THREE.Scene(), root = new THREE.Group(); root.name = 'root'; scene.add(root);
  const ctx = { rng: new RNG(SEED), colliders: [], animated: [], stats: {} };
  const only = new URLSearchParams(location.search).get('only');      // ?only=room,furniture: work on one part
  for (const m of [...PARTS].sort((a, b) => a.order - b.order)) {
    if (only && m.label !== 'room' && !only.split(',').includes(m.label)) continue;   // ?only=furniture: skip the rest
    onProgress(m.label);
    const t = performance.now(), g = await m.build(ctx);
    ctx.stats['ms_' + m.label] = Math.round(performance.now() - t);
    if (g) root.add(g);
    await new Promise((r) => setTimeout(r, 0));
  }
  return { scene, root, ctx };
}
