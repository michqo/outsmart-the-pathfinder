import * as THREE from 'three';
import { grassFaces, type GrassStyle, type Palette } from '../palette';
import { MAT_KEYS } from '../world/materials';
import { COLOR_KINDS, COLOR_TABLE_SIZE, meshChunk, type MeshData, type MeshOptions } from '../world/mesher';
import { CHUNK_COUNT, CX, CZ, World } from '../world/world';

/** Owns one opaque + one water mesh per chunk and rebuilds only dirty chunks. */
export class ChunkRenderer {
  readonly group = new THREE.Group();
  readonly opaqueMaterial: THREE.MeshStandardMaterial;
  readonly waterMaterial: THREE.MeshStandardMaterial;
  /** Shader uniform: per-block brightness jitter, 0 = flat colour. */
  readonly jitter = { value: 0.07 };
  readonly opts: MeshOptions = {
    colorTable: new Float32Array(COLOR_TABLE_SIZE),
    aoCurve: [0.55, 0.7, 0.85, 1],
    ao: true,
  };
  stats = { lastRebuildMs: 0, triangles: 0 };

  private opaque: (THREE.Mesh | null)[] = new Array(CHUNK_COUNT).fill(null);
  private water: (THREE.Mesh | null)[] = new Array(CHUNK_COUNT).fill(null);
  private tris = new Int32Array(CHUNK_COUNT);

  constructor(private world: World) {
    this.opaqueMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
    this.opaqueMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uJitter = this.jitter;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vCell;')
        .replace(
          '#include <project_vertex>',
          // Push slightly inside the block so every face of a voxel gets the same cell id.
          '#include <project_vertex>\nvCell = floor((modelMatrix * vec4(transformed - objectNormal * 0.5, 1.0)).xyz + 0.001);',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vCell;\nuniform float uJitter;')
        .replace(
          '#include <color_fragment>',
          '#include <color_fragment>\nfloat hj = fract(sin(dot(vCell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);\ndiffuseColor.rgb *= 1.0 + (hj - 0.5) * uJitter;',
        );
    };
    this.waterMaterial = new THREE.MeshStandardMaterial({
      transparent: true,
      opacity: 0.72,
      roughness: 0.25,
      metalness: 0,
      depthWrite: false,
    });
  }

  setPalette(p: Palette, grassStyle: GrassStyle): void {
    const c = new THREE.Color();
    const t = this.opts.colorTable;
    for (let m = 1; m < MAT_KEYS.length; m++) {
      const key = MAT_KEYS[m];
      if (key === 'water' || key === 'air') continue;
      const f = p.blocks[key];
      const kinds = key === 'grass' ? grassFaces(p, grassStyle) : [f.top, f.side, f.bottom, f.side];
      kinds.forEach((hex, kind) => {
        c.setHex(hex); // sRGB -> linear
        const i = (m * COLOR_KINDS + kind) * 3;
        t[i] = c.r;
        t[i + 1] = c.g;
        t[i + 2] = c.b;
      });
    }
    this.waterMaterial.color.setHex(p.water);
    this.waterMaterial.opacity = p.waterOpacity;
    this.world.markAllDirty();
  }

  setWireframe(on: boolean): void {
    this.opaqueMaterial.wireframe = on;
    this.waterMaterial.wireframe = on;
  }

  /** Rebuilds dirty chunks. Returns how many were rebuilt. */
  update(): number {
    const dirty = this.world.dirty;
    if (dirty.size === 0) return 0;
    const t0 = performance.now();
    let count = 0;
    for (const ci of dirty) {
      const cx = ci % CX;
      const cz = Math.floor(ci / CX) % CZ;
      const cy = Math.floor(ci / (CX * CZ));
      const { opaque, water } = meshChunk(this.world, cx, cy, cz, this.opts);
      this.opaque[ci] = this.swap(this.opaque[ci], opaque, this.opaqueMaterial, true);
      this.water[ci] = this.swap(this.water[ci], water, this.waterMaterial, false);
      this.tris[ci] = (opaque.indices.length + water.indices.length) / 3;
      count++;
    }
    dirty.clear();
    this.stats.lastRebuildMs = performance.now() - t0;
    this.stats.triangles = this.tris.reduce((a, b) => a + b, 0);
    return count;
  }

  private swap(old: THREE.Mesh | null, data: MeshData, mat: THREE.Material, solid: boolean): THREE.Mesh | null {
    if (old) {
      this.group.remove(old);
      old.geometry.dispose();
    }
    if (data.quads === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
    if (solid) g.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
    g.setIndex(new THREE.BufferAttribute(data.indices, 1));
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, mat);
    mesh.castShadow = solid;
    mesh.receiveShadow = true;
    if (!solid) mesh.renderOrder = 1;
    this.group.add(mesh);
    return mesh;
  }
}

