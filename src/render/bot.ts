import * as THREE from 'three';
import { CharacterRig, characterInfo, loadCharacter } from './characters';

/** 'capsule' (the procedural robot) or a character id from CHARACTERS. */
export type BotModel = string;

/** Which animation clip each mood plays on a Kenney character. */
const MOOD_CLIP: Record<Mood, { clip: string; speed?: number; once?: boolean }> = {
  idle: { clip: 'idle' },
  thinking: { clip: 'idle', speed: 0.6 },
  walking: { clip: 'walk', speed: 1.7 },
  working: { clip: 'attack-melee-right', speed: 1.4 },
  happy: { clip: 'emote-yes', once: true },
  confused: { clip: 'emote-no', once: true },
};

export type Mood = 'idle' | 'thinking' | 'walking' | 'working' | 'happy' | 'confused';

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

  private model: BotModel;
  private rig: CharacterRig | null = null;
  /** Fired when an async character model has been swapped in. */
  onModelReady: (() => void) | null = null;
  private mats = stylisedMats();

  constructor(model: BotModel) {
    this.model = model;
    this.root.add(this.body);
    this.setModel(model);
  }

  /** Same design, realistic materials: painted plastic, anodised metal, a glowing lens. */
  setRealistic(on: boolean): void {
    this.mats = on ? realisticMats() : stylisedMats();
    this.setModel(this.model);
  }

  setModel(model: BotModel): void {
    this.model = model;
    this.body.clear();
    this.rig?.dispose();
    this.rig = null;
    this.eye = new THREE.Group();
    this.antenna = new THREE.Group();
    this.legs = [];
    const info = characterInfo(model);
    if (info.file) {
      // A downloaded character: loads async (cached), then swaps in if still wanted.
      loadCharacter(info.file).then((gltf) => {
        if (this.model !== model || this.rig) return;
        this.rig = new CharacterRig(gltf);
        this.body.add(this.rig.object);
        const m = MOOD_CLIP[this.mood];
        this.rig.play(m.clip, { fade: 0, speed: m.speed, once: m.once });
        this.onModelReady?.();
      });
      return;
    }
    const m = this.mats;
    const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };

    // Legs: little capsules that swing from the hip.
    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(side * 0.15, 0.4, 0);
      add(hip, new THREE.CapsuleGeometry(0.075, 0.2, 4, 8), m.ink, 0, -0.2, 0);
      add(hip, new THREE.SphereGeometry(0.1, 12, 8).scale(1, 0.6, 1.4), m.accent, 0, -0.34, 0.03);
      this.legs.push(hip);
      this.body.add(hip);
    }

    // The capsule robot (any unknown model falls back to it).
    add(this.body, new THREE.CapsuleGeometry(0.36, 0.45, 8, 20), m.body, 0, 0.92, 0);
    add(this.body, new THREE.TorusGeometry(0.365, 0.045, 8, 32).rotateX(Math.PI / 2), m.accent, 0, 0.72, 0);
    add(this.eye, new THREE.CylinderGeometry(0.2, 0.2, 0.06, 28).rotateX(Math.PI / 2), m.eyeWhite);
    add(this.eye, new THREE.SphereGeometry(0.1, 16, 12), m.ink, 0, 0, 0.03);
    this.eye.position.set(0, 1.08, 0.33);
    this.body.add(this.eye);

    this.antenna.position.set(0, 1.42, 0);
    add(this.antenna, new THREE.CylinderGeometry(0.018, 0.018, 0.2, 6), m.ink, 0, 0.1, 0);
    add(this.antenna, new THREE.SphereGeometry(0.06, 12, 8), m.accent, 0, 0.22, 0);
    this.body.add(this.antenna);
  }

  setMood(mood: Mood): void {
    if (mood === this.mood) return;
    this.mood = mood;
    this.moodTime = 0;
    const m = MOOD_CLIP[mood];
    this.rig?.play(m.clip, { speed: m.speed, once: m.once });
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
      case 'working':
        // Leaning in, buzzing with effort.
        squint = 0.55;
        tiltX = 0.28;
        bob = Math.sin(mt * 50) * 0.015;
        tiltZ = Math.sin(mt * 43) * 0.03;
        this.antenna.rotation.z = Math.sin(mt * 30) * 0.3;
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

    if (this.rig) {
      // The clips animate the limbs; keep only a light body motion on top.
      if (this.mood === 'walking') (bob = 0), (tiltX = 0.03), (tiltZ *= 0.4);
      if (this.mood === 'working') tiltX = 0.08;
      this.rig.update(dt);
      if (this.rig.head && this.mood === 'thinking') this.rig.head.rotation.y = lookX * 7;
    }
    this.body.position.y = bob + hop;
    this.body.scale.set(1 + s * 0.6, 1 - s, 1 + s * 0.6);
    this.body.rotation.set(tiltX, 0, tiltZ);
    this.eye.scale.set(1, damp(this.eye.scale.y, squint, dt, 18), 1);
    this.eye.position.x = damp(this.eye.position.x, lookX, dt, 8);
    this.eye.rotation.x = -lookY * 3;
    if (this.mood !== 'thinking' && this.mood !== 'working') this.antenna.rotation.z = damp(this.antenna.rotation.z, -tiltZ * 1.5, dt, 6);
    if (this.legs.length) {
      this.legs[0].rotation.x = legSwing;
      this.legs[1].rotation.x = -legSwing;
    }
  }
}

type BotMats = Record<'body' | 'accent' | 'ink' | 'eyeWhite', THREE.Material>;

function stylisedMats(): BotMats {
  return {
    body: new THREE.MeshStandardMaterial({ color: CREAM, roughness: 0.55 }),
    accent: new THREE.MeshStandardMaterial({ color: CORAL, roughness: 0.5 }),
    ink: new THREE.MeshStandardMaterial({ color: INK, roughness: 0.35 }),
    eyeWhite: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25 }),
  };
}

function realisticMats(): BotMats {
  return {
    // Glossy painted shell: a clear lacquer coat over slightly rough paint.
    body: new THREE.MeshPhysicalMaterial({ color: CREAM, roughness: 0.42, clearcoat: 1, clearcoatRoughness: 0.12 }),
    // Anodised aluminium trim.
    accent: new THREE.MeshPhysicalMaterial({ color: CORAL, metalness: 0.85, roughness: 0.3, clearcoat: 0.4 }),
    // Brushed dark metal (anisotropic highlights) for legs, pupil and antenna.
    ink: new THREE.MeshPhysicalMaterial({ color: 0x3b3748, metalness: 0.9, roughness: 0.34, anisotropy: 0.8 }),
    // The lens: glass over a soft glow, kept bright by its emissive.
    eyeWhite: new THREE.MeshPhysicalMaterial({
      color: 0xf2fdff,
      emissive: 0x9ff0ff,
      emissiveIntensity: 3.2,
      roughness: 0.04,
      clearcoat: 1,
    }),
  };
}

function damp(a: number, b: number, dt: number, k: number): number {
  return b + (a - b) * Math.exp(-k * dt);
}
