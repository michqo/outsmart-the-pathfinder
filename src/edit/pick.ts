import { Mat } from '../world/materials';
import type { World } from '../world/world';

export interface Hit {
  x: number;
  y: number;
  z: number;
  /** Face normal of the hit (the side the ray entered from). Zero if the ray started inside. */
  nx: number;
  ny: number;
  nz: number;
  dist: number;
}

/**
 * Voxel ray march (Amanatides & Woo). Coordinates are voxel space.
 * Returns the first non-air voxel, or null.
 */
export function pickVoxel(
  world: World,
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  maxDist = 400,
): Hit | null {
  let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
  const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
  const tdx = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tdy = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  const tdz = dz !== 0 ? Math.abs(1 / dz) : Infinity;
  let tmx = dx > 0 ? (x + 1 - ox) / dx : dx < 0 ? (ox - x) / -dx : Infinity;
  let tmy = dy > 0 ? (y + 1 - oy) / dy : dy < 0 ? (oy - y) / -dy : Infinity;
  let tmz = dz > 0 ? (z + 1 - oz) / dz : dz < 0 ? (oz - z) / -dz : Infinity;
  let t = 0, nx = 0, ny = 0, nz = 0;

  while (t <= maxDist) {
    if (world.get(x, y, z) !== Mat.Air) return { x, y, z, nx, ny, nz, dist: t };
    if (tmx < tmy && tmx < tmz) {
      x += sx; t = tmx; tmx += tdx; nx = -sx; ny = 0; nz = 0;
    } else if (tmy < tmz) {
      y += sy; t = tmy; tmy += tdy; nx = 0; ny = -sy; nz = 0;
    } else {
      z += sz; t = tmz; tmz += tdz; nx = 0; ny = 0; nz = -sz;
    }
  }
  return null;
}
