import { SX, SY, SZ } from '../world/world';
import { MinHeap } from './heap';
import { expandMoves, heuristic, MoveKind, type Grid, type MoveSink } from './moves';

const N = SX * SY * SZ;
const NEW = 0, OPEN = 1, CLOSED = 2;
/** High bit in an event marks "closed"; otherwise the node was just opened. */
export const CLOSED_FLAG = 0x80000000;

export type SearchStatus = 'running' | 'found' | 'failed';

export interface PathResult {
  /** Node ids (voxel indices of the feet cell), start first. */
  nodes: Int32Array;
  /** How each node was reached (MoveKind). */
  kinds: Uint8Array;
  cost: number;
}

const idx = (x: number, y: number, z: number) => x + z * SX + y * SX * SZ;

/**
 * Weighted A* over (x, y, z). Resumable: call step() repeatedly so a worker can time-slice it.
 * No per-node allocation: all state lives in typed arrays.
 */
export class AStar {
  readonly g = new Float32Array(N);
  readonly parent = new Int32Array(N);
  readonly kind = new Uint8Array(N);
  readonly state = new Uint8Array(N);
  private heap = new MinHeap();
  private events = new Uint32Array(1 << 14);
  private eventCount = 0;
  private cur = 0;
  private curG = 0;
  private goalId: number;
  status: SearchStatus = 'running';
  expanded = 0;

  constructor(
    private grid: Grid,
    start: readonly [number, number, number],
    private goal: readonly [number, number, number],
    private weight = 1,
  ) {
    this.goalId = idx(goal[0], goal[1], goal[2]);
    const s = idx(start[0], start[1], start[2]);
    this.g[s] = 0;
    this.parent[s] = -1;
    this.kind[s] = MoveKind.Start;
    this.state[s] = OPEN;
    this.pushEvent(s);
    this.heap.push(s, this.weight * heuristic(start[0], start[1], start[2], goal[0], goal[1], goal[2]));
  }

  /** Expands up to `max` nodes. */
  step(max: number): SearchStatus {
    if (this.status !== 'running') return this.status;
    const heap = this.heap;
    for (let n = 0; n < max; n++) {
      if (heap.size === 0) return (this.status = 'failed');
      const id = heap.pop();
      if (this.state[id] === CLOSED) continue; // stale duplicate
      this.state[id] = CLOSED;
      this.pushEvent(id | CLOSED_FLAG);
      this.expanded++;
      if (id === this.goalId) return (this.status = 'found');

      const x = id % SX, z = Math.floor(id / SX) % SZ, y = Math.floor(id / (SX * SZ));
      this.cur = id;
      this.curG = this.g[id];
      expandMoves(this.grid, x, y, z, this.relax);
    }
    return this.status;
  }

  private relax: MoveSink = (x, y, z, cost, kind) => {
    if (x < 0 || y < 0 || z < 0 || x >= SX || y >= SY || z >= SZ) return;
    const id = idx(x, y, z);
    const st = this.state[id];
    if (st === CLOSED) return;
    const g = this.curG + cost;
    if (st === OPEN && g >= this.g[id]) return;
    if (st === NEW) this.pushEvent(id);
    this.state[id] = OPEN;
    this.g[id] = g;
    this.parent[id] = this.cur;
    this.kind[id] = kind;
    const gl = this.goal;
    this.heap.push(id, g + this.weight * heuristic(x, y, z, gl[0], gl[1], gl[2]));
  };

  private pushEvent(e: number): void {
    if (this.eventCount === this.events.length) {
      const next = new Uint32Array(this.events.length * 2);
      next.set(this.events);
      this.events = next;
    }
    this.events[this.eventCount++] = e >>> 0;
  }

  /** Open/close events since the last drain, in order. */
  drainEvents(): Uint32Array {
    const out = this.events.slice(0, this.eventCount);
    this.eventCount = 0;
    return out;
  }

  path(): PathResult | null {
    if (this.status !== 'found') return null;
    const ids: number[] = [];
    for (let id = this.goalId; id !== -1; id = this.parent[id]) ids.push(id);
    ids.reverse();
    const nodes = Int32Array.from(ids);
    const kinds = Uint8Array.from(ids, (id) => this.kind[id]);
    return { nodes, kinds, cost: this.g[this.goalId] };
  }

  /** Runs to completion (tests, tools). */
  run(): PathResult | null {
    while (this.step(1 << 16) === 'running');
    return this.path();
  }
}
