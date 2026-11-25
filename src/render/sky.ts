import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Palette } from '../palette';
import { rng } from '../world/noise';
import { CLOUD_GLSL, createCloudUniforms } from './clouds';

/** Clear-sky colour samples from the horizon to the zenith. */
const BANDS = 10;

/** Stylised: a gradient dome plus low-poly clouds. Realistic: a measured sky with drifting clouds. */
export class Sky {
  readonly group = new THREE.Group();
  private uniforms = {
    uTop: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uBottom: { value: new THREE.Color() },
  };
  private cloudMaterial = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 1, metalness: 0 });
  private gradientDome: THREE.Mesh;
  private realDome: THREE.Mesh;
  /** The drifting cloud field; the terrain shares these uniforms for its cloud shadows. */
  readonly cloud = createCloudUniforms();
  private realUniforms = {
    uIntensity: { value: 1 },
    uBands: { value: Array.from({ length: BANDS }, () => new THREE.Color()) },
    uSunColor: { value: new THREE.Color(1, 1, 1) },
  };
  private measured: THREE.Texture | null = null;
  private clouds: { mesh: THREE.Mesh; angle: number; radius: number; y: number; speed: number; phase: number }[] = [];

  constructor() {
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(700, 32, 16),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        side: THREE.BackSide,
        depthWrite: false,
        toneMapped: false,
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uTop, uHorizon, uBottom;
          varying vec3 vDir;
          void main() {
            float h = vDir.y;
            vec3 c = h > 0.0 ? mix(uHorizon, uTop, pow(h, 0.55)) : mix(uHorizon, uBottom, pow(-h, 0.45));
            gl_FragColor = vec4(c, 1.0);
            #include <colorspace_fragment>
          }`,
      }),
    );
    dome.renderOrder = -1;
    this.gradientDome = dome;
    this.group.add(dome);

    // Realistic: a clear-sky gradient measured from the HDRI, a sun, and a drifting cloud
    // layer (the same field casts shadows on the terrain). Below the horizon: the low sky
    // mirrored into bright haze, so the island floats in open air.
    this.realDome = new THREE.Mesh(
      new THREE.SphereGeometry(700, 48, 24),
      new THREE.ShaderMaterial({
        uniforms: { ...this.realUniforms, ...this.cloud },
        side: THREE.BackSide,
        depthWrite: false,
        vertexShader: /* glsl */ `
          varying vec3 vWorld;
          void main() {
            vec4 w = modelMatrix * vec4(position, 1.0);
            vWorld = w.xyz;
            gl_Position = projectionMatrix * viewMatrix * w;
          }`,
        fragmentShader: /* glsl */ `
          ${CLOUD_GLSL}
          uniform vec3 uBands[${BANDS}];
          uniform vec3 uSunColor;
          uniform float uIntensity;
          varying vec3 vWorld;

          /** Clear sky by elevation (0 = horizon .. 1 = zenith), from the measured bands. */
          vec3 grad(float y) {
            float e = asin(clamp(y, 0.0, 1.0)) / 1.5707963 * ${(BANDS - 1).toFixed(1)};
            int i = int(floor(e));
            int j = min(i + 1, ${BANDS - 1});
            return mix(uBands[i], uBands[j], fract(e));
          }

          vec3 above(vec3 d) {
            vec3 sun = normalize(uSunDir);
            float sd = max(dot(d, sun), 0.0);
            vec3 sky = grad(d.y) + uSunColor * (pow(sd, 1200.0) * 40.0 + pow(sd, 10.0) * 0.18);
            float t = (CLOUD_HEIGHT - cameraPosition.y) / max(d.y, 0.012);
            vec2 p = cameraPosition.xz + d.xz * t;
            #ifdef LOW_QUALITY
              int oct = 4;
            #else
              int oct = t > 2500.0 ? 4 : 6;
            #endif
            float dens = cloudDensity(p, oct);
            if (dens < 0.002) return sky;
            // Light: how much cloud sits between this point and the sun (cheap self-shadow).
            float toSun = cloudDensity(p + normalize(sun.xz + 1e-4) * 45.0, 3);
            float lit = clamp(1.0 - 0.8 * toSun + 0.25 * (1.0 - dens), 0.2, 1.0);
            vec3 belly = grad(0.08) * 0.55 + uSunColor * 0.08;
            vec3 col = mix(belly, uSunColor * 1.1, lit);
            col += uSunColor * pow(sd, 5.0) * 0.6 * (1.0 - dens); // bright, thin edges toward the sun
            // Far clouds fade into the horizon haze; thin ones stay see-through.
            float far = 1.0 - exp(-t / 3000.0);
            col = mix(col, grad(d.y) * 1.05, far * 0.75);
            float alpha = pow(dens, 0.8) * smoothstep(0.0, 0.1, d.y) * (1.0 - far * 0.9);
            return mix(sky, col, alpha);
          }

          /** Far below the island: a sunlit sea of clouds, with hazy blue depths in the gaps. */
          vec3 below(vec3 d) {
            vec3 sun = normalize(uSunDir);
            float t = (-180.0 - cameraPosition.y) / min(d.y, -0.012);
            vec2 p = cameraPosition.xz + d.xz * t;
            #ifdef LOW_QUALITY
              int oct = 4;
            #else
              int oct = t > 2500.0 ? 4 : 6;
            #endif
            vec2 q = (p - uDrift * 0.5) / 130.0 + 37.0;
            q += 0.4 * vec2(cFbm(q * 0.6 + uTime * 0.003, 3), cFbm(q * 0.6 + 9.1, 3));
            float dens = smoothstep(0.36, 0.62, cFbm(q, oct));
            // Tops facing the sun are bright; the side away from it falls into shade.
            vec2 qs = q + normalize(sun.xz + 1e-4) * 0.25;
            float relief = cFbm(qs, 3) - cFbm(q, 3);
            float lit = clamp(0.8 - relief * 3.0, 0.35, 1.0);
            vec3 tops = mix(grad(0.1) * 0.7, uSunColor, lit);
            vec3 depths = grad(0.35) * 0.75;
            vec3 c = mix(depths, tops, dens);
            float far = 1.0 - exp(-t / 2600.0);
            return mix(c, grad(0.02) * 1.06, far);
          }

          void main() {
            vec3 d = normalize(vWorld - cameraPosition);
            // Blend across the horizon line so the two layers meet without a seam.
            vec3 c = d.y >= 0.0 ? above(d) : below(d);
            if (abs(d.y) < 0.02) c = mix(grad(0.01) * 1.04, c, abs(d.y) / 0.02);
            gl_FragColor = vec4(c * uIntensity, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      }),
    );
    this.realDome.renderOrder = -1;
    this.realDome.visible = false;
    this.group.add(this.realDome);

    const r = rng(99);
    for (let i = 0; i < 7; i++) {
      const mesh = new THREE.Mesh(makeCloud(r), this.cloudMaterial);
      const c = {
        mesh,
        angle: (i / 7) * Math.PI * 2 + r() * 0.5,
        radius: 75 + r() * 55,
        y: -18 + r() * 52,
        speed: 0.006 + r() * 0.008,
        phase: r() * 10,
      };
      mesh.scale.setScalar(0.8 + r() * 0.9);
      this.clouds.push(c);
      this.group.add(mesh);
    }
  }

  setPalette(p: Palette): void {
    this.uniforms.uTop.value.setHex(p.sky.top);
    this.uniforms.uHorizon.value.setHex(p.sky.horizon);
    this.uniforms.uBottom.value.setHex(p.sky.bottom);
    this.cloudMaterial.color.setHex(p.cloud);
  }

  /** Realistic sky measured from an equirect HDR (null = the stylised gradient + clouds). */
  setReal(env: THREE.DataTexture | null, intensity = 1, sunDir?: THREE.Vector3): void {
    this.realUniforms.uIntensity.value = intensity;
    if (env && env !== this.measured) {
      this.measured = env;
      const bands = measureSky(env);
      bands.forEach((c, i) => this.realUniforms.uBands.value[i].copy(c));
      // Sunlit cloud tops: a warm white well above the brightest clear sky.
      const top = Math.max(...bands.map((c) => c.r * 0.3 + c.g * 0.59 + c.b * 0.11));
      this.realUniforms.uSunColor.value.setRGB(1.0, 0.96, 0.9).multiplyScalar(Math.max(0.6, top * 2.2));
    }
    if (sunDir) this.cloud.uSunDir.value.copy(sunDir);
    this.realDome.visible = env !== null;
    this.gradientDome.visible = env === null;
    for (const c of this.clouds) c.mesh.visible = env === null;
  }

  setLowQuality(low: boolean): void {
    const m = this.realDome.material as THREE.ShaderMaterial;
    if (!!m.defines.LOW_QUALITY === low) return;
    if (low) m.defines.LOW_QUALITY = '';
    else delete m.defines.LOW_QUALITY;
    m.needsUpdate = true;
  }

  update(t: number): void {
    const dt = Math.min(0.1, Math.max(0, t - this.cloud.uTime.value));
    this.cloud.uDrift.value.addScaledVector(this.cloud.uWind.value, dt);
    this.cloud.uTime.value = t;
    for (const c of this.clouds) {
      const a = c.angle + t * c.speed;
      c.mesh.position.set(Math.cos(a) * c.radius, c.y + Math.sin(t * 0.3 + c.phase) * 0.8, Math.sin(a) * c.radius);
      c.mesh.rotation.y = -a;
    }
  }
}

