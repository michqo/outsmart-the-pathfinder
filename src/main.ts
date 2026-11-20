import * as THREE from 'three';
import { Editor, HOTBAR_MATS } from './edit/editor';
import { EditHistory } from './edit/history';
import { grassFaces, PALETTES } from './palette';
import { ChunkRenderer } from './render/chunks';
import { createStage } from './render/scene';
import { Sky } from './render/sky';
import { buildUnderside } from './render/underside';
import { Hotbar } from './ui/hotbar';
import { createPanel, type Settings, type Stats } from './ui/panel';
import { Mat } from './world/materials';
import { generateTestIsland } from './world/testIsland';
import { World } from './world/world';

const settings: Settings = {
  palette: 'meadow',
  grassStyle: 'drip',
  hotbarStyle: 'chips',
  ao: true,
  aoStrength: 0.5,
  jitter: 0.07,
  shadows: true,
  wireframe: false,
  exposure: 1.0,
  seed: 7,
};
const stats: Stats = { fps: 0, frameMs: 0, triangles: 0, remeshMs: 0, undersideMs: 0 };

const stage = createStage();
const world = new World();
const chunks = new ChunkRenderer(world);
const sky = new Sky();
stage.island.add(chunks.group);
stage.scene.add(sky.group);

const palette = () => PALETTES[settings.palette];

/** The colour a material shows in the UI and in placement previews. */
function colorOf(m: Mat): number {
  const p = palette();
  switch (m) {
    case Mat.Grass: return grassFaces(p, settings.grassStyle)[0];
    case Mat.Soil: return p.blocks.soil.side;
    case Mat.Stone: return p.blocks.stone.top;
    case Mat.Crystal: return p.blocks.crystal.top;
    case Mat.Water: return p.water;
    case Mat.Placed: return p.blocks.placed.top;
    default: return 0xffffff;
  }
}

// ---------------------------------------------------------------- underside

let underside: THREE.Mesh | null = null;
let undersideTimer = 0;

function rebuildUnderside(): void {
  const t0 = performance.now();
  if (underside) {
    stage.island.remove(underside);
    underside.geometry.dispose();
    (underside.material as THREE.Material).dispose();
  }
  underside = buildUnderside(world, palette());
  stage.island.add(underside);
  stats.undersideMs = performance.now() - t0;
}

/** Edits can change the island's footprint; rebuild the rocks once editing pauses. */
function scheduleUnderside(): void {
  clearTimeout(undersideTimer);
  undersideTimer = window.setTimeout(rebuildUnderside, 600);
}

// ---------------------------------------------------------------- editing

const history = new EditHistory();
const editor = new Editor(stage, world, history, colorOf);
const hotbar = new Hotbar(HOTBAR_MATS, settings.hotbarStyle);
const syncHotbar = () => hotbar.setState(editor.material, editor.tool);
hotbar.onSelect = (m) => editor.setMaterial(m);
hotbar.onTool = (t) => editor.setTool(t);
editor.onToolChange = syncHotbar;
editor.onEdit = scheduleUnderside;
syncHotbar();

// ---------------------------------------------------------------- look

function applyPalette(): void {
  const p = palette();
  chunks.setPalette(p, settings.grassStyle);
  sky.setPalette(p);
  stage.sun.color.setHex(p.sun.color);
  stage.sun.intensity = p.sun.intensity;
  stage.hemi.color.setHex(p.hemi.sky);
  stage.hemi.groundColor.setHex(p.hemi.ground);
  stage.hemi.intensity = p.hemi.intensity;
  hotbar.setColors(colorOf);
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
  onHotbarStyle: () => hotbar.setStyle(settings.hotbarStyle),
  onMeshOptions: applyMeshOptions,
  onJitter: () => (chunks.jitter.value = settings.jitter),
  onShadows: () => (stage.sun.castShadow = settings.shadows),
  onWireframe: () => chunks.setWireframe(settings.wireframe),
  onExposure: () => (stage.renderer.toneMappingExposure = settings.exposure),
  onRegenerate: () => {
    generateTestIsland(world, settings.seed);
    history.clear();
    rebuildUnderside();
  },
});

// Dev-only handle for poking at the scene from the console.
if (import.meta.env.DEV) Object.assign(window, { __app: { stage, world, chunks, settings, editor, applyPalette } });

// ---------------------------------------------------------------- loop

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
  editor.update(dt);
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
