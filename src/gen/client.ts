import type { Island, IslandSpec } from './island';
import type { GenReply } from './worker';

/** Main-thread handle on the generator worker. A newer request supersedes older ones. */
export class IslandClient {
  private worker: Worker | null = null;
  private nextId = 0;
  private pending = new Map<number, { resolve(i: Island): void; reject(e: Error): void }>();

  generate(spec: IslandSpec): Promise<Island> {
    if (!this.worker) {
      this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<GenReply>) => {
        const p = this.pending.get(e.data.id);
        if (!p) return;
        this.pending.delete(e.data.id);
        if ('island' in e.data) p.resolve(e.data.island);
        else p.reject(new Error(e.data.error));
      };
      this.worker.onerror = (e) => {
        for (const p of this.pending.values()) p.reject(new Error(e.message || 'generator failed'));
        this.pending.clear();
      };
    }
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker!.postMessage({ id, spec });
    });
  }
}
