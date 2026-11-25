import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SX, SZ } from '../world/world';

export interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  /** Holds everything in voxel coordinates, offset so the island is centred on the origin. */
  island: THREE.Group;
}

const FOV = 38;

/**
 * Portrait screens (phones) would crop the island's sides, so below a square aspect the
 * vertical FOV widens to keep the horizontal view a square screen would have.
 */
function fitFov(camera: THREE.PerspectiveCamera): void {
  const half = THREE.MathUtils.degToRad(FOV / 2);
  camera.fov = camera.aspect >= 1 ? FOV : Math.min(80, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(half) / camera.aspect)));
}

export function createStage(): Stage {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(FOV, window.innerWidth / window.innerHeight, 0.5, 1500);
  fitFov(camera);
  camera.position.set(58, 46, 68);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 10, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 6;
  controls.maxDistance = 220;
  controls.maxPolarAngle = Math.PI * 0.78; // allow peeking at the underside
  // Phones in portrait: start further back so the whole island fits across.
  if (camera.aspect < 0.8) camera.position.sub(controls.target).multiplyScalar(1.3).add(controls.target);
  controls.update();

  const island = new THREE.Group();
  island.position.set(-SX / 2, 0, -SZ / 2);
  scene.add(island);

  const hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 1);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffffff, 2.5);
  sun.position.set(45, 70, 28);
  sun.target.position.set(0, 8, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -55;
  sc.right = 55;
  sc.top = 55;
  sc.bottom = -55;
  sc.near = 10;
  sc.far = 200;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    fitFov(camera);
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return { renderer, scene, camera, controls, sun, hemi, island };
}
