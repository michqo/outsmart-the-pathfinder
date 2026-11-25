import { standableAbove } from '../edit/handles';
import { SearchClient, type DoneMsg } from '../path/client';
import { canStand, HARDNESS, isMoveValid, isSwimSpot, MoveKind } from '../path/moves';
import type { Vec3i } from '../path/protocol';
import { BotView, type BotModel } from '../render/bot';
import { Effects } from '../render/effects';
import { GoalMarker } from '../render/goal';
import { PathRibbon } from '../render/pathRibbon';
import type { Stage } from '../render/scene';
import { SearchViz, type VizStyle } from '../render/searchViz';
import type { Hud } from '../ui/hud';
import { Mat } from '../world/materials';
import { voxelCoords, voxelIndex, type World } from '../world/world';
import * as THREE from 'three';
import { pathFootprint, stepFootprint, touching } from './pathTouch';
import { Walker } from './walker';

type Phase = 'idle' | 'searching' | 'revealing' | 'path' | 'walking' | 'bonk';

/** Seconds for the startled hop back when an edit lands on the step in progress. */
const BONK_TIME = 0.42;

/** How deep the bot sits in water. */
const SWIM_SINK = -0.55;
/** Seconds of drilling per point of hardness, plus a base. */
const DIG_BASE = 0.18, DIG_PER_HARDNESS = 0.12;
const PLACE_TIME = 0.22;

export interface ControllerOptions {
  model: BotModel;
  vizStyle: VizStyle;
  blocks: number;
  colorOf(m: Mat): number;
  /** The bot changed the world (dug / placed / restored). */
  onWorldChanged(): void;
  /** A run ended: did the bot arrive, and how many nodes it expanded in all (replans included). */
  onRunEnd?(arrived: boolean, nodes: number): void;
}

/**
 * Space → (restore the course) → search, visualised → path ribbon → walk, digging and
 * building as planned. Every step is re-checked against the real world first; if it
 * no longer works the bot replans from where it stands.
 */
export class BotController {
  /** Where runs start from (set by spawn / dragging). */
  home: Vec3i;
  goal: Vec3i;
  blocksTotal: number;
  blocksLeft: number;
  /** Weighted-A* weight: 1 = optimal paths; higher = greedier, usually fewer nodes. */
  weight = 1;
  readonly bot: BotView;
  readonly goalMarker = new GoalMarker();
  readonly viz: SearchViz;
  readonly ribbon = new PathRibbon();
  /** The path the bot just abandoned, shown dashed while it re-thinks. */
  readonly ghost = new PathRibbon();
  readonly effects = new Effects();
  private client = new SearchClient();
  private walker: Walker;
  private phase: Phase = 'idle';
  private result: DoneMsg | null = null;
  private pathTimer = 0;
  /** Where the bot stands while idle (home, or the goal after a run). */
  private at: Vec3i;
  private dug = 0;
  private built = 0;
  /** Cells the bot changed this run: voxel index → what the course had there and what the bot left. */
  private changes = new Map<number, { course: Mat; bot: Mat }>();
  /** Where the current search started. */
  private searchFrom: Vec3i = [0, 0, 0];
  private searchStatus: 'searching' | 'replanning' = 'searching';
  /** An edit hit the path further ahead: replan when the current step ends. */
  private replanAtNextNode = false;
  private replans = 0;
  /** Nodes expanded over every search of this run. */
  private runNodes = 0;
  /** True from the first step of a run until it ends (drives the follow camera). */
  private running = false;
  private ghostTimer = 0;
  private bonkT = 0;
  private bonkCell: Vec3i = [0, 0, 0];
  private bonkFrom = new THREE.Vector3();
  private bonkTo = new THREE.Vector3();

