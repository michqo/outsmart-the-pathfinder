import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { pickVoxel } from '../src/edit/pick';
import { LEVELS, SANDBOXES } from '../src/levels/levels';
import { PALETTES } from '../src/palette';
import { buildUnderside } from '../src/render/underside';
import { Mat } from '../src/world/materials';
import { rng } from '../src/world/noise';
import { SX, SY, SZ, World } from '../src/world/world';

/**
 * No see-through gaps between the island's voxels and the rock hanging under it.
 *
 * Between a column's bottom and the rock surface below it there can be a pocket of air.
 * That pocket must be sealed: a ray from outside towards it has to cross either a voxel or
 * the FRONT of the rock surface first. If it gets there untouched, the player can see
 * into (and through) the island.
 */
/** The first-wall level after a player dug shafts through it and hung blocks from its bottom. */
const EDITED = {
  name: 'Edited island (shafts dug, blocks hung below)',
  generate(w: World) {
    LEVELS[0].generate(w);
    const rand = rng(9);
    for (let k = 0; k < 25; k++) {
      const x = 18 + Math.floor(rand() * 28), z = 22 + Math.floor(rand() * 20);
      if (rand() < 0.5) for (let y = 0; y < SY; y++) w.setRaw(x, y, z, Mat.Air);
      else {
        let b = 0;
        while (b < SY && w.get(x, b, z) === Mat.Air) b++;
        for (let y = b - 1 - Math.floor(rand() * 3); y < b; y++) if (y > 0) w.setRaw(x, y, z, Mat.Soil);
      }
    }
  },
};

describe('island underside', () => {
  for (const level of [...LEVELS, ...SANDBOXES, EDITED]) {
    it(`${level.name}: no see-through gaps under the island`, { timeout: 60_000 }, () => {
      const w = new World();
      level.generate(w);
      const mesh = buildUnderside(w, PALETTES.meadow);
      (mesh.material as THREE.Material).side = THREE.DoubleSide;
      mesh.updateMatrixWorld(true);
      const ray = new THREE.Raycaster();
      const down = new THREE.Vector3(0, -1, 0);

      // Pockets: air just under a column's bottom, above where the rock surface is.
      const pockets: THREE.Vector3[] = [];
      for (let z = 0; z < SZ; z++)
        for (let x = 0; x < SX; x++) {
          let b = -1;
          for (let y = 0; y < SY; y++) {
            const m = w.get(x, y, z);
            if (m !== Mat.Air && m !== Mat.Water) {
              b = y;
              break;
            }
          }
          if (b < 0) continue;
          for (const [ox, oz] of [[0.5, 0.5], [0.1, 0.1], [0.9, 0.5], [0.5, 0.9]]) {
            ray.set(new THREE.Vector3(x + ox, b - 0.001, z + oz), down);
            const hit = ray.intersectObject(mesh)[0];
            if (hit && hit.distance > 0.05) pockets.push(new THREE.Vector3(x + ox, b - hit.distance / 2, z + oz));
          }
        }

      (mesh.material as THREE.Material).side = THREE.FrontSide;
      const rand = rng(5);
      const centre = new THREE.Vector3(SX / 2, 0, SZ / 2);
      let leaks = 0;
      const sample: string[] = [];
      // A few hundred pockets is plenty (raycasting the rock mesh is brute force).
      const picked = pockets.filter(() => rand() < 400 / pockets.length);
      for (const p of picked) {
        for (let k = 0; k < 6; k++) {
          // From outside the island: around it, level with or below the pocket.
          const a = rand() * Math.PI * 2;
          const from = new THREE.Vector3(centre.x + Math.cos(a) * 70, p.y - rand() * 30, centre.z + Math.sin(a) * 70);
          const dir = p.clone().sub(from);
          const dist = dir.length();
          dir.normalize();
          const v = pickVoxel(w, from.x, from.y, from.z, dir.x, dir.y, dir.z, dist);
          ray.set(from, dir);
          ray.far = dist;
          const r = ray.intersectObject(mesh)[0];
          if (!v && !r) {
            leaks++;
            if (sample.length < 3) sample.push(`(${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})`);
          }
        }
      }
      expect(leaks, `see-through pockets near ${sample.join(' ')}`).toBe(0);
    });
  }
});
