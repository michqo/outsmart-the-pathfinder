import { HEURISTIC_TRAP, riftworksLevel, starsFor, TRAP_COST_GAP, type Level } from '../levels/levels';
import { OPPONENTS, type DuelOpponent, type DuelResults } from '../path/duel';
import { showModal } from './modal';

const CSS = /* css */ `
.sp { position: fixed; left: 12px; top: 104px; z-index: 20; width: 248px; padding: 14px 16px 12px; border-radius: 18px;
  background: #ffffffd9; box-shadow: 0 6px 24px #5a4a7a22, inset 0 0 0 1px #fff;
  font: 600 12px/1.3 ui-rounded, 'SF Pro Rounded', system-ui, sans-serif; color: #3b3355; user-select: none; }
.sp [hidden] { display: none !important; }
.sp .lv { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.sp .lv b { font-size: 15px; }
.sp .lv small { opacity: .5; font-weight: 600; white-space: nowrap; }
.sp .lvhint { margin: 4px 0 10px; font-weight: 500; opacity: .7; }
.sp .score { display: flex; align-items: baseline; gap: 6px; }
.sp .score b { font-size: 30px; font-variant-numeric: tabular-nums; letter-spacing: -.02em; }
.sp .score span { opacity: .55; }
.sp .score.miss b { font-size: 16px; color: #d0405a; }
.sp .best { display: flex; justify-content: space-between; margin-top: 2px; opacity: .65; }
.sp .best .new { color: #4caf50; opacity: 1; }
.sp .stars { display: flex; gap: 4px; margin: 10px 0 2px; }
.sp .star { flex: 1; padding: 5px 0 4px; border-radius: 10px; background: #f1eef8; text-align: center; }
.sp .star i { display: block; font-style: normal; font-size: 15px; color: #cfc8e0; }
.sp .star small { font-size: 10px; opacity: .6; font-variant-numeric: tabular-nums; }
.sp .star.on { background: #fff4d6; }
.sp .star.on i { color: #f5b301; }
.sp .bar { margin-top: 10px; }
.sp .bar .row { display: flex; justify-content: space-between; margin-bottom: 4px; }
.sp .bar .track { height: 6px; border-radius: 3px; background: #ece8f4; overflow: hidden; }
.sp .bar .fill { height: 100%; width: 0; border-radius: 3px; background: #6c5ce7; transition: width .2s, background .2s; }
.sp .bar .fill.full { background: #e0475a; }
.sp .weight { margin-top: 10px; }
.sp .weight .row { display: flex; justify-content: space-between; }
.sp .weight input { width: 100%; accent-color: #6c5ce7; }
.sp .weight.locked { opacity: .5; }
.sp .dare { margin: 0 0 10px; padding: 7px 10px; border-radius: 11px; background: #3b3355; color: #fff; }
.sp .dare.won { background: #4caf50; }
.sp .btns { display: flex; gap: 6px; margin-top: 12px; }
.sp .btns button { flex: 1; padding: 7px 0; border: 0; border-radius: 10px; background: #ece8f4; color: inherit;
  font: inherit; cursor: pointer; }
.sp .btns button:hover { background: #ddd6ef; }
.sp .btns button.main { background: #3b3355; color: #fff; }
.sp .btns button.main:hover { background: #4d4470; }
.sp .duel-toggle { width: 100%; margin-top: 6px; min-height: 32px; border: 0; border-radius: 10px;
  background: #ece8f4; color: inherit; font: inherit; cursor: pointer; }
.sp .duel-toggle:hover { background: #ddd6ef; }
.sp.in-duel { max-height: calc(100dvh - 132px); overflow-y: auto; }
.sp .duel { margin-top: 8px; }
.sp .duel label { display: flex; align-items: center; justify-content: space-between; gap: 5px; }
.sp .duel select { max-width: 100%; min-height: 30px; border-radius: 8px; border: 1px solid #c9c1db; font: inherit; color: inherit; }
.sp .duel table { margin-top: 8px; width: 100%; border-collapse: collapse; table-layout: fixed; font-variant-numeric: tabular-nums; }
.sp .duel th, .sp .duel td { padding: 5px 3px; text-align: center; overflow-wrap: anywhere; }
.sp .duel thead th { width: 34%; font-weight: 700; border-bottom: 2px solid #2380ff; }
.sp .duel thead th:first-child { width: 32%; border-color: transparent; }
.sp .duel thead th:last-child { border-color: #f17636; }
.sp .duel tbody th { text-align: left; }
.sp .duel .duel-status { margin: 8px 0 0; font-weight: 600; }
.sp .duel .timing-note { margin: 4px 0; font-weight: 500; }
.sp .seed-form { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 8px 0; }
.sp .seed-form input { width: 7em; min-height: 28px; box-sizing: border-box; font: inherit; }
.sp .seed-form button { min-height: 32px; padding: 0 8px; border: 0; border-radius: 8px; background: #ece8f4; color: inherit; font: inherit; cursor: pointer; }
.sp .lv .tog { display: none; opacity: .5; }
@media (max-width: 720px) {
  .sp { left: 10px; top: 58px; width: 214px; padding: 10px 12px; }
  .sp .lv { cursor: pointer; }
  .sp .lv .tog { display: inline; }
  .sp .lv small.kind { display: none; }
  .sp .score b { font-size: 22px; }
  .sp.min .lvhint, .sp.min .best, .sp.min .stars, .sp.min .bar, .sp.min .weight { display: none; }
  .sp.min.in-duel .bar:not([hidden]) { display: block; }
  .sp.min .btns { margin-top: 8px; }
  .sp .duel-toggle { min-height: 38px; }
  .sp.in-duel { max-height: calc(100dvh - 78px); }
}
.sp-toast { position: fixed; left: 50%; top: 70px; z-index: 1100; transform: translate(-50%, -8px); padding: 8px 16px;
  border-radius: 12px; background: #3b3355; color: #fff; font: 600 13px/1.2 ui-rounded, 'SF Pro Rounded', system-ui, sans-serif;
  opacity: 0; pointer-events: none; transition: opacity .2s, transform .2s; }
.sp-toast.show { opacity: 1; transform: translate(-50%, 0); }

.lvd { box-sizing: border-box; width: min(688px, calc(100vw - 32px)); max-height: calc(100% - 48px); overflow-y: auto; padding: 20px 24px 18px;
  border-radius: 22px; background: #fbf9ff; box-shadow: 0 24px 80px #1d1a2c55;
  font: 600 13px/1.3 ui-rounded, 'SF Pro Rounded', system-ui, sans-serif; color: #2f2a45; }
.lvd h2 { margin: 0 0 4px; font-size: 21px; }
.lvd > p { margin: 0 0 14px; opacity: .6; font-weight: 500; }
.lvd h3 { margin: 16px 0 8px; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; opacity: .5; }
.lvd .list { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px; }
.lvd .card { display: flex; flex-direction: column; gap: 4px; padding: 12px 14px; border: 0; border-radius: 14px; text-align: left;
  background: #fff; box-shadow: inset 0 0 0 1.5px #ece8f4; cursor: pointer; font: inherit; color: inherit; }
.lvd .card:hover { box-shadow: inset 0 0 0 1.5px #c9bff0; transform: translateY(-1px); }
.lvd .card.on { box-shadow: inset 0 0 0 2.5px #6c5ce7; background: #f3f0ff; }
.lvd .card .n { opacity: .4; font-size: 11px; }
.lvd .card .s { color: #f5b301; letter-spacing: 2px; }
.lvd .card .s .off { color: #d9d3e6; }
.lvd .card small { opacity: .55; font-weight: 500; }
.lvd .arch-sub { margin: -2px 0 10px; font-size: 13px; opacity: .65; }
.lvd .arch-seed { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
.lvd .arch-seed input { width: 9em; min-height: 32px; box-sizing: border-box; font: inherit; border: 1px solid #d9d3e6; border-radius: 8px; padding: 0 8px; }
.lvd .arch-seed button { min-height: 32px; padding: 0 12px; border: 0; border-radius: 8px; background: #ece8f4; color: inherit; font: inherit; cursor: pointer; }
`;

