import type { PathResult } from '../path/astar';
import { canStand, isMoveValid, isSwimSpot, MoveKind, type Grid } from '../path/moves';
import type { Vec3i } from '../path/protocol';
import { Mat } from '../world/materials';
import { World, voxelCoords } from '../world/world';

const FALLBACK_MOVES = [MoveKind.Walk, MoveKind.Diagonal, MoveKind.Swim, MoveKind.StepUp, MoveKind.Drop];

export function resolveMove(grid: Grid, a: Vec3i, b: Vec3i, kind: number, blocks: number): number {
  if (isMoveValid(grid, a, b, kind, blocks)) return kind;
  return FALLBACK_MOVES.find((k) => isMoveValid(grid, a, b, k, blocks)) ?? -1;
}

export function digCells(grid: Grid, a: Vec3i, b: Vec3i, kind: number): Vec3i[] {
  if (kind === MoveKind.DigDown) return [[a[0], a[1] - 1, a[2]]];
  if (kind !== MoveKind.Dig) return [];
  return ([b, [b[0], b[1] + 1, b[2]]] satisfies Vec3i[]).filter((c) => grid.get(...c) !== Mat.Air);
}

export function placeCell(a: Vec3i, b: Vec3i, kind: number): Vec3i | null {
  if (kind === MoveKind.Bridge) return [b[0], b[1] - 1, b[2]];
  return kind === MoveKind.Pillar ? a : null;
}

/** Replays the route on a private copy. A duel scores the plan as drawn, without replanning. */
export function reachesFlag(world: World, path: PathResult, blocks: number): boolean {
  const replay = new World();
  replay.data.set(world.data);
  let a = voxelCoords(path.nodes[0]);
  const inhabitable = (c: Vec3i) => canStand(replay, ...c) || isSwimSpot(replay, ...c);
  if (!inhabitable(a)) return false;
  for (let i = 1; i < path.nodes.length; i++) {
    const b = voxelCoords(path.nodes[i]);
    const kind = resolveMove(replay, a, b, path.kinds[i], blocks);
    if (kind < 0) return false;
    for (const cell of digCells(replay, a, b, kind)) replay.setRaw(...cell, Mat.Air);
    const placed = placeCell(a, b, kind);
    if (placed) {
      replay.setRaw(...placed, Mat.Placed);
      blocks--;
    }
    if (!inhabitable(b)) return false;
    a = b;
  }
  return true;
}
