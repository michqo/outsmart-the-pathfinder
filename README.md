# Outsmart the Pathfinder

Build a course on a floating voxel island, then press **Space** and watch a little bot plan its route with A\*. Every cell it considers lights up in 3D. Your goal is to make it **think as hard as possible**: the score is the number of nodes it expands, and a run only counts if it still reaches the flag.

The bot isn't helpless. It can dig (slate is slow, crystal can't be dug), swim, and spend its blocks to bridge gaps and climb. Edit the course while it walks and it has to replan live. In challenges, editing after pressing Run makes it a practice run: it won't earn stars or set a best.

- **An archipelago of generated islands:** every island is a challenge with an edit budget and ★★★ targets. Zoom out to see the neighbouring islands floating in the haze; earn a ★ to grow bridges to them, then tap one to fly there. Difficulty rises with each ring away from home. Each day brings a new archipelago (the same for everyone), or enter a seed or choose **Random** in **Levels**.
- **Share links:** an island plus your best (a short link), or a whole sandbox course packed into the URL, so you can dare a friend
- Free-build sandboxes with no limits
- **Weighted A\*** slider in sandboxes, to see how greed trades nodes for path quality
- **Algorithm Duel:** compare A* against Dijkstra, Weighted A*, or Pareto A*. The table shows states expanded, planned cost, and active worker time. The visual traces play at the same event rate, so a shorter trace finishes sooner; playback is not a compute benchmark.
- **Riftworks:** open **Levels → Riftworks** for a seeded, 36-room maze with rising terraces, flood pools, diggable gates, and bridge shortcuts. Enter a seed to reproduce a layout or choose **Random** for another. **Heuristic Trap** is a separate six-edit puzzle.
- **How islands are made:** eroded hills with rivers, lakes and biomes (meadow, highlands, crystal fields, wetlands, badlands). Each island is surveyed the first time you land (up to a few seconds) for a start and flag that make the bot think, an edit budget, blocks, and star targets that a hill-climbing player is proven to reach. A seed gives the same islands and stars on every device; touch devices get smaller islands.
- Works with mouse, trackpad and touch
- Requires WebGL 2. The island is playable with simple graphics while the detailed textures load in the background.

## Controls

| | Desktop | Touch |
|---|---|---|
| Place / remove | Click / right-click (E, R switch tools) | Tap; − / + buttons switch tools |
| Material | 1–5 | Tap a swatch |
| Fill a box | Shift + drag (⌥ for a wall) | – |
| Camera | Drag, scroll | Drag, pinch |
| Run | Space or ▶ Run | ▶ Run |
| Undo | ⌘Z | ↶ |
| How to play | H or ? | ? |

## Development

```bash
npm install
npm run dev        # http://localhost:5174
npm test           # vitest: A*, moves, meshing, codec, levels
npm run build      # static site in dist/
```

Re-calibrate the star targets after changing a level:

```bash
CALIBRATE=1 npx vitest run tests/levels.test.ts
```

Benchmark Riftworks seed 47:

```bash
BENCHMARK=1 npm test -- --reporter=verbose tests/duel.test.ts
```

Pareto A* skips a state when the bot can reach the same cell at no higher cost with more blocks remaining. That preserves the cheapest route on the planner's fixed world snapshot; the duel still replays each route on a separate copy to catch invalid plans involving digs or placements. Worker timings vary by device and run.

Stack: TypeScript, three.js, Vite, Vitest. A\* runs in a Web Worker. See `PLAN.md` for the design notes and milestones.

## Deploy

It's a plain static Vite build: on Vercel, import the GitHub repo and use the Vite preset, Node.js 24.x, build `npm run build`, and output `dist`. No `vercel.json` needed. Smoke-test a Preview on desktop Chrome and a real iPhone (first visit, touch controls, scoring, and both kinds of share link) before promoting to production.

## Credits

Textures and sky: [Poly Haven](https://polyhaven.com) (CC0). Characters: [Blocky Characters](https://kenney.nl/assets/blocky-characters) by Kenney (CC0). Details in `public/assets/CREDITS.md`.
