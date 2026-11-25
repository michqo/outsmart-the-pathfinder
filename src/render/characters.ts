import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Playable characters. The robot is our own procedural model; the rest are Kenney's
 * "Blocky Characters 2.0" (CC0, public/assets/characters), each with 27 built-in animations.
 */
export interface CharacterInfo {
  id: string;
  name: string;
  /** GLB file, or null for the procedural robot. */
  file: string | null;
}

const LETTERS = 'abcdefghijklmnopqr'.split('');
/** Named after how they look in the pack (file order a..r). */
const NAMES = [
  'Hiker', 'Sporty', 'Gamer', 'Crash dummy', 'Student', 'Gardener', 'Robo Red', 'Robo Heart', 'Professor',
  'Officer', 'Builder', 'Zombie', 'Explorer', 'Dancer', 'Orc', 'Pirate', 'Agent', 'Ninja',
];

export const CHARACTERS: CharacterInfo[] = [
  { id: 'capsule', name: 'Capsule bot', file: null },
  ...LETTERS.map((l, i) => ({ id: `character-${l}`, name: NAMES[i], file: `character-${l}.glb` })),
];

export const characterInfo = (id: string): CharacterInfo => CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];

const BASE = `${import.meta.env.BASE_URL}assets/characters/`;
const loader = new GLTFLoader();
const cache = new Map<string, Promise<GLTF>>();

/** Loads (once) and returns the glTF for a character file. */
export function loadCharacter(file: string): Promise<GLTF> {
  let p = cache.get(file);
  if (!p) {
    p = loader.loadAsync(BASE + file).then((gltf) => {
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = true;
          m.receiveShadow = true;
        }
      });
      return gltf;
    });
    cache.set(file, p);
  }
  return p;
}

/** Height (in voxels) characters are scaled to: a little under the bot's 2-voxel clearance. */
export const CHARACTER_HEIGHT = 1.55;

/** A posed, scaled, independent copy of a character, with its own animation mixer. */
export class CharacterRig {
  readonly object: THREE.Object3D;
  readonly mixer: THREE.AnimationMixer;
  readonly head: THREE.Object3D | null;
  private actions = new Map<string, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;

  constructor(gltf: GLTF) {
    this.object = gltf.scene.clone(true);
    const box = new THREE.Box3().setFromObject(this.object);
    const h = box.max.y - box.min.y || 1;
    this.object.scale.setScalar(CHARACTER_HEIGHT / h);
    this.object.position.y = -box.min.y * (CHARACTER_HEIGHT / h);
    this.mixer = new THREE.AnimationMixer(this.object);
    for (const clip of gltf.animations) this.actions.set(clip.name, this.mixer.clipAction(clip));
    this.head = this.object.getObjectByName('head') ?? null;
  }

  /** Cross-fades to a clip. `once` plays it a single time and holds the last frame. */
  play(name: string, { fade = 0.2, speed = 1, once = false } = {}): void {
    const next = this.actions.get(name);
    if (!next) return;
    next.timeScale = speed;
    if (next === this.current) return;
    next.reset();
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = once;
    next.play();
    if (this.current) next.crossFadeFrom(this.current, fade, false);
    this.current = next;
  }

  update(dt: number): void {
    this.mixer.update(dt);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.object);
  }
}

/**
 * Renders a thumbnail per character with a small throwaway renderer.
 * `drawRobot` provides the procedural robot as an Object3D.
 */
export async function renderThumbnails(
  drawRobot: () => THREE.Object3D,
  onEach: (id: string, url: string) => void = () => {},
  size = 160,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(2);
  renderer.setSize(size, size, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb8a58f, 2.2));
  const key = new THREE.DirectionalLight(0xfff2e0, 2.4);
  key.position.set(2, 4, 3);
  scene.add(key);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  camera.position.set(1.5, 1.6, 3.4);
  camera.lookAt(0, 0.8, 0);
  try {
    for (const c of CHARACTERS) {
      let obj: THREE.Object3D;
      if (c.file) {
        const rig = new CharacterRig(await loadCharacter(c.file));
        rig.play('idle');
        rig.update(0.3);
        obj = rig.object;
      } else obj = drawRobot();
      obj.rotation.y = 0.35;
      scene.add(obj);
      renderer.render(scene, camera);
      const url = renderer.domElement.toDataURL('image/png');
      out.set(c.id, url);
      onEach(c.id, url);
      scene.remove(obj);
    }
  } finally {
    renderer.dispose();
    renderer.forceContextLoss();
  }
  return out;
}
