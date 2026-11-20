import { describe, expect, it } from 'vitest';
import { AStar } from '../src/path/astar';
import { MinHeap } from '../src/path/heap';
import { canStand, COST, expandMoves, MoveKind } from '../src/path/moves';
import { Mat } from '../src/world/materials';
import { voxelCoords, World } from '../src/world/world';

/** A flat stone floor at y = 0 over x, z in [0, size). Feet stand at y = 1. */
function floor(size = 16): World {
  const w = new World();
  for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) w.set(x, 0, z, Mat.Stone);
  return w;
}

function moves(w: World, x: number, y: number, z: number) {
  const out: { x: number; y: number; z: number; cost: number; kind: number }[] = [];
  expandMoves(w, x, y, z, (x, y, z, cost, kind) => out.push({ x, y, z, cost, kind }));
  return out;
}
const has = (ms: ReturnType<typeof moves>, x: number, y: number, z: number, kind?: number) =>
  ms.some((m) => m.x === x && m.y === y && m.z === z && (kind === undefined || m.kind === kind));

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

describe('move rules', () => {
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
    expect(ms.find((m) => m.kind === MoveKind.Diagonal)!.cost).toBe(COST.diagonal);
  });

  it('cannot walk into a wall or under a low ceiling', () => {
    const w = floor();
    w.set(6, 1, 5, Mat.Stone); // wall east (feet)
    w.set(4, 2, 5, Mat.Stone); // ceiling west (head)
    const ms = moves(w, 5, 1, 5);
    expect(has(ms, 6, 1, 5)).toBe(false);
    expect(has(ms, 4, 1, 5)).toBe(false);
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

  it('never steps up two blocks', () => {
    const w = floor();
    w.set(6, 1, 5, Mat.Stone);
    w.set(6, 2, 5, Mat.Stone);
    const ms = moves(w, 5, 1, 5);
    expect(ms.some((m) => m.x === 6 && m.z === 5)).toBe(false);
  });

  it('drops 1 to 3 blocks, but not 4', () => {
    for (const k of [1, 2, 3, 4]) {
      const w = new World();
      w.set(5, 10, 5, Mat.Stone); // ledge the bot stands on
      w.set(6, 10 - k, 5, Mat.Stone); // landing k blocks lower
      const ms = moves(w, 5, 11, 5);
      const drop = ms.find((m) => m.kind === MoveKind.Drop);
      if (k <= 3) expect(drop).toMatchObject({ x: 6, y: 11 - k, z: 5, cost: COST.dropBase + COST.dropPerBlock * k });
      else expect(drop).toBeUndefined();
    }
  });

  it('cannot walk into water yet', () => {
    const w = floor();
    w.set(6, 1, 5, Mat.Water);
    expect(has(moves(w, 5, 1, 5), 6, 1, 5)).toBe(false);
  });
});

describe('AStar', () => {
  const toXYZ = (ids: Int32Array) => Array.from(ids, (i) => voxelCoords(i));

  it('finds a straight path with the right cost', () => {
    const p = new AStar(floor(), [1, 1, 1], [6, 1, 1]).run()!;
    expect(p.cost).toBeCloseTo(5);
    expect(toXYZ(p.nodes).at(-1)).toEqual([6, 1, 1]);
  });

  it('uses diagonals when they are cheaper', () => {
    const p = new AStar(floor(), [1, 1, 1], [5, 1, 5]).run()!;
    expect(p.cost).toBeCloseTo(4 * COST.diagonal);
  });

  it('goes around a wall optimally', () => {
    const w = floor();
    for (let z = 0; z < 8; z++) for (const y of [1, 2, 3]) w.set(5, y, z, Mat.Stone);
    const p = new AStar(w, [3, 1, 2], [7, 1, 2]).run()!;
    const xs = toXYZ(p.nodes);
    expect(xs.some(([, , z]) => z >= 8)).toBe(true); // went past the wall's end
    expect(xs.every(([x, , z]) => !(x === 5 && z < 8))).toBe(true);
  });

  it('climbs stairs and comes down by dropping', () => {
    const w = floor();
    w.set(4, 1, 1, Mat.Stone);
    w.set(5, 1, 1, Mat.Stone);
    w.set(5, 2, 1, Mat.Stone);
    const up = new AStar(w, [3, 1, 1], [5, 3, 1]).run()!;
    expect(Array.from(up.kinds)).toEqual([MoveKind.Start, MoveKind.StepUp, MoveKind.StepUp]);
    const down = new AStar(w, [5, 3, 1], [7, 1, 1]).run()!;
    expect(down.kinds).toContain(MoveKind.Drop);
  });

  it('reports failure when the goal is walled off', () => {
    const w = floor();
    for (const [x, z] of [[9, 10], [11, 10], [10, 9], [10, 11], [9, 9], [11, 11], [9, 11], [11, 9]])
      for (const y of [1, 2, 3]) w.set(x, y, z, Mat.Crystal);
    const a = new AStar(w, [1, 1, 1], [10, 1, 10]);
    expect(a.run()).toBeNull();
    expect(a.status).toBe('failed');
  });

  it('weighted search expands fewer nodes', () => {
    const w = floor(40);
    for (let z = 5; z < 35; z++) for (const y of [1, 2, 3]) w.set(20, y, z, Mat.Stone);
    const a1 = new AStar(w, [2, 1, 20], [38, 1, 20], 1);
    const a3 = new AStar(w, [2, 1, 20], [38, 1, 20], 3);
    a1.run();
    a3.run();
    expect(a3.expanded).toBeLessThan(a1.expanded);
  });

  it('emits open and close events', () => {
    const a = new AStar(floor(), [1, 1, 1], [3, 1, 1]);
    a.run();
    const ev = a.drainEvents();
    expect(ev.length).toBeGreaterThan(a.expanded);
    expect(a.drainEvents().length).toBe(0);
  });
});
