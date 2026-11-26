import { Mat } from '../world/materials';
import { fbm, hash2, rng } from '../world/noise';
import { CS, type Dims } from '../world/world';
import { drainage, erode, EROSION } from './hydro';

/**
 * Island generator v3: shape → heightmap → erosion → biomes → lakes and rivers → voxels →
 * caves, ledges, arches and ruins → crystals and trees.
 *
 * Deterministic per (seed, ix, iz, size cap, GEN_VERSION): only exactly-specified float
 * operations (no sin/exp/pow/hypot, whose last bits differ between browsers). Bump
 * GEN_VERSION whenever the output changes, so saved progress and links can tell.
 */
export const GEN_VERSION = 3;

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
  stats: { land: number; lake: number; river: number; biomes: number[]; caves: number; arches: number; ruins: number; ms: number };
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
  /** Lowest voxel per column (caves never cut into the island's underside). */
  const bottomOf = new Int16Array(N).fill(-1);
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
      bottomOf[i] = bottom;
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

  // 7. Deeper islands: caves, rock ledges, natural arches and ruins.
  const at = (x: number, y: number, z: number) => data[x + z * W + y * W * W];
  const deep = { land, ground, water, bottomOf, biome, W, put, at, sub };
  const caves = carveCaves(deep, landCount);
  addLedges(deep);
  const arches = addArches(deep, landCount);
  const ruins = addRuins(deep, landCount);

  // 8. Crystal fields: spires and broken crystal walls (crystal can't be dug).
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

  // 9. Forests: trees on a jittered 5-voxel grid (timber trunks, leafy canopies the bot
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
      if (g + tall + 2 >= SY - 3 || !empty(x, g + 1, z) || at(x, g, z) === Mat.Air) continue;
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
    stats: { land: landCount, lake, river, biomes: biomeCount, caves, arches, ruins, ms: performance.now() - t0 },
  };
}

/** What the deeper-island passes need: the column tables and voxel access. */
interface Deep {
  land: Uint8Array;
  /** Surface height per column; kept up to date when a pass opens a column to the sky. */
  ground: Int16Array;
  water: Int16Array;
  bottomOf: Int16Array;
  biome: Uint8Array;
  W: number;
  put: (x: number, y: number, z: number, m: Mat) => void;
  at: (x: number, y: number, z: number) => number;
  sub: (k: number) => number;
}

const ROCKY: number[] = [Biome.Highlands, Biome.Badlands, Biome.Snowy, Biome.Volcanic];

/**
 * Caves: tunnels that wander into the hills from cave mouths on the slopes, about 3 voxels
 * tall so the bot can walk them, sometimes widening into a chamber or forking. They stay
 * two voxels clear of the underside and keep a two-voxel roof under water and lava.
 * Returns how many voxels were dug out.
 */
function carveCaves(d: Deep, landCount: number): number {
  const { land, ground, water, bottomOf, W, put, at, sub } = d;
  const rand = rng(sub(30));
  const want = Math.round(landCount / 800);
  let carved = 0;
  const carve = (cx: number, cy: number, cz: number, r2: number) => {
    const r = r2 > 3 ? 2 : 1;
    const x0 = Math.round(cx), y0 = Math.round(cy), z0 = Math.round(cz);
    for (let dy = -r; dy <= r; dy++)
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy + dz * dz > r2) continue;
          const x = x0 + dx, y = y0 + dy, z = z0 + dz;
          if (x < 3 || z < 3 || x >= W - 3 || z >= W - 3) continue;
          const i = x + z * W;
          if (!land[i] || y <= bottomOf[i] + 1 || y > ground[i]) continue;
          if (water[i] >= 0 && y >= ground[i] - 1) continue;
          if (at(x, y, z) === Mat.Air) continue;
          put(x, y, z, Mat.Air);
          carved++;
          if (y === ground[i]) {
            // Opened to the sky: the column's surface is now the next solid voxel down.
            let g = y - 1;
            while (g > bottomOf[i] && at(x, g, z) === Mat.Air) g--;
            ground[i] = g;
          }
        }
  };
  const worm = (x: number, y: number, z: number, dx: number, dz: number, steps: number, branch: boolean) => {
    let dy = -0.08;
    for (let s = 0; s < steps; s++) {
      const chamber = rand() < 0.04;
      carve(x, y, z, chamber ? 4.5 : 2.1);
      // Wander: turn a little, drift up or down gently (walkable slopes).
      dx += (rand() - 0.5) * 0.7;
      dz += (rand() - 0.5) * 0.7;
      const len = Math.sqrt(dx * dx + dz * dz) || 1;
      dx /= len;
      dz /= len;
      dy = Math.max(-0.3, Math.min(0.3, dy + (rand() - 0.5) * 0.16));
      x += dx;
      z += dz;
      y += dy;
      const ix = Math.round(x), iz = Math.round(z);
      if (ix < 4 || iz < 4 || ix >= W - 4 || iz >= W - 4 || !land[ix + iz * W]) return;
      // Keep inside the rock: rise if near the underside, sink if about to break the surface.
      const i = ix + iz * W;
      if (y < bottomOf[i] + 4) dy = Math.abs(dy) + 0.1;
      if (y > ground[i] - 2 && s > 4) dy = -Math.abs(dy) - 0.1;
      if (branch && s === Math.floor(steps / 2)) worm(x, y, z, -dz, dx, Math.floor(steps * 0.6), false);
    }
  };
  let dug = 0;
  for (let t = 0; t < want * 80 && dug < want; t++) {
    const x = 6 + Math.floor(rand() * (W - 12)), z = 6 + Math.floor(rand() * (W - 12));
    const i = x + z * W;
    if (!land[i] || water[i] >= 0) continue;
    // A mouth: dry ground within 3 cells that lies at least 3 lower; dig in from there
    // (on a gentler slope the tunnel starts as a cutting).
    let found = false;
    for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (let k = 1; k <= 3 && !found; k++) {
        const mx = x + ox * k, mz = z + oz * k, j = mx + mz * W;
        if (!land[j] || water[j] >= 0) break;
        if (ground[j] > ground[i] - 3) continue;
        worm(mx, ground[j] + 2, mz, -ox, -oz, 24 + Math.floor(rand() * 40), rand() < 0.5);
        found = true;
      }
      if (found) break;
    }
    if (found) dug++;
  }
  return carved;
}

