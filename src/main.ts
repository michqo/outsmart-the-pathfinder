import * as THREE from 'three';
import { PALETTES } from './palette';
import { ChunkRenderer } from './render/chunks';
import { createStage } from './render/scene';
import { Sky } from './render/sky';
import { buildUnderside } from './render/underside';
import { createPanel, type Settings, type Stats } from './ui/panel';
import { generateTestIsland } from './world/testIsland';
import { World } from './world/world';

const settings: Settings = {
  palette: 'meadow',
  ao: true,
  aoStrength: 0.5,
  jitter: 0.07,
  shadows: true,
  wireframe: false,
  exposure: 1.0,
  seed: 7,
};
const stats: Stats = { fps: 0, frameMs: 0, triangles: 0, remeshMs: 0 };

const stage = createStage();
const world = new World();
const chunks = new ChunkRenderer(world);
const sky = new Sky();
stage.island.add(chunks.group);
stage.scene.add(sky.group);

let underside: THREE.Mesh | null = null;
const palette = () => PALETTES[settings.palette];

function rebuildUnderside(): void {
  if (underside) {
    stage.island.remove(underside);
    underside.geometry.dispose();
    (underside.material as THREE.Material).dispose();
  }
  underside = buildUnderside(world, palette());
  stage.island.add(underside);
}

function applyPalette(): void {
  const p = palette();
  chunks.setPalette(p);
  sky.setPalette(p);
  stage.sun.color.setHex(p.sun.color);
  stage.sun.intensity = p.sun.intensity;
  stage.hemi.color.setHex(p.hemi.sky);
  stage.hemi.groundColor.setHex(p.hemi.ground);
  stage.hemi.intensity = p.hemi.intensity;
  rebuildUnderside();
}

function applyMeshOptions(): void {
  const s = settings.aoStrength;
  chunks.opts.ao = settings.ao;
  chunks.opts.aoCurve = [1 - s, 1 - s * 0.62, 1 - s * 0.3, 1];
  world.markAllDirty();
}

generateTestIsland(world, settings.seed);
applyMeshOptions();
applyPalette();

createPanel(settings, stats, {
  onPalette: applyPalette,
  onMeshOptions: applyMeshOptions,
  onJitter: () => (chunks.jitter.value = settings.jitter),
  onShadows: () => (stage.sun.castShadow = settings.shadows),
  onWireframe: () => chunks.setWireframe(settings.wireframe),
  onExposure: () => (stage.renderer.toneMappingExposure = settings.exposure),
  onRegenerate: () => {
    generateTestIsland(world, settings.seed);
    rebuildUnderside();
  },
});

// Dev-only handle for poking at the scene from the console.
if (import.meta.env.DEV) Object.assign(window, { __app: { stage, world, chunks, settings, applyPalette } });

// Main loop.
const timer = new THREE.Timer();
let frames = 0;
let fpsTimer = 0;
let frameMsAcc = 0;

stage.renderer.setAnimationLoop((time) => {
  const t0 = performance.now();
  timer.update(time);
  const dt = timer.getDelta();
  const t = timer.getElapsed();

  if (chunks.update() > 0) {
    stats.remeshMs = chunks.stats.lastRebuildMs;
    stats.triangles = chunks.stats.triangles;
  }
  sky.update(t);
  stage.controls.update();
  stage.renderer.render(stage.scene, stage.camera);

  frames++;
  fpsTimer += dt;
  frameMsAcc += performance.now() - t0;
  if (fpsTimer >= 0.5) {
    stats.fps = frames / fpsTimer;
    stats.frameMs = frameMsAcc / frames;
    frames = 0;
    fpsTimer = 0;
    frameMsAcc = 0;
  }
});
