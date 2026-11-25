import * as THREE from 'three';
import { grassFaces, type GrassStyle, type Palette } from '../palette';
import { MAT_KEYS } from '../world/materials';
import { COLOR_KINDS, COLOR_TABLE_SIZE, meshChunk, type MeshData, type MeshOptions } from '../world/mesher';
import type { World } from '../world/world';

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

  private opaque: (THREE.Mesh | null)[] = [];
  private water: (THREE.Mesh | null)[] = [];
  private tris = new Int32Array(0);
  /** The world.shapeVersion the per-chunk arrays are sized for. */
  private shape = -1;
  private palette: { p: Palette; grass: GrassStyle } | null = null;
  /** Realistic materials, when the style is on (set by setRealistic). */
  private real: { terrain: THREE.Material; water: THREE.Material } | null = null;
  /** Called after any chunk rebuild (the voxel texture re-uploads then). */
  onRebuilt: (() => void) | null = null;

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
    this.palette = { p, grass: grassStyle };
    const c = new THREE.Color();
    const t = this.opts.colorTable;
    if (this.real) {
      // Textures carry the colour; vertex colours then hold only the baked AO.
      t.fill(1);
      this.world.markAllDirty();
      return;
    }
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

  /** Switches between the stylised flat colours and realistic PBR materials (null = stylised). */
  setRealistic(real: { terrain: THREE.Material; water: THREE.Material } | null): void {
    this.real = real;
    const solid = this.solidMaterial(), water = this.liquidMaterial();
    for (const m of this.opaque) if (m) m.material = solid;
    for (const m of this.water) if (m) m.material = water;
    if (this.palette) this.setPalette(this.palette.p, this.palette.grass);
  }

  private solidMaterial(): THREE.Material {
    return this.real?.terrain ?? this.opaqueMaterial;
  }

  private liquidMaterial(): THREE.Material {
    return this.real?.water ?? this.waterMaterial;
  }

  setWireframe(on: boolean): void {
    this.opaqueMaterial.wireframe = on;
    this.waterMaterial.wireframe = on;
    if (this.real) {
      (this.real.terrain as THREE.MeshStandardMaterial).wireframe = on;
      (this.real.water as THREE.MeshStandardMaterial).wireframe = on;
    }
  }

  /** Rebuilds dirty chunks. Returns how many were rebuilt. */
  update(): number {
    const w = this.world;
    if (this.shape !== w.shapeVersion) this.resize();
    const dirty = w.dirty;
    if (dirty.size === 0) return 0;
    const t0 = performance.now();
    let count = 0;
    for (const ci of dirty) {
      const cx = ci % w.cx;
      const cz = Math.floor(ci / w.cx) % w.cz;
      const cy = Math.floor(ci / (w.cx * w.cz));
      const { opaque, water } = meshChunk(this.world, cx, cy, cz, this.opts);
      this.opaque[ci] = this.swap(this.opaque[ci], opaque, this.solidMaterial(), true);
      this.water[ci] = this.swap(this.water[ci], water, this.liquidMaterial(), false);
      this.tris[ci] = (opaque.indices.length + water.indices.length) / 3;
      count++;
    }
    dirty.clear();
    this.onRebuilt?.();
    this.stats.lastRebuildMs = performance.now() - t0;
    this.stats.triangles = this.tris.reduce((a, b) => a + b, 0);
    return count;
  }

  /** The window changed size: drop every chunk mesh and size the arrays to the new chunk grid. */
  private resize(): void {
    for (const m of [...this.opaque, ...this.water]) {
      if (!m) continue;
      this.group.remove(m);
      m.geometry.dispose();
    }
    const n = this.world.chunkCount;
    this.opaque = new Array(n).fill(null);
    this.water = new Array(n).fill(null);
    this.tris = new Int32Array(n);
    this.shape = this.world.shapeVersion;
    this.world.markAllDirty();
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