function makeCloud(r: () => number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const n = 3 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    const s = 3 + r() * 3.5;
    const g = new THREE.IcosahedronGeometry(s, 0);
    g.scale(1, 0.62, 0.85);
    g.translate((i - (n - 1) / 2) * 4.2 + r() * 1.5, r() * 1.5, r() * 2 - 1);
    parts.push(g);
  }
  return mergeGeometries(parts)!;
}

/**
 * The clear-sky colour at BANDS elevations from the horizon up. Clouds are brighter than
 * the blue between them, so each band averages its darker pixels (20th-45th percentile).
 */
function measureSky(env: THREE.DataTexture): THREE.Color[] {
  const { data, width, height } = env.image as { data: Uint16Array | Float32Array; width: number; height: number };
  const half = data instanceof Uint16Array;
  const read = (i: number) => (half ? THREE.DataUtils.fromHalfFloat(data[i]) : data[i]);
  const out: THREE.Color[] = [];
  for (let k = 0; k < BANDS; k++) {
    const elev = Math.max(0.02, (k / (BANDS - 1)) * (Math.PI / 2) - 0.01);
    const row = Math.min(height - 1, Math.round((0.5 - elev / Math.PI) * height));
    const px: [number, number, number, number][] = [];
    for (let x = 0; x < width; x += 2) {
      const i = (row * width + x) * 4;
      const r = read(i), g = read(i + 1), b = read(i + 2);
      px.push([r * 0.3 + g * 0.59 + b * 0.11, r, g, b]);
    }
    px.sort((a, b) => a[0] - b[0]);
    const lo = Math.floor(px.length * 0.2), hi = Math.max(lo + 1, Math.floor(px.length * 0.45));
    const c = new THREE.Color(0, 0, 0);
    for (let j = lo; j < hi; j++) c.r += px[j][1], c.g += px[j][2], c.b += px[j][3];
    out.push(c.multiplyScalar(1 / (hi - lo)));
  }
  return out;
}
