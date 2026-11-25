import { Mat } from './materials';
import { CS, World } from './world';

const CS2 = CS * CS;
const CS3 = CS2 * CS;

/** Map key for a chunk's coordinates (any integers, negative included). */
const key = (cx: number, cy: number, cz: number) => `${cx},${cy},${cz}`;

/**
 * The whole sky, sparsely: 16³ chunks keyed by chunk coordinates, in sky (world) voxel
 * coordinates that may be negative. Only chunks with something in them are kept.
 *
 * A course runs in a dense `World` window: `readWindow` copies the window's box out of
 * the store, `writeWindow` puts the (edited) window back.
 */
export class ChunkStore {
  private chunks = new Map<string, Uint8Array>();

  get size(): number {
    return this.chunks.size;
  }

  get(x: number, y: number, z: number): Mat {
    const c = this.chunks.get(key(Math.floor(x / CS), Math.floor(y / CS), Math.floor(z / CS)));
    if (!c) return Mat.Air;
    return c[mod(x) + mod(z) * CS + mod(y) * CS2] as Mat;
  }

  set(x: number, y: number, z: number, m: Mat): void {
    const k = key(Math.floor(x / CS), Math.floor(y / CS), Math.floor(z / CS));
    let c = this.chunks.get(k);
    if (!c) {
      if (m === Mat.Air) return;
      c = new Uint8Array(CS3);
      this.chunks.set(k, c);
    }
    c[mod(x) + mod(z) * CS + mod(y) * CS2] = m;
  }

  /** Fills `world` (keeping its size) from the store, with local (0,0,0) at `origin`. */
  readWindow(world: World, origin: [number, number, number] = world.origin): void {
    world.origin = [...origin];
    world.data.fill(Mat.Air);
    const [ox, oy, oz] = origin;
    this.forChunksIn(world, origin, (c, cx, cy, cz) => {
      if (!c) return;
      for (let ly = 0; ly < CS; ly++)
        for (let lz = 0; lz < CS; lz++)
          for (let lx = 0; lx < CS; lx++) {
            const m = c[lx + lz * CS + ly * CS2];
            if (m === Mat.Air) continue;
            const x = cx * CS + lx - ox, y = cy * CS + ly - oy, z = cz * CS + lz - oz;
            if (world.contains(x, y, z)) world.data[world.index(x, y, z)] = m;
          }
    });
    world.version++;
    world.markAllDirty();
  }

  /** Writes the window back into the store at its origin; chunks left empty are dropped. */
  writeWindow(world: World): void {
    const [ox, oy, oz] = world.origin;
    this.forChunksIn(world, world.origin, (existing, cx, cy, cz) => {
      const c = existing ?? new Uint8Array(CS3);
      for (let ly = 0; ly < CS; ly++)
        for (let lz = 0; lz < CS; lz++)
          for (let lx = 0; lx < CS; lx++) {
            const x = cx * CS + lx - ox, y = cy * CS + ly - oy, z = cz * CS + lz - oz;
            if (world.contains(x, y, z)) c[lx + lz * CS + ly * CS2] = world.data[world.index(x, y, z)];
          }
      const k = key(cx, cy, cz);
      if (c.some((m) => m !== Mat.Air)) this.chunks.set(k, c);
      else this.chunks.delete(k);
    });
  }

  /** Every store chunk overlapping the window's box (null = not stored, i.e. all air). */
  private forChunksIn(
    d: World,
    origin: readonly [number, number, number],
    fn: (c: Uint8Array | null, cx: number, cy: number, cz: number) => void,
  ): void {
    const [ox, oy, oz] = origin;
    const lo = [Math.floor(ox / CS), Math.floor(oy / CS), Math.floor(oz / CS)];
    const hi = [Math.floor((ox + d.sx - 1) / CS), Math.floor((oy + d.sy - 1) / CS), Math.floor((oz + d.sz - 1) / CS)];
    for (let cy = lo[1]; cy <= hi[1]; cy++)
      for (let cz = lo[2]; cz <= hi[2]; cz++)
        for (let cx = lo[0]; cx <= hi[0]; cx++) fn(this.chunks.get(key(cx, cy, cz)) ?? null, cx, cy, cz);
  }
}

/** Position inside a chunk, also for negative coordinates. */
function mod(v: number): number {
  return ((v % CS) + CS) % CS;
}
