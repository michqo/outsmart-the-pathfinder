import { describe, expect, it } from 'vitest';
import { courseFromHash, decodeLevel, encodeLevel, rleDecode, rleEncode, type SharedLevel } from '../src/levels/codec';
import { generateTestIsland } from '../src/world/testIsland';
import { World } from '../src/world/world';

const island = () => {
  const w = new World();
  generateTestIsland(w, 7);
  return w.data.slice();
};

describe('run-length encoding', () => {
  it('round-trips, including runs longer than one varint byte', () => {
    const data = new Uint8Array(1000);
    data.fill(3, 10, 400);
    data[999] = 6;
    const back = rleDecode(rleEncode(data), data.length);
    expect(back).toEqual(data);
  });

  it('rejects bad materials and wrong lengths', () => {
    expect(() => rleDecode(Uint8Array.from([5, 9]), 5)).toThrow(/material/);
    expect(() => rleDecode(Uint8Array.from([3, 1]), 5)).toThrow(/short/);
    expect(() => rleDecode(Uint8Array.from([9, 1]), 5)).toThrow(/long/);
  });
});

describe('share links', () => {
  it('round-trips a sandbox course with its world', async () => {
    const level: SharedLevel = {
      mode: 'sandbox',
      levelId: '',
      world: island(),
      start: [10, 12, 50],
      goal: [40, 20, 12],
      inventory: 16,
      weight: 2.5,
      dare: 12345,
    };
    const text = await encodeLevel(level);
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(text.length).toBeLessThan(8000); // fits comfortably in a URL
    const back = await decodeLevel(text);
    expect(back.world).toEqual(level.world);
    expect({ ...back, world: null }).toEqual({ ...level, world: null });
  });

  it('a challenge link carries just the id, spawn, settings and dare', async () => {
    const text = await encodeLevel({
      mode: 'challenge',
      levelId: 'first-wall',
      world: island(), // ignored for challenges
      start: [21, 9, 32],
      goal: [43, 9, 32],
      inventory: 0,
      weight: 1,
      dare: 777,
    });
    expect(text.length).toBeLessThan(60);
    const back = await decodeLevel(text);
    expect(back.mode).toBe('challenge');
    expect(back.levelId).toBe('first-wall');
    expect(back.world).toBeNull();
    expect(back.dare).toBe(777);
  });

  it('rejects garbage', async () => {
    await expect(decodeLevel('not*base64')).rejects.toThrow();
    await expect(decodeLevel('AAAA')).rejects.toThrow();
  });

  it('reads the course from a location hash', () => {
    expect(courseFromHash('#course=abc_-')).toBe('abc_-');
    expect(courseFromHash('#other')).toBeNull();
  });
});

describe('island links (v2)', () => {
  it('round-trip, with negative grid cells and a full-range seed', async () => {
    const { decodeLink, encodeIsland } = await import('../src/levels/codec');
    const s = { seed: 0xfedcba98, ix: -3, iz: 12, cap: 80, dare: 123456, genVersion: 1, tuneVersion: 1 };
    const text = await encodeIsland(s);
    expect(text.length).toBeLessThan(40);
    expect(await decodeLink(text)).toEqual({ v: 2, island: s });
  });

  it('v1 links still decode through the same entry point', async () => {
    const { decodeLink } = await import('../src/levels/codec');
    const level: SharedLevel = { mode: 'challenge', levelId: 'first-wall', world: null, start: [1, 2, 3], goal: [4, 5, 6], inventory: 0, weight: 1, dare: 77 };
    expect(await decodeLink(await encodeLevel(level))).toEqual({ v: 1, level });
  });
});
