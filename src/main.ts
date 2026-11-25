import * as THREE from 'three';
import { BotController } from './bot/controller';
import { Editor, HOTBAR_MATS } from './edit/editor';
import { Handles } from './edit/handles';
import { courseFromHash, decodeLevel, encodeLevel, HASH_KEY } from './levels/codec';
import { LEVELS, levelById, SANDBOXES, type Level } from './levels/levels';
import { bestFor, bestScores, lastLevel, recordScore, setLastLevel } from './levels/progress';
import { defaultSpawn } from './levels/spawn';
import type { Vec3i } from './path/protocol';
import { openLevelsDialog, ScorePanel } from './ui/scorePanel';
import { Sfx } from './audio/sfx';
import { Corner } from './ui/corner';
import { HowTo } from './ui/howTo';
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
import { FollowCam } from './render/followCam';
import { LoadingScreen } from './ui/loading';
import { CharacterPicker, storedCharacter } from './ui/characterPicker';
import { renderThumbnails } from './render/characters';
import { BotView } from './render/bot';
import { createTerrainMaterial, createWaterMaterial, VoxelTexture, type TerrainMaterial, type WaterMaterial } from './render/terrain';
import { Mat } from './world/materials';
import { generateStressLevel, generateTestIsland } from './world/testIsland';
import { World } from './world/world';

const settings: Settings = {
  style: 'realistic',
  quality: 'medium',
  envIntensity: 1.0,
  bloom: 0.3,
  realism: 0.5,
  clouds: 0.45,
  wind: 1,
  palette: 'meadow',
  grassStyle: 'drip',
  hotbarStyle: 'chips',
  revealSeconds: 1.5,
  vizStyle: 'glow',
  botModel: storedCharacter() ?? 'capsule',
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
  underside = buildUnderside(world, palette(), realistic() ? { ...assets!.rock, uniforms: terrain!.uniforms } : null);
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
const sfx = new Sfx();
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
    onRunEnd: (arrived, nodes) => onRunEnd(arrived, nodes),
    onSound: (s) => sfx.play(s),
  },
  spawn.start,
  spawn.goal,
);

// Handles first: their capture listener must run before the editor's.
new Handles(stage, world, [
  { object: bot.bot.root, onDrop: (c) => canMoveSpawn() && bot.setStart(c), cell: () => bot.home },
  { object: bot.goalMarker.root, onDrop: (c) => canMoveSpawn() && bot.setGoal(c), cell: () => bot.goal },
]);

const history = new EditHistory();
const editor = new Editor(stage, world, history, colorOf);
const hotbar = new Hotbar(HOTBAR_MATS, settings.hotbarStyle);
const syncHotbar = () => hotbar.setState(editor.material, editor.tool);
hotbar.onSelect = (m) => editor.setMaterial(m);
hotbar.onTool = (t) => editor.setTool(t);
editor.onToolChange = syncHotbar;
editor.onEdit = (cells) => {
  if (!countEdits(cells)) {
    // Over the level's budget: take the edit straight back.
    history.undo(world);
    countEdits(history.lastCells);
    sfx.play('denied');
    score.toast(`Out of edits: this level allows ${course.level.budget}. Remove a block to free one.`);
    return;
  }
  if (cells.length) sfx.play(world.data[cells[0]] === Mat.Air ? 'remove' : 'place');
  scheduleUnderside();
  bot.onWorldEdit(cells);
};
hotbar.onUndo = () => editor.undo();
const follow = new FollowCam(stage, (out) => bot.followTarget(out));
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
  sky.setReal(real ? (assets!.env as THREE.DataTexture) : null, settings.envIntensity, real ? assets!.sunDir : undefined);
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
    const u = terrain!.uniforms;
    u.uRealism.value = settings.realism;
    u.uGrassTop.value.setHex(p.blocks.grass.top);
    u.uGrassSide.value.setHex(p.blocks.grass.side);
    u.uSoil.value.setHex(p.blocks.soil.side);
    u.uStone.value.setHex(p.blocks.stone.side);
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
  // High: full post chain. Medium: direct render, lighter shader. Low: also 1x pixels, small shadows.
  const q = settings.quality;
  const high = q === 'high';
  const r = stage.renderer;
  r.setPixelRatio(Math.min(window.devicePixelRatio, high ? 2 : q === 'medium' ? 1.5 : 1));
  r.setSize(window.innerWidth, window.innerHeight);
  const size = high ? 4096 : q === 'medium' ? 2048 : 1024;
  const shadow = stage.sun.shadow;
  if (shadow.mapSize.x !== size) {
    shadow.mapSize.set(size, size);
    shadow.map?.dispose();
    shadow.map = null;
  }
  terrain?.setLowQuality(!high);
  sky.setLowQuality(q === 'low');
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