  constructor(
    stage: Stage,
    private world: World,
    private hud: Hud,
    private opts: ControllerOptions,
    home: Vec3i,
    goal: Vec3i,
  ) {
    this.home = home;
    this.at = home;
    this.goal = goal;
    this.blocksTotal = this.blocksLeft = opts.blocks;
    this.bot = new BotView(opts.model);
    this.viz = new SearchViz(opts.vizStyle);
    this.walker = new Walker({
      validate: (a, b, k) => this.validate(a, b, k),
      workTime: (a, b, k) => this.workTime(a, b, k),
      onWorkStart: (a, b, k, s) => this.startWork(a, b, k, s),
      onMidMove: (a, _b, k) => {
        if (k === MoveKind.Pillar) this.place(a);
      },
      onStepDone: (i, k) => {
        this.ribbon.stepDone(i);
        if (this.replanAtNextNode && this.result && i < this.result.nodes.length - 1) {
          this.walker.stop();
          this.replan(voxelCoords(this.result.nodes[i]));
          return;
        }
        if (k !== MoveKind.Dig && k !== MoveKind.DigDown) this.bot.setMood('walking');
      },
      onLand: (blocks) => this.bot.land(blocks >= 3),
      onArrive: () => this.arrive(),
      onInvalid: (at) => this.replan(at),
      sink: (c) => (isSwimSpot(this.world, c[0], c[1], c[2]) ? SWIM_SINK : 0),
    });
    this.ghost.broken = true;
    stage.island.add(this.bot.root, this.goalMarker.root, this.viz.mesh, this.ghost.group, this.ribbon.group, this.effects.group);
    this.placeIdle();
    this.faceGoal();
    this.updateInventoryHud();
  }

  get busy(): boolean {
    return this.phase !== 'idle';
  }

  /** Space: put the course back the way you built it, then run it from home. */
  run(): void {
    this.stopAll();
    this.restoreCourse();
    this.at = this.home;
    this.blocksLeft = this.blocksTotal;
    this.dug = this.built = this.replans = this.runNodes = 0;
    this.placeIdle();
    this.faceGoal();
    this.search(this.home, 'searching');
  }

  setStart(cell: Vec3i): boolean {
    this.stopAll();
    this.restoreCourse();
    this.home = this.at = cell;
    this.placeIdle();
    this.faceGoal();
    return true;
  }

  setGoal(cell: Vec3i): boolean {
    if (cell[0] === this.home[0] && cell[1] === this.home[1] && cell[2] === this.home[2]) return false;
    this.stopAll();
    this.restoreCourse();
    this.goal = cell;
    this.at = this.home;
    this.placeIdle();
    this.faceGoal();
    return true;
  }

  setInventory(n: number): void {
    this.blocksTotal = n;
    if (!this.busy) this.blocksLeft = n;
    this.updateInventoryHud();
  }

  /** A new level was loaded: the bot's change log no longer applies. */
  forgetChanges(): void {
    this.stopAll();
    this.changes.clear();
  }

  /**
   * The player edited `cells` (voxel indices). While a run is on, the bot reacts:
   *  - searching: the search used an old copy of the world, so start it again;
   *  - path shown / walking: only if the edit touches the remaining path. An edit on the
   *    step in progress makes it hop back ("bonk") and rethink; one further ahead makes it
   *    rethink when it reaches the next cell.
   */
  onWorldEdit(cells: number[] = []): void {
    if (this.phase === 'searching' || this.phase === 'revealing') {
      this.search(this.searchFrom, this.searchStatus);
      return;
    }
    if (this.phase === 'bonk') return; // a replan is already coming
    if ((this.phase === 'path' || this.phase === 'walking') && this.result?.found) {
      this.reactToEdit(cells);
      return;
    }
    if (this.busy) return;
    const fix = (c: Vec3i) => (canStand(this.world, c[0], c[1], c[2]) ? c : standableAbove(this.world, c[0], c[1] - 3, c[2]) ?? c);
    this.home = fix(this.home);
    this.goal = fix(this.goal);
    this.at = fix(this.at);
    this.placeIdle();
  }

