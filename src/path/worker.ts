/// <reference lib="webworker" />
import { World } from '../world/world';
import { reachesFlag } from '../bot/route';
import { AStar } from './astar';
import type { FromWorker, ToWorker } from './protocol';

/** Each slice runs this long before yielding, so cancel messages get through. */
const SLICE_MS = 8;
const BATCH = 256;

interface Job {
  id: number;
  astar: AStar;
  version: number;
  computeMs: number;
  verifyRoute: boolean;
  blocks: number;
}

let job: Job | null = null;
const world = new World();

const post = (msg: FromWorker, transfer: Transferable[] = []) =>
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer);

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  if (msg.type === 'cancel') {
    if (job?.id === msg.id) job = null;
    return;
  }
  world.data.set(msg.data);
  const start = performance.now();
  const astar = new AStar(world, msg.start, msg.goal, msg.weight, msg.blocks, msg.pruneDominated);
  job = {
    id: msg.id, astar, version: msg.version, computeMs: performance.now() - start,
    verifyRoute: msg.verifyRoute === true, blocks: msg.blocks,
  };
  run();
};

function run(): void {
  const j = job;
  if (!j) return;
  const t0 = performance.now();
  let status = j.astar.status;
  while (status === 'running' && performance.now() - t0 < SLICE_MS) status = j.astar.step(BATCH);
  j.computeMs += performance.now() - t0;

  const events = j.astar.drainEvents();
  post({ type: 'progress', id: j.id, events, expanded: j.astar.expanded }, [events.buffer]);

  if (status === 'running') {
    setTimeout(() => { if (job === j) run(); }, 0);
    return;
  }
  const pathStart = performance.now();
  const p = j.astar.path();
  j.computeMs += performance.now() - pathStart;
  const nodes = p?.nodes ?? new Int32Array(0);
  const kinds = p?.kinds ?? new Uint8Array(0);
  post(
    {
      type: 'done',
      id: j.id,
      found: !!p,
      nodes,
      kinds,
      cost: p?.cost ?? 0,
      executable: j.verifyRoute ? !!p && reachesFlag(world, p, j.blocks) : undefined,
      expanded: j.astar.expanded,
      ms: j.computeMs,
      version: j.version,
    },
    [nodes.buffer, kinds.buffer],
  );
  job = null;
}
