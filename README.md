# Outsmart the Pathfinder

Build a course on a floating voxel island, then press **Space** and watch a little bot plan its route with A\*. Every cell it considers lights up in 3D. Your goal is to make it **think as hard as possible**: the score is the number of nodes it expands, and a run only counts if it still reaches the flag.

The bot isn't helpless. It can dig (slate and timber are slow, crystal can't be dug), swim, push through canopy leaves, and spend its blocks to bridge gaps and climb. Floors matter: bog and snow slow it down, and ember (magma) is never stepped on. Edit the course while it walks and it has to replan live. On an island, editing after pressing Run makes it a practice run: it won't earn stars or set a best.

- **An archipelago of generated islands:** every island is a challenge with an edit budget and ★★★ targets. Zoom out to see the neighbouring islands floating in the haze; earn a ★ to grow bridges to them, then click one to fly there. Difficulty rises with each ring away from home. Each day brings a new archipelago (the same for everyone), or enter a seed or choose **Random** in **Levels**.
- **Free build:** a sandbox island with no limits, where you can also drag the bot and the flag
- **Algorithm Duel:** on any island, compare A* against Dijkstra or Weighted A* on the same course. The table shows states expanded, planned cost, and active worker time. The visual traces play at the same event rate, so a shorter trace finishes sooner; playback is not a compute benchmark.
- **How islands are made:** eroded hills with rivers, lakes and biomes (meadow, highlands, crystal fields, wetlands, badlands, forest, snowy peaks, desert, volcanic), cut through with caves, overhanging ledges and stone arches, and dotted with walled ruins behind timber gates. Each island has its own time of day (dawn, day, dusk or night), and its own life: blossom, fireflies, blowing sand, snow or embers drift over the biomes. Each island is surveyed the first time you land (up to a few seconds) for a start and flag that make the bot think, an edit budget, blocks, and star targets that a hill-climbing player is proven to reach. A seed gives the same islands and stars on every computer.
- **Bot's eye (B):** ride along behind the bot during a run, watching the search spread around it; **Follow bot (V)** keeps your own angle instead
- Made for computers (Mac or PC, mouse or trackpad); phones and tablets get a note instead of the game
- Requires WebGL 2. The island is playable with simple graphics while the detailed textures load in the background.

## Controls

| | |
|---|---|
| Place / remove | Click / right-click (E, R switch tools) |
| Material | 1–8 |
| Fill a box | Shift + drag (⌥ for a wall) |
| Camera | Drag, scroll; F or ⌥-click to focus |
| Run cameras | V follow bot · B bot's eye |
| Run | Space or ▶ Run |
| Undo | ⌘Z |
| How to play | H or ? |

## Development

```bash
npm install
npm run dev        # http://localhost:5174
npm test           # vitest: A*, moves, meshing, islands, tuning
npm run build      # static site in dist/
```

Stack: TypeScript, three.js, Vite, Vitest. A\* runs in a Web Worker. See `PLAN.md` for the design notes and milestones.

## Deploy

It's a plain static Vite build: on Vercel, import the GitHub repo and use the Vite preset, Node.js 24.x, build `npm run build`, and output `dist`. No `vercel.json` needed. Smoke-test a Preview on desktop Chrome and a real iPhone (first visit, touch controls, scoring, and both kinds of share link) before promoting to production.

## Credits

Textures and sky: [Poly Haven](https://polyhaven.com) (CC0). Characters: [Blocky Characters](https://kenney.nl/assets/blocky-characters) by Kenney (CC0). Details in `public/assets/CREDITS.md`.