export interface ScorePanelHandlers {
  onLevels(opener: HTMLButtonElement): void;
  onShare(): void;
  onReset(): void;
  onWeight(w: number): void;
  onDuelToggle(): void;
  onOpponent(opponent: DuelOpponent): void;
  /** The seed box: `tier` is the tier picker's value (generated islands only). */
  onSeed(seed: number): void;
}

const fmt = (n: number) => n.toLocaleString('en-US');

/** The game's scoreboard: level, last run's nodes, best, stars, edits left, A* weight, share. */
export class ScorePanel {
  private el = document.createElement('div');
  private toastEl = document.createElement('div');
  private toastTimer = 0;
  private q = <T extends HTMLElement>(s: string) => this.el.querySelector(s) as T;
  private level: Level | null = null;
  private best = 0;
  private dare = 0;

  constructor(h: ScorePanelHandlers) {
    const css = document.createElement('style');
    css.textContent = CSS;
    document.head.appendChild(css);
    this.el.className = 'sp';
    this.el.innerHTML = `
      <div class="lv"><b class="name"></b><small class="kind"></small><small class="tog">▾</small></div>
      <p class="lvhint"></p>
      <form class="seed-form" hidden>
        <label for="rift-seed">Seed</label><input id="rift-seed" name="seed" type="number" min="0" max="4294967295" required>
        <button>Generate</button><button class="new-seed" type="button">Random</button>
      </form>
      <div class="regular-score">
      <div class="dare" hidden></div>
      <div class="score"><b class="nodes">–</b><span class="unit">nodes</span></div>
      <div class="best"><span class="bestv"></span><span class="note"></span></div>
      <div class="stars"></div>
      </div>
      <div class="bar"><div class="row"><span>Edits</span><span class="editsv"></span></div><div class="track"><div class="fill"></div></div></div>
      <label class="weight"><div class="row"><span>A* weight</span><span class="wv"></span></div>
        <input type="range" min="1" max="5" step="0.1" value="1"></label>
      <section class="duel" aria-label="Algorithm Duel" hidden>
        <label class="opponent-label">Compare A* with
          <select class="opponent"><option value="dijkstra">Dijkstra</option><option value="weighted">Weighted A* (5×)</option><option value="pareto">Pareto A*</option></select>
        </label>
        <p class="pareto-note timing-note" hidden>Pareto A* skips arrivals that cost more without saving blocks.</p>
        <table aria-label="Algorithm Duel results">
          <thead><tr><th></th><th scope="col">A* (blue)</th><th class="opponent-name" scope="col"></th></tr></thead>
          <tbody>
            <tr><th scope="row">States expanded</th><td class="a-states">–</td><td class="b-states">–</td></tr>
            <tr><th scope="row">Plan cost</th><td class="a-cost">–</td><td class="b-cost">–</td></tr>
            <tr><th scope="row">Compute</th><td class="a-ms">–</td><td class="b-ms">–</td></tr>
          </tbody>
        </table>
        <p class="timing-note">Worker time, not animation. Both traces play at the same event rate.</p>
        <p class="duel-status" role="status"></p>
      </section>
      <div class="btns"><button class="levels">Levels</button><button class="reset">Reset</button><button class="share main">Copy link</button></div>
      <button class="duel-toggle" aria-pressed="false">Algorithm Duel</button>`;
    document.body.appendChild(this.el);
    this.toastEl.className = 'sp-toast';
    document.body.appendChild(this.toastEl);

    if (matchMedia('(max-width: 720px)').matches) this.el.classList.add('min');
    this.q('.lv').onclick = () => {
      const min = this.el.classList.toggle('min');
      this.q('.tog').textContent = min ? '▾' : '▴';
    };
    const levels = this.q<HTMLButtonElement>('.levels');
    levels.onclick = () => h.onLevels(levels);
    this.q('.reset').onclick = () => h.onReset();
    this.q('.share').onclick = () => h.onShare();
    this.q('.duel-toggle').onclick = () => h.onDuelToggle();
    const opponent = this.q<HTMLSelectElement>('.opponent');
    opponent.onchange = () => {
      const value = opponent.value;
      if (value === 'dijkstra' || value === 'weighted' || value === 'pareto') h.onOpponent(value);
    };
    this.q<HTMLFormElement>('.seed-form').onsubmit = (event) => {
      event.preventDefault();
      h.onSeed(this.q<HTMLInputElement>('#rift-seed').valueAsNumber);
    };
    this.q('.new-seed').onclick = () => h.onSeed(crypto.getRandomValues(new Uint32Array(1))[0]);
    const range = this.q<HTMLInputElement>('.weight input');
    range.oninput = () => {
      this.q('.wv').textContent = Number(range.value).toFixed(1);
      h.onWeight(Number(range.value));
    };
  }

