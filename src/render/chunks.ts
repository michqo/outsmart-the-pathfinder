import * as THREE from 'three';
import { blockFaces, grassFaces, type GrassStyle, type Palette } from '../palette';
import { MAT_KEYS } from '../world/materials';
import { COLOR_KINDS, COLOR_TABLE_SIZE, meshChunk, type MeshData, type MeshOptions } from '../world/mesher';
import type { World } from '../world/world';
import { BIOME_TINT_GLSL, BiomeTint } from './biomeTint';
import { CLOUD_GLSL, type CloudUniforms } from './clouds';

/** Owns one opaque + one water mesh per chunk and rebuilds only dirty chunks. */
export class ChunkRenderer {
  readonly group = new THREE.Group();
  readonly opaqueMaterial: THREE.MeshStandardMaterial;
  readonly waterMaterial: THREE.MeshStandardMaterial;
  /** Shader uniform: per-block brightness jitter, 0 = flat colour. */
  readonly jitter = { value: 0.07 };
  /** Seconds (scaled by the wind): drives the canopy sway and the water ripples. */
  readonly windTime = { value: 0 };
  /** The sky's cloud field, for cloud shadows on the terrain. Set before the first frame. */
  clouds: CloudUniforms | null = null;
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
  /** Called after any chunk rebuild (the voxel texture re-uploads then). */
  onRebuilt: (() => void) | null = null;
  /** Per-column biome colour. */
  readonly tint = new BiomeTint();

  constructor(private world: World) {
    this.opaqueMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
    this.opaqueMaterial.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, { uJitter: this.jitter, uWindTime: this.windTime }, this.tint.uniforms, this.clouds ?? {});
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          attribute float sway;
          uniform float uWindTime;
          varying vec3 vCell;
          varying vec3 vLocal;
          varying vec3 vWorld;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vec3 rest = transformed;
          vLocal = rest;
          // Canopies sway as whole sheets: one smooth field over the world, so neighbouring
          // leaf faces move together and never open gaps between them.
          vec3 wRest = (modelMatrix * vec4(rest, 1.0)).xyz;
          float ph = dot(wRest.xz, vec2(0.11, 0.07)) + wRest.y * 0.05;
          vec2 lean = vec2(sin(uWindTime * 1.25 + ph), cos(uWindTime * 0.95 + ph * 1.4)) * 0.075
                    + vec2(sin(uWindTime * 3.1 + ph * 4.0), sin(uWindTime * 2.7 + ph * 3.3)) * 0.02;
          transformed.xz += lean * sway;
          transformed.y += sin(uWindTime * 1.7 + ph * 2.0) * 0.025 * sway;`,
        )
        .replace(
          '#include <project_vertex>',
          // Push slightly inside the block so every face of a voxel gets the same cell id.
          `#include <project_vertex>
          vCell = floor((modelMatrix * vec4(rest - objectNormal * 0.5, 1.0)).xyz + 0.001);
          vWorld = wRest;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vCell;
          varying vec3 vLocal;
          varying vec3 vWorld;
          uniform float uJitter;
          ${BIOME_TINT_GLSL}
          ${this.clouds ? CLOUD_GLSL : ''}`,
        )
        .replace(
          '#include <color_fragment>',
          '#include <color_fragment>\nfloat hj = fract(sin(dot(vCell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);\ndiffuseColor.rgb *= (1.0 + (hj - 0.5) * uJitter) * biomeTint(vLocal);',
        );
      if (this.clouds)
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <lights_fragment_end>',
          // Cloud shadows: patches of shade drifting across the island with the wind.
          '#include <lights_fragment_end>\nfloat cloudLight = cloudShadow(vWorld);\nreflectedLight.directDiffuse *= cloudLight;\nreflectedLight.directSpecular *= cloudLight;',
        );
    };
    this.opaqueMaterial.customProgramCacheKey = () => (this.clouds ? 'chunks-clouds' : 'chunks');
    this.waterMaterial = new THREE.MeshStandardMaterial({
      transparent: true,
      opacity: 0.72,
      roughness: 0.18,
      metalness: 0,
      depthWrite: false,
    });
    this.waterMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uWindTime = this.windTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWorldW;\nvarying float vUpW;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWorldW = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvUpW = objectNormal.y;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uWindTime;
          varying vec3 vWorldW;
          varying float vUpW;
          /** Slope of a few crossing ripple trains on the water surface. */
          vec2 ripple(vec2 p, float t) {
            vec2 g = vec2(0.0);
            g += vec2(0.8, 0.6) * cos(dot(p, vec2(0.8, 0.6)) * 1.9 - t * 2.1) * 0.6;
            g += vec2(-0.5, 0.86) * cos(dot(p, vec2(-0.5, 0.86)) * 2.7 - t * 2.6) * 0.4;
            g += vec2(0.97, -0.26) * cos(dot(p, vec2(0.97, -0.26)) * 4.3 - t * 3.4) * 0.25;
            return g;
          }`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          // Only the surface ripples; the sides of a waterfall or a pool's edge stay flat.
          if (vUpW > 0.5) {
            vec2 g = ripple(vWorldW.xz, uWindTime) * 0.16;
            normal = normalize((viewMatrix * vec4(normalize(vec3(-g.x, 1.0, -g.y)), 0.0)).xyz);
            diffuseColor.rgb *= 1.0 + 0.08 * (g.x + g.y);
          }`,
        );
    };
  }

  setPalette(p: Palette, grassStyle: GrassStyle): void {
    const t = this.opts.colorTable;
    fillColorTable(t, p, grassStyle);
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
      this.opaque[ci] = this.swap(this.opaque[ci], opaque, this.opaqueMaterial, true);
      this.water[ci] = this.swap(this.water[ci], water, this.waterMaterial, false);
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
    if (solid) {
      g.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
      g.setAttribute('sway', new THREE.BufferAttribute(data.sway, 1, true));
    }
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


/** The palette's flat colours per material and face kind, in linear RGB, for the mesher. */
export function fillColorTable(t: Float32Array, p: Palette, grassStyle: GrassStyle): void {
  const c = new THREE.Color();
  for (let m = 1; m < MAT_KEYS.length; m++) {
    const key = MAT_KEYS[m];
    if (key === 'water' || key === 'air') continue;
    const f = blockFaces(p, key);
    const kinds = key === 'grass' ? grassFaces(p, grassStyle) : [f.top, f.side, f.bottom, f.side];
    kinds.forEach((hex, kind) => {
      c.setHex(hex); // sRGB -> linear
      const i = (m * COLOR_KINDS + kind) * 3;
      t[i] = c.r;
      t[i + 1] = c.g;
      t[i + 2] = c.b;
    });
  }
}
