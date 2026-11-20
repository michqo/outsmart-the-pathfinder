import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const BOT_MODELS = { Capsule: 'capsule', Boxy: 'boxy', Bulb: 'bulb' } as const;
export type BotModel = (typeof BOT_MODELS)[keyof typeof BOT_MODELS];

export type Mood = 'idle' | 'thinking' | 'walking' | 'happy' | 'confused';

const CREAM = 0xfaf4ec;
const CORAL = 0xff8f78;
const INK = 0x2d2742;

/**
 * The robot. Earnest and a bit clumsy:
 *  - squints and glances around while the search runs
 *  - bobs and swings its legs while walking, squashes on landing
 *  - wobbles after a long drop, hops for joy at the goal, tilts its head when stuck
 * Local +Z is "forward"; the root sits at the bot's feet.
 */
export class BotView {
  readonly root = new THREE.Group();
  mood: Mood = 'idle';
  /** Walk cycle phase, advanced by the walker. */
  walkPhase = 0;

  private body = new THREE.Group(); // squash, bob, tilt
  private eye = new THREE.Group(); // squint, look around
  private legs: THREE.Object3D[] = [];
  private antenna = new THREE.Group();
  private squash = 0;
  private wobble = 0;
  private moodTime = 0;
  private blink = 0;
  private nextBlink = 2;

