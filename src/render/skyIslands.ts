import * as THREE from 'three';
import type { ArchIsland } from '../gen/archipelago';
import type { LodIsland } from '../gen/worker';
import type { GrassStyle, Palette } from '../palette';
import { COLOR_TABLE_SIZE, meshChunk, type MeshOptions } from '../world/mesher';
import { World } from '../world/world';
import { fillColorTable } from './chunks';
import { buildUnderside } from './underside';

/** What the sky shows about one island. */
export interface SkyIsland {
  a: ArchIsland;
  /** Footprint radius in voxels (bridge ends, marker height). */
  radius: number;
  open: boolean;
  stars: number;
  current: boolean;
}

/** A bridge between two islands; `fresh` ones grow in plank by plank. */
export interface SkyBridge {
  a: SkyIsland;
  b: SkyIsland;
  fresh: boolean;
}

const CSS = `
.skym { position: fixed; inset: 0; pointer-events: none; z-index: 4; overflow: hidden; }
.skym button { position: absolute; left: 0; top: 0; pointer-events: auto; transform: translate(-50%, -100%);
  border: 0; border-radius: 10px; padding: 5px 9px; font: 600 12px/1.2 system-ui, sans-serif; color: #2b2540;
  background: rgba(255,255,255,0.86); box-shadow: 0 2px 10px rgba(40,30,80,0.18); cursor: pointer; white-space: nowrap; }
.skym button:hover, .skym button:focus-visible { background: #fff; outline: 2px solid #8e7cf0; }
.skym button.locked { color: #7a7490; background: rgba(240,238,248,0.8); cursor: default; }
.skym .s { color: #f5b301; letter-spacing: 1px; }
.skym .s .off { color: #cfc8e0; }
`;

/** Ground height of a generated island's lowland (bridges land on it). */
const GROUND = 15;

/**
 * The rest of the archipelago, seen from the current island: coarse island meshes fading
 * into the haze, a marker over each (tier, stars, lock) that you tap to travel, and the
 * bridges your stars have opened. Positions are relative to the current island, which the
 * game draws at the origin.
 */
export class SkyIslands {
  readonly group = new THREE.Group();
  /** Called when the player taps an open island's marker. */
  onPick: ((a: ArchIsland) => void) | null = null;

