import { Mat } from './materials';

/** World size in voxels. Y is up. */
export const SX = 64;
export const SY = 32;
export const SZ = 64;
/** Chunk edge length in voxels. */
export const CS = 16;
export const CX = SX / CS;
export const CY = SY / CS;
export const CZ = SZ / CS;
export const CHUNK_COUNT = CX * CY * CZ;

/** The ONLY place voxel coordinates turn into array indices. */
export function voxelIndex(x: number, y: number, z: number): number {
  return x + z * SX + y * SX * SZ;
}

export function chunkIndex(cx: number, cy: number, cz: number): number {
  return cx + cz * CX + cy * CX * CZ;
}

export function inBounds(x: number, y: number, z: number): boolean {
  return x >= 0 && y >= 0 && z >= 0 && x < SX && y < SY && z < SZ;
}

export class World {
  readonly data = new Uint8Array(SX * SY * SZ);
  /** Chunk indices whose meshes need rebuilding. */
  readonly dirty = new Set<number>();
  /** Bumped on every change, so async consumers (the search worker) can detect stale results. */
  version = 0;

  get(x: number, y: number, z: number): Mat {
    if (!inBounds(x, y, z)) return Mat.Air;
    return this.data[voxelIndex(x, y, z)] as Mat;
  }

  set(x: number, y: number, z: number, m: Mat): void {
    if (!inBounds(x, y, z)) return;
    const i = voxelIndex(x, y, z);
    if (this.data[i] === m) return;
    this.data[i] = m;
    this.version++;
    this.markAround(x, y, z);
  }

  /** Bulk write without dirty tracking; call markAllDirty() afterwards. */
  setRaw(x: number, y: number, z: number, m: Mat): void {
    if (inBounds(x, y, z)) this.data[voxelIndex(x, y, z)] = m;
  }

  clear(): void {
    this.data.fill(Mat.Air);
    this.version++;
    this.markAllDirty();
  }

  markAllDirty(): void {
    for (let i = 0; i < CHUNK_COUNT; i++) this.dirty.add(i);
  }

  /** Marks the voxel's chunk, plus neighbours when it sits on a border (their AO / culling depends on it). */
  private markAround(x: number, y: number, z: number): void {
    for (let dy = -1; dy <= 1; dy++)
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy, nz = z + dz;
          if (!inBounds(nx, ny, nz)) continue;
          this.dirty.add(chunkIndex((nx / CS) | 0, (ny / CS) | 0, (nz / CS) | 0));
        }
  }
}
