import { MoveKind } from '../path/moves';
import { inBounds, voxelCoords, voxelIndex, type Dims } from '../world/world';

/**
 * Which voxels a planned path depends on, so an edit can be checked against it.
 *
 * A step a → b depends on: b's feet, head and floor (what it stands in / on), plus
 * per move kind: the hop-room above a (step-up, pillar), the two side columns a
 * diagonal squeezes past, and the air column a drop falls through. Dig and bridge
 * cells are b's feet/head and b's floor, so they're covered by the first rule.
 */
export function stepFootprint(d: Dims, nodes: Int32Array, kinds: Uint8Array, i: number, out: Set<number> = new Set()): Set<number> {
  if (i < 0 || i + 1 >= nodes.length) return out;
  const [ax, ay, az] = voxelCoords(d, nodes[i]);
  const [bx, by, bz] = voxelCoords(d, nodes[i + 1]);
  const add = (x: number, y: number, z: number) => {
    if (inBounds(d, x, y, z)) out.add(voxelIndex(d, x, y, z));
  };
  add(bx, by, bz);
  add(bx, by + 1, bz);
  add(bx, by - 1, bz);
  switch (kinds[i + 1]) {
    case MoveKind.StepUp:
    case MoveKind.Pillar:
      add(ax, ay + 2, az);
      break;
    case MoveKind.Diagonal:
      add(bx, ay, az);
      add(bx, ay + 1, az);
      add(ax, ay, bz);
      add(ax, ay + 1, bz);
      break;
    case MoveKind.Drop:
      for (let y = by + 1; y <= ay + 1; y++) add(bx, y, bz);
      break;
  }
  return out;
}

/** Everything the path depends on from step `from` (node from → from+1) to the goal. */
export function pathFootprint(d: Dims, nodes: Int32Array, kinds: Uint8Array, from: number): Set<number> {
  const out = new Set<number>();
  for (let i = Math.max(0, from); i + 1 < nodes.length; i++) stepFootprint(d, nodes, kinds, i, out);
  return out;
}

/** The edited cells that hit the footprint (empty = the edit doesn't matter to the path). */
export function touching(cells: readonly number[], footprint: Set<number>): number[] {
  return cells.filter((c) => footprint.has(c));
}