/** Rock ledges: the top of a cliff juts out over the drop (rocky biomes). */
function addLedges(d: Deep): void {
  const { land, ground, water, biome, W, put, at, sub } = d;
  for (let z = 4; z < W - 4; z++)
    for (let x = 4; x < W - 4; x++) {
      const i = x + z * W;
      if (!land[i] || water[i] >= 0 || !ROCKY.includes(biome[i])) continue;
      const g = ground[i];
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([ox, oz], k) => {
        const j = x + ox + (z + oz) * W;
        if (!land[j] || water[j] >= 0 || ground[j] > g - 4 || hash2(x * 4 + k, z, sub(31)) > 0.35) return;
        const top = at(x, g, z) as Mat, under = at(x, g - 1, z) as Mat;
        if (top === Mat.Air || under === Mat.Air) return;
        // One cell out, sometimes two when the drop continues.
        for (let n = 1; n <= 2; n++) {
          const lx = x + ox * n, lz = z + oz * n, l = lx + lz * W;
          if (!land[l] || water[l] >= 0 || ground[l] > g - 4 || (n === 2 && hash2(x, z * 4 + k, sub(32)) > 0.4)) break;
          if (at(lx, g, lz) !== Mat.Air || at(lx, g - 1, lz) !== Mat.Air) break;
          put(lx, g, lz, top);
          put(lx, g - 1, lz, under);
        }
      });
    }
}

/**
 * Natural arches over rocky ground and desert: a 2×2 band of rock rising from one foot
 * to the other, high enough to walk under. Returns how many were built.
 */
function addArches(d: Deep, landCount: number): number {
  const { land, ground, water, biome, W, put, at, sub } = d;
  const rand = rng(sub(33));
  const want = Math.round(landCount / 2600);
  const ok = (x: number, z: number) => {
    if (x < 5 || z < 5 || x >= W - 5 || z >= W - 5) return false;
    const i = x + z * W;
    return land[i] === 1 && water[i] < 0 && (ROCKY.includes(biome[i]) || biome[i] === Biome.Desert);
  };
  let built = 0;
  for (let t = 0; t < want * 40 && built < want; t++) {
    const ax = Math.floor(rand() * W), az = Math.floor(rand() * W);
    if (!ok(ax, az)) continue;
    let dx = rand() - 0.5, dz = rand() - 0.5;
    const len = Math.sqrt(dx * dx + dz * dz) || 1;
    dx /= len;
    dz /= len;
    const span = 8 + Math.floor(rand() * 6);
    const bx = Math.round(ax + dx * span), bz = Math.round(az + dz * span);
    if (!ok(bx, bz)) continue;
    const ga = ground[ax + az * W], gb = ground[bx + bz * W];
    const rise = 5 + Math.floor(rand() * 4);
    const apex = Math.max(ga, gb) + rise;
    if (apex >= SY - HEADROOM) continue;
    const m = biome[ax + az * W] === Biome.Desert ? Mat.Sand : Mat.Stone;
    const px = -dz, pz = dx; // across the band
    const steps = span * 3;
    for (let s = 0; s <= steps; s++) {
      const f = s / steps;
      const base = ga + (gb - ga) * f;
      const y = Math.round(base + (apex - base) * 4 * f * (1 - f));
      for (let w = 0; w < 2; w++) {
        const x = Math.round(ax + (bx - ax) * f + px * w), z = Math.round(az + (bz - az) * f + pz * w);
        if (x < 3 || z < 3 || x >= W - 3 || z >= W - 3 || !land[x + z * W]) continue;
        for (let k = 0; k < 2; k++) if (y - k > ground[x + z * W] && at(x, y - k, z) === Mat.Air) put(x, y - k, z, m);
      }
    }
    built++;
  }
  return built;
}

