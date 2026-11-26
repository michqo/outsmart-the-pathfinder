import { describe, expect, it } from 'vitest';
import { reachesFlag } from '../src/bot/route';
import { FLAT } from './fixtures/courses';
import { AStar } from '../src/path/astar';
import { MoveKind } from '../src/path/moves';
import { Mat } from '../src/world/materials';
import { DEFAULT_DIMS as D, World, voxelIndex } from '../src/world/world';

describe('Algorithm Duel', () => {
  it('Dijkstra finds the same minimum cost as A* but expands more states on a flat slab', () => {
    const world = new World();
    const { start, goal } = FLAT.generate(world);
    const dijkstra = new AStar(world, start, goal, 0);
    const astar = new AStar(world, start, goal, 1);
    expect(dijkstra.run()?.cost).toBe(20);
    expect(astar.run()?.cost).toBe(20);
    expect(dijkstra.expanded).toBeGreaterThan(astar.expanded);
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
});
