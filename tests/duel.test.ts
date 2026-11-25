import { describe, expect, it } from 'vitest';
import { reachesFlag } from '../src/bot/route';
import { HEURISTIC_TRAP, LEVELS, TRAP_COST_GAP } from '../src/levels/levels';
import { generateRiftworks, RIFTWORKS_BLOCKS, RIFTWORKS_SEED } from '../src/levels/riftworks';
import { AStar } from '../src/path/astar';
import { isSolid, MoveKind } from '../src/path/moves';
import { Mat } from '../src/world/materials';
import { DEFAULT_DIMS as D, World, voxelIndex } from '../src/world/world';

describe('Algorithm Duel', () => {
  it('Dijkstra finds the same minimum cost as A* but expands more states on the tutorial', () => {
    const world = new World();
    const { start, goal } = LEVELS[0].generate(world);
    const dijkstra = new AStar(world, start, goal, 0);
    const astar = new AStar(world, start, goal, 1);
    expect(dijkstra.run()?.cost).toBe(20);
    expect(astar.run()?.cost).toBe(20);
    expect(dijkstra.expanded).toBeGreaterThan(astar.expanded);
  });

  it('Heuristic Trap starts unsolved and can exceed its cost target within the edit budget', () => {
    const world = new World();
    const { start, goal } = HEURISTIC_TRAP.generate(world);
    const solve = () => {
      const baseline = new AStar(world, start, goal, 1).run()!;
      const weighted = new AStar(world, start, goal, 5).run()!;
      expect(reachesFlag(world, baseline, 0)).toBe(true);
      expect(reachesFlag(world, weighted, 0)).toBe(true);
      return weighted.cost - baseline.cost;
    };
    expect(solve()).toBe(0);
    world.set(32, 9, 32, Mat.Stone);
    world.set(32, 10, 32, Mat.Stone);
    expect(solve()).toBeGreaterThanOrEqual(TRAP_COST_GAP);
    expect(world.get(32, 9, 32)).toBe(Mat.Stone);
    expect(world.get(32, 10, 32)).toBe(Mat.Stone);
  });

  it('does not count a planned route that runs out of blocks', () => {
    const world = new World();
    world.set(2, 1, 2, Mat.Stone);
    const nodes = Int32Array.of(voxelIndex(D, 2, 2, 2), voxelIndex(D, 3, 2, 2), voxelIndex(D, 4, 2, 2));
    const kinds = Uint8Array.of(MoveKind.Start, MoveKind.Bridge, MoveKind.Bridge);
    expect(reachesFlag(world, { nodes, kinds, cost: 6 }, 2)).toBe(true);
    expect(reachesFlag(world, { nodes, kinds, cost: 6 }, 1)).toBe(false);
    expect(world.get(3, 1, 2)).toBe(Mat.Air);
  });

  it('generates reproducible but distinct layouts with a connected walking route', () => {
    const a = new World(), b = new World();
    const { start, goal } = generateRiftworks(a, RIFTWORKS_SEED);
    generateRiftworks(b, RIFTWORKS_SEED);
    expect(a.data.every((m, i) => m === b.data[i])).toBe(true);
    generateRiftworks(b, 0xffffffff);
    expect(a.data.some((m, i) => m !== b.data[i])).toBe(true);
    for (const seed of [0, 1, RIFTWORKS_SEED, 99, 0xffffffff]) {
      generateRiftworks(a, seed);
      const walkOnly = {
        sx: a.sx, sy: a.sy, sz: a.sz,
        get(x: number, y: number, z: number) {
          const m = a.get(x, y, z);
          return isSolid(m) ? Mat.Crystal : m;
        },
      };
      const route = new AStar(walkOnly, start, goal, 1).run();
      expect(route && reachesFlag(a, route, 0), `seed ${seed}`).toBe(true);
      expect(route?.kinds.includes(MoveKind.Swim), `seed ${seed}`).toBe(false);
    }
  });

  it('keeps the Dijkstra cost and explores fewer states on the Riftworks benchmark', () => {
    const world = new World();
    const { start, goal } = generateRiftworks(world, RIFTWORKS_SEED);
    const solve = (weight: number, prune = false) => {
      const search = new AStar(world, start, goal, weight, RIFTWORKS_BLOCKS, prune);
      const at = performance.now();
      const route = search.run()!;
      return { route, expanded: search.expanded, ms: performance.now() - at };
    };
    const dijkstra = solve(0), astar = solve(1), pareto = solve(1, true);
    if ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.BENCHMARK) {
      console.table([dijkstra, astar, pareto].map(({ route, expanded, ms }) => ({ cost: route.cost, expanded, ms })));
    }
    expect(pareto.route.cost).toBeCloseTo(dijkstra.route.cost, 2);
    expect(reachesFlag(world, pareto.route, RIFTWORKS_BLOCKS)).toBe(true);
    expect(pareto.expanded).toBeLessThan(astar.expanded * 0.65);
  });
});
