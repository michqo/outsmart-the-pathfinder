import { MinHeap } from '../path/heap';

/**
 * Water on a heightmap: droplet erosion, depression filling (lakes) and flow
 * accumulation (rivers). Square W×W grids, index x + z*W; `land` marks the island.
 *
 * Determinism: only + − × ÷, sqrt and floor (all exactly specified by IEEE 754), so
 * every browser carves the same island.
 */

export interface ErosionParams {
  /** Droplets per land cell. */
  drops: number;
  inertia: number;
  capacity: number;
  minCapacity: number;
  deposit: number;
  erode: number;
  evaporate: number;
  gravity: number;
  maxSteps: number;
  radius: number;
  /** Erosion never cuts below this height (keeps the island's crust intact). */
  floor: number;
}

export const EROSION: ErosionParams = {
  drops: 0.7,
  inertia: 0.08,
  capacity: 3,
  minCapacity: 0.02,
  deposit: 0.3,
  erode: 0.22,
  evaporate: 0.025,
  gravity: 4,
  maxSteps: 40,
  radius: 2,
  floor: 0,
};

/** Particle hydraulic erosion: each droplet runs downhill, picking up and dropping sediment. */
export function erode(h: Float32Array, land: Uint8Array, W: number, rand: () => number, p: ErosionParams = EROSION): void {
  // Brush: weights falling off with distance, normalised to 1.
  const bx: number[] = [], bz: number[] = [], bw: number[] = [];
  let sum = 0;
  for (let dz = -p.radius; dz <= p.radius; dz++)
    for (let dx = -p.radius; dx <= p.radius; dx++) {
      const w = p.radius - Math.sqrt(dx * dx + dz * dz);
      if (w <= 0) continue;
      bx.push(dx), bz.push(dz), bw.push(w);
      sum += w;
    }
  for (let k = 0; k < bw.length; k++) bw[k] /= sum;

  const cells: number[] = [];
  for (let i = 0; i < land.length; i++) if (land[i]) cells.push(i);
  const drops = Math.floor(cells.length * p.drops);
  const inside = (x: number, z: number) => x >= 1 && z >= 1 && x < W - 2 && z < W - 2 && land[x + z * W] === 1;

  // Height and gradient by bilinear interpolation inside the cell at (px, pz).
  let gh = 0, ggx = 0, ggz = 0;
  const sample = (px: number, pz: number) => {
    const x = Math.floor(px), z = Math.floor(pz);
    const u = px - x, v = pz - z;
    const i = x + z * W;
    const a = h[i], b = h[i + 1], c = h[i + W], d = h[i + W + 1];
    ggx = (b - a) * (1 - v) + (d - c) * v;
    ggz = (c - a) * (1 - u) + (d - b) * u;
    gh = a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
  };

  for (let n = 0; n < drops; n++) {
    const start = cells[Math.floor(rand() * cells.length)];
    let px = (start % W) + rand(), pz = Math.floor(start / W) + rand();
    if (!inside(Math.floor(px), Math.floor(pz))) continue;
    let dx = 0, dz = 0, speed = 1, water = 1, sediment = 0;
    for (let step = 0; step < p.maxSteps; step++) {
      const cx = Math.floor(px), cz = Math.floor(pz);
      const u = px - cx, v = pz - cz;
      sample(px, pz);
      const height = gh;
      dx = dx * p.inertia - ggx * (1 - p.inertia);
      dz = dz * p.inertia - ggz * (1 - p.inertia);
      const len = Math.sqrt(dx * dx + dz * dz);
      if (len < 1e-9) break;
      dx /= len;
      dz /= len;
      px += dx;
      pz += dz;
      if (!inside(Math.floor(px), Math.floor(pz))) break; // ran off the island
      sample(px, pz);
      const dh = gh - height;
      const capacity = Math.max(-dh * speed * water * p.capacity, p.minCapacity);
      const i = cx + cz * W;
      if (sediment > capacity || dh > 0) {
        // Uphill: fill the pit (at most what it needs); otherwise drop the excess.
        const amount = dh > 0 ? Math.min(dh, sediment) : (sediment - capacity) * p.deposit;
        sediment -= amount;
        h[i] += amount * (1 - u) * (1 - v);
        h[i + 1] += amount * u * (1 - v);
        h[i + W] += amount * (1 - u) * v;
        h[i + W + 1] += amount * u * v;
      } else {
        const amount = Math.min((capacity - sediment) * p.erode, -dh);
        for (let k = 0; k < bw.length; k++) {
          const x = cx + bx[k], z = cz + bz[k];
          if (x < 0 || z < 0 || x >= W || z >= W) continue;
          const j = x + z * W;
          if (!land[j]) continue;
          const take = Math.min(amount * bw[k], Math.max(0, h[j] - p.floor));
          h[j] -= take;
          sediment += take;
        }
      }
      speed = Math.sqrt(Math.max(0, speed * speed + dh * p.gravity));
      water *= 1 - p.evaporate;
    }
  }
}

export interface Drainage {
  /** Water level: the height with every pit filled to its spill point (slightly sloped so flats drain). */
  filled: Float64Array;
  /** The cell each cell drains into (-1 = off the island's edge). */
  down: Int32Array;
  /** How many land cells drain through each cell (itself included). */
  flow: Float32Array;
}

/**
 * Priority-flood (Barnes et al.): flood inwards from the coast, lowest first. A cell
 * lower than the cell that reached it is in a pit, and is filled up to that level: lakes.
 * The flood order doubles as a drainage tree, which gives flow accumulation: rivers.
 */
export function drainage(h: Float32Array, land: Uint8Array, W: number, rain?: Float32Array): Drainage {
  const N = W * W;
  const filled = new Float64Array(N);
  const down = new Int32Array(N).fill(-1);
  const seen = new Uint8Array(N);
  const order = new Int32Array(N);
  let count = 0;
  const heap = new MinHeap(N);
  const EPS = 1e-4;
  const DIRS = [1, -1, W, -W];
  for (let i = 0; i < N; i++) {
    if (!land[i]) continue;
    const x = i % W, z = Math.floor(i / W);
    const coast = x === 0 || z === 0 || x === W - 1 || z === W - 1 || DIRS.some((d) => !land[i + d]);
    if (!coast) continue;
    seen[i] = 1;
    filled[i] = h[i];
    heap.push(i, h[i]);
  }
  while (heap.size) {
    const c = heap.pop();
    order[count++] = c;
    const x = c % W;
    for (const d of DIRS) {
      if ((d === 1 && x === W - 1) || (d === -1 && x === 0)) continue;
      const n = c + d;
      if (n < 0 || n >= N || seen[n] || !land[n]) continue;
      seen[n] = 1;
      filled[n] = Math.max(h[n], filled[c] + EPS);
      down[n] = c;
      heap.push(n, filled[n]);
    }
  }
  const flow = new Float32Array(N);
  for (let k = 0; k < count; k++) flow[order[k]] = rain ? rain[order[k]] : 1;
  for (let k = count - 1; k >= 0; k--) {
    const c = order[k];
    if (down[c] >= 0) flow[down[c]] += flow[c];
  }
  return { filled, down, flow };
}
