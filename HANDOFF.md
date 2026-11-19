# Outsmart the Pathfinder — Project Handoff

> Paste this into a fresh Claude Code session opened in this folder:
>
> **"Read HANDOFF.md and start with Milestone 0. Ask me before making any decision marked OPEN."**

---

## 1. The pitch

A small voxel sandbox on a floating island. **I build obstacle courses, and a little robot pathfinds through them.** The bot doesn't just walk: it can **dig, place blocks, bridge gaps and pillar up**, so changing the world is part of its plan. Its **search is visible in 3D**: glowing frontier voxels spread through the level as the algorithm thinks. I can **edit the world while it walks**, and it replans live.

**The game:** design a course that makes the bot work as hard as possible (most nodes expanded, longest path), then share it with friends as a link: "bet you can't beat 50k nodes."

**Inspiration:** the *idea* of world-modifying A\* bots (like the Baritone mod) where moves have costs. **It must not look or feel like Minecraft.** It has its own name, art style and character. No Minecraft textures, block types, sounds or UI conventions.

**Audience:** me and a few friends, plus a portfolio piece. It should feel fun and polished, not like a tech demo.

**What a viewer gets in 10 seconds:** a cute robot on a pastel island. A wave of glowing voxels fans out through the level, then a path lights up and the bot walks it, digging and bridging along the way.

---

## 2. Hard requirements

1. **Smooth:** a steady 60 fps. The search must **never block the main thread**. It runs in a Web Worker and is time-sliced.
2. **Looks decent:** low-poly / soft-toy style (see §4).
3. **Easy to program:** a minimal, mainstream stack. Readable code over clever code. No game engine, no physics engine in v1.
4. **Interactive:** editing the world is the core loop.
5. **A static site:** no backend. Levels are shared through the URL.

---

## 3. Tech stack