const loading = new LoadingScreen();
loading.progress(0.02, 'Loading textures…');
loadAssets((done, total) => loading.progress((done / total) * 0.85, `Loading textures… ${done}/${total}`))
  .then(async (a) => {
    assets = a;
    terrain = createTerrainMaterial(a, voxels, sky.cloud, stage.island.position);
    water = createWaterMaterial();
    applyQuality();
    applyPalette();
    chunks.update();
    loading.progress(0.92, 'Compiling shaders…');
    // Compile every program now, so the first visible frames don't hitch.
    await stage.renderer.compileAsync(stage.scene, stage.camera);
  })
  .catch((err) => console.error('Realistic assets failed to load; staying stylised.', err))
  .finally(() => loading.done().then(() => onLoaded()));

/** Runs once the loading screen is gone: the character picker (shown on a first visit). */
function onLoaded(): void {
  const picker = new CharacterPicker(
    settings.botModel,
    (id) => {
      settings.botModel = id;
      bot.setModel(id);
      pane.refresh();
    },
    (onEach) =>
      renderThumbnails(() => {
        const v = new BotView('capsule');
        v.setRealistic(realistic());
        v.update(0, 0);
        return v.root;
      }, onEach),
  );
  if (!HowTo.seen) howTo.open(() => !storedCharacter() && picker.open());
  else if (!storedCharacter()) picker.open();
}

const howTo = new HowTo();
const corner = new Corner(sfx.muted, {
  onRun: () => bot.run(),
  onHelp: () => howTo.open(),
  onMute: (m) => sfx.setMuted(m),
});
let wasBusy = false;

const pane = createPanel(settings, stats, {
  onStyle: applyPalette,
  onQuality: () => {
    applyQuality();
    applyMeshOptions();
  },
  onEnvIntensity: applyPalette,
  onBloom: () => (post.bloom.strength = settings.bloom),
  onClouds: () => {
    sky.cloud.uCover.value = settings.clouds;
    sky.cloud.uWind.value.set(4.5, 1.6).multiplyScalar(settings.wind);
  },
  onRealism: () => terrain && (terrain.uniforms.uRealism.value = settings.realism),
  onPalette: applyPalette,
  onHotbarStyle: () => hotbar.setStyle(settings.hotbarStyle),
  onMeshOptions: applyMeshOptions,
  onJitter: () => (chunks.jitter.value = settings.jitter),
  onShadows: () => (stage.sun.castShadow = settings.shadows),
  onWireframe: () => chunks.setWireframe(settings.wireframe),
  onExposure: () => (stage.renderer.toneMappingExposure = settings.exposure),
  onRegenerate: () =>
    startLevel({ ...SANDBOXES[0], generate: (w) => (generateTestIsland(w, settings.seed), defaultSpawn(w)) }),
  onGauntlet: () => startLevel(levelById('gauntlet')!),
  onStress: () =>
    startLevel({
      ...SANDBOXES[0],
      id: 'stress',
      name: 'Stress test',
      hint: 'Nine floors of caves. A worst case for the search.',
      generate: (w) => (generateStressLevel(w), { start: [2, 25, 2], goal: [61, 1, 61] }),
    }),
  onReveal: () => (bot.viz.duration = settings.revealSeconds),
  onVizStyle: () => bot.setVizStyle(settings.vizStyle),
  onBotModel: () => bot.setModel(settings.botModel),
  onInventory: () => {
    if (course.level.budget !== null) return; // challenges fix the bot's blocks
    course.inventory = settings.inventory;
    bot.setInventory(settings.inventory);
  },
});

// ---------------------------------------------------------------- levels & score

/** What's loaded: a level plus the exact world, spawn and rules it started from. */
interface Course {
  level: Level;
  world: Uint8Array;
  start: Vec3i;
  goal: Vec3i;
  inventory: number;
  weight: number;
  /** A friend's score from a share link (0 = none). */
  dare: number;
}

let course!: Course;
/** Cells the player has touched since the level loaded (budget = how many now differ from the start). */
const touched = new Set<number>();
/** Sandbox: the last arrival's score, if nothing was edited since (shared as the dare). */
let lastScore = 0;
let sandboxBest = 0;

const score = new ScorePanel({
  onLevels: () =>
    openLevelsDialog(LEVELS, SANDBOXES, bestScores(), course.level.id, (l) => {
      clearHash();
      startLevel(l);
    }),
  onReset: () => applyCourse(course),
  onShare: () => void share(),
  onWeight: (w) => {
    if (course.level.budget !== null) return;
    course.weight = bot.weight = w;
    lastScore = 0;
  },
});

const canMoveSpawn = (): boolean => {
  if (course.level.budget === null) return true;
  sfx.play('denied');
  score.toast('Start and flag are fixed in challenges.');
  return false;
};

