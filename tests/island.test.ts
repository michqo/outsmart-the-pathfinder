import { describe, expect, it } from 'vitest';
import { Biome, generateIsland, GEN_VERSION, islandKey, islandParams, ISLAND_SIZE, type IslandSpec } from '../src/gen/island';
import { islandLevel } from '../src/levels/levels';
import { defaultSpawn } from '../src/levels/spawn';
import { AStar } from '../src/path/astar';
import { canStand } from '../src/path/moves';
import { Mat } from '../src/world/materials';
import { CS, World } from '../src/world/world';

const fnv = (d: Uint8Array) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < d.length; i++) h = Math.imul(h ^ d[i], 0x01000193);
  return (h >>> 0).toString(16);
};

const SEEDS = Array.from({ length: 24 }, (_, i) => i * 7919 + 1);

describe('island generator', () => {
  /**
   * Golden hashes: the same spec must give the same island on every machine and browser.
   * If you change the generator on purpose, bump GEN_VERSION and update these.
   */
  it(`v${GEN_VERSION} output matches the golden hashes`, () => {
    expect(GEN_VERSION).toBe(3);
    const golden: [IslandSpec, string, string][] = [
      [{ seed: 1, ix: 0, iz: 0 }, 'c1aa4408', '7c2a73e7'],
      [{ seed: 99999, ix: 0, iz: 0 }, 'cceb72be', '17fbc8ca'],
      [{ seed: 47, ix: 3, iz: -2 }, 'df25a820', '110317a7'],
      [{ seed: 99999, ix: 0, iz: 0, maxSize: 80 }, '82fa0621', '45c3fb76'], // 107 across, capped to 80
    ];
    for (const [spec, data, biome] of golden) {
      const isl = generateIsland(spec);
      expect([fnv(isl.data), fnv(isl.biome)], JSON.stringify(spec)).toEqual([data, biome]);
    }
  });

  it('no two islands of an archipelago share a key (v1 had mirror-image twins)', () => {
    const keys = new Set<number>();
    for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) keys.add(islandKey({ seed: 2899456169, ix: x, iz: z }));
    expect(keys.size).toBe(17 * 17);
  });

  it('is deterministic, and every island of an archipelago differs', () => {
    const a = generateIsland({ seed: 5, ix: 1, iz: 2 });
    const b = generateIsland({ seed: 5, ix: 1, iz: 2 });
    expect(fnv(a.data)).toBe(fnv(b.data));
    expect(fnv(generateIsland({ seed: 5, ix: 2, iz: 1 }).data)).not.toBe(fnv(a.data));
    expect(fnv(generateIsland({ seed: 6, ix: 1, iz: 2 }).data)).not.toBe(fnv(a.data));
  });

  it('sizes stay in range, and a size cap shrinks only the big ones', () => {
    for (const seed of SEEDS) {
      const { size } = islandParams({ seed, ix: 0, iz: 0 });
      expect(size).toBeGreaterThanOrEqual(ISLAND_SIZE.min);
      expect(size).toBeLessThanOrEqual(ISLAND_SIZE.max);
      const capped = generateIsland({ seed, ix: 0, iz: 0, maxSize: 80 });
      expect(capped.size).toBe(Math.min(size, 80));
      expect(capped.dims.sx).toBeLessThanOrEqual(96);
    }
  });

  for (const seed of SEEDS.slice(0, 12)) {
    it(`seed ${seed}: fits its window, one landmass, water held up, solvable`, () => {
      const isl = generateIsland({ seed, ix: 0, iz: 0 });
      const { sx, sy, sz } = isl.dims;
      expect(sx % CS).toBe(0);
      expect(sy).toBe(48);
      expect(isl.data.length).toBe(sx * sy * sz);
      expect(isl.stats.ms).toBeLessThan(150);
      expect(isl.stats.land).toBeGreaterThan(ISLAND_SIZE.min * ISLAND_SIZE.min * 0.4);

      const w = new World(sx, sy, sz);
      w.data.set(isl.data);
      const columns = new Uint8Array(sx * sz);
      for (let z = 0; z < sz; z++)
        for (let x = 0; x < sx; x++) {
          for (let y = 0; y < sy; y++) {
            const m = w.get(x, y, z);
            if (m === Mat.Air) continue;
            columns[x + z * sx] = 1;
            // Nothing on the floor of the window, a margin round the edge, headroom on top.
            expect(y).toBeGreaterThan(0);
            expect(x >= 3 && z >= 3 && x < sx - 3 && z < sz - 3).toBe(true);
            if (m !== Mat.Crystal) expect(y).toBeLessThan(sy - 8);
            // Water never floats.
            if (m === Mat.Water) expect(w.get(x, y - 1, z)).not.toBe(Mat.Air);
          }
          if (columns[x + z * sx]) expect(isl.biome[x + z * sx]).not.toBe(Biome.None);
        }
      expect(components(columns, sx, sz)).toBe(1);

      const { start, goal } = defaultSpawn(w);
      expect(canStand(w, ...start)).toBe(true);
      expect(canStand(w, ...goal)).toBe(true);
      expect(new AStar(w, start, goal, 1, 16).run(), 'path with 16 blocks').not.toBeNull();
    });
  }

  it('every biome shows up across seeds', () => {
    const seen = new Set<number>();
    for (const seed of SEEDS) generateIsland({ seed, ix: 0, iz: 0 }).biome.forEach((b) => seen.add(b));
    for (const b of Object.values(Biome)) expect(seen.has(b), `biome ${b}`).toBe(true);
  });

  it('deeper islands: caves on every island, arches and ruins across seeds', () => {
    let arches = 0, ruins = 0;
    for (const seed of SEEDS) {
      const isl = generateIsland({ seed, ix: 0, iz: 0 });
      expect(isl.stats.caves, `caves on seed ${seed}`).toBeGreaterThan(0);
      arches += isl.stats.arches;
      if (isl.stats.ruins > 0) ruins++;
    }
    expect(arches).toBeGreaterThan(0);
    expect(ruins).toBeGreaterThanOrEqual(SEEDS.length / 2);
  });

  it('caves are roofed and the bot can walk into them on most islands', () => {
    let reachable = 0;
    for (const seed of SEEDS.slice(0, 12)) {
      const isl = generateIsland({ seed, ix: 0, iz: 0 });
      const { sx, sy, sz } = isl.dims;
      const w = new World(sx, sy, sz);
      w.data.set(isl.data);
      const { start } = defaultSpawn(w);
      // Flood the cells the bot can stand in, stepping at most one up or down.
      const key = (x: number, y: number, z: number) => x + z * sx + y * sx * sz;
      const seen = new Set([key(...start)]);
      const stack = [start];
      let roofed = false;
      while (stack.length && !roofed) {
        const [x, y, z] = stack.pop()!;
        for (let up = y + 2; up < sy; up++) if (w.get(x, up, z) !== Mat.Air && w.get(x, up, z) !== Mat.Leaves && w.get(x, up, z) !== Mat.Timber) { roofed = true; break; }
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
          for (const dy of [0, 1, -1]) {
            const n: [number, number, number] = [x + dx, y + dy, z + dz];
            if (seen.has(key(...n)) || !canStand(w, ...n)) continue;
            seen.add(key(...n));
            stack.push(n);
            break;
          }
      }
      if (roofed) reachable++;
    }
    expect(reachable).toBeGreaterThanOrEqual(8);
  });

  it('the island level loads into a world and can be reset to it', () => {
    const level = islandLevel({ seed: 1234, ix: 0, iz: 0 });
    const w = new World();
    const a = level.generate(w);
    const first = fnv(w.data);
    expect(level.biome?.length).toBe(w.sx * w.sz);
    w.reset();
    const b = level.generate(w);
    expect(fnv(w.data)).toBe(first);
    expect(b).toEqual(a);
  });
});

function components(cells: Uint8Array, sx: number, sz: number): number {
  const seen = new Uint8Array(cells.length);
  let n = 0;
  for (let s = 0; s < cells.length; s++) {
    if (!cells[s] || seen[s]) continue;
    n++;
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % sx;
      for (const j of [x > 0 ? i - 1 : -1, x < sx - 1 ? i + 1 : -1, i - sx, i + sx]) {
        if (j < 0 || j >= sx * sz || seen[j] || !cells[j]) continue;
        seen[j] = 1;
        stack.push(j);
      }
    }
  }
  return n;
}