  /** Where the follow camera should look, or null when no run is in progress. */
  followTarget(out: THREE.Vector3): THREE.Vector3 | null {
    if (!this.running) return null;
    return out.copy(this.bot.root.position);
  }

  private reactToEdit(cells: number[]): void {
    const { nodes, kinds } = this.result!;
    const i = this.phase === 'walking' ? this.walker.stepIndex : 0;
    const now = this.phase === 'walking' ? touching(cells, stepFootprint(nodes, kinds, i)) : [];
    if (now.length) {
      this.markEdits(now);
      this.bonk(i);
      return;
    }
    const ahead = touching(cells, pathFootprint(nodes, kinds, this.phase === 'walking' ? i + 1 : 0));
    if (!ahead.length) return; // doesn't matter to the plan
    this.markEdits(ahead);
    if (this.phase === 'path') this.replan(this.at);
    else {
      this.replanAtNextNode = true;
      this.hud.setStatus('replanning');
    }
  }

  private markEdits(cells: number[]): void {
    for (const c of cells.slice(0, 24)) this.effects.flash(voxelCoords(c));
  }

  /** An edit landed on the step in progress: hop back to where it started, startled, then rethink. */
  private bonk(i: number): void {
    const a = this.walker.stepFrom;
    this.walker.stop();
    this.effects.cancelAll(); // a half-drilled block stays; a half-placed one goes back in the bag
    this.showGhost(i);
    this.bonkCell = [a[0], a[1], a[2]];
    this.bonkFrom.copy(this.bot.root.position);
    const sink = isSwimSpot(this.world, a[0], a[1], a[2]) ? SWIM_SINK : 0;
    this.bonkTo.set(a[0] + 0.5, a[1] + sink, a[2] + 0.5);
    this.bonkT = 0;
    this.phase = 'bonk';
    this.bot.setMood('confused');
    this.bot.land(true);
    this.hud.setStatus('replanning');
  }

  /** Keep the rest of the abandoned path on screen (dashed) until the new one appears. */
  private showGhost(from: number): void {
    if (!this.result?.found) return;
    const n = this.result.nodes.length;
    if (from >= n - 1) return;
    this.ghost.show(this.result.nodes.slice(from), this.result.kinds.slice(from), 0);
    this.ghost.fade(1);
    this.ghostTimer = 0;
  }

  setModel(m: BotModel): void {
    this.bot.setModel(m);
  }

  setVizStyle(s: VizStyle): void {
    this.viz.setStyle(s);
  }

  update(dt: number, t: number): void {
    this.viz.update(t, dt);
    this.ribbon.update(t, dt);
    this.goalMarker.update(t);
    this.effects.update(dt);
    this.ghost.update(t, dt);
    if (this.ghostTimer > 0) {
      this.ghostTimer -= dt;
      this.ghost.fade(Math.max(0, this.ghostTimer / 0.8));
      if (this.ghostTimer <= 0) this.ghost.clear();
    }

    if (this.phase === 'bonk') {
      this.bonkT += dt / BONK_TIME;
      const k = Math.min(1, this.bonkT);
      this.bot.root.position.lerpVectors(this.bonkFrom, this.bonkTo, k * (2 - k));
      this.bot.root.position.y += Math.sin(Math.PI * k) * 0.45;
      if (k >= 1) this.replan(this.bonkCell);
    }

    if (this.phase === 'revealing' && this.viz.playbackDone && this.result) {
      if (this.result.found) {
        this.ribbon.show(this.result.nodes, this.result.kinds, 0.6);
        if (this.ghost.group.children.length) this.ghostTimer = 0.8; // the old path fades as the new one draws
        this.phase = 'path';
        this.pathTimer = 0;
      } else {
        this.phase = 'idle';
        this.running = false;
        this.bot.setMood('confused');
        this.hud.setStatus('stuck');
        if (this.ghost.group.children.length) this.ghostTimer = 0.8;
        this.opts.onRunEnd?.(false, this.runNodes);
      }
    }
    if (this.phase === 'path') {
      this.pathTimer += dt;
      if (this.ribbon.revealed && this.pathTimer > 0.85) {
        this.phase = 'walking';
        this.running = true;
        this.replanAtNextNode = false;
        this.bot.setMood('walking');
        this.hud.setStatus('walking');
        this.walker.start(this.result!.nodes, this.result!.kinds);
        this.viz.fadeTo(0.15, 0.8);
      }
    }
    if (this.phase === 'walking') {
      this.walker.update(dt);
      this.bot.walkPhase = this.walker.phase;
      this.bot.root.position.copy(this.walker.pos);
      this.turnTo(this.walker.yaw, dt);
    }
    this.bot.update(dt, t);
  }

