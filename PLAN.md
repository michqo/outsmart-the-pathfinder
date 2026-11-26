# Outsmart the Pathfinder — Implementation Plan

Companion to [HANDOFF.md](HANDOFF.md). The handoff is the spec, and this file is the build order.
Tick the boxes as we go. Every milestone ends with: browser check → screenshot → commit.

---

## Decisions (settled 2026-11-19)

| Topic | Decision |
|---|---|
| Name | Keep the working title **"Outsmart the Pathfinder"**. Pick the final name before M6 |
| Bot | **Cute low-poly robot**: capsule body, one big eye, little legs. **Earnest and a bit clumsy**: squints while the search runs, hops for joy at the goal, wobbles on long drops |
| World | **64 × 32 × 64**, chunks 16³ (4 × 2 × 4 = 32 chunks) |
| Inventory | **16 blocks** by default, overridable per level |
| Deploy | **Vercel** (M6) |
| First push | **M0 → M2**, then stop and reassess |
| Git | Local `git init` now, one commit per milestone. GitHub + Vercel hookup later |
| Package manager | **npm** |
| Visual choices | **Live variants behind a Tweakpane dropdown**, plus screenshots. You pick |
| Ambient occlusion | **Vertex-color AO from M0**, built into the greedy mesher |
| Input | **Mouse + Mac trackpad**: mouse defaults, plus a place/remove toggle key and trackpad gestures |
| Test island | **Rolling hills + pond + crystal outcrop**, so every material is visible |
| Search playback | **~1.5 s fixed-duration reveal** by default. The speed slider goes from instant to slow-mo |
| Tests | **Vitest from M2** (heap, A\*, the 4 basic moves). Every move rule gets tests in M3 |
| Plan location | This file |

Final name: **Outsmart the Pathfinder** (decided at M6).

---

## Conventions

- **Coordinates:** Y-up. Voxel index `i = x + z*SX + y*SX*SZ`, stored in a flat `Uint8Array`. One helper module owns this and nothing else computes indices by hand.
- **Materials:** a `const enum Mat { Air, Grass, Soil, Stone, Crystal, Water, Placed }`. Its properties (diggable, hardness, solid, standable, color) live in one table in `world/materials.ts`.
- **Hot loops:** no per-node allocations. Typed arrays (`Float32Array` g-scores, `Int32Array` parents, `Uint8Array` flags), and a binary heap over node IDs.
- **Versions:** check the current three.js, Tweakpane, Vite and Vitest APIs with Context7 at the start of M0 and pin exact versions in `package.json`.
- **Originality check** at each milestone: nothing Minecraft-like in textures, UI, sounds or terminology ("blocks" is fine, "mine/craft/hotbar slots with item counts in the corner" is not).

---

## M0 — Scaffold (target: a pretty island you can orbit)