  /** A level was loaded. `dare` is a friend's score from a share link (0 = none). */
  setLevel(level: Level, index: number | null, best: number, dare: number): void {
    this.level = level;
    this.best = best;
    this.dare = dare;
    this.q('.name').textContent = level.name;
    this.q('.kind').textContent = index !== null ? `Level ${index + 1}` : level === HEURISTIC_TRAP ? 'Duel puzzle' : level.tier ? `Tier ${level.tier}${level.time && level.time !== 'day' ? ` · ${level.time}` : ''} · seed ${level.seed}` : level.seed === undefined ? 'Sandbox' : 'Generated';
    this.q('.lvhint').textContent = level.hint;
    this.q('.seed-form').hidden = level.kind !== 'riftworks';
    this.q<HTMLInputElement>('#rift-seed').value = level.seed === undefined ? '' : String(level.seed);
    this.q('.nodes').textContent = '–';
    this.q('.score').classList.remove('miss');
    this.q('.unit').textContent = 'nodes';
    this.q('.unit').hidden = false;
    this.q('.note').textContent = '';
    this.renderBest();
    this.renderStars();
    this.renderDare(false);
    this.q('.bar').hidden = level.budget === null;
  }

  setEdits(used: number, budget: number | null): void {
    if (budget === null) return;
    this.q('.editsv').textContent = `${used} / ${budget}`;
    const fill = this.q('.fill');
    fill.style.width = `${Math.min(100, (used / budget) * 100)}%`;
    fill.classList.toggle('full', used >= budget);
  }

