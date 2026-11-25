import * as THREE from 'three';
import { BotController } from './bot/controller';
import { Editor, HOTBAR_MATS } from './edit/editor';
import { Handles } from './edit/handles';
import { courseFromHash, decodeLevel, encodeLevel, HASH_KEY } from './levels/codec';
import { HEURISTIC_TRAP, islandLevel, LEVELS, levelById, riftworksLevel, SANDBOXES, type Level } from './levels/levels';
import { IslandClient } from './gen/client';
import { ISLAND_SIZE } from './gen/island';
import { bestFor, bestScores, lastLevel, recordScore, setLastLevel } from './levels/progress';
import { defaultSpawn } from './levels/spawn';
import type { Vec3i } from './path/protocol';
import { AlgorithmDuel, type DuelOpponent } from './path/duel';
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
import { ignoreGameShortcut } from './ui/modal';
import { CharacterPicker, storedCharacter } from './ui/characterPicker';
import { renderThumbnails } from './render/characters';
import { BotView } from './render/bot';
import { createTerrainMaterial, createWaterMaterial, VoxelTexture, type TerrainMaterial, type WaterMaterial } from './render/terrain';
import { Mat } from './world/materials';
import { generateStressLevel, generateTestIsland } from './world/testIsland';
import { DEFAULT_DIMS, sameDims, World, type Dims } from './world/world';

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
    onRunEnd: (arrived, nodes, edited) => onRunEnd(arrived, nodes, edited),
    onSound: (s) => sfx.play(s),
  },
  spawn.start,
  spawn.goal,
);

// Handles first: their capture listener must run before the editor's.
new Handles(stage, world, [
  { object: bot.bot.root, onDrop: (c) => moveSpawn(c, true), cell: () => bot.home },
  { object: bot.goalMarker.root, onDrop: (c) => moveSpawn(c, false), cell: () => bot.goal },
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
  if (course.level !== HEURISTIC_TRAP) bot.onWorldEdit(cells);
  if (cells.length > 0) invalidateDuel();
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

function upgradeTerrain(): void {
  void loadAssets().then((a) => {
    terrain = createTerrainMaterial(a, voxels, sky.cloud, stage.island.position, chunks.tint);
    water = createWaterMaterial();
    assets = a;
    applyQuality();
    applyPalette();
  }).catch((err) => {
    console.error('Realistic terrain failed to load; keeping stylised graphics.', err);
    assets = null;
    applyPalette();
  });
}

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
  onRun: runCurrentMode,
  onHelp: (opener) => howTo.open(undefined, opener),
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
  onBigIsland: () =>
    startLevel({
      ...SANDBOXES[0],
      id: 'big-island',
      name: 'Big island',
      hint: 'A 128×48×128 window: the test island at twice the size.',
      generate: (w) => (generateTestIsland(w, settings.seed, 2), defaultSpawn(w)),
    }),
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
    invalidateDuel();
  },
});

// ---------------------------------------------------------------- levels & score

/** What's loaded: a level plus the exact world, spawn and rules it started from. */
interface Course {
  level: Level;
  /** The window size `world` was built for. */
  dims: Dims;
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
let duel: AlgorithmDuel | null = null;
let duelActive = false;
let opponent: DuelOpponent = 'dijkstra';

const score = new ScorePanel({
  onLevels: (opener) =>
    openLevelsDialog(LEVELS, SANDBOXES, bestScores(), course.level.id, (l) => {
      clearHash();
      if (l.kind === 'island') void startIsland(l.seed);
      else startLevel(l);
    }, opener),
  onReset: () => applyCourse(course, duelActive),
  onShare: () => void share(),
  onWeight: (w) => {
    if (course.level.budget !== null) return;
    course.weight = bot.weight = w;
    lastScore = 0;
  },
  onDuelToggle: () => setDuelMode(!duelActive),
  onOpponent: (next) => {
    opponent = next;
    duel?.clear();
    score.setDuel(true, false, opponent);
  },
  onSeed: (seed) => {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
      score.toast('Enter a whole seed from 0 to 4,294,967,295.');
      return;
    }
    clearHash();
    if (course.level.kind === 'island') void startIsland(seed);
    else startLevel(riftworksLevel(seed));
  },
});

