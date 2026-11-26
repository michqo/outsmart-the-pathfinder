import * as THREE from 'three';
import { BotController } from './bot/controller';
import { Editor, HOTBAR_MATS } from './edit/editor';
import { Handles } from './edit/handles';
import { islandLevel, SANDBOX, starsFor, type Level } from './levels/levels';
import { IslandClient } from './gen/client';
import { archRadius, archSpec, dailyLabel, dailySeed, islandAt, islandsAround, isOpen, neighbours, type ArchIsland } from './gen/archipelago';
import { generateIsland, islandKey, islandParams } from './gen/island';
import { tuneIsland } from './gen/tune';
import { cachedTuning, storeTuning } from './gen/tuneCache';
import { archPosition, islandProgress, recordIsland, setArchPosition, starredCount } from './levels/archProgress';
import { SkyIslands, type SkyBridge, type SkyIsland } from './render/skyIslands';
import { TIME_LIGHT, timeOfDayFor, type TimeOfDay } from './render/timeOfDay';
import { Drift } from './render/drift';
import { Biome } from './gen/island';
import { defaultSpawn } from './levels/spawn';
import type { Vec3i } from './path/protocol';
import { AlgorithmDuel, type DuelOpponent } from './path/duel';
import { openLevelsDialog, ScorePanel } from './ui/scorePanel';
import { Sfx, type Ambience } from './audio/sfx';
import { Corner } from './ui/corner';
import { HowTo } from './ui/howTo';
import { EditHistory } from './edit/history';
import { blockFaces, grassFaces, PALETTES } from './palette';
import { ChunkRenderer } from './render/chunks';
import { createStage } from './render/scene';
import { Sky } from './render/sky';
import { buildUnderside } from './render/underside';
import { Hotbar } from './ui/hotbar';
import { Hud } from './ui/hud';
import { createPanel, type Settings, type Stats } from './ui/panel';
import { loadAssets, type Assets } from './render/assets';
import { FollowCam } from './render/followCam';
import { LoadingScreen } from './ui/loading';
import { ignoreGameShortcut } from './ui/modal';
import { CharacterPicker, storedCharacter } from './ui/characterPicker';
import { renderThumbnails } from './render/characters';
import { BotView } from './render/bot';
import { createTerrainMaterial, createWaterMaterial, VoxelTexture, type TerrainMaterial, type WaterMaterial } from './render/terrain';
import { Mat } from './world/materials';
import { generateTestIsland } from './world/testIsland';
import { sameDims, World, type Dims } from './world/world';

const settings: Settings = {
  envIntensity: 0.45,
  realism: 0.5,
  clouds: 0.45,
  wind: 1,
  palette: 'meadow',
  grassStyle: 'drip',
  revealSeconds: 1.5,
  vizStyle: 'glow',
  botModel: storedCharacter() ?? 'capsule',
  ao: true,
  aoStrength: 0.5,
  jitter: 0.07,
  shadows: true,
  wireframe: false,
  exposure: 1.0,
};
const stats: Stats = { fps: 0, frameMs: 0, triangles: 0, remeshMs: 0, undersideMs: 0 };

const stage = createStage();
const world = new World();
const chunks = new ChunkRenderer(world);
/** The rest of the archipelago, drawn around the current island. */
const skyIslands = new SkyIslands();
const sky = new Sky();
stage.island.add(chunks.group);
/** Blossom, fireflies, sand, snow and embers over the biomes. */
const drift = new Drift();
stage.island.add(drift.group);
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
    case Mat.Sand: return blockFaces(p, 'sand').top;
    case Mat.Mud: return blockFaces(p, 'mud').top;
    case Mat.Timber: return blockFaces(p, 'timber').side;
    case Mat.Leaves: return blockFaces(p, 'leaves').top;
    case Mat.Magma: return blockFaces(p, 'magma').top;
    case Mat.Snow: return blockFaces(p, 'snow').top;
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

generateTestIsland(world, 7);
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
    blocks: SANDBOX.inventory,
    colorOf,
    onWorldChanged: () => scheduleUnderside(),
    onRunEnd: (arrived, nodes, edited) => onRunEnd(arrived, nodes, edited),
    onSound: (s, mat) => sfx.play(s, mat),
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
const hotbar = new Hotbar(HOTBAR_MATS);
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
  if (cells.length) {
    const now = world.data[cells[0]];
    sfx.play(now === Mat.Air ? 'remove' : 'place', now === Mat.Air ? history.lastBefore : now);
  }
  scheduleUnderside();
  bot.onWorldEdit(cells);
  if (cells.length > 0) invalidateDuel();
};
hotbar.onUndo = () => editor.undo();
const follow = new FollowCam(stage, (out) => bot.followTarget(out), (out) => bot.facing(out));
syncHotbar();

