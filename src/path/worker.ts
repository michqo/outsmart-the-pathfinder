/// <reference lib="webworker" />
import { World } from '../world/world';
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
  job = { id: msg.id, astar: new AStar(world, msg.start, msg.goal, msg.weight), version: msg.version, computeMs: 0 };
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
    setTimeout(run, 0);
    return;
  }
  const p = j.astar.path();
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
      expanded: j.astar.expanded,
      ms: j.computeMs,
      version: j.version,
    },
    [nodes.buffer, kinds.buffer],
  );
  job = null;
}
