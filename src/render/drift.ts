import * as THREE from 'three';
import { Biome } from '../gen/island';
import { SOLID } from '../world/materials';
import { rng } from '../world/noise';
import type { World } from '../world/world';
import type { TimeOfDay } from './timeOfDay';

/**
 * Things drifting in the air over each biome: blossom over meadows and forests, fireflies
 * there after dark, sand blowing over deserts, snow on the peaks and embers over lava.
 * Pure decoration. Every particle loops on its own clock in the vertex shader, so nothing
 * is updated on the CPU per frame.
 */
interface Kind {
  biomes: number[];
  /** Which times of day it shows at. */
  times: TimeOfDay[];
  /** Particles per land column of its biomes, and a cap. */
  density: number;
  max: number;
  color: number;
  /** World size in voxels. */
  size: number;
  /** Voxels per second up (+) or down (−), and the height of the loop. */
  speed: number;
  span: number;
  /** How far above the ground the loop starts. */
  lift: number;
  /** Sideways drift over one loop (voxels), and a wobble radius. */
  drift: [number, number];
  wobble: number;
  opacity: number;
  /** 1 = blinks (fireflies, embers). */
  twinkle: number;
  additive: boolean;
}

const DAYLIGHT: TimeOfDay[] = ['dawn', 'day', 'dusk'];
const KINDS: Kind[] = [
  // Blossom
  { biomes: [Biome.Meadow, Biome.Forest], times: DAYLIGHT, density: 0.1, max: 600, color: 0xffd3e2, size: 0.32, speed: -0.55, span: 9, lift: 0.5,
    drift: [3.5, 2.6], wobble: 0.6, opacity: 0.9, twinkle: 0, additive: false },
  // Fireflies
  { biomes: [Biome.Meadow, Biome.Forest, Biome.Wetlands], times: ['dusk', 'night'], density: 0.08, max: 500, color: 0xd9ff7a, size: 0.28, speed: 0.12,
    span: 2.2, lift: 0.4, drift: [0.4, -0.3], wobble: 1.1, opacity: 1, twinkle: 1, additive: true },
  // Blowing sand
  { biomes: [Biome.Desert, Biome.Badlands], times: ['dawn', 'day', 'dusk', 'night'], density: 0.16, max: 800, color: 0xe9cf98, size: 0.16, speed: 0.35,
    span: 1.6, lift: 0.1, drift: [9, 6.5], wobble: 0.15, opacity: 0.55, twinkle: 0, additive: false },
  // Snow
  { biomes: [Biome.Snowy], times: ['dawn', 'day', 'dusk', 'night'], density: 0.2, max: 1000, color: 0xffffff, size: 0.26, speed: -0.9, span: 14, lift: 0.3,
    drift: [2.2, 1.6], wobble: 0.45, opacity: 0.9, twinkle: 0, additive: false },
  // Embers
  { biomes: [Biome.Volcanic], times: ['dawn', 'day', 'dusk', 'night'], density: 0.12, max: 600, color: 0xff8a3c, size: 0.22, speed: 1.3, span: 7, lift: 0.2,
    drift: [1.2, 0.9], wobble: 0.35, opacity: 1, twinkle: 0.6, additive: true },
];

const VERT = /* glsl */ `
attribute vec3 aOrigin;
attribute float aSeed;
uniform float uTime, uSpeed, uSpan, uWobble, uSize, uPx, uTwinkle;
uniform vec2 uDrift;
varying float vAlpha;
void main() {
  float life = uSpan / abs(uSpeed);
  float k = fract(aSeed + uTime / life);
  vec3 p = aOrigin;
  p.y += uSpeed > 0.0 ? k * uSpan : (1.0 - k) * uSpan;
  p.xz += uDrift * (k - 0.5);
  float w = uTime * 1.3 + aSeed * 40.0;
  p.xz += vec2(sin(w), cos(w * 0.8)) * uWobble;
  vAlpha = sin(3.14159 * k);
  vAlpha *= mix(1.0, smoothstep(0.2, 1.0, sin(uTime * 2.4 + aSeed * 57.0) * 0.5 + 0.5), uTwinkle);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(uSize * uPx / max(0.5, -mv.z), 2.0, 14.0);
  vAlpha *= smoothstep(1.5, 4.0, -mv.z); // fade out right in front of the camera
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.15, d) * vAlpha * uOpacity;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

export class Drift {
  readonly group = new THREE.Group();
  private time = { value: 0 };
  private px = { value: 600 };

  /** Rebuilds the particles for a course: its world, per-column biomes and time of day. */
  set(world: World, biome: Uint8Array | undefined, time: TimeOfDay): void {
    for (const c of [...this.group.children] as THREE.Points[]) {
      c.geometry.dispose();
      (c.material as THREE.Material).dispose();
      this.group.remove(c);
    }
    if (!biome) return;
    const { sx, sy, sz } = world;
    const rand = rng(sx * 131 + sz * 7 + biome.length);
    for (const kind of KINDS) {
      if (!kind.times.includes(time)) continue;
      const columns: number[] = [];
      for (let i = 0; i < sx * sz; i++) if (kind.biomes.includes(biome[i])) columns.push(i);
      const n = Math.min(kind.max, Math.round(columns.length * kind.density));
      if (n < 4) continue;
      const origin = new Float32Array(n * 3);
      const seed = new Float32Array(n);
      for (let j = 0; j < n; j++) {
        const i = columns[Math.floor(rand() * columns.length)];
        const x = i % sx, z = Math.floor(i / sx);
        let y = sy - 1;
        while (y > 0 && !SOLID[world.get(x, y, z)]) y--;
        origin.set([x + rand(), y + 1 + kind.lift, z + rand()], j * 3);
        seed[j] = rand();
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(origin, 3)); // for bounds only
      geo.setAttribute('aOrigin', new THREE.BufferAttribute(origin, 3));
      geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
      geo.computeBoundingSphere();
      geo.boundingSphere!.radius += kind.span + Math.hypot(...kind.drift);
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        blending: kind.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        uniforms: {
          uTime: this.time,
          uPx: this.px,
          uSpeed: { value: kind.speed },
          uSpan: { value: kind.span },
          uDrift: { value: new THREE.Vector2(...kind.drift) },
          uWobble: { value: kind.wobble },
          uSize: { value: kind.size },
          uTwinkle: { value: kind.twinkle },
          uColor: { value: new THREE.Color(kind.color) },
          uOpacity: { value: kind.opacity },
        },
      });
      const points = new THREE.Points(geo, mat);
      points.renderOrder = 2;
      this.group.add(points);
    }
  }

  update(t: number, camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer): void {
    this.time.value = t;
    // Pixels per voxel at distance 1, so particles keep their world size.
    this.px.value = (renderer.domElement.height * 0.5) / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  }
}
