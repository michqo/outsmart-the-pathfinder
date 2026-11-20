import * as THREE from 'three';
import { MoveKind } from '../path/moves';
import { voxelCoords } from '../world/world';

const LIFT = 0.22;

/** A bright tube along the path with scrolling chevrons. Reveals from start to goal. */
export class PathRibbon {
  readonly group = new THREE.Group();
  private mesh: THREE.Mesh | null = null;
  private uniforms = {
    uTime: { value: 0 },
    uReveal: { value: 0 },
    uLen: { value: 1 },
    uFadeOut: { value: 1 },
  };
  private material = new THREE.ShaderMaterial({
    uniforms: this.uniforms,
    transparent: true,
    toneMapped: false,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uReveal, uLen, uFadeOut;
      varying vec2 vUv;
      void main() {
        if (vUv.x > uReveal) discard;
        float along = vUv.x * uLen;
        float around = abs(fract(vUv.y * 2.0) - 0.5) * 2.0;
        float chev = step(0.55, fract((along - around * 0.35 - uTime * 2.2) / 0.9));
        vec3 base = vec3(1.0, 0.33, 0.52);
        vec3 bright = vec3(1.0, 0.86, 0.35);
        float head = smoothstep(uReveal - 0.04, uReveal, vUv.x);
        gl_FragColor = vec4(mix(base, bright, max(chev, head)), 0.95 * uFadeOut);
        #include <colorspace_fragment>
      }`,
  });
  private revealSpeed = 0;
  /** Dig / place markers by the step index that uses them. */
  private markers = new Map<number, THREE.Object3D>();
  private drillGeo = new THREE.ConeGeometry(0.16, 0.42, 6).rotateX(Math.PI);
  private drillMat = new THREE.MeshStandardMaterial({ color: 0xff7a64, roughness: 0.4, flatShading: true });
  private ghostGeo = new THREE.BoxGeometry(1.02, 1.02, 1.02);
  private ghostMat = new THREE.MeshBasicMaterial({ color: 0xffa25c, transparent: true, opacity: 0.32, depthWrite: false });
  private ghostEdges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.02, 1.02, 1.02));
  private edgeMat = new THREE.LineBasicMaterial({ color: 0xff8a3d });

  show(nodes: Int32Array, kinds: Uint8Array, revealSeconds = 0.5): void {
    this.clear();
    if (nodes.length < 2) return;
    const pts: THREE.Vector3[] = [];
    let prev: THREE.Vector3 | null = null;
    for (let i = 0; i < nodes.length; i++) {
      const [x, y, z] = voxelCoords(nodes[i]);
      const p = new THREE.Vector3(x + 0.5, y + LIFT, z + 0.5);
      if (prev && kinds[i] === MoveKind.StepUp) {
        pts.push(new THREE.Vector3((prev.x + p.x) / 2, p.y + 0.15, (prev.z + p.z) / 2));
      } else if (prev && kinds[i] === MoveKind.Drop) {
        pts.push(new THREE.Vector3(prev.x * 0.35 + p.x * 0.65, prev.y + 0.05, prev.z * 0.35 + p.z * 0.65));
      }
      pts.push(p);
      prev = p;
    }
    this.addMarkers(nodes, kinds);
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const len = curve.getLength();
    const geo = new THREE.TubeGeometry(curve, Math.max(16, Math.ceil(len * 10)), 0.14, 8, false);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.renderOrder = 4;
    this.group.add(this.mesh);
    this.uniforms.uLen.value = len;
    this.uniforms.uReveal.value = 0;
    this.uniforms.uFadeOut.value = 1;
    this.revealSpeed = revealSeconds > 0 ? 1 / revealSeconds : Infinity;
  }

  /** Fraction of the path the bot has walked: the ribbon behind it fades a little. */
  get revealed(): boolean {
    return this.uniforms.uReveal.value >= 1;
  }

  /** Drill bits over blocks the bot will dig; ghost blocks where it will build. */
  private addMarkers(nodes: Int32Array, kinds: Uint8Array): void {
    for (let i = 1; i < nodes.length; i++) {
      const k = kinds[i];
      const [x, y, z] = voxelCoords(nodes[i]);
      const [px, py, pz] = voxelCoords(nodes[i - 1]);
      let m: THREE.Object3D | null = null;
      if (k === MoveKind.Dig || k === MoveKind.DigDown) {
        // Hovers over the column being dug, pointing down at it.
        m = new THREE.Mesh(this.drillGeo, this.drillMat);
        if (k === MoveKind.Dig) m.position.set(x + 0.5, y + 2.6, z + 0.5);
        else m.position.set(px + 0.5, py + 2.6, pz + 0.5);
      } else if (k === MoveKind.Bridge || k === MoveKind.Pillar) {
        const g = new THREE.Group();
        g.add(new THREE.Mesh(this.ghostGeo, this.ghostMat), new THREE.LineSegments(this.ghostEdges, this.edgeMat));
        if (k === MoveKind.Bridge) g.position.set(x + 0.5, y - 0.5, z + 0.5);
        else g.position.set(px + 0.5, py + 0.5, pz + 0.5);
        m = g;
      }
      if (m) {
        m.userData.baseY = m.position.y;
        this.markers.set(i, m);
        this.group.add(m);
      }
    }
  }

  /** The bot finished step `i`: its marker has done its job. */
  stepDone(i: number): void {
    const m = this.markers.get(i);
    if (!m) return;
    this.group.remove(m);
    this.markers.delete(i);
  }

  clear(): void {
    for (const m of this.markers.values()) this.group.remove(m);
    this.markers.clear();
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
  }

  fade(amount: number): void {
    this.uniforms.uFadeOut.value = amount;
  }

  update(time: number, dt: number): void {
    this.uniforms.uTime.value = time;
    for (const m of this.markers.values()) {
      if (m instanceof THREE.Mesh) {
        m.rotation.y = time * 4;
        m.position.y = m.userData.baseY + Math.sin(time * 4) * 0.12;
      }
    }
    const u = this.uniforms.uReveal;
    if (u.value < 1) u.value = Math.min(1, u.value + dt * this.revealSpeed);
  }
}
