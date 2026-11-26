import * as THREE from 'three';
import { BotController } from './bot/controller';
import { Editor, HOTBAR_MATS } from './edit/editor';
import { Handles } from './edit/handles';
import { courseFromHash, decodeLink, encodeIsland, encodeLevel, HASH_KEY } from './levels/codec';
import { HEURISTIC_TRAP, islandLevel, LEVELS, levelById, riftworksLevel, SANDBOXES, starsFor, type Level } from './levels/levels';
import { IslandClient } from './gen/client';
import { archRadius, archSpec, dailyLabel, dailySeed, islandAt, islandsAround, isOpen, neighbours, type ArchIsland } from './gen/archipelago';
import { generateIsland, GEN_VERSION, ISLAND_SIZE, islandKey, islandParams } from './gen/island';
import { TUNE_VERSION, tuneIsland } from './gen/tune';
import { cachedTuning, storeTuning } from './gen/tuneCache';
import { archPosition, islandProgress, recordIsland, setArchPosition, starredCount } from './levels/archProgress';
import { SkyIslands, type SkyBridge, type SkyIsland } from './render/skyIslands';
import { bestFor, bestScores, recordScore, setLastLevel } from './levels/progress';
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
/** The rest of the archipelago, drawn around the current island. */
const skyIslands = new SkyIslands();
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
  skyIslands.setPalette(p, settings.grassStyle);
  skyIslands.setHaze(sky.hazeColor());
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
    openLevelsDialog({
      arch: { seed: archSeed, daily: archSeed === dailySeed(), dailyLabel: dailyLabel(), starred: starredCount(archSeed), away: !archHere },
      sandboxes: SANDBOXES,
      best: bestScores(),
      current: course.level.id,
      onPick: (l) => {
        clearHash();
        startLevel(l);
      },
      onArch: (action, seed) => {
        clearHash();
        if (action === 'here') void goToIsland(archSeed, lastArchIsland(), false);
        else if (action === 'home') void goToIsland(archSeed, islandAt(archSeed, 0, 0)!, true);
        else {
          const next = action === 'daily' ? dailySeed() : action === 'random' ? crypto.getRandomValues(new Uint32Array(1))[0] : seed!;
          void goToIsland(next, islandAt(next, 0, 0)!, false);
        }
      },
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
    startLevel(riftworksLevel(seed));
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
    if (archHere && level.kind === 'island') islandResult(archHere, starsFor(level, nodes), nodes);
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
/**
 * Touch devices get smaller islands from the same seed (see PLAN.md, M8). Decided by the
 * input, not the window width, so resizing a desktop window never changes the island.
 */
const islandCap: number | undefined = matchMedia('(pointer: coarse)').matches ? ISLAND_SIZE.phone : undefined;
/**
 * The island size limit in play: this device's, or the sender's when you opened an island
 * link (so a dare is on the same island it was set on).
 */
let archCap: number | undefined = islandCap;

// ---------------------------------------------------------------- archipelago

/** The archipelago being played (its seed), and the island you're on (null = elsewhere). */
let archSeed = dailySeed();
let archHere: ArchIsland | null = null;
let archRequest = 0;
let flight: { from: THREE.Vector3; to: THREE.Vector3; t: number; done: () => void } | null = null;
stage.scene.add(skyIslands.group);
skyIslands.onPick = (a) => void goToIsland(archSeed, a, true, 0, archCap);

const inArchipelago = () => archHere !== null;
const starsOn = (a: ArchIsland) => islandProgress(archSeed, a.ix, a.iz, archCap).stars;
const archName = (a: ArchIsland) => (a.ring === 0 ? 'Home island' : `Island ${a.ix}, ${a.iz}`);

/** The island you were last on in this archipelago (home if none). */
function lastArchIsland(): ArchIsland {
  const pos = archPosition();
  return (pos?.seed === archSeed && islandAt(archSeed, pos.at[0], pos.at[1])) || islandAt(archSeed, 0, 0)!;
}

function archLevel(a: ArchIsland, spec: ReturnType<typeof archSpec>, island: Parameters<typeof islandLevel>[1], tuning: Parameters<typeof islandLevel>[2]): Level {
  const level = islandLevel(spec, island, tuning, archName(a));
  level.hint = `${level.hint} Zoom out to see the other islands; ★ here opens bridges to its neighbours.`;
  return level;
}

/** Generates and surveys an island (cached surveys skip the work). */
async function loadArchIsland(seed: number, a: ArchIsland, onProgress: (f: number) => void): Promise<Level> {
  const spec = archSpec(seed, a, archCap);
  const cached = cachedTuning(spec, a.tier);
  const { island, tuning } = await islands.generate(spec, cached ? undefined : a.tier, onProgress);
  const t = cached ?? tuning!;
  if (!cached) storeTuning(spec, t);
  return archLevel(a, spec, island, t);
}

/** Window scale (as in fitStage) of an island, without generating it. */
const windowScale = (seed: number, a: ArchIsland) => (Math.ceil((islandParams(archSpec(seed, a, archCap)).size + 8) / 16) * 16) / 64;

/** Travels to an island: flies there over the sky when it's in view, else just loads it. */
async function goToIsland(seed: number, a: ArchIsland, fly: boolean, dare = 0, cap = islandCap): Promise<void> {
  const req = ++archRequest;
  if (seed !== archSeed || cap !== archCap || !archHere) fly = false;
  if (!fly && archHere && seed === archSeed && cap === archCap && a.ix === archHere.ix && a.iz === archHere.iz && course.level.kind === 'island') return;
  archCap = cap;
  let pct = -1;
  const loading = loadArchIsland(seed, a, (f) => {
    const n = Math.round(f * 100);
    if (n >= pct + 10 || n === 100) score.toast(`Surveying the island… ${(pct = n)}%`);
  });
  let offset: THREE.Vector3 | null = null;
  if (fly) {
    offset = skyIslands.position(a);
    offset.y = 0;
    await flyTo(offset, windowScale(seed, a) / stageScale);
  }
  let level: Level;
  try {
    level = await loading;
  } catch (err) {
    console.error('Could not load the island', err);
    score.toast("That island couldn't be made");
    if (offset) snapCamera(offset); // back over the old island (still drawn at the origin)
    stage.controls.enabled = true;
    return;
  }
  if (req !== archRequest) return;
  if (offset) snapCamera(offset);
  stage.controls.enabled = true;
  archSeed = seed;
  arriveAt(a, level, dare, !!offset);
}

/** Animates the camera's target over to `to` (keeping its angle; `zoom` scales the distance). */
function flyTo(to: THREE.Vector3, zoom: number): Promise<void> {
  const { controls } = stage;
  controls.enabled = false;
  return new Promise((done) => {
    flight = { from: controls.target.clone(), to: to.clone().add(new THREE.Vector3(0, controls.target.y, 0)), t: 0, done };
    flightZoom = zoom;
  });
}
let flightZoom = 1;
let flightDist = 0;

function updateFlight(dt: number): void {
  if (!flight) return;
  const { camera, controls } = stage;
  if (flight.t === 0) flightDist = camera.position.distanceTo(controls.target);
  flight.t = Math.min(1, flight.t + dt / 1.6);
  const e = flight.t < 0.5 ? 2 * flight.t * flight.t : 1 - (-2 * flight.t + 2) ** 2 / 2;
  const dir = camera.position.clone().sub(controls.target).normalize();
  // Rise a little mid-flight so the hop reads as travel.
  const dist = flightDist * (1 + (flightZoom - 1) * e) * (1 + 0.6 * Math.sin(Math.PI * e));
  controls.target.lerpVectors(flight.from, flight.to, e);
  camera.position.copy(controls.target).addScaledVector(dir, dist);
  if (flight.t >= 1) {
    const done = flight.done;
    flight = null;
    done();
  }
}

/**
 * Zoomed out far enough for the other islands' markers: the current island spans less than
 * 60% of the screen's narrower side (so phones in portrait, which start further back, don't
 * show them during normal play).
 */
function zoomedOut(): boolean {
  const cam = stage.camera;
  const dist = cam.position.distanceTo(stage.controls.target);
  const narrow = 2 * dist * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * Math.min(1, cam.aspect);
  return Math.max(world.sx, world.sz) / narrow < 0.6;
}

/** Moves the view by -`by` (the new island is drawn where the old one was). */
function snapCamera(by: THREE.Vector3): void {
  stage.camera.position.sub(by);
  stage.controls.target.sub(by);
}

function arriveAt(a: ArchIsland, level: Level, dare: number, flown: boolean): void {
  if (flown) stageScale = windowScale(archSeed, a); // the flight already zoomed the camera
  archHere = a;
  skyIslands.setOrigin(a.centre);
  startLevel(level, dare);
  setArchPosition(archSeed, [a.ix, a.iz]);
  refreshSky();
  frameRoute();
}

/** A short camera glide on arrival (target and position), so the start and flag are in view. */
stage.controls.addEventListener('start', () => (glide = null)); // the player took the camera
let glide: { t: number; fromT: THREE.Vector3; toT: THREE.Vector3; fromP: THREE.Vector3; toP: THREE.Vector3 } | null = null;

/**
 * Points the camera at the start/flag route from a steep enough angle that spires and hills
 * don't hide either end, and far enough back that both fit on screen.
 */
function frameRoute(): void {
  const { camera, controls } = stage;
  const cell = (c: Vec3i) => new THREE.Vector3(c[0] + 0.5 - world.sx / 2, c[1], c[2] + 0.5 - world.sz / 2);
  const s = cell(bot.home), g = cell(bot.goal);
  // Aim between the route and the island's centre: both ends in view without losing the island.
  const toT = s.clone().add(g).multiplyScalar(0.5);
  toT.set(toT.x * 0.6, toT.y, toT.z * 0.6);
  const dir = camera.position.clone().sub(controls.target).normalize();
  // At most ~50° from straight down.
  const minY = 0.64;
  if (dir.y < minY) {
    const flat = Math.sqrt(Math.max(1e-6, dir.x * dir.x + dir.z * dir.z));
    const k = Math.sqrt(1 - minY * minY) / flat;
    dir.set(dir.x * k, minY, dir.z * k);
  }
  // Turn around the route until nothing hides the bot or the flag (nearest heading first).
  const flat = Math.atan2(dir.z, dir.x);
  const ring = Math.sqrt(1 - dir.y * dir.y);
  const turned = new THREE.Vector3();
  for (const step of [0, 1, -1, 2, -2, 3, -3, 4]) {
    const yaw = flat + (step * Math.PI) / 4;
    turned.set(Math.cos(yaw) * ring, dir.y, Math.sin(yaw) * ring);
    if (seen(s, turned) && seen(g, turned)) {
      dir.copy(turned);
      break;
    }
  }
  const span = Math.max(12, s.distanceTo(toT), g.distanceTo(toT)) * 2.4;
  const fit = span / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * Math.min(1, camera.aspect));
  const dist = Math.min(controls.maxDistance, Math.max(fit, camera.position.distanceTo(controls.target)));
  glide = { t: 0, fromT: controls.target.clone(), toT, fromP: camera.position.clone(), toP: toT.clone().addScaledVector(dir, dist) };
}

/** True when a ray from just above `p` towards the camera (along `dir`) clears the terrain. */
function seen(p: THREE.Vector3, dir: THREE.Vector3): boolean {
  const q = new THREE.Vector3();
  for (let t = 1; t < 90; t += 0.5) {
    q.copy(p).addScaledVector(dir, t);
    const x = Math.floor(q.x + world.sx / 2), y = Math.floor(q.y + 0.8), z = Math.floor(q.z + world.sz / 2);
    if (y >= world.sy) return true;
    if (!world.contains(x, y, z)) continue;
    const m = world.get(x, y, z);
    if (m !== Mat.Air && m !== Mat.Water) return false;
  }
  return true;
}

function updateGlide(dt: number): void {
  if (!glide) return;
  glide.t = Math.min(1, glide.t + dt / 0.9);
  const e = 1 - (1 - glide.t) ** 3;
  stage.controls.target.lerpVectors(glide.fromT, glide.toT, e);
  stage.camera.position.lerpVectors(glide.fromP, glide.toP, e);
  if (glide.t >= 1) glide = null;
}

function leaveArchipelago(): void {
  if (!archHere) return;
  archHere = null;
  archRequest++;
  skyIslands.setIslands([]);
  skyIslands.setBridges([]);
}

/** Rebuilds the islands and bridges in view; bridges touching `freshFrom` grow in. */
function refreshSky(freshFrom?: ArchIsland, before?: Map<string, number>): void {
  const here = archHere;
  if (!here) return;
  const seed = archSeed;
  const list = islandsAround(seed, here.ix, here.iz, 2);
  const stars = new Map(list.map((a) => [`${a.ix},${a.iz}`, starsOn(a)]));
  const starsOf = (a: ArchIsland) => stars.get(`${a.ix},${a.iz}`) ?? starsOn(a);
  const infos = new Map<string, SkyIsland>();
  for (const a of list)
    infos.set(`${a.ix},${a.iz}`, {
      a,
      radius: archRadius(archSpec(seed, a, archCap)),
      open: isOpen(seed, a, starsOf),
      stars: starsOf(a),
      current: a.ix === here.ix && a.iz === here.iz,
    });
  const missing = skyIslands.setIslands([...infos.values()]);
  void (async () => {
    for (const a of missing) {
      try {
        const lod = await islands.lod(archSpec(seed, a, archCap));
        if (archSeed !== seed || !archHere) return;
        skyIslands.provide(a, lod);
      } catch (err) {
        console.warn('No distant view for an island', err);
      }
    }
  })();
  const bridges: SkyBridge[] = [];
  const seen = new Set<string>();
  for (const info of infos.values())
    for (const n of neighbours(seed, info.a)) {
      const other = infos.get(`${n.ix},${n.iz}`);
      if (!other) continue;
      const k = [info, other].map((i) => `${i.a.ix},${i.a.iz}`).sort().join('|');
      if (seen.has(k)) continue;
      seen.add(k);
      if (!info.stars && !other.stars) continue;
      const touches = !!freshFrom && [info, other].some((i) => i.a.ix === freshFrom.ix && i.a.iz === freshFrom.iz);
      const wasOpen = !!before && [info, other].some((i) => (before.get(`${i.a.ix},${i.a.iz}`) ?? 0) > 0);
      bridges.push({ a: info, b: other, fresh: touches && !wasOpen });
    }
  skyIslands.setBridges(bridges);
}

/** A finished run on an archipelago island: record stars, open bridges on the first ★. */
function islandResult(a: ArchIsland, stars: number, nodes: number): void {
  const had = starsOn(a);
  const before = new Map(islandsAround(archSeed, a.ix, a.iz, 2).map((b) => [`${b.ix},${b.iz}`, starsOn(b)]));
  recordIsland(archSeed, a.ix, a.iz, archCap, nodes, stars);
  if (had > 0 || stars === 0) return;
  const opened = neighbours(archSeed, a).filter((b) => !isOpen(archSeed, b, (c) => (c.ix === a.ix && c.iz === a.iz ? 0 : starsOn(c)))).length;
  refreshSky(a, before);
  if (opened) setTimeout(() => score.toast(`Bridges open: ${opened} new island${opened === 1 ? '' : 's'}. Zoom out to travel.`), 1600);
}

/**
 * First load: the island you were on (or home of today's archipelago). Generated on the
 * main thread so the first frame has terrain; uncached surveys go to the worker.
 */
function startArchipelago(): void {
  const pos = archPosition();
  archSeed = pos?.seed ?? dailySeed();
  const target = (pos && islandAt(archSeed, pos.at[0], pos.at[1])) || islandAt(archSeed, 0, 0)!;
  const home = islandAt(archSeed, 0, 0)!;
  for (const a of target === home ? [home] : [target, home]) {
    const spec = archSpec(archSeed, a, archCap);
    let tuning = cachedTuning(spec, a.tier);
    if (!tuning && a !== home) continue;
    const island = generateIsland(spec);
    if (!tuning) {
      const w = new World(island.dims.sx, island.dims.sy, island.dims.sz);
      w.data.set(island.data);
      tuning = tuneIsland(w, a.tier, islandKey(spec));
      storeTuning(spec, tuning);
    }
    arriveAt(a, archLevel(a, spec, island, tuning), 0, false);
    if (a !== target) void goToIsland(archSeed, target, false);
    return;
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
  // In the archipelago you can zoom out far enough to see the neighbouring islands.
  stage.controls.maxDistance = inArchipelago() ? Math.max(700, 220 * k) : 220 * k;
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
  if (c.level.kind !== 'island') leaveArchipelago();
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
  if (level.kind === 'island' && archHere) return copyLink(await encodeIsland({
    seed: archSeed, ix: archHere.ix, iz: archHere.iz, cap: archCap ?? 0, dare: bestFor(level.id),
    genVersion: GEN_VERSION, tuneVersion: TUNE_VERSION,
  }), bestFor(level.id));
  if (!challenge && !sameDims(world, DEFAULT_DIMS)) {
    score.toast("Islands this big can't be shared as a sandbox");
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
  await copyLink(text, dare);
}

async function copyLink(text: string, dare: number): Promise<void> {
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
    const link = await decodeLink(text);
    if (link.v === 2) {
      const i = link.island;
      const a = islandAt(i.seed, i.ix, i.iz);
      if (!a) throw new Error('no island there');
      if (i.genVersion !== GEN_VERSION || i.tuneVersion !== TUNE_VERSION) score.toast('This link is from another version of the game: the island may differ');
      const cap = i.cap || undefined;
      if (cap !== islandCap) score.toast(cap ? 'Playing the smaller, touch-screen size of this island, as your friend did' : 'Playing the full size of this island, as your friend did');
      await goToIsland(i.seed, a, false, i.dare, cap);
      return true;
    }
    const s = link.level;
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

startArchipelago();
void openSharedCourse();
window.addEventListener('hashchange', () => void openSharedCourse());

window.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || ignoreGameShortcut(e) || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  e.preventDefault();
  if (!e.repeat) runCurrentMode();
});

// Dev-only handle for poking at the scene from the console.
if (import.meta.env.DEV) Object.assign(window, { __app: { stage, world, chunks, sky, settings, editor, bot, applyPalette, applyQuality, post, getAssets: () => assets, follow, history, arch: { goToIsland, islandResult, here: () => archHere, seed: () => archSeed } } });

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
  updateFlight(dt);
  updateGlide(dt);
  stage.controls.update();
  skyIslands.update(dt, stage.camera, inArchipelago() && !flight && !busy && !duelActive && zoomedOut());
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
