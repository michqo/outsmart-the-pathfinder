import * as THREE from 'three';
import { MoveKind } from '../path/moves';
import { voxelCoords } from '../world/world';

/** Seconds per move. Tuned by eye; falls add time per block. */
const DURATION: Record<number, number> = {
  [MoveKind.Walk]: 0.3,
  [MoveKind.Diagonal]: 0.4,
  [MoveKind.StepUp]: 0.42,
  [MoveKind.Drop]: 0.3,
};
const FALL_PER_BLOCK = 0.09;

export interface WalkEvents {
  onLand(blocks: number): void;
  onArrive(): void;
}

const ease = (t: number) => t * t * (3 - 2 * t);

/** Moves a point along the path, one move at a time, with a shape per move kind. */
export class Walker {
  readonly pos = new THREE.Vector3();
  yaw = 0;
  active = false;
  /** Walk-cycle phase for the legs. */
  phase = 0;

  private nodes: Int32Array = new Int32Array(0);
  private kinds: Uint8Array = new Uint8Array(0);
  private i = 0; // current move goes from nodes[i] to nodes[i + 1]
  private t = 0;
  private from = new THREE.Vector3();
  private to = new THREE.Vector3();
  private dur = 0;

  constructor(private events: WalkEvents) {}

  start(nodes: Int32Array, kinds: Uint8Array): void {
    this.nodes = nodes;
    this.kinds = kinds;
    this.i = 0;
    this.active = nodes.length > 1;
    if (this.active) this.beginMove();
  }

  stop(): void {
    this.active = false;
  }

  /** The node the bot is effectively on (for replanning). */
  currentNode(): number {
    if (!this.nodes.length) return -1;
    return this.t > 0.5 && this.i + 1 < this.nodes.length ? this.nodes[this.i + 1] : this.nodes[this.i];
  }

  update(dt: number): void {
    if (!this.active) return;
    this.t += dt / this.dur;
    if (this.t >= 1) {
      const kind = this.kinds[this.i + 1];
      if (kind === MoveKind.Drop) this.events.onLand(Math.round(this.from.y - this.to.y));
      this.i++;
      if (this.i >= this.nodes.length - 1) {
        this.pos.copy(this.to);
        this.active = false;
        this.events.onArrive();
        return;
      }
      this.beginMove();
    }
    this.shape(Math.min(this.t, 1));
    this.phase += dt * 22;
  }

  private beginMove(): void {
    const a = voxelCoords(this.nodes[this.i]);
    const b = voxelCoords(this.nodes[this.i + 1]);
    this.from.set(a[0] + 0.5, a[1], a[2] + 0.5);
    this.to.set(b[0] + 0.5, b[1], b[2] + 0.5);
    const kind = this.kinds[this.i + 1];
    this.dur = DURATION[kind] + (kind === MoveKind.Drop ? (this.from.y - this.to.y) * FALL_PER_BLOCK : 0);
    this.t = 0;
    this.yaw = Math.atan2(this.to.x - this.from.x, this.to.z - this.from.z);
  }

  private shape(t: number): void {
    const kind = this.kinds[this.i + 1];
    const f = this.from, g = this.to, p = this.pos;
    if (kind === MoveKind.StepUp) {
      const e = ease(t);
      p.lerpVectors(f, g, e);
      p.y = f.y + (g.y - f.y) * Math.min(1, t * 1.6) + Math.sin(Math.PI * t) * 0.35;
    } else if (kind === MoveKind.Drop) {
      // Walk to the edge, then fall (accelerating) while drifting the rest of the way.
      const edge = 0.4;
      if (t < edge) {
        const k = t / edge;
        p.lerpVectors(f, g, k * 0.55);
        p.y = f.y + Math.sin(Math.PI * k) * 0.08;
      } else {
        const k = (t - edge) / (1 - edge);
        p.lerpVectors(f, g, 0.55 + 0.45 * k);
        p.y = f.y + (g.y - f.y) * k * k;
      }
    } else {
      p.lerpVectors(f, g, t);
    }
  }
}
