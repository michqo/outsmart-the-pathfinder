import * as THREE from 'three';
import type { Vec3i } from '../path/protocol';

const MAX_PARTICLES = 384;

interface Particle {
  p: THREE.Vector3;
  v: THREE.Vector3;
  life: number;
  max: number;
  size: number;
  /** Tumble: a spin axis and speed (radians per second). */
  axis: THREE.Vector3;
  spin: number;
}

interface Task {
  t: number;
  dur: number;
  tick(k: number): void;
  done(): void;
  /** Removes the visuals without finishing (the work was interrupted). */
  cancel(): void;
}

/**
 * Small, cheap juice: tumbling debris, a shaking "drill" overlay on a block being dug, a
 * springy pop for the bot's blocks, and a settle / crumble for every block the player
 * places or removes. Everything is in island (voxel) coordinates.
 */
export class Effects {
  readonly group = new THREE.Group();
  private particles: Particle[] = [];
  private mesh: THREE.InstancedMesh;
  private tasks: Task[] = [];
  private m = new THREE.Matrix4();
  private s = new THREE.Vector3();
  private c = new THREE.Color();
  private flashGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
  private unitBox = new THREE.BoxGeometry(1, 1, 1);
  private spinQ = new THREE.Quaternion();

  constructor() {
    this.mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ roughness: 0.8 }),
      MAX_PARTICLES,
    );
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    for (let i = 0; i < MAX_PARTICLES; i++) this.mesh.setColorAt(i, this.c.set(0xffffff));
    this.group.add(this.mesh);
  }

  /** Bits of block flying out. */
  burst(center: THREE.Vector3, color: number, n = 14, speed = 3): void {
    for (let i = 0; i < n && this.particles.length < MAX_PARTICLES; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9 + 0.3, Math.random() - 0.5)
        .normalize()
        .multiplyScalar(speed * (0.5 + Math.random() * 0.7));
      const max = 0.5 + Math.random() * 0.35;
      this.particles.push({
        p: center.clone().add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.6)),
        v,
        life: max,
        max,
        size: 0.08 + Math.random() * 0.12,
        axis: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(),
        spin: 4 + Math.random() * 10,
      });
      this.mesh.setColorAt(this.particles.length - 1, this.c.setHex(color).offsetHSL(0, 0, (Math.random() - 0.5) * 0.12));
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** A block being drilled: a flickering, shaking shell plus sparks. Calls `done` at the end. */
  drill(cell: Vec3i, color: number, seconds: number, done: () => void, onCancel: () => void = () => {}): void {
    const shell = new THREE.Mesh(
      new THREE.BoxGeometry(1.06, 1.06, 1.06),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, depthWrite: false }),
    );
    const base = new THREE.Vector3(cell[0] + 0.5, cell[1] + 0.5, cell[2] + 0.5);
    shell.position.copy(base);
    this.group.add(shell);
    let spark = 0;
    this.tasks.push({
      t: 0,
      dur: seconds,
      tick: (k) => {
        shell.position.set(base.x + (Math.random() - 0.5) * 0.06, base.y + (Math.random() - 0.5) * 0.06, base.z + (Math.random() - 0.5) * 0.06);
        (shell.material as THREE.MeshBasicMaterial).opacity = 0.18 + 0.25 * Math.abs(Math.sin(k * 40));
        if (k * seconds > spark) {
          spark += 0.07;
          this.burst(base, Math.random() < 0.5 ? 0xfff2b0 : color, 2, 2.2);
        }
      },
      done: () => {
        this.group.remove(shell);
        shell.geometry.dispose();
        done();
        this.crumble(cell, color);
      },
      cancel: () => {
        this.group.remove(shell);
        shell.geometry.dispose();
        onCancel();
      },
    });
  }

  /** A block popping into place with a little overshoot. Calls `done` when it has landed. */
  pop(cell: Vec3i, color: number, seconds: number, done: () => void, onCancel: () => void = () => {}): void {
    const cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color, roughness: 0.7 }));
    cube.position.set(cell[0] + 0.5, cell[1] + 0.5, cell[2] + 0.5);
    cube.scale.setScalar(0.01);
    this.group.add(cube);
    this.tasks.push({
      t: 0,
      dur: seconds,
      tick: (k) => {
        const c1 = 2.2, c3 = c1 + 1; // easeOutBack
        const e = 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
        cube.scale.setScalar(Math.max(0.01, e));
      },
      done: () => {
        this.group.remove(cube);
        cube.geometry.dispose();
        (cube.material as THREE.Material).dispose();
        this.burst(cube.position.clone().add(new THREE.Vector3(0, -0.4, 0)), 0xffffff, 6, 1.5);
        done();
      },
      cancel: () => {
        this.group.remove(cube);
        cube.geometry.dispose();
        (cube.material as THREE.Material).dispose();
        onCancel();
      },
    });
  }

  /**
   * A block that just landed in the world settles in: a slightly larger copy squashes down
   * onto it and springs back, with a puff of dust at its foot. Purely visual (the voxel is
   * already there underneath).
   */
  settle(cell: Vec3i, color: number, seconds = 0.22): void {
    const cube = this.cube(color);
    const x = cell[0] + 0.5, z = cell[2] + 0.5;
    this.group.add(cube);
    const step = (k: number) => {
      // Drops in squashed and wide, then a damped wobble back to its true size (anchored at the base).
      const w = Math.exp(-5 * k) * Math.cos(k * 11);
      const sy = 1.02 - 0.3 * w, sxz = 1.02 + 0.18 * w;
      cube.scale.set(sxz, sy, sxz);
      cube.position.set(x, cell[1] + sy / 2 - 0.01 + (1 - k) * (1 - k) * 0.35, z);
    };
    step(0);
    this.tasks.push({
      t: 0,
      dur: seconds,
      tick: step,
      done: () => this.drop(cube),
      cancel: () => this.drop(cube),
    });
    this.burst(new THREE.Vector3(x, cell[1] + 0.05, z), 0xf4efe6, 5, 1.2);
  }

  /** A block that just left the world shrinks away, tumbling, and breaks into chunky bits. */
  crumble(cell: Vec3i, color: number, seconds = 0.18): void {
    const cube = this.cube(color);
    const base = new THREE.Vector3(cell[0] + 0.5, cell[1] + 0.5, cell[2] + 0.5);
    cube.position.copy(base);
    this.group.add(cube);
    const axis = new THREE.Vector3(Math.random() - 0.5, 0.4, Math.random() - 0.5).normalize();
    this.tasks.push({
      t: 0,
      dur: seconds,
      tick: (k) => {
        cube.scale.setScalar(Math.max(0.01, 1 - k * k));
        cube.quaternion.setFromAxisAngle(axis, k * 0.9);
      },
      done: () => this.drop(cube),
      cancel: () => this.drop(cube),
    });
    this.burst(base, color, 14, 3);
  }

  private cube(color: number): THREE.Mesh {
    const cube = new THREE.Mesh(this.unitBox, new THREE.MeshStandardMaterial({ color, roughness: 0.9 }));
    cube.castShadow = true;
    return cube;
  }

  private drop(cube: THREE.Mesh): void {
    this.group.remove(cube);
    (cube.material as THREE.Material).dispose();
  }

  /** Stops every drill / pop in progress without applying it. */
  cancelAll(): void {
    const tasks = this.tasks;
    this.tasks = [];
    for (const t of tasks) t.cancel();
  }

  /** "This edit mattered": a red cage on a cell that pulses and fades. */
  flash(cell: Vec3i, seconds = 1.4): void {
    const box = new THREE.LineSegments(this.flashGeo, new THREE.LineBasicMaterial({ color: 0xff3b5c, transparent: true, depthTest: false }));
    box.position.set(cell[0] + 0.5, cell[1] + 0.5, cell[2] + 0.5);
    box.renderOrder = 5;
    this.group.add(box);
    const mat = box.material as THREE.LineBasicMaterial;
    this.tasks.push({
      t: 0,
      dur: seconds,
      tick: (k) => {
        box.scale.setScalar(1.04 + 0.12 * Math.abs(Math.sin(k * Math.PI * 4)));
        mat.opacity = 1 - k * k;
      },
      done: () => {
        this.group.remove(box);
        mat.dispose();
      },
      cancel: () => {
        this.group.remove(box);
        mat.dispose();
      },
    });
  }

  update(dt: number): void {
    for (let i = this.tasks.length - 1; i >= 0; i--) {
      const task = this.tasks[i];
      task.t += dt;
      const k = Math.min(1, task.t / task.dur);
      task.tick(k);
      if (k >= 1) {
        this.tasks.splice(i, 1);
        task.done();
      }
    }

    let n = 0;
    const ps = this.particles;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      p.v.y -= 9 * dt;
      p.p.addScaledVector(p.v, dt);
      this.spinQ.setFromAxisAngle(p.axis, (p.max - p.life) * p.spin);
      if (n !== i) {
        ps[n] = p;
        this.mesh.getColorAt(i, this.c);
        this.mesh.setColorAt(n, this.c);
      }
      const k = p.life / p.max;
      this.s.setScalar(p.size * Math.min(1, k * 2.5));
      this.m.compose(p.p, this.spinQ, this.s);
      this.mesh.setMatrixAt(n, this.m);
      n++;
    }
    ps.length = n;
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