  // ---------------------------------------------------------------- search

  private search(from: Vec3i, status: 'searching' | 'replanning'): void {
    this.client.cancel();
    this.viz.reset();
    this.ribbon.clear();
    this.result = null;
    this.searchFrom = from;
    this.searchStatus = status;
    this.phase = 'searching';
    this.bot.setMood('thinking');
    this.hud.setStatus(status);
    this.hud.setStats({ expanded: this.runNodes, pathLength: 0, cost: 0, ms: 0 });
    this.updateInventoryHud();
    this.client.search(this.world, from, this.goal, this.weight, this.blocksLeft, {
      onProgress: (events, expanded) => {
        this.viz.push(events);
        this.hud.setStats({ expanded: this.runNodes + expanded });
      },
      onDone: (r) => {
        this.result = r;
        this.runNodes += r.expanded;
        this.viz.finish();
        this.phase = 'revealing';
        this.hud.setStats({ expanded: this.runNodes, ms: r.ms, pathLength: r.found ? r.nodes.length - 1 : 0, cost: r.cost });
      },
    });
  }

  /** A step turned out impossible: think again from here, with what's left in the inventory. */
  private replan(at: Vec3i): void {
    if (this.phase === 'walking' || this.phase === 'path') this.showGhost(this.phase === 'walking' ? this.walker.stepIndex : 0);
    this.replanAtNextNode = false;
    this.replans++;
    this.at = at;
    this.placeIdle();
    this.search(at, 'replanning');
  }

  private stopAll(): void {
    this.client.cancel();
    this.walker.stop();
    this.effects.cancelAll();
    this.phase = 'idle';
    this.running = false;
    this.replanAtNextNode = false;
    this.bot.setMood('idle');
    this.hud.setStatus('ready');
    this.viz.reset();
    this.ribbon.clear();
    this.ghost.clear();
    this.ghostTimer = 0;
  }

  // ---------------------------------------------------------------- execution

  /** Re-checks a planned step against the real world. A planned dig or bridge that's no longer needed becomes a plain move. */
  private validate(a: Vec3i, b: Vec3i, kind: number): number {
    const w = this.world;
    if (isMoveValid(w, a, b, kind, this.blocksLeft)) return kind;
    for (const k of [MoveKind.Walk, MoveKind.Diagonal, MoveKind.Swim, MoveKind.StepUp, MoveKind.Drop]) {
      if (isMoveValid(w, a, b, k, this.blocksLeft)) return k;
    }
    return -1;
  }

  /** The cells a dig step removes. */
  private digCells(a: Vec3i, b: Vec3i, kind: number): Vec3i[] {
    if (kind === MoveKind.DigDown) return [[a[0], a[1] - 1, a[2]]];
    if (kind !== MoveKind.Dig) return [];
    return ([[b[0], b[1], b[2]], [b[0], b[1] + 1, b[2]]] as Vec3i[]).filter((c) => this.world.get(c[0], c[1], c[2]) !== Mat.Air);
  }

