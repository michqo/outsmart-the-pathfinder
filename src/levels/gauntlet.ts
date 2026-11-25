import type { Vec3i } from '../path/protocol';
import { Mat } from '../world/materials';
import type { World } from '../world/world';

const Z0 = 14, Z1 = 50; // slab width along z
const TOP = 8; // slab top; feet stand at TOP + 1

/**
 * A straight course that needs every M3 move, west to east:
 * swim a moat → dig through a clay wall → bridge a chasm → pillar up a crystal cliff.
 */
export function generateGauntlet(world: World): { start: Vec3i; goal: Vec3i } {
  world.reset();
  const set = (x: number, y: number, z: number, m: Mat) => world.setRaw(x, y, z, m);

  for (let x = 6; x <= 58; x++)
    for (let z = Z0; z <= Z1; z++) {
      if (x >= 30 && x <= 32) continue; // the chasm
      const depth = 3 + ((x * 7 + z * 13) % 3); // a ragged bottom
      for (let y = TOP - depth; y <= TOP; y++) set(x, y, z, y === TOP ? Mat.Grass : y >= TOP - 1 ? Mat.Soil : Mat.Stone);
    }

  for (let z = Z0; z <= Z1; z++) {
    // Moat: two cells of water sunk into the slab.
    for (const x of [14, 15]) set(x, TOP, z, Mat.Water);
    // Clay wall, 4 high, with crystal posts at the ends so it reads as a barrier.
    for (let y = TOP + 1; y <= TOP + 4; y++) set(22, y, z, z === Z0 || z === Z1 ? Mat.Crystal : Mat.Soil);
    // Crystal cliff: everything east of x = 42 is 3 higher, with an undiggable face.
    for (let x = 42; x <= 58; x++)
      for (let y = TOP + 1; y <= TOP + 3; y++) set(x, y, z, x === 42 ? Mat.Crystal : y === TOP + 3 ? Mat.Grass : Mat.Soil);
  }
  // Grass on the cliff's top edge too.
  for (let z = Z0; z <= Z1; z++) set(42, TOP + 3, z, Mat.Crystal);

  world.version++;
  world.markAllDirty();
  return { start: [8, TOP + 1, 32], goal: [52, TOP + 4, 32] };
}
