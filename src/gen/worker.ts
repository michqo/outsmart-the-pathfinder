/// <reference lib="webworker" />
import { generateIsland, type Island, type IslandSpec } from './island';

export type GenRequest = { id: number; spec: IslandSpec };
export type GenReply = { id: number; island: Island } | { id: number; error: string };

/** Island generation off the main thread (erosion and drainage take a few to ~20 ms). */
self.onmessage = (e: MessageEvent<GenRequest>) => {
  const { id, spec } = e.data;
  const post = (msg: GenReply, transfer: Transferable[] = []) =>
    (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer);
  try {
    const island = generateIsland(spec);
    post({ id, island }, [island.data.buffer, island.biome.buffer]);
  } catch (err) {
    post({ id, error: String(err) });
  }
};
