import type { Vec3i } from '../path/protocol';
import { Mat } from '../world/materials';
import { fbm } from '../world/noise';
import { generateTestIsland } from '../world/testIsland';
import type { World } from '../world/world';
import { generateGauntlet } from './gauntlet';
import { generateRiftworks, RIFTWORKS_BLOCKS, RIFTWORKS_SEED } from './riftworks';
import { defaultSpawn } from './spawn';

export interface Level {
  id: string;
  name: string;
  /** One line telling the player what this level teaches. */
  hint: string;
  generate(world: World): { start: Vec3i; goal: Vec3i };
  /** Blocks the bot carries for bridges and pillars. */
  inventory: number;
  /** Weighted-A* weight the bot uses here. */
  weight: number;
  /** Player edits allowed (cells changed from the level as built); null = sandbox, anything goes. */
  budget: number | null;
  /**
   * Node counts for ★, ★★, ★★★; null = no stars (sandbox). Set from `CALIBRATE=1` in
   * tests/levels.test.ts: about 0.6×, 1× and 1.5× what a scripted hill-climb reaches.
   */
  stars: [number, number, number] | null;
  seed?: number;
}

const TOP = 8;

/** A roundish slab of grass over soil over stone, with a ragged rim and bottom. */
function slab(world: World, cx: number, cz: number, rx: number, rz: number, top = TOP, seed = 1): void {
  for (let z = 0; z < 64; z++)
    for (let x = 0; x < 64; x++) {
      const dx = (x + 0.5 - cx) / rx, dz = (z + 0.5 - cz) / rz;
      // A squarish ellipse (superellipse), so courses have room right to the corners.
      const d = Math.pow(Math.pow(Math.abs(dx), 4) + Math.pow(Math.abs(dz), 4), 0.25) + (fbm(x * 0.2, z * 0.2, seed) - 0.5) * 0.12;
      if (d > 1) continue;
      const depth = 3 + Math.floor((1 - d) * 5 + fbm(x * 0.3, z * 0.3, seed + 3) * 2);
      for (let y = top - depth; y <= top; y++)
        world.setRaw(x, y, z, y === top ? Mat.Grass : y >= top - 2 ? Mat.Soil : Mat.Stone);
    }
}

function begin(world: World): void {
  world.reset();
}

function finish(world: World, start: Vec3i, goal: Vec3i): { start: Vec3i; goal: Vec3i } {
  world.version++;
  world.markAllDirty();
  return { start, goal };
}

/** Raises a block of `m` from y0..y1 over the x/z box (inclusive). */
function box(world: World, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, m: Mat): void {
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) world.setRaw(x, y, z, m);
}