/** Recounts the budget after an edit. False = the edit went over it. */
function countEdits(cells: number[]): boolean {
  for (const c of cells) touched.add(c);
  let used = 0;
  for (const c of touched) {
    if (world.data[c] !== course.world[c]) used++;
    else touched.delete(c);
  }
  const budget = course.level.budget;
  if (budget !== null && used > budget) return false;
  lastScore = 0;
  score.setEdits(used, budget);
  return true;
}

function onRunEnd(arrived: boolean, nodes: number): void {
  const { level } = course;
  let newBest = false;
  if (arrived && level.budget !== null) newBest = recordScore(level.id, nodes);
  else if (arrived && nodes > sandboxBest) (sandboxBest = nodes), (newBest = true);
  if (arrived) lastScore = nodes;
  if (newBest) sfx.play('best');
  score.setResult(arrived, nodes, newBest);
}

function startLevel(level: Level, dare = 0): void {
  const sp = level.generate(world);
  applyCourse({ level, world: world.data.slice(), start: sp.start, goal: sp.goal, inventory: level.inventory, weight: level.weight, dare });
  if (level.budget !== null) setLastLevel(level.id);
}

/** Puts a course's world, spawn and rules in place (also what Reset does). */
function applyCourse(c: Course): void {
  course = c;
  bot.forgetChanges();
  world.data.set(c.world);
  world.version++;
  world.markAllDirty();
  history.clear();
  touched.clear();
  lastScore = sandboxBest = 0;
  rebuildUnderside();
  bot.setGoal(c.goal);
  bot.setStart(c.start);
  bot.weight = c.weight;
  bot.setInventory(c.inventory);
  settings.inventory = c.inventory;
  pane.refresh();
  const index = LEVELS.indexOf(c.level);
  score.setLevel(c.level, index >= 0 ? index : null, c.level.budget !== null ? bestFor(c.level.id) : 0, c.dare);
  score.setEdits(0, c.level.budget);
  score.setWeight(c.weight, c.level.budget === null);
}

/** Copy link: challenges share the level and your best; sandboxes share the whole world. */
async function share(): Promise<void> {
  const { level } = course;
  const challenge = level.budget !== null && LEVELS.includes(level);
  const dare = challenge ? bestFor(level.id) : lastScore;
  const text = await encodeLevel({
    mode: challenge ? 'challenge' : 'sandbox',
    levelId: challenge ? level.id : '',
    world: challenge ? null : bot.courseSnapshot(),
    start: bot.home,
    goal: bot.goal,
    inventory: bot.blocksTotal,
    weight: bot.weight,
    dare,
  });
  const url = `${location.origin}${location.pathname}#${HASH_KEY}${text}`;
  window.history.replaceState(null, '', url);
  try {
    await navigator.clipboard.writeText(url);
    score.toast(dare ? `Link copied: dare a friend to beat ${dare.toLocaleString('en-US')} nodes` : 'Link copied');
  } catch {
    score.toast('Copy the link from the address bar');
  }
}

function clearHash(): void {
  if (location.hash) window.history.replaceState(null, '', location.pathname + location.search);
}

/** Opens the course in the URL hash, if any. Returns false when there's none (or it's broken). */
async function openSharedCourse(): Promise<boolean> {
  const text = courseFromHash(location.hash);
  if (!text) return false;
  try {
    const s = await decodeLevel(text);
    if (s.mode === 'challenge') {
      const level = LEVELS.find((l) => l.id === s.levelId);
      if (!level) throw new Error(`unknown level ${s.levelId}`);
      startLevel(level, s.dare);
    } else {
      const level: Level = {
        ...SANDBOXES[0],
        id: 'shared',
        name: 'Shared course',
        hint: 'Someone built this for you. Run it, or change it and share it back.',
      };
      applyCourse({ level, world: s.world!, start: s.start, goal: s.goal, inventory: s.inventory, weight: s.weight, dare: s.dare });
    }
    return true;
  } catch (err) {
    console.warn('Could not open the shared course', err);
    score.toast("That link's course couldn't be opened");
    clearHash();
    return false;
  }
}

startLevel(levelById(lastLevel() ?? '') ?? LEVELS[0]);
void openSharedCourse();
window.addEventListener('hashchange', () => void openSharedCourse());

window.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || e.target instanceof HTMLInputElement) return;
  e.preventDefault();
  (document.activeElement as HTMLElement | null)?.blur?.();
  bot.run();
});

// Dev-only handle for poking at the scene from the console.
if (import.meta.env.DEV) Object.assign(window, { __app: { stage, world, chunks, sky, settings, editor, bot, applyPalette, applyQuality, post, getAssets: () => assets, follow, history } });

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
  if (bot.busy !== wasBusy) corner.setBusy((wasBusy = bot.busy));
  follow.update(dt);
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
