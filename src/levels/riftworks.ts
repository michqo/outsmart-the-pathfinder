import type { Vec3i } from '../path/protocol';
import { Mat } from '../world/materials';
import { rng } from '../world/noise';
import type { World } from '../world/world';

const ROOMS = 6;
const SIZE = 9;
const RIM = 5;
const END = RIM + ROOMS * SIZE;
export const RIFTWORKS_SEED = 47;
export const RIFTWORKS_BLOCKS = 6;

function elevation(x: number): number {
  return 8 + Math.min(4, Math.max(0, x - 19)) + Math.min(4, Math.max(0, x - 37));
}

/** A connected room maze with stepped terrain and optional dig, swim and bridge shortcuts. */
export function generateRiftworks(world: World, seed: number): { start: Vec3i; goal: Vec3i } {
  const random = rng(seed);
  const roll = (n: number) => Math.floor(random() * n);
  const set = (x: number, y: number, z: number, m: Mat) => world.setRaw(x, y, z, m);
  world.data.fill(Mat.Air);

  for (let z = RIM; z <= END; z++) for (let x = RIM; x <= END; x++) {
    const y = elevation(x);
    const depth = 3 + roll(3);
    for (let h = y - depth; h <= y; h++) set(x, h, z, h === y ? Mat.Grass : h === y - 1 ? Mat.Soil : Mat.Stone);
    if ((x - RIM) % SIZE !== 0 && (z - RIM) % SIZE !== 0) continue;
    for (let h = y - 3; h <= y + 7; h++) set(x, h, z, Mat.Crystal);
  }

  const edges: { a: number; b: number; x: number; z: number; dz: number; dx: number; open: boolean }[] = [];
  for (let v = 0; v < ROOMS; v++) for (let u = 0; u < ROOMS; u++) {
    const a = u + v * ROOMS, x = RIM + u * SIZE, z = RIM + v * SIZE;
    if (u + 1 < ROOMS) edges.push({ a, b: a + 1, x: x + SIZE, z: z + 2 + roll(5), dx: 0, dz: 1, open: false });
    if (v + 1 < ROOMS) edges.push({ a, b: a + ROOMS, x: x + 2 + roll(5), z: z + SIZE, dx: 1, dz: 0, open: false });
  }
  const visited = new Set([0]);
  const stack = [0];
  while (stack.length) {
    const room = stack[stack.length - 1];
    const next = edges.filter(({ a, b }) => (room === a && !visited.has(b)) || (room === b && !visited.has(a)));
    if (!next.length) {
      stack.pop();
      continue;
    }
    const edge = next[roll(next.length)];
    edge.open = true;
    const to = edge.a === room ? edge.b : edge.a;
    visited.add(to);
    stack.push(to);
  }

  for (const edge of edges) {
    const material = edge.open ? Mat.Air : roll(5) === 0 ? Mat.Stone : null;
    if (material === null) continue;
    for (let i = 0; i < 2; i++) {
      const x = edge.x + edge.dx * i, z = edge.z + edge.dz * i, y = elevation(x);
      set(x, y, z, Mat.Grass);
      for (let h = y + 1; h <= y + 7; h++) set(x, h, z, h <= y + 3 ? material : Mat.Air);
    }
  }

  // Leave margins along room walls, so obstacles never sever the maze backbone.
  for (let v = 0; v < ROOMS; v++) for (let u = 0; u < ROOMS; u++) {
    if ((u === 0 && v === 0) || (u === ROOMS - 1 && v === ROOMS - 1)) continue;
    const left = RIM + u * SIZE + 2, front = RIM + v * SIZE + 2;
    const feature = roll(4);
    for (let z = front + 1; z <= front + 4; z++) for (let x = left + 1; x <= left + 4; x++) {
      const y = elevation(x);
      if (feature === 0) {
        set(x, y, z, Mat.Water);
      } else if (feature === 1) {
        for (let h = y - 5; h <= y; h++) set(x, h, z, Mat.Air);
      } else if (feature === 2 && (z === front + 2 || z === front + 3)) {
        for (let h = y + 1; h <= y + 3; h++) set(x, h, z, Mat.Soil);
      } else if (feature === 3 && x <= left + 2) {
        set(x, y + 1, z, Mat.Stone);
        if (x === left + 2) set(x, y + 2, z, Mat.Grass);
      }
    }
  }

  world.version++;
  world.markAllDirty();
  return { start: [9, elevation(9) + 1, 9], goal: [55, elevation(55) + 1, 55] };
}
