import { describe, expect, it } from 'vitest';
import { defaultSpawn } from '../src/levels/spawn';
import { AStar } from '../src/path/astar';
import { ChunkStore } from '../src/world/chunkStore';
import { Mat } from '../src/world/materials';
import { COLOR_TABLE_SIZE, meshChunk, type MeshOptions } from '../src/world/mesher';
import { generateTestIsland } from '../src/world/testIsland';
import { World, voxelCoords, voxelIndex } from '../src/world/world';

const opts: MeshOptions = { colorTable: new Float32Array(COLOR_TABLE_SIZE).fill(1), aoCurve: [0.5, 0.7, 0.85, 1], ao: true };

function island(): World {
  const w = new World();
  generateTestIsland(w, 7);
  return w;
}

function totalQuads(w: World): number {
  let q = 0;
  for (let cy = 0; cy < w.cy; cy++)
    for (let cz = 0; cz < w.cz; cz++)
      for (let cx = 0; cx < w.cx; cx++) {
        const m = meshChunk(w, cx, cy, cz, opts);
        q += m.opaque.quads + m.water.quads;
      }
  return q;
}

describe('world window', () => {
  it('index and coords round-trip for non-default sizes', () => {
    const d = { sx: 128, sy: 48, sz: 96 };
    for (const c of [[0, 0, 0], [127, 47, 95], [5, 30, 77]] as [number, number, number][]) expect(voxelCoords(d, voxelIndex(d, ...c))).toEqual(c);
  });

  it('reshape resizes, clears, and bumps the shape version', () => {
    const w = island();
    const shape = w.shapeVersion;
    w.reshape(128, 48, 128, [3, -4, 5]);
    expect([w.sx, w.sy, w.sz, w.cx, w.cy, w.cz]).toEqual([128, 48, 128, 8, 3, 8]);
    expect(w.data.length).toBe(128 * 48 * 128);
    expect(w.data.every((m) => m === Mat.Air)).toBe(true);
    expect(w.shapeVersion).toBe(shape + 1);
    expect(w.dirty.size).toBe(w.chunkCount);
    expect(() => w.reshape(100, 32, 64)).toThrow();
  });
});

describe('chunk store', () => {
  it('round-trips a window at a negative, unaligned origin', () => {
    const a = island();
    a.origin = [-40, -7, 70];
    const store = new ChunkStore();
    store.writeWindow(a);
    const b = new World();
    store.readWindow(b, [-40, -7, 70]);
    expect(b.data).toEqual(a.data);
    // Sky coordinates are the window's plus its origin.
    expect(store.get(-40 + 44, -7 + 12, 70 + 22)).toBe(a.get(44, 12, 22));
  });

  it('a window read at an offset sees the same sky shifted', () => {
    const a = island();
    const store = new ChunkStore();
    store.writeWindow(a);
    const b = new World();
    store.readWindow(b, [5, 1, -3]);
    for (const [x, y, z] of [[20, 10, 30], [40, 12, 20], [30, 14, 40]]) expect(b.get(x - 5, y - 1, z + 3)).toBe(a.get(x, y, z));
  });

  it('keeps only chunks with something in them', () => {
    const store = new ChunkStore();
    store.writeWindow(island());
    const stored = store.size;
    expect(stored).toBeGreaterThan(0);
    expect(stored).toBeLessThan(new World().chunkCount);
    const empty = new World();
    store.writeWindow(empty); // writing air back over the island drops its chunks
    expect(store.size).toBe(0);
    store.set(-1, -1, -1, Mat.Stone);
    expect(store.get(-1, -1, -1)).toBe(Mat.Stone);
    expect(store.size).toBe(1);
  });

  it('A* is identical on a window copied out of the store', () => {
    const a = island();
    const { start, goal } = defaultSpawn(a);
    const store = new ChunkStore();
    a.origin = [-100, 9, 37];
    store.writeWindow(a);
    const b = new World();
    store.readWindow(b, [-100, 9, 37]);
    const pa = new AStar(a, start, goal, 1, 4), pb = new AStar(b, start, goal, 1, 4);
    const ra = pa.run(), rb = pb.run();
    expect(rb!.nodes).toEqual(ra!.nodes);
    expect(rb!.cost).toBe(ra!.cost);
    expect(pb.expanded).toBe(pa.expanded);
  });

  it('a bigger window around the same island meshes and paths the same', () => {
    const a = island();
    const store = new ChunkStore();
    store.writeWindow(a);
    // A 128×48×128 window with the island in its middle (chunk-aligned, so greedy quads match).
    const big = new World(128, 48, 128);
    const off = [32, 16, 32] as const;
    store.readWindow(big, [-off[0], -off[1], -off[2]]);
    expect(totalQuads(big)).toBe(totalQuads(a));

    const { start, goal } = defaultSpawn(a);
    const shift = (c: readonly number[]) => [c[0] + off[0], c[1] + off[1], c[2] + off[2]] as [number, number, number];
    // No blocks: the bigger window then adds nothing the bot could use (it can't pillar above
    // the old ceiling), so the search is the same, just with shifted ids.
    const pa = new AStar(a, start, goal, 1, 0), pb = new AStar(big, shift(start), shift(goal), 1, 0);
    const ra = pa.run()!, rb = pb.run()!;
    expect(rb.cost).toBeCloseTo(ra.cost);
    expect(pb.expanded).toBe(pa.expanded);
    expect(Array.from(rb.nodes, (i) => voxelCoords(big, i))).toEqual(Array.from(ra.nodes, (i) => shift(voxelCoords(a, i))));
  });

  it('the debug big island generates, spawns and is solvable', () => {
    const w = new World();
    generateTestIsland(w, 7, 2);
    expect([w.sx, w.sy, w.sz]).toEqual([128, 48, 128]);
    const { start, goal } = defaultSpawn(w);
    expect(Math.hypot(start[0] - goal[0], start[2] - goal[2])).toBeGreaterThan(40);
    expect(new AStar(w, start, goal, 1, 8).run()).not.toBeNull();
  });
});