  private markers = document.createElement('div');
  private entries = new Map<string, { info: SkyIsland; lod: LodIsland | null; mesh: THREE.Group | null; marker: HTMLButtonElement }>();
  private bridges: { mesh: THREE.InstancedMesh; count: number; shown: number }[] = [];
  private origin: [number, number, number] = [0, 0, 0];
  private opts: MeshOptions = { colorTable: new Float32Array(COLOR_TABLE_SIZE), aoCurve: [0.55, 0.7, 0.85, 1], ao: true };
  private palette: Palette | null = null;
  private haze = { value: new THREE.Color(0xdde8f5) };
  private material = hazy(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }), this.haze);
  private waterMaterial = hazy(new THREE.MeshStandardMaterial({ color: 0x5aa7d8, roughness: 0.3, transparent: true, opacity: 0.75 }), this.haze);
  private plankMaterial = hazy(new THREE.MeshStandardMaterial({ color: 0x9a6a42, roughness: 0.9 }), this.haze);
  private plankGeo = new THREE.BoxGeometry(1.1, 0.3, 2.6);
  private tmp = new THREE.Vector3();
  private dummy = new THREE.Object3D();

  constructor() {
    const css = document.createElement('style');
    css.textContent = CSS;
    document.head.appendChild(css);
    this.markers.className = 'skym';
    document.body.appendChild(this.markers);
  }

  setPalette(p: Palette, grass: GrassStyle): void {
    this.palette = p;
    fillColorTable(this.opts.colorTable, p, grass);
    for (const e of this.entries.values()) if (e.lod) this.build(e);
  }

  /** The colour far islands fade into (the low sky). */
  setHaze(c: THREE.Color): void {
    this.haze.value.copy(c);
  }

  /** Sky coordinates of the current island's centre: everything is drawn relative to it. */
  setOrigin(centre: [number, number, number]): void {
    this.origin = [...centre];
    for (const e of this.entries.values()) this.place(e);
  }

  /** Where an island's centre is drawn (relative to the current island). */
  position(a: ArchIsland, out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(a.centre[0] - this.origin[0], a.centre[1] - this.origin[1], a.centre[2] - this.origin[2]);
  }

  /**
   * The islands to show. Returns the ones that still need a coarse mesh (`provide` them
   * when the worker has made it); islands no longer listed are dropped.
   */
  setIslands(list: SkyIsland[]): ArchIsland[] {
    const keep = new Set(list.map((i) => key(i.a)));
    for (const [k, e] of this.entries)
      if (!keep.has(k)) {
        this.dispose(e);
        this.entries.delete(k);
      }
    const missing: ArchIsland[] = [];
    for (const info of list) {
      let e = this.entries.get(key(info.a));
      if (!e) {
        const marker = document.createElement('button');
        marker.type = 'button';
        marker.onclick = () => {
          const cur = this.entries.get(key(info.a));
          if (cur?.info.open) this.onPick?.(cur.info.a);
        };
        this.markers.appendChild(marker);
        e = { info, lod: null, mesh: null, marker };
        this.entries.set(key(info.a), e);
        missing.push(info.a);
      }
      e.info = info;
      const tier = `Tier ${info.a.tier}`;
      e.marker.className = info.open ? '' : 'locked';
      e.marker.innerHTML = info.open
        ? `${info.a.ring === 0 ? 'Home · ' : ''}${tier} <span class="s">${'★'.repeat(info.stars)}<span class="off">${'★'.repeat(3 - info.stars)}</span></span>`
        : `🔒 ${tier}`;
      e.marker.setAttribute('aria-label', info.open ? `Travel to ${tier} island, ${info.stars} of 3 stars` : `${tier} island, locked: earn a star on a neighbour`);
      e.marker.title = info.open ? 'Travel here' : 'Earn ★ on a neighbouring island to open its bridge';
      if (e.mesh) e.mesh.visible = !info.current;
      this.place(e);
    }
    return missing;
  }

  /** A coarse mesh arrived from the worker. */
  provide(a: ArchIsland, lod: LodIsland): void {
    const e = this.entries.get(key(a));
    if (!e) return;
    e.lod = lod;
    this.build(e);
  }

  setBridges(list: SkyBridge[]): void {
    for (const b of this.bridges) {
      this.group.remove(b.mesh);
      b.mesh.dispose();
    }
    this.bridges = list.map((br) => this.bridge(br));
  }

  /** Markers follow their islands on screen; shown only when zoomed out (`showMarkers`). */
  update(dt: number, camera: THREE.Camera, showMarkers: boolean): void {
    for (const b of this.bridges) {
      if (b.shown >= b.count) continue;
      b.shown = Math.min(b.count, b.shown + dt * 14);
      b.mesh.count = Math.floor(b.shown);
    }
    const w = window.innerWidth, h = window.innerHeight;
    for (const e of this.entries.values()) {
      const m = e.marker;
      if (!showMarkers || e.info.current) {
        m.hidden = true;
        continue;
      }
      const p = this.position(e.info.a, this.tmp);
      p.y += GROUND + 8 + e.info.radius * 0.15;
      p.project(camera);
      const visible = p.z < 1 && Math.abs(p.x) < 1.05 && Math.abs(p.y) < 1.05;
      m.hidden = !visible;
      if (visible) m.style.transform = `translate(${((p.x + 1) / 2) * w}px, ${((1 - p.y) / 2) * h}px) translate(-50%, -100%)`;
    }
  }

  private place(e: { info: SkyIsland; lod: LodIsland | null; mesh: THREE.Group | null }): void {
    if (!e.mesh || !e.lod) return;
    const p = this.position(e.info.a, this.tmp);
    e.mesh.position.set(p.x - e.lod.windowDims.sx / 2, p.y, p.z - e.lod.windowDims.sz / 2);
  }

  private build(e: { info: SkyIsland; lod: LodIsland | null; mesh: THREE.Group | null }): void {
    if (!e.lod || !this.palette) return;
    if (e.mesh) this.disposeMesh(e.mesh);
    const { dims, data, scale } = e.lod;
    const w = new World(dims.sx, dims.sy, dims.sz);
    w.data.set(data);
    const solid: THREE.BufferGeometry[] = [], water: THREE.BufferGeometry[] = [];
    for (let cy = 0; cy < w.cy; cy++)
      for (let cz = 0; cz < w.cz; cz++)
        for (let cx = 0; cx < w.cx; cx++) {
          const m = meshChunk(w, cx, cy, cz, this.opts);
          if (m.opaque.quads) solid.push(geometry(m.opaque, true));
          if (m.water.quads) water.push(geometry(m.water, false));
        }
    const g = new THREE.Group();
    const inner = new THREE.Group();
    inner.scale.setScalar(scale);
    for (const geo of solid) inner.add(new THREE.Mesh(geo, this.material));
    for (const geo of water) inner.add(new THREE.Mesh(geo, this.waterMaterial));
    const under = buildUnderside(w, this.palette);
    hazy(under.material as THREE.MeshStandardMaterial, this.haze);
    inner.add(under);
    g.add(inner);
    g.visible = !e.info.current;
    e.mesh = g;
    this.group.add(g);
    this.place(e);
  }

  /** Planks along a sagging line between the two islands' rims. */
  private bridge({ a, b, fresh }: SkyBridge): { mesh: THREE.InstancedMesh; count: number; shown: number } {
    const pa = this.position(a.a), pb = this.position(b.a);
    const dir = pb.clone().sub(pa).setY(0).normalize();
    const from = pa.clone().addScaledVector(dir, a.radius).setY(pa.y + GROUND);
    const to = pb.clone().addScaledVector(dir, -b.radius).setY(pb.y + GROUND);
    const len = from.distanceTo(to);
    const count = Math.max(2, Math.ceil(len / 1.6));
    const mesh = new THREE.InstancedMesh(this.plankGeo, this.plankMaterial, count);
    const sag = Math.min(14, len * 0.07);
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      this.dummy.position.lerpVectors(from, to, t);
      this.dummy.position.y -= sag * 4 * t * (1 - t);
      this.dummy.lookAt(this.dummy.position.x + dir.x, this.dummy.position.y, this.dummy.position.z + dir.z);
      this.dummy.rotateY(Math.PI / 2);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(i, this.dummy.matrix);
    }
    mesh.count = fresh ? 0 : count;
    this.group.add(mesh);
    return { mesh, count, shown: fresh ? 0 : count };
  }

  private dispose(e: { mesh: THREE.Group | null; marker: HTMLButtonElement }): void {
    if (e.mesh) this.disposeMesh(e.mesh);
    e.marker.remove();
  }

  private disposeMesh(g: THREE.Group): void {
    this.group.remove(g);
    g.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
  }
}

const key = (a: ArchIsland) => `${a.ix},${a.iz}`;

function geometry(d: { positions: Float32Array; normals: Float32Array; colors: Float32Array; indices: Uint32Array }, colors: boolean): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(d.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(d.normals, 3));
  if (colors) g.setAttribute('color', new THREE.BufferAttribute(d.colors, 3));
  g.setIndex(new THREE.BufferAttribute(d.indices, 1));
  g.computeBoundingSphere();
  return g;
}

/** Fades a material into the haze with distance from the camera (far islands sit in the air). */
function hazy<M extends THREE.MeshStandardMaterial>(m: M, haze: { value: THREE.Color }): M {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uHaze = haze;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHazePos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvHazePos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHazePos;\nuniform vec3 uHaze;')
      .replace(
        '#include <opaque_fragment>',
        '#include <opaque_fragment>\ngl_FragColor.rgb = mix(gl_FragColor.rgb, uHaze, smoothstep(140.0, 900.0, length(vHazePos - cameraPosition)) * 0.85);',
      );
  };
  m.customProgramCacheKey = () => 'hazy';
  return m;
}
