import type { Dims } from '../world/world';
import { MinHeap } from './heap';
import { expandMoves, heuristic, MoveKind, type Grid, type MoveSink } from './moves';

/** High bit in an event marks "closed"; otherwise the cell was just opened. Events carry cell ids. */
export const CLOSED_FLAG = 0x80000000;

export type SearchStatus = 'running' | 'found' | 'failed';

export interface PathResult {
  /** Cell ids (voxel indices of the feet cell), start first. */
  nodes: Int32Array;
  /** How each node was reached (MoveKind). */
  kinds: Uint8Array;
  cost: number;
}

/**
 * Search states (cell, blocksLeft) live in a growable node store found through an
 * open-addressing hash, so memory follows the nodes actually touched rather than
 * every possible (cell, inventory) pair.
 */
class NodeStore {
  key = new Int32Array(1 << 12);
  g = new Float32Array(1 << 12);
  parent = new Int32Array(1 << 12);
  kind = new Uint8Array(1 << 12);
  closed = new Uint8Array(1 << 12);
  count = 0;
  private table = new Int32Array(1 << 14).fill(-1);
  private mask = (1 << 14) - 1;

  find(key: number): number {
    let h = Math.imul(key, 0x9e3779b1) & this.mask;
    for (;;) {
      const n = this.table[h];
      if (n < 0) return -1;
      if (this.key[n] === key) return n;
      h = (h + 1) & this.mask;
    }
  }

  add(key: number): number {
    if (this.count === this.key.length) this.growNodes();
    if (this.count * 2 >= this.table.length) this.growTable();
    const n = this.count++;
    this.key[n] = key;
    this.closed[n] = 0;
    this.insert(key, n);
    return n;
  }

  private insert(key: number, n: number): void {
    let h = Math.imul(key, 0x9e3779b1) & this.mask;
    while (this.table[h] >= 0) h = (h + 1) & this.mask;
    this.table[h] = n;
  }

  private growNodes(): void {
    const size = this.key.length * 2;
    const grow = <T extends Int32Array | Float32Array | Uint8Array>(a: T, make: (n: number) => T): T => {
      const b = make(size);
      b.set(a);
      return b;
    };
    this.key = grow(this.key, (n) => new Int32Array(n));
    this.g = grow(this.g, (n) => new Float32Array(n));
    this.parent = grow(this.parent, (n) => new Int32Array(n));
    this.kind = grow(this.kind, (n) => new Uint8Array(n));
    this.closed = grow(this.closed, (n) => new Uint8Array(n));
  }

  private growTable(): void {
    this.table = new Int32Array(this.table.length * 2).fill(-1);
    this.mask = this.table.length - 1;
    for (let n = 0; n < this.count; n++) this.insert(this.key[n], n);
  }
}

/**
 * Weighted A* over (x, y, z, blocksLeft). A zero weight is Dijkstra's algorithm.
 * Resumable: call step() repeatedly so a worker
 * can time-slice it. No per-node object allocation: everything lives in typed arrays.
 */
export class AStar {
  private nodes = new NodeStore();
  private heap = new MinHeap();
  private events = new Uint32Array(1 << 14);
  private eventCount = 0;
  private seenCell: Uint8Array;
  private sx: number;
  private sy: number;
  private sz: number;
  private stride: number;
  private goalCell: number;
  private goalNode = -1;
  private cur = 0;
  private curG = 0;
  private curBlocks = 0;
  status: SearchStatus = 'running';
  /** States expanded (a cell can be expanded once per inventory count). */
  expanded = 0;

  constructor(
    private grid: Grid & Dims,
    start: readonly [number, number, number],
    private goal: readonly [number, number, number],
    private weight = 1,
    blocks = 0,
    private pruneDominated = false,
  ) {
    this.sx = grid.sx;
    this.sy = grid.sy;
    this.sz = grid.sz;
    this.seenCell = new Uint8Array(grid.sx * grid.sy * grid.sz);
    this.stride = blocks + 1;
    this.goalCell = this.cellId(goal[0], goal[1], goal[2]);
    const sc = this.cellId(start[0], start[1], start[2]);
    const n = this.nodes.add(sc * this.stride + blocks);
    this.nodes.g[n] = 0;
    this.nodes.parent[n] = -1;
    this.nodes.kind[n] = MoveKind.Start;
    this.openCell(sc);
    this.heap.push(n, this.estimate(...start));
  }