  setWeight(w: number, editable: boolean): void {
    const range = this.q<HTMLInputElement>('.weight input');
    range.value = String(w);
    range.disabled = !editable;
    this.q('.wv').textContent = w.toFixed(1) + (editable ? '' : ' (fixed)');
    this.q('.weight').classList.toggle('locked', !editable);
  }

  setDuel(active: boolean, trap: boolean, opponent: DuelOpponent): void {
    this.el.classList.toggle('in-duel', active);
    const toggle = this.q<HTMLButtonElement>('.duel-toggle');
    toggle.hidden = trap;
    toggle.setAttribute('aria-pressed', String(active));
    toggle.textContent = active ? 'Exit Algorithm Duel' : 'Algorithm Duel';
    this.q('.regular-score').hidden = active;
    this.q('.weight').hidden = active;
    this.q('.duel').hidden = !active;
    this.q('.opponent-label').hidden = trap;
    this.q<HTMLSelectElement>('.opponent').value = opponent;
    this.q('.pareto-note').hidden = opponent !== 'pareto';
    const challenger = OPPONENTS[opponent];
    this.q('.opponent-name').textContent = `${challenger.name}${opponent === 'weighted' ? ` ×${challenger.weight}` : ''} (orange)`;
    this.setDuelStatus(trap ? `Goal: +${TRAP_COST_GAP} cost. Try filling the gap in the slate wall.` : 'Press Run to compare on the same course.');
  }

  setDuelStatus(message: string): void {
    for (const cell of this.el.querySelectorAll('.duel td')) cell.textContent = '–';
    this.q('.duel-status').textContent = message;
  }

  setDuelResults([a, b]: DuelResults, trap: boolean): void {
    const cost = (r: DuelResults[number]) => !r.found ? 'No path' : `${r.cost.toFixed(2)}${r.executable ? '' : ' (blocked)'}`;
    this.q('.a-states').textContent = fmt(a.expanded);
    this.q('.b-states').textContent = fmt(b.expanded);
    this.q('.a-cost').textContent = cost(a);
    this.q('.b-cost').textContent = cost(b);
    const ms = (time: number) => time < 0.05 ? '<0.05 ms' : `${time.toFixed(time < 1 ? 2 : 1)} ms`;
    this.q('.a-ms').textContent = ms(a.ms);
    this.q('.b-ms').textContent = ms(b.ms);
    const gap = Math.round((b.cost - a.cost) * 100) / 100;
    this.q('.duel-status').textContent = !a.executable || !b.executable
      ? 'Both routes must reach the flag without replanning.'
      : trap
        ? gap >= TRAP_COST_GAP
          ? `Trap sprung! Weighted A* paid ${gap.toFixed(2)} more.`
          : `Cost gap: ${gap.toFixed(2)}. Aim for +${TRAP_COST_GAP}.`
        : gap === 0
          ? 'Same planned cost. Compare how many states each explored.'
          : `Orange route costs ${Math.abs(gap).toFixed(2)} ${gap > 0 ? 'more' : 'less'}.`;
  }

  setResult(arrived: boolean, nodes: number, newBest: boolean, practice: boolean): void {
    const score = this.q('.score');
    score.classList.toggle('miss', !arrived);
    this.q('.unit').hidden = !arrived;
    this.q('.unit').textContent = practice ? 'nodes · practice' : 'nodes';
    this.q('.nodes').textContent = arrived ? fmt(nodes) : "No path — doesn't count";
    if (arrived && newBest) this.best = nodes;
    this.q('.note').innerHTML = arrived && newBest ? '<span class="new">New best!</span>' : '';
    this.renderBest();
    this.renderStars();
    this.renderDare(arrived && !practice && this.dare > 0 && nodes > this.dare);
  }

