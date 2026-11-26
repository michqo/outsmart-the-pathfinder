import { describe, expect, it } from 'vitest';
import { archSpec, CELL, dailySeed, islandAt, islandsAround, isOpen, neighbours, type ArchIsland } from '../src/gen/archipelago';
import { islandParams } from '../src/gen/island';

const key = (a: ArchIsland) => `${a.ix},${a.iz}`;

describe('archipelago layout', () => {
  it('home always exists at the origin; layout is deterministic per seed', () => {
    for (const seed of [0, 1, 47, 0xffffffff]) {
      expect(islandAt(seed, 0, 0)).toMatchObject({ ring: 0, tier: 1, centre: [0, 0, 0] });
      expect(islandsAround(seed, 0, 0, 3)).toEqual(islandsAround(seed, 0, 0, 3));
    }
    expect(islandsAround(1, 0, 0, 3).map(key)).not.toEqual(islandsAround(2, 0, 0, 3).map(key));
  });

  it('tiers follow the rings; islands never overlap', () => {
    for (const seed of [3, 4, 5]) {
      const all = islandsAround(seed, 0, 0, 4);
      for (const a of all) expect(a.tier).toBe(Math.min(5, a.ring + 1));
      for (const a of all)
        for (const b of all) {
          if (a === b) continue;
          const ra = islandParams(archSpec(seed, a)).size / 2 + 8, rb = islandParams(archSpec(seed, b)).size / 2 + 8;
          const d = Math.hypot(a.centre[0] - b.centre[0], a.centre[2] - b.centre[2]);
          expect(d, `${key(a)} vs ${key(b)}`).toBeGreaterThan((ra + rb) * 0.75 + 10);
        }
      expect(Math.max(...all.map((a) => Math.abs(a.centre[0])))).toBeLessThan(5 * CELL);
    }
  });

  it('sizes grow outward, and the touch cap applies everywhere', () => {
    const seed = 11;
    for (const a of islandsAround(seed, 0, 0, 3)) {
      const size = islandParams(archSpec(seed, a)).size;
      expect(size).toBeLessThanOrEqual(a.ring === 0 ? 56 : a.ring === 1 ? 80 : 112);
      expect(islandParams(archSpec(seed, a, 80)).size).toBeLessThanOrEqual(80);
    }
  });

  it('bridges are symmetric, and every island up to ring 4 is reachable from home', () => {
    for (const seed of [1, 2, 3, 47, 2026, 99999]) {
      const all = islandsAround(seed, 0, 0, 4);
      for (const a of all)
        for (const b of neighbours(seed, a)) expect(neighbours(seed, b).map(key), `${key(a)}→${key(b)}`).toContain(key(a));
      const seen = new Set(['0,0']);
      const queue = [islandAt(seed, 0, 0)!];
      while (queue.length) {
        const a = queue.shift()!;
        for (const b of neighbours(seed, a)) if (!seen.has(key(b)) && b.ring <= 5) seen.add(key(b)), queue.push(b);
      }
      for (const a of all) expect(seen.has(key(a)), `seed ${seed}: ${key(a)} unreachable`).toBe(true);
    }
  });

  it('★ on an island opens its neighbours, nothing further', () => {
    const seed = 47;
    const stars = new Map<string, number>();
    const open = (a: ArchIsland) => isOpen(seed, a, (b) => stars.get(key(b)) ?? 0);
    const home = islandAt(seed, 0, 0)!;
    const ring1 = islandsAround(seed, 0, 0, 1).filter((a) => a.ring === 1);
    expect(open(home)).toBe(true);
    expect(ring1.some(open)).toBe(false);
    stars.set('0,0', 1);
    for (const a of neighbours(seed, home)) expect(open(a)).toBe(true);
    for (const a of islandsAround(seed, 0, 0, 3).filter((a) => a.ring >= 2))
      expect(open(a)).toBe(neighbours(seed, a).some((b) => b.ring === 0));
  });

  it('the daily seed changes by UTC day only', () => {
    expect(dailySeed(new Date('2026-11-26T00:01:00Z'))).toBe(dailySeed(new Date('2026-11-26T23:59:00Z')));
    expect(dailySeed(new Date('2026-11-26T12:00:00Z'))).not.toBe(dailySeed(new Date('2026-11-27T12:00:00Z')));
  });
});
