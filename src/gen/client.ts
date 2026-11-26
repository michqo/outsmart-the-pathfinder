import type { Island, IslandSpec } from './island';
import type { Tuning } from './tune';
import type { GenReply } from './worker';

interface Pending {
  resolve(r: { island: Island; tuning?: Tuning }): void;
  reject(e: Error): void;
  onProgress?(f: number): void;
}

/** Main-thread handle on the generator worker. */
export class IslandClient {
  private worker: Worker | null = null;
  private nextId = 0;
  private pending = new Map<number, Pending>();

  /** Generates the island; with `tier`, also surveys it (start/flag, budget, stars). */
  generate(spec: IslandSpec, tier?: number, onProgress?: (f: number) => void): Promise<{ island: Island; tuning?: Tuning }> {
    if (!this.worker) {
      this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<GenReply>) => {
        const msg = e.data;
        const p = this.pending.get(msg.id);
        if (!p) return;
        if ('progress' in msg) return p.onProgress?.(msg.progress);
        this.pending.delete(msg.id);
        if ('island' in msg) p.resolve({ island: msg.island, tuning: msg.tuning });
        else p.reject(new Error(msg.error));
      };
      this.worker.onerror = (e) => {
        for (const p of this.pending.values()) p.reject(new Error(e.message || 'generator failed'));
        this.pending.clear();
      };
    }
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      this.worker!.postMessage({ id, spec, tier });
    });
  }
}
