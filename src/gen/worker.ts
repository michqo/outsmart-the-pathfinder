/// <reference lib="webworker" />
import { World } from '../world/world';
import { generateIsland, islandKey, type Island, type IslandSpec } from './island';
import { downsample } from './lod';
import { tuneIsland, type Tuning } from './tune';
import type { Dims } from '../world/world';

/**
 * `tier` asks for a survey (route + stars) as well; omit it when the tuning is cached.
 * `lod` asks only for a coarse copy (for drawing the island far away).
 */
export type GenRequest = { id: number; spec: IslandSpec; tier?: number; lod?: number };
export type LodIsland = { dims: Dims; data: Uint8Array; scale: number; windowDims: Dims };
export type GenReply =
  | { id: number; progress: number }
  | { id: number; lod: LodIsland }
  | { id: number; island: Island; tuning?: Tuning }
  | { id: number; error: string };

const post = (msg: GenReply, transfer: Transferable[] = []) =>
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer);

/** Island generation and the survey run off the main thread (the survey takes up to a few seconds). */
self.onmessage = (e: MessageEvent<GenRequest>) => {
  const { id, spec, tier, lod } = e.data;
  try {
    const island = generateIsland(spec);
    if (lod) {
      const small = downsample(island.data, island.dims, lod);
      post({ id, lod: { ...small, scale: lod, windowDims: island.dims } }, [small.data.buffer]);
      return;
    }
    let tuning: Tuning | undefined;
    if (tier !== undefined) {
      const w = new World(island.dims.sx, island.dims.sy, island.dims.sz);
      w.data.set(island.data);
      let last = 0;
      tuning = tuneIsland(w, tier, islandKey(spec), (f) => {
        if (f - last < 0.05 && f < 1) return;
        last = f;
        post({ id, progress: f });
      });
    }
    post({ id, island, tuning }, [island.data.buffer, island.biome.buffer]);
  } catch (err) {
    post({ id, error: String(err) });
  }
};
