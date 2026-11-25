/** Best scores per level and the last level played, kept in localStorage. */

const BEST_KEY = 'pathfinder.best';
const LAST_KEY = 'pathfinder.level';

function read(): Record<string, number> {
  try {
    const v = JSON.parse(localStorage.getItem(BEST_KEY) ?? '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

export function bestScores(): Record<string, number> {
  return read();
}

export function bestFor(id: string): number {
  return read()[id] ?? 0;
}

/** Records a score; returns true when it's a new best. */
export function recordScore(id: string, nodes: number): boolean {
  const all = read();
  if (nodes <= (all[id] ?? 0)) return false;
  all[id] = nodes;
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify(all));
  } catch {
    // storage blocked: the best just doesn't persist
  }
  return true;
}

export function lastLevel(): string | null {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}

export function setLastLevel(id: string): void {
  try {
    localStorage.setItem(LAST_KEY, id);
  } catch {
    // ignore
  }
}
