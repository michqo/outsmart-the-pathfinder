import * as THREE from 'three';

/** The goal: a floating star-seed over a little landing ring. Our own design, not a flag. */
export class GoalMarker {
  readonly root = new THREE.Group();
  private gem: THREE.Mesh;
  private beam: THREE.Mesh;

  constructor() {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.38, 0.07, 8, 28).rotateX(Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xffc46b, roughness: 0.4 }),
    );
    ring.position.y = 0.06;
    ring.receiveShadow = true;
    this.gem = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.26, 0).scale(1, 1.35, 1),
      new THREE.MeshStandardMaterial({ color: 0xffd98a, emissive: 0xff9f5a, emissiveIntensity: 0.45, flatShading: true }),
    );
    this.gem.castShadow = true;
    this.beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.32, 3.2, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffe2a8, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.beam.position.y = 1.6;
    this.root.add(ring, this.gem, this.beam);
  }

  update(t: number): void {
    this.gem.position.y = 1.0 + Math.sin(t * 2.2) * 0.12;
    this.gem.rotation.y = t * 1.3;
    (this.beam.material as THREE.MeshBasicMaterial).opacity = 0.16 + Math.sin(t * 3) * 0.05;
  }
}
