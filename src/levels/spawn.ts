import { canStand } from '../path/moves';
import type { Vec3i } from '../path/protocol';
import type { World } from '../world/world';

/** Highest standable cell in a column, or null. */
export function topStand(world: World, x: number, z: number): Vec3i | null {
  for (let y = world.sy - 2; y >= 1; y--) if (canStand(world, x, y, z)) return [x, y, z];
  return null;
}

/** A sensible default: goal on the highest point, start as far from it as possible. */
export function defaultSpawn(world: World): { start: Vec3i; goal: Vec3i } {
  const { sx: SX, sz: SZ } = world;
  let goal: Vec3i = [SX / 2, 1, SZ / 2];
  let bestY = -1;
  const cols: Vec3i[] = [];
  for (let z = 2; z < SZ - 2; z++)
    for (let x = 2; x < SX - 2; x++) {
      const c = topStand(world, x, z);
      if (!c) continue;
      cols.push(c);
      // Prefer the peak's centre: ties go to the column nearer the middle.
      if (c[1] > bestY) (bestY = c[1]), (goal = c);
    }
  let start = goal, bestD = -1;
  for (const c of cols) {
    const d = Math.hypot(c[0] - goal[0], c[2] - goal[2]);
    // Keep away from the very rim so the bot starts on solid ground.
    const rim = [1, -1].some((s) => !topStand(world, c[0] + s * 2, c[2]) || !topStand(world, c[0], c[2] + s * 2));
    if (!rim && d > bestD) (bestD = d), (start = c);
  }
  return { start, goal };
}
