import * as THREE from 'three';
import type { Stage } from '../render/scene';
import { Mat } from '../world/materials';
import { inBounds, SX, SY, SZ, type World } from '../world/world';
import type { EditHistory } from './history';
import { pickVoxel, type Hit } from './pick';

export type Tool = 'place' | 'remove';

/** Largest fill box, so a stray drag can't freeze the frame. */
const MAX_FILL = 24_000;
/** A press that moves less than this (px) and is shorter than CLICK_MS counts as a click, not an orbit. */
const CLICK_PX = 6;
const CLICK_MS = 450;

interface Press {
  x: number;
  y: number;
  time: number;
  remove: boolean;
  fillFrom: THREE.Vector3 | null;
}

/**
 * Mouse + trackpad editing.
 *   click            place (or remove, with the remove tool)
 *   right / 2-finger remove   (ctrl-click too)
 *   shift + drag     box fill / clear
 *   alt-click or F   focus the camera on the hovered point
 *   drag             orbit (OrbitControls)
 */
export class Editor {
  tool: Tool = 'place';
  material: Mat = Mat.Grass;
  enabled = true;
  /** Called after any change to the world. */
  onEdit: () => void = () => {};
  /** Called when tool or material changes from the keyboard. */
  onToolChange: () => void = () => {};

  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private pointerInside = false;
  private hover: Hit | null = null;
  private press: Press | null = null;
  private fillTo = new THREE.Vector3();
  private focusGoal: THREE.Vector3 | null = null;
  private shiftHeld = false;

  private outline: THREE.LineSegments;
  private ghost: THREE.Mesh;
  private ghostMat: THREE.MeshBasicMaterial;
  private box: THREE.Mesh;
  private boxEdges: THREE.LineSegments;

