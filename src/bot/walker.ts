import * as THREE from 'three';
import { MoveKind } from '../path/moves';
import type { Vec3i } from '../path/protocol';
import { voxelCoords, type Dims } from '../world/world';

/** Seconds per motion. Falls add time per block. Work (digging, placing) comes before the motion. */
const DURATION: Record<number, number> = {
  [MoveKind.Walk]: 0.3,
  [MoveKind.Diagonal]: 0.4,
  [MoveKind.StepUp]: 0.42,
  [MoveKind.Drop]: 0.3,
  [MoveKind.Dig]: 0.3,
  [MoveKind.DigDown]: 0.32,
  [MoveKind.Bridge]: 0.3,
  [MoveKind.Pillar]: 0.45,
  [MoveKind.Swim]: 0.6,
};
const FALL_PER_BLOCK = 0.09;

export interface StepHooks {
  /**
   * Called before each step with the planned kind. Returns the kind to execute
   * (it may be simplified, e.g. a planned dig whose blocks are already gone becomes
   * a walk), or -1 if the step is no longer possible.
   */
  validate(from: Vec3i, to: Vec3i, kind: number): number;
  /** Seconds of work (drilling, placing) before the bot moves. 0 = none. */
  workTime(from: Vec3i, to: Vec3i, kind: number): number;
  onWorkStart(from: Vec3i, to: Vec3i, kind: number, seconds: number): void;
  /** Halfway through the motion (a pillar places its block here). */
  onMidMove(from: Vec3i, to: Vec3i, kind: number): void;
  /** A step finished; the bot now stands on `nodes[index]`. */
  onStepDone(index: number, kind: number): void;
  onLand(blocks: number): void;
  onArrive(): void;
  /** The next step is impossible; the bot is standing at `at`. */
  onInvalid(at: Vec3i): void;
  /** Vertical offset for the bot's body in a cell (sinks in water). */
  sink(c: Vec3i): number;
}

const ease = (t: number) => t * t * (3 - 2 * t);

/** Walks the path one move at a time: optional work phase, then a motion shaped per move kind. */
export class Walker {
  readonly pos = new THREE.Vector3();
  yaw = 0;
  active = false;
  working = false;
  /** Walk-cycle phase for the legs. */
  phase = 0;

  private nodes: Int32Array = new Int32Array(0);
  private kinds: Uint8Array = new Uint8Array(0);
  private i = 0; // the current move goes from nodes[i] to nodes[i + 1]
  private t = 0;
  private kind = 0;
  private work = 0;
  private midDone = false;
  private a: Vec3i = [0, 0, 0];
  private b: Vec3i = [0, 0, 0];
  private from = new THREE.Vector3();
  private to = new THREE.Vector3();
  private dur = 1;

  constructor(private hooks: StepHooks) {}

  /** The window the node ids index into. */
  private dims: Dims = { sx: 1, sy: 1, sz: 1 };

  start(dims: Dims, nodes: Int32Array, kinds: Uint8Array): void {
    this.dims = { sx: dims.sx, sy: dims.sy, sz: dims.sz };
    this.nodes = nodes;
    this.kinds = kinds;
    this.i = 0;
    this.active = nodes.length > 1;
    if (this.active) this.beginStep();
  }

  stop(): void {
    this.active = false;
    this.working = false;
  }

  /** The step in progress goes from nodes[stepIndex] to nodes[stepIndex + 1]. */
  get stepIndex(): number {
    return this.i;
  }

  /** The cell the current step started from. */
  get stepFrom(): Vec3i {
    return this.a;
  }

  /** The cell the bot is effectively on (for replanning). */
  currentCell(): Vec3i | null {
    if (!this.nodes.length) return null;
    const onTarget = !this.working && this.t > 0.5 && this.i + 1 < this.nodes.length;
    return voxelCoords(this.dims, this.nodes[onTarget ? this.i + 1 : this.i]);
  }

  update(dt: number): void {
    if (!this.active) return;
    if (this.working) {
      this.work -= dt;
      if (this.work > 0) return;
      this.working = false;
    }
    this.t += dt / this.dur;
    if (!this.midDone && this.t >= 0.5) {
      this.midDone = true;
      this.hooks.onMidMove(this.a, this.b, this.kind);
    }
    if (this.t >= 1) {
      this.pos.copy(this.to);
      if (this.kind === MoveKind.Drop || this.kind === MoveKind.DigDown) this.hooks.onLand(this.a[1] - this.b[1]);
      this.i++;
      this.hooks.onStepDone(this.i, this.kind);
      if (!this.active) return; // the hook stopped us (e.g. to replan here)
      if (this.i >= this.nodes.length - 1) {
        this.active = false;
        this.hooks.onArrive();
        return;
      }
      this.beginStep();
      if (!this.active) return;
    }
    this.shape(Math.min(this.t, 1));
    this.phase += dt * (this.kind === MoveKind.Swim ? 12 : 22);
  }

  private beginStep(): void {
    this.a = voxelCoords(this.dims, this.nodes[this.i]);
    this.b = voxelCoords(this.dims, this.nodes[this.i + 1]);
    const kind = this.hooks.validate(this.a, this.b, this.kinds[this.i + 1]);
    if (kind < 0) {
      this.active = false;
      this.hooks.onInvalid(this.a);
      return;
    }
    this.kind = kind;
    const sa = this.hooks.sink(this.a), sb = this.hooks.sink(this.b);
    this.from.set(this.a[0] + 0.5, this.a[1] + sa, this.a[2] + 0.5);
    this.to.set(this.b[0] + 0.5, this.b[1] + sb, this.b[2] + 0.5);
    this.pos.copy(this.from);
    this.dur = DURATION[kind] + (kind === MoveKind.Drop ? (this.a[1] - this.b[1]) * FALL_PER_BLOCK : 0);
    this.t = 0;
    this.midDone = false;
    if (this.b[0] !== this.a[0] || this.b[2] !== this.a[2]) {
      this.yaw = Math.atan2(this.b[0] - this.a[0], this.b[2] - this.a[2]);
    }
    this.work = this.hooks.workTime(this.a, this.b, kind);
    this.working = this.work > 0;
    if (this.working) this.hooks.onWorkStart(this.a, this.b, kind, this.work);
  }

  private shape(t: number): void {
    const f = this.from, g = this.to, p = this.pos;
    switch (this.kind) {
      case MoveKind.StepUp: {
        p.lerpVectors(f, g, ease(t));
        p.y = f.y + (g.y - f.y) * Math.min(1, t * 1.6) + Math.sin(Math.PI * t) * 0.35;
        break;
      }
      case MoveKind.Drop: {
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
        break;
      }
      case MoveKind.DigDown:
        p.copy(f);
        p.y = f.y + (g.y - f.y) * t * t;
        break;
      case MoveKind.Pillar:
        p.copy(f);
        p.y = f.y + (g.y - f.y) * ease(t) + Math.sin(Math.PI * t) * 0.35;
        break;
      case MoveKind.Swim:
        p.lerpVectors(f, g, t);
        p.y += Math.sin(t * Math.PI * 2) * 0.04;
        break;
      default:
        p.lerpVectors(f, g, t);
    }
  }
}
