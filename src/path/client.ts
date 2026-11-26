import type { World } from '../world/world';
import type { FromWorker, ToWorker, Vec3i } from './protocol';

export type DoneMsg = Extract<FromWorker, { type: 'done' }>;

export interface SearchHandlers {
  onProgress(events: Uint32Array, expanded: number): void;
  onDone(result: DoneMsg): void;
  onError?(event: Event): void;
}

/** Main-thread handle on the search worker. One search at a time; starting a new one cancels the old. */
export class SearchClient {
  private worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  private currentId = 0;
  private handlers: SearchHandlers | null = null;

  constructor() {
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => {
      const msg = e.data;
      if (msg.id !== this.currentId || !this.handlers) return; // stale
      if (msg.type === 'progress') this.handlers.onProgress(msg.events, msg.expanded);
      else {
        const h = this.handlers;
        this.handlers = null;
        h.onDone(msg);
      }
    };
    const fail = (event: Event) => {
      const handler = this.handlers?.onError;
      this.handlers = null;
      handler?.(event);
    };
    this.worker.onerror = this.worker.onmessageerror = fail;
  }

  get busy(): boolean {
    return this.handlers !== null;
  }

  search(
    world: World, start: Vec3i, goal: Vec3i, weight: number, blocks: number, handlers: SearchHandlers,
    options: { verifyRoute?: boolean } = {},
  ): void {
    this.cancel();
    this.currentId++;
    this.handlers = handlers;
    const data = world.data.slice();
    const msg: ToWorker = { type: 'search', id: this.currentId, data, dims: [world.sx, world.sy, world.sz], start, goal, weight, blocks, version: world.version, ...options };
    this.worker.postMessage(msg, [data.buffer]);
  }

  cancel(): void {
    if (!this.handlers) return;
    this.worker.postMessage({ type: 'cancel', id: this.currentId } satisfies ToWorker);
    this.handlers = null;
  }
}
