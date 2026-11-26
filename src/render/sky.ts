import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Palette } from '../palette';
import { rng } from '../world/noise';
import { createCloudUniforms } from './clouds';
import { TIME_LIGHT, type TimeLight } from './timeOfDay';

/** A gradient dome, low-poly clouds and stars. The terrain shares its cloud field for cloud shadows. */
export class Sky {
  readonly group = new THREE.Group();
  private uniforms = {
    uTop: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uBottom: { value: new THREE.Color() },
  };
  private cloudMaterial = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 1, metalness: 0 });
  /** A drifting cloud field overhead, out of view; the terrain uses it for cloud shadows. */
  readonly cloud = createCloudUniforms();
  /** Untinted palette gradient; the time of day tints copies. */
  private base = { top: new THREE.Color(), horizon: new THREE.Color(), bottom: new THREE.Color() };
  private time: TimeLight = TIME_LIGHT.day;
  private stars: THREE.Points;
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
    this.group.add(dome);

    // Stars: a fixed scatter on the upper sky, faded in by the time of day.
    const sr = rng(1234);
    const pos: number[] = [];
    for (let i = 0; i < 900; i++) {
      const y = 0.08 + sr() * 0.92, a = sr() * Math.PI * 2, rr = Math.sqrt(1 - y * y);
      pos.push(Math.cos(a) * rr * 650, y * 650, Math.sin(a) * rr * 650);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.stars = new THREE.Points(
      sg,
      new THREE.PointsMaterial({ color: 0xfff6e8, size: 1.8, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
    );
    this.stars.renderOrder = -0.5;
    this.stars.visible = false;
    this.group.add(this.stars);

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
    this.base.top.setHex(p.sky.top);
    this.base.horizon.setHex(p.sky.horizon);
    this.base.bottom.setHex(p.sky.bottom);
    this.cloudMaterial.color.setHex(p.cloud);
    this.applyTime();
  }

  /** Lights the sky for a time of day: tints the gradient, shows the stars. */
  setTime(t: TimeLight): void {
    this.time = t;
    this.applyTime();
  }

  private applyTime(): void {
    const t = this.time;
    const tint = new THREE.Color(t.skyTint).multiplyScalar(t.sky);
    this.uniforms.uTop.value.copy(this.base.top).multiply(tint);
    this.uniforms.uHorizon.value.copy(this.base.horizon).multiply(tint);
    this.uniforms.uBottom.value.copy(this.base.bottom).multiply(tint);
    const m = this.stars.material as THREE.PointsMaterial;
    m.opacity = t.stars;
    this.stars.visible = t.stars > 0;
  }

  /** Points the cloud field's shadows along the sun. */
  setSunDir(d: THREE.Vector3): void {
    this.cloud.uSunDir.value.copy(d);
  }

  /** The colour of the low sky, which distant things fade into (linear, before tone mapping). */
  hazeColor(out = new THREE.Color()): THREE.Color {
    return out.copy(this.uniforms.uHorizon.value);
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
