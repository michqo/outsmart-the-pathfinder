import * as THREE from 'three';
import { CLOSED_FLAG } from '../path/astar';
import { SX, SY, SZ } from '../world/world';

export const VIZ_STYLES = { Glow: 'glow', Sparks: 'sparks', Tiles: 'tiles' } as const;
export type VizStyle = (typeof VIZ_STYLES)[keyof typeof VIZ_STYLES];

/** Most nodes we draw. Beyond this the search still runs; we just stop adding cubes. */
const CAPACITY = 65_536;

const STYLE: Record<VizStyle, { geo: () => THREE.BufferGeometry; lift: number; size: number }> = {
  glow: { geo: () => new THREE.BoxGeometry(1, 1, 1), lift: 0.4, size: 0.4 },
  sparks: { geo: () => new THREE.OctahedronGeometry(0.75, 0), lift: 0.6, size: 0.34 },
  tiles: { geo: () => new THREE.BoxGeometry(1, 0.12, 1), lift: 0.06, size: 0.82 },
};

/**
 * Plays back the search's open/close events as one instanced draw.
 * Frontier nodes pop in cyan and pulse; closed ones fade to a dim blue over `fade` seconds.
 * Playback takes `duration` seconds regardless of node count (0 = instant).
 */
export class SearchViz {
  readonly mesh: THREE.Mesh;
  duration = 1.5;
  private geo = new THREE.InstancedBufferGeometry();
  private offsets = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3);
  private times = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 2), 2);
  private slotOf = new Int32Array(SX * SY * SZ).fill(-1);
  private used = 0;
  private queue: Uint32Array[] = [];
  private qi = 0; // index into queue[0]
  private known = 0;
  private played = 0;
  private done = false;
  private rate = 0;
  private uniforms = {
    uTime: { value: 0 },
    uFade: { value: 1.0 },
    uSize: { value: 0.3 },
    uLift: { value: 0.4 },
    uGlobal: { value: 1 },
    uLane: { value: 0 },
    uFrontier: { value: new THREE.Color().setRGB(0.1, 0.85, 1) },
    uClosed: { value: new THREE.Color().setRGB(0.3, 0.38, 0.95) },
  };
  private globalTarget = 1;
  private globalSpeed = 1;

  constructor(style: VizStyle, lane = 0, colors?: [frontier: number, closed: number]) {
    this.uniforms.uLane.value = lane;
    if (colors) {
      this.uniforms.uFrontier.value.setHex(colors[0]);
      this.uniforms.uClosed.value.setHex(colors[1]);
    }
    this.offsets.setUsage(THREE.DynamicDrawUsage);
    this.times.setUsage(THREE.DynamicDrawUsage);
    this.mesh = new THREE.Mesh(
      this.geo,
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        vertexShader: /* glsl */ `
          attribute vec3 aOffset;
          attribute vec2 aTimes; // x: opened at, y: closed at (<0 = still open)
          uniform float uTime, uFade, uSize, uLift, uGlobal, uLane;
          uniform vec3 uFrontier, uClosed;
          varying vec3 vColor;
          varying float vAlpha;
          void main() {
            float age = uTime - aTimes.x;
            float shown = step(0.0, age);
            float pop = smoothstep(0.0, 0.18, age);
            float isClosed = step(0.0, aTimes.y) * step(aTimes.y, uTime);
            float tc = isClosed * clamp((uTime - aTimes.y) / uFade, 0.0, 1.0);
            float pulse = 0.82 + 0.18 * sin(uTime * 7.0 + aOffset.x * 0.9 + aOffset.z * 0.6);
            vec3 frontier = uFrontier * pulse + vec3(0.5) * (1.0 - pop);
            vColor = mix(frontier, uClosed, tc);
            vAlpha = shown * mix(1.0, 0.4, tc) * uGlobal;
            float s = uSize * pop * mix(1.1, 0.7, tc);
            vec3 p = aOffset + vec3(uLane, uLift, 0.0) + position * s;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          varying vec3 vColor;
          varying float vAlpha;
          void main() {
            if (vAlpha < 0.01) discard;
            gl_FragColor = vec4(vColor, vAlpha);
            #include <colorspace_fragment>
          }`,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.setStyle(style);
  }

  setStyle(style: VizStyle): void {
    const s = STYLE[style];
    const g = s.geo();
    this.geo.index = g.index;
    this.geo.setAttribute('position', g.getAttribute('position'));
    this.geo.setAttribute('aOffset', this.offsets);
    this.geo.setAttribute('aTimes', this.times);
    this.uniforms.uSize.value = s.size;
    this.uniforms.uLift.value = s.lift;
  }

  get nodesShown(): number {
    return this.used;
  }

  /** True once every known event has been played and the search is finished. */
  get playbackDone(): boolean {
    return this.done && this.played >= this.known;
  }

  reset(): void {
    for (let i = 0; i < this.used; i++) {
      const id = Math.round(this.offsets.getX(i) - 0.5) + Math.round(this.offsets.getZ(i) - 0.5) * SX +
        Math.round(this.offsets.getY(i)) * SX * SZ;
      this.slotOf[id] = -1;
    }
    this.used = 0;
    this.geo.instanceCount = 0;
    this.queue = [];
    this.qi = 0;
    this.known = this.played = 0;
    this.done = false;
    this.rate = 0;
    this.uniforms.uGlobal.value = this.globalTarget = 1;
  }

  /** Clears the cubes. */
  hide(): void {
    this.reset();
  }

  /** Fades the whole search (e.g. down while the bot walks, so it stays readable). */
  fadeTo(alpha: number, seconds: number): void {
    this.globalTarget = alpha;
    this.globalSpeed = seconds > 0 ? 1 / seconds : Infinity;
  }

  push(events: Uint32Array): void {
    if (events.length === 0) return;
    this.queue.push(events);
    this.known += events.length;
  }

  get eventCount(): number {
    return this.known;
  }

  /** A duel supplies a shared playback rate instead of fitting each trace to its own duration. */
  finish(sharedRate?: number): void {
    this.done = true;
    this.rate = sharedRate ?? (this.duration > 0 ? Math.max(1, this.known / this.duration) : Infinity);
  }

  update(time: number, dt: number): void {
    this.uniforms.uTime.value = time;
    const g = this.uniforms.uGlobal;
    if (g.value !== this.globalTarget) {
      const step = dt * this.globalSpeed;
      g.value = g.value < this.globalTarget ? Math.min(this.globalTarget, g.value + step) : Math.max(this.globalTarget, g.value - step);
    }
    if (this.played >= this.known) return;
    // While still searching, play at a rate based on what we know so far.
    const rate = this.done ? this.rate : this.duration > 0 ? this.known / this.duration : Infinity;
    const budget = rate === Infinity ? this.known - this.played : Math.max(1, Math.floor(rate * dt));
    this.apply(Math.min(budget, this.known - this.played), time);
  }

  private apply(count: number, time: number): void {
    let lo = Infinity, hi = -1;
    const off = this.offsets.array as Float32Array;
    const tim = this.times.array as Float32Array;
    while (count > 0 && this.queue.length) {
      const chunk = this.queue[0];
      while (count > 0 && this.qi < chunk.length) {
        const e = chunk[this.qi++];
        count--;
        this.played++;
        const closed = (e & CLOSED_FLAG) !== 0;
        const id = e & ~CLOSED_FLAG;
        let slot = this.slotOf[id];
        if (slot < 0) {
          if (this.used >= CAPACITY) continue;
          slot = this.slotOf[id] = this.used++;
          const x = id % SX, z = Math.floor(id / SX) % SZ, y = Math.floor(id / (SX * SZ));
          off[slot * 3] = x + 0.5;
          off[slot * 3 + 1] = y;
          off[slot * 3 + 2] = z + 0.5;
          tim[slot * 2] = time;
          tim[slot * 2 + 1] = -1;
        }
        if (closed) tim[slot * 2 + 1] = time;
        if (slot < lo) lo = slot;
        if (slot > hi) hi = slot;
      }
      if (this.qi >= chunk.length) {
        this.queue.shift();
        this.qi = 0;
      }
    }
    if (hi < 0) return;
    this.geo.instanceCount = this.used;
    this.offsets.clearUpdateRanges();
    this.times.clearUpdateRanges();
    this.offsets.addUpdateRange(lo * 3, (hi - lo + 1) * 3);
    this.times.addUpdateRange(lo * 2, (hi - lo + 1) * 2);
    this.offsets.needsUpdate = true;
    this.times.needsUpdate = true;
  }
}