function moveSpawn(cell: Vec3i, start: boolean): boolean {
  if (course.level.budget !== null) {
    sfx.play('denied');
    score.toast('Start and flag are fixed in challenges.');
    return false;
  }
  const moved = start ? bot.setStart(cell) : bot.setGoal(cell);
  if (moved) invalidateDuel();
  return moved;
}

function setDuelMode(active: boolean): void {
  const trap = course.level === HEURISTIC_TRAP;
  duelActive = active || trap;
  duel?.clear();
  if (duelActive) bot.prepare();
  hud.setVisible(!duelActive);
  corner.setMode(duelActive);
  wasBusy = false;
  score.setDuel(duelActive, trap, trap ? 'weighted' : opponent);
}

function invalidateDuel(): void {
  if (!duelActive) return;
  duel?.clear();
  score.setDuelStatus('Course changed. Press Run to compare again.');
}

function runCurrentMode(): void {
  if (!duelActive) {
    bot.run();
    return;
  }
  bot.prepare();
  score.setDuelStatus('Comparing searches on the same course…');
  const comparisonError = (error: unknown) => {
    console.error('Algorithm Duel could not run.', error);
    score.setDuelStatus('Comparison failed. Press Run to try again.');
  };
  try {
    duel ??= new AlgorithmDuel(stage, (results) => score.setDuelResults(results, course.level === HEURISTIC_TRAP), comparisonError);
    duel.run(world, bot.home, bot.goal, bot.blocksTotal, course.level === HEURISTIC_TRAP ? 'weighted' : opponent, settings.revealSeconds);
  } catch (error) {
    duel?.clear();
    comparisonError(error);
  }
}

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

function onRunEnd(arrived: boolean, nodes: number, edited: boolean): void {
  const { level } = course;
  const practice = level.budget !== null && edited;
  let newBest = false;
  if (arrived && !practice) {
    if (level.budget !== null) newBest = recordScore(level.id, nodes);
    else if (nodes > sandboxBest) (sandboxBest = nodes), (newBest = true);
    lastScore = nodes;
  }
  if (newBest) sfx.play('best');
  score.setResult(arrived, nodes, newBest, practice);
}

function startLevel(level: Level, dare = 0): void {
  const sp = level.generate(world);
  const duel = level.kind === 'riftworks';
  if (duel) opponent = 'pareto';
  applyCourse({ level, dims: { sx: world.sx, sy: world.sy, sz: world.sz }, world: world.data.slice(), start: sp.start, goal: sp.goal, inventory: level.inventory, weight: level.weight, dare }, duel);
  if (LEVELS.includes(level)) setLastLevel(level.id);
}

const islands = new IslandClient();
let islandRequest = 0;
/** Phones get smaller islands from the same seed (see PLAN.md, M8). */
const islandCap = matchMedia('(max-width: 720px), (pointer: coarse)').matches ? ISLAND_SIZE.phone : undefined;

/** Generates an island in the worker, then opens it. A newer request wins. */
async function startIsland(seed = course?.level.kind === 'island' ? course.level.seed : undefined): Promise<void> {
  const id = ++islandRequest;
  score.toast('Raising the island…');
  try {
    const level = islandLevel(seed, undefined, islandCap);
    const island = await islands.generate({ seed: level.seed!, ix: 0, iz: 0, maxSize: islandCap });
    if (id !== islandRequest) return;
    startLevel(islandLevel(level.seed, island, islandCap));
  } catch (err) {
    console.warn('Island generation failed', err);
    score.toast("That island couldn't be generated");
  }
}

/** Window size the camera distance was last fitted to (1 = 64 wide). */
let stageScale = 1;

