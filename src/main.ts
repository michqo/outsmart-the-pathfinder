import * as THREE from 'three';
import { BotController } from './bot/controller';
import { Editor, HOTBAR_MATS } from './edit/editor';
import { Handles } from './edit/handles';
import { generateGauntlet } from './levels/gauntlet';
import { defaultSpawn } from './levels/spawn';
import { EditHistory } from './edit/history';
import { grassFaces, PALETTES } from './palette';
import { ChunkRenderer } from './render/chunks';
import { createStage } from './render/scene';
import { Sky } from './render/sky';
import { buildUnderside } from './render/underside';
import { Hotbar } from './ui/hotbar';
import { Hud } from './ui/hud';
import { createPanel, type Settings, type Stats } from './ui/panel';
import { loadAssets, type Assets } from './render/assets';
import { PostFX } from './render/post';
import { createTerrainMaterial, createWaterMaterial, VoxelTexture, type TerrainMaterial, type WaterMaterial } from './render/terrain';
import { Mat } from './world/materials';
import { generateStressLevel, generateTestIsland } from './world/testIsland';
import { World } from './world/world';

const settings: Settings = {
  style: 'realistic',
  quality: 'high',
  envIntensity: 1.0,
  bloom: 0.3,
  palette: 'meadow',
  grassStyle: 'drip',
  hotbarStyle: 'chips',
  revealSeconds: 1.5,
  vizStyle: 'glow',
  botModel: 'capsule',
  inventory: 16,
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
  underside = buildUnderside(world, palette(), realistic() ? assets!.rock : null);
  stage.island.add(underside);
  stats.undersideMs = performance.now() - t0;
}

/** Edits can change the island's footprint; rebuild the rocks once editing pauses. */
function scheduleUnderside(): void {
  clearTimeout(undersideTimer);
  undersideTimer = window.setTimeout(rebuildUnderside, 600);
}

// ---------------------------------------------------------------- editing

generateTestIsland(world, settings.seed);
const hud = new Hud();
const spawn = defaultSpawn(world);
const bot = new BotController(
  stage,
  world,
  hud,
  {
    model: settings.botModel,
    vizStyle: settings.vizStyle,
    blocks: settings.inventory,
    colorOf,
    onWorldChanged: () => scheduleUnderside(),
  },
  spawn.start,
  spawn.goal,
);

// Handles first: their capture listener must run before the editor's.
new Handles(stage, world, [
  { object: bot.bot.root, onDrop: (c) => bot.setStart(c), cell: () => bot.home },
  { object: bot.goalMarker.root, onDrop: (c) => bot.setGoal(c), cell: () => bot.goal },
]);

const history = new EditHistory();
const editor = new Editor(stage, world, history, colorOf);
const hotbar = new Hotbar(HOTBAR_MATS, settings.hotbarStyle);
const syncHotbar = () => hotbar.setState(editor.material, editor.tool);
hotbar.onSelect = (m) => editor.setMaterial(m);
hotbar.onTool = (t) => editor.setTool(t);
editor.onToolChange = syncHotbar;
editor.onEdit = () => {
  scheduleUnderside();
  bot.onWorldEdit();
};
syncHotbar();

// ---------------------------------------------------------------- look

/** Realistic-style assets; null until they've loaded (the stylised look shows meanwhile). */
let assets: Assets | null = null;
let terrain: TerrainMaterial | null = null;
let water: WaterMaterial | null = null;
const voxels = new VoxelTexture(world);
chunks.onRebuilt = () => voxels.touch();
const post = new PostFX(stage.renderer, stage.scene, stage.camera);
const realistic = () => settings.style === 'realistic' && assets !== null;
const DEFAULT_SUN = new THREE.Vector3(45, 70, 28).normalize();

function applyPalette(): void {
  const p = palette();
  const real = realistic();
  chunks.setRealistic(real ? { terrain: terrain!.material, water: water!.material } : null);
  chunks.setPalette(p, settings.grassStyle);
  sky.setPalette(p);
  sky.setReal(real ? assets!.env : null, settings.envIntensity);
  stage.scene.environment = real ? assets!.env : null;
  stage.scene.environmentIntensity = settings.envIntensity;
  stage.hemi.visible = !real;
  if (real) {
    // Light comes from where the sun is in the HDRI (kept high enough for readable shadows).
    const d = assets!.sunDir.clone();
    d.y = Math.max(d.y, 0.55);
    stage.sun.position.copy(stage.sun.target.position).addScaledVector(d.normalize(), 85);
    stage.sun.color.setHex(0xfff1df);
    stage.sun.intensity = 2.6;
    terrain!.uniforms.uPlaced.value.setHex(p.blocks.placed.top);
    terrain!.uniforms.uCrystal.value.setHex(p.blocks.crystal.side);
  } else {
    stage.sun.position.copy(stage.sun.target.position).addScaledVector(DEFAULT_SUN, 85);
    stage.sun.color.setHex(p.sun.color);
    stage.sun.intensity = p.sun.intensity;
  }
  stage.hemi.color.setHex(p.hemi.sky);
  stage.hemi.groundColor.setHex(p.hemi.ground);
  stage.hemi.intensity = p.hemi.intensity;
  bot.bot.setRealistic(real);
  hotbar.setColors(colorOf);
  applyMeshOptions();
  rebuildUnderside();
}

