import { topStand } from '../levels/spawn';
import { AStar, type PathResult } from '../path/astar';
import { MoveKind } from '../path/moves';
import type { Vec3i } from '../path/protocol';
import { Mat } from '../world/materials';
import { rng } from '../world/noise';
import { World } from '../world/world';

/**
 * Search-aware tuning: turn a generated island into a challenge.
 *
 * 1. Route: try start/flag pairs and keep the one whose untouched search is most
 *    interesting (nodes per step, detour, and the special moves it needs).
 * 2. Rules from the tier: edit budget and blocks.
 * 3. Stars: a greedy hill-climb plays the island with the budget; what it reaches is ★★★
 *    (so ★★★ is always achievable), ★★ and ★ are 80% and 50% of that.
 *
 * Deterministic: a fixed amount of work (not a time box), so every device gets the same
 * stars. Bump TUNE_VERSION when the result changes.
 */
export const TUNE_VERSION = 1;

export interface TierRules {
  budget: number;
  blocks: number;
  /** Start/flag distance as fractions of the island's span. */
  reach: [number, number];
  /**
   * Most nodes the untouched route may take: the score should be the player's doing, and
   * it keeps the hill-climb's searches (and so the survey) quick.
   */
  maxUntouched: number;
  /** Hill-climb searches: a fixed amount of work, so every device gets the same stars. */
  evals: number;
}

/** Tiers 1–5 (index 0 = tier 1). */
export const TIERS: readonly TierRules[] = [
  { budget: 12, blocks: 0, reach: [0.3, 0.55], maxUntouched: 600, evals: 120 },
  { budget: 20, blocks: 4, reach: [0.4, 0.65], maxUntouched: 1500, evals: 180 },
  { budget: 30, blocks: 6, reach: [0.45, 0.75], maxUntouched: 3000, evals: 240 },
  { budget: 40, blocks: 8, reach: [0.5, 0.85], maxUntouched: 3500, evals: 300 },
  { budget: 60, blocks: 12, reach: [0.55, 0.95], maxUntouched: 5000, evals: 360 },
];

export interface Tuning {
  version: number;
  tier: number;
  start: Vec3i;
  goal: Vec3i;
  budget: number;
  blocks: number;
  stars: [number, number, number];
  /** Nodes the untouched island takes, and what the hill-climb reached. */
  untouched: number;
  climbed: number;
  /** The hill-climb's edits, flat [x, y, z, material, ...]: replaying them reaches ★★★. */
  proof: number[];
}

/** Searches give up past this many expansions (keeps every step bounded). */
const SEARCH_CAP = 120_000;
const ROUTE_TRIES = 40;

export function tuneIsland(world: World, tier: number, key: number, onProgress?: (f: number) => void): Tuning {
  const rules = TIERS[Math.max(1, Math.min(TIERS.length, tier)) - 1];
  const rand = rng((key * 31 + tier) >>> 0);
  const routes = pickRoutes(world, rules, rand);
  onProgress?.(0.1);
  // The best-scoring route whose climb leaves room for three distinct stars.
  let route = routes[0], climbed = route.expanded, proof: number[] = [];
  for (let k = 0; k < routes.length; k++) {
    const share = (f: number) => onProgress?.(0.1 + ((k + f) / routes.length) * 0.9);
    const c = climb(world, routes[k].start, routes[k].goal, rules, rand, routes[k].expanded, share);
    if (k === 0 || c.climbed - routes[k].expanded > climbed - route.expanded) (route = routes[k]), (climbed = c.climbed), (proof = c.edits);
    if (climbed - route.expanded >= minGain(route.expanded)) break;
  }
  onProgress?.(1);
  return {
    version: TUNE_VERSION,
    tier,
    start: route.start,
    goal: route.goal,
    budget: rules.budget,
    blocks: rules.blocks,
    stars: starTargets(route.expanded, climbed),
    untouched: route.expanded,
    climbed,
    proof,
  };
}

/** Enough headroom over the untouched search for three distinct, meaningful stars. */
const minGain = (untouched: number) => Math.max(12, Math.ceil(untouched * 0.25));

/**
 * Stars on what the player adds: ★ at 35% and ★★ at 70% of the hill-climb's gain, ★★★ at
 * its result (so always reachable). Rounded down to 2 significant digits where that keeps
 * them in order.
 */
export function starTargets(untouched: number, climbed: number): [number, number, number] {
  const gain = Math.max(3, climbed - untouched);
  const nice = (n: number, above: number) => {
    let p = 1;
    while (n >= p * 100) p *= 10;
    const r = Math.floor(n / p) * p;
    return r > above ? r : n;
  };
  const one = nice(untouched + Math.max(1, Math.floor(gain * 0.35)), untouched);
  const two = nice(untouched + Math.max(2, Math.floor(gain * 0.7)), one);
  const three = nice(untouched + gain, two);
  return [one, two, three];
}

/** Bounded A*: null when there's no path or it would cost too much to find. */
export function solve(world: World, start: Vec3i, goal: Vec3i, blocks: number): { path: PathResult; expanded: number } | null {
  const a = new AStar(world, start, goal, 1, blocks);
  while (a.step(4096) === 'running') if (a.expanded > SEARCH_CAP) return null;
  const path = a.path();
  return path ? { path, expanded: a.expanded } : null;
}

interface Route {
  start: Vec3i;
  goal: Vec3i;
  expanded: number;
}

