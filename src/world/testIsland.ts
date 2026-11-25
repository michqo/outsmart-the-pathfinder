import { Mat } from './materials';
import { SX, SY, SZ, World } from './world';
import { fbm, rng } from './noise';

const BASE = 10;
const POND = { x: 21, z: 40, r: 5.5, level: 13 };
const CRYSTAL = { x: 44, z: 22 };

/**
 * Rolling hills with a pond and a crystal outcrop, so every material shows up.
 * `scale` > 1 makes a bigger window with the same island stretched across it (a debug
 * island for testing large windows): 2 gives 128×48×128.
 */
export function generateTestIsland(world: World, seed = 7, scale = 1): void {
  const sx = SX * scale, sz = SZ * scale;
  world.reset(sx, scale > 1 ? 48 : SY, sz);
  const heights = new Int16Array(sx * sz).fill(-1);

  for (let z = 0; z < sz; z++)
    for (let x = 0; x < sx; x++) {
      // Shape and features are laid out in the 64-wide space; noise detail stays per voxel.
      const u = x / scale, v = z / scale;
      const dx = (u - 31.5) / 29, dz = (v - 31.5) / 29;
      const wobble = (fbm(u * 0.07, v * 0.07, seed) - 0.5) * 0.45;
      const mask = 1 - (Math.hypot(dx, dz) + wobble);
      if (mask <= 0) continue;

      const hills = fbm(x * 0.045 + 10, z * 0.045 + 3, seed + 17);
      const lift = Math.min(1, Math.max(0, (hills - 0.28) * 2.3));
      let h = BASE + Math.floor(lift * lift * 11 + Math.min(mask, 0.4) * 5);
      if (mask < 0.08) h -= 1;

      // The pond: a ring at least at water level, then a dip filled with water.
      const pd = Math.hypot(u - POND.x, v - POND.z) * scale + (fbm(x * 0.3, z * 0.3, seed + 5) - 0.5) * 2;
      if (pd < POND.r + 2.5) h = Math.max(h, POND.level);
      if (pd < POND.r) h = POND.level - 1 - (pd < POND.r * 0.5 ? 1 : 0);

      heights[x + z * sx] = h;
      const bottom = Math.max(1, h - (2 + Math.floor(mask * 9)));
      const stoneTop = h >= BASE + 12;
      for (let y = bottom; y <= h; y++) {
        let m: Mat = Mat.Stone;
        if (y === h) m = stoneTop ? Mat.Stone : Mat.Grass;
        else if (y >= h - 2) m = Mat.Soil;
        world.setRaw(x, y, z, m);
      }
      if (pd < POND.r) for (let y = h + 1; y <= POND.level; y++) world.setRaw(x, y, z, Mat.Water);
    }

  // Crystal outcrop: a cluster of columns, tallest in the middle.
  const r = rng(seed * 31 + 1);
  for (let i = 0; i < 14; i++) {
    const a = r() * Math.PI * 2, d = r() * 3.2;
    const x = Math.round(CRYSTAL.x * scale + Math.cos(a) * d);
    const z = Math.round(CRYSTAL.z * scale + Math.sin(a) * d);
    const top = heights[x + z * sx];
    if (top < 0) continue;
    const tall = Math.round(2 + (3.5 - d) * 1.4 + r() * 2);
    for (let y = top + 1; y <= top + tall; y++) world.setRaw(x, y, z, Mat.Crystal);
  }

  world.version++;
  world.markAllDirty();
}

/**
 * Debug level for performance: 9 stacked stone floors with random holes.
 * The bot can only go down (through holes), so a top-to-bottom search explores a lot.
 */
export function generateStressLevel(world: World, seed = 11): void {
  world.reset();
  const r = rng(seed);
  for (let y = 0; y <= 24; y += 3)
    for (let z = 0; z < SZ; z++)
      for (let x = 0; x < SX; x++) {
        const hole = y > 0 && r() < 0.035;
        if (!hole) world.setRaw(x, y, z, y === 0 ? Mat.Stone : Mat.Soil);
      }
  world.version++;
  world.markAllDirty();
}