  private cellId(x: number, y: number, z: number): number {
    return x + z * this.sx + y * this.sx * this.sz;
  }

  /** Expands up to `max` states. */
  step(max: number): SearchStatus {
    if (this.status !== 'running') return this.status;
    const heap = this.heap, ns = this.nodes, stride = this.stride;
    for (let i = 0; i < max; i++) {
      if (heap.size === 0) return (this.status = 'failed');
      const n = heap.pop();
      if (ns.closed[n]) continue; // stale duplicate
      const key = ns.key[n];
      const cell = Math.floor(key / stride);
      const blocks = key - cell * stride;
      ns.closed[n] = 1;
      if (this.pruneDominated && this.dominated(cell, blocks, ns.g[n])) continue;
      this.expanded++;
      this.pushEvent(cell | CLOSED_FLAG);
      if (cell === this.goalCell) {
        this.goalNode = n;
        return (this.status = 'found');
      }
      const sx = this.sx, sz = this.sz;
      const x = cell % sx, z = Math.floor(cell / sx) % sz, y = Math.floor(cell / (sx * sz));
      this.cur = n;
      this.curG = ns.g[n];
      this.curBlocks = blocks;
      expandMoves(this.grid, x, y, z, this.curBlocks, this.relax);
    }
    return this.status;
  }

  private relax: MoveSink = (x, y, z, cost, kind, used) => {
    if (x < 0 || y < 0 || z < 0 || x >= this.sx || y >= this.sy || z >= this.sz) return;
    const cell = this.cellId(x, y, z);
    const blocks = this.curBlocks - used;
    const key = cell * this.stride + blocks;
    const ns = this.nodes;
    const g = this.curG + (this.pruneDominated ? Math.round(cost * 100) : cost);
    if (this.pruneDominated && this.dominated(cell, blocks, g)) return;
    let n = ns.find(key);
    if (n >= 0) {
      if (ns.closed[n] || g >= ns.g[n]) return;
    } else {
      n = ns.add(key);
      this.openCell(cell);
    }
    ns.g[n] = g;
    ns.parent[n] = this.cur;
    ns.kind[n] = kind;
    this.heap.push(n, g + this.estimate(x, y, z));
  };

  private estimate(x: number, y: number, z: number): number {
    if (this.weight === 0) return 0;
    const h = heuristic(x, y, z, ...this.goal);
    return this.weight * (this.pruneDominated ? Math.round(h * 100) : h);
  }

  // More blocks never disable a move. A cheaper arrival with more blocks can
  // therefore replace this one on the fixed planning snapshot.
  private dominated(cell: number, blocks: number, cost: number): boolean {
    const first = cell * this.stride;
    for (let key = first + blocks + 1; key < first + this.stride; key++) {
      const n = this.nodes.find(key);
      if (n >= 0 && this.nodes.g[n] <= cost) return true;
    }
    return false;
  }

  /** Emits an "opened" event the first time a cell is seen (whatever the inventory). */
  private openCell(cell: number): void {
    if (this.seenCell[cell]) return;
    this.seenCell[cell] = 1;
    this.pushEvent(cell);
  }

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
    const ns = this.nodes;
    const chain: number[] = [];
    for (let n = this.goalNode; n !== -1; n = ns.parent[n]) chain.push(n);
    chain.reverse();
    return {
      nodes: Int32Array.from(chain, (n) => Math.floor(ns.key[n] / this.stride)),
      kinds: Uint8Array.from(chain, (n) => ns.kind[n]),
      cost: ns.g[this.goalNode] / (this.pruneDominated ? 100 : 1),
    };
  }

  /** Runs to completion (tests, tools). */
  run(): PathResult | null {
    while (this.step(1 << 16) === 'running');
    return this.path();
  }
}