function applyQuality(): void {
  const high = settings.quality === 'high';
  const r = stage.renderer;
  r.setPixelRatio(Math.min(window.devicePixelRatio, high ? 2 : 1.5));
  r.setSize(window.innerWidth, window.innerHeight);
  const size = high ? 4096 : 2048;
  const shadow = stage.sun.shadow;
  if (shadow.mapSize.x !== size) {
    shadow.mapSize.set(size, size);
    shadow.map?.dispose();
    shadow.map = null;
  }
  terrain?.setLowQuality(!high);
  post.resize();
}

function applyMeshOptions(): void {
  // Realistic + High already gets screen-space AO, so the baked corner AO is softened.
  const s = settings.aoStrength * (realistic() && settings.quality === 'high' ? 0.7 : 1);
  chunks.opts.ao = settings.ao;
  chunks.opts.aoCurve = [1 - s, 1 - s * 0.62, 1 - s * 0.3, 1];
  world.markAllDirty();
}

applyQuality();
applyPalette();

loadAssets()
  .then((a) => {
    assets = a;
    terrain = createTerrainMaterial(a, voxels);
    water = createWaterMaterial();
    applyQuality();
    applyPalette();
  })
  .catch((err) => console.error('Realistic assets failed to load; staying stylised.', err));

createPanel(settings, stats, {
  onStyle: applyPalette,
  onQuality: () => {
    applyQuality();
    applyMeshOptions();
  },
  onEnvIntensity: applyPalette,
  onBloom: () => (post.bloom.strength = settings.bloom),
  onPalette: applyPalette,
  onHotbarStyle: () => hotbar.setStyle(settings.hotbarStyle),
  onMeshOptions: applyMeshOptions,
  onJitter: () => (chunks.jitter.value = settings.jitter),
  onShadows: () => (stage.sun.castShadow = settings.shadows),
  onWireframe: () => chunks.setWireframe(settings.wireframe),
  onExposure: () => (stage.renderer.toneMappingExposure = settings.exposure),
  onRegenerate: () => loadLevel(() => generateTestIsland(world, settings.seed)),
  onGauntlet: () => {
    let sp = { start: [0, 0, 0] as [number, number, number], goal: [0, 0, 0] as [number, number, number] };
    loadLevel(() => (sp = generateGauntlet(world)), undefined, () => sp);
  },
  onStress: () => loadLevel(() => generateStressLevel(world), { start: [2, 25, 2], goal: [61, 1, 61] }),
  onReveal: () => (bot.viz.duration = settings.revealSeconds),
  onVizStyle: () => bot.setVizStyle(settings.vizStyle),
  onBotModel: () => bot.setModel(settings.botModel),
  onInventory: () => bot.setInventory(settings.inventory),
});

type Spawn = { start: [number, number, number]; goal: [number, number, number] };
function loadLevel(generate: () => void, spawnAt?: Spawn, spawnFn?: () => Spawn): void {
  bot.forgetChanges();
  generate();
  history.clear();
  rebuildUnderside();
  const sp = spawnFn?.() ?? spawnAt ?? defaultSpawn(world);
  bot.setGoal(sp.goal);
  bot.setStart(sp.start);
}

window.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || e.target instanceof HTMLInputElement) return;
  e.preventDefault();
  (document.activeElement as HTMLElement | null)?.blur?.();
  bot.run();
});

// Dev-only handle for poking at the scene from the console.
if (import.meta.env.DEV) Object.assign(window, { __app: { stage, world, chunks, settings, editor, bot, applyPalette, applyQuality, post, getAssets: () => assets } });

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
  bot.update(dt, t);
  sky.update(t);
  stage.controls.update();
  if (water) water.time.value = t;
  if (settings.quality === 'high') post.render(dt);
  else stage.renderer.render(stage.scene, stage.camera);

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