export const LEVELS: Level[] = [
  {
    id: 'first-wall',
    name: 'First wall',
    hint: 'Place blocks between the bot and the flag. Every cell it has to consider is a point.',
    inventory: 0,
    weight: 1,
    budget: 12,
    stars: [35, 55, 80],
    generate(world) {
      begin(world);
      slab(world, 32, 32, 15, 11, TOP, 2);
      return finish(world, [22, TOP + 1, 32], [42, TOP + 1, 32]);
    },
  },
  {
    id: 'hard-rock',
    name: 'Hard rock',
    hint: 'Grass and soil dig cheaply; stone costs 4× as much. Make it weigh digging against walking.',
    inventory: 0,
    weight: 1,
    budget: 16,
    stars: [150, 220, 320],
    generate(world) {
      begin(world);
      slab(world, 32, 32, 16, 14, TOP, 4);
      // A stone ridge with a soil gap in the middle: the cheap way through.
      box(world, 31, 32, TOP + 1, TOP + 3, 20, 44, Mat.Stone);
      box(world, 31, 32, TOP + 1, TOP + 3, 30, 34, Mat.Soil);
      return finish(world, [21, TOP + 1, 32], [43, TOP + 1, 32]);
    },
  },
  {
    id: 'moat',
    name: 'Moat',
    hint: 'The flag sits on an island. Swimming costs 3 per cell: make the water the best of bad options.',
    inventory: 0,
    weight: 1,
    budget: 20,
    stars: [380, 600, 900],
    generate(world) {
      begin(world);
      slab(world, 32, 32, 17, 17, TOP, 6);
      // A water ring sunk into the slab around the goal.
      for (let z = 0; z < 64; z++)
        for (let x = 0; x < 64; x++) {
          const r = Math.hypot(x + 0.5 - 40, z + 0.5 - 32);
          if (r > 3.2 && r < 6.2) world.setRaw(x, TOP, z, Mat.Water);
        }
      return finish(world, [20, TOP + 1, 32], [40, TOP + 1, 32]);
    },
  },
  {
    id: 'two-cliffs',
    name: 'Two cliffs',
    hint: 'The bot carries 6 blocks to bridge and climb. Spend its blocks before it gets to the gap.',
    inventory: 6,
    weight: 1,
    budget: 20,
    stars: [1000, 1900, 2800],
    generate(world) {
      begin(world);
      slab(world, 19, 32, 11, 13, TOP, 8);
      slab(world, 44, 32, 11, 13, TOP + 1, 9);
      return finish(world, [14, TOP + 1, 32], [50, TOP + 2, 32]);
    },
  },
  {
    id: 'crystal-garden',
    name: 'Crystal garden',
    hint: "Crystal can't be dug. Shape the pillars into a maze, but leave the flag reachable.",
    inventory: 4,
    weight: 1,
    budget: 24,
    stars: [100, 170, 250],
    generate(world) {
      begin(world);
      slab(world, 32, 32, 17, 16, TOP, 12);
      for (let z = 22; z <= 42; z += 4)
        for (let x = 24; x <= 40; x += 4) if ((x + z) % 8 === 2) box(world, x, x, TOP + 1, TOP + 3, z, z, Mat.Crystal);
      return finish(world, [19, TOP + 1, 32], [45, TOP + 1, 32]);
    },
  },
  {
    id: 'grand-course',
    name: 'Grand course',
    hint: 'Hills, a pond and lots of room. 60 edits, 8 blocks: build the hardest course you can.',
    inventory: 8,
    weight: 1,
    budget: 60,
    stars: [4500, 7500, 11000],
    generate(world) {
      generateTestIsland(world, 7);
      return defaultSpawn(world);
    },
  },
];

/** Free-form playgrounds: no budget, no stars, start and goal can be dragged. */
export const SANDBOXES: Level[] = [
  {
    id: 'sandbox',
    name: 'Free build',
    hint: 'No limits. Drag the bot and the flag, tune the A* weight, then share your course.',
    inventory: 16,
    weight: 1,
    budget: null,
    stars: null,
    generate(world) {
      generateTestIsland(world, 7);
      return defaultSpawn(world);
    },
  },
  {
    id: 'gauntlet',
    name: 'Gauntlet',
    hint: 'A test course that needs every move: swim, dig, bridge and pillar.',
    inventory: 16,
    weight: 1,
    budget: null,
    stars: null,
    generate: generateGauntlet,
  },
];

export const HEURISTIC_TRAP: Level = {
  id: 'heuristic-trap',
  name: 'Heuristic Trap',
  hint: 'Use up to 6 edits to make Weighted A* pay at least 2 more than A*. Both routes must reach the flag. Try the gap in the slate wall.',
  inventory: 0,
  weight: 1,
  budget: 6,
  stars: null,
  generate(world) {
    begin(world);
    slab(world, 32, 32, 15, 11, TOP, 2);
    box(world, 32, 32, TOP + 1, TOP + 3, 28, 31, Mat.Stone);
    box(world, 32, 32, TOP + 1, TOP + 3, 33, 36, Mat.Stone);
    return finish(world, [22, TOP + 1, 32], [42, TOP + 1, 32]);
  },
};

export const TRAP_COST_GAP = 2;

const RIFTWORKS_ID = 'riftworks';

export function riftworksLevel(seed = RIFTWORKS_SEED): Level {
  return {
    id: RIFTWORKS_ID,
    name: 'Riftworks',
    hint: 'Explore 36 rooms across rising terraces. Dig through slate gates, cross flooded rooms, or spend blocks to bridge rifts.',
    inventory: RIFTWORKS_BLOCKS,
    weight: 1,
    budget: null,
    stars: null,
    seed,
    generate: (world) => generateRiftworks(world, seed),
  };
}

export function levelById(id: string): Level | undefined {
  if (id === RIFTWORKS_ID) return riftworksLevel();
  return id === HEURISTIC_TRAP.id ? HEURISTIC_TRAP : LEVELS.find((l) => l.id === id) ?? SANDBOXES.find((l) => l.id === id);
}

/** How many stars a score earns on a level (0..3). */
export function starsFor(level: Level, nodes: number): number {
  if (!level.stars) return 0;
  return level.stars.filter((t) => nodes >= t).length;
}
