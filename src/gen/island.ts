import { Mat } from '../world/materials';
import { fbm, hash2, rng } from '../world/noise';
import { CS, type Dims } from '../world/world';
import { drainage, erode, EROSION } from './hydro';

/**
 * Island generator v2: shape → heightmap → erosion → biomes → lakes and rivers → voxels.
 *
 * Deterministic per (seed, ix, iz, size cap, GEN_VERSION): only exactly-specified float
 * operations (no sin/exp/pow/hypot, whose last bits differ between browsers). Bump
 * GEN_VERSION whenever the output changes, so saved progress and links can tell.
 */
export const GEN_VERSION = 2;

export const ISLAND_SIZE = { min: 32, max: 112 } as const;
const SY = 48;
/** Sea level of the island's lowland, in voxels. */
const BASE = 14;
/** Room left above the highest peak for pillars and the bot. */
const HEADROOM = 9;

export const Biome = { None: 0, Meadow: 1, Highlands: 2, Crystal: 3, Wetlands: 4, Badlands: 5, Forest: 6, Snowy: 7, Desert: 8, Volcanic: 9 } as const;
export type Biome = (typeof Biome)[keyof typeof Biome];
export const BIOME_NAMES = ['none', 'meadow', 'highlands', 'crystal fields', 'wetlands', 'badlands', 'forest', 'snowy peaks', 'desert', 'volcanic'] as const;
/** Gentle colour multipliers per biome (meadow = untinted). */
export const BIOME_TINT: readonly [number, number, number][] = [
  [1, 1, 1],
  [1, 1, 1],
  [0.86, 0.93, 1.08],
  [1.0, 0.9, 1.16],
  [0.78, 1.0, 0.8],
  [1.2, 0.95, 0.76],
  [0.8, 0.96, 0.78],
  [1, 1, 1],
  [1.06, 1.0, 0.9],
  [0.62, 0.56, 0.62],
];

/** Which island of which archipelago. `maxSize` caps the footprint (the inner rings stay small). */
export interface IslandSpec {
  seed: number;
  ix: number;
  iz: number;
  maxSize?: number;
}

export interface Island {
  spec: IslandSpec;
  version: number;
  /** Footprint diameter in voxels before warping. */
  size: number;
  dims: Dims;
  data: Uint8Array;
  /** Biome per column (x + z*sx). */
  biome: Uint8Array;
  stats: { land: number; lake: number; river: number; biomes: number[]; ms: number };
}

/** Per-island character from the seed: size, relief, and climate leanings. */
export function islandParams(spec: IslandSpec) {
  const key = islandKey(spec);
  const r = (k: number) => hash2(k * 7919, k * 104729, key);
  const raw = ISLAND_SIZE.min + Math.floor(r(1) * (ISLAND_SIZE.max - ISLAND_SIZE.min + 1));
  return {
    key,
    size: Math.min(raw, spec.maxSize ?? ISLAND_SIZE.max),
    relief: 0.55 + r(2) * 0.9,
    temp: (r(3) - 0.5) * 0.6,
    moist: (r(4) - 0.5) * 0.6,
    /** About one island in five has a volcanic zone. */
    volcanic: r(5) < 0.22,
  };
}

/** A small positive integer seed for this island (noise seeds must stay small). */
export function islandKey(spec: IslandSpec): number {
  // Chained, not XORed: XORing the multiplied coordinates gave (x, z) and (-x, -z) the
  // same key (v1 had mirror-image twin islands).
  let h = Math.imul((spec.seed >>> 0) ^ 0x9e3779b1, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13) ^ (spec.ix | 0), 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16) ^ Math.imul(spec.iz | 0, 0x27d4eb2f), 0x165667b1);
  h ^= GEN_VERSION * 0x27d4eb2f;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) % 1_000_003;
}