/**
 * Ruins: old walled enclosures on flat dry ground. Slate walls (sand in the desert)
 * crumbled in places, a timber gate the bot can dig through, sometimes a second open
 * doorway, and an inner wall with one gap. Returns how many were built.
 */
function addRuins(d: Deep, landCount: number): number {
  const { land, ground, water, biome, W, put, at, sub } = d;
  const rand = rng(sub(34));
  const want = Math.max(1, Math.round(landCount / 2200));
  const used = new Uint8Array(W * W);
  let built = 0;
  for (let t = 0; t < want * 150 && built < want; t++) {
    const a = 7 + Math.floor(rand() * 5), b = 7 + Math.floor(rand() * 5);
    const x0 = 5 + Math.floor(rand() * (W - 10 - a)), z0 = 5 + Math.floor(rand() * (W - 10 - b));
    if (x0 < 5 || z0 < 5) continue;
    let lo = 99, hi = -1, fits = true;
    for (let z = z0 - 1; z <= z0 + b && fits; z++)
      for (let x = x0 - 1; x <= x0 + a && fits; x++) {
        const i = x + z * W;
        if (!land[i] || water[i] >= 0 || used[i] || biome[i] === Biome.Volcanic || biome[i] === Biome.Wetlands) fits = false;
        else (lo = Math.min(lo, ground[i])), (hi = Math.max(hi, ground[i]));
      }
    if (!fits || hi - lo > 3 || hi + 5 >= SY - HEADROOM) continue;
    const m = biome[x0 + z0 * W] === Biome.Desert ? Mat.Sand : Mat.Stone;
    const top = hi + 3;
    const wall = (x: number, z: number, h: number) => {
      for (let y = ground[x + z * W] + 1; y <= h; y++) if (at(x, y, z) === Mat.Air || at(x, y, z) === Mat.Leaves) put(x, y, z, m);
    };
    // The outer wall, crumbling in places (and broken right down now and then).
    const ring: [number, number][] = [];
    for (let x = x0; x < x0 + a; x++) ring.push([x, z0], [x, z0 + b - 1]);
    for (let z = z0 + 1; z < z0 + b - 1; z++) ring.push([x0, z], [x0 + a - 1, z]);
    for (const [x, z] of ring) {
      const r = hash2(x, z, sub(35));
      wall(x, z, r < 0.08 ? ground[x + z * W] : r < 0.3 ? top - 1 : top);
    }
    // The gate: a 1-wide doorway in the middle of one side, closed by timber.
    const side = Math.floor(rand() * 4);
    const doors: [number, number][] = [
      [x0 + (a >> 1), z0], [x0 + (a >> 1), z0 + b - 1], [x0, z0 + (b >> 1)], [x0 + a - 1, z0 + (b >> 1)],
    ];
    const [gx, gz] = doors[side];
    for (let y = ground[gx + gz * W] + 1; y <= top; y++) put(gx, y, gz, y <= ground[gx + gz * W] + 2 ? Mat.Timber : m);
    // Sometimes an open doorway opposite.
    if (rand() < 0.5) {
      const [ox, oz] = doors[side ^ 1];
      for (let y = ground[ox + oz * W] + 1; y <= ground[ox + oz * W] + 2; y++) put(ox, y, oz, Mat.Air);
    }
    // An inner wall across the long side, with one gap.
    const alongX = a >= b;
    const n = alongX ? b - 2 : a - 2;
    const gap = 1 + Math.floor(rand() * n);
    for (let k = 1; k <= n; k++) {
      if (k === gap) continue;
      const x = alongX ? x0 + (a >> 1) : x0 + k, z = alongX ? z0 + k : z0 + (b >> 1);
      wall(x, z, top - 1);
    }
    for (let z = z0 - 2; z <= z0 + b + 1; z++) for (let x = x0 - 2; x <= x0 + a + 1; x++) if (x >= 0 && z >= 0 && x < W && z < W) used[x + z * W] = 1;
    built++;
  }
  return built;
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
