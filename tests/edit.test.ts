import { describe, expect, it } from 'vitest';
import { EditHistory } from '../src/edit/history';
import { pickVoxel } from '../src/edit/pick';
import { Mat } from '../src/world/materials';
import { World } from '../src/world/world';

describe('pickVoxel', () => {
  it('hits the top face of a block from above', () => {
    const w = new World();
    w.set(5, 5, 5, Mat.Stone);
    expect(pickVoxel(w, 5.5, 20, 5.5, 0, -1, 0)).toMatchObject({ x: 5, y: 5, z: 5, nx: 0, ny: 1, nz: 0 });
  });

  it('enters the volume from outside at an angle', () => {
    const w = new World();
    w.set(0, 3, 10, Mat.Soil);
    const d = Math.SQRT1_2;
    expect(pickVoxel(w, -10.5, 14.2, 10.5, d, -d, 0)).toMatchObject({ x: 0, y: 3, z: 10, nx: -1, ny: 0 });
  });

  it('returns null when nothing is hit', () => {
    expect(pickVoxel(new World(), 5, 5, 5, 0, 1, 0, 50)).toBeNull();
  });
});

describe('EditHistory', () => {
  it('undoes and redoes a multi-voxel action', () => {
    const w = new World();
    const h = new EditHistory();
    w.set(1, 1, 1, Mat.Stone);
    const n = h.edit(w, (set) => {
      set(1, 1, 1, Mat.Air);
      set(2, 1, 1, Mat.Grass);
      set(3, 1, 1, Mat.Air); // no-op, not recorded
    });
    expect(n).toBe(2);
    h.undo(w);
    expect([w.get(1, 1, 1), w.get(2, 1, 1)]).toEqual([Mat.Stone, Mat.Air]);
    h.redo(w);
    expect([w.get(1, 1, 1), w.get(2, 1, 1)]).toEqual([Mat.Air, Mat.Grass]);
  });

  it('ignores out-of-bounds writes', () => {
    const w = new World();
    expect(new EditHistory().edit(w, (set) => set(-1, 0, 0, Mat.Stone))).toBe(0);
  });
});