export function generateIsland(spec: IslandSpec): Island {
  const t0 = performance.now();
  const p = islandParams(spec);
  const sub = (k: number) => (p.key + k * 7919) % 1_000_003;
  const W = Math.ceil((p.size + 8) / CS) * CS;
  const N = W * W;
  const c = (W - 1) / 2;
  // The warp and coast noise push the outline out a little, so the unwarped radius is smaller.
  const R = p.size / 2.25;

  // 1. Shape: a domain-warped, noisy disc; only the largest connected piece is kept.
  const mask = new Float32Array(N);
  const fw = 1.6 / R;
  for (let z = 0; z < W; z++)
    for (let x = 0; x < W; x++) {
      const u = (x - c) / R + (fbm(x * fw, z * fw, sub(1), 3) - 0.5) * 0.9;
      const v = (z - c) / R + (fbm(x * fw + 31.7, z * fw - 12.3, sub(2), 3) - 0.5) * 0.9;
      let d = Math.sqrt(u * u + v * v);
      d += (fbm(x * 0.09, z * 0.09, sub(3), 2) - 0.5) * 0.25;
      const edge = x < 3 || z < 3 || x >= W - 3 || z >= W - 3;
      mask[x + z * W] = edge ? -1 : 1 - d;
    }
  const land = largestComponent(mask, W);
  let landCount = 0;
  for (let i = 0; i < N; i++) landCount += land[i];

  // 2. Heightmap: rising from the coast into hills and ridged peaks.
  const h = new Float32Array(N);
  const top = SY - HEADROOM;
  for (let z = 0; z < W; z++)
    for (let x = 0; x < W; x++) {
      const i = x + z * W;
      if (!land[i]) continue;
      let e = Math.min(1, mask[i] * 2.2);
      e = e * e * (3 - 2 * e);
      const hills = fbm(x * 0.03, z * 0.03, sub(4), 3);
      const rn = fbm(x * 0.022, z * 0.022, sub(5), 4);
      const ridge = 1 - Math.abs(2 * rn - 1);
      // A broad mountain mask decides where the ridges rise, so peaks gather in ranges.
      const range = Math.max(0, fbm(x * 0.012, z * 0.012, sub(16), 2) * 2 - 0.7);
      const lift = 2 + p.relief * (hills * 12 + ridge * ridge * range * 30 - 3);
      h[i] = Math.min(top, BASE + e * Math.max(0, lift));
    }

  // 3. Erosion: gullies, valleys, and fans where the slope eases.
  erode(h, land, W, rng(sub(6)), { ...EROSION, floor: BASE - 5 });
  // Erosion leaves sub-voxel grit that rounds into lone 1-block bumps: smooth it away,
  // keeping the gullies (a light blur, twice).
  smooth(h, land, W);
  smooth(h, land, W);

  // 4. Biomes from temperature (falls with height) and moisture (gathers in lowlands).
  const biome = new Uint8Array(N);
  for (let z = 0; z < W; z++)
    for (let x = 0; x < W; x++) {
      const i = x + z * W;
      if (!land[i]) continue;
      const elev = (h[i] - BASE) / 24;
      const t = 0.5 + p.temp + (fbm(x * 0.025, z * 0.025, sub(7), 3) - 0.5) * 0.9 - elev * 0.55;
      const m = 0.5 + p.moist + (fbm(x * 0.025 + 50, z * 0.025, sub(8), 3) - 0.5) * 0.9 - elev * 0.3;
      const hot = p.volcanic && fbm(x * 0.03, z * 0.03, sub(17), 2) + elev * 0.25 > 0.68;
      biome[i] =
        hot ? Biome.Volcanic
        : t < 0.04 || elev > 1.0 ? Biome.Snowy
        : t < 0.14 || elev > 0.82 ? Biome.Highlands
        : m > 0.66 ? Biome.Wetlands
        : t > 0.58 && m < 0.32 ? Biome.Desert
        : t > 0.56 && m < 0.5 ? Biome.Badlands
        : m > 0.5 && t > 0.3 ? Biome.Forest
        : m < 0.34 && t < 0.5 ? Biome.Crystal
        : Biome.Meadow;
      // Badlands: flat-topped mesas in 3-voxel steps (cliffs the bot must dig or pillar).
      if (biome[i] === Biome.Badlands) h[i] = BASE + Math.floor((h[i] - BASE) / 3) * 3 + 0.25;
      // Desert: rolling dunes.
      if (biome[i] === Biome.Desert) h[i] += (fbm(x * 0.07, z * 0.11, sub(18), 2) - 0.5) * 4;
    }

  // 5. Water: pits fill into lakes; heavy flow carves rivers. Wetlands catch more rain.
  const rain = new Float32Array(N);
  for (let i = 0; i < N; i++) rain[i] = biome[i] === Biome.Wetlands ? 2 : biome[i] === Biome.Badlands ? 0.5 : biome[i] === Biome.Desert ? 0.3 : 1;
  const { filled, flow } = drainage(h, land, W, rain);
  const ground = new Int16Array(N).fill(-1);
  const water = new Int16Array(N).fill(-1); // highest water voxel per column
  const riverMin = Math.max(30, landCount * 0.02);
  let lake = 0, river = 0;
  const isRiver = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (!land[i]) continue;
    const g = Math.max(3, Math.min(top, Math.round(h[i])));
    const level = Math.floor(filled[i] + 1e-9);
    ground[i] = g;
    if (g < level) {
      water[i] = level;
      lake++;
    } else if (flow[i] >= riverMin && biome[i] !== Biome.Highlands) {
      // Flush with the banks: the bed drops 1 (2 for big rivers), water fills back up to the top.
      const depth = flow[i] >= riverMin * 5 ? 2 : 1;
      ground[i] = g - depth;
      water[i] = g;
      isRiver[i] = 1;
    }
  }
  // A river may stand no higher than its banks, or it would hang in the air beside lower
  // ground. Steps down to the next river cell are fine (little cascades), and so is the
  // coast (waterfalls). Where the banks are too low the bed stays a dry gully.
  for (let i = 0; i < N; i++) {
    if (!isRiver[i]) continue;
    let cap = water[i];
    for (const d of [1, -1, W, -W]) {
      const j = i + d;
      if (land[j] && !isRiver[j]) cap = Math.min(cap, Math.max(ground[j], water[j]));
    }
    water[i] = cap > ground[i] ? cap : -1;
  }
  for (let i = 0; i < N; i++) river += isRiver[i] && water[i] >= 0 ? 1 : 0;
  // Wetland ponds (and rarer desert oases): small dips in flat ground, filled to the brim.
  for (let z = 1; z < W - 1; z++)
    for (let x = 1; x < W - 1; x++) {
      const i = x + z * W;
      const pond = biome[i] === Biome.Wetlands ? 0.6 : biome[i] === Biome.Desert ? 0.72 : 2;
      if (water[i] >= 0 || fbm(x * 0.12, z * 0.12, sub(9), 2) < pond) continue;
      const g = ground[i];
      if ([1, -1, W, -W].some((d) => !land[i + d] || Math.max(ground[i + d], water[i + d]) < g)) continue;
      ground[i] = g - 1;
      water[i] = g;
      lake++;
    }

  // 6. Voxels: biome layers over a stone core whose depth grows away from the coast.
  const dims: Dims = { sx: W, sy: SY, sz: W };
  const data = new Uint8Array(W * SY * W);
  const put = (x: number, y: number, z: number, m: Mat) => (data[x + z * W + y * W * W] = m);
  const biomeCount = new Array<number>(BIOME_NAMES.length).fill(0);
  for (let z = 0; z < W; z++)
    for (let x = 0; x < W; x++) {
      const i = x + z * W;
      if (!land[i]) continue;
      const b = biome[i];
      biomeCount[b]++;
      const g = ground[i];
      const wet = water[i] >= 0;
      const thick = 3 + Math.floor(Math.min(1, mask[i] * 1.6) * 16 + fbm(x * 0.1, z * 0.1, sub(10), 2) * 5);
      const bottom = Math.max(1, g - thick);
      for (let y = bottom; y <= g; y++) put(x, y, z, layer(b, g - y, y, wet, x, z, sub(11)));
      if (!wet) continue;
      if (b === Biome.Volcanic) {
        // Lava where water would be, with stepping stones so channels can be crossed.
        const ford = isRiver[i] && hash2(x, z, sub(19)) < 0.22;
        for (let y = g + 1; y < water[i]; y++) put(x, y, z, Mat.Stone);
        put(x, water[i], z, ford ? Mat.Stone : Mat.Magma);
        continue;
      }
      for (let y = g + 1; y <= water[i]; y++) put(x, y, z, Mat.Water);
    }

  // 7. Crystal fields: spires and broken crystal walls (crystal can't be dug).
  const cr = rng(sub(12));
  for (let z = 2; z < W - 2; z++)
    for (let x = 2; x < W - 2; x++) {
      const i = x + z * W;
      if (biome[i] !== Biome.Crystal || water[i] >= 0) continue;
      const g = ground[i];
      const spire = hash2(x, z, sub(13)) < 0.025;
      const band = Math.abs(fbm(x * 0.07, z * 0.07, sub(14), 2) - 0.5) < 0.018 && hash2(x, z, sub(15)) > 0.2;
      if (!spire && !band) continue;
      const tall = spire ? 3 + Math.floor(cr() * 4) : 2;
      for (let y = g + 1; y <= Math.min(SY - 3, g + tall); y++) put(x, y, z, Mat.Crystal);
    }

  // 8. Forests: trees on a jittered 5-voxel grid (timber trunks, leafy canopies the bot
  // can push through), and volcanic vents.
  // Canopies stay over land, so nothing hangs past the coast.
  const empty = (x: number, y: number, z: number) => x >= 0 && z >= 0 && x < W && z < W && land[x + z * W] === 1 && y < SY - 2 && data[x + z * W + y * W * W] === Mat.Air;
  for (let gz = 0; gz < W; gz += 5)
    for (let gx = 0; gx < W; gx += 5) {
      const x = gx + Math.floor(hash2(gx, gz, sub(20)) * 5), z = gz + Math.floor(hash2(gx, gz, sub(21)) * 5);
      if (x < 3 || z < 3 || x >= W - 3 || z >= W - 3) continue;
      const i = x + z * W;
      if (biome[i] !== Biome.Forest || water[i] >= 0 || hash2(gx, gz, sub(22)) > 0.75) continue;
      const g = ground[i];
      const tall = 3 + Math.floor(hash2(gx, gz, sub(23)) * 3);
      if (g + tall + 2 >= SY - 3) continue;
      for (let y = g + 1; y <= g + tall; y++) put(x, y, z, Mat.Timber);
      const top = g + tall;
      for (let dy = -1; dy <= 2; dy++) {
        const r = dy === 2 ? 1 : 2;
        for (let dz = -r; dz <= r; dz++)
          for (let dx = -r; dx <= r; dx++) {
            if (Math.abs(dx) === r && Math.abs(dz) === r) continue; // round the corners
            if (empty(x + dx, top + dy, z + dz)) put(x + dx, top + dy, z + dz, Mat.Leaves);
          }
      }
    }
  for (let z = 3; z < W - 3; z++)
    for (let x = 3; x < W - 3; x++) {
      const i = x + z * W;
      if (biome[i] !== Biome.Volcanic || water[i] >= 0 || hash2(x, z, sub(24)) > 0.012) continue;
      put(x, ground[i], z, Mat.Magma);
    }

  return {
    spec,
    version: GEN_VERSION,
    size: p.size,
    dims,
    data,
    biome,
    stats: { land: landCount, lake, river, biomes: biomeCount, ms: performance.now() - t0 },
  };
}

