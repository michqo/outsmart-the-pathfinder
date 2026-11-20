import { describe, expect, it } from 'vitest';
import { AStar } from '../src/path/astar';
import { MinHeap } from '../src/path/heap';
import { canStand, COST, expandMoves, HARDNESS, isMoveValid, MoveKind } from '../src/path/moves';
import { Mat } from '../src/world/materials';
import { voxelCoords, World } from '../src/world/world';

/** A flat floor of `m` at y = 0 over x, z in [0, size). Feet stand at y = 1. */
function floor(size = 16, m: Mat = Mat.Stone): World {
  const w = new World();
  for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) w.set(x, 0, z, m);
  return w;
}

type M = { x: number; y: number; z: number; cost: number; kind: number; used: number };
function moves(w: World, x: number, y: number, z: number, blocks = 0): M[] {
  const out: M[] = [];
  expandMoves(w, x, y, z, blocks, (x, y, z, cost, kind, used) => out.push({ x, y, z, cost, kind, used }));
  return out;
}
const find = (ms: M[], x: number, y: number, z: number, kind?: number) =>
  ms.find((m) => m.x === x && m.y === y && m.z === z && (kind === undefined || m.kind === kind));
const has = (ms: M[], x: number, y: number, z: number, kind?: number) => !!find(ms, x, y, z, kind);
const kindsOf = (ms: M[]) => new Set(ms.map((m) => m.kind));

describe('MinHeap', () => {
  it('pops in key order', () => {
    const h = new MinHeap(2); // forces growth
    const keys = [5, 1, 9, 3, 3, 0.5, 7, 2];
    keys.forEach((k, i) => h.push(i, k));
    const out: number[] = [];
    while (h.size) out.push(keys[h.pop()]);
    expect(out).toEqual([...keys].sort((a, b) => a - b));
  });
});

describe('basic moves', () => {
  it('standing needs a floor and 2 free cells', () => {
    const w = floor();
    expect(canStand(w, 3, 1, 3)).toBe(true);
    expect(canStand(w, 3, 2, 3)).toBe(false); // no floor
    w.set(3, 2, 3, Mat.Stone);
    expect(canStand(w, 3, 1, 3)).toBe(false); // head blocked
  });

  it('walks in 4 directions and diagonally on open ground', () => {
    const ms = moves(floor(), 5, 1, 5);
    expect(ms.filter((m) => m.kind === MoveKind.Walk)).toHaveLength(4);
    expect(ms.filter((m) => m.kind === MoveKind.Diagonal)).toHaveLength(4);
    expect(find(ms, 6, 1, 6)!.cost).toBe(COST.diagonal);
  });

  it('does not cut a diagonal corner past a blocked column', () => {
    const w = floor();
    w.set(6, 2, 5, Mat.Stone); // head-height block beside the diagonal
    expect(has(moves(w, 5, 1, 5), 6, 1, 6, MoveKind.Diagonal)).toBe(false);
  });

  it('steps up one block when there is head room', () => {
    const w = floor();
    w.set(6, 1, 5, Mat.Stone);
    expect(has(moves(w, 5, 1, 5), 6, 2, 5, MoveKind.StepUp)).toBe(true);
    w.set(5, 3, 5, Mat.Stone); // no room to hop
    expect(has(moves(w, 5, 1, 5), 6, 2, 5, MoveKind.StepUp)).toBe(false);
  });

  it('drops 1 to 3 blocks, but not 4', () => {
    for (const k of [1, 2, 3, 4]) {
      const w = new World();
      w.set(5, 10, 5, Mat.Stone); // ledge the bot stands on
      w.set(6, 10 - k, 5, Mat.Stone); // landing k blocks lower
      const drop = moves(w, 5, 11, 5).find((m) => m.kind === MoveKind.Drop);
      if (k <= 3) expect(drop).toMatchObject({ x: 6, y: 11 - k, z: 5, cost: COST.dropBase + COST.dropPerBlock * k });
      else expect(drop).toBeUndefined();
    }
  });
});

