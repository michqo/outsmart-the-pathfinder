import * as THREE from 'three';
import type { Palette } from '../palette';
import { Mat } from '../world/materials';
import { fbm, valueNoise } from '../world/noise';
import type { World } from '../world/world';

const MAX_DEPTH = 17;

/**
 * The rock mass hanging under the island: ONE continuous surface, not a pile of cones.
 *
 * A grid over the voxel corners: each corner hangs from the island's real bottom there,
 * by a depth that grows with distance from the footprint's edge (so the rim meets the
 * island exactly and the middle tapers to a deep, rounded point). Noise adds lumps and a
 * few stalactite drips. ~8k triangles, flat-shaded.
 */
export function buildUnderside(world: World, palette: Palette, seed = 3): THREE.Mesh {
  const { sx: SX, sy: SY, sz: SZ } = world;
  // Lowest solid voxel per column (-1 = empty column).
  const bottom = new Int16Array(SX * SZ).fill(-1);
  for (let z = 0; z < SZ; z++)
    for (let x = 0; x < SX; x++)
      for (let y = 0; y < SY; y++) {
        const m = world.get(x, y, z);
        if (m !== Mat.Air && m !== Mat.Water) {
          bottom[x + z * SX] = y;
          break;
        }
      }
  const col = (x: number, z: number) => (x < 0 || z < 0 || x >= SX || z >= SZ ? -1 : bottom[x + z * SX]);

  // Corners: (SX+1) x (SZ+1). A corner is used when any of its 4 columns is solid; it's on
  // the rim when one of them is empty. It hangs from the HIGHEST bottom among its solid
  // columns: the surface then starts inside (or flush with) every column around it, so no
  // gap can open under a shallower column; deeper columns just show as stone steps.
  const W = SX + 1, D = SZ + 1;
  const used = new Uint8Array(W * D);
  const top = new Float32Array(W * D);
  const dist = new Float32Array(W * D).fill(1e9);
  const queue: number[] = [];
  for (let z = 0; z < D; z++)
    for (let x = 0; x < W; x++) {
      let solid = 0, hi = -1;
      for (const [dx, dz] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
        const b = col(x + dx, z + dz);
        if (b >= 0) (solid++, (hi = Math.max(hi, b)));
      }
      const i = x + z * W;
      if (!solid) continue;
      used[i] = 1;
      top[i] = hi;
      if (solid < 4) {
        dist[i] = 0;
        queue.push(i);
      }
    }

  // Distance to the rim (8-connected Dijkstra-ish relaxation; cheap at this size).
  const STEPS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q], x = i % W, z = (i / W) | 0;
    for (const [dx, dz, c] of STEPS) {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= W || nz >= D) continue;
      const j = nx + nz * W;
      if (!used[j] || dist[j] <= dist[i] + c) continue;
      dist[j] = dist[i] + c;
      queue.push(j);
    }
  }

  // Vertex positions: hang each corner below the island bottom.
  const pos = new Float32Array(W * D * 3);
  const colors = new Float32Array(W * D * 3);
  const cTop = new THREE.Color(palette.rock.top);
  const cTip = new THREE.Color(palette.rock.tip);
  const tmp = new THREE.Color();
  for (let z = 0; z < D; z++)
    for (let x = 0; x < W; x++) {
      const i = x + z * W;
      if (!used[i]) continue;
      const d = dist[i];
      const lumps = 0.7 + 0.6 * fbm(x * 0.11, z * 0.11, seed);
      let depth = MAX_DEPTH * (1 - Math.exp(-d / 6.5)) * lumps;
      // A few stalactite drips where a coarse noise peaks.
      const n = valueNoise(x * 0.32, z * 0.32, seed + 11);
      if (d > 1.5) depth += Math.pow(Math.max(0, n - 0.62) / 0.38, 2) * 7 * Math.min(1, d / 4);
      const y = top[i] - depth;
      pos.set([x, y, z], i * 3);
      // Lighter near the island, darker towards the tips.
      tmp.copy(cTop).lerp(cTip, Math.min(1, depth / MAX_DEPTH));
      colors.set([tmp.r, tmp.g, tmp.b], i * 3);
    }

  // Triangles for every cell whose 4 corners are used (seen from below: wind downward).
  const idx: number[] = [];
  for (let z = 0; z < SZ; z++)
    for (let x = 0; x < SX; x++) {
      const a = x + z * W, b = a + 1, c = a + W, d = c + 1;
      if (!(used[a] && used[b] && used[c] && used[d])) continue;
      if ((x + z) & 1) idx.push(a, b, d, a, d, c);
      else idx.push(a, b, c, b, d, c);
    }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, flatShading: true });
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  return mesh;
}