/** The block at `depth` below a column's surface. */
function layer(b: number, depth: number, y: number, underwater: boolean, x: number, z: number, seed: number): Mat {
  if (depth === 0 && underwater) return Mat.Soil;
  switch (b) {
    case Biome.Highlands:
      // Bare slate, with a little turf in sheltered spots.
      if (depth === 0) return hash2(x >> 1, z >> 1, seed) < 0.18 ? Mat.Grass : Mat.Stone;
      return Mat.Stone;
    case Biome.Badlands:
      // Clay caps over striped clay and slate cliffs.
      if (depth === 0) return Mat.Soil;
      return (y >> 1) % 2 ? Mat.Soil : Mat.Stone;
    case Biome.Wetlands:
      // Boggy ground in patches.
      if (depth === 0) return hash2(x >> 1, z >> 1, seed + 1) < 0.3 ? Mat.Mud : Mat.Grass;
      return depth <= 3 ? Mat.Soil : Mat.Stone;
    case Biome.Forest:
      return depth === 0 ? Mat.Grass : depth <= 3 ? Mat.Soil : Mat.Stone;
    case Biome.Snowy:
      return depth === 0 ? Mat.Snow : Mat.Stone;
    case Biome.Desert:
      return depth <= 3 ? Mat.Sand : (y >> 1) % 3 ? Mat.Sand : Mat.Stone;
    case Biome.Volcanic:
      return Mat.Stone;
    default:
      return depth === 0 ? Mat.Grass : depth <= 2 ? Mat.Soil : Mat.Stone;
  }
}

