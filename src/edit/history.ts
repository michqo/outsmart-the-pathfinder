import type { Mat } from '../world/materials';
import type { World } from '../world/world';

/** One user action: flat triples of [voxelIndex, before, after]. */
type Action = number[];

/** Undo/redo over voxel edits. All user edits should go through `edit()`. */
export class EditHistory {
  private undoStack: Action[] = [];
  private redoStack: Action[] = [];
  /** Voxel indices changed by the most recent edit / undo / redo. */
  lastCells: number[] = [];
  /** The material the most recent edit replaced in its first cell (for sounds). */
  lastBefore = 0;
  constructor(private limit = 200) {}

  /** Runs `fn` as one undoable action. Returns how many voxels changed. */
  edit(world: World, fn: (set: (x: number, y: number, z: number, m: Mat) => void) => void): number {
    const action: Action = [];
    fn((x, y, z, m) => {
      const before = world.get(x, y, z);
      if (before === m) return;
      world.set(x, y, z, m);
      if (world.get(x, y, z) === m) action.push(world.index(x, y, z), before, m);
    });
    this.lastCells = cellsOf(action);
    this.lastBefore = action.length ? action[1] : 0;
    if (action.length) {
      this.undoStack.push(action);
      if (this.undoStack.length > this.limit) this.undoStack.shift();
      this.redoStack.length = 0;
    }
    return action.length / 3;
  }

  undo(world: World): boolean {
    const a = this.undoStack.pop();
    if (!a) return false;
    for (let i = a.length - 3; i >= 0; i -= 3) apply(world, a[i], a[i + 1]);
    this.lastCells = cellsOf(a);
    this.redoStack.push(a);
    return true;
  }

  redo(world: World): boolean {
    const a = this.redoStack.pop();
    if (!a) return false;
    for (let i = 0; i < a.length; i += 3) apply(world, a[i], a[i + 2]);
    this.lastCells = cellsOf(a);
    this.undoStack.push(a);
    return true;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }
}

function cellsOf(a: Action): number[] {
  const out: number[] = [];
  for (let i = 0; i < a.length; i += 3) out.push(a[i]);
  return out;
}

function apply(world: World, index: number, m: number): void {
  const [x, y, z] = world.coords(index);
  world.set(x, y, z, m as Mat);
}
