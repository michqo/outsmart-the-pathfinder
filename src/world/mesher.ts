import { MAT_COUNT, Mat, OPAQUE } from './materials';
import { CS, World } from './world';

/**
 * Greedy mesher with per-vertex ambient occlusion.
 *
 * Faces only merge when material, facing and AO all match AND the face's four
 * AO values are equal. Faces with a gradient stay 1x1, so the AO interpolation
 * is always correct. Open ground (no occlusion) still merges into big quads.
 */

export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
  quads: number;
}

export interface MeshOptions {
  /**
   * Linear RGB per (material, face kind): index = (mat * 4 + kind) * 3.
   * Kinds: 0 top, 1 side (upper edge), 2 bottom, 3 side (lower edge).
   * Sides blend from kind 1 at the top to kind 3 at the bottom.
   */
  colorTable: Float32Array;
  /** Brightness for AO levels 0 (most occluded) .. 3 (open). */
  aoCurve: [number, number, number, number];
  ao: boolean;
}

export const COLOR_KINDS = 4;
export const COLOR_TABLE_SIZE = MAT_COUNT * COLOR_KINDS * 3;

/** How far the water surface sits below the top of its voxel. */
const WATER_DROP = 0.12;

class Builder {
  pos: number[] = [];
  nrm: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  quads = 0;
  build(): MeshData {
    return {
      positions: new Float32Array(this.pos),
      normals: new Float32Array(this.nrm),
      colors: new Float32Array(this.col),
      indices: new Uint32Array(this.idx),
      quads: this.quads,
    };
  }
}

// Corner offsets (du, dv) in the order the quad's corners are emitted: (0,0) (1,0) (1,1) (0,1).
const CORNERS = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
] as const;

const mask = new Int32Array(CS * CS);
const PRESENT = 1 << 24;

function aoAt(world: World, c: number[], u: number, v: number, k: number): number {
  const p = [c[0], c[1], c[2]];
  const du = CORNERS[k][0], dv = CORNERS[k][1];
  p[u] += du;
  const s1 = OPAQUE[world.get(p[0], p[1], p[2])];
  p[v] += dv;
  const cr = OPAQUE[world.get(p[0], p[1], p[2])];
  p[u] -= du;
  const s2 = OPAQUE[world.get(p[0], p[1], p[2])];
  if (s1 && s2) return 0;
  return 3 - (s1 + s2 + cr);
}

/**
 * Meshes one chunk. A face belongs to the chunk that contains its solid voxel,
 * so chunk borders never produce duplicate faces.
 */
export function meshChunk(
  world: World,
  cx: number,
  cy: number,
  cz: number,
  opts: MeshOptions,
): { opaque: MeshData; water: MeshData } {
  const opaque = new Builder();
  const water = new Builder();
  const c0 = [cx * CS, cy * CS, cz * CS];
  pass(world, c0, opts, false, opaque);
  pass(world, c0, opts, true, water);
  return { opaque: opaque.build(), water: water.build() };
}

