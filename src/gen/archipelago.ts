import { hash2 } from '../world/noise';
import { ISLAND_SIZE, islandParams, type IslandSpec } from './island';

/**
 * The archipelago: an endless, seeded sky of islands on a jittered grid. Every island is a
 * challenge; difficulty (the tier) rises with the ring around home, and earning ★ on an
 * island opens bridges to its neighbours.
 *
 * Pure and deterministic: the layout comes from the seed alone, so it never needs storing.
 */

/** Grid cell size in voxels: room for the biggest island plus a gap and some jitter. */
export const CELL = 200;
const JITTER = 25;
/** Chance a cell (other than home) holds an island. */
const DENSITY = 0.72;

export interface ArchIsland {
  ix: number;
  iz: number;
  /** Chebyshev distance from home: 0 = home. */
  ring: number;
  tier: number;
  /** Centre of the island's window in sky coordinates (y = how high it floats). */
  centre: [number, number, number];
}

export const islandId = (ix: number, iz: number) => `${ix},${iz}`;

/** The island in grid cell (ix, iz), or null when the cell is open sky. */
export function islandAt(seed: number, ix: number, iz: number): ArchIsland | null {
  const salt = (seed % 1_000_003) + 17;
  const ring = Math.max(Math.abs(ix), Math.abs(iz));
  if (ring > 0 && hash2(ix, iz, salt) >= DENSITY) return null;
  const jx = ring === 0 ? 0 : Math.round((hash2(ix, iz, salt + 1) - 0.5) * 2 * JITTER);
  const jz = ring === 0 ? 0 : Math.round((hash2(ix, iz, salt + 2) - 0.5) * 2 * JITTER);
  const jy = ring === 0 ? 0 : Math.round((hash2(ix, iz, salt + 3) - 0.5) * 40);
  return { ix, iz, ring, tier: Math.min(5, ring + 1), centre: [ix * CELL + jx, jy, iz * CELL + jz] };
}

/**
 * The generator spec for an island. Size grows with the ring (home is small and friendly);
 * `cap` is the touch-device limit.
 */
export function archSpec(seed: number, a: ArchIsland, cap?: number): IslandSpec {
  const ringCap = a.ring === 0 ? 56 : a.ring === 1 ? 80 : ISLAND_SIZE.max;
  const maxSize = Math.min(ringCap, cap ?? ISLAND_SIZE.max);
  return { seed, ix: a.ix, iz: a.iz, maxSize: maxSize < ISLAND_SIZE.max ? maxSize : undefined };
}

/** Footprint radius in voxels (for bridges and markers), without generating the island. */
export function archRadius(spec: IslandSpec): number {
  return islandParams(spec).size * 0.42;
}

/** Every island within `r` cells of (cx, cz), nearest first. */
export function islandsAround(seed: number, cx: number, cz: number, r: number): ArchIsland[] {
  const out: ArchIsland[] = [];
  for (let iz = cz - r; iz <= cz + r; iz++)
    for (let ix = cx - r; ix <= cx + r; ix++) {
      const a = islandAt(seed, ix, iz);
      if (a) out.push(a);
    }
  const d = (a: ArchIsland) => Math.max(Math.abs(a.ix - cx), Math.abs(a.iz - cz));
  return out.sort((a, b) => d(a) - d(b) || a.iz - b.iz || a.ix - b.ix);
}

/**
 * An island with no inner-ring island among its 8 surrounding cells links to the nearest
 * one within 3 cells instead (a long bridge), so every island can be reached from home.
 */
function innerLink(seed: number, a: ArchIsland): ArchIsland | null {
  if (a.ring === 0) return null;
  const adjacent = islandsAround(seed, a.ix, a.iz, 1);
  if (adjacent.some((b) => b.ring < a.ring)) return null;
  return islandsAround(seed, a.ix, a.iz, 3).find((b) => b.ring === a.ring - 1) ?? null;
}

const same = (a: ArchIsland, b: ArchIsland) => a.ix === b.ix && a.iz === b.iz;

/** Bridge neighbours: the islands in the 8 surrounding cells, plus long inner links both ways. */
export function neighbours(seed: number, a: ArchIsland): ArchIsland[] {
  const out = islandsAround(seed, a.ix, a.iz, 1).filter((b) => !same(a, b));
  const inner = innerLink(seed, a);
  if (inner) out.push(inner);
  for (const b of islandsAround(seed, a.ix, a.iz, 3)) {
    if (b.ring !== a.ring + 1 || out.some((c) => same(b, c))) continue;
    const link = innerLink(seed, b);
    if (link && same(link, a)) out.push(b);
  }
  return out;
}

/** Open = home, or a bridge neighbour has ★. `starsOf` returns the stars earned on an island. */
export function isOpen(seed: number, a: ArchIsland, starsOf: (a: ArchIsland) => number): boolean {
  return a.ring === 0 || starsOf(a) > 0 || neighbours(seed, a).some((b) => starsOf(b) > 0);
}

/** Today's seed (UTC), the same for everyone. */
export function dailySeed(date = new Date()): number {
  const ymd = date.getUTCFullYear() * 10000 + (date.getUTCMonth() + 1) * 100 + date.getUTCDate();
  let h = Math.imul(ymd ^ 0x5bd1e995, 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  return (h ^ (h >>> 13)) >>> 0;
}

export function dailyLabel(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}
