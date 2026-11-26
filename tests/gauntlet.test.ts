import { describe, expect, it } from 'vitest';
import { generateGauntlet } from './fixtures/gauntlet';
import { AStar } from '../src/path/astar';
import { MoveKind } from '../src/path/moves';
import { World } from '../src/world/world';

describe('gauntlet level', () => {
  it('needs a swim, a dig, a bridge and a pillar', () => {
    const w = new World();
    const { start, goal } = generateGauntlet(w);
    const p = new AStar(w, start, goal, 1, 16).run()!;
    expect(p).not.toBeNull();
    const kinds = new Set(p.kinds);
    for (const k of [MoveKind.Swim, MoveKind.Dig, MoveKind.Bridge, MoveKind.Pillar]) expect(kinds.has(k)).toBe(true);
  });

  it('is impossible without blocks', () => {
    const w = new World();
    const { start, goal } = generateGauntlet(w);
    expect(new AStar(w, start, goal, 1, 0).run()).toBeNull();
  });
});