- [x] `npm create vite@latest` (vanilla-ts) into `outsmart-the-pathfinder/`. Strict TS, ESLint optional, Prettier
- [x] Context7: confirm the APIs. Pin `three`, `@types/three`, `tweakpane`, `vite`, `vitest`
- [x] `git init`, `.gitignore`, first commit
- [x] `.claude/launch.json` → `npm run dev` on port 5174 (5173 is taken by another project; also added as `pathfinder` in the parent folder's launch.json)
- [x] `src/palette.ts`: pastel material colors, warm sun, cool shadow/ambient, sky gradient stops. **2–3 palette variants** behind a Tweakpane dropdown
- [x] `render/scene.ts`: renderer (ACES tone mapping, sRGB), camera, OrbitControls (damped, clamped pitch, min/max distance), one directional light with soft shadows fitted to the island, hemisphere fill
- [x] `render/sky.ts`: a big inverted sphere with a gradient shader, plus 4–6 low-poly clouds drifting slowly
- [x] `world/world.ts`: the voxel store, get/set, bounds, chunk dirty flags
- [x] `world/testIsland.ts`: a hardcoded heightmap (cheap value noise + terraces). Grass on top, soil below, stone deeper, a pond (water), a crystal outcrop, and a tapered island silhouette
- [x] `world/mesher.ts`: **greedy meshing per chunk with per-vertex AO** (quads merge only when material + AO match). Per-block color jitter from a position hash. Flat shading via per-face normals. Water is a separate translucent mesh
- [x] `render/chunks.ts`: one `Mesh` per chunk, rebuilt only when dirty
- [x] `render/underside.ts`: first pass at the low-poly rocky stalactites under the island (procedural cones, jittered)
- [x] Tweakpane: FPS graph, palette picker, AO on/off (for comparison), shadow toggle
- [x] **Check:** done 2026-11-19, 120 fps / ~0.5–0.8 ms frame, 15k tris, full remesh ~16–25 ms (32 chunks). Palette: **Meadow** (picked 2026-11-20) — a steady 60 fps, screenshot of 2–3 palette variants → you pick → commit `M0`

## M1 — Editor (target: sculpt the island)

- [x] `edit/pick.ts`: DDA voxel raycast from the cursor (hit voxel + face normal). No three.js raycaster over meshes
- [x] A hover highlight: a soft outline cube on the target block, a ghost block on the placement face
- [x] Place / remove: left/right-click **and** a toggle key (`E` = place, `R` = remove) for the trackpad. Two-finger click = remove
- [x] Orbit/edit conflict: settled as click = edit, drag = orbit (6 px / 450 ms threshold). Shift claims the drag for the fill tool
- [x] Hotbar: an original-looking material picker (rounded pastel chips, number keys 1–6). **2 style variants**
- [x] Fill tool: Shift + drag → a flat rectangle on the start layer (Shift+⌥ = a vertical wall) → release to fill, right-button to clear. Capped at 24k voxels
- [x] Rebuild only the touched chunk(s), plus neighbor chunks when an edit sits on a chunk border (AO and face culling depend on neighbors)
- [x] Undo/redo (Cmd+Z / Shift+Cmd+Z): a cheap edit-diff stack. It makes building courses far nicer
- [x] Island underside: rebuilt 600 ms after editing pauses (~8 ms). Moving it off the main thread is a later option
- [x] Focus the camera on a point: **F or ⌥-click** instead of double-click, because a double-click would also place two blocks
- [x] Grass-side variants (Moss drip default, Top cap, Sage moss, Classic) to move away from the familiar grass-block look
- [x] Player-facing material names: Moss, Clay, Slate, Crystal, Water
- [x] **Check:** done 2026-11-20, single edits remesh in ~1 ms. Hotbar: **Chips** (picked 2026-11-20). Grass: Moss drip default — edits are hitch-free (measure the chunk rebuild time in Tweakpane), screenshot → commit `M1`

## M2 — Walking bot (target: the 10-second wow)

**Search core**
- [x] `path/heap.ts`: a binary min-heap over `Uint32` node IDs keyed by f-score. Supports decrease-key, or lazy deletion
- [x] `path/moves.ts`: a table-driven move set. **v1: walk ×4, diagonal ×4, step-up 1, drop 1–3.** The bot is 2 tall. Costs exactly as in HANDOFF §6
- [x] `path/astar.ts`: A\* over `(x,y,z)` (`blocksLeft` comes in M3), an octile-3D heuristic, a weight `w` parameter (UI in M5)
- [x] `path/worker.ts`: receives a world snapshot (a transferred `Uint8Array` copy) + start/goal. Time-sliced: expand for ~8 ms, post a **snapshot** (new open/closed IDs as transferred `Uint32Array`s), yield, repeat. Supports cancel
- [x] Vitest: heap ordering, each of the 4 move rules (positive + negative cases), A\* finds the optimal path on small hand-built worlds, unreachable goal → "no path"

**Visualization**
- [x] `render/searchViz.ts`: one `InstancedMesh` (max ~64k instances). Frontier = cyan, pulsing. Closed = fades to a dim, translucent blue over ~1 s. Driven by a playback queue so the default reveal takes **~1.5 s** whatever the node count. Speed slider: instant ↔ slow-mo
- [x] `render/pathRibbon.ts`: a bright ribbon along the path with arrow chevrons that scroll gently
- [x] **2–3 viz variants** (cube size/glow/fade) behind a dropdown

**Bot**
- [x] `render/bot.ts`: a procedural low-poly robot (capsule body, big eye, little legs, maybe an antenna). **2–3 model variants** behind a dropdown
- [x] `bot/executor.ts`: follows the path step by step, with interpolation per move type (walk = bob, step-up = small hop, drop = fall + squash on landing)
- [x] Personality: the eye squints/looks around while the search runs, a hop of joy at the goal, a wobble after a 3-block drop, a confused head-tilt on "no path"
- [x] Draggable start (the robot) and goal (a floating star-seed over a landing ring), snapped to standable cells
- [x] `Space` = run. Minimal HUD: nodes expanded, path length, path cost, search ms
- [x] Stress level (Debug → 9 stacked floors). A walled-off goal forces the full search: 35.7k nodes in 21.7 ms of worker time, no main-thread long tasks, playback under 0.1 ms per frame
- [x] **Check:** done 2026-11-20. Robot: **Capsule** (picked 2026-11-20) — with a search of ~50k nodes the frame time stays flat (Tweakpane graph), screenshot/GIF → commit `M2`

### ⏸ Reassess after M2
Review together: the look, the feel, performance, and whether the move-rule approach still makes sense. Then refine M3+.

---

## Later (outline, refined after M2)

- **M3 — World-changing moves:** ✅ done 2026-11-20
  - [x] State is `(x,y,z,blocksLeft)` in a hashed node store (memory follows nodes touched)
  - [x] Dig forward (feet/head, 1 + hardness each), dig down (only onto a block: never into a fall), bridge (3, spends 1), pillar (4, spends 1), swim (3, at the surface; climb out with a step-up)
  - [x] Hardness: Moss/Clay/placed 1, Slate 4, Crystal undiggable. **No refund** for dug blocks (decided 2026-11-20)
  - [x] Execution changes the world (drill shell + sparks + debris, springy place pop, working mood); placed blocks are a saturated orange
  - [x] Every step is re-checked against the real world first; a dig/bridge that's no longer needed becomes a walk; an impossible step triggers a visualised **replan** from where the bot stands
  - [x] **Course auto-restore** (decided 2026-11-20): Space undoes the bot's changes (player edits since win), refills the inventory and runs from home
  - [x] Path markers: spinning drill bits over blocks to dig, ghost blocks where it will build
  - [x] HUD: blocks left/total, dug, built. Inventory slider (0–32) in the Search panel
  - [x] Search cubes fade to 15 % while the bot walks
  - [x] Debug → "Gauntlet": moat, clay wall, chasm, crystal cliff (needs every move). 48 Vitest tests
  - ~~Known nit: underside rock spikes poke into deep chasms~~ fixed 2026-11-25: the underside is now one continuous rock mass hung from the island's real bottom (5.3k tris, triplanar rock), replacing ~400 overlapping cones
- **Realistic look:** ✅ done 2026-11-25 (Graphics → style: Realistic default, Stylised kept for comparison)
  - [x] Poly Haven CC0 assets in `public/assets` (credits in `CREDITS.md`): leafy grass, excavated soil, rock face 03 (1k diff/normal/ARM), Kloofendal puresky HDRI (2k)
  - [x] Terrain textures packed into texture arrays and mapped in world space (no per-block tiles). Two rotated samples are blended by noise to hide tiling. Grass is pulled toward green (the scan is mostly leaf litter); the moss drips over clay with a ragged edge
  - [x] A voxel 3D texture lets the shader find each face's material and **bevel only exposed edges** (no grid on flat ground)
  - [x] Crystal = glassy, faceted, faint glow; placed blocks = painted plastic; water = reflective, animated waves, fresnel opacity; the underside rocks use the rock scan
  - [x] HDRI lighting; the sun direction is read from the HDRI. Sky dome = HDRI above the horizon, mirrored haze below (the island floats in sky)
  - [x] Robot keeps its design with clearcoat paint, anodised trim, brushed-metal legs and a glowing lens eye
  - [x] Post (High): MSAA → GTAO (half res, transparent objects hidden from its pre-pass) → bloom (quarter res, threshold 2.6) → ACES → grade + vignette
  - [x] Quality: **High** (DPR ≤ 2, 4k shadows, post, 2-sample anti-tiling) / **Low** (DPR ≤ 1.5, 2k shadows, no post, 1 sample)
  - [x] Perf: High 5.7 ms/frame at 2048×1536 (12.8 ms before the half/quarter-res AO and bloom), Low 2.7 ms at 1024×768. Projected ~10 ms full-screen on a Retina MacBook
- **Loading + characters:** ✅ done 2026-11-25
  - [x] Loading screen in `index.html` (shows before JS), with file progress and a shader precompile, so the stylised look never flashes
  - [x] Lag fix: new **Medium** default (direct render, no GTAO/bloom, 1 texture sample, DPR ≤ 1.5, 2k shadows): ~3 ms/frame. High keeps the full post chain
  - [x] Less photographic terrain: a "texture realism" slider (default 0.5) blends the scans with soft palette colours
  - [x] Minecraft characters declined (another game's IP). Instead, **Kenney Blocky Characters 2.0** (CC0, 18 characters) with animations mapped per mood: idle / walk / dig (melee swing) / emote yes (goal) / emote no (stuck)
  - [x] Character picker dialog with 3D-rendered thumbnails: opens after loading on a first visit, remembers the choice, reopens via the HUD button or **C**
- **M4 — Live replanning:** ✅ done 2026-11-25 (choices: replan only when an edit touches the path; auto-follow during runs + toggle; bonk back on the step in progress)
  - [x] Edits report the voxels they changed (edit, undo, redo). `bot/pathTouch.ts` computes what the remaining path depends on: target feet/head/floor, hop room for step-ups and pillars, side columns for diagonals, the air column for drops
  - [x] While searching, any edit restarts the search (its world copy is stale). With the path shown or while walking: only edits that touch the path count. An edit further ahead → replan when the bot reaches the next cell. An edit on the step in progress → it **bonks** (startled hop back), cancels the drill/place in progress (a half-placed block goes back in the bag), then replans
  - [x] Replans are visualised: red pulsing cages on the edits that mattered, the abandoned path stays dashed until the new one draws, a fresh search from the bot, and a REPLANS counter in the HUD
  - [x] Follow camera: glides the orbit target after the bot during runs, keeping your angle and zoom. Toggle with the HUD switch or **V**
  - [x] 6 new tests (54 total)
- **M5 — Game layer:** ✅ done 2026-11-25. Score = nodes expanded over the whole run, counted only when the bot arrives; best per level saved. 6 challenges (tutorial → hard) with fixed start/goal, an edit budget and ★ targets calibrated by a hill-climb (`CALIBRATE=1`); Free build + Gauntlet sandboxes. Share links (RLE + deflate-raw → base64url in `#course=`) carry the level or the whole sandbox world plus your best as a dare. Weighted-A\* slider (1–5) in sandboxes.
- **M6 — Polish + deploy:** ✅ done 2026-11-25 (deploy pending: GitHub repo + Vercel by the owner). Final name kept: **Outsmart the Pathfinder**. 3-card how-to-play on first visit (then the character picker), reopen with ? / H. WebAudio synth blips (place, remove, search ticks, dig, pop, bonk, arrive, stuck, new best, denied) with a remembered mute. Run / ? / mute corner buttons, undo in the hotbar. Touch: tap to place, a second finger cancels the tap (pinch/pan), phone layout (compact HUD on top, collapsible score panel, swatch-only hotbar, Tweakpane hidden), portrait camera fit. Textures recompressed (8.9 → 4.3 MB), three.js split into its own chunk, meta tags + SVG favicon, README.
- **Ground + sky pass** (2026-11-25): the rock under the island hangs from each corner's highest column bottom, which closes the see-through gaps at the ragged rim (`tests/underside.test.ts` fires rays at the pockets under every level, plus an edited island). The rock uses the stone's palette blend. Realistic sky: a clear-sky gradient measured from the HDRI, a sun glow, and a drifting procedural cloud layer (wind + cover sliders). The same clouds cast moving shadows on the terrain (direct light plus most of the image-based light), and a sunlit sea of clouds lies below the island.

### M6 release checks

- [x] Challenge edits during a run make it practice-only, even if undone; live replanning still works.
- [x] Show recovery instructions if WebGL 2 is unavailable. Render the playable stylised island before loading realistic textures, and defer thumbnails until the character picker opens.
- [x] Keep focus in onboarding, character and level dialogs; restore focus when they close and preserve the A* slider's native keyboard controls.
- [ ] Deploy a Vercel Preview (Vite, Node.js 24.x, `npm run build`, `dist`).
- [ ] Smoke-test first visit, touch input, live replanning, score persistence and both share link types on desktop Chrome and real iPhone Safari. Promote, then repeat the smoke check on production.

**Algorithm Duel:** compare A* with Dijkstra, Weighted A*, or Pareto A* on the same snapshot. The traces play at a shared event rate; the scoreboard reports worker compute time separately. Riftworks generates a 36-room maze from a seed, with a connected route and dig, swim, or bridge shortcuts. Pareto A* prunes costlier arrivals that leave fewer blocks; on seed 47 it expands 4,394 states vs. 15,948 for A*, with the same planned cost. Heuristic Trap is a separate six-edit puzzle. Duel routes are verified on independent world copies. D* Lite and the search inspector remain follow-ups.

## Next: the Archipelago (proposed 2026-11-25)

**Choices:** an endless seeded sky of floating islands (the archipelago); a generator that prioritises **search-aware tuning**, **erosion + rivers/lakes** and **biomes + structures**; generated islands **replace the hand-made levels**.

**The idea:** every island is a level. The archipelago grows outward from a small home island; difficulty rises with distance from home. Earning ★ on an island grows a bridge to its neighbours, so progress shows on the map. A seed defines the whole archipelago, so there's a daily seed, a seed box and Random, and every island is reproducible.

### Key design

- **Course window.** The sky is stored sparsely (16³ chunks in a map), but a run only ever happens on one island. The active island's bounding box (≤ 128×48×128 plus a margin) is copied into a dense array with an offset, and A*, the worker, the search viz, the voxel texture and the bot keep working on that window as they do today. This keeps the proven code and bounds every search.
- **Islands in the sky.** Layout = a seeded jittered grid (about 160 units per cell, 0–1 island each, varied size 32–112 and height). Home island at the origin, ring number = difficulty tier.
- **Generator pipeline (per island, in a worker, deterministic integer-hash noise, versioned):**
  1. Shape: a domain-warped island mask, so outlines aren't blobs.
  2. Heightmap + **hydraulic erosion** (particle droplets) for gullies, valleys and fans.
  3. **Water:** flow accumulation carves rivers; basins fill into lakes (swim-cost decisions).
  4. **Biomes** from temperature/moisture: meadow (moss/clay), highlands (slate, slow digs), crystal fields (undiggable walls), wetlands (water), badlands (clay mesas). The material mix changes move costs, so each biome plays differently.
  5. **Structures:** template + wave-function-collapse pieces (ruins, gates, maze rooms). Riftworks becomes one of these.
  6. Underside rock as today, per island.
- **Search-aware tuning** (the part only this game has). After generating, the worker:
  - picks start/flag pairs that score as interesting: path cost vs straight line, nodes per step (heuristic deception), moves required (swim, dig, bridge, pillar), and a guaranteed path with the given blocks;
  - sets the edit budget and block count from the tier;
  - runs the hill-climb calibrator (moved out of the test into the worker, time-boxed) to set ★/★★/★★★.

  Shown as a short "Surveying the island…" moment when you first land; results are cached per island (IndexedDB) and can be regenerated deterministically.
- **Rendering:** stream chunks around the camera; distant islands as low-detail meshes (2×/4× downsampled) fading into the haze; camera "travel" between islands (pick an island on a map or follow a bridge).
- **Share links v2:** generator version + archipelago seed + island id + your edits as a diff (small). v1 links keep working: the retired hand-made levels stay in the code only to decode old links.
- **Progress:** best and stars per `seed:island`; the old per-level bests are kept but hidden.
- **What stays:** Algorithm Duel works on any island; sandbox Free build stays for unlimited building.

### Milestones

- **M7 — Chunked world + course window:** a sparse chunk store for the sky, a dense window for the active island, with A*, worker, viz, voxel texture, bot and editor all running in window space. No visible change; current levels run on it. Tests: window copy/offset round-trip, A* identical on window vs. old world.
- **M8 — Island generator v2:** shape → erosion → rivers/lakes → biomes → underside, in a worker, deterministic per (seed, island, version). Golden-hash tests for determinism; timing budget about 150 ms per island on desktop. Previewable in Free build with a seed box.
  - *Done 2026-11-25.* `src/gen/island.ts` + `hydro.ts`, run in `src/gen/worker.ts`: warped-disc shape (largest landmass only) → hills and ridged mountain ranges → droplet erosion + light smoothing → biomes → priority-flood lakes and flow-accumulation rivers (capped at bank height; cascades and coastal waterfalls allowed) → wetland ponds → biome layers → crystal spires/walls. 2–16 ms per island. Decided: biomes use only the existing 5 materials (plus a per-column colour tint); phones cap islands at 80 across (same seed, smaller footprint). Only exactly-rounded float ops, so islands match across browsers. Preview: Levels → Sandbox → Generated island, with the seed box. Island links wait for links v2 (M10).
- **M9 — Search-aware tuning:** start/flag selection, budget/blocks by tier, ★ calibration in the worker. Tests: every tuned island is solvable, untouched < ★, ★★★ reachable by the calibrator.
  - *Done 2026-11-26.* `src/gen/tune.ts`, run in the generator worker with a progress toast and cached per island + tier (`pathfinder.tuning`). Route: ~40 start/flag pairs at a tier-set distance, scored by nodes per step × detour × special moves, with a per-tier ceiling on untouched nodes (so the score is the player's doing and the survey stays quick). Stars: a fixed-work hill-climb (120–360 searches by tier, not a time box, so every device agrees); ★★★ = what it reached, ★/★★ = untouched + 35%/70% of its gain. The climb's edits are kept as a proof. Survey: 0.1–4 s on desktop. Decided: tuned islands are scored challenges (bests per `island:seed:tier[:s80]`); a tier picker 1–5 sits by the seed box until M10's rings; the phone cap is decided by touch input, not window width.
- **M10 — The archipelago:** streaming + LOD, the map/island picker, camera travel, bridges as progress, daily seed / seed box / Random, links v2 + legacy decode, the level list replaced.
  - *Done 2026-11-26.* `src/gen/archipelago.ts`: a seeded jittered grid (200-voxel cells, 72% filled, home always at the origin); tier = ring + 1 (max 5); home is capped at 56 across and ring 1 at 80. Bridges join each island to its 8 grid neighbours, plus a long link inwards for any island with no inner neighbour, so everything is reachable. The sky view (`src/render/skyIslands.ts`) draws islands within 2 cells as 4× downsampled meshes (`src/gen/lod.ts`, made in the worker) fading into the haze, with a marker over each when you zoom out (tier, stars, or a lock); tap an open one and the camera flies there while the worker surveys it. Progress per seed + island in `pathfinder.arch` (stars never go down), with where you were. Links v2 (`encodeIsland`): seed, island, phone cap, dare and the generator/tuning versions in 16 bytes (about 22 characters); v1 course links still decode. The Levels dialog: Archipelago (home, daily, random, seed box, back to where you were), Algorithm Duel, Sandbox; the hand-made challenges stay only for old links. Decided: one ★ opens the bridges; the islands are seen in the sky, not on a separate map; the daily is just a date-picked seed (UTC), and a new visitor starts on today's.
- **Biomes, blocks, time of day, sounds** (requested 2026-11-26: "make it more interesting", in the spirit of block games but our own look):
  - *Done 2026-11-26.* Generator v2 → `GEN_VERSION` 2 (old island links show the version toast; bests and stars for v1 islands no longer match). Seven new materials with move rules in `src/path/moves.ts`: Sand (dig +0.5), Bog/mud (walk ×2), Timber (dig +2), Canopy/leaves (passable, +0.25 per leaf cell; not a floor), Ember/magma (never stood on, dug or dropped onto) and Snow (walk ×1.3, dig +0.5). Four new biomes: Forest (timber and canopy trees), Snowy peaks (snow, iced lakes), Desert (dunes, sand, oases) and Volcanic (magma rivers with stone fords, vents). The A* heuristic multiplies by the cheapest floor (0.6 when the window has any ice), so it stays admissible; ice is kept out of the hotbar so players can't inflate scores by loosening the heuristic island-wide. Hotbar: 8 blocks (keys 1–8), scrolling on phones. Time of day per island from the seed (home always day; others 40% day, 20% dusk, 18% dawn, 22% night): sun angle and colour, sky tint, stars, exposure, and lanterns at the start and flag at night. Sounds stay synthesized: per-material footsteps, digs and placing, plus an ambient bed (wind, birds by day, crickets at night, crackle near magma). Also fixed: `islandKey` had mirror-image twins ((x,z) and (−x,−z) generated the same island). Decided: gameplay blocks rather than decoration; time is fixed per island, not a cycle; no audio files.
- **Simplification pass** (requested 2026-11-26: "remove needless complexity, the links should go"):
  - *Done 2026-11-26.* Removed share links (v1 and v2, the dare, Copy link, the version toast; an old `#course=` hash is just cleared), the six hand-made challenges they kept alive (three survive as test fixtures in `tests/fixtures/`), the old per-level bests (`progress.ts`; island bests live in `pathfinder.arch`), Riftworks, Heuristic Trap and Pareto A* (the duel now runs on whatever island you're on, against Dijkstra or Weighted A*), the A* weight slider, the Stylised style setting (the flat-colour look remains only as the stand-in while textures load), the Pebbles hotbar, the Boxy and Bulb bots, the player-facing look sliders (moved to the dev-only Look folder), the blocks and character settings (the character picker stays), the debug levels (big island, stress, regenerate, gauntlet; the gauntlet is a test fixture), and ice (it forced an island-wide heuristic discount and couldn't be offered in the hotbar). Materials after Placed were renumbered (Sand 7 … Snow 12); `GEN_VERSION` stays 2 since v2 was never released.
- **Desktop only + living islands** (requested 2026-11-26: "drop support for phones entirely… only PCs and MacBooks", plus the quick wins from the ideas list):
  - *Done 2026-11-26.* Phones and tablets with no mouse or trackpad get a "made for computers" note instead of the game (`src/bootstrap.ts`). Gone: the 80-across phone island cap (and its separate progress keys), touch gestures in the editor, every phone layout (collapsible score panel, stacked corner buttons, hotbar scrolling), touch help text, and the Low quality tier; quality now defaults to High. Living islands: wind gusts roll across grass tops and leaves rustle (fragment shader only: moving merged-quad vertices would crack the faces against trunks), and `src/render/drift.ts` adds GPU-looped particles per biome: blossom by day and fireflies at dusk and night over meadows and forests, blowing sand over deserts and badlands, snow on the peaks, embers over lava. Bot's eye (B): the camera rides behind the bot during a run and glides back to your orbit view after.
- **Deeper islands** (requested 2026-11-26):
  - *Done 2026-11-26.* `GEN_VERSION` 3 (every island reshuffles; v2 was never released). A new generator step after the rivers: wandering cave tunnels (with the odd chamber and a branch) that start at a mouth in a cliff foot and only cut rock between the surface and 2 voxels above the underside, keeping a 2-voxel roof under water; ledges where rocky cliff tops jut 1–2 cells over drops of 4 or more; stone arches (sandstone in the desert) spanning 8–13 cells in rocky biomes; and crumbling walled ruins on flat ground with a timber gate (the bot can dig it, slowly), sometimes a second doorway and an inner wall. Across the 24 test seeds every island has caves (225–4,954 carved voxels), most have ruins, and generation stays under 25 ms. Stars re-tune themselves through the survey. Tests: caves on every island, arches and ruins across seeds, a roofed cave the bot can walk into on most islands, new golden hashes.
- **Quieter and clearer** (requested 2026-11-26: "it really gets the fans spinning… I see no shadows or leaves rustling"):
  - *Done 2026-11-26.* Measured on the GPU at MacBook Retina size: 12 ms a frame (GTAO ~6 ms, bloom ~3.5 ms, the scene ~3 ms), drawn up to 120 times a second even when nothing moved. Removed the post chain (GTAO, bloom, colour grade) and the High/Medium quality setting; the scene renders straight to the screen with MSAA in ~3.5 ms. Frame cap: 60 fps with input in the last 3 s, the bot or a duel running, or the camera flying, else 30. Shadow map 4096 → 2048. Shadows were drawn but drowned: the HDRI's ambient light filled them and the sun sat behind the default camera. Sky light 1.0 → 0.45, sun 2.6 → 4, and the day sun now comes from the left of the default view (dawn moved round too); the sky's own brightness is unchanged. Removed the grass gusts and leaf rustle (a few percent of shading change, too faint to see) and the unused HDRI sun finder.
- **Next (agreed 2026-11-26):** light and shadow (time-of-day shadows, dawn light shafts, magma lighting), then wildlife, then wanderers (seeded moving obstacles) as their own milestone.
- **M11 — Structures + polish:** WFC ruins/gates/mazes, biome-specific detail, first-visit flow on the home island.

**Open questions:** none left from M10 (phones: 80 across; bridges: ★; daily: just a seed).

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Greedy meshing + AO bugs (seams, wrong merges) | Debug view in Tweakpane: wireframe + per-quad colors. A test for the mesher face count on tiny worlds |
| Search viz too heavy at 64k instances | Update only the changed instance ranges (`addUpdateRange`), cap visible closed nodes, fade by age in a shader |
| Orbit vs edit input conflicts on the trackpad | Prototype both schemes in M1 and pick live |
| Worker snapshot of the world gets stale during edits | Version counter on the world. The worker result carries the version it searched, and stale results are dropped (groundwork for M4) |
| M3 move edge cases | Table-driven rules + exhaustive Vitest cases before the visuals |
