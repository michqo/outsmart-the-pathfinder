import { Group } from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import { BotController } from '../src/bot/controller';
import { EditHistory } from '../src/edit/history';
import { MoveKind } from '../src/path/moves';
import type { FromWorker, ToWorker, Vec3i } from '../src/path/protocol';
import type { Stage } from '../src/render/scene';
import type { Hud } from '../src/ui/hud';
import { Mat } from '../src/world/materials';
import { DEFAULT_DIMS as D, World, voxelIndex } from '../src/world/world';

afterEach(() => vi.unstubAllGlobals());

it('marks a place-and-undo run as practice without affecting the next clean run', () => {
  const worker = { onmessage: (_e: { data: FromWorker }) => {}, postMessage: vi.fn<(msg: ToWorker) => void>() };
  vi.stubGlobal('Worker', function () { return worker; });
  const world = new World();
  const home: Vec3i = [4, 2, 4], goal: Vec3i = [5, 2, 4];
  world.set(4, 1, 4, Mat.Stone);
  world.set(5, 1, 4, Mat.Stone);
  const onRunEnd = vi.fn();
  const bot = new BotController(
    { island: new Group() } as Stage, world, { setStatus: vi.fn(), setStats: vi.fn() } as Partial<Hud> as Hud,
    { model: 'capsule', vizStyle: 'glow', blocks: 0, colorOf: () => 0, onWorldChanged: () => {}, onRunEnd },
    home, goal,
  );
  const finishSearch = () => {
    const request = worker.postMessage.mock.lastCall?.[0];
    if (request?.type !== 'search') throw new Error('Expected a search request');
    worker.onmessage({ data: {
      type: 'done', id: request.id, version: request.version, found: true, cost: 1, expanded: 2, ms: 1,
      nodes: Int32Array.of(voxelIndex(D, ...home), voxelIndex(D, ...goal)), kinds: Uint8Array.of(0, MoveKind.Walk),
    } });
  };
  const walkToGoal = () => {
    for (let frame = 0; frame < 180 && bot.busy; frame++) bot.update(1 / 60, frame / 60);
  };

  bot.run();
  finishSearch();
  const history = new EditHistory();
  history.edit(world, (set) => set(4, 2, 5, Mat.Grass));
  bot.onWorldEdit(history.lastCells);
  finishSearch();
  history.undo(world);
  bot.onWorldEdit(history.lastCells);
  finishSearch();
  walkToGoal();
  expect(onRunEnd).toHaveBeenLastCalledWith(true, 6, true);

  bot.run();
  finishSearch();
  walkToGoal();
  expect(onRunEnd).toHaveBeenLastCalledWith(true, 2, false);
  expect(onRunEnd).toHaveBeenCalledTimes(2);
});