/** Standable surface cells away from the rim. */
function surfaceCells(world: World): Vec3i[] {
  const out: Vec3i[] = [];
  for (let z = 3; z < world.sz - 3; z++)
    for (let x = 3; x < world.sx - 3; x++) {
      const c = topStand(world, x, z);
      if (!c) continue;
      const rim = [-2, 2].some((s) => !topStand(world, x + s, z) || !topStand(world, x, z + s));
      if (!rim) out.push(c);
    }
  return out;
}

/** The most interesting start/flag pairs, best first (up to 3). */
function pickRoutes(world: World, rules: TierRules, rand: () => number): Route[] {
  const cells = surfaceCells(world);
  if (cells.length < 2) throw new Error('island too small to tune');
  const span = Math.sqrt(cells.length) * 1.13;
  const [lo, hi] = [rules.reach[0] * span, rules.reach[1] * span];
  const scored: { route: Route; score: number }[] = [];
  let fallback: Route | null = null;
  for (let t = 0; t < ROUTE_TRIES * 4 && (t < ROUTE_TRIES || !scored.length); t++) {
    const s = cells[Math.floor(rand() * cells.length)];
    const g = cells[Math.floor(rand() * cells.length)];
    const dx = g[0] - s[0], dz = g[2] - s[2];
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < lo || d > hi) continue;
    const r = solve(world, s, g, rules.blocks);
    if (!r) continue;
    const steps = r.path.nodes.length - 1;
    const dy = g[1] - s[1];
    const straight = Math.sqrt(dx * dx + dz * dz + dy * dy);
    const special = new Set(Array.from(r.path.kinds).filter((k) => k >= MoveKind.Swim)).size;
    // Deception (nodes per step) and detour make the bot think; special moves make it
    // interesting. Only × and ÷, so every browser ranks the pairs the same way.
    const score = (r.expanded / Math.max(1, steps)) * Math.min(2, r.path.cost / Math.max(1, straight)) * (1 + special * 0.3);
    const route = { start: s, goal: g, expanded: r.expanded };
    if (!fallback || r.expanded < fallback.expanded) fallback = route;
    if (r.expanded <= rules.maxUntouched) scored.push({ route, score });
  }
  // Stable order: by score, then by when it was found.
  const best = scored.map((x, i) => ({ ...x, i })).sort((a, b) => b.score - a.score || a.i - b.i).slice(0, 3);
  if (best.length) return best.map((x) => x.route);
  if (!fallback) throw new Error('no solvable start/flag pair');
  return [fallback];
}

/** Places that matter: cells around the current route. */
function nearRoute(path: PathResult, world: World, rand: () => number): [number, number] {
  const id = path.nodes[1 + Math.floor(rand() * Math.max(1, path.nodes.length - 2))];
  const [x, , z] = world.coords(id);
  return [x + Math.floor(rand() * 7) - 3, z + Math.floor(rand() * 7) - 3];
}

/**
 * Greedy hill-climb, like a determined (not clever) player: each round, try random 1–2
 * block placements near the bot's route and keep the one that adds the most nodes per
 * block while the bot can still reach the flag. Works on a copy of the island.
 */
function climb(
  island: World, start: Vec3i, goal: Vec3i, rules: TierRules, rand: () => number, untouched: number,
  onProgress: (f: number) => void,
): { climbed: number; edits: number[] } {
  const w = new World(island.sx, island.sy, island.sz);
  w.data.set(island.data);
  let best = untouched;
  let route = solve(w, start, goal, rules.blocks)!.path;
  const mats = [Mat.Soil, Mat.Stone, Mat.Crystal, Mat.Water];
  const triesPerRound = 12;
  const edits: number[] = [];
  let used = 0, evals = 0;
  const skip = (x: number, z: number) => (x === start[0] && z === start[2]) || (x === goal[0] && z === goal[2]);
  while (used < rules.budget && evals < rules.evals) {
    let pick: [number, number, number, number, number] | null = null;
    let bestGain = 0;
    for (let t = 0; t < triesPerRound && evals < rules.evals; t++) {
      const [x, z] = nearRoute(route, w, rand);
      if (!w.contains(x, 1, z) || skip(x, z)) continue;
      let y = w.sy - 2;
      while (y > 1 && w.get(x, y - 1, z) === Mat.Air) y--;
      if (y <= 1 || w.get(x, y, z) !== Mat.Air) continue;
      const m = mats[Math.floor(rand() * mats.length)];
      const h = m === Mat.Water ? 1 : Math.min(1 + Math.floor(rand() * 2), rules.budget - used);
      if (y + h >= w.sy - 1) continue;
      for (let k = 0; k < h; k++) w.data[w.index(x, y + k, z)] = m;
      evals++;
      const r = solve(w, start, goal, rules.blocks);
      for (let k = 0; k < h; k++) w.data[w.index(x, y + k, z)] = Mat.Air;
      const gain = r ? (r.expanded - best) / h : 0;
      if (r && gain > bestGain) (bestGain = gain), (pick = [x, y, z, m, h]);
    }
    onProgress(Math.min(1, evals / rules.evals));
    if (!pick) {
      used++;
      continue;
    }
    const [x, y, z, m, h] = pick;
    for (let k = 0; k < h; k++) {
      w.data[w.index(x, y + k, z)] = m;
      edits.push(x, y + k, z, m);
    }
    const r = solve(w, start, goal, rules.blocks)!;
    best = r.expanded;
    route = r.path;
    used += h;
  }
  return { climbed: best, edits };
}