describe('digging', () => {
  it('digs through a soil wall (feet + head) for 1 + hardness each', () => {
    const w = floor();
    w.set(6, 1, 5, Mat.Soil);
    w.set(6, 2, 5, Mat.Grass);
    const m = find(moves(w, 5, 1, 5), 6, 1, 5, MoveKind.Dig);
    expect(m?.cost).toBe(COST.digBase + HARDNESS[Mat.Soil] + HARDNESS[Mat.Grass]);
  });

  it('stone is expensive; a head-only block costs just its own hardness', () => {
    const w = floor();
    w.set(6, 2, 5, Mat.Stone);
    expect(find(moves(w, 5, 1, 5), 6, 1, 5, MoveKind.Dig)?.cost).toBe(COST.digBase + HARDNESS[Mat.Stone]);
  });

  it('never digs crystal', () => {
    const w = floor();
    w.set(6, 1, 5, Mat.Crystal);
    expect(has(moves(w, 5, 1, 5), 6, 1, 5)).toBe(false);
    w.set(6, 1, 5, Mat.Soil);
    w.set(6, 2, 5, Mat.Crystal);
    expect(has(moves(w, 5, 1, 5), 6, 1, 5)).toBe(false);
  });

  it('needs a floor on the far side', () => {
    const w = floor();
    w.set(6, 1, 5, Mat.Soil);
    w.set(6, 0, 5, Mat.Air);
    expect(has(moves(w, 5, 1, 5), 6, 1, 5, MoveKind.Dig)).toBe(false);
  });

  it('digs down only onto a block below (never into a fall)', () => {
    const w = new World();
    w.set(5, 1, 5, Mat.Stone); // what the bot ends up standing on
    w.set(5, 2, 5, Mat.Soil); // the floor it digs out
    expect(find(moves(w, 5, 3, 5), 5, 2, 5, MoveKind.DigDown)?.cost).toBe(COST.digDownBase + HARDNESS[Mat.Soil]);
    w.set(5, 1, 5, Mat.Air);
    expect(has(moves(w, 5, 3, 5), 5, 2, 5, MoveKind.DigDown)).toBe(false);
  });

  it('cannot dig down through crystal', () => {
    const w = new World();
    w.set(5, 1, 5, Mat.Stone);
    w.set(5, 2, 5, Mat.Crystal);
    expect(kindsOf(moves(w, 5, 3, 5)).has(MoveKind.DigDown)).toBe(false);
  });
});

describe('building', () => {
  it('bridges over air only when it has blocks', () => {
    const w = new World();
    w.set(5, 0, 5, Mat.Stone); // a lone pillar top
    expect(has(moves(w, 5, 1, 5, 0), 6, 1, 5, MoveKind.Bridge)).toBe(false);
    expect(find(moves(w, 5, 1, 5, 1), 6, 1, 5, MoveKind.Bridge)).toMatchObject({ cost: COST.bridge, used: 1 });
  });

  it('does not bridge where there is already a floor', () => {
    expect(kindsOf(moves(floor(), 5, 1, 5, 5)).has(MoveKind.Bridge)).toBe(false);
  });

  it('pillars up with blocks and head room', () => {
    const w = floor();
    expect(find(moves(w, 5, 1, 5, 1), 5, 2, 5, MoveKind.Pillar)).toMatchObject({ cost: COST.pillar, used: 1 });
    expect(has(moves(w, 5, 1, 5, 0), 5, 2, 5, MoveKind.Pillar)).toBe(false);
    w.set(5, 3, 5, Mat.Stone);
    expect(has(moves(w, 5, 1, 5, 1), 5, 2, 5, MoveKind.Pillar)).toBe(false);
  });
});

