import * as THREE from 'three';
import { canStand } from '../path/moves';
import type { Vec3i } from '../path/protocol';
import type { Stage } from '../render/scene';
import { SY, type World } from '../world/world';
import { pickVoxel } from './pick';

export interface Handle {
  object: THREE.Object3D;
  /** Return false to refuse the move (the handle snaps back). */
  onDrop(cell: Vec3i): boolean;
  /** Where the handle currently is, to snap back to. */
  cell(): Vec3i;
}

/** The first spot in a column, at or above `y`, where the bot can stand. */
export function standableAbove(world: World, x: number, y: number, z: number): Vec3i | null {
  for (let yy = Math.max(1, y); yy < SY - 1; yy++) if (canStand(world, x, yy, z)) return [x, yy, z];
  return null;
}

/**
 * Drag the robot and the goal around. Must be created BEFORE the Editor: its
 * capture-phase pointerdown runs first and swallows the event when it grabs a handle.
 */
export class Handles {
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private dragging: Handle | null = null;
  private candidate: Vec3i | null = null;

  constructor(
    private stage: Stage,
    private world: World,
    private handles: Handle[],
  ) {
    const el = stage.renderer.domElement;
    el.addEventListener('pointerdown', this.onDown, { capture: true });
    el.addEventListener('pointermove', this.onHover);
    window.addEventListener('pointermove', this.onDrag);
    window.addEventListener('pointerup', this.onUp);
  }

  get active(): boolean {
    return this.dragging !== null;
  }

  private setNdc(e: PointerEvent): void {
    const r = this.stage.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.stage.camera);
  }

  private handleUnder(e: PointerEvent): Handle | null {
    this.setNdc(e);
    let best: Handle | null = null, bestD = Infinity;
    for (const h of this.handles) {
      const hit = this.raycaster.intersectObject(h.object, true)[0];
      if (hit && hit.distance < bestD) (best = h), (bestD = hit.distance);
    }
    return best;
  }

  private onHover = (e: PointerEvent): void => {
    if (this.dragging) return;
    this.stage.renderer.domElement.style.cursor = this.handleUnder(e) ? 'grab' : 'crosshair';
  };

  private onDown = (e: PointerEvent): void => {
    if (e.button !== 0 || e.shiftKey) return;
    const h = this.handleUnder(e);
    if (!h) return;
    e.stopImmediatePropagation(); // keep the editor and the orbit camera out of it
    e.preventDefault();
    this.dragging = h;
    this.candidate = null;
    this.stage.controls.enabled = false;
    this.stage.renderer.domElement.style.cursor = 'grabbing';
  };

  private onDrag = (e: PointerEvent): void => {
    const h = this.dragging;
    if (!h) return;
    this.setNdc(e);
    const o = this.raycaster.ray.origin.clone().sub(this.stage.island.position);
    const d = this.raycaster.ray.direction;
    const hit = pickVoxel(this.world, o.x, o.y, o.z, d.x, d.y, d.z);
    if (!hit) return;
    const cell = standableAbove(this.world, hit.x, hit.y + 1, hit.z);
    if (!cell) return;
    this.candidate = cell;
    h.object.position.set(cell[0] + 0.5, cell[1], cell[2] + 0.5);
  };

  private onUp = (): void => {
    const h = this.dragging;
    if (!h) return;
    this.dragging = null;
    this.stage.controls.enabled = true;
    this.stage.renderer.domElement.style.cursor = 'grab';
    const ok = this.candidate ? h.onDrop(this.candidate) : false;
    if (!ok) {
      const c = h.cell();
      h.object.position.set(c[0] + 0.5, c[1], c[2] + 0.5);
    }
  };
}
