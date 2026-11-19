import { describe, expect, it } from 'vitest';
import { Mat } from '../src/world/materials';
import { COLOR_TABLE_SIZE, meshChunk, type MeshOptions } from '../src/world/mesher';
import { World } from '../src/world/world';

const opts: MeshOptions = { colorTable: new Float32Array(COLOR_TABLE_SIZE).fill(1), aoCurve: [0.5, 0.7, 0.85, 1], ao: true };

describe('greedy mesher', () => {
  it('meshes a single block as 6 quads', () => {
    const w = new World();
    w.set(3, 3, 3, Mat.Stone);
    expect(meshChunk(w, 0, 0, 0, opts).opaque.quads).toBe(6);
  });

  it('merges a 4-long bar into 6 quads', () => {
    const w = new World();
    for (let x = 2; x < 6; x++) w.set(x, 3, 3, Mat.Stone);
    expect(meshChunk(w, 0, 0, 0, opts).opaque.quads).toBe(6);
  });

  it('does not merge different materials', () => {
    const w = new World();
    w.set(2, 3, 3, Mat.Stone);
    w.set(3, 3, 3, Mat.Soil);
    expect(meshChunk(w, 0, 0, 0, opts).opaque.quads).toBe(10);
  });

  it('never duplicates faces across a chunk border', () => {
    const w = new World();
    w.set(15, 3, 3, Mat.Stone);
    w.set(16, 3, 3, Mat.Stone);
    const total = meshChunk(w, 0, 0, 0, opts).opaque.quads + meshChunk(w, 1, 0, 0, opts).opaque.quads;
    expect(total).toBe(10); // 5 per block; the shared face is hidden
  });

  it('darkens corners next to a wall', () => {
    const w = new World();
    w.set(3, 3, 3, Mat.Stone); // floor
    w.set(4, 4, 3, Mat.Stone); // wall beside the floor's top face
    const { colors } = meshChunk(w, 0, 0, 0, opts).opaque;
    expect(Math.min(...colors)).toBeLessThan(1);
  });

  it('meshes water separately, only against air', () => {
    const w = new World();
    w.set(3, 3, 3, Mat.Water);
    w.set(3, 2, 3, Mat.Stone);
    const { opaque, water } = meshChunk(w, 0, 0, 0, opts);
    expect(water.quads).toBe(5); // no face against the stone below
    expect(opaque.quads).toBe(6); // stone top shows through the translucent water
  });
});