describe('swimming', () => {
  /** Floor at y=0, a pool of water at y=1 for x in [6, 9]. */
  function pool(): World {
    const w = floor();
    for (let x = 6; x <= 9; x++) for (let z = 0; z < 16; z++) w.set(x, 1, z, Mat.Water);
    return w;
  }

  it('wades into water at the same level and swims along', () => {
    const w = pool();
    expect(find(moves(w, 5, 1, 5), 6, 1, 5, MoveKind.Swim)?.cost).toBe(COST.swim);
    expect(has(moves(w, 7, 1, 5), 8, 1, 5, MoveKind.Swim)).toBe(true);
  });

  it('does not dig, build or go diagonal while swimming', () => {
    const k = kindsOf(moves(pool(), 7, 1, 5, 5));
    for (const kind of [MoveKind.Diagonal, MoveKind.Pillar, MoveKind.Bridge, MoveKind.DigDown, MoveKind.Dig])
      expect(k.has(kind)).toBe(false);
  });

  it('climbs out onto a higher bank', () => {
    const w = pool();
    w.set(10, 1, 5, Mat.Stone); // bank one higher
    expect(has(moves(w, 9, 1, 5), 10, 2, 5, MoveKind.StepUp)).toBe(true);
  });

  it('can drop into water but never stand on it', () => {
    const w = new World();
    w.set(5, 4, 5, Mat.Stone);
    w.set(6, 2, 5, Mat.Water);
    w.set(6, 1, 5, Mat.Stone);
    expect(has(moves(w, 5, 5, 5), 6, 2, 5, MoveKind.Drop)).toBe(true);
    expect(canStand(w, 6, 3, 5)).toBe(false); // water is not a floor
  });

  it('will not swim with its head under water', () => {
    const w = pool();
    w.set(6, 2, 5, Mat.Water);
    expect(has(moves(w, 5, 1, 5), 6, 1, 5)).toBe(false);
  });
});

describe('isMoveValid', () => {
  it('re-checks a planned step against the current world', () => {
    const w = floor();
    expect(isMoveValid(w, [5, 1, 5], [6, 1, 5], MoveKind.Walk, 0)).toBe(true);
    w.set(6, 1, 5, Mat.Crystal);
    expect(isMoveValid(w, [5, 1, 5], [6, 1, 5], MoveKind.Walk, 0)).toBe(false);
  });
});

