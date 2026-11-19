import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Palette } from '../palette';
import { rng } from '../world/noise';

/** A big gradient dome plus a ring of drifting low-poly clouds. */
export class Sky {
  readonly group = new THREE.Group();
  private uniforms = {
    uTop: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uBottom: { value: new THREE.Color() },
  };
  private cloudMaterial = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 1, metalness: 0 });
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

  update(t: number): void {
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
