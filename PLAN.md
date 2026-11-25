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

Still OPEN (asked when we get there): the final name.

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
  - Known nit: underside rock spikes poke into deep chasms (polish later)
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
- **M4 — Live replanning:** edits that touch the remaining path → cancel + rerun A\* from the bot's cell. Execution-time validation of every step. The replan is visualized. "Follow bot" camera.
- **M5 — Game layer:** score panel, 5–8 built-in levels (tutorial → hard), RLE + `CompressionStream` deflate → base64url share links (round-trip tests), weighted-A\* slider.
- **M6 — Polish + deploy:** synth blips (optional), loading screen, touch controls, a "how to play" overlay, final name, **Vercel** deploy (`vercel.json` not needed for a plain Vite static build; set up the GitHub repo first).

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Greedy meshing + AO bugs (seams, wrong merges) | Debug view in Tweakpane: wireframe + per-quad colors. A test for the mesher face count on tiny worlds |
| Search viz too heavy at 64k instances | Update only the changed instance ranges (`addUpdateRange`), cap visible closed nodes, fade by age in a shader |
| Orbit vs edit input conflicts on the trackpad | Prototype both schemes in M1 and pick live |
| Worker snapshot of the world gets stale during edits | Version counter on the world. The worker result carries the version it searched, and stale results are dropped (groundwork for M4) |
| M3 move edge cases | Table-driven rules + exhaustive Vitest cases before the visuals |