  private mats = {
    body: new THREE.MeshStandardMaterial({ color: CREAM, roughness: 0.55 }),
    accent: new THREE.MeshStandardMaterial({ color: CORAL, roughness: 0.5 }),
    ink: new THREE.MeshStandardMaterial({ color: INK, roughness: 0.35 }),
    eyeWhite: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25 }),
    glow: new THREE.MeshBasicMaterial({ color: 0x8ff4ff }),
  };

  constructor(model: BotModel) {
    this.root.add(this.body);
    this.setModel(model);
  }

  setModel(model: BotModel): void {
    this.body.clear();
    this.eye = new THREE.Group();
    this.antenna = new THREE.Group();
    this.legs = [];
    const m = this.mats;
    const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };

    // Legs (shared by all models): little capsules that swing from the hip.
    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(side * 0.15, 0.4, 0);
      add(hip, new THREE.CapsuleGeometry(0.075, 0.2, 4, 8), m.ink, 0, -0.2, 0);
      add(hip, new THREE.SphereGeometry(0.1, 12, 8).scale(1, 0.6, 1.4), m.accent, 0, -0.34, 0.03);
      this.legs.push(hip);
      this.body.add(hip);
    }

    let eyeY = 1.08, eyeZ = 0.33, antennaY = 1.42;
    if (model === 'capsule') {
      add(this.body, new THREE.CapsuleGeometry(0.36, 0.45, 8, 20), m.body, 0, 0.92, 0);
      add(this.body, new THREE.TorusGeometry(0.365, 0.045, 8, 32).rotateX(Math.PI / 2), m.accent, 0, 0.72, 0);
      add(this.eye, new THREE.CylinderGeometry(0.2, 0.2, 0.06, 28).rotateX(Math.PI / 2), m.eyeWhite);
      add(this.eye, new THREE.SphereGeometry(0.1, 16, 12), m.ink, 0, 0, 0.03);
    } else if (model === 'boxy') {
      add(this.body, new RoundedBoxGeometry(0.78, 0.72, 0.62, 4, 0.16), m.body, 0, 0.78, 0);
      add(this.body, new RoundedBoxGeometry(0.58, 0.4, 0.06, 3, 0.04), m.ink, 0, 0.85, 0.3);
      eyeY = 0.85;
      eyeZ = 0.34;
      antennaY = 1.14;
      add(this.eye, new THREE.SphereGeometry(0.09, 16, 12).scale(1, 1, 0.4), m.glow);
      add(this.eye, new THREE.SphereGeometry(0.035, 10, 8), m.eyeWhite, 0.035, 0.035, 0.03);
    } else {
      add(this.body, new THREE.SphereGeometry(0.44, 28, 20), m.body, 0, 0.78, 0);
      add(this.body, new THREE.SphereGeometry(0.445, 28, 10, 0, Math.PI * 2, Math.PI * 0.62, Math.PI * 0.38), m.accent, 0, 0.78, 0);
      eyeY = 0.9;
      eyeZ = 0.39;
      antennaY = 1.2;
      add(this.eye, new THREE.SphereGeometry(0.17, 20, 14).scale(1, 1, 0.45), m.eyeWhite);
      add(this.eye, new THREE.SphereGeometry(0.085, 14, 10), m.ink, 0, 0, 0.05);
    }
    this.eye.position.set(0, eyeY, eyeZ);
    this.body.add(this.eye);

    this.antenna.position.set(0, antennaY, 0);
    add(this.antenna, new THREE.CylinderGeometry(0.018, 0.018, 0.2, 6), m.ink, 0, 0.1, 0);
    add(this.antenna, new THREE.SphereGeometry(0.06, 12, 8), m.accent, 0, 0.22, 0);
    this.body.add(this.antenna);
  }

  setMood(mood: Mood): void {
    if (mood === this.mood) return;
    this.mood = mood;
    this.moodTime = 0;
  }

  /** Squash on landing; `big` adds a wobble (long drops). */
  land(big: boolean): void {
    this.squash = big ? 0.32 : 0.18;
    if (big) this.wobble = 1;
  }

  update(dt: number, t: number): void {
    this.moodTime += dt;
    const mt = this.moodTime;
    let bob = 0, tiltZ = 0, tiltX = 0, lookX = 0, lookY = 0, squint = 1, hop = 0, legSwing = 0;

    switch (this.mood) {
      case 'idle':
        bob = Math.sin(t * 2.2) * 0.012;
        lookX = Math.sin(t * 0.7) * 0.03;
        break;
      case 'thinking':
        squint = 0.42;
        lookX = Math.sin(mt * 4.5) * 0.07;
        lookY = 0.03 + Math.sin(mt * 2.3) * 0.02;
        tiltZ = Math.sin(mt * 3) * 0.06;
        bob = Math.sin(mt * 6) * 0.01;
        this.antenna.rotation.z = Math.sin(mt * 18) * 0.25; // processing...
        break;
      case 'walking':
        legSwing = Math.sin(this.walkPhase) * 0.6;
        bob = Math.abs(Math.sin(this.walkPhase)) * 0.06;
        tiltX = 0.08;
        tiltZ = Math.sin(this.walkPhase) * 0.05;
        break;
      case 'happy': {
        const hopping = mt < 1.3;
        hop = hopping ? Math.abs(Math.sin(mt * 7.5)) * 0.4 : 0;
        squint = 0.3;
        tiltZ = hopping ? Math.sin(mt * 15) * 0.12 : 0;
        legSwing = hopping ? Math.sin(mt * 15) * 0.5 : 0;
        if (!hopping) this.setMood('idle');
        break;
      }
      case 'confused':
        tiltZ = 0.28 * Math.min(1, mt * 4);
        lookX = Math.sin(mt * 5) * 0.08;
        lookY = 0.04;
        if (mt > 2.2) this.setMood('idle');
        break;
    }

    // Blink now and then (not while squinting).
    this.nextBlink -= dt;
    if (this.nextBlink <= 0) {
      this.blink = 0.14;
      this.nextBlink = 2 + Math.random() * 3;
    }
    this.blink = Math.max(0, this.blink - dt);
    if (this.blink > 0) squint = Math.min(squint, 0.1);

    // Landing squash and long-drop wobble decay.
    this.squash = Math.max(0, this.squash - dt * 1.6);
    this.wobble = Math.max(0, this.wobble - dt * 1.1);
    const s = this.squash * Math.sin(Math.min(1, this.squash * 6) * Math.PI * 0.5);
    tiltZ += Math.sin(t * 16) * 0.22 * this.wobble;

    this.body.position.y = bob + hop;
    this.body.scale.set(1 + s * 0.6, 1 - s, 1 + s * 0.6);
    this.body.rotation.set(tiltX, 0, tiltZ);
    this.eye.scale.set(1, damp(this.eye.scale.y, squint, dt, 18), 1);
    this.eye.position.x = damp(this.eye.position.x, lookX, dt, 8);
    this.eye.rotation.x = -lookY * 3;
    if (this.mood !== 'thinking') this.antenna.rotation.z = damp(this.antenna.rotation.z, -tiltZ * 1.5, dt, 6);
    this.legs[0].rotation.x = legSwing;
    this.legs[1].rotation.x = -legSwing;
  }
}

function damp(a: number, b: number, dt: number, k: number): number {
  return b + (a - b) * Math.exp(-k * dt);
}
