import { beforeEach, describe, expect, it } from 'vitest';
import { islandAt, isOpen, neighbours } from '../src/gen/archipelago';
import { downsample } from '../src/gen/lod';
import { archPosition, islandProgress, recordIsland, resetArchProgressCache, setArchPosition, starredCount } from '../src/levels/archProgress';
import { Mat } from '../src/world/materials';

const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
});

describe('archipelago progress', () => {
  beforeEach(() => {
    store.clear();
    resetArchProgressCache();
  });

  it('remembers where you were, across reloads', () => {
    expect(archPosition()).toBeNull();
    setArchPosition(42, [1, -1]);
    resetArchProgressCache();
    expect(archPosition()).toEqual({ seed: 42, at: [1, -1] });
  });

  it('keeps the best and never loses stars; caps and seeds are separate', () => {
    expect(recordIsland(7, 0, 0, undefined, 100, 2)).toBe(true);
    expect(recordIsland(7, 0, 0, undefined, 90, 1)).toBe(false);
    expect(islandProgress(7, 0, 0)).toEqual({ best: 100, stars: 2 });
    expect(islandProgress(7, 0, 0, 80)).toEqual({ best: 0, stars: 0 });
    expect(islandProgress(8, 0, 0)).toEqual({ best: 0, stars: 0 });
    recordIsland(7, 1, 0, undefined, 5, 0);
    expect(starredCount(7)).toBe(1);
  });

  it('a ★ at home opens its neighbours and nothing further', () => {
    const seed = 3;
    const home = islandAt(seed, 0, 0)!;
    recordIsland(seed, 0, 0, undefined, 50, 1);
    const stars = (a: { ix: number; iz: number }) => islandProgress(seed, a.ix, a.iz).stars;
    for (const n of neighbours(seed, home)) expect(isOpen(seed, n, stars)).toBe(true);
    const far = [3, 4].flatMap((r) => [islandAt(seed, r, 0), islandAt(seed, 0, -r)]).filter((a) => a && !neighbours(seed, a).some((b) => b.ring === 0));
    for (const a of far) expect(isOpen(seed, a!, stars)).toBe(false);
  });
});

describe('distant-view downsampling', () => {
  it('keeps grassy tops, drops thin bits, and pads to chunks', () => {
    const d = { sx: 8, sy: 8, sz: 8 };
    const data = new Uint8Array(512);
    const at = (x: number, y: number, z: number) => x + z * 8 + y * 64;
    // A 4×4×4 block of stone topped with grass, plus a lone voxel elsewhere.
    for (let y = 0; y < 4; y++) for (let z = 0; z < 4; z++) for (let x = 0; x < 4; x++) data[at(x, y, z)] = y === 3 ? Mat.Grass : Mat.Stone;
    data[at(6, 6, 6)] = Mat.Stone;
    const lod = downsample(data, d, 4);
    expect(lod.dims).toEqual({ sx: 16, sy: 16, sz: 16 });
    expect(lod.data[0]).toBe(Mat.Grass);
    expect(lod.data[1 + 16 + 256]).toBe(Mat.Air);
  });
});
