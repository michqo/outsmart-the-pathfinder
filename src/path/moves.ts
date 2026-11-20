import { Mat, OPAQUE } from '../world/materials';

/**
 * The bot's move rules. ONE place for every rule and cost, so they're easy to tune and test.
 *
 * The bot is 2 voxels tall: a node (x, y, z) is the cell its feet occupy.
 * A node is either a dry stand (feet + head in air, solid floor) or a swim spot
 * (feet in water, head in air: the bot floats at the surface).
 *
 * World-changing moves use the Baritone-style approximation: the search does NOT
 * track the changes it plans. A dig is an expensive move through solid blocks; a
 * bridge is an expensive move over air that spends one block. When the bot
 * executes the path the world really changes, and every step is re-checked
 * against the real world first (see `isMoveValid`).
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
  Dig: 5,
  DigDown: 6,
  Bridge: 7,
  Pillar: 8,
  Swim: 9,
} as const;
export type MoveKind = (typeof MoveKind)[keyof typeof MoveKind];

export const COST = {
  walk: 1,
  diagonal: 1.41,
  stepUp: 2,
  dropBase: 1,
  dropPerBlock: 0.5,
  /** Plus the hardness of every block dug. */
  digBase: 1,
  digDownBase: 2,
  bridge: 3,
  pillar: 4,
  swim: 3,
} as const;

/** Longest fall the bot will take on purpose. */
export const MAX_DROP = 3;

/** Extra cost per block dug. 0 = can't be dug. Indexed by Mat id. */
export const HARDNESS: readonly number[] = (() => {
  const h = new Array<number>(8).fill(0);
  h[Mat.Grass] = 1;
  h[Mat.Soil] = 1;
  h[Mat.Placed] = 1;
  h[Mat.Stone] = 4;
  // Crystal is a hard wall; air and water have nothing to dig.
  return h;
})();

export const isSolid = (m: number): boolean => OPAQUE[m] === 1;
export const isDiggable = (m: number): boolean => HARDNESS[m] > 0;
const isAir = (m: number): boolean => m === Mat.Air;

/** Feet and head cells are both air. */
export function isClear(g: Grid, x: number, y: number, z: number): boolean {
  return isAir(g.get(x, y, z)) && isAir(g.get(x, y + 1, z));
}

/** A dry stand: the bot can stand with its feet in (x, y, z). */
export function canStand(g: Grid, x: number, y: number, z: number): boolean {
  return isClear(g, x, y, z) && isSolid(g.get(x, y - 1, z));
}

/** A swim spot: feet in water, head in air. */
export function isSwimSpot(g: Grid, x: number, y: number, z: number): boolean {
  return g.get(x, y, z) === Mat.Water && isAir(g.get(x, y + 1, z));
}

/** `blocksUsed` is how many inventory blocks the move spends (0 or 1). */
export type MoveSink = (x: number, y: number, z: number, cost: number, kind: MoveKind, blocksUsed: number) => void;

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

/**
 * Calls `out` for every move the bot can make from (x, y, z) holding `blocks` blocks.
 * Allocation-free.
 */
export function expandMoves(g: Grid, x: number, y: number, z: number, blocks: number, out: MoveSink): void {
  const swimming = g.get(x, y, z) === Mat.Water;

  for (let i = 0; i < 4; i++) {
    const nx = x + CARDINAL[i][0], nz = z + CARDINAL[i][1];
    const feet = g.get(nx, y, nz), head = g.get(nx, y + 1, nz);

    if (isAir(feet) && isAir(head)) {
      const floor = g.get(nx, y - 1, nz);
      if (isSolid(floor)) {
        out(nx, y, nz, COST.walk, MoveKind.Walk, 0);
      } else {
        // Nothing to stand on: fall to the first floor (or water) within MAX_DROP...
        for (let k = 1; k <= MAX_DROP; k++) {
          const ny = y - k;
          const m = g.get(nx, ny, nz);
          if (m === Mat.Water) {
            out(nx, ny, nz, COST.dropBase + COST.dropPerBlock * k, MoveKind.Drop, 0);
            break;
          }
          if (!isAir(m)) break;
          if (isSolid(g.get(nx, ny - 1, nz))) {
            out(nx, ny, nz, COST.dropBase + COST.dropPerBlock * k, MoveKind.Drop, 0);
            break;
          }
        }
        // ...or bridge: place a block under the next cell and walk onto it.
        // It's placed against the bot's own floor, so it always has a face to attach to.
        if (!swimming && blocks > 0 && isAir(floor)) out(nx, y, nz, COST.bridge, MoveKind.Bridge, 1);
      }
    } else if (feet === Mat.Water && isAir(head)) {
      out(nx, y, nz, COST.swim, MoveKind.Swim, 0);
    } else if (!swimming && (isAir(feet) || isDiggable(feet)) && (isAir(head) || isDiggable(head))) {
      // Something diggable in the way (feet, head or both), with a floor to land on.
      if (isSolid(g.get(nx, y - 1, nz))) {
        out(nx, y, nz, COST.digBase + HARDNESS[feet] + HARDNESS[head], MoveKind.Dig, 0);
      }
    }

    // Step up one block: needs room above the bot's head to hop.
    if (isAir(g.get(x, y + 2, z)) && canStand(g, nx, y + 1, nz)) {
      out(nx, y + 1, nz, COST.stepUp, MoveKind.StepUp, 0);
    }
  }

  if (swimming) return; // no diagonals, digging or building while swimming

  // Diagonals: both side columns must be clear so the bot doesn't clip a corner.
  for (let i = 0; i < 4; i++) {
    const dx = DIAGONAL[i][0], dz = DIAGONAL[i][1];
    if (isClear(g, x + dx, y, z) && isClear(g, x, y, z + dz) && canStand(g, x + dx, y, z + dz)) {
      out(x + dx, y, z + dz, COST.diagonal, MoveKind.Diagonal, 0);
    }
  }

  // Dig down: dig out the floor and land on the block under it. Never dig into a fall.
  const below = g.get(x, y - 1, z);
  if (isDiggable(below) && isSolid(g.get(x, y - 2, z))) {
    out(x, y - 1, z, COST.digDownBase + HARDNESS[below], MoveKind.DigDown, 0);
  }

  // Pillar: jump and place a block where the feet were.
  if (blocks > 0 && isAir(g.get(x, y + 2, z))) {
    out(x, y + 1, z, COST.pillar, MoveKind.Pillar, 1);
  }
}

/** Is this exact move still possible in the real world right now? Used before each executed step. */
export function isMoveValid(
  g: Grid,
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  kind: number,
  blocks: number,
): boolean {
  let ok = false;
  expandMoves(g, from[0], from[1], from[2], blocks, (x, y, z, _c, k) => {
    if (x === to[0] && y === to[1] && z === to[2] && k === kind) ok = true;
  });
  return ok;
}

/**
 * Admissible estimate: horizontal octile distance, plus the extra each level
 * up (a step-up costs 1 more than a walk) or down (0.5 per block dropped) adds.
 * Every world-changing move costs at least as much as the plain move it replaces.
 */
export function heuristic(x: number, y: number, z: number, gx: number, gy: number, gz: number): number {
  const dx = Math.abs(gx - x), dz = Math.abs(gz - z);
  const lo = Math.min(dx, dz), hi = Math.max(dx, dz);
  const dy = gy - y;
  const vertical = dy > 0 ? dy * (COST.stepUp - COST.walk) : -dy * COST.dropPerBlock;
  return (hi - lo) * COST.walk + lo * COST.diagonal + vertical;
}
