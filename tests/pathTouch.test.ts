import { describe, expect, it } from 'vitest';
import { pathFootprint, stepFootprint, touching } from '../src/bot/pathTouch';
import { MoveKind } from '../src/path/moves';
import { voxelIndex } from '../src/world/world';

type Step = [number, number, number, number]; // x, y, z, kind
const path = (...steps: Step[]) => ({
  nodes: Int32Array.from(steps, ([x, y, z]) => voxelIndex(x, y, z)),
  kinds: Uint8Array.from(steps, (s) => s[3]),
});
const has = (fp: Set<number>, x: number, y: number, z: number) => fp.has(voxelIndex(x, y, z));

describe('path footprint', () => {
  it('a walk depends on the target feet, head and floor', () => {
    const { nodes, kinds } = path([5, 5, 5, MoveKind.Start], [6, 5, 5, MoveKind.Walk]);
    const fp = stepFootprint(nodes, kinds, 0);
    expect(has(fp, 6, 5, 5)).toBe(true);
    expect(has(fp, 6, 6, 5)).toBe(true);
    expect(has(fp, 6, 4, 5)).toBe(true);
    expect(has(fp, 7, 5, 5)).toBe(false);
    expect(fp.size).toBe(3);
  });

  it('a step-up also needs hop room above the start', () => {
    const { nodes, kinds } = path([5, 5, 5, MoveKind.Start], [6, 6, 5, MoveKind.StepUp]);
    expect(has(stepFootprint(nodes, kinds, 0), 5, 7, 5)).toBe(true);
  });

  it('a diagonal depends on both side columns it squeezes past', () => {
    const { nodes, kinds } = path([5, 5, 5, MoveKind.Start], [6, 5, 6, MoveKind.Diagonal]);
    const fp = stepFootprint(nodes, kinds, 0);
    for (const [x, z] of [[6, 5], [5, 6]]) {
      expect(has(fp, x, 5, z)).toBe(true);
      expect(has(fp, x, 6, z)).toBe(true);
    }
  });

  it('a drop depends on the whole air column it falls through', () => {
    const { nodes, kinds } = path([5, 8, 5, MoveKind.Start], [6, 5, 5, MoveKind.Drop]);
    const fp = stepFootprint(nodes, kinds, 0);
    for (let y = 4; y <= 9; y++) expect(has(fp, 6, y, 5)).toBe(true);
  });

  it('pathFootprint covers only the remaining steps', () => {
    const { nodes, kinds } = path(
      [1, 5, 1, MoveKind.Start],
      [2, 5, 1, MoveKind.Walk],
      [3, 5, 1, MoveKind.Walk],
      [4, 5, 1, MoveKind.Walk],
    );
    const rest = pathFootprint(nodes, kinds, 1);
    expect(has(rest, 2, 5, 1)).toBe(false); // already walked
    expect(has(rest, 3, 5, 1)).toBe(true);
    expect(has(rest, 4, 4, 1)).toBe(true);
  });

  it('touching returns only the edited cells that matter', () => {
    const { nodes, kinds } = path([1, 5, 1, MoveKind.Start], [2, 5, 1, MoveKind.Walk]);
    const fp = pathFootprint(nodes, kinds, 0);
    const onPath = voxelIndex(2, 4, 1), elsewhere = voxelIndex(9, 5, 9);
    expect(touching([elsewhere], fp)).toEqual([]);
    expect(touching([elsewhere, onPath], fp)).toEqual([onPath]);
  });
});
