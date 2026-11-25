import * as THREE from 'three';

/**
 * One drifting cloud field, shared by the sky (what you see overhead) and the terrain
 * (the shadows they cast). Clouds live on a flat layer CLOUD_HEIGHT above the ground,
 * in world units, so a shadow lands where its cloud really is: straight along the sun
 * direction from the ground point up to the layer.
 */
export const CLOUD_HEIGHT = 260;

export interface CloudUniforms {
  uTime: { value: number };
  /** World units per second (read on the CPU; the shader gets the accumulated drift). */
  uWind: { value: THREE.Vector2 };
  /** How far the clouds have drifted so far, so changing the wind never makes them jump. */
  uDrift: { value: THREE.Vector2 };
  /** 0 = clear sky, 1 = overcast. */
  uCover: { value: number };
  uSunDir: { value: THREE.Vector3 };
}

export function createCloudUniforms(): CloudUniforms {
  return {
    uTime: { value: 0 },
    uWind: { value: new THREE.Vector2(4.5, 1.6) },
    uDrift: { value: new THREE.Vector2() },
    uCover: { value: 0.45 },
    uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() },
  };
}

/** GLSL: value-noise fbm, the cloud density at a point on the layer, and the shadow on the ground. */
export const CLOUD_GLSL = /* glsl */ `
uniform float uTime;
uniform vec2 uDrift;
uniform float uCover;
uniform vec3 uSunDir;
#define CLOUD_HEIGHT ${CLOUD_HEIGHT.toFixed(1)}

float cHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float cNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(cHash(i), cHash(i + vec2(1.0, 0.0)), u.x), mix(cHash(i + vec2(0.0, 1.0)), cHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
const mat2 cRot = mat2(0.8, -0.6, 0.6, 0.8);
float cFbm(vec2 p, int octaves) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    s += a * cNoise(p);
    p = cRot * p * 2.03 + 17.1;
    a *= 0.5;
  }
  return s;
}

/** Cloud density (0..1) at a point of the cloud layer, in world xz. */
float cloudDensity(vec2 xz, int octaves) {
  vec2 q = (xz - uDrift) / 105.0;
  // Domain warp: billowy, non-grid shapes. The warp drifts a little slower, so shapes evolve.
  q += 0.45 * vec2(cFbm(q * 0.7 + uTime * 0.004, 3), cFbm(q * 0.7 + 5.2 - uTime * 0.003, 3));
  float n = cFbm(q, octaves);
  float c = 1.0 - uCover;
  return smoothstep(c * 0.75, c * 0.75 + 0.28, n);
}

/** How much direct sunlight reaches a world-space ground point (1 = none blocked). */
float cloudShadow(vec3 world) {
  vec3 s = normalize(uSunDir);
  vec2 p = world.xz + s.xz / max(s.y, 0.15) * (CLOUD_HEIGHT - world.y);
  return 1.0 - 0.62 * cloudDensity(p, 3);
}
`;
