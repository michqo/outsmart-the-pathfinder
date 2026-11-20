import { Mat, OPAQUE } from '../world/materials';

/**
 * The bot's move rules. ONE place for every rule and cost, so they're easy to tune and test.
 * The bot is 2 voxels tall: a node (x, y, z) is the cell its feet occupy.
 */

export interface Grid {
  get(x: number, y: number, z: number): number;
}

export const MoveKind = {
  Start: 0,
  Walk: 1,
  Diagonal: 2,
  StepUp: 3,
  Drop: 4,
} as const;
export type MoveKind = (typeof MoveKind)[keyof typeof MoveKind];

export const COST = {
  walk: 1,
  diagonal: 1.41,
  stepUp: 2,
  dropBase: 1,
  dropPerBlock: 0.5,
} as const;

/** Longest fall the bot will take on purpose. */
export const MAX_DROP = 3;

/** Something the bot can stand on. */
export const isSolid = (m: number): boolean => OPAQUE[m] === 1;
/** Something the bot's body can be inside. Water joins this in M3 (swimming). */
export const isOpen = (m: number): boolean => m === Mat.Air;

/** Feet and head cells are both free. */
export function isClear(g: Grid, x: number, y: number, z: number): boolean {
  return isOpen(g.get(x, y, z)) && isOpen(g.get(x, y + 1, z));
}

/** The bot can stand with its feet in (x, y, z). */
export function canStand(g: Grid, x: number, y: number, z: number): boolean {
  return isClear(g, x, y, z) && isSolid(g.get(x, y - 1, z));
}

export type MoveSink = (x: number, y: number, z: number, cost: number, kind: MoveKind) => void;

const CARDINAL = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;
const DIAGONAL = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;

/** Calls `out` for every move the bot can make from (x, y, z). Allocation-free. */
export function expandMoves(g: Grid, x: number, y: number, z: number, out: MoveSink): void {
  for (let i = 0; i < 4; i++) {
    const nx = x + CARDINAL[i][0], nz = z + CARDINAL[i][1];

    if (canStand(g, nx, y, nz)) {
      out(nx, y, nz, COST.walk, MoveKind.Walk);
    } else if (isClear(g, nx, y, nz)) {
      // Walk off the edge and fall to the first floor within MAX_DROP.
      for (let k = 1; k <= MAX_DROP; k++) {
        const ny = y - k;
        if (!isOpen(g.get(nx, ny, nz))) break;
        if (isSolid(g.get(nx, ny - 1, nz))) {
          out(nx, ny, nz, COST.dropBase + COST.dropPerBlock * k, MoveKind.Drop);
          break;
        }
      }
    }

    // Step up one block: needs room above the bot's head to hop.
    if (isOpen(g.get(x, y + 2, z)) && canStand(g, nx, y + 1, nz)) {
      out(nx, y + 1, nz, COST.stepUp, MoveKind.StepUp);
    }
  }

  // Diagonals: both side columns must be clear so the bot doesn't clip a corner.
  for (let i = 0; i < 4; i++) {
    const dx = DIAGONAL[i][0], dz = DIAGONAL[i][1];
    if (isClear(g, x + dx, y, z) && isClear(g, x, y, z + dz) && canStand(g, x + dx, y, z + dz)) {
      out(x + dx, y, z + dz, COST.diagonal, MoveKind.Diagonal);
    }
  }
}

/**
 * Admissible estimate: horizontal octile distance, plus the extra each level
 * up (a step-up costs 1 more than a walk) or down (0.5 per block dropped) adds.
 */
export function heuristic(x: number, y: number, z: number, gx: number, gy: number, gz: number): number {
  const dx = Math.abs(gx - x), dz = Math.abs(gz - z);
  const lo = Math.min(dx, dz), hi = Math.max(dx, dz);
  const dy = gy - y;
  const vertical = dy > 0 ? dy * (COST.stepUp - COST.walk) : -dy * COST.dropPerBlock;
  return (hi - lo) * COST.walk + lo * COST.diagonal + vertical;
}