describe('AStar', () => {
  const xyz = (ids: Int32Array) => Array.from(ids, (i) => voxelCoords(i));
  const count = (p: { kinds: Uint8Array }, k: number) => Array.from(p.kinds).filter((x) => x === k).length;

  it('finds a straight path with the right cost', () => {
    const p = new AStar(floor(), [1, 1, 1], [6, 1, 1]).run()!;
    expect(p.cost).toBeCloseTo(5);
    expect(xyz(p.nodes).at(-1)).toEqual([6, 1, 1]);
  });

  it('uses diagonals when they are cheaper', () => {
    expect(new AStar(floor(), [1, 1, 1], [5, 1, 5]).run()!.cost).toBeCloseTo(4 * COST.diagonal);
  });

  it('climbs stairs and comes down by dropping', () => {
    const w = floor();
    w.set(4, 1, 1, Mat.Stone);
    w.set(5, 1, 1, Mat.Stone);
    w.set(5, 2, 1, Mat.Stone);
    const up = new AStar(w, [3, 1, 1], [5, 3, 1]).run()!;
    expect(Array.from(up.kinds)).toEqual([MoveKind.Start, MoveKind.StepUp, MoveKind.StepUp]);
    expect(new AStar(w, [5, 3, 1], [7, 1, 1]).run()!.kinds).toContain(MoveKind.Drop);
  });

  /** Two platforms separated by a 3-wide gap over the void. */
  function gap(): World {
    const w = new World();
    for (let z = 0; z < 4; z++) {
      for (let x = 0; x < 4; x++) w.set(x, 5, z, Mat.Stone);
      for (let x = 7; x < 11; x++) w.set(x, 5, z, Mat.Stone);
    }
    return w;
  }

  it('bridges a gap when it has enough blocks', () => {
    const p = new AStar(gap(), [2, 6, 1], [8, 6, 1], 1, 5).run()!;
    expect(count(p, MoveKind.Bridge)).toBe(3);
  });

  it('fails when it is one block short', () => {
    const a = new AStar(gap(), [2, 6, 1], [8, 6, 1], 1, 2);
    expect(a.run()).toBeNull();
    expect(a.status).toBe('failed');
  });

  it('walks around a wall rather than dig when that is cheaper', () => {
    const w = floor();
    for (let z = 3; z < 8; z++) for (const y of [1, 2]) w.set(5, y, z, Mat.Stone); // digging: 1 + 4 + 4
    const p = new AStar(w, [3, 1, 5], [7, 1, 5]).run()!;
    expect(count(p, MoveKind.Dig)).toBe(0);
  });

  it('digs through a wall that has no way around', () => {
    const w = floor();
    for (let z = 0; z < 16; z++) for (const y of [1, 2, 3, 4]) w.set(5, y, z, Mat.Soil);
    const p = new AStar(w, [3, 1, 5], [7, 1, 5]).run()!;
    expect(count(p, MoveKind.Dig)).toBe(1);
  });

  it('cannot get through a crystal wall without blocks', () => {
    const w = floor();
    for (let z = 0; z < 16; z++) for (const y of [1, 2, 3, 4]) w.set(5, y, z, Mat.Crystal);
    expect(new AStar(w, [3, 1, 5], [7, 1, 5], 1, 0).run()).toBeNull();
  });

  it('pillars over a crystal wall when it has blocks', () => {
    // Wall spans the whole world, so there's no bridging around its end.
    const w = floor(64);
    for (let z = 0; z < 64; z++) for (const y of [1, 2, 3]) w.set(5, y, z, Mat.Crystal);
    const p = new AStar(w, [3, 1, 5], [7, 1, 5], 1, 8).run()!;
    expect(count(p, MoveKind.Pillar)).toBeGreaterThan(0);
  });

  it('pillars up to reach a high ledge', () => {
    const w = floor();
    for (let z = 0; z < 16; z++) for (let x = 6; x < 16; x++) for (const y of [1, 2, 3]) w.set(x, y, z, Mat.Crystal);
    const p = new AStar(w, [4, 1, 5], [8, 4, 5], 1, 4).run()!;
    expect(count(p, MoveKind.Pillar)).toBeGreaterThanOrEqual(2);
    expect(xyz(p.nodes).at(-1)).toEqual([8, 4, 5]);
  });

  it('swims across a moat', () => {
    const w = floor();
    for (let x = 6; x <= 9; x++) for (let z = 0; z < 16; z++) w.set(x, 1, z, Mat.Water);
    const p = new AStar(w, [3, 1, 5], [12, 1, 5]).run()!;
    expect(count(p, MoveKind.Swim)).toBe(4);
  });

  it('reports failure when the goal is walled off', () => {
    const w = floor();
    for (const [x, z] of [[9, 10], [11, 10], [10, 9], [10, 11], [9, 9], [11, 11], [9, 11], [11, 9]])
      for (const y of [1, 2, 3]) w.set(x, y, z, Mat.Crystal);
    w.set(10, 3, 10, Mat.Crystal);
    expect(new AStar(w, [1, 1, 1], [10, 1, 10]).run()).toBeNull();
  });

  it('weighted search expands fewer nodes', () => {
    const w = floor(40);
    for (let z = 5; z < 35; z++) for (const y of [1, 2, 3]) w.set(20, y, z, Mat.Crystal);
    const a1 = new AStar(w, [2, 1, 20], [38, 1, 20], 1);
    const a3 = new AStar(w, [2, 1, 20], [38, 1, 20], 3);
    a1.run();
    a3.run();
    expect(a3.expanded).toBeLessThan(a1.expanded);
  });

  it('emits open and close events', () => {
    const a = new AStar(floor(), [1, 1, 1], [3, 1, 1]);
    a.run();
    expect(a.drainEvents().length).toBeGreaterThan(a.expanded);
    expect(a.drainEvents().length).toBe(0);
  });
});