/** One 3×3 weighted blur over the land (the coast doesn't pull in the sky's zero). */
function smooth(h: Float32Array, land: Uint8Array, W: number): void {
  const src = h.slice();
  for (let z = 1; z < W - 1; z++)
    for (let x = 1; x < W - 1; x++) {
      const i = x + z * W;
      if (!land[i]) continue;
      let sum = src[i] * 4, wsum = 4;
      for (const [d, w] of [[1, 2], [-1, 2], [W, 2], [-W, 2], [W + 1, 1], [W - 1, 1], [-W + 1, 1], [-W - 1, 1]]) {
        if (!land[i + d]) continue;
        sum += src[i + d] * w;
        wsum += w;
      }
      h[i] = sum / wsum;
    }
}

/** Keeps the largest 4-connected region where mask > 0. */
function largestComponent(mask: Float32Array, W: number): Uint8Array {
  const N = W * W;
  const label = new Int32Array(N);
  const stack = new Int32Array(N);
  let best = 0, bestSize = 0, next = 0;
  for (let s = 0; s < N; s++) {
    if (mask[s] <= 0 || label[s]) continue;
    const id = ++next;
    let size = 0, sp = 0;
    stack[sp++] = s;
    label[s] = id;
    while (sp) {
      const i = stack[--sp];
      size++;
      const x = i % W;
      for (const n of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) {
        if (n < 0 || n >= N || label[n] || mask[n] <= 0) continue;
        label[n] = id;
        stack[sp++] = n;
      }
    }
    if (size > bestSize) (bestSize = size), (best = id);
  }
  const land = new Uint8Array(N);
  for (let i = 0; i < N; i++) land[i] = label[i] === best && best > 0 ? 1 : 0;
  return land;
}