  private workTime(a: Vec3i, b: Vec3i, kind: number): number {
    if (kind === MoveKind.Bridge) return PLACE_TIME;
    const cells = this.digCells(a, b, kind);
    if (!cells.length) return 0;
    const hardness = cells.reduce((s, c) => s + HARDNESS[this.world.get(c[0], c[1], c[2])], 0);
    return DIG_BASE + DIG_PER_HARDNESS * hardness;
  }

  private startWork(a: Vec3i, b: Vec3i, kind: number, seconds: number): void {
    if (kind === MoveKind.Bridge) {
      this.place([b[0], b[1] - 1, b[2]], seconds);
      return;
    }
    this.bot.setMood('working');
    for (const c of this.digCells(a, b, kind)) {
      const m = this.world.get(c[0], c[1], c[2]);
      this.effects.drill(c, this.opts.colorOf(m), seconds, () => {
        this.setBlock(c, Mat.Air);
        this.dug++;
        this.updateInventoryHud();
      });
    }
  }

  /** Pops a bot block into the world (it lands in the world when the pop finishes). */
  private place(c: Vec3i, seconds = 0.16): void {
    this.blocksLeft = Math.max(0, this.blocksLeft - 1);
    this.built++;
    this.updateInventoryHud();
    this.effects.pop(
      c,
      this.opts.colorOf(Mat.Placed),
      seconds,
      () => this.setBlock(c, Mat.Placed),
      () => {
        // Interrupted before it landed: the block goes back in the bag.
        this.blocksLeft++;
        this.built--;
        this.updateInventoryHud();
      },
    );
  }

  /** Every bot change goes through here, so the course can be restored later. */
  private setBlock(c: Vec3i, m: Mat): void {
    const before = this.world.get(c[0], c[1], c[2]);
    if (before === m) return;
    const i = voxelIndex(c[0], c[1], c[2]);
    const entry = this.changes.get(i);
    if (entry) entry.bot = m;
    else this.changes.set(i, { course: before, bot: m });
    this.world.set(c[0], c[1], c[2], m);
    this.opts.onWorldChanged();
  }

  /** The world as the player built it: a copy with the bot's digging and building taken back out. */
  courseSnapshot(): Uint8Array {
    const data = this.world.data.slice();
    for (const [i, { course, bot }] of this.changes) if (data[i] === bot) data[i] = course;
    return data;
  }

  /** Undo the bot's changes, except where the player has since edited the same cell. */
  private restoreCourse(): void {
    if (!this.changes.size) return;
    for (const [i, { course, bot }] of this.changes) {
      if (this.world.data[i] !== bot) continue; // the player changed it since: theirs wins
      const [x, y, z] = voxelCoords(i);
      this.world.set(x, y, z, course);
    }
    this.changes.clear();
    this.opts.onWorldChanged();
  }

  private arrive(): void {
    this.at = [...this.goal];
    this.phase = 'idle';
    this.running = false;
    this.bot.setMood('happy');
    this.hud.setStatus('happy');
    this.ribbon.fade(0.35);
    this.opts.onRunEnd?.(true, this.runNodes);
  }

  // ---------------------------------------------------------------- helpers

  private updateInventoryHud(): void {
    this.hud.setStats({ blocks: `${this.blocksLeft}/${this.blocksTotal}`, dug: this.dug, built: this.built, replans: this.replans });
  }

  private placeIdle(): void {
    const s = this.at, g = this.goal;
    const sink = isSwimSpot(this.world, s[0], s[1], s[2]) ? SWIM_SINK : 0;
    this.bot.root.position.set(s[0] + 0.5, s[1] + sink, s[2] + 0.5);
    this.goalMarker.root.position.set(g[0] + 0.5, g[1], g[2] + 0.5);
  }

  private faceGoal(): void {
    this.bot.root.rotation.y = Math.atan2(this.goal[0] - this.at[0], this.goal[2] - this.at[2]);
  }

  private turnTo(yaw: number, dt: number): void {
    const r = this.bot.root.rotation;
    let d = yaw - r.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    r.y += d * (1 - Math.exp(-dt * 14));
  }
}