// ---------------------------------------------------------------- look

/** Textures and sky for the full look; null until they've loaded (simple flat colours show meanwhile). */
let assets: Assets | null = null;
let terrain: TerrainMaterial | null = null;
let water: WaterMaterial | null = null;
const voxels = new VoxelTexture(world);
chunks.onRebuilt = () => voxels.touch();
const realistic = () => assets !== null;
/**
 * The daytime sun: high and off to the left of the default view, so shadows fall across the
 * island where you can see them rather than straight behind each block.
 */
const DAY_SUN = new THREE.Vector3(-0.5, 0.66, 0.62).normalize();

/** The current course's time of day (see timeOfDay.ts). */
let timeOfDay: TimeOfDay = 'day';

/** Where the sun (or moon) stands for the course's time of day. */
function timedSun(): THREE.Vector3 {
  if (timeOfDay === 'day') return DAY_SUN.clone();
  const t = TIME_LIGHT[timeOfDay];
  const flat = Math.sqrt(1 - t.elevation * t.elevation);
  return new THREE.Vector3(Math.cos(t.bearing) * flat, t.elevation, Math.sin(t.bearing) * flat);
}

function applyPalette(): void {
  const p = palette();
  const real = realistic();
  const tl = TIME_LIGHT[timeOfDay];
  const timed = timedSun();
  sky.setTime(tl);
  chunks.setRealistic(real ? { terrain: terrain!.material, water: water!.material } : null);
  chunks.setPalette(p, settings.grassStyle);
  sky.setPalette(p);
  sky.setReal(real ? (assets!.env as THREE.DataTexture) : null, 1, real ? timed : undefined);
  skyIslands.setPalette(p, settings.grassStyle);
  skyIslands.setHaze(sky.hazeColor());
  stage.scene.environment = real ? assets!.env : null;
  stage.scene.environmentIntensity = settings.envIntensity * tl.ambient;
  stage.renderer.toneMappingExposure = settings.exposure * tl.exposure;
  stage.hemi.visible = !real;
  if (real) {
    // The sky image only fills in ambient light, kept low so the sun's shadows read.
    const d = timed.clone();
    d.y = Math.max(d.y, 0.22);
    stage.sun.position.copy(stage.sun.target.position).addScaledVector(d.normalize(), 85);
    stage.sun.color.setHex(0xfff1df).multiply(new THREE.Color(tl.sunColor));
    stage.sun.intensity = 4 * tl.sun;
    terrain!.uniforms.uPlaced.value.setHex(p.blocks.placed.top);
    terrain!.uniforms.uCrystal.value.setHex(p.blocks.crystal.side);
    const u = terrain!.uniforms;
    u.uRealism.value = settings.realism;
    u.uGrassTop.value.setHex(p.blocks.grass.top);
    u.uGrassSide.value.setHex(p.blocks.grass.side);
    u.uSoil.value.setHex(p.blocks.soil.side);
    u.uStone.value.setHex(p.blocks.stone.side);
    (['sand', 'mud', 'timber', 'leaves', 'magma', 'snow'] as const).forEach((k, i) => u.uExtra.value[i].setHex(k === 'timber' ? blockFaces(p, k).side : blockFaces(p, k).top));
  } else {
    const d = timed.clone().setY(Math.max(timed.y, 0.22)).normalize();
    stage.sun.position.copy(stage.sun.target.position).addScaledVector(d, 85);
    stage.sun.color.setHex(p.sun.color).multiply(new THREE.Color(tl.sunColor));
    stage.sun.intensity = p.sun.intensity * tl.sun;
  }
  stage.hemi.color.setHex(p.hemi.sky);
  stage.hemi.groundColor.setHex(p.hemi.ground);
  stage.hemi.intensity = p.hemi.intensity * tl.ambient;
  bot.bot.setRealistic(real);
  hotbar.setColors(colorOf);
  applyMeshOptions();
  rebuildUnderside();
}

function applyMeshOptions(): void {
  const s = settings.aoStrength;
  chunks.opts.ao = settings.ao;
  chunks.opts.aoCurve = [1 - s, 1 - s * 0.62, 1 - s * 0.3, 1];
  world.markAllDirty();
}

