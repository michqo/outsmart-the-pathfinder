
import { standableAbove } from '../edit/handles';
import { SearchClient, type DoneMsg } from '../path/client';
import { canStand } from '../path/moves';
import type { Vec3i } from '../path/protocol';
import { BotView, type BotModel } from '../render/bot';
import { GoalMarker } from '../render/goal';
import { PathRibbon } from '../render/pathRibbon';
import type { Stage } from '../render/scene';
import { SearchViz, type VizStyle } from '../render/searchViz';
import type { Hud } from '../ui/hud';
import { voxelCoords, type World } from '../world/world';
import { Walker } from './walker';

type Phase = 'idle' | 'searching' | 'revealing' | 'path' | 'walking';

/** Space → search (visualised) → path ribbon → walk. Owns the bot, goal, viz and ribbon. */
export class BotController {
  start: Vec3i;
  goal: Vec3i;
  readonly bot: BotView;
  readonly goalMarker = new GoalMarker();
  readonly viz: SearchViz;
  readonly ribbon = new PathRibbon();
  private client = new SearchClient();
  private walker: Walker;
  private phase: Phase = 'idle';
  private result: DoneMsg | null = null;
  private pathTimer = 0;

  constructor(
    stage: Stage,
    private world: World,
    private hud: Hud,
    model: BotModel,
    vizStyle: VizStyle,
    start: Vec3i,
    goal: Vec3i,
  ) {
    this.start = start;
    this.goal = goal;
    this.bot = new BotView(model);
    this.viz = new SearchViz(vizStyle);
    this.walker = new Walker({
      onLand: (blocks) => this.bot.land(blocks >= 3),
      onArrive: () => this.arrive(),
    });
    stage.island.add(this.bot.root, this.goalMarker.root, this.viz.mesh, this.ribbon.group);
    this.place();
    this.faceGoal();
  }

  get busy(): boolean {
    return this.phase !== 'idle';
  }

  /** Space: plan from wherever the bot is now. */
  run(): void {
    if (this.phase === 'walking') {
      const node = this.walker.currentNode();
      this.walker.stop();
      if (node >= 0) this.start = voxelCoords(node);
      this.place();
    }
    this.client.cancel();
    this.viz.reset();
    this.ribbon.clear();
    this.result = null;
    this.phase = 'searching';
    this.bot.setMood('thinking');
    this.hud.setStatus('searching');
    this.hud.setStats({ expanded: 0, pathLength: 0, cost: 0, ms: 0 });
    this.client.search(this.world, this.start, this.goal, 1, {
      onProgress: (events, expanded) => {
        this.viz.push(events);
        this.hud.setStats({ expanded });
      },
      onDone: (r) => {
        this.result = r;
        this.viz.finish();
        this.phase = 'revealing';
        this.hud.setStats({ expanded: r.expanded, ms: r.ms, pathLength: r.found ? r.nodes.length - 1 : 0, cost: r.cost });
      },
    });
  }

  /** Stops everything and returns to idle where the bot stands. */
  halt(): void {
    this.client.cancel();
    if (this.phase === 'walking') {
      const node = this.walker.currentNode();
      if (node >= 0) this.start = voxelCoords(node);
    }
    this.walker.stop();
    this.phase = 'idle';
    this.bot.setMood('idle');
    this.hud.setStatus('ready');
    this.place();
  }

  setStart(cell: Vec3i): boolean {
    this.halt();
    this.start = cell;
    this.place();
    this.faceGoal();
    return true;
  }

  setGoal(cell: Vec3i): boolean {
    if (cell[0] === this.start[0] && cell[1] === this.start[1] && cell[2] === this.start[2]) return false;
    this.halt();
    this.goal = cell;
    this.place();
    this.faceGoal();
    return true;
  }

  /** After world edits: keep the bot and goal standing on something. */
  onWorldEdit(): void {
    if (this.phase === 'walking') return; // live replanning arrives in M4
    const fix = (c: Vec3i) => (canStand(this.world, c[0], c[1], c[2]) ? c : standableAbove(this.world, c[0], c[1] - 3, c[2]) ?? c);
    this.start = fix(this.start);
    this.goal = fix(this.goal);
    this.place();
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

    if (this.phase === 'revealing' && this.viz.playbackDone && this.result) {
      if (this.result.found) {
        this.ribbon.show(this.result.nodes, this.result.kinds, 0.6);
        this.phase = 'path';
        this.pathTimer = 0;
      } else {
        this.phase = 'idle';
        this.bot.setMood('confused');
        this.hud.setStatus('stuck');
      }
    }
    if (this.phase === 'path') {
      this.pathTimer += dt;
      if (this.ribbon.revealed && this.pathTimer > 0.85) {
        this.phase = 'walking';
        this.bot.setMood('walking');
        this.hud.setStatus('walking');
        this.walker.start(this.result!.nodes, this.result!.kinds);
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

  private arrive(): void {
    this.start = [...this.goal];
    this.phase = 'idle';
    this.bot.setMood('happy');
    this.hud.setStatus('happy');
    this.ribbon.fade(0.35);
  }

  private place(): void {
    const s = this.start, g = this.goal;
    this.bot.root.position.set(s[0] + 0.5, s[1], s[2] + 0.5);
    this.goalMarker.root.position.set(g[0] + 0.5, g[1], g[2] + 0.5);
  }

  private faceGoal(): void {
    this.bot.root.rotation.y = Math.atan2(this.goal[0] - this.start[0], this.goal[2] - this.start[2]);
  }

  private turnTo(yaw: number, dt: number): void {
    const r = this.bot.root.rotation;
    let d = yaw - r.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    r.y += d * (1 - Math.exp(-dt * 14));
  }
}