  toast(msg: string): void {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), 1800);
  }

  private renderBest(): void {
    this.q('.bestv').textContent = this.best ? `Best ${fmt(this.best)}` : 'No score yet';
  }

  private renderStars(): void {
    const l = this.level!;
    const box = this.q('.stars');
    box.hidden = !l.stars;
    if (!l.stars) return;
    const got = starsFor(l, this.best);
    box.innerHTML = l.stars
      .map((t, i) => `<div class="star${i < got ? ' on' : ''}"><i>${'★'.repeat(i + 1)}</i><small>${fmt(t)}</small></div>`)
      .join('');
  }

  private renderDare(won: boolean): void {
    const d = this.q('.dare');
    d.hidden = this.dare <= 0;
    d.classList.toggle('won', won);
    d.textContent = won ? `You beat the dare of ${fmt(this.dare)} nodes!` : `Dare: beat ${fmt(this.dare)} nodes`;
  }
}

export type ArchAction = 'here' | 'home' | 'daily' | 'random' | 'seed';

export interface LevelsDialog {
  arch: { seed: number; daily: boolean; dailyLabel: string; starred: number; away: boolean };
  sandboxes: Level[];
  best: Record<string, number>;
  current: string;
  onPick(level: Level): void;
  onArch(action: ArchAction, seed?: number): void;
}

/** The level select: the archipelago (seeds), the duel puzzles, then the sandboxes. */
export function openLevelsDialog(o: LevelsDialog, opener?: HTMLElement): void {
  const back = document.createElement('dialog');
  const riftworks = riftworksLevel();
  back.className = 'lvd-back';
  back.setAttribute('aria-labelledby', 'lvd-title');
  const card = (l: Level) => {
    const got = starsFor(l, o.best[l.id] ?? 0);
    const stars = l.stars ? `<span class="s">${'★'.repeat(got)}<span class="off">${'★'.repeat(3 - got)}</span></span>` : '';
    const sub = l.budget !== null ? `${l.budget} edits · ${l.inventory} blocks` : l.kind === 'riftworks' ? 'Seeded maze · 36 rooms' : 'No limits';
    return `<button class="card${l.id === o.current ? ' on' : ''}" data-id="${l.id}"${l.id === o.current ? ' autofocus' : ''}><b>${l.name}</b>${stars}<small>${sub}</small></button>`;
  };
  const a = o.arch;
  const archCard = (action: ArchAction, title: string, sub: string, focus = false) =>
    `<button class="card" data-arch="${action}"${focus ? ' autofocus' : ''}><b>${title}</b><small>${sub}</small></button>`;
  back.innerHTML = `<div class="lvd">
    <h2 id="lvd-title">Levels</h2><p>Make the bot think as hard as you can. For stars, reach the flag without editing during the run.</p>
    <h3>Archipelago</h3>
    <p class="arch-sub">Seed ${a.seed}${a.daily ? ` (daily, ${a.dailyLabel})` : ''} · ★ on ${a.starred} island${a.starred === 1 ? '' : 's'}. Earn ★ on an island to open bridges to its neighbours; tiers rise away from home.</p>
    <div class="list">
      ${a.away ? archCard('here', 'Back to the islands', 'Where you left off', true) : ''}
      ${archCard('home', 'Home island', 'Tier 1 · the start')}
      ${a.daily ? '' : archCard('daily', 'Daily archipelago', `${a.dailyLabel} · same for everyone`)}
      ${archCard('random', 'Random archipelago', 'A fresh seed')}
    </div>
    <form class="arch-seed"><label for="arch-seed">Seed</label><input id="arch-seed" type="number" min="0" max="4294967295" required value="${a.seed}"><button>Go</button></form>
    <h3>Algorithm Duel</h3><div class="list">${card(riftworks)}${card(HEURISTIC_TRAP)}</div>
    <h3>Sandbox</h3><div class="list">${o.sandboxes.map((l) => card(l)).join('')}</div></div>`;
  back.querySelector<HTMLFormElement>('.arch-seed')!.onsubmit = (e) => {
    e.preventDefault();
    const seed = back.querySelector<HTMLInputElement>('#arch-seed')!.valueAsNumber;
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) return;
    back.close();
    o.onArch('seed', seed);
  };
  back.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.card');
    if (!btn) return;
    back.close();
    if (btn.dataset.arch) return o.onArch(btn.dataset.arch as ArchAction);
    o.onPick([HEURISTIC_TRAP, riftworks, ...o.sandboxes].find((x) => x.id === btn.dataset.id)!);
  });
  showModal(back, undefined, opener);
}
