import type { TimeOfDay } from '../render/timeOfDay';
import type { Vec3i } from '../path/protocol';
import { generateIsland, type Island, type IslandSpec } from '../gen/island';
import type { Tuning } from '../gen/tune';
import { generateTestIsland } from '../world/testIsland';
import type { World } from '../world/world';
import { defaultSpawn } from './spawn';

const ISLAND_ID = 'island';
export const ISLAND_SEED = 2026;

export interface Level {
  id: string;
  name: string;
  /** One line telling the player what this level teaches. */
  hint: string;
  generate(world: World): { start: Vec3i; goal: Vec3i };
  /** Blocks the bot carries for bridges and pillars. */
  inventory: number;
  /** Player edits allowed (cells changed from the level as built); null = sandbox, anything goes. */
  budget: number | null;
  /**
   * Node counts for ★, ★★, ★★★; null = no stars (sandbox). Set from `CALIBRATE=1` in
   * tests/levels.test.ts: about 0.6×, 1× and 1.5× what a scripted hill-climb reaches.
   */
  stars: [number, number, number] | null;
  seed?: number;
  kind?: 'island';
  /** Generated islands: the difficulty tier (1–5) when surveyed. */
  tier?: number;
  /** Generated islands: which island of which archipelago. */
  spec?: IslandSpec;
  /** Generated islands: per-column biome, for the terrain tint. */
  biome?: Uint8Array;
  /** Time of day the course is lit for (default day). */
  time?: TimeOfDay;
}

/** Free build: the test island with no budget or stars; start and flag can be dragged. */
export const SANDBOX: Level = {
  id: 'sandbox',
  name: 'Free build',
  hint: 'No limits. Drag the bot and the flag and build the hardest course you can.',
  inventory: 16,
  budget: null,
  stars: null,
  generate(world) {
    generateTestIsland(world, 7);
    return defaultSpawn(world);
  },
};

/**
 * A generated island. With a `tuning` (from the survey) it's a scored challenge: start
 * and flag, edit budget, blocks and stars set for its tier. Without one it's a sandbox.
 * Pass `island` when it was already generated (in the worker); otherwise it's generated
 * synchronously on first use.
 */
export function islandLevel(spec: IslandSpec = { seed: ISLAND_SEED, ix: 0, iz: 0 }, island?: Island, tuning?: Tuning, name?: string): Level {
  const seed = spec.seed;
  let made = island;
  return {
    id: tuning ? islandLevelId(spec, tuning.tier) : ISLAND_ID,
    name: name ?? (tuning ? `Island ${seed}` : 'Generated island'),
    hint: tuning
      ? `Tier ${tuning.tier}: ${tuning.budget} edits, ${tuning.blocks} blocks. Eroded hills, rivers, lakes and biomes, surveyed for a route that makes the bot think.`
      : 'A fresh island from the seed: eroded hills, rivers, lakes and biomes. Build on it, or try another seed.',
    inventory: tuning ? tuning.blocks : 16,
    budget: tuning ? tuning.budget : null,
    stars: tuning ? tuning.stars : null,
    seed,
    kind: 'island',
    tier: tuning?.tier,
    spec,
    get biome() {
      return made?.biome;
    },
    generate(world) {
      made ??= generateIsland(spec);
      const { sx, sy, sz } = made.dims;
      world.reshape(sx, sy, sz);
      world.data.set(made.data);
      world.markAllDirty();
      return tuning ? { start: [...tuning.start], goal: [...tuning.goal] } : defaultSpawn(world);
    },
  };
}

/** Progress key: the island (and its size cap, which changes it) at a tier. */
export function islandLevelId(spec: IslandSpec, tier: number): string {
  return `island:${spec.seed}:${spec.ix},${spec.iz}:t${tier}${spec.maxSize ? `:s${spec.maxSize}` : ''}`;
}

/** How many stars a score earns on a level (0..3). */
export function starsFor(level: Level, nodes: number): number {
  if (!level.stars) return 0;
  return level.stars.filter((t) => nodes >= t).length;
}