/** Centres the window under the camera and fits the sun's shadow box and zoom-out to its size. */
function fitStage(): void {
  stage.island.position.set(-world.sx / 2, 0, -world.sz / 2); // mutated in place: the cloud shadows share it
  const k = Math.max(world.sx, world.sz) / 64;
  const sc = stage.sun.shadow.camera;
  sc.left = sc.bottom = -55 * k;
  sc.right = sc.top = 55 * k;
  sc.far = 200 * k;
  sc.updateProjectionMatrix();
  stage.controls.maxDistance = 220 * k;
  // Pull the camera back (or in) by how much the window grew, keeping its angle.
  if (k !== stageScale) {
    const { camera, controls } = stage;
    camera.position.sub(controls.target).multiplyScalar(k / stageScale).add(controls.target);
    controls.update();
    stageScale = k;
  }
}

/** Puts a course's world, spawn and rules in place (also what Reset does). */
function applyCourse(c: Course, compare = false): void {
  course = c;
  bot.forgetChanges();
  if (!sameDims(world, c.dims)) world.reshape(c.dims.sx, c.dims.sy, c.dims.sz);
  world.data.set(c.world);
  world.version++;
  world.markAllDirty();
  fitStage();
  chunks.tint.set(c.level.biome, world.sx, world.sz);
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
  setDuelMode(compare);
}

/** Copy link: challenges share the level and your best; sandboxes share the whole world. */
async function share(): Promise<void> {
  const { level } = course;
  const challenge = LEVELS.includes(level) || level === HEURISTIC_TRAP;
  const dare = level === HEURISTIC_TRAP ? 0 : challenge ? bestFor(level.id) : lastScore;
  if (!challenge && (level.kind === 'island' || !sameDims(world, DEFAULT_DIMS))) {
    score.toast('Island links arrive with the archipelago');
    return;
  }
  const text = await encodeLevel({
    mode: challenge ? 'challenge' : 'sandbox',
    levelId: challenge ? level.id : level.kind === 'riftworks' ? `riftworks:${level.seed}` : '',
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
      const level = levelById(s.levelId);
      if (!level || level.budget === null) throw new Error(`unknown challenge ${s.levelId}`);
      startLevel(level, s.dare);
    } else {
      const seeded = /^riftworks:(\d{1,10})$/.exec(s.levelId);
      const seed = seeded ? Number(seeded[1]) : NaN;
      const level: Level = seed <= 0xffffffff ? riftworksLevel(seed) : {
        ...SANDBOXES[0],
        id: 'shared',
        name: 'Shared course',
        hint: 'Someone built this for you. Run it, or change it and share it back.',
      };
      const duel = level.kind === 'riftworks';
      if (duel) opponent = 'pareto';
      applyCourse({ level, dims: DEFAULT_DIMS, world: s.world!, start: s.start, goal: s.goal, inventory: s.inventory, weight: s.weight, dare: s.dare }, duel);
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
  if (e.code !== 'Space' || ignoreGameShortcut(e) || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  e.preventDefault();
  if (!e.repeat) runCurrentMode();
});

// Dev-only handle for poking at the scene from the console.
if (import.meta.env.DEV) Object.assign(window, { __app: { stage, world, chunks, sky, settings, editor, bot, applyPalette, applyQuality, post, getAssets: () => assets, follow, history } });

// ---------------------------------------------------------------- loop

const timer = new THREE.Timer();
let frames = 0;
let fpsTimer = 0;
let frameMsAcc = 0;

const loading = new LoadingScreen();
let firstFrame = true;
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
  duel?.update(dt, t);
  const busy = duelActive ? duel?.busy ?? false : bot.busy;
  if (busy !== wasBusy) corner.setBusy((wasBusy = busy));
  follow.update(dt);
  sky.update(t);
  stage.controls.update();
  if (water) water.time.value = t;
  if (settings.quality === 'high') post.render(dt);
  else stage.renderer.render(stage.scene, stage.camera);

  if (firstFrame) {
    firstFrame = false;
    void loading.done().then(() => {
      onLoaded();
      upgradeTerrain();
    });
  }

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