applyPalette();

function upgradeTerrain(): void {
  void loadAssets().then((a) => {
    terrain = createTerrainMaterial(a, voxels, sky.cloud, stage.island.position, chunks.tint);
    water = createWaterMaterial();
    assets = a;
    applyPalette();
  }).catch((err) => {
    console.error('Terrain textures failed to load; keeping the simple look.', err);
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

createPanel(settings, stats, {
  onEnvIntensity: applyPalette,
  onClouds: () => {
    sky.cloud.uCover.value = settings.clouds;
    sky.cloud.uWind.value.set(4.5, 1.6).multiplyScalar(settings.wind);
  },
  onRealism: () => terrain && (terrain.uniforms.uRealism.value = settings.realism),
  onPalette: applyPalette,
  onMeshOptions: applyMeshOptions,
  onJitter: () => (chunks.jitter.value = settings.jitter),
  onShadows: () => (stage.sun.castShadow = settings.shadows),
  onWireframe: () => chunks.setWireframe(settings.wireframe),
  onExposure: () => (stage.renderer.toneMappingExposure = settings.exposure * TIME_LIGHT[timeOfDay].exposure),
  onReveal: () => (bot.viz.duration = settings.revealSeconds),
  onVizStyle: () => bot.setVizStyle(settings.vizStyle),
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
}

let course!: Course;
/** Cells the player has touched since the level loaded (budget = how many now differ from the start). */
const touched = new Set<number>();
let sandboxBest = 0;
let duel: AlgorithmDuel | null = null;
let duelActive = false;
let opponent: DuelOpponent = 'dijkstra';

const score = new ScorePanel({
  onLevels: (opener) =>
    openLevelsDialog({
      arch: { seed: archSeed, daily: archSeed === dailySeed(), dailyLabel: dailyLabel(), starred: starredCount(archSeed), away: !archHere },
      sandbox: SANDBOX,
      current: course.level.id,
      onPick: (l) => startLevel(l),
      onArch: (action, seed) => {
        if (action === 'here') void goToIsland(archSeed, lastArchIsland(), false);
        else if (action === 'home') void goToIsland(archSeed, islandAt(archSeed, 0, 0)!, true);
        else {
          const next = action === 'daily' ? dailySeed() : action === 'random' ? crypto.getRandomValues(new Uint32Array(1))[0] : seed!;
          void goToIsland(next, islandAt(next, 0, 0)!, false);
        }
      },
    }, opener),
  onReset: () => applyCourse(course, duelActive),
  onDuelToggle: () => setDuelMode(!duelActive),
  onOpponent: (next) => {
    opponent = next;
    duel?.clear();
    score.setDuel(true, opponent);
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
  duelActive = active;
  duel?.clear();
  if (duelActive) bot.prepare();
  hud.setVisible(!duelActive);
  corner.setMode(duelActive);
  wasBusy = false;
  score.setDuel(duelActive, opponent);
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
    duel ??= new AlgorithmDuel(stage, (results) => score.setDuelResults(results), comparisonError);
    duel.run(world, bot.home, bot.goal, bot.blocksTotal, opponent, settings.revealSeconds);
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
  score.setEdits(used, budget);
  return true;
}

function onRunEnd(arrived: boolean, nodes: number, edited: boolean): void {
  const { level } = course;
  const practice = level.budget !== null && edited;
  let newBest = false;
  if (arrived && !practice) {
    if (archHere && level.kind === 'island') newBest = islandResult(archHere, starsFor(level, nodes), nodes);
    else if (nodes > sandboxBest) (sandboxBest = nodes), (newBest = true);
  }
  if (newBest) sfx.play('best');
  score.setResult(arrived, nodes, newBest, practice);
}

function startLevel(level: Level): void {
  const sp = level.generate(world);
  applyCourse({ level, dims: { sx: world.sx, sy: world.sy, sz: world.sz }, world: world.data.slice(), start: sp.start, goal: sp.goal, inventory: level.inventory });
}

const islands = new IslandClient();

// ---------------------------------------------------------------- archipelago

/** The archipelago being played (its seed), and the island you're on (null = elsewhere). */
let archSeed = dailySeed();
let archHere: ArchIsland | null = null;
let archRequest = 0;
let flight: { from: THREE.Vector3; to: THREE.Vector3; t: number; done: () => void } | null = null;
stage.scene.add(skyIslands.group);
skyIslands.onPick = (a) => void goToIsland(archSeed, a, true);

const inArchipelago = () => archHere !== null;
const starsOn = (a: ArchIsland) => islandProgress(archSeed, a.ix, a.iz).stars;
const archName = (a: ArchIsland) => (a.ring === 0 ? 'Home island' : `Island ${a.ix}, ${a.iz}`);

/** The island you were last on in this archipelago (home if none). */
function lastArchIsland(): ArchIsland {
  const pos = archPosition();
  return (pos?.seed === archSeed && islandAt(archSeed, pos.at[0], pos.at[1])) || islandAt(archSeed, 0, 0)!;
}

function archLevel(a: ArchIsland, spec: ReturnType<typeof archSpec>, island: Parameters<typeof islandLevel>[1], tuning: Parameters<typeof islandLevel>[2]): Level {
  const level = islandLevel(spec, island, tuning, archName(a));
  level.time = timeOfDayFor(spec.seed, a.ix, a.iz);
  level.hint = `${level.hint} Zoom out to see the other islands; ★ here opens bridges to its neighbours.`;
  return level;
}

/** Generates and surveys an island (cached surveys skip the work). */
async function loadArchIsland(seed: number, a: ArchIsland, onProgress: (f: number) => void): Promise<Level> {
  const spec = archSpec(seed, a);
  const cached = cachedTuning(spec, a.tier);
  const { island, tuning } = await islands.generate(spec, cached ? undefined : a.tier, onProgress);
  const t = cached ?? tuning!;
  if (!cached) storeTuning(spec, t);
  return archLevel(a, spec, island, t);
}

/** Window scale (as in fitStage) of an island, without generating it. */
const windowScale = (seed: number, a: ArchIsland) => (Math.ceil((islandParams(archSpec(seed, a)).size + 8) / 16) * 16) / 64;

/** Travels to an island: flies there over the sky when it's in view, else just loads it. */
async function goToIsland(seed: number, a: ArchIsland, fly: boolean): Promise<void> {
  const req = ++archRequest;
  if (seed !== archSeed || !archHere) fly = false;
  if (!fly && archHere && seed === archSeed && a.ix === archHere.ix && a.iz === archHere.iz && course.level.kind === 'island') return;
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
  arriveAt(a, level, !!offset);
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

/** Zoomed out far enough for the other islands' markers: the island spans < 60% of the screen's narrower side. */
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

function arriveAt(a: ArchIsland, level: Level, flown: boolean): void {
  if (flown) stageScale = windowScale(archSeed, a); // the flight already zoomed the camera
  archHere = a;
  skyIslands.setOrigin(a.centre);
  startLevel(level);
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
      radius: archRadius(archSpec(seed, a)),
      open: isOpen(seed, a, starsOf),
      stars: starsOf(a),
      current: a.ix === here.ix && a.iz === here.iz,
    });
  const missing = skyIslands.setIslands([...infos.values()]);
  void (async () => {
    for (const a of missing) {
      try {
        const lod = await islands.lod(archSpec(seed, a));
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

/** A finished run on an archipelago island: record it, open bridges on the first ★. True = new best. */
function islandResult(a: ArchIsland, stars: number, nodes: number): boolean {
  const had = starsOn(a);
  const before = new Map(islandsAround(archSeed, a.ix, a.iz, 2).map((b) => [`${b.ix},${b.iz}`, starsOn(b)]));
  const better = recordIsland(archSeed, a.ix, a.iz, nodes, stars);
  if (had > 0 || stars === 0) return better;
  const opened = neighbours(archSeed, a).filter((b) => !isOpen(archSeed, b, (c) => (c.ix === a.ix && c.iz === a.iz ? 0 : starsOn(c)))).length;
  refreshSky(a, before);
  if (opened) setTimeout(() => score.toast(`Bridges open: ${opened} new island${opened === 1 ? '' : 's'}. Zoom out to travel.`), 1600);
  return better;
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
    const spec = archSpec(archSeed, a);
    let tuning = cachedTuning(spec, a.tier);
    if (!tuning && a !== home) continue;
    const island = generateIsland(spec);
    if (!tuning) {
      const w = new World(island.dims.sx, island.dims.sy, island.dims.sz);
      w.data.set(island.data);
      tuning = tuneIsland(w, a.tier, islandKey(spec));
      storeTuning(spec, tuning);
    }
    arriveAt(a, archLevel(a, spec, island, tuning), false);
    if (a !== target) void goToIsland(archSeed, target, false);
    return;
  }
}

/** The ambient bed for a course: its time, and how much of it is forest, snow, sand, lava or water. */
function ambienceFor(level: Level, time: TimeOfDay): Ambience {
  const share = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  let land = 0;
  if (level.biome) for (const b of level.biome) if (b) (share[b]++, land++);
  const f = (b: number) => (land ? share[b] / land : 0);
  return {
    time,
    forest: level.biome ? f(Biome.Forest) : 0.3,
    snowy: f(Biome.Snowy),
    desert: f(Biome.Desert),
    volcanic: f(Biome.Volcanic),
    wet: f(Biome.Wetlands),
  };
}

/** Lanterns at the start and flag, and a lamp on the bot, after dark. */
const lanterns = [0, 1].map(() => {
  const l = new THREE.PointLight(0xffb45e, 0, 16, 1.4);
  stage.island.add(l);
  return l;
});
const botLamp = new THREE.PointLight(0xffe6bf, 0, 12, 1.4);
stage.scene.add(botLamp);
const lampTmp = new THREE.Vector3();

function updateLanterns(): void {
  const on = TIME_LIGHT[timeOfDay].lanterns;
  [bot.home, bot.goal].forEach((c, i) => {
    lanterns[i].intensity = on * 26;
    lanterns[i].position.set(c[0] + 0.5, c[1] + 1.8, c[2] + 0.5);
  });
  botLamp.intensity = on * on * 14;
  bot.bot.root.getWorldPosition(lampTmp);
  botLamp.position.set(lampTmp.x, lampTmp.y + 2.2, lampTmp.z);
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
  const time = c.level.time ?? 'day';
  if (time !== timeOfDay) {
    timeOfDay = time;
    applyPalette();
  }
  sfx.setAmbience(ambienceFor(c.level, time));
  drift.set(world, c.level.biome, time);
  history.clear();
  touched.clear();
  sandboxBest = 0;
  rebuildUnderside();
  bot.setGoal(c.goal);
  bot.setStart(c.start);
  bot.setInventory(c.inventory);
  score.setLevel(c.level, archHere && c.level.kind === 'island' ? islandProgress(archSeed, archHere.ix, archHere.iz).best : 0);
  score.setEdits(0, c.level.budget);
  setDuelMode(compare);
}

startArchipelago();
// Share links were retired: drop an old one from the address bar.
if (location.hash.startsWith('#course=')) window.history.replaceState(null, '', location.pathname + location.search);

window.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || ignoreGameShortcut(e) || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  e.preventDefault();
  if (!e.repeat) runCurrentMode();
});

// Dev-only handle for poking at the scene from the console.
if (import.meta.env.DEV) Object.assign(window, { __app: { stage, world, chunks, sky, settings, editor, bot, applyPalette, getAssets: () => assets, follow, history, arch: { goToIsland, islandResult, here: () => archHere, seed: () => archSeed } } });

// ---------------------------------------------------------------- loop

const timer = new THREE.Timer();
let frames = 0;
let fpsTimer = 0;
let frameMsAcc = 0;

/**
 * Frame cap: 60 fps while something is happening (input in the last few seconds, the bot or a
 * duel running, the camera flying), 30 fps when the island just sits there. The wind, water
 * and drifting particles still move at 30, and a laptop stays quiet. 120 Hz screens would
 * otherwise double the work for nothing.
 */
let lastFrame = -Infinity;
let lastInput = 0;
for (const e of ['pointerdown', 'pointermove', 'wheel', 'keydown'])
  window.addEventListener(e, () => (lastInput = performance.now()), { passive: true, capture: true });

const loading = new LoadingScreen();
let firstFrame = true;
stage.renderer.setAnimationLoop((time) => {
  const active = time - lastInput < 3000 || wasBusy || flight !== null || glide !== null;
  if (time - lastFrame < (active ? 1000 / 60 : 1000 / 30) - 2) return;
  lastFrame = time;
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
  updateLanterns();
  drift.update(t, stage.camera, stage.renderer);
  stage.controls.update();
  skyIslands.update(dt, stage.camera, inArchipelago() && !flight && !busy && !duelActive && zoomedOut());
  if (water) water.time.value = t;
  stage.renderer.render(stage.scene, stage.camera);

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
