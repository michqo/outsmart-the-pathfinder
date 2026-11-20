export type Vec3i = [number, number, number];

export type ToWorker =
  | { type: 'search'; id: number; data: Uint8Array; start: Vec3i; goal: Vec3i; weight: number; blocks: number; version: number }
  | { type: 'cancel'; id: number };

export type FromWorker =
  | { type: 'progress'; id: number; events: Uint32Array; expanded: number }
  | {
      type: 'done';
      id: number;
      found: boolean;
      nodes: Int32Array;
      kinds: Uint8Array;
      cost: number;
      expanded: number;
      /** Pure compute time inside the worker. */
      ms: number;
      version: number;
    };