  constructor(
    private stage: Stage,
    private world: World,
    private history: EditHistory,
    private colorOf: (m: Mat) => number,
  ) {
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.03, 1.03, 1.03));
    this.outline = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x3b3355, transparent: true, opacity: 0.55 }));
    this.ghostMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.45, depthWrite: false });
    this.ghost = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.ghostMat);
    this.box = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.25, depthWrite: false }),
    );
    this.boxEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ color: 0x3b3355 }),
    );
    for (const o of [this.outline, this.ghost, this.box, this.boxEdges]) {
      o.visible = false;
      o.renderOrder = 2;
      stage.island.add(o);
    }

    const el = stage.renderer.domElement;
    el.style.cursor = 'crosshair';
    el.addEventListener('pointermove', this.onMove);
    // Capture phase: runs before OrbitControls' own pointerdown, so a shift-press can claim the drag.
    el.addEventListener('pointerdown', this.onDown, { capture: true });
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointerleave', () => {
      this.pointerInside = false;
      this.hover = null;
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', (e) => {
      if (e.key === 'Shift') this.setShift(false);
    });
    window.addEventListener('blur', () => this.setShift(false));
  }

  setTool(t: Tool): void {
    this.tool = t;
    this.onToolChange();
  }

  setMaterial(m: Mat): void {
    this.material = m;
    this.tool = 'place';
    this.onToolChange();
  }

  undo(): void {
    if (this.history.undo(this.world)) this.onEdit();
  }

  redo(): void {
    if (this.history.redo(this.world)) this.onEdit();
  }

  /** Per frame: re-pick (the camera may have moved), update previews, ease the focus. */
  update(dt: number): void {
    if (this.pointerInside) this.pick();
    this.updatePreview();
    if (this.focusGoal) {
      const c = this.stage.controls;
      const k = 1 - Math.exp(-dt * 10);
      const delta = this.focusGoal.clone().sub(c.target).multiplyScalar(k);
      c.target.add(delta);
      this.stage.camera.position.add(delta);
      if (c.target.distanceTo(this.focusGoal) < 0.02) this.focusGoal = null;
    }
  }

  // ---------------------------------------------------------------- input

  private onMove = (e: PointerEvent): void => {
    const r = this.stage.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.pointerInside = true;
    this.pick();
    if (this.press?.fillFrom) this.dragFill(this.press.fillFrom, e.altKey);
  };

  private onDown = (e: PointerEvent): void => {
    if (!this.enabled || e.button === 1) return;
    const remove = e.button === 2 || e.ctrlKey || this.tool === 'remove';
    this.onMove(e);
    let fillFrom: THREE.Vector3 | null = null;
    if (e.shiftKey) {
      fillFrom = this.targetCell(remove);
      if (fillFrom) {
        this.stage.controls.enabled = false;
        this.fillTo.copy(fillFrom);
      }
    }
    this.press = { x: e.clientX, y: e.clientY, time: performance.now(), remove, fillFrom };
    if (fillFrom) {
      try {
        this.stage.renderer.domElement.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic or already-released pointer: the fill still works without capture */
      }
    }
  };

  private onUp = (e: PointerEvent): void => {
    const p = this.press;
    this.press = null;
    if (!this.shiftHeld) this.stage.controls.enabled = true; // never leave the camera locked
    if (!p || !this.enabled) return;
    if (p.fillFrom) {
      this.fill(p.fillFrom, this.fillTo, p.remove);
      return;
    }
    const moved = Math.hypot(e.clientX - p.x, e.clientY - p.y);
    if (moved > CLICK_PX || performance.now() - p.time > CLICK_MS) return; // it was an orbit drag
    if (e.altKey) return this.focusHovered();
    const cell = this.targetCell(p.remove);
    if (!cell) return;
    const m = p.remove ? Mat.Air : this.material;
    if (this.history.edit(this.world, (set) => set(cell.x, cell.y, cell.z, m))) this.onEdit();
  };

  private onKey = (e: KeyboardEvent): void => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      this.redo();
      return;
    }
    if (mod) return;
    if (e.key === 'Shift') return this.setShift(true);
    const k = e.key.toLowerCase();
    if (k === 'e') this.setTool('place');
    else if (k === 'r') this.setTool('remove');
    else if (k === 'f') this.focusHovered();
    else if (k >= '1' && k <= '5') this.setMaterial(HOTBAR_MATS[Number(k) - 1]);
  };

  /** While Shift is held the drag belongs to the fill tool, not the camera. */
  private setShift(on: boolean): void {
    this.shiftHeld = on;
    this.stage.controls.enabled = !on;
  }

  // ---------------------------------------------------------------- helpers

  private pick(): void {
    this.raycaster.setFromCamera(this.ndc, this.stage.camera);
    const o = this.raycaster.ray.origin.clone().sub(this.stage.island.position);
    const d = this.raycaster.ray.direction;
    this.hover = pickVoxel(this.world, o.x, o.y, o.z, d.x, d.y, d.z);
  }

  /** The cell an edit would touch: the hit voxel (remove) or the empty cell in front of it (place). */
  private targetCell(remove: boolean): THREE.Vector3 | null {
    const h = this.hover;
    if (!h) return null;
    if (remove) return new THREE.Vector3(h.x, h.y, h.z);
    if (h.nx === 0 && h.ny === 0 && h.nz === 0) return null;
    const c = new THREE.Vector3(h.x + h.nx, h.y + h.ny, h.z + h.nz);
    return inBounds(c.x, c.y, c.z) ? c : null;
  }

  /**
   * The far corner of a fill comes from a plane through the start cell, not from
   * whatever surface is under the cursor: flat on that layer by default, a wall
   * facing the camera with Alt held.
   */
  private dragFill(from: THREE.Vector3, wall: boolean): void {
    const ray = this.raycaster.ray.clone();
    ray.origin.sub(this.stage.island.position);
    const center = from.clone().addScalar(0.5);
    let normal = new THREE.Vector3(0, 1, 0);
    if (wall) {
      const d = ray.direction;
      normal = Math.abs(d.x) > Math.abs(d.z) ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
    }
    const hit = ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(normal, center), new THREE.Vector3());
    if (!hit) return;
    hit.floor();
    if (!wall) hit.y = from.y;
    else if (normal.x) hit.x = from.x;
    else hit.z = from.z;
    hit.clamp(new THREE.Vector3(0, 0, 0), new THREE.Vector3(SX - 1, SY - 1, SZ - 1));
    this.fillTo.copy(hit);
  }

  private fill(a: THREE.Vector3, b: THREE.Vector3, remove: boolean): void {
    const min = a.clone().min(b), max = a.clone().max(b);
    const size = max.clone().sub(min).addScalar(1);
    if (size.x * size.y * size.z > MAX_FILL) return;
    const m = remove ? Mat.Air : this.material;
    const n = this.history.edit(this.world, (set) => {
      for (let y = min.y; y <= max.y; y++)
        for (let z = min.z; z <= max.z; z++) for (let x = min.x; x <= max.x; x++) set(x, y, z, m);
    });
    if (n) this.onEdit();
  }

  private focusHovered(): void {
    const h = this.hover;
    if (!h) return;
    this.focusGoal = new THREE.Vector3(h.x + 0.5, h.y + 1, h.z + 0.5).add(this.stage.island.position);
  }

  private updatePreview(): void {
    const fill = this.press?.fillFrom;
    this.box.visible = this.boxEdges.visible = !!fill;
    if (fill) {
      const min = fill.clone().min(this.fillTo), max = fill.clone().max(this.fillTo);
      const size = max.clone().sub(min).addScalar(1);
      const center = min.clone().add(max).addScalar(1).multiplyScalar(0.5);
      const tooBig = size.x * size.y * size.z > MAX_FILL;
      this.box.scale.copy(size).addScalar(0.04);
      this.box.position.copy(center);
      this.boxEdges.scale.copy(this.box.scale);
      this.boxEdges.position.copy(center);
      const mat = this.box.material as THREE.MeshBasicMaterial;
      mat.color.setHex(tooBig ? 0xff5c5c : this.press!.remove ? 0xff8a8a : this.colorOf(this.material));
      this.outline.visible = this.ghost.visible = false;
      return;
    }

    const remove = this.tool === 'remove';
    const h = this.hover;
    this.outline.visible = !!h && this.enabled;
    if (h) {
      this.outline.position.set(h.x + 0.5, h.y + 0.5, h.z + 0.5);
      (this.outline.material as THREE.LineBasicMaterial).color.setHex(remove ? 0xe0475a : 0x3b3355);
    }
    const cell = !remove && this.enabled ? this.targetCell(false) : null;
    this.ghost.visible = !!cell;
    if (cell) {
      this.ghost.position.set(cell.x + 0.5, cell.y + 0.5, cell.z + 0.5);
      this.ghostMat.color.setHex(this.colorOf(this.material));
    }
  }
}

/** Materials the player can place, in hotbar order (keys 1–5). */
export const HOTBAR_MATS: Mat[] = [Mat.Grass, Mat.Soil, Mat.Stone, Mat.Crystal, Mat.Water];