function pass(world: World, c0: number[], opts: MeshOptions, waterPass: boolean, out: Builder): void {
  const x = [0, 0, 0];
  const q = [0, 0, 0];
  const layer = [0, 0, 0];

  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3;
    const v = (d + 2) % 3;
    q[0] = q[1] = q[2] = 0;
    q[d] = 1;
    const lo = c0[d], hi = c0[d] + CS;

    for (let s = lo - 1; s < hi; s++) {
      // 1. Build the face mask for the boundary between slice s and s + 1.
      let n = 0;
      for (let j = 0; j < CS; j++)
        for (let i = 0; i < CS; i++, n++) {
          x[d] = s;
          x[u] = c0[u] + i;
          x[v] = c0[v] + j;
          const a = world.get(x[0], x[1], x[2]);
          const b = world.get(x[0] + q[0], x[1] + q[1], x[2] + q[2]);
          let key = 0;
          let back = 0;
          let m = 0;
          if (waterPass) {
            if (a === Mat.Water && b === Mat.Air && s >= lo) m = a;
            else if (b === Mat.Water && a === Mat.Air && s + 1 < hi) (m = b), (back = 1);
          } else {
            if (OPAQUE[a] && !OPAQUE[b] && s >= lo) m = a;
            else if (OPAQUE[b] && !OPAQUE[a] && s + 1 < hi) (m = b), (back = 1);
          }
          if (m) {
            key = PRESENT | m | (back << 4);
            if (!waterPass && opts.ao) {
              // The air layer in front of the face.
              layer[0] = x[0];
              layer[1] = x[1];
              layer[2] = x[2];
              if (!back) layer[d] += 1;
              for (let k = 0; k < 4; k++) key |= aoAt(world, layer, u, v, k) << (5 + 2 * k);
            } else {
              key |= 0xff << 5; // all corners fully lit
            }
          }
          mask[n] = key;
        }

      // 2. Greedily merge the mask into quads.
      n = 0;
      for (let j = 0; j < CS; j++)
        for (let i = 0; i < CS; ) {
          const key = mask[n];
          if (!key) {
            i++;
            n++;
            continue;
          }
          const ao0 = (key >> 5) & 3, ao1 = (key >> 7) & 3, ao2 = (key >> 9) & 3, ao3 = (key >> 11) & 3;
          let w = 1, h = 1;
          if (ao0 === ao1 && ao1 === ao2 && ao2 === ao3) {
            while (i + w < CS && mask[n + w] === key) w++;
            grow: for (; j + h < CS; h++)
              for (let t = 0; t < w; t++) if (mask[n + t + h * CS] !== key) break grow;
          }
          emit(out, opts, waterPass, d, u, v, s + 1, c0[u] + i, c0[v] + j, w, h, key, [ao0, ao1, ao2, ao3]);
          for (let l = 0; l < h; l++) for (let t = 0; t < w; t++) mask[n + t + l * CS] = 0;
          i += w;
          n += w;
        }
    }
  }
}

function emit(
  out: Builder,
  opts: MeshOptions,
  waterPass: boolean,
  d: number,
  u: number,
  v: number,
  plane: number,
  u0: number,
  v0: number,
  w: number,
  h: number,
  key: number,
  ao: number[],
): void {
  const mat = key & 15;
  const back = (key >> 4) & 1;
  const side = d !== 1;
  const kind = side ? 1 : back ? 2 : 0;
  const ci = (mat * COLOR_KINDS + kind) * 3;
  const cb = (mat * COLOR_KINDS + 3) * 3; // lower edge of side faces
  const t = opts.colorTable;
  // Height runs along u when d = 0 (u = y) and along v when d = 2 (v = y).
  const minY = u === 1 ? u0 : v0;
  const planePos = waterPass && d === 1 && !back ? plane - WATER_DROP : plane;
  const sign = back ? -1 : 1;
  const base = out.pos.length / 3;
  const p = [0, 0, 0];
  const nrm = [0, 0, 0];
  nrm[d] = sign;

  for (let k = 0; k < 4; k++) {
    p[d] = planePos;
    p[u] = u0 + (k === 1 || k === 2 ? w : 0);
    p[v] = v0 + (k >= 2 ? h : 0);
    out.pos.push(p[0], p[1], p[2]);
    out.nrm.push(nrm[0], nrm[1], nrm[2]);
    const f = opts.ao && !waterPass ? opts.aoCurve[ao[k]] : 1;
    if (waterPass) out.col.push(1, 1, 1);
    else {
      const c = side && p[1] === minY ? cb : ci;
      out.col.push(t[c] * f, t[c + 1] * f, t[c + 2] * f);
    }
  }

  // Split along the brighter diagonal so AO doesn't streak.
  const diag02 = ao[0] + ao[2] > ao[1] + ao[3];
  if (diag02) {
    if (back) out.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    else out.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  } else {
    if (back) out.idx.push(base + 1, base + 3, base + 2, base + 1, base, base + 3);
    else out.idx.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
  }
  out.quads++;
}
