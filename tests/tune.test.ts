import { describe, expect, it } from 'vitest';
import { generateIsland, islandKey, type IslandSpec } from '../src/gen/island';
import { solve, starTargets, TIERS, tuneIsland } from '../src/gen/tune';
import { islandLevel } from '../src/levels/levels';
import { canStand } from '../src/path/moves';
import { Mat } from '../src/world/materials';
import { World } from '../src/world/world';

function load(spec: IslandSpec): World {
  const isl = generateIsland(spec);
  const w = new World(isl.dims.sx, isl.dims.sy, isl.dims.sz);
  w.data.set(isl.data);
  return w;
}

const CASES: [number, number][] = [
  [1, 1], [1, 5], [7920, 2], [7920, 4], [15839, 3], [15839, 5], [2026, 1], [2026, 4], [99999, 3],
];

describe('search-aware tuning', () => {
  for (const [seed, tier] of CASES) {
    it(`seed ${seed}, tier ${tier}: solvable, untouched < ★, ★★★ reached by replaying the climb`, { timeout: 60_000 }, () => {
      const spec = { seed, ix: 0, iz: 0 };
      const w = load(spec);
      const t = tuneIsland(w, tier, islandKey(spec));
      const rules = TIERS[tier - 1];
      expect([t.budget, t.blocks]).toEqual([rules.budget, rules.blocks]);
      expect(canStand(w, ...t.start)).toBe(true);
      expect(canStand(w, ...t.goal)).toBe(true);

      // Untouched: the bot gets there, and it doesn't already earn a star.
      const untouched = solve(w, t.start, t.goal, t.blocks);
      expect(untouched).not.toBeNull();
      expect(untouched!.expanded).toBe(t.untouched);
      expect(t.untouched).toBeLessThanOrEqual(rules.maxUntouched);
      expect(t.untouched).toBeLessThan(t.stars[0]);
      expect(t.stars[0]).toBeLessThan(t.stars[1]);
      expect(t.stars[1]).toBeLessThan(t.stars[2]);

      // The climb's edits fit the budget, only fill air, and reach ★★★ with the bot arriving.
      expect(t.proof.length / 4).toBeLessThanOrEqual(t.budget);
      for (let i = 0; i < t.proof.length; i += 4) {
        const [x, y, z, m] = t.proof.slice(i, i + 4);
        expect(w.get(x, y, z)).toBe(Mat.Air);
        w.set(x, y, z, m as Mat);
      }
      const climbed = solve(w, t.start, t.goal, t.blocks);
      expect(climbed).not.toBeNull();
      expect(climbed!.expanded).toBe(t.climbed);
      expect(t.climbed).toBeGreaterThanOrEqual(t.stars[2]);
    });
  }

  it('is deterministic', () => {
    const spec = { seed: 15839, ix: 0, iz: 0 };
    const a = tuneIsland(load(spec), 3, islandKey(spec));
    const b = tuneIsland(load(spec), 3, islandKey(spec));
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('star targets: ordered, above the untouched search, ★★★ never above the climb', () => {
    for (const [u, c] of [[100, 100], [100, 101], [100, 200], [441, 574], [4394, 20269], [5, 9000]]) {
      const [one, two, three] = starTargets(u, c);
      expect(u).toBeLessThan(one);
      expect(one).toBeLessThan(two);
      expect(two).toBeLessThan(three);
      if (c - u >= 3) expect(three).toBeLessThanOrEqual(c);
    }
  });

  it('a tuned island level is a challenge with the survey’s rules', () => {
    const spec = { seed: 2026, ix: 0, iz: 0 };
    const t = tuneIsland(load(spec), 2, islandKey(spec));
    const level = islandLevel(2026, undefined, undefined, t);
    expect(level.id).toBe('island:2026:t2');
    expect([level.budget, level.inventory, level.stars, level.tier]).toEqual([t.budget, t.blocks, t.stars, 2]);
    const w = new World();
    expect(level.generate(w)).toEqual({ start: t.start, goal: t.goal });
    expect(islandLevel(2026, undefined, 80, t).id).toBe('island:2026:t2:s80');
  });
});
