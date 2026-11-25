import { describe, expect, it } from 'vitest';
import { LEVELS, SANDBOXES, starsFor } from '../src/levels/levels';
import { AStar } from '../src/path/astar';
import { canStand } from '../src/path/moves';
import { Mat } from '../src/world/materials';
import { rng } from '../src/world/noise';
import { World } from '../src/world/world';

function solve(w: World, start: number[], goal: number[], weight: number, blocks: number) {
  const a = new AStar(w, start as [number, number, number], goal as [number, number, number], weight, blocks);
  const p = a.run();
  return { found: p !== null, expanded: a.expanded };
}

describe('built-in levels', () => {
  for (const level of [...LEVELS, ...SANDBOXES]) {
    it(`${level.name}: start and goal stand, and the bot can get there untouched`, () => {
      const w = new World();
      const { start, goal } = level.generate(w);
      expect(canStand(w, ...start) || w.get(...start) === Mat.Water).toBe(true);
      expect(canStand(w, ...goal)).toBe(true);
      const r = solve(w, start, goal, level.weight, level.inventory);
      expect(r.found).toBe(true);
      // An untouched level must not already earn a star.
      if (level.stars) expect(r.expanded).toBeLessThan(level.stars[0]);
    });
  }

  it('stars follow the targets', () => {
    const l = LEVELS[0];
    expect(starsFor(l, 0)).toBe(0);
    expect(starsFor(l, l.stars![0])).toBe(1);
    expect(starsFor(l, l.stars![2] + 1)).toBe(3);
  });
});

/**
 * CALIBRATE=1 npx vitest run tests/levels.test.ts
 * Greedy hill-climb: each edit, try random single-cell changes near the route and keep the
 * one that makes the bot expand the most nodes (while it can still arrive). Prints what a
 * determined (but not clever) player reaches, to set the star targets from.
 */
describe.runIf((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.CALIBRATE)('star calibration', () => {
  for (const level of LEVELS) {
    it(`calibrates ${level.name}`, { timeout: 600_000 }, () => {
      const w = new World();
      const { start, goal } = level.generate(w);
      const rand = rng(1);
      const base = solve(w, start, goal, level.weight, level.inventory).expanded;
      let best = base;
      const x0 = Math.min(start[0], goal[0]) - 8, x1 = Math.max(start[0], goal[0]) + 8;
      const z0 = Math.min(start[2], goal[2]) - 10, z1 = Math.max(start[2], goal[2]) + 10;
      const mats = [Mat.Soil, Mat.Stone, Mat.Crystal, Mat.Water];
      let used = 0;
      while (used < level.budget!) {
        let pick: [number, number, number, number, number] | null = null;
        let bestGain = 0;
        for (let t = 0; t < 80; t++) {
          const x = x0 + Math.floor(rand() * (x1 - x0)), z = z0 + Math.floor(rand() * (z1 - z0));
          let y = 30;
          while (y > 1 && w.get(x, y - 1, z) === Mat.Air) y--;
          if (y <= 1) continue;
          if ((x === goal[0] && z === goal[2]) || (x === start[0] && z === start[2])) continue;
          const m = mats[Math.floor(rand() * mats.length)];
          const h = m === Mat.Water ? 1 : Math.min(1 + Math.floor(rand() * 2), level.budget! - used);
          const before = [w.get(x, y, z), w.get(x, y + 1, z)];
          for (let k = 0; k < h; k++) w.setRaw(x, y + k, z, m);
          const r = solve(w, start, goal, level.weight, level.inventory);
          for (let k = 0; k < h; k++) w.setRaw(x, y + k, z, before[k] as Mat);
          const gain = (r.expanded - best) / h;
          if (r.found && gain > bestGain) (bestGain = gain), (pick = [x, y, z, m, h]);
        }
        if (!pick) {
          used++;
          continue;
        }
        for (let k = 0; k < pick[4]; k++) w.setRaw(pick[0], pick[1] + k, pick[2], pick[3] as Mat);
        best = solve(w, start, goal, level.weight, level.inventory).expanded;
        used += pick[4];
      }
      console.log(`${level.id}: untouched ${base}, hill-climb ${best} with ${level.budget} edits`);
    });
  }
});
