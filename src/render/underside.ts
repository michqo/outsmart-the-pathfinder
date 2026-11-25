import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Palette } from '../palette';
import { Mat } from '../world/materials';
import { SX, SY, SZ, World } from '../world/world';
import { hash2, rng } from '../world/noise';

/**
 * Low-poly rocky stalactites hanging under the island.
 * Generated from the island's footprint; cheap enough to rebuild on demand.
 */
export interface RockMaps {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  armMap: THREE.Texture;
}

/** With `rock` maps the cones get real rock textures (realistic style); otherwise palette colours. */
export function buildUnderside(world: World, palette: Palette, rock: RockMaps | null = null, seed = 3): THREE.Mesh {
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

  // How "interior" a column is: share of solid columns within a radius.
  const interior = (x: number, z: number): number => {
    let solid = 0, total = 0;
    for (let dz = -5; dz <= 5; dz += 1)
      for (let dx = -5; dx <= 5; dx += 1) {
        total++;
        const nx = x + dx, nz = z + dz;
        if (nx >= 0 && nz >= 0 && nx < SX && nz < SZ && bottom[nx + nz * SX] >= 0) solid++;
      }
    return solid / total;
  };

  const r = rng(seed);
  const top = new THREE.Color(rock ? 0xd8d2cc : palette.rock.top);
  const tip = new THREE.Color(rock ? 0x6e6a70 : palette.rock.tip);
  const tmp = new THREE.Color();
  const parts: THREE.BufferGeometry[] = [];

  for (let z = 1; z < SZ; z += 3)
    for (let x = 1; x < SX; x += 3) {
      const jx = Math.min(SX - 1, x + Math.floor(r() * 2));
      const jz = Math.min(SZ - 1, z + Math.floor(r() * 2));
      const yb = bottom[jx + jz * SX];
      if (yb < 0) continue;
      const m = interior(jx, jz);
      if (m < 0.35) continue;
      const k = Math.pow((m - 0.35) / 0.65, 1.4);
      const len = 1.5 + k * 16 * (0.55 + 0.45 * r());
      const rad = 1.7 + k * 1.6;
      const g = new THREE.ConeGeometry(rad, len, 6, 3, true).toNonIndexed();
      g.rotateX(Math.PI); // tip points down
      g.rotateY(r() * Math.PI);
      g.translate(jx + 0.5, yb + 0.6 - len / 2, jz + 0.5);
      const yTop = yb + 0.6;

      const pos = g.getAttribute('position') as THREE.BufferAttribute;
      const colors = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
        // Jitter by a hash of the position so shared corners move together.
        const hx = Math.round(px * 10), hz = Math.round(pz * 10), hy = Math.round(py * 10);
        const notTop = py < yTop - 0.1 ? 1 : 0;
        pos.setXYZ(
          i,
          px + (hash2(hx, hy, 1) - 0.5) * 0.7 * notTop,
          py + (hash2(hz, hy, 2) - 0.5) * 0.5 * notTop,
          pz + (hash2(hx, hz, 3) - 0.5) * 0.7 * notTop,
        );
        const t = Math.min(1, Math.max(0, (yTop - py) / 18));
        tmp.copy(top).lerp(tip, t);
        colors[i * 3] = tmp.r;
        colors[i * 3 + 1] = tmp.g;
        colors[i * 3 + 2] = tmp.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      if (rock) {
        // About one texture tile per 4 units, so the rock grain matches the voxel slate.
        const uv = g.getAttribute('uv') as THREE.BufferAttribute;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * ((rad * Math.PI * 2) / 4), uv.getY(i) * (len / 4));
      } else g.deleteAttribute('uv');
      g.computeVertexNormals(); // non-indexed => flat shading
      parts.push(g);
    }

  const geo = parts.length ? mergeGeometries(parts)! : new THREE.BufferGeometry();
  const material = rock
    ? new THREE.MeshStandardMaterial({
        vertexColors: true,
        map: rock.map,
        normalMap: rock.normalMap,
        roughnessMap: rock.armMap,
        aoMap: rock.armMap,
        roughness: 1,
        metalness: 0,
        side: THREE.DoubleSide,
      })
    : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  return mesh;
}
