import { starsFor, type Level } from '../levels/levels';

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
.sp .lv .tog { display: none; opacity: .5; }
@media (max-width: 720px) {
  .sp { left: 10px; top: 58px; width: 214px; padding: 10px 12px; }
  .sp .lv { cursor: pointer; }
  .sp .lv .tog { display: inline; }
  .sp .lv small.kind { display: none; }
  .sp .score b { font-size: 22px; }
  .sp.min .lvhint, .sp.min .best, .sp.min .stars, .sp.min .bar, .sp.min .weight { display: none; }
  .sp.min .btns { margin-top: 8px; }
}
.sp-toast { position: fixed; left: 50%; top: 70px; z-index: 1100; transform: translate(-50%, -8px); padding: 8px 16px;
  border-radius: 12px; background: #3b3355; color: #fff; font: 600 13px/1.2 ui-rounded, 'SF Pro Rounded', system-ui, sans-serif;
  opacity: 0; pointer-events: none; transition: opacity .2s, transform .2s; }
.sp-toast.show { opacity: 1; transform: translate(-50%, 0); }

.lvd-back { position: fixed; inset: 0; z-index: 1000; display: grid; place-items: center; background: #1d1a2c73;
  opacity: 0; transition: opacity .2s; }
.lvd-back.show { opacity: 1; }
.lvd { width: min(640px, calc(100vw - 32px)); max-height: calc(100vh - 48px); overflow-y: auto; padding: 20px 24px 18px;
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
`;

export interface ScorePanelHandlers {
  onLevels(): void;
  onShare(): void;
  onReset(): void;
  onWeight(w: number): void;
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
      <div class="dare" hidden></div>
      <div class="score"><b class="nodes">–</b><span class="unit">nodes</span></div>
      <div class="best"><span class="bestv"></span><span class="note"></span></div>
      <div class="stars"></div>
      <div class="bar"><div class="row"><span>Edits</span><span class="editsv"></span></div><div class="track"><div class="fill"></div></div></div>
      <label class="weight"><div class="row"><span>A* weight</span><span class="wv"></span></div>
        <input type="range" min="1" max="5" step="0.1" value="1"></label>
      <div class="btns"><button class="levels">Levels</button><button class="reset">Reset</button><button class="share main">Copy link</button></div>`;
    document.body.appendChild(this.el);
    this.toastEl.className = 'sp-toast';
    document.body.appendChild(this.toastEl);

    if (matchMedia('(max-width: 720px)').matches) this.el.classList.add('min');
    this.q('.lv').onclick = () => {
      const min = this.el.classList.toggle('min');
      this.q('.tog').textContent = min ? '▾' : '▴';
    };
    this.q('.levels').onclick = () => h.onLevels();
    this.q('.reset').onclick = () => h.onReset();
    this.q('.share').onclick = () => h.onShare();
    const range = this.q<HTMLInputElement>('.weight input');
    range.oninput = () => {
      this.q('.wv').textContent = Number(range.value).toFixed(1);
      h.onWeight(Number(range.value));
    };
    // Keep Space / number keys for the game, not the slider.
    range.addEventListener('keydown', (e) => e.preventDefault());
    for (const b of this.el.querySelectorAll('button')) b.addEventListener('keyup', (e) => e.preventDefault());
    this.el.addEventListener('pointerup', () => (document.activeElement as HTMLElement | null)?.blur?.());
  }

  /** A level was loaded. `dare` is a friend's score from a share link (0 = none). */
  setLevel(level: Level, index: number | null, best: number, dare: number): void {
    this.level = level;
    this.best = best;
    this.dare = dare;
    this.q('.name').textContent = level.name;
    this.q('.kind').textContent = index !== null ? `Level ${index + 1}` : 'Sandbox';
    this.q('.lvhint').textContent = level.hint;
    this.q('.nodes').textContent = '–';
    this.q('.score').classList.remove('miss');
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

  /** A run ended. Only arrivals score. */
  setResult(arrived: boolean, nodes: number, newBest: boolean): void {
    const score = this.q('.score');
    score.classList.toggle('miss', !arrived);
    this.q('.unit').hidden = !arrived;
    this.q('.nodes').textContent = arrived ? fmt(nodes) : "No path — doesn't count";
    if (arrived && newBest) this.best = nodes;
    this.q('.note').innerHTML = arrived && newBest ? '<span class="new">New best!</span>' : '';
    this.renderBest();
    this.renderStars();
    this.renderDare(arrived && this.dare > 0 && nodes > this.dare);
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

/** The level select: challenges with their stars, then the sandboxes. */
export function openLevelsDialog(
  levels: Level[],
  sandboxes: Level[],
  best: Record<string, number>,
  current: string,
  onPick: (level: Level) => void,
): void {
  const back = document.createElement('div');
  back.className = 'lvd-back';
  const card = (l: Level, i: number | null) => {
    const got = starsFor(l, best[l.id] ?? 0);
    const stars = l.stars ? `<span class="s">${'★'.repeat(got)}<span class="off">${'★'.repeat(3 - got)}</span></span>` : '';
    const sub = l.budget !== null ? `${l.budget} edits · ${l.inventory} blocks` : 'No limits';
    return `<button class="card${l.id === current ? ' on' : ''}" data-id="${l.id}">
      ${i !== null ? `<span class="n">Level ${i + 1}</span>` : ''}<b>${l.name}</b>${stars}<small>${sub}</small></button>`;
  };
  back.innerHTML = `<div class="lvd" role="dialog" aria-label="Levels">
    <h2>Levels</h2><p>Make the bot think as hard as you can. Only runs where it reaches the flag count.</p>
    <h3>Challenges</h3><div class="list">${levels.map((l, i) => card(l, i)).join('')}</div>
    <h3>Sandbox</h3><div class="list">${sandboxes.map((l) => card(l, null)).join('')}</div></div>`;
  document.body.appendChild(back);
  setTimeout(() => back.classList.add('show'), 0);
  const close = () => {
    back.classList.remove('show');
    window.removeEventListener('keydown', onKey, true);
    setTimeout(() => back.remove(), 200);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') (e.stopPropagation(), close());
  };
  window.addEventListener('keydown', onKey, true);
  back.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.card');
    if (btn) {
      const l = [...levels, ...sandboxes].find((x) => x.id === btn.dataset.id)!;
      close();
      onPick(l);
    } else if (e.target === back) close();
  });
}
