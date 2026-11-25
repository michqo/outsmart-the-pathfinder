import { Mat } from './materials';

/**
 * The default window size in voxels (Y is up). Hand-made levels, the test island and v1
 * share links use exactly this size; generated islands can use bigger windows.
 */
export const SX = 64;
export const SY = 32;
export const SZ = 64;
/** Chunk edge length in voxels. Window sizes are always multiples of it. */
export const CS = 16;
/** Largest window (an island plus margin); keeps every search and texture bounded. */
export const MAX_DIMS = { sx: 256, sy: 64, sz: 256 } as const;

/** A window's size. `World` is one; pure helpers take just this. */
export interface Dims {
  readonly sx: number;
  readonly sy: number;
  readonly sz: number;
}
export const DEFAULT_DIMS: Dims = { sx: SX, sy: SY, sz: SZ };

/** The ONLY place voxel coordinates turn into array indices: x fastest, then z, then y. */
export function voxelIndex(d: Dims, x: number, y: number, z: number): number {
  return x + z * d.sx + y * d.sx * d.sz;
}

export function voxelCoords(d: Dims, i: number): [number, number, number] {
  const x = i % d.sx;
  const z = Math.floor(i / d.sx) % d.sz;
  const y = Math.floor(i / (d.sx * d.sz));
  return [x, y, z];
}

export function inBounds(d: Dims, x: number, y: number, z: number): boolean {
  return x >= 0 && y >= 0 && z >= 0 && x < d.sx && y < d.sy && z < d.sz;
}

export function sameDims(a: Dims, b: Dims): boolean {
  return a.sx === b.sx && a.sy === b.sy && a.sz === b.sz;
}

/**
 * A dense window onto the sky: everything a course needs (meshing, search, the bot,
 * editing) works in this window's local coordinates. `origin` is where local (0,0,0)
 * sits in sky (world) coordinates; the sparse `ChunkStore` holds the rest of the sky.
 */
export class World implements Dims {
  sx: number;
  sy: number;
  sz: number;
  /** Chunks per axis. */
  cx: number;
  cy: number;
  cz: number;
  data: Uint8Array;
  /** Sky coordinates of local voxel (0,0,0). */
  origin: [number, number, number] = [0, 0, 0];
  /** Chunk indices whose meshes need rebuilding. */
  readonly dirty = new Set<number>();
  /** Bumped on every change, so async consumers (the search worker) can detect stale results. */
  version = 0;
  /** Bumped when the window changes size: consumers sized to it (meshes, textures) rebuild. */
  shapeVersion = 0;

  constructor(sx = SX, sy = SY, sz = SZ) {
    checkDims(sx, sy, sz);
    this.sx = sx;
    this.sy = sy;
    this.sz = sz;
    this.cx = sx / CS;
    this.cy = sy / CS;
    this.cz = sz / CS;
    this.data = new Uint8Array(sx * sy * sz);
  }

  get chunkCount(): number {
    return this.cx * this.cy * this.cz;
  }

  index(x: number, y: number, z: number): number {
    return x + z * this.sx + y * this.sx * this.sz;
  }

  coords(i: number): [number, number, number] {
    return voxelCoords(this, i);
  }

  contains(x: number, y: number, z: number): boolean {
    return x >= 0 && y >= 0 && z >= 0 && x < this.sx && y < this.sy && z < this.sz;
  }

  chunkIndex(cx: number, cy: number, cz: number): number {
    return cx + cz * this.cx + cy * this.cx * this.cz;
  }

  /**
   * Resizes the window (contents become air) and moves its origin. A no-op on the data when
   * the size is unchanged; otherwise `shapeVersion` bumps so sized consumers rebuild.
   */
  reshape(sx: number, sy: number, sz: number, origin: [number, number, number] = [0, 0, 0]): void {
    checkDims(sx, sy, sz);
    this.origin = [...origin];
    if (sx !== this.sx || sy !== this.sy || sz !== this.sz) {
      this.sx = sx;
      this.sy = sy;
      this.sz = sz;
      this.cx = sx / CS;
      this.cy = sy / CS;
      this.cz = sz / CS;
      this.data = new Uint8Array(sx * sy * sz);
      this.dirty.clear();
      this.shapeVersion++;
    } else this.data.fill(Mat.Air);
    this.version++;
    this.markAllDirty();
  }

  /** Clears to air at the given size (default: the standard 64×32×64): how generators start. */
  reset(sx = SX, sy = SY, sz = SZ): void {
    this.reshape(sx, sy, sz, this.origin);
  }

  get(x: number, y: number, z: number): Mat {
    if (!this.contains(x, y, z)) return Mat.Air;
    return this.data[this.index(x, y, z)] as Mat;
  }

  set(x: number, y: number, z: number, m: Mat): void {
    if (!this.contains(x, y, z)) return;
    const i = this.index(x, y, z);
    if (this.data[i] === m) return;
    this.data[i] = m;
    this.version++;
    this.markAround(x, y, z);
  }

  /** Bulk write without dirty tracking; call markAllDirty() afterwards. */
  setRaw(x: number, y: number, z: number, m: Mat): void {
    if (this.contains(x, y, z)) this.data[this.index(x, y, z)] = m;
  }

  clear(): void {
    this.data.fill(Mat.Air);
    this.version++;
    this.markAllDirty();
  }

  markAllDirty(): void {
    for (let i = 0; i < this.chunkCount; i++) this.dirty.add(i);
  }

  /** Marks the voxel's chunk, plus neighbours when it sits on a border (their AO / culling depends on it). */
  private markAround(x: number, y: number, z: number): void {
    for (let dy = -1; dy <= 1; dy++)
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy, nz = z + dz;
          if (!this.contains(nx, ny, nz)) continue;
          this.dirty.add(this.chunkIndex((nx / CS) | 0, (ny / CS) | 0, (nz / CS) | 0));
        }
  }
}

function checkDims(sx: number, sy: number, sz: number): void {
  const ok = (v: number, max: number) => Number.isInteger(v) && v > 0 && v % CS === 0 && v <= max;
  if (!ok(sx, MAX_DIMS.sx) || !ok(sy, MAX_DIMS.sy) || !ok(sz, MAX_DIMS.sz))
    throw new Error(`bad window size ${sx}×${sy}×${sz}: multiples of ${CS}, at most ${MAX_DIMS.sx}×${MAX_DIMS.sy}×${MAX_DIMS.sz}`);
}
