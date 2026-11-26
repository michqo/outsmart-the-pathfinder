import { Mat } from '../world/materials';
import { CS, type Dims } from '../world/world';

/**
 * A coarse copy of an island for drawing it far away: each f×f×f block becomes one cell,
 * solid when at least a quarter of it is, and wearing the material of its highest voxel
 * (so tops stay grassy). Sizes are padded up to whole chunks for the mesher.
 */
export function downsample(data: Uint8Array, d: Dims, f: number): { dims: Dims; data: Uint8Array } {
  const pad = (n: number) => Math.max(CS, Math.ceil(Math.ceil(n / f) / CS) * CS);
  const out: Dims = { sx: pad(d.sx), sy: pad(d.sy), sz: pad(d.sz) };
  const res = new Uint8Array(out.sx * out.sy * out.sz);
  const need = Math.ceil((f * f * f) / 4);
  for (let cy = 0; cy * f < d.sy; cy++)
    for (let cz = 0; cz * f < d.sz; cz++)
      for (let cx = 0; cx * f < d.sx; cx++) {
        let solid = 0, wet = 0, topY = -1, top: number = Mat.Air;
        for (let y = cy * f; y < Math.min(d.sy, cy * f + f); y++)
          for (let z = cz * f; z < Math.min(d.sz, cz * f + f); z++)
            for (let x = cx * f; x < Math.min(d.sx, cx * f + f); x++) {
              const m = data[x + z * d.sx + y * d.sx * d.sz];
              if (m === Mat.Air) continue;
              if (m === Mat.Water) wet++;
              else solid++;
              if (y > topY) (topY = y), (top = m);
            }
        const m = solid >= need ? (top === Mat.Water ? Mat.Soil : top) : wet >= need ? Mat.Water : Mat.Air;
        if (m !== Mat.Air) res[cx + cz * out.sx + cy * out.sx * out.sz] = m;
      }
  return { dims: out, data: res };
}
