import type { Vec3i } from '../../src/path/protocol';
import { Mat } from '../../src/world/materials';
import { fbm } from '../../src/world/noise';
import type { World } from '../../src/world/world';

/**
 * Small hand-built courses for tests (the game's first hand-made levels, kept as fixtures
 * once the archipelago replaced them).
 */
const TOP = 8;

/** A roundish slab of grass over soil over stone, with a ragged rim and bottom. */
function slab(world: World, cx: number, cz: number, rx: number, rz: number, top = TOP, seed = 1): void {
  for (let z = 0; z < 64; z++)
    for (let x = 0; x < 64; x++) {
      const dx = (x + 0.5 - cx) / rx, dz = (z + 0.5 - cz) / rz;
      const d = Math.pow(Math.pow(Math.abs(dx), 4) + Math.pow(Math.abs(dz), 4), 0.25) + (fbm(x * 0.2, z * 0.2, seed) - 0.5) * 0.12;
      if (d > 1) continue;
      const depth = 3 + Math.floor((1 - d) * 5 + fbm(x * 0.3, z * 0.3, seed + 3) * 2);
      for (let y = top - depth; y <= top; y++) world.setRaw(x, y, z, y === top ? Mat.Grass : y >= top - 2 ? Mat.Soil : Mat.Stone);
    }
}

function done(world: World, start: Vec3i, goal: Vec3i): { start: Vec3i; goal: Vec3i } {
  world.version++;
  world.markAllDirty();
  return { start, goal };
}

export interface Course {
  name: string;
  generate(world: World): { start: Vec3i; goal: Vec3i };
}

/** One flat slab, bot and flag 20 apart. */
export const FLAT: Course = {
  name: 'Flat slab',
  generate(world) {
    world.reset();
    slab(world, 32, 32, 15, 11, TOP, 2);
    return done(world, [22, TOP + 1, 32], [42, TOP + 1, 32]);
  },
};

/** A slab with a water ring sunk around the flag. */
export const MOAT: Course = {
  name: 'Moat',
  generate(world) {
    world.reset();
    slab(world, 32, 32, 17, 17, TOP, 6);
    for (let z = 0; z < 64; z++)
      for (let x = 0; x < 64; x++) {
        const r = Math.hypot(x + 0.5 - 40, z + 0.5 - 32);
        if (r > 3.2 && r < 6.2) world.setRaw(x, TOP, z, Mat.Water);
      }
    return done(world, [20, TOP + 1, 32], [40, TOP + 1, 32]);
  },
};

/** Two slabs at different heights with a gap between. */
export const TWO_CLIFFS: Course = {
  name: 'Two cliffs',
  generate(world) {
    world.reset();
    slab(world, 19, 32, 11, 13, TOP, 8);
    slab(world, 44, 32, 11, 13, TOP + 1, 9);
    return done(world, [14, TOP + 1, 32], [50, TOP + 2, 32]);
  },
};
