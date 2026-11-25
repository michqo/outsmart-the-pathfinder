# Outsmart the Pathfinder

Build a course on a floating voxel island, then press **Space** and watch a little bot plan its route with A\*. Every cell it considers lights up in 3D. Your goal is to make it **think as hard as possible**: the score is the number of nodes it expands, and a run only counts if it still reaches the flag.

The bot isn't helpless. It can dig (slate is slow, crystal can't be dug), swim, and spend its blocks to bridge gaps and climb. Edit the course while it walks and it has to replan live. In challenges, editing after pressing Run makes it a practice run: it won't earn stars or set a best.

- **6 challenge levels** with edit budgets and ★★★ targets, plus free-build sandboxes
- **Share links:** the whole course (or the level plus your best) packed into the URL, so you can dare a friend
- **Weighted A\*** slider in sandboxes, to see how greed trades nodes for path quality
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

Stack: TypeScript, three.js, Vite, Vitest. A\* runs in a Web Worker. See `PLAN.md` for the design notes and milestones.

## Deploy

It's a plain static Vite build: on Vercel, import the GitHub repo and use the Vite preset, Node.js 24.x, build `npm run build`, and output `dist`. No `vercel.json` needed. Smoke-test a Preview on desktop Chrome and a real iPhone (first visit, touch controls, scoring, and both kinds of share link) before promoting to production.

## Credits

Textures and sky: [Poly Haven](https://polyhaven.com) (CC0). Characters: [Blocky Characters](https://kenney.nl/assets/blocky-characters) by Kenney (CC0). Details in `public/assets/CREDITS.md`.
