import { hash2 } from '../world/noise';

/** Each archipelago island has a fixed time of day, picked from its seed. */
export type TimeOfDay = 'dawn' | 'day' | 'dusk' | 'night';
export const TIMES: readonly TimeOfDay[] = ['dawn', 'day', 'dusk', 'night'];

/**
 * Home is always day; elsewhere day is the most common, then dusk and dawn, then night.
 * Deterministic: the same island always has the same time.
 */
export function timeOfDayFor(seed: number, ix: number, iz: number): TimeOfDay {
  if (ix === 0 && iz === 0) return 'day';
  const r = hash2(ix * 31 + 7, iz * 17 - 3, (seed % 999_983) + 101);
  return r < 0.4 ? 'day' : r < 0.6 ? 'dusk' : r < 0.78 ? 'dawn' : 'night';
}

/** How a time of day lights the scene, relative to the palette's (day = unchanged). */
export interface TimeLight {
  /** Sun (or moon) elevation 0..1 (sin of the angle) and compass bearing in radians. */
  elevation: number;
  bearing: number;
  sunColor: number;
  /** Multiplies the sun's intensity. */
  sun: number;
  /** Sky colour multiplier (realistic bands, stylised gradient) and how much to apply it. */
  skyTint: number;
  sky: number;
  /** Multiplies the hemisphere/environment light. */
  ambient: number;
  /** Stars' opacity, and whether start/flag lanterns and the bot's light are on (0..1). */
  stars: number;
  lanterns: number;
  /** Tone-mapping exposure multiplier. */
  exposure: number;
}

export const TIME_LIGHT: Record<TimeOfDay, TimeLight> = {
  day: { elevation: 0, bearing: 0, sunColor: 0xffffff, sun: 1, skyTint: 0xffffff, sky: 1, ambient: 1, stars: 0, lanterns: 0, exposure: 1 },
  dawn: { elevation: 0.26, bearing: 1.2, sunColor: 0xffc79e, sun: 0.8, skyTint: 0xffc6b4, sky: 0.85, ambient: 0.75, stars: 0.12, lanterns: 0.35, exposure: 1.05 },
  dusk: { elevation: 0.2, bearing: -1.9, sunColor: 0xff9e70, sun: 0.7, skyTint: 0xf0a088, sky: 0.7, ambient: 0.62, stars: 0.3, lanterns: 0.7, exposure: 1.08 },
  night: { elevation: 0.62, bearing: 2.6, sunColor: 0xa9bcff, sun: 0.28, skyTint: 0x4a5a9a, sky: 0.2, ambient: 0.3, stars: 1, lanterns: 1, exposure: 1.2 },
};
