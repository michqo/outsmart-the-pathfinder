import { islandId } from '../gen/archipelago';

/**
 * Archipelago progress in localStorage: which archipelago you're in and where, plus the
 * best and stars per island (per seed). Stars are stored with the best, so bridges can be
 * drawn without re-surveying anything.
 */
const KEY = 'pathfinder.arch';

export interface IslandProgress {
  best: number;
  stars: number;
}

interface ArchState {
  seed: number;
  at: [number, number];
  /** seed → island id → progress. */
  islands: Record<string, Record<string, IslandProgress>>;
}

function read(): ArchState | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return v && typeof v.seed === 'number' && Array.isArray(v.at) && v.islands ? v : null;
  } catch {
    return null;
  }
}

function write(s: ArchState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // storage blocked: progress lasts for this visit only
  }
}

let memory: ArchState | null = null;
const state = (): ArchState => (memory ??= read() ?? { seed: -1, at: [0, 0], islands: {} });

const pkey = (ix: number, iz: number) => islandId(ix, iz);

/** Where the player was: archipelago seed and island, or null on a first visit. */
export function archPosition(): { seed: number; at: [number, number] } | null {
  const s = state();
  return s.seed >= 0 ? { seed: s.seed, at: [...s.at] } : null;
}

export function setArchPosition(seed: number, at: [number, number]): void {
  const s = state();
  s.seed = seed;
  s.at = [...at];
  write(s);
}

export function islandProgress(seed: number, ix: number, iz: number): IslandProgress {
  return state().islands[String(seed)]?.[pkey(ix, iz)] ?? { best: 0, stars: 0 };
}

/** Records a finished run; returns true for a new best. Stars never go down. */
export function recordIsland(seed: number, ix: number, iz: number, nodes: number, stars: number): boolean {
  const s = state();
  const bySeed = (s.islands[String(seed)] ??= {});
  const k = pkey(ix, iz);
  const old = bySeed[k] ?? { best: 0, stars: 0 };
  const better = nodes > old.best;
  bySeed[k] = { best: Math.max(old.best, nodes), stars: Math.max(old.stars, stars) };
  write(s);
  return better;
}

/** How many islands of an archipelago have ★ (for the Levels dialog). */
export function starredCount(seed: number): number {
  return Object.values(state().islands[String(seed)] ?? {}).filter((p) => p.stars > 0).length;
}

/** Test hook: forget the in-memory copy. */
export function resetArchProgressCache(): void {
  memory = null;
}
