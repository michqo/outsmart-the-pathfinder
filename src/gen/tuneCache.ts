import { GEN_VERSION, type IslandSpec } from './island';
import { TUNE_VERSION, type Tuning } from './tune';

/** Surveys are deterministic but take seconds: keep the results (small) per island and tier. */
const KEY = 'pathfinder.tuning';
const MAX = 80;

export function tuningKey(spec: IslandSpec, tier: number): string {
  return `${GEN_VERSION}.${TUNE_VERSION}:${spec.seed}:${spec.ix}:${spec.iz}:${spec.maxSize ?? 0}:${tier}`;
}

function readAll(): Record<string, Tuning> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

export function cachedTuning(spec: IslandSpec, tier: number): Tuning | null {
  const t = readAll()[tuningKey(spec, tier)];
  return t && t.version === TUNE_VERSION && t.tier === tier ? t : null;
}

export function storeTuning(spec: IslandSpec, tuning: Tuning): void {
  const all = readAll();
  const k = tuningKey(spec, tuning.tier);
  delete all[k];
  all[k] = tuning; // newest last; the oldest go first when full
  const keys = Object.keys(all);
  for (const old of keys.slice(0, Math.max(0, keys.length - MAX))) delete all[old];
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // storage blocked or full: the island just gets surveyed again next time
  }
}