| Concern | Choice | Notes |
|---|---|---|
| Language/build | **TypeScript + Vite** | `npm create vite@latest` (vanilla-ts) |
| Rendering | **three.js** (`WebGLRenderer` is fine. WebGPU isn't needed here) | OrbitControls, one directional light with shadows |
| Voxel meshing | Custom **greedy meshing** per chunk | Chunk size 16³. Rebuild only the edited chunk |
| Search visualization | One **`InstancedMesh`** of small cubes | Update instance colors/scales from the worker's snapshots |
| Search | Plain TS in a **Web Worker** | Binary heap open set, typed arrays, no per-node object allocation in hot loops |
| UI | **Tweakpane** | Plus a tiny custom HUD for score/inventory |
| Level sharing | Run-length encoding + `CompressionStream` (deflate) → base64url in the URL hash | |
| Tests | **Vitest** for the search/move rules | The move rules are where bugs hide. Test them |

**For the implementing session:** use **Context7** to check the current three.js, Tweakpane and Vite APIs before writing that code. Pin exact versions.

---

## 4. Visual direction

**"A soft-toy floating island."** Think pastel diorama, not a blocky survival game.

- **World:** one floating island, **64 × 32 × 64** voxels max in v1. Its underside tapers into rocky low-poly stalactites, and it floats over a soft gradient sky with a few low-poly clouds.
- **Blocks:** a few original materials, each with its own color and *cost meaning*:
  - **Grass/soil:** diggable, cheap
  - **Stone:** diggable, expensive
  - **Crystal:** not diggable (a hard wall)
  - **Water:** passable but slow, can't stand on it
  - **Bot-placed block:** a distinct color (e.g. soft orange), so you see what the bot built
- **Block look:** flat-shaded, with a very slight color variation per block (a hash of the position). Optional: fake ambient occlusion through vertex colors at block corners. It's cheap and makes it look much better. Avoid pixel-art textures.
- **The bot:** a small, cute low-poly robot (a capsule body, one big eye, little legs). Simple procedural animation: bobbing walk, squash on landing, a drill/sparkle effect when digging, a "pop" when placing.
- **Search visualization:**
  - Open-set (frontier) nodes: small glowing cubes, cyan, pulsing
  - Closed nodes: fade to a dim, translucent blue over ~1 s
  - Final path: a bright line/ribbon with arrows. Dig and place steps are marked with icons
  - A playback speed slider: from instant to slow-motion
- **Palette:** one `palette.ts`, pastel, with a warm light and cool shadows.
- **Mood reference:** Townscaper, Monument Valley, "A Short Hike" (for feel, not to copy).

---

## 5. Interaction

- **Edit mode:** left-click places the selected block, right-click removes it, and you pick the material from a hotbar. Hold Shift to place a line/box (a fill tool).
- **Set start and goal:** drag the robot, drag the goal flag.
- **Run:** press Space. The search animates, then the bot walks the path.
- **Live edits:** while the bot walks, any edit that touches its remaining path triggers a **replan** from its current position. The replan is visualized too.
- **Inventory:** the bot starts with N blocks (a level setting). The HUD shows what's left.
- **Score panel:** nodes expanded, path cost, path length, blocks dug/placed, search time.
- **Share:** a "Copy link" button encodes the level + start/goal + inventory + algorithm in the URL hash.
- **Camera:** an orbit around the island, a double-click focuses the camera on a point, and a "follow bot" toggle.

---

## 6. Pathfinding design (the core)

### State
`(x, y, z, blocksLeft)`. Keep it this small on purpose.

### World-modification approximation (important, keep it simple)
The search **doesn't track the world changes it plans**. A "dig" move is a more expensive move through a solid block, and a "place" move is a more expensive move over air that spends 1 from `blocksLeft`. This is the same approximation Baritone uses. It keeps the state space small. When the bot *executes* the path, the world actually changes. If an execution step turns out invalid (e.g. it dug out its own support), it triggers a replan.

Known edge cases to handle and test:
- Digging the block it's standing on → not allowed as a move.
- Placing a block requires an adjacent solid face to place against.
- Falling: the maximum safe drop is 3 blocks. A longer drop isn't allowed (or is very costly).
- Digging up while standing in water, etc. Start with a strict, simple rule set and allow more later.

### Move set (v1)
| Move | Condition | Base cost |
|---|---|---|
| Walk (4 directions) | floor below, 2 air above (the bot is 2 tall) | 1 |
| Diagonal walk | both side columns clear | 1.41 |
| Step up 1 | head clearance | 2 |
| Drop 1–3 | landing below | 1 + 0.5 per block |
| Dig forward (×2 for the head + feet blocks) | the blocks are diggable | 1 + hardness |
| Dig down | the block below is diggable, not the support... rule above | 2 + hardness |
| Bridge (place a block below the next cell) | `blocksLeft > 0`, has a neighbor to place against | 3 |
| Pillar up (jump + place below) | `blocksLeft > 0`, head clearance | 4 |
| Swim | water cell | 3 |

All costs and rules live in one `moves.ts` table, so they're easy to tune and test.

### Algorithms
- **v1:** A\* with an octile/3D heuristic. A **weighted A\*** slider (w = 1…5). On replan: **rerun A\* from scratch** from the bot's current position. At 64×32×64 that's fast enough.
- **Later:** **D\* Lite** (incremental replanning) as an upgrade, then **Jump Point Search 3D** and **HPA\*** for the race mode.
- The worker streams **snapshots** every K expansions (newly opened/closed node IDs as a `Uint32Array`, transferred, not copied) so the main thread can animate them.

---

## 7. Project structure (suggested)

```
outsmart-the-pathfinder/
  index.html
  src/
    main.ts              // bootstrap, loop
    palette.ts
    world/               // voxel data (Uint8Array), chunks, greedy mesher, materials
    render/              // scene, lights, island underside, sky, bot model + animation, search viz
    path/                // moves.ts, astar.ts, heap.ts, worker.ts, (later) dstar-lite.ts
    bot/                 // path execution, step animation, replan triggers, inventory
    edit/                // raycast picking, place/remove, fill tool, hotbar
    ui/                  // tweakpane, HUD, score, share link
    levels/              // built-in levels + encode/decode
  tests/                 // vitest: moves, astar, level encoding
```

---

## 8. Milestones

Each milestone ends in something I can open and play. Check each in the browser preview, show me a screenshot and commit before moving on.

- **M0 — Scaffold:** Vite + TS + three.js, the orbit camera, the palette, sky, a test island (a hardcoded heightmap), greedy-meshed chunks, Tweakpane + FPS. `.claude/launch.json`, git init.
- **M1 — Editor:** raycast place/remove, the hotbar, the fill tool, editing rebuilds only the affected chunk. The island underside looks nice.
- **M2 — Walking bot:** A\* in a worker with walk/diagonal/step-up/drop. The animated search visualization, the path ribbon, and the bot walking along with a procedural animation. **Make this look great before adding more moves.**
- **M3 — World-changing moves:** dig, bridge, pillar, swim, inventory, bot-placed block color, dig/place effects. Vitest coverage for every move rule.
- **M4 — Live replanning:** edits during the walk trigger a replan, execution-time validation, the "follow bot" camera.
- **M5 — The game layer:** the score panel, 5–8 built-in levels (tutorial → hard), share links, a weighted-A\* slider.
- **M6 — Polish + deploy:** sound (optional, simple synth blips), a loading screen, touch controls, a quick "how to play" overlay, deployment.

**Stretch / later modes:**
- **Algorithm race:** split screen or ghost bots, with A\* vs weighted A\* vs D\* Lite vs JPS vs HPA\*.
- **Evolve the bot:** a genetic algorithm tunes the move costs/heuristic weight to minimize nodes expanded across the level library.
- **Builder swarm:** several bots cooperate to build a blueprint structure with scaffolding and task allocation.
- **Real jumping:** gap jumps with arcs and momentum (kinodynamic moves).

**Expected effort:** ~40–70 h to reach M6. The riskiest part is M3 (the move-rule edge cases). Lean on tests there.

---

## 9. Working agreement

- Small steps. After each milestone: a screenshot, what's next, then commit.
- Ask me about anything marked **OPEN** and about uncertain visual choices. Show 2–3 quick options.
- Performance is a feature. Never let a search hitch the frame.
- Keep it original: if something starts to resemble Minecraft (block textures, UI, terminology), flag it and change it.

### OPEN decisions
- The final name (working title: "Outsmart the Pathfinder")?
- The bot's design and personality: robot, little creature, or something else?
- Default inventory size and world size?
- Deploy target: GitHub Pages or Vercel?
