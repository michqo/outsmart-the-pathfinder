import { PathRibbon } from '../render/pathRibbon';
import type { Stage } from '../render/scene';
import { SearchViz } from '../render/searchViz';
import { DEFAULT_DIMS, type Dims, type World } from '../world/world';
import { SearchClient, type DoneMsg } from './client';
import type { Vec3i } from './protocol';

export const OPPONENTS = {
  dijkstra: { name: 'Dijkstra', weight: 0 },
  weighted: { name: 'Weighted A*', weight: 5 },
} as const;
export type DuelOpponent = keyof typeof OPPONENTS;
export type DuelResults = [DoneMsg, DoneMsg];

export class AlgorithmDuel {
  private lanes = ([
    { lane: -0.22, colors: [0x30f0ff, 0x2380ff], path: { base: 0x0789eb, bright: 0x9ffbff, lift: 0.23, order: 4 } },
    { lane: 0.22, colors: [0xffba57, 0xf17636], path: { base: 0xf1781b, bright: 0xffe6a3, lift: 0.43, order: 5 } },
  ] as const).map(({ lane, colors, path }) => ({
    client: new SearchClient(),
    viz: new SearchViz('glow', lane, [...colors]),
    ribbon: new PathRibbon(path),
    routeShown: false,
  }));
  private results: (DoneMsg | null)[] = [null, null];
  private phase: 'idle' | 'searching' | 'revealing' | 'done' = 'idle';
  /** The window the current results' cell ids index into. */
  private dims: Dims = DEFAULT_DIMS;

  constructor(
    stage: Stage,
    private onResults: (results: DuelResults) => void,
    private onError: (event: Event) => void,
  ) {
    for (const { viz, ribbon } of this.lanes) stage.island.add(viz.mesh, ribbon.group);
    this.clear();
  }

  get busy(): boolean {
    return this.phase === 'searching' || this.phase === 'revealing';
  }

  clear(): void {
    this.phase = 'idle';
    this.results = [null, null];
    for (const lane of this.lanes) {
      const { client, viz, ribbon } = lane;
      lane.routeShown = false;
      client.cancel();
      viz.reset();
      viz.mesh.visible = false;
      ribbon.clear();
    }
  }

  run(world: World, start: Vec3i, goal: Vec3i, blocks: number, opponent: DuelOpponent, revealSeconds: number): void {
    this.clear();
    this.dims = { sx: world.sx, sy: world.sy, sz: world.sz };
    this.phase = 'searching';
    // Both workers copy the same world before the next player event can edit it.
    const jobs = [{ weight: 1 }, OPPONENTS[opponent]];
    this.lanes.forEach(({ client, viz }, i) => {
      viz.reset(world);
      viz.duration = revealSeconds;
      client.search(world, start, goal, jobs[i].weight, blocks, {
        onProgress: (events) => viz.push(events),
        onDone: (result) => {
          this.results[i] = result;
          const [baseline, challenger] = this.results;
          if (!baseline || !challenger) return;
          this.phase = 'revealing';
          const largest = Math.max(...this.lanes.map(({ viz }) => viz.eventCount));
          const rate = revealSeconds > 0 ? Math.max(500, largest / revealSeconds) : Infinity;
          for (const { viz } of this.lanes) {
            viz.mesh.visible = true;
            viz.finish(rate);
          }
          this.onResults([baseline, challenger]);
        },
        onError: (event) => {
          this.clear();
          this.onError(event);
        },
      }, { verifyRoute: true });
    });
  }

  update(dt: number, t: number): void {
    if (this.phase !== 'revealing' && this.phase !== 'done') return;
    for (const { viz, ribbon } of this.lanes) {
      viz.update(t, dt);
      ribbon.update(t, dt);
    }
    if (this.phase !== 'revealing') return;
    const [baseline, opponent] = this.results;
    if (!baseline || !opponent) return;
    this.lanes.forEach((lane, i) => {
      const { viz, ribbon } = lane;
      if (!viz.playbackDone || lane.routeShown) return;
      lane.routeShown = true;
      const result = i === 0 ? baseline : opponent;
      viz.fadeTo(0.25, 0.65);
      if (result.found) ribbon.show(this.dims, result.nodes, result.kinds);
    });
    if (!this.lanes.every(({ viz }) => viz.playbackDone)) return;
    this.phase = 'done';
  }
}
